# Stage 1 Complete Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `MVP_ROADMAP.md` Stage 1 foundation so later account, content, auction, and governance work rests on runnable API/worker infrastructure, observable logs, private storage grants, admin safety gates, and executable rehearsal scripts.

**Architecture:** Keep the repo as a TypeScript npm workspace. API and worker get real build/start scripts; BullMQ triggers work but never owns business facts; PostgreSQL remains the source of truth. Stage 1 safety infrastructure is implemented as small contract-first services with tests: redacted structured logging, private object storage grants, high-risk admin operation guards, and local rehearsal scripts for migration/restore/key-rotation checks.

**Tech Stack:** Node.js, npm workspaces, TypeScript, NestJS, Prisma, PostgreSQL, Redis, BullMQ, Vitest, Docker Compose.

---

## File Structure

- `apps/api/tsconfig.build.json` - emits API runtime JavaScript to `apps/api/dist`.
- `apps/api/src/runtime/*` - structured logger and redaction helpers.
- `apps/api/src/storage/*` - private object storage grant service.
- `apps/api/src/admin-security/*` - MFA and sensitive operation guard contracts.
- `apps/worker/package.json` - worker workspace package.
- `apps/worker/tsconfig.build.json` - emits worker runtime JavaScript to `apps/worker/dist`.
- `apps/worker/src/*` - BullMQ runtime, queue names, and outbox worker skeleton.
- `apps/worker/test/*` - worker runtime contract tests.
- `scripts/stage1/*.mjs` - local rehearsal scripts for migration replay, backup/restore, key rotation, and connectivity.
- `docker-compose.staging.yml` - staging-like compose overlay for API and worker.
- `package.json` - stage 1 verification scripts.
- `.env.example` and `.env.staging.example` - dev/staging runtime variables.

## Task 1: Runnable API And Worker

**Files:**
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.build.json`
- Create: `apps/worker/src/worker-config.ts`
- Create: `apps/worker/src/queue-names.ts`
- Create: `apps/worker/src/main.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Test: `apps/worker/test/worker-config.test.ts`

- [x] Add build configs that emit `dist/` for API and worker.
- [x] Add worker package with BullMQ and Redis connection config.
- [x] Add `start:api`, `start:worker`, `build:runtime`, and `stage1:verify` root scripts.
- [x] Verify with `npm run build`, `npm run typecheck`, and `npm test`.

## Task 2: BullMQ And Outbox Worker Foundation

**Files:**
- Create: `apps/worker/src/outbox-worker.ts`
- Create: `apps/worker/src/outbox-processor.ts`
- Create: `apps/worker/test/outbox-processor.test.ts`
- Modify: `apps/worker/src/main.ts`

- [x] Define queue names for outbox notifications and scheduled settlement triggers.
- [x] Add an outbox processor that accepts an event payload, returns deterministic processing results, and never mutates business facts directly.
- [x] Add tests proving worker output is derived from outbox payloads and notification failure does not claim business success.
- [x] Verify with `npm test -- apps/worker/test`.

## Task 3: Structured Logging And Redaction

**Files:**
- Create: `apps/api/src/runtime/redaction.ts`
- Create: `apps/api/src/runtime/structured-logger.ts`
- Create: `apps/api/test/runtime/structured-logger.test.ts`

- [x] Add recursive redaction for phone numbers, addresses, storage object keys, signed URLs, courier data, and common secret field names.
- [x] Add structured log records containing timestamp, level, event, request id, actor id, target, and redacted payload.
- [x] Add tests that scan serialized log output and prove sensitive literals are absent.
- [x] Verify with `npm test -- apps/api/test/runtime/structured-logger.test.ts`.

## Task 4: Private Object Storage Grant Service

**Files:**
- Create: `apps/api/src/storage/private-object-storage.service.ts`
- Create: `apps/api/src/storage/storage.module.ts`
- Create: `apps/api/test/contracts/private-object-storage.service.test.ts`
- Modify: `apps/api/src/app.module.ts`

- [x] Add private object storage grants that require owner/user/purpose input and return short-lived grant URLs.
- [x] Ensure grant URLs do not expose raw bucket, object key, or permanent CDN URLs.
- [x] Add tests for TTL, revocation policy version, and hidden object keys.
- [x] Verify with `npm test -- apps/api/test/contracts/private-object-storage.service.test.ts`.

## Task 5: Admin MFA And Sensitive Operation Guard

**Files:**
- Create: `apps/api/src/admin-security/admin-security.service.ts`
- Create: `apps/api/src/admin-security/admin-security.module.ts`
- Create: `apps/api/test/contracts/admin-security.service.test.ts`
- Modify: `apps/api/src/app.module.ts`

- [x] Add a contract service that rejects high-risk admin operations unless MFA is enabled and a recent challenge is verified.
- [x] Add operation classes for export, community pause, forced delist, point adjustment, and auction time adjustment.
- [x] Add tests proving missing MFA and expired challenge fail closed.
- [x] Verify with `npm test -- apps/api/test/contracts/admin-security.service.test.ts`.

## Task 6: Rehearsal Scripts

**Files:**
- Create: `scripts/stage1/check-connectivity.mjs`
- Create: `scripts/stage1/rehearse-migration.mjs`
- Create: `scripts/stage1/rehearse-backup-restore.mjs`
- Create: `scripts/stage1/rehearse-key-rotation.mjs`
- Create: `apps/api/test/runtime/stage1-scripts.test.ts`
- Modify: `package.json`

- [x] Add connectivity checks for Docker, PostgreSQL, Redis, API build output, worker build output, admin skeleton, and miniprogram skeleton.
- [x] Add migration replay script that validates Prisma migration status against the local database.
- [x] Add backup/restore rehearsal that creates a local SQL dump file in `/tmp`, restores it into a temporary database, and compares table counts.
- [x] Add key-rotation rehearsal that verifies staged secret names and detects missing old/new key pairs.
- [x] Verify with `npm test -- apps/api/test/runtime/stage1-scripts.test.ts` and `npm run stage1:rehearse`.

## Task 7: Dev/Staging Stage 1 Gate

**Files:**
- Create: `.env.staging.example`
- Create: `docker-compose.staging.yml`
- Modify: `.env.example`
- Modify: `package.json`

- [x] Add staging-like compose overlay for API and worker using the same PostgreSQL/Redis contracts.
- [x] Add `stage1:verify` that runs tests, typecheck, build, Prisma validate, migration status, and stage 1 script checks.
- [x] Add `stage1:rehearse` that runs connectivity, migration, backup/restore, and key-rotation rehearsal scripts.
- [x] Verify with `npm run stage1:verify`.

## Self-Review

- Stage 1 scope coverage: NestJS skeleton, PostgreSQL schema/migration, Prisma models, key SQL convention, Redis/BullMQ, admin/miniprogram skeleton, environment config, logging, server/database time health, redacted structured logs, private object storage grants, MFA/sensitive operation gates, and rehearsal scripts all map to tasks above.
- Stage 1 acceptance coverage: dev/staging deployable configuration, API/worker/admin/miniprogram connectivity checks, repeatable migrations, adjudicated write response contracts, sensitive log scanning, MFA gating, migration replay, and backup/restore rehearsal all have planned commands.
- Known boundary: this plan completes Stage 1 foundation contracts; it does not complete Stage 2 account governance, Stage 3 content review, or auction business paths.

## Verification Evidence

- `npm test -- apps/api/test/runtime/health.controller.test.ts apps/api/test/runtime/client-connectivity.test.ts apps/api/test/contracts/critical-transaction.test.ts apps/worker/test/worker-heartbeat.test.ts` passed: 4 files, 7 tests.
- `npm run typecheck` passed.
- `npm run build:runtime` passed.
- `npm run stage1:verify` passed: build, staging runtime, Prisma deploy, 15 test files / 35 tests, typecheck, Prisma validate, and connectivity.
- `npm run stage1:rehearse` passed: connectivity, migration rehearsal, backup/restore rehearsal, and key rotation rehearsal.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `git diff --check` passed.
