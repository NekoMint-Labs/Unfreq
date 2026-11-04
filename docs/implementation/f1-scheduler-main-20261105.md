# F1: durable scheduler extraction on current main

The legacy process-local timer is replaced by a database-owned daily batch. `AI_SIGNAL_SCHEDULER_ENABLED=false` remains the default. This change does not publish system-generated samples: the existing C1 confirmation policy still hides unowned AI and seed records.

## Execution and failure boundaries

- Migration 0025 adds a unique `(job_key, business_date)` claim and unique owner token. The business date and due time use the configured IANA zone, including DST. There is no missed-day catch-up.
- Each real chat, embedding and reranker dispatch reserves a durable allowance before HTTP. Signal count and dispatch limits are bounded independently; these do not estimate currency cost.
- RUNNING, FAILED and CANCELLED claims never automatically replay, including after process death. This favors avoiding duplicate paid work over automatically filling a missing batch. Partial writes may exist if a process dies between a signal insert and progress recording; investigate the ledger and DB before any manual decision.
- Ownership/deadline checks fence subsequent dispatch and stage writes. The daily unique claim is not a transaction spanning an external provider; no exactly-once external execution claim is made.
- Shutdown cancels active HTTP and drains work before pools close. The scheduler has a separate bounded PostgreSQL pool; forced socket shutdown and process-fatal escalation handle I/O that ignores cancellation. The global watchdog includes the enabled scheduler's grace allowance.

## Validation and rollout

Unit tests cover calendar boundaries, competing claims, restart non-replay, budgets, deadlines, cancellation, ownership loss and shutdown escalation. Seven managed integration cases spawn real Node processes against fresh owned PostgreSQL databases and a loopback synthetic HTTP provider. They cover concurrent PIDs, next-day work, crash restart, app.close, SQL failure, dispatch exhaustion and repository fences. No credentials or production data are used.

The migration/image checks retain all historical SQL and journal pins, then pin the exact new append. API and database migration must be deployed together before an operator enables the scheduler. Keep the flag false until the exact-head integration checks pass. Roll back by disabling the flag and draining the process; leave the additive ledger in place. Do not drop or retry historical claims automatically.
