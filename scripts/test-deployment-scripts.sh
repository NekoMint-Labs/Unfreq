#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
STUB_BIN="$TMP_DIR/bin"
CALL_LOG="$TMP_DIR/calls.log"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

mkdir -p "$STUB_BIN"
: > "$CALL_LOG"

copy_fixture_files() {
  cp "$ROOT_DIR/compose.yaml" "$TMP_DIR/compose.yaml"
  cp "$ROOT_DIR/.env.example" "$TMP_DIR/.env.example"
  mkdir -p "$TMP_DIR/scripts"
  cp "$ROOT_DIR/scripts/deployment-stack.sh" "$TMP_DIR/scripts/deployment-stack.sh"
  cp "$ROOT_DIR/scripts/deployment-smoke.sh" "$TMP_DIR/scripts/deployment-smoke.sh"
  chmod +x "$TMP_DIR/scripts/deployment-stack.sh" "$TMP_DIR/scripts/deployment-smoke.sh"
}

write_valid_env() {
  cat > "$TMP_DIR/.env" <<'ENV'
API_HOST=0.0.0.0
API_PORT=4000
AUTH_LOGIN_CODE_RESPONSE=disabled
AI_MODEL=local-fallback
AI_PROVIDER=openai-compatible
DATABASE_URL=postgres://postgres:postgres@postgres:5432/unfreq
PROVIDER_CONFIG_SECRET=12345678901234567890123456789012
REDIS_URL=redis://redis:6379
SESSION_SECRET=abcdefghijklmnopqrstuvwxyz123456
UNFREQ_PROXY_NETWORK=test_proxy
WEB_ORIGIN=https://example.com
ENV
}

write_stub_commands() {
  cat > "$STUB_BIN/docker" <<'EOF'
#!/bin/sh
set -eu

printf 'docker %s\n' "$*" >> "$UNFREQ_TEST_CALL_LOG"

if [ "$1" = "network" ] && [ "$2" = "inspect" ]; then
  exit 0
fi

if [ "$1" = "compose" ]; then
  exit 0
fi

exit 0
EOF

  cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/sh
set -eu

printf 'curl %s\n' "$*" >> "$UNFREQ_TEST_CALL_LOG"
exit 0
EOF

  chmod +x "$STUB_BIN/docker" "$STUB_BIN/curl"
}

assert_contains() {
  file="$1"
  expected="$2"

  if ! grep -F "$expected" "$file" >/dev/null 2>&1; then
    printf 'Expected to find "%s" in %s\n' "$expected" "$file" >&2
    printf '--- %s ---\n' "$file" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  file="$1"
  unexpected="$2"

  if grep -F "$unexpected" "$file" >/dev/null 2>&1; then
    printf 'Did not expect to find "%s" in %s\n' "$unexpected" "$file" >&2
    printf '--- %s ---\n' "$file" >&2
    cat "$file" >&2
    exit 1
  fi
}

run_case() {
  name="$1"
  shift

  printf 'Running %s...\n' "$name"
  "$@"
}

test_shell_syntax() {
  sh -n "$ROOT_DIR/scripts/deployment-stack.sh"
  sh -n "$ROOT_DIR/scripts/deployment-smoke.sh"
  sh -n "$ROOT_DIR/scripts/prod-deploy.sh"
  sh -n "$ROOT_DIR/scripts/test-deployment-scripts.sh"
}

test_preflight_passes_with_valid_env() {
  : > "$CALL_LOG"
  write_valid_env

  (
    cd "$TMP_DIR"
    PATH="$STUB_BIN:$PATH" \
      UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
      ./scripts/deployment-stack.sh server preflight > "$TMP_DIR/preflight.out" 2> "$TMP_DIR/preflight.err"
  )

  assert_contains "$TMP_DIR/preflight.out" "Preflight checks passed for server mode using .env."
  assert_contains "$CALL_LOG" "docker compose -f compose.yaml config"
  assert_contains "$CALL_LOG" "docker network inspect test_proxy"
}

test_preflight_rejects_placeholder_env() {
  cp "$TMP_DIR/.env.example" "$TMP_DIR/.env"

  if (
    cd "$TMP_DIR"
    PATH="$STUB_BIN:$PATH" \
      UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
      ./scripts/deployment-stack.sh server preflight > "$TMP_DIR/bad-preflight.out" 2> "$TMP_DIR/bad-preflight.err"
  ); then
    printf 'Expected placeholder preflight to fail.\n' >&2
    exit 1
  fi

  assert_contains "$TMP_DIR/bad-preflight.err" "Preflight failed:"
}

test_config_uses_example_env_when_env_is_missing() {
  : > "$CALL_LOG"
  rm -f "$TMP_DIR/.env"

  (
    cd "$TMP_DIR"
    PATH="$STUB_BIN:$PATH" \
      UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
      ./scripts/deployment-stack.sh server config > "$TMP_DIR/config.out" 2> "$TMP_DIR/config.err"
  )

  assert_contains "$TMP_DIR/config.err" "Using .env.example for config output."
  assert_contains "$CALL_LOG" "docker compose -f compose.yaml config"
  assert_not_contains "$TMP_DIR/config.err" "Missing env file"
}

test_smoke_checks_expected_urls_and_services() {
  : > "$CALL_LOG"

  (
    cd "$TMP_DIR"
    PATH="$STUB_BIN:$PATH" \
      UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
      UNFREQ_BASE_URL="https://example.com/" \
      ./scripts/deployment-smoke.sh > "$TMP_DIR/smoke.out" 2> "$TMP_DIR/smoke.err"
  )

  assert_contains "$CALL_LOG" "curl -fsS https://example.com/health"
  assert_contains "$CALL_LOG" "curl -fsS https://example.com/health/deep"
  assert_contains "$CALL_LOG" "curl -fsS https://example.com/web-health"
  assert_contains "$CALL_LOG" "curl -fsS https://example.com/galaxy"
  assert_contains "$CALL_LOG" "docker compose -f compose.yaml exec -T web wget -qO- http://127.0.0.1:3000/web-health"
  assert_contains "$CALL_LOG" "docker compose -f compose.yaml exec -T postgres pg_isready -U postgres -d unfreq"
  assert_contains "$CALL_LOG" "docker compose -f compose.yaml exec -T redis redis-cli ping"
  assert_contains "$TMP_DIR/smoke.out" "Deployment smoke checks passed."
}

copy_fixture_files
write_stub_commands

run_case "deployment shell syntax" test_shell_syntax
run_case "deployment preflight success" test_preflight_passes_with_valid_env
run_case "deployment preflight placeholder rejection" test_preflight_rejects_placeholder_env
run_case "deployment config env fallback" test_config_uses_example_env_when_env_is_missing
run_case "deployment smoke command wiring" test_smoke_checks_expected_urls_and_services

printf 'Deployment script regression tests passed.\n'
