# Stage 9 Runtime Rehearsal Evidence - 2026-06-25

## Scope

Gate: `runtime-rehearsal-coverage`

Engineering-owned rehearsal scope from `docs/STAGE9_PREPILOT_VERIFICATION.md`:

- Runtime connectivity for PostgreSQL, Redis, API, and worker.
- Backup restore rehearsal.
- Migration rollback/redeploy rehearsal.
- Redis/BullMQ degradation and worker recovery behavior.
- Grey release compatibility signals for API/worker state handling.
- Vendor downgrade/fail-closed behavior that can be proven in repo tests.

## Environment

- Worktree: `auction-app-betterway-worktrees/stage9`
- Branch: `feature/stage9-prepilot-verification`
- Docker engine: Docker Desktop via Windows `docker.exe`
- Running Docker services observed:
  - `stage9-postgres-1`: `postgres:16-alpine`, healthy, `0.0.0.0:5432->5432/tcp`
  - `stage9-redis-1`: `redis:7-alpine`, healthy, `0.0.0.0:6379->6379/tcp`
- Local WSL `/usr/bin/docker` socket was not usable in this session; Docker operations used Docker Desktop Windows CLI.

## Passed Evidence

### Runtime Build

Command:

```bash
npm run build:runtime
```

Result: passed.

Evidence: API and worker TypeScript build completed successfully.

### Runtime Database Migration

Command:

```bash
npm run db:deploy
```

Result: passed.

Evidence: all 17 migrations applied successfully to Docker Postgres `auction_app.public`.

### Backup Restore

Command:

```bash
PATH=/tmp/stage9-runtime-bin:$PATH node scripts/stage1/rehearse-backup-restore.mjs
```

Result: passed.

Evidence: the script dumped `auction_app`, restored it into `auction_app_restore_check`, compared `AuctionCommunity` source/restored counts, dropped the restore database, and printed `stage1 backup restore rehearsal passed`.

### Migration Rollback / Redeploy

Command:

```bash
PATH=/tmp/stage9-runtime-bin:$PATH node scripts/stage1/rehearse-migration.mjs
```

Result: passed.

Evidence: the script created `auction_app_migration_rehearsal`, deployed the baseline 16 migrations, captured a rollback snapshot, deployed the current 17th migration, verified `prisma migrate status`, restored from snapshot, redeployed the current migration again, and printed `stage1 migration rehearsal passed`.

### Key Rotation Configuration

Command:

```bash
node scripts/stage1/rehearse-key-rotation.mjs
```

Result: passed.

Evidence: `.env.example` contains current/next pairs for object storage, subscription message, and log export signing keys.

### Log Redaction Scan

Command:

```bash
node scripts/stage1/scan-logs.mjs
```

Result: passed.

Evidence: compiled API and worker logging surfaces passed the Stage 1 log scan.

### Ledger Recovery Evidence

Command:

```bash
npm run stage9:ledger
```

Result: passed.

Evidence: ledger check and transaction ledger flows passed in isolated Stage 9 schemas. `stage4:ledger-check` reported `status: "passed"` with `ledgerDiffCount: 0`, `negativeReplayCount: 0`, and `orphanLedgerCount: 0`.

### Outbox / Worker Recovery Evidence

Command:

```bash
npm run stage9:outbox-worker
```

Result: passed.

Evidence: 7 worker/API test files passed, covering outbox leases, expired processing recovery, notification retry, realtime hint failure isolation, settlement idempotency, transaction timeout idempotency, periodic task error logging, and notification API isolation.

### File / Search / Notification Runtime Evidence

Command:

```bash
npm run stage9:file-search-notification
```

Result: passed.

Evidence: 6 test files passed, covering private object grants, realtime permission, stale search source-of-truth checks, notification refresh semantics, notification sender failure handling, and realtime hint publication.

### Privacy / Vendor Fail-Closed Evidence

Command:

```bash
npm run stage9:privacy-content
```

Result: passed.

Evidence: content provider/upload contracts and Stage 3 content review integration passed, covering provider failure fail-closed behavior and unsafe content/media blocking.

## Blocked Evidence

### API / Worker Docker Runtime Connectivity

Attempted command:

```bash
docker.exe compose --env-file /tmp/stage9-runtime-rehearsal.env -f docker-compose.yml -f docker-compose.runtime.yml up -d --force-recreate api worker
```

Result: blocked.

Failure observed on repeated attempts:

```text
node:24-bookworm Pulling
failed to copy: httpReadSeeker: failed open: failed to do request ... production.cloudfront.docker.com ... EOF
```

Direct pull also failed:

```bash
docker.exe pull node:24-bookworm
```

Result: same registry EOF while fetching the image blob.

Impact:

- PostgreSQL and Redis Docker services are running and healthy.
- API and worker containers could not be started because the required base image is not cached locally and Docker registry download failed.
- Therefore `scripts/stage1/check-connectivity.mjs` cannot be counted as passed for this rehearsal, because it requires live API health and worker heartbeat.

## Current Conclusion

`runtime-rehearsal-coverage` is not ready to mark as passed.

Passed evidence is sufficient for database backup restore, migration rollback/redeploy, key rotation configuration, log scan, ledger recovery checks, outbox/worker service-level recovery, file/search/notification behavior, and vendor fail-closed behavior in repo tests.

Remaining blocker is external Docker image availability for API/worker runtime connectivity. Once `node:24-bookworm` can be pulled or is available in the local Docker cache, rerun:

```bash
docker.exe compose --env-file /tmp/stage9-runtime-rehearsal.env -f docker-compose.yml -f docker-compose.runtime.yml up -d --force-recreate api worker
node scripts/stage1/check-connectivity.mjs
```

Only after that passes should `runtime-rehearsal-coverage` be moved out of `manual_gate` or marked as fully evidenced.
