# Stage 9 Runtime Rehearsal Evidence - 2026-06-25

## Scope

Gate: `runtime-rehearsal-coverage`

Engineering-owned rehearsal scope from `docs/STAGE9_PREPILOT_VERIFICATION.md`:

- Runtime connectivity for PostgreSQL, Redis, API, and worker.
- Backup restore rehearsal.
- Migration rollback/redeploy rehearsal.
- Redis/BullMQ degradation and worker recovery behavior.
- Grey release compatibility signals for API/worker state handling.
- Candidate image runtime signal for API/worker image packaging without bind mounts.
- Vendor downgrade/fail-closed behavior that can be proven in repo tests.

## Environment

- Worktree: `auction-app-betterway-worktrees/stage9`
- Branch: `feature/stage9-prepilot-verification`
- Docker engine: Docker Desktop via Windows `docker.exe`
- Running Docker services observed:
  - `stage9-postgres-1`: `postgres:16-alpine`, healthy, `0.0.0.0:5432->5432/tcp`
  - `stage9-redis-1`: `redis:7-alpine`, healthy, `0.0.0.0:6379->6379/tcp`
  - `stage9-api-1`: `node:24-bullseye-slim`, `0.0.0.0:3000->3000/tcp`
  - `stage9-worker-1`: `node:24-bullseye-slim`
- Local WSL `/usr/bin/docker` socket was not usable in this session; Docker operations used Docker Desktop Windows CLI.
- `node:24-bookworm` repeatedly failed to pull from Docker registry with EOF, so the runtime image was changed to `node:24-bullseye-slim`.
- `node:24-bookworm-slim` started but did not include OpenSSL/libssl, which made Prisma select an unavailable runtime target.
- `node:24-bullseye-slim` includes `libssl.so.1.1`; the rehearsal runner prepares Prisma's `debian-openssl-1.1.x` query engine before starting API/worker.

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

### API / Worker Runtime Connectivity

Command:

```bash
node scripts/stage1/check-connectivity.mjs
```

Result: passed.

Evidence: API health returned `ok` at `http://localhost:3000/health`, PostgreSQL and Redis readiness were healthy, and worker heartbeat for `auction-worker-runtime` was fresh.

### Grey Release Compatibility Smoke

Command:

```bash
npm run stage9:grey-release
```

Result: passed.

Evidence: the rehearsal built API/worker, started Docker PostgreSQL/Redis/API/worker, verified initial runtime connectivity, recreated API with `--no-deps --force-recreate`, verified connectivity again, recreated worker with `--no-deps --force-recreate`, verified connectivity again, then reran migration rollback/replay rehearsal. This is local runtime compatibility smoke; it does not replace immutable image verification, real traffic splitting, production rollback, or provider-console downgrade review.

### Candidate Image Runtime Smoke

Command:

```bash
npm run stage9:candidate-image
```

Result: passed.

Evidence: the rehearsal generated Prisma client, prepared the Docker runtime Prisma query engine, built API/worker, built the local `auction-app-betterway:stage9-candidate` image from `Dockerfile.candidate`, started API and worker through `docker-compose.candidate.yml` without workspace bind mounts, verified both containers were running the newly built image id, checked runtime connectivity, then recreated API and worker independently with `--no-deps --force-recreate` and repeated connectivity checks. All three connectivity checks passed with API health `ok`, PostgreSQL and Redis ready, and fresh `auction-worker-runtime` heartbeat. This is local candidate image smoke; it does not replace registry publish, production orchestrator rollout, real traffic splitting, or production rollback rehearsal.

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

## Resolved Blocker

### API / Worker Docker Runtime Connectivity

Attempted command:

```bash
docker.exe compose --env-file /tmp/stage9-runtime-rehearsal.env -f docker-compose.yml -f docker-compose.runtime.yml up -d --force-recreate api worker
```

Initial result: blocked.

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

- PostgreSQL and Redis Docker services were running and healthy.
- API and worker containers initially could not start because the required base image was not cached locally and Docker registry download failed.

Resolution:

- Switched runtime API/worker image to `node:24-bullseye-slim`.
- Added Prisma runtime engine preparation for `debian-openssl-1.1.x`.
- Recreated API and worker containers successfully.
- Reran `scripts/stage1/check-connectivity.mjs` successfully.

## Current Conclusion

`runtime-rehearsal-coverage` has executable engineering evidence and can be run through:

```bash
npm run stage9:runtime-rehearsal
```

This evidence covers runtime connectivity, backup restore, migration rollback/redeploy, key rotation configuration, log scan, ledger recovery checks, outbox/worker service-level recovery, file/search/notification behavior, and vendor fail-closed behavior in repo tests. It does not replace `vendor-production-config`, which still requires real provider-console configuration evidence.

`grey-release-compatibility` also has executable engineering evidence through:

```bash
npm run stage9:grey-release
```

This evidence covers local API and worker rolling recreate compatibility on the same Docker PostgreSQL/Redis runtime plus migration rollback/replay. It does not replace immutable candidate image validation, real traffic splitting, or production rollback rehearsal.

`candidate-image-runtime` also has executable engineering evidence through:

```bash
npm run stage9:candidate-image
```

This evidence covers local candidate API/worker image packaging without workspace bind mounts, candidate image identity checks, and independent API/worker recreate compatibility. It does not replace registry publish, production orchestrator rollout, real traffic splitting, or production rollback rehearsal.
