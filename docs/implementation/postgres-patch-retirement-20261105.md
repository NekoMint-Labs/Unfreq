# PostgreSQL v4 patch retirement assessment

Issue #7's original 3.4.9 pin and four-file patch were already replaced by the v4 upgrade on current main. The remaining patch is a two-file lifecycle supplement for 4.0.0; removing it requires new behavioral evidence, not renaming the old issue or deleting the installer.

## Reproducible read-only probe

Run `node tests/integration/postgres-retirement-probe.mjs`. It reads official npm metadata, verifies the exact registry tarball against the committed SHA-512 integrity, verifies both original and patched source hashes, and extracts the official package into a newly owned temporary directory. It never edits node_modules or connects to a real database. No install scripts are executed from the archive.

A local TCP server injects startup FIN, type-load FIN and type-load hang. The type-load modes send a minimal synthetic PostgreSQL handshake and confirm the actual pg_catalog.pg_type request before injecting the fault. Each mode submits five operations to two slots: two queries, reserve/release, begin and a Drizzle transaction. The unchanged observation budget is 1800 ms with connect_timeout=1. After that observation, cleanup force-closes owned work; cleanup never counts as natural settlement. This is a focused negative prerequisite check, not the real-PostgreSQL recovery suite.

On 2026-11-05 (Asia/Shanghai), official npm latest was 4.0.0. The local full three-mode run observed 0/5 official operations naturally settled in each mode, while the patched control rejected all 5/5 within budget in every mode. An earlier startup-only run did settle within budget, so startup FIN alone is not a stable discriminator. The type-load FIN and hang failures independently prevent retirement. Official type-load FIN also repeatedly reopened connections during the bounded observation. All temporary resources were cleaned.

The report is written to test-results/postgres-retirement.json. The Node 20.19.0 and 22.12.0 workflow jobs repeat the official/package control and preserve their reports. A new registry release is recorded as a separate flag; it is not automatically installed or patched.

## Decision

Keep the 4.0.0 patch, metadata, postinstall and Dockerfile inputs. Keep #7 open for remaining retirement work. The old version-specific part is complete; unpatched behavior is not accepted. Even if this synthetic probe passes in the future, retirement still requires all existing real PostgreSQL/Redis FIN, RST, type loading, recovery, sent-work non-replay, application-write, API, clean-install and Docker gates, plus a grouped rollback check. No production migration or historical-data operation is performed here.
