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

  run_compose config >/dev/null

  check_prod_network

  printf 'Preflight checks passed for %s mode using %s.\n' "$MODE" "$ENV_FILE"
}

backup_postgres() {
  require_env_file
  require_command dirname
  require_command gzip
  output_dir="${UNFREQ_BACKUP_DIR:-deploy/backups}"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_path="${UNFREQ_BACKUP_FILE:-$output_dir/unfreq-postgres-$timestamp.sql.gz}"
  plain_output="${output_path%.gz}"
  backup_dir="$(dirname "$output_path")"
  temp_output="$plain_output.tmp"

  mkdir -p "$backup_dir"
  run_compose exec -T postgres pg_dump -U postgres -d unfreq > "$temp_output"
  mv "$temp_output" "$plain_output"

  case "$output_path" in
    *.gz)
      gzip -f "$plain_output"
      ;;
  esac

  printf 'PostgreSQL backup written: %s\n' "$output_path"
}

restore_postgres() {
  require_env_file
  backup_file="${UNFREQ_BACKUP_FILE:-$ACTION_ARG}"

  if [ -z "$backup_file" ]; then
    printf 'Usage: %s %s restore <backup.sql|backup.sql.gz>\n' "$0" "$MODE" >&2
    exit 2
  fi

  if [ ! -f "$backup_file" ]; then
    printf 'Backup file not found: %s\n' "$backup_file" >&2
    exit 2
  fi

  case "$backup_file" in
    *.gz)
      require_command gzip
      gzip -dc "$backup_file" | run_compose exec -T postgres psql -U postgres -d unfreq
      ;;
    *)
      run_compose exec -T postgres psql -U postgres -d unfreq < "$backup_file"
      ;;
  esac

  printf 'PostgreSQL restore completed from: %s\n' "$backup_file"
}

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
