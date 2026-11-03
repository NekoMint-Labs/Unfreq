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
AUTH_LOGIN_DELIVERY_MODE=disabled
ABUSE_PROTECTION_ENABLED=true
ABUSE_LIMITS_JSON={"synthetic":"presence-only-preflight-fixture"}
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

test_preflight_rejects_unsafe_auth_and_missing_policy() {
  for setting in 'AUTH_LOGIN_DELIVERY_MODE=local-log' 'AUTH_LOGIN_CODE_RESPONSE=enabled' 'ABUSE_PROTECTION_ENABLED=false' 'ABUSE_LIMITS_JSON='; do
    write_valid_env
    printf '%s\n' "$setting" >> "$TMP_DIR/.env"
    if (
      cd "$TMP_DIR"
      PATH="$STUB_BIN:$PATH" UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
        ./scripts/deployment-stack.sh server preflight > "$TMP_DIR/rejected.out" 2> "$TMP_DIR/rejected.err"
    ); then
      printf 'Expected unsafe authentication or absent policy to fail preflight.\n' >&2
      exit 1
    fi
    assert_contains "$TMP_DIR/rejected.err" 'Preflight failed:'
  done
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

prod_env_setup() {
  PROD_ROOT="$TMP_DIR/prod-$1"
  PROD_BIN="$PROD_ROOT/bin"
  PROD_CALLS="$PROD_ROOT/calls.log"
  PROD_SECRET="synthetic-prod-env-secret-not-a-real-credential-$$"
  PROD_REAL_MV="$(command -v mv)"
  PROD_REAL_LN="$(command -v ln)"
  mkdir -p "$PROD_ROOT/scripts" "$PROD_BIN"
  cp "$ROOT_DIR/scripts/prod-deploy.sh" "$PROD_ROOT/scripts/prod-deploy.sh"
  cp "$ROOT_DIR/.env.example" "$PROD_ROOT/.env.example"
  chmod 644 "$PROD_ROOT/.env.example"
  : > "$PROD_CALLS"
  cat > "$PROD_BIN/docker" <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 3 ] && [ "$1" = network ] && [ "$2" = inspect ] || exit 71
printf 'network inspect\n' >> "$UNFREQ_PROD_TEST_CALLS"
EOF
  cat > "$PROD_BIN/openssl" <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 3 ] && [ "$1" = rand ] && [ "$2" = -base64 ] && [ "$3" = 48 ] || exit 72
printf '%s\n' "$UNFREQ_PROD_TEST_SECRET"
EOF
  cat > "$PROD_BIN/mv" <<'EOF'
#!/bin/sh
set -eu
[ "${UNFREQ_PROD_TEST_FAIL_MV:-false}" != true ] || exit 73
exec "$UNFREQ_PROD_TEST_REAL_MV" "$@"
EOF
  cat > "$PROD_BIN/ln" <<'EOF'
#!/bin/sh
set -eu
if [ "${UNFREQ_PROD_TEST_PUBLISH_RACE:-false}" = true ]; then
  for destination do :; done
  printf 'OWNED_PUBLISH_RACE_SENTINEL\n' > "$destination"
fi
exec "$UNFREQ_PROD_TEST_REAL_LN" "$@"
EOF
  cat > "$PROD_ROOT/scripts/deployment-stack.sh" <<'EOF'
#!/bin/sh
set -eu
[ "$#" -eq 2 ] && [ "$1" = server ] || exit 74
case "$2" in preflight|release) ;; *) exit 75;; esac
printf 'stack %s\n' "$2" >> "$UNFREQ_PROD_TEST_CALLS"
EOF
  chmod +x "$PROD_BIN/docker" "$PROD_BIN/openssl" "$PROD_BIN/mv" "$PROD_BIN/ln" "$PROD_ROOT/scripts/deployment-stack.sh"
}

run_prod_env() {
  (
    cd "$PROD_ROOT"
    umask 022
    PATH="$PROD_BIN:$PATH" \
      UNFREQ_API_ENV_FILE=.env \
      UNFREQ_PROD_TEST_CALLS="$PROD_CALLS" \
      UNFREQ_PROD_TEST_SECRET="$PROD_SECRET" \
      UNFREQ_PROD_TEST_REAL_MV="$PROD_REAL_MV" \
      UNFREQ_PROD_TEST_REAL_LN="$PROD_REAL_LN" \
      sh ./scripts/prod-deploy.sh --skip-backup "$@" > prod.out 2> prod.err
  )
}

assert_prod_private() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      printf 'Windows filesystem modes are not POSIX proof; skipping only the .env mode assertion. Linux validation is required.\n'
      ;;
    *)
      if [ "$(stat -c '%a' "$PROD_ROOT/.env")" != 600 ]; then
        printf 'Expected the production environment file to have mode 600.\n' >&2
        exit 1
      fi
      ;;
  esac
}

assert_prod_no_secret_or_temps() {
  if grep -F "$PROD_SECRET" "$PROD_ROOT/prod.out" "$PROD_ROOT/prod.err" >/dev/null 2>&1; then
    printf 'A synthetic environment secret appeared in public command output.\n' >&2
    exit 1
  fi
  if find "$PROD_ROOT" -maxdepth 1 -name '.env.tmp.*' -print | grep . >/dev/null 2>&1; then
    printf 'Production environment temporary files were not cleaned.\n' >&2
    exit 1
  fi
}

assert_prod_key() {
  if ! grep -Fx "$1=$2" "$PROD_ROOT/.env" >/dev/null 2>&1; then
    printf 'Expected production environment key %s to retain its exact synthetic value.\n' "$1" >&2
    exit 1
  fi
}

prod_make_symlink() {
  if ln -s "$1" "$2" 2>/dev/null && [ -L "$2" ]; then return 0; fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      printf 'Windows symbolic links are unavailable; this link case requires independent Linux validation.\n'
      return 1
      ;;
    *) printf 'A Linux symbolic-link fixture could not be created.\n' >&2; exit 1 ;;
  esac
}

test_prod_env_new_and_rewrite_are_private() {
  prod_env_setup private
  run_prod_env https://ops-probe.invalid
  assert_prod_private
  assert_prod_key SESSION_SECRET "$PROD_SECRET"
  assert_prod_key PROVIDER_CONFIG_SECRET "$PROD_SECRET"
  assert_contains "$PROD_CALLS" 'stack preflight'
  assert_contains "$PROD_CALLS" 'stack release'
  assert_prod_no_secret_or_temps
  chmod 600 "$PROD_ROOT/.env"
  # Also cover sed replacement metacharacters without printing the env values.
  PROD_ORIGIN='https://ops-probe.invalid/a|b&c\d'
  run_prod_env "$PROD_ORIGIN"
  assert_prod_private
  assert_prod_key WEB_ORIGIN "$PROD_ORIGIN"
  assert_prod_key SESSION_SECRET "$PROD_SECRET"
  assert_prod_no_secret_or_temps
}

test_prod_env_fixed_temp_collisions_are_untouched() {
  for prod_kind in regular symlink; do
    prod_env_setup "collision-$prod_kind"
    cp "$PROD_ROOT/.env.example" "$PROD_ROOT/.env"
    chmod 600 "$PROD_ROOT/.env"
    printf 'OWNED_COLLISION_SENTINEL\n' > "$PROD_ROOT/sentinel"
    prod_before="$(cksum "$PROD_ROOT/sentinel")"
    if [ "$prod_kind" = regular ]; then
      cp "$PROD_ROOT/sentinel" "$PROD_ROOT/.env.tmp"
      prod_tmp_before="$(cksum "$PROD_ROOT/.env.tmp")"
    elif ! prod_make_symlink "$PROD_ROOT/sentinel" "$PROD_ROOT/.env.tmp"; then
      continue
    fi
    run_prod_env https://ops-probe.invalid
    assert_prod_private
    if [ "$(cksum "$PROD_ROOT/sentinel")" != "$prod_before" ]; then
      printf 'A production env temporary symlink corrupted the owned sentinel.\n' >&2; exit 1
    fi
    if [ "$prod_kind" = regular ]; then
      if [ ! -f "$PROD_ROOT/.env.tmp" ] || [ "$(cksum "$PROD_ROOT/.env.tmp")" != "$prod_tmp_before" ]; then
        printf 'An existing fixed temporary file was replaced.\n' >&2; exit 1
      fi
    elif [ ! -L "$PROD_ROOT/.env.tmp" ]; then
      printf 'An existing temporary symlink was replaced.\n' >&2; exit 1
    fi
    assert_prod_no_secret_or_temps
  done
}

test_prod_env_rejects_links_and_nonregular_paths() {
  prod_env_setup main-link
  cp "$PROD_ROOT/.env.example" "$PROD_ROOT/sentinel"
  prod_before="$(cksum "$PROD_ROOT/sentinel")"
  if prod_make_symlink "$PROD_ROOT/sentinel" "$PROD_ROOT/.env"; then
    if run_prod_env https://ops-probe.invalid; then printf 'Expected a main env symlink to be refused.\n' >&2; exit 1; fi
    assert_contains "$PROD_ROOT/prod.err" 'must not be a symbolic link'
    [ "$(cksum "$PROD_ROOT/sentinel")" = "$prod_before" ] || exit 1
    assert_not_contains "$PROD_CALLS" 'stack release'
    assert_prod_no_secret_or_temps
  fi
  prod_env_setup main-directory
  mkdir "$PROD_ROOT/.env"
  if run_prod_env https://ops-probe.invalid; then printf 'Expected a nonregular env path to be refused.\n' >&2; exit 1; fi
  assert_contains "$PROD_ROOT/prod.err" 'must be a regular file'
  assert_not_contains "$PROD_CALLS" 'stack release'
  assert_prod_no_secret_or_temps
}

test_prod_env_failed_update_preserves_original() {
  prod_env_setup failed-update
  cp "$PROD_ROOT/.env.example" "$PROD_ROOT/.env"
  chmod 600 "$PROD_ROOT/.env"
  prod_before="$(cksum "$PROD_ROOT/.env")"
  if (UNFREQ_PROD_TEST_FAIL_MV=true; export UNFREQ_PROD_TEST_FAIL_MV; run_prod_env https://ops-probe.invalid); then
    printf 'Expected the mocked atomic update failure to propagate.\n' >&2; exit 1
  fi
  if [ "$(cksum "$PROD_ROOT/.env")" != "$prod_before" ]; then
    printf 'A failed environment update modified the existing configuration.\n' >&2; exit 1
  fi
  assert_prod_private
  assert_not_contains "$PROD_CALLS" 'stack release'
  assert_prod_no_secret_or_temps
}

test_prod_env_first_publish_does_not_clobber_race() {
  prod_env_setup publish-race
  if (UNFREQ_PROD_TEST_PUBLISH_RACE=true; export UNFREQ_PROD_TEST_PUBLISH_RACE; run_prod_env https://ops-probe.invalid); then
    printf 'Expected a competing env creation to stop first publication.\n' >&2; exit 1
  fi
  if [ "$(cat "$PROD_ROOT/.env")" != OWNED_PUBLISH_RACE_SENTINEL ]; then
    printf 'First environment publication replaced a competing owned file.\n' >&2; exit 1
  fi
  assert_not_contains "$PROD_CALLS" 'stack release'
  assert_prod_no_secret_or_temps
}


copy_fixture_files
write_stub_commands

run_case "deployment shell syntax" test_shell_syntax
run_case "deployment preflight success" test_preflight_passes_with_valid_env
run_case "deployment preflight placeholder rejection" test_preflight_rejects_placeholder_env
run_case "deployment preflight unsafe authentication and absent policy rejection" test_preflight_rejects_unsafe_auth_and_missing_policy
run_case "deployment config env fallback" test_config_uses_example_env_when_env_is_missing
run_case "deployment smoke command wiring" test_smoke_checks_expected_urls_and_services

run_case "production env private create and rewrite" test_prod_env_new_and_rewrite_are_private
run_case "production env predictable temp collisions" test_prod_env_fixed_temp_collisions_are_untouched
run_case "production env symlink and nonregular rejection" test_prod_env_rejects_links_and_nonregular_paths
run_case "production env atomic update failure cleanup" test_prod_env_failed_update_preserves_original
run_case "production env first publication no-clobber" test_prod_env_first_publish_does_not_clobber_race

printf 'Deployment script regression tests passed.\n'
