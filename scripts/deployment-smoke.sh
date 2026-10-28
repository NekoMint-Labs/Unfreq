#!/bin/sh
set -eu

MODE="${UNFREQ_DEPLOYMENT_MODE:-server}"

case "$MODE" in
  server)
    DEFAULT_BASE_URL=""
    DEFAULT_COMPOSE_FILES="-f compose.yaml"
    ;;
  *)
    printf 'UNFREQ_DEPLOYMENT_MODE must be server.\n' >&2
    exit 2
    ;;
esac

BASE_URL="${UNFREQ_BASE_URL:-$DEFAULT_BASE_URL}"
COMPOSE_FILES="${UNFREQ_COMPOSE_FILES:-$DEFAULT_COMPOSE_FILES}"

if [ -z "$BASE_URL" ]; then
  printf 'UNFREQ_BASE_URL is required when UNFREQ_DEPLOYMENT_MODE=server.\n' >&2
  exit 2
fi

BASE_URL="${BASE_URL%/}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 127
  }
}

check_http() {
  label="$1"
  url="$2"

  printf 'Checking %s: %s\n' "$label" "$url"
  curl -fsS "$url" >/dev/null
}

check_compose() {
  label="$1"
  shift

  printf 'Checking %s\n' "$label"
  # shellcheck disable=SC2086
  docker compose $COMPOSE_FILES exec -T "$@"
}

require_command curl
require_command docker

check_http "proxy root" "$BASE_URL/"
check_http "API liveness through proxy" "$BASE_URL/health"
check_http "API deep health through proxy" "$BASE_URL/health/deep"
check_http "Web liveness through proxy" "$BASE_URL/web-health"
check_http "SSR galaxy route" "$BASE_URL/galaxy"

check_compose "Web container health route" web wget -qO- http://127.0.0.1:3000/web-health
check_compose "PostgreSQL readiness" postgres pg_isready -U postgres -d unfreq
check_compose "Redis readiness" redis redis-cli ping

printf 'Deployment smoke checks passed.\n'
