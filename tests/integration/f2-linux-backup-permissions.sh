#!/bin/sh
# Run only inside this test run's newly-created PostgreSQL container. stdin is
# the current deployment-stack.sh source, not SQL or an existing database URL.
set -eu

fail() {
  printf 'F2 Linux backup permission fixture failed.\n' >&2
  exit 1
}

[ "$#" -eq 2 ] || fail
database_name="$1"
fixture_nonce="$2"
printf '%s\n' "$database_name" | grep -Eq '^unfreq_integration_f2_[a-z0-9_]{1,40}$' || fail
[ "${#database_name}" -le 63 ] || fail
printf '%s\n' "$fixture_nonce" | grep -Eq '^[a-f0-9]{16,32}$' || fail
umask 077
fixture_root="$(mktemp -d /tmp/unfreq-f2-permissions.XXXXXX)"
case "$fixture_root" in /tmp/unfreq-f2-permissions.??????) ;; *) fail ;; esac
[ ! -L "$fixture_root" ] || fail
[ "$(CDPATH= cd -- "$fixture_root" && pwd -P)" = "$fixture_root" ] || fail
chmod 700 "$fixture_root"
printf '%s\n' "$fixture_nonce" > "$fixture_root/owner"
chmod 600 "$fixture_root/owner"

cleanup() {
  case "$fixture_root" in /tmp/unfreq-f2-permissions.??????) ;; *) return 1 ;; esac
  [ -d "$fixture_root" ] && [ ! -L "$fixture_root" ] || return 1
  [ "$(CDPATH= cd -- "$fixture_root" && pwd -P)" = "$fixture_root" ] || return 1
  [ -f "$fixture_root/owner" ] && [ ! -L "$fixture_root/owner" ] || return 1
  [ "$(cat "$fixture_root/owner")" = "$fixture_nonce" ] || return 1
  # The absolute mktemp target, canonical path and ownership nonce were checked
  # immediately above. Never remove a caller-selected directory or volume.
  rm -rf -- "$fixture_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$fixture_root/bin" "$fixture_root/backups"
chmod 700 "$fixture_root/bin" "$fixture_root/backups"
cat > "$fixture_root/deployment-stack.sh"
[ -s "$fixture_root/deployment-stack.sh" ] || fail
chmod 700 "$fixture_root/deployment-stack.sh"
printf 'UNFREQ_PROXY_NETWORK=synthetic_f2_permissions\n' > "$fixture_root/empty.env"
chmod 600 "$fixture_root/empty.env"

cat > "$fixture_root/bin/docker" <<'WRAPPER'
#!/bin/sh
set -eu
reject() { printf 'F2 permission wrapper rejected an unexpected operation.\n' >&2; exit 1; }
[ "$#" -eq 11 ] || reject
[ "$*" = "compose -f f2-permissions.compose.yaml exec -T postgres pg_dump -U unfreq_test -d $UNFREQ_F2_PERMISSION_DATABASE" ] || reject
case "$UNFREQ_F2_PERMISSION_ROOT" in /tmp/unfreq-f2-permissions.??????) ;; *) reject ;; esac
[ "$PWD" = "$UNFREQ_F2_PERMISSION_ROOT" ] || reject
[ "$(cat "$UNFREQ_F2_PERMISSION_ROOT/owner")" = "$UNFREQ_F2_PERMISSION_NONCE" ] || reject
[ "$(stat -c '%a' "$UNFREQ_F2_PERMISSION_ROOT")" = 700 ] || reject
count=0
for temporary in "$UNFREQ_F2_PERMISSION_ROOT"/backups/.unfreq-backup.*; do
  [ -d "$temporary" ] && [ ! -L "$temporary" ] || reject
  [ "$(stat -c '%a' "$temporary")" = 700 ] || reject
  for filename in dump.sql dump.sql.gz error.log; do
    [ -f "$temporary/$filename" ] && [ ! -L "$temporary/$filename" ] || reject
    [ "$(stat -c '%a' "$temporary/$filename")" = 600 ] || reject
  done
  count=$((count + 1))
done
[ "$count" -eq 1 ] || reject
printf '%s\n' "$UNFREQ_F2_PERMISSION_NONCE" > "$UNFREQ_F2_PERMISSION_ROOT/permission-check.ok"
exec pg_dump -U unfreq_test -d "$UNFREQ_F2_PERMISSION_DATABASE"
WRAPPER
chmod 700 "$fixture_root/bin/docker"

(
  cd "$fixture_root"
  PATH="$fixture_root/bin:$PATH" \
    UNFREQ_API_ENV_FILE="$fixture_root/empty.env" \
    UNFREQ_COMPOSE_FILES='-f f2-permissions.compose.yaml' \
    UNFREQ_PG_USER=unfreq_test \
    UNFREQ_PG_DATABASE="$database_name" \
    UNFREQ_BACKUP_FILE="$fixture_root/backups/synthetic.sql.gz" \
    UNFREQ_F2_PERMISSION_ROOT="$fixture_root" \
    UNFREQ_F2_PERMISSION_DATABASE="$database_name" \
    UNFREQ_F2_PERMISSION_NONCE="$fixture_nonce" \
    sh "$fixture_root/deployment-stack.sh" server backup > /dev/null
)
[ -f "$fixture_root/permission-check.ok" ] || fail
[ "$(cat "$fixture_root/permission-check.ok")" = "$fixture_nonce" ] || fail
[ -s "$fixture_root/backups/synthetic.sql.gz" ] || fail
[ "$(stat -c '%a' "$fixture_root/backups/synthetic.sql.gz")" = 600 ] || fail
gzip -t "$fixture_root/backups/synthetic.sql.gz" || fail
for temporary in "$fixture_root"/backups/.unfreq-backup.*; do
  [ ! -e "$temporary" ] || fail
done
cleanup || fail
[ ! -e "$fixture_root" ] || fail
trap - EXIT INT TERM
printf '{"fixture":"f2-linux-backup-permissions","passed":true,"rootMode":"700","temporaryDirectoryMode":"700","temporaryFileMode":"600","backupMode":"600","cleaned":true}\n'
