#!/bin/sh
set -eu
umask 077

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${UNFREQ_API_ENV_FILE:-.env}"
ENV_EXAMPLE=".env.example"
SKIP_BACKUP=0
DOMAIN_ARG=""
ENV_TEMP_FILE=""

cd "$ROOT_DIR"

cleanup_env_temp() {
  if [ -n "$ENV_TEMP_FILE" ]; then
    rm -f -- "$ENV_TEMP_FILE"
  fi
}

trap cleanup_env_temp EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  printf 'Usage: %s [--skip-backup] [https://your-domain]\n' "$0" >&2
  printf 'First deploy needs a domain. Later deploys can read WEB_ORIGIN from %s.\n' "$ENV_FILE" >&2
}

fail() {
  printf 'prod-deploy failed: %s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

read_env_value() {
  key="$1"

  if [ ! -f "$ENV_FILE" ]; then
    return
  fi

  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

resolve_proxy_network() {
  network_name="${UNFREQ_PROXY_NETWORK:-}"

  if [ -z "$network_name" ] && [ -f "$ENV_FILE" ]; then
    network_name="$(read_env_value UNFREQ_PROXY_NETWORK)"
  fi

  printf '%s\n' "${network_name:-npm_default}"
}

write_env_value() {
  key="$1"
  value="$2"
  ENV_TEMP_FILE="$(mktemp -- "${ENV_FILE}.tmp.XXXXXX")"

  if grep -q "^${key}=" "$ENV_FILE"; then
    escaped_value="$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')"
    sed "s|^${key}=.*|${key}=${escaped_value}|" "$ENV_FILE" > "$ENV_TEMP_FILE"
  else
    cat "$ENV_FILE" > "$ENV_TEMP_FILE"
    printf '%s=%s\n' "$key" "$value" >> "$ENV_TEMP_FILE"
  fi

  chmod 600 "$ENV_TEMP_FILE"
  mv -f -- "$ENV_TEMP_FILE" "$ENV_FILE"
  ENV_TEMP_FILE=""
}

is_placeholder_secret() {
  value="$1"

  if [ -z "$value" ] || [ "${#value}" -lt 32 ]; then
    return 0
  fi

  case "$value" in
    replace-*|*replace-this*|*change-before-production*)
      return 0
      ;;
  esac

  return 1
}

generate_secret() {
  openssl rand -base64 48
}

normalize_origin() {
  value="$1"

  case "$value" in
    https://*)
      printf '%s\n' "$value"
      ;;
    http://*)
      fail "production domain must use https://"
      ;;
    "")
      fail "missing production domain"
      ;;
    *)
      printf 'https://%s\n' "$value"
      ;;
  esac
}

is_placeholder_origin() {
  value="$1"

  case "$value" in
    ""|*your-domain.example*|*localhost*)
      return 0
      ;;
  esac

  return 1
}

ensure_env_file() {
  if [ -L "$ENV_FILE" ]; then
    fail "environment file must not be a symbolic link"
  fi
  if [ -e "$ENV_FILE" ]; then
    [ -f "$ENV_FILE" ] || fail "environment path must be a regular file"
    chmod 600 "$ENV_FILE"
    printf 'Using %s.\n' "$ENV_FILE"
    return
  fi

  [ -f "$ENV_EXAMPLE" ] || fail "missing $ENV_EXAMPLE"
  ENV_TEMP_FILE="$(mktemp -- "${ENV_FILE}.tmp.XXXXXX")"
  cat "$ENV_EXAMPLE" > "$ENV_TEMP_FILE"
  chmod 600 "$ENV_TEMP_FILE"
  # Publish complete private bytes without replacing a destination created
  # after the existence check. The unique temporary file shares its directory.
  ln -T -- "$ENV_TEMP_FILE" "$ENV_FILE"
  rm -f -- "$ENV_TEMP_FILE"
  ENV_TEMP_FILE=""
  printf 'Created %s from %s.\n' "$ENV_FILE" "$ENV_EXAMPLE"
}

ensure_secret() {
  key="$1"
  current_value="$(read_env_value "$key")"

  if is_placeholder_secret "$current_value"; then
    write_env_value "$key" "$(generate_secret)"
    printf 'Generated %s.\n' "$key"
    return
  fi

  printf 'Kept existing %s.\n' "$key"
}

ensure_network() {
  network_name="$(resolve_proxy_network)"

  if docker network inspect "$network_name" >/dev/null 2>&1; then
    printf 'Docker network %s exists.\n' "$network_name"
    return
  fi

  docker network create "$network_name" >/dev/null
  printf 'Created Docker network %s.\n' "$network_name"
}

run_stack() {
  action="$1"

  UNFREQ_API_ENV_FILE="$ENV_FILE" \
    UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
    ./scripts/deployment-stack.sh server "$action"
}

is_postgres_running() {
  container_id="$(
    UNFREQ_API_ENV_FILE="$ENV_FILE" \
      UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
      docker compose -f compose.yaml ps -q postgres
  )"

  if [ -z "$container_id" ]; then
    return 1
  fi

  [ "$(docker inspect -f '{{.State.Running}}' "$container_id")" = "true" ]
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-backup)
      SKIP_BACKUP=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      usage
      fail "unknown option: $1"
      ;;
    *)
      if [ -n "$DOMAIN_ARG" ]; then
        usage
        fail "only one domain argument is supported"
      fi
      DOMAIN_ARG="$1"
      ;;
  esac

  shift
done

require_command docker
require_command openssl
require_command mktemp
require_command chmod
require_command ln

ensure_env_file

if [ -n "$DOMAIN_ARG" ]; then
  WEB_ORIGIN_VALUE="$(normalize_origin "$DOMAIN_ARG")"
  write_env_value WEB_ORIGIN "$WEB_ORIGIN_VALUE"
else
  WEB_ORIGIN_VALUE="$(read_env_value WEB_ORIGIN)"
  if is_placeholder_origin "$WEB_ORIGIN_VALUE"; then
    usage
    fail "first deploy needs a real production domain"
  fi
fi

WEB_ORIGIN_VALUE="$(normalize_origin "$WEB_ORIGIN_VALUE")"
write_env_value WEB_ORIGIN "$WEB_ORIGIN_VALUE"
write_env_value AUTH_LOGIN_CODE_RESPONSE disabled
write_env_value AUTH_LOGIN_DELIVERY_MODE disabled
ensure_secret SESSION_SECRET
ensure_secret PROVIDER_CONFIG_SECRET
ensure_network

run_stack preflight

if [ "$SKIP_BACKUP" -eq 1 ]; then
  printf 'Skipping PostgreSQL backup because --skip-backup was set.\n'
elif is_postgres_running; then
  run_stack backup
else
  printf 'Skipping PostgreSQL backup because the postgres container is not running yet.\n'
fi

UNFREQ_API_ENV_FILE="$ENV_FILE" \
  UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
  UNFREQ_BASE_URL="$WEB_ORIGIN_VALUE" \
  ./scripts/deployment-stack.sh server release
