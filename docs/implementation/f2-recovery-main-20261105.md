# F2: isolated checkpoint recovery on current C1

A truncated dump or failed decompression must not appear to be a successful backup/restore. Backup now writes private temporary files and publishes complete bytes atomically without replacing an existing destination. Restore requires an explicit isolated-target declaration, validates the full archive before psql, checks an empty target inside the restore transaction, and fails on SQL errors with rollback. Arbitrary SQL error text is kept out of terminal output. Historical data is never deleted by these commands.

## Managed drill

The integration runner creates two new databases with random names under its owned local Docker project. It refuses existing targets and verifies the synthetic database owner. It uses the real backup/restore scripts, a confirmed C1 public snapshot, a withdrawn record, a pgvector embedding, password login, encrypted synthetic provider configuration and fixture audio/image bytes. HTTP dispatch is blocked throughout restored API verification.

The drill checks: no overwrite; truncated gzip causes no writes; partial SQL rolls back; custom schemas and nonempty targets are rejected; SQL/media/config bytes recover; pgvector works; restored passwords and provider ciphertext decrypt; owner history remains private; public reads use the whitelist; media serves correct bytes. A Linux-container probe validates actual 0700 temporary directories and 0600 files. Git Bash mode output alone is not permission evidence.

After the checkpoint the source receives one new row and one withdrawal. The stale checkpoint lacks the new row and still has the old published status. Before the restored API is opened, the drill explicitly replays a separately captured authoritative synthetic withdrawal. A backup cannot reconstruct later withdrawal/deletion decisions by itself. Production cutover requires an authoritative newer visibility/deletion source and operator isolation; the environment flag is a declaration, not proof of network isolation.

Elapsed SQL restore and drill times are recorded for this local synthetic checkpoint only. They are not production RTO/RPO guarantees. Configuration/media copies are deliberately manual documented tar/copy steps, not a new production backup product. Restore only trusted owned dumps into a fresh isolated target. Existing deployment defaults, production data and retention policies are unchanged.

This PR is based on #22 so restored public reads cannot trigger paid matching. It does not depend on the scheduler migration. CI must validate the exact head before acceptance.
