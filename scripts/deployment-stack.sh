#!/bin/sh
set -eu

MODE="${1:-server}"
ACTION="${2:-start}"
ACTION_ARG="${3:-}"
LOG_TARGET="${ACTION_ARG:-api}"
ENV_FILE="${UNFREQ_API_ENV_FILE:-}"

case "$MODE" in
  server)
    BASE_URL="${UNFREQ_BASE_URL:-}"
    COMPOSE_FILES="${UNFREQ_COMPOSE_FILES:--f compose.yaml}"
    ENV_FILE="${ENV_FILE:-.env}"
    ;;
  *)
    printf 'Usage: %s server start|stop|rebuild|config|preflight|release|smoke|logs|backup|restore\n' "$0" >&2
    exit 2
    ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 127
  }
}

run_compose() {
  # shellcheck disable=SC2086
  UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
    UNFREQ_API_ENV_FILE="$ENV_FILE" \
    DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}" \
    docker compose $COMPOSE_FILES "$@"
}

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    printf 'Missing env file: %s\n' "$ENV_FILE" >&2
    if [ "$MODE" = "server" ]; then
      printf 'Create it from .env.example, then set real secrets and WEB_ORIGIN.\n' >&2
    fi
    exit 2
  fi
}

use_example_env_for_config() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  if [ "$MODE" = "server" ] && [ -f ".env.example" ]; then
    ENV_FILE=".env.example"
    printf 'Using %s for config output. Create .env before start/rebuild/preflight.\n' "$ENV_FILE" >&2
    return
  fi
}

read_env_value() {
  key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

resolve_proxy_network() {
  network_name="${UNFREQ_PROXY_NETWORK:-}"

  if [ -z "$network_name" ] && [ -f "$ENV_FILE" ]; then
    network_name="$(read_env_value UNFREQ_PROXY_NETWORK)"
  fi

  printf '%s\n' "${network_name:-npm_default}"
}

fail_preflight() {
  printf 'Preflight failed: %s\n' "$1" >&2
  exit 2
}

require_env_value() {
  key="$1"
  value="$(read_env_value "$key")"

  if [ -z "$value" ]; then
    fail_preflight "$key must be set in $ENV_FILE"
  fi
}

check_secret_value() {
  key="$1"
  value="$(read_env_value "$key")"

  if [ "${#value}" -lt 32 ]; then
    fail_preflight "$key must be at least 32 characters"
  fi

  case "$value" in
    replace-*|*replace-this*|*change-before-production*)
      fail_preflight "$key still contains a placeholder value"
      ;;
  esac
}

check_prod_origin() {
  value="$(read_env_value WEB_ORIGIN)"

  case "$value" in
    https://*)
      ;;
    *)
      fail_preflight "WEB_ORIGIN must be an https:// URL in server mode"
      ;;
  esac

  case "$value" in
    *your-domain.example*|*localhost*)
      fail_preflight "WEB_ORIGIN still contains a placeholder or localhost value"
      ;;
  esac
}

check_prod_network() {
  network_name="$(resolve_proxy_network)"

  if ! docker network inspect "$network_name" >/dev/null 2>&1; then
    fail_preflight "Docker network '$network_name' is missing; create it or set UNFREQ_PROXY_NETWORK"
  fi
}

require_smoke_base_url() {
  if [ "$MODE" = "server" ] && [ -z "$BASE_URL" ]; then
    printf 'UNFREQ_BASE_URL is required for server smoke checks.\n' >&2
    exit 2
  fi
}

preflight() {
  require_env_file
  require_env_value DATABASE_URL
  require_env_value REDIS_URL
  require_env_value WEB_ORIGIN
  require_env_value AI_PROVIDER
  require_env_value AI_MODEL

  check_secret_value SESSION_SECRET
  check_secret_value PROVIDER_CONFIG_SECRET
  check_prod_origin

  code_response="$(read_env_value AUTH_LOGIN_CODE_RESPONSE)"
  if [ "$code_response" != "disabled" ]; then
    fail_preflight "AUTH_LOGIN_CODE_RESPONSE must be disabled in server mode"
  fi
  delivery_mode="$(read_env_value AUTH_LOGIN_DELIVERY_MODE)"
  if [ "$delivery_mode" != "disabled" ]; then
    fail_preflight "AUTH_LOGIN_DELIVERY_MODE must be disabled until a production mail transport is implemented"
  fi
  if [ "$(read_env_value ABUSE_PROTECTION_ENABLED)" != "true" ]; then
    fail_preflight "ABUSE_PROTECTION_ENABLED must be true in server mode"
  fi
  require_env_value ABUSE_LIMITS_JSON

  run_compose config >/dev/null

  check_prod_network

  printf 'Preflight checks passed for %s mode using %s.\n' "$MODE" "$ENV_FILE"
}

validate_postgres_target() {
  postgres_user="${UNFREQ_PG_USER:-postgres}"
  postgres_database="${UNFREQ_PG_DATABASE:-unfreq}"
  for identifier in "$postgres_user" "$postgres_database"; do
    case "$identifier" in
      ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*)
        printf 'PostgreSQL user/database must be simple SQL identifiers.\n' >&2
        exit 2
        ;;
    esac
    if [ "${#identifier}" -gt 63 ]; then
      printf 'PostgreSQL user/database identifiers must not exceed 63 characters.\n' >&2
      exit 2
    fi
  done
}

backup_postgres() (
  require_env_file
  validate_postgres_target
  require_command dirname
  require_command gzip
  require_command mktemp
  require_command ln
  require_command chmod
  umask 077
  output_dir="${UNFREQ_BACKUP_DIR:-deploy/backups}"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_path="${UNFREQ_BACKUP_FILE:-$output_dir/unfreq-postgres-$timestamp.sql.gz}"
  case "$output_path" in
    *.sql|*.sql.gz) ;;
    *) printf 'Backup filename must end in .sql or .sql.gz.\n' >&2; exit 2 ;;
  esac
  if [ -e "$output_path" ] || [ -L "$output_path" ]; then
    printf 'Refusing to overwrite an existing backup.\n' >&2
    exit 2
  fi
  backup_dir="$(dirname -- "$output_path")"
  mkdir -p -- "$backup_dir"
  temp_dir="$(mktemp -d -- "$backup_dir/.unfreq-backup.XXXXXX")"
  temp_plain="$temp_dir/dump.sql"
  temp_archive="$temp_dir/dump.sql.gz"
  temp_error="$temp_dir/error.log"
  trap 'rm -f -- "$temp_plain" "$temp_archive" "$temp_error"; rmdir -- "$temp_dir"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  chmod 700 "$temp_dir"
  : > "$temp_plain"
  : > "$temp_archive"
  : > "$temp_error"
  chmod 600 "$temp_plain" "$temp_archive" "$temp_error"
  if ! run_compose exec -T postgres pg_dump -U "$postgres_user" -d "$postgres_database" > "$temp_plain" 2> "$temp_error"; then
    printf 'PostgreSQL backup failed; no backup was published.\n' >&2
    exit 1
  fi
  if [ ! -s "$temp_plain" ]; then
    printf 'PostgreSQL backup was empty; no backup was published.\n' >&2
    exit 1
  fi
  temp_final="$temp_plain"
  case "$output_path" in
    *.gz)
      if ! gzip -c -- "$temp_plain" > "$temp_archive"; then
        printf 'PostgreSQL backup compression failed; no backup was published.\n' >&2
        exit 1
      fi
      temp_final="$temp_archive"
      ;;
  esac
  # Same-filesystem hard link publishes complete bytes atomically and fails if
  # another process has already claimed the destination. Never replace a backup.
  if ! ln -T -- "$temp_final" "$output_path"; then
    printf 'PostgreSQL backup could not be published without overwriting a file.\n' >&2
    exit 1
  fi
  printf 'PostgreSQL backup written: %s\n' "$output_path"
)

restore_postgres() (
  require_env_file
  validate_postgres_target
  if [ "${UNFREQ_RESTORE_ISOLATED:-false}" != "true" ]; then
    printf 'Restore requires UNFREQ_RESTORE_ISOLATED=true and a fresh, isolated target.\n' >&2
    exit 2
  fi
  backup_file="${UNFREQ_BACKUP_FILE:-$ACTION_ARG}"

  if [ -z "$backup_file" ]; then
    printf 'Usage: %s %s restore <backup.sql|backup.sql.gz>\n' "$0" "$MODE" >&2
    exit 2
  fi

  if [ ! -f "$backup_file" ]; then
    printf 'Backup file not found: %s\n' "$backup_file" >&2
    exit 2
  fi

  require_command mktemp
  require_command chmod
  umask 077
  temp_dir="$(mktemp -d -- "${TMPDIR:-/tmp}/unfreq-restore.XXXXXX")"
  temp_plain="$temp_dir/dump.sql"
  temp_restore="$temp_dir/restore.sql"
  temp_error="$temp_dir/error.log"
  trap 'rm -f -- "$temp_plain" "$temp_restore" "$temp_error"; rmdir -- "$temp_dir"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  chmod 700 "$temp_dir"
  : > "$temp_plain"
  : > "$temp_restore"
  : > "$temp_error"
  chmod 600 "$temp_plain" "$temp_restore" "$temp_error"
  # Finish and validate decompression before psql can make any changes. A shell
  # pipeline would otherwise lose gzip's failure when psql exits successfully.
  case "$backup_file" in
    *.gz)
      require_command gzip
      if ! gzip -dc -- "$backup_file" > "$temp_plain" 2> "$temp_error"; then
        printf 'PostgreSQL restore rejected an invalid compressed backup.\n' >&2
        exit 1
      fi
      ;;
    *)
      cat -- "$backup_file" > "$temp_plain"
      ;;
  esac
  if [ ! -s "$temp_plain" ]; then
    printf 'PostgreSQL restore rejected an empty backup.\n' >&2
    exit 2
  fi
  # The guard is the first statement in the same transaction as the dump. The
  # isolation flag is an operator declaration, not proof of network isolation.
  cat > "$temp_restore" <<'SQL'
DO $unfreq_restore_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('public', 'information_schema') AND nspname !~ '^pg_'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql') THEN
    RAISE EXCEPTION 'UNFREQ_RESTORE_TARGET_NOT_EMPTY';
  END IF;
END
$unfreq_restore_guard$;
SQL
  cat -- "$temp_plain" >> "$temp_restore"
  if ! run_compose exec -T postgres psql -X -v ON_ERROR_STOP=1 --single-transaction --file=- -U "$postgres_user" -d "$postgres_database" < "$temp_restore" > /dev/null 2> "$temp_error"; then
    printf 'PostgreSQL restore failed; check target emptiness and backup compatibility.\n' >&2
    exit 1
  fi
  printf 'PostgreSQL restore completed from: %s\n' "$backup_file"
)

release_stack() {
  require_smoke_base_url
  preflight
  run_compose pull --ignore-buildable
  run_compose up --build -d
  UNFREQ_API_ENV_FILE="$ENV_FILE" \
    UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
    UNFREQ_BASE_URL="$BASE_URL" \
    UNFREQ_COMPOSE_FILES="$COMPOSE_FILES" \
    "$0" "$MODE" smoke
  run_compose logs --tail 80 api
}

require_command docker

case "$ACTION" in
  start)
    require_env_file
    run_compose up -d
    ;;
  stop)
    run_compose stop
    ;;
  rebuild)
    preflight
    run_compose up --build -d
    ;;
  config)
    use_example_env_for_config
    require_env_file
    run_compose config
    ;;
  preflight)
    preflight
    ;;
  release)
    release_stack
    ;;
  smoke)
    require_smoke_base_url
    UNFREQ_BASE_URL="$BASE_URL" \
      UNFREQ_COMPOSE_FILES="$COMPOSE_FILES" \
      UNFREQ_API_ENV_FILE="$ENV_FILE" \
      UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
      ./scripts/deployment-smoke.sh
    ;;
  logs)
    run_compose logs -f "$LOG_TARGET"
    ;;
  backup)
    backup_postgres
    ;;
  restore)
    restore_postgres
    ;;
  *)
    printf 'Usage: %s server start|stop|rebuild|config|preflight|release|smoke|logs|backup|restore\n' "$0" >&2
    exit 2
    ;;
esac
