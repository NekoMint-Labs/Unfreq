#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
STUB_BIN="$TMP_DIR/bin"
CALL_LOG="$TMP_DIR/calls.log"
REAL_GZIP="$(command -v gzip)"

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
  case " $* " in
    *' pg_dump '*)
      if [ "${UNFREQ_TEST_DUMP_FAILURE:-false}" = true ]; then
        printf 'synthetic partial dump\n'
        printf 'SYNTHETIC_PRIVATE_ERROR\n' >&2
        exit 7
      fi
      printf '%s\n' 'CREATE TABLE synthetic_backup (id integer);' 'INSERT INTO synthetic_backup VALUES (1);'
      ;;
    *' psql '*)
      cat > "$UNFREQ_TEST_RESTORE_SQL"
      if [ "${UNFREQ_TEST_RESTORE_FAILURE:-false}" = true ]; then
        printf 'SYNTHETIC_PRIVATE_SQL_ERROR\n' >&2
        exit 9
      fi
      ;;
  esac
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

  cat > "$STUB_BIN/gzip" <<'EOF'
#!/bin/sh
set -eu
if [ "${UNFREQ_TEST_GZIP_FAILURE:-false}" = true ] && [ "${1:-}" = '-c' ]; then
  printf 'synthetic incomplete compression'
  exit 8
fi
exec "$UNFREQ_TEST_REAL_GZIP" "$@"
EOF

  chmod +x "$STUB_BIN/docker" "$STUB_BIN/curl" "$STUB_BIN/gzip"
}

assert_contains() {
  file="$1"
  expected="$2"

  if ! grep -F "$expected" "$file" >/dev/null 2>&1; then
    printf 'Expected to find "%s" in %s\n' "$expected" "$file" >&2
    printf '%s\n' "--- $file ---" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  file="$1"
  unexpected="$2"

  if grep -F "$unexpected" "$file" >/dev/null 2>&1; then
    printf 'Did not expect to find "%s" in %s\n' "$unexpected" "$file" >&2
    printf '%s\n' "--- $file ---" >&2
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
  sh -n "$ROOT_DIR/tests/integration/f2-linux-backup-permissions.sh"
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

run_backup_fixture() {
  (
    cd "$TMP_DIR"
    PATH="$STUB_BIN:$PATH" \
      UNFREQ_TEST_CALL_LOG="$CALL_LOG" \
      UNFREQ_TEST_REAL_GZIP="$REAL_GZIP" \
      UNFREQ_TEST_RESTORE_SQL="$TMP_DIR/restored.sql" \
      UNFREQ_BACKUP_FILE="$1" \
      ./scripts/deployment-stack.sh server "$2" > "$TMP_DIR/backup.out" 2> "$TMP_DIR/backup.err"
  )
}

assert_no_backup_temps() {
  if find "$TMP_DIR/backups" -name '.unfreq-backup.*' -print | grep . >/dev/null 2>&1; then
    printf 'Backup temporary files were not cleaned.\n' >&2
    exit 1
  fi
  if [ -d "$TMP_DIR/restore-tmp" ] && find "$TMP_DIR/restore-tmp" -mindepth 1 -print | grep . >/dev/null 2>&1; then
    printf 'Restore temporary files were not cleaned.\n' >&2
    exit 1
  fi
}

test_backup_is_private_complete_and_no_clobber() {
  write_valid_env
  : > "$CALL_LOG"
  mkdir -p "$TMP_DIR/backups"
  # Git Bash's noacl mounts synthesize stat modes from the observing process's
  # umask. Do not turn that into either a false failure or false permission proof.
  permission_probe="$TMP_DIR/permission-probe"
  (umask 077; : > "$permission_probe"; chmod 600 "$permission_probe")
  restrictive_mode="$(umask 077; stat -c '%a' "$permission_probe")"
  ordinary_mode="$(umask 022; stat -c '%a' "$permission_probe")"
  verify_permissions=true
  if [ "$restrictive_mode" != "$ordinary_mode" ]; then
    verify_permissions=false
    printf 'POSIX mode enforcement cannot be verified on this filesystem; Linux permission validation is required.\n'
  fi
  rm -f "$permission_probe"
  for suffix in sql sql.gz; do
    output="$TMP_DIR/backups/complete.$suffix"
    run_backup_fixture "$output" backup
    if [ ! -s "$output" ] || { [ "$verify_permissions" = true ] && [ "$(stat -c '%a' "$output")" != 600 ]; }; then
      printf 'Expected a complete private backup; actual mode/size: ' >&2
      stat -c '%a %s' "$output" >&2
      exit 1
    fi
    case "$suffix" in
      sql.gz) gzip -dc "$output" > "$TMP_DIR/verified.sql" ;;
      *) cp "$output" "$TMP_DIR/verified.sql" ;;
    esac
    assert_contains "$TMP_DIR/verified.sql" 'INSERT INTO synthetic_backup VALUES (1);'
    before="$(cksum "$output")"
    if run_backup_fixture "$output" backup; then
      printf 'Expected existing backup overwrite to be rejected.\n' >&2
      exit 1
    fi
    if [ "$(cksum "$output")" != "$before" ]; then
      printf 'An existing backup changed.\n' >&2
      exit 1
    fi
    assert_contains "$TMP_DIR/backup.err" 'Refusing to overwrite'
  done
  assert_contains "$CALL_LOG" 'pg_dump -U postgres -d unfreq'
  assert_no_backup_temps
}

test_backup_failure_does_not_publish_partial_or_errors() {
  write_valid_env
  for failure in dump gzip; do
    output="$TMP_DIR/backups/failed-$failure.sql.gz"
    if (
      case "$failure" in
        dump) UNFREQ_TEST_DUMP_FAILURE=true; export UNFREQ_TEST_DUMP_FAILURE ;;
        gzip) UNFREQ_TEST_GZIP_FAILURE=true; export UNFREQ_TEST_GZIP_FAILURE ;;
      esac
      run_backup_fixture "$output" backup
    ); then
      printf 'Expected failed backup to be rejected.\n' >&2
      exit 1
    fi
    if [ -e "$output" ]; then
      printf 'Failed backup published a partial file.\n' >&2
      exit 1
    fi
    assert_not_contains "$TMP_DIR/backup.err" SYNTHETIC_PRIVATE_ERROR
    assert_no_backup_temps
  done
}

test_restore_requires_isolation_and_valid_archive() {
  write_valid_env
  : > "$CALL_LOG"
  if run_backup_fixture "$TMP_DIR/backups/complete.sql.gz" restore; then
    printf 'Expected restore without isolation declaration to fail.\n' >&2
    exit 1
  fi
  assert_contains "$TMP_DIR/backup.err" 'UNFREQ_RESTORE_ISOLATED=true'
  assert_not_contains "$CALL_LOG" ' psql '
  printf 'invalid gzip synthetic fixture' > "$TMP_DIR/backups/corrupt.sql.gz"
  mkdir -p "$TMP_DIR/restore-tmp"
  if (
    UNFREQ_RESTORE_ISOLATED=true; export UNFREQ_RESTORE_ISOLATED
    TMPDIR="$TMP_DIR/restore-tmp"; export TMPDIR
    run_backup_fixture "$TMP_DIR/backups/corrupt.sql.gz" restore
  ); then
    printf 'Expected corrupt compressed backup to fail before psql.\n' >&2
    exit 1
  fi
  assert_contains "$TMP_DIR/backup.err" 'invalid compressed backup'
  assert_not_contains "$CALL_LOG" ' psql '
  assert_no_backup_temps
}

test_restore_guard_transaction_and_failure_propagation() {
  write_valid_env
  for suffix in sql sql.gz; do
    : > "$CALL_LOG"
    (
      UNFREQ_RESTORE_ISOLATED=true; export UNFREQ_RESTORE_ISOLATED
      UNFREQ_PG_USER=synthetic_user; export UNFREQ_PG_USER
      UNFREQ_PG_DATABASE=synthetic_restore; export UNFREQ_PG_DATABASE
      TMPDIR="$TMP_DIR/restore-tmp"; export TMPDIR
      run_backup_fixture "$TMP_DIR/backups/complete.$suffix" restore
    )
    assert_contains "$CALL_LOG" 'psql -X -v ON_ERROR_STOP=1 --single-transaction --file=- -U synthetic_user -d synthetic_restore'
    assert_contains "$TMP_DIR/restored.sql" 'UNFREQ_RESTORE_TARGET_NOT_EMPTY'
    assert_contains "$TMP_DIR/restored.sql" 'pg_catalog.pg_namespace'
    assert_contains "$TMP_DIR/restored.sql" 'pg_catalog.pg_class'
    assert_contains "$TMP_DIR/restored.sql" 'pg_catalog.pg_proc'
    assert_contains "$TMP_DIR/restored.sql" 'pg_catalog.pg_type'
    assert_contains "$TMP_DIR/restored.sql" 'pg_catalog.pg_extension'
    assert_contains "$TMP_DIR/restored.sql" 'INSERT INTO synthetic_backup VALUES (1);'
    assert_contains "$TMP_DIR/backup.out" 'PostgreSQL restore completed'
    assert_no_backup_temps
  done
  if (
    UNFREQ_RESTORE_ISOLATED=true; export UNFREQ_RESTORE_ISOLATED
    UNFREQ_TEST_RESTORE_FAILURE=true; export UNFREQ_TEST_RESTORE_FAILURE
    TMPDIR="$TMP_DIR/restore-tmp"; export TMPDIR
    run_backup_fixture "$TMP_DIR/backups/complete.sql.gz" restore
  ); then
    printf 'Expected SQL failure to propagate.\n' >&2
    exit 1
  fi
  assert_not_contains "$TMP_DIR/backup.out" 'restore completed'
  assert_not_contains "$TMP_DIR/backup.err" SYNTHETIC_PRIVATE_SQL_ERROR
  assert_contains "$TMP_DIR/backup.err" 'PostgreSQL restore failed'
  assert_no_backup_temps
}

test_backup_target_identifiers_are_validated() {
  write_valid_env
  for bad in 'bad-name' 'bad;SQL' '9starts_with_number'; do
    : > "$CALL_LOG"
    if (
      UNFREQ_PG_DATABASE="$bad"; export UNFREQ_PG_DATABASE
      run_backup_fixture "$TMP_DIR/backups/rejected.sql" backup
    ); then
      printf 'Expected unsafe SQL identifier to fail.\n' >&2
      exit 1
    fi
    assert_contains "$TMP_DIR/backup.err" 'simple SQL identifiers'
    assert_not_contains "$CALL_LOG" ' pg_dump '
  done
}

copy_fixture_files
write_stub_commands

run_case "deployment shell syntax" test_shell_syntax
run_case "deployment preflight success" test_preflight_passes_with_valid_env
run_case "deployment preflight placeholder rejection" test_preflight_rejects_placeholder_env
run_case "deployment preflight unsafe authentication and absent policy rejection" test_preflight_rejects_unsafe_auth_and_missing_policy
run_case "deployment config env fallback" test_config_uses_example_env_when_env_is_missing
run_case "deployment smoke command wiring" test_smoke_checks_expected_urls_and_services
run_case "backup private bytes and no overwrite" test_backup_is_private_complete_and_no_clobber
run_case "backup dump/compression failure cleanup" test_backup_failure_does_not_publish_partial_or_errors
run_case "restore isolation and gzip validation" test_restore_requires_isolation_and_valid_archive
run_case "restore empty-target guard, transaction and SQL failure" test_restore_guard_transaction_and_failure_propagation
run_case "backup target identifier rejection" test_backup_target_identifiers_are_validated

printf 'Deployment script regression tests passed.\n'
