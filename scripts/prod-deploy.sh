#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${UNFREQ_API_ENV_FILE:-.env}"
ENV_EXAMPLE=".env.example"
SKIP_BACKUP=0
DOMAIN_ARG=""

cd "$ROOT_DIR"

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
  temp_file="${ENV_FILE}.tmp"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" > "$temp_file"
    mv "$temp_file" "$ENV_FILE"
    return
  fi

  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
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
  if [ -f "$ENV_FILE" ]; then
    printf 'Using %s.\n' "$ENV_FILE"
    return
  fi

  [ -f "$ENV_EXAMPLE" ] || fail "missing $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
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
