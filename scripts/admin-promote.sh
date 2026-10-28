#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MODE="server"
ENV_FILE="${UNFREQ_API_ENV_FILE:-.env}"

usage() {
  printf 'Usage: %s [server] --code <FM-code>\n' "$0" >&2
  printf '       %s [server] --email <email>\n' "$0" >&2
  printf '       %s [server] --name <legacy-frequency-name>\n' "$0" >&2
  printf '       %s [server] --id <user-id>\n' "$0" >&2
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    server)
      MODE="$1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
  esac
fi

if [ "$#" -eq 0 ]; then
  usage
  exit 2
fi

cd "$ROOT_DIR"

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

run_compose() {
  UNFREQ_API_ENV_FILE="$ENV_FILE" \
    UNFREQ_PROXY_NETWORK="$(resolve_proxy_network)" \
    docker compose -f compose.yaml "$@"
}

run_compose exec -T api npm --workspace @unfreq/api run admin:promote -- "$@"
