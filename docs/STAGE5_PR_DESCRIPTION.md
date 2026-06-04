# Stage 5 PR Description

## Summary

Stage 5 implements the auction-core loop for the points auction app: auction session creation, bidding with current-highest point holds, current-highest bid withdrawal, auction settlement, guardian confirmation, delivery confirmation, admin dispute resolution, transaction timeout handling, outbox dispatch, and a read-only points operations dashboard.

## Scope

- Auction sessions can be created only for eligible listed items by scoped activity admins or platform admins.
- Bidding enforces child participation, community membership, guardian controls, same-family/self-bid blocks, min increment, point availability, idempotency, and immutable ledger entries for holds/releases.
- Current highest bid withdrawal is limited to the 1-minute window and does not reactivate historical outbid bids.
- Settlement worker creates pending guardian-confirm transactions for won auctions or marks auctions unsold.
- Transaction decisions keep points frozen until allowed release or transfer paths.
- Transaction timeout worker cancels guardian-confirm timeouts and escalates delivery-confirm timeouts to platform review.
- Admin dispute resolution supports `release_to_buyer`, `transfer_to_seller`, and `keep_frozen_for_platform_review`.
- Outbox dispatcher leases due events, schedules settlement jobs, sends notifications, and retries failed events.
- Points operations dashboard exposes a platform-admin read-only view over balances, holds, review queues, outbox exceptions, recent ledger entries, and ledger health.

## Verification

Primary gate:

```bash
npm run stage5:verify
```

Latest local run passed and included:

- Stage 5 schema/API/controller/runtime tests: 31 tests
- point-ledger/dashboard tests: 7 tests
- dedicated points-schema ledger replay: `ledgerDiffCount=0`, `negativeReplayCount=0`, `orphanLedgerCount=0`
- bidding integration tests: 28 tests
- worker tests: 20 tests
- `npm run typecheck`
- workspace build

Additional targeted checks run during final review:

```bash
npm test -- apps/worker/test/periodic-task.test.ts apps/worker/test/worker-config.test.ts apps/api/test/runtime/stage5-scripts.test.ts
env DATABASE_URL="postgresql://auction_app:auction_app@localhost:5432/auction_app?schema=stage5_verify_worker" npm test -- apps/worker/test/outbox-dispatcher.test.ts apps/worker/test/auction-settlement-worker.test.ts apps/worker/test/transaction-timeout-worker.test.ts
npm run typecheck
```

## Review Notes

- The final review found and fixed one release-readiness issue: periodic worker loops now catch rejected background tasks through `runPeriodicTask` and log redacted errors instead of leaving unhandled promise rejections.
- No generated `dist` assets are included in the Stage 5 diff.
- The branch still contains earlier stage work relative to `origin/main`; if the intended PR is Stage 5 only, use `39812b2..HEAD` as the Stage 5 review range.

## Rollback

- Database changes are contained in the Stage 5 migration `20260603000000_stage5_auction_core`.
- Runtime workers are controlled through `npm run start:worker` / runtime compose; worker behavior can be rolled back by redeploying the previous image/commit.
- Outbox and ledger entries are append-only; do not delete or rewrite them during rollback. Use compensating business commands for any production correction.

## Known Follow-Ups

- Real WeChat notifications, object storage providers, content safety providers, and production alerting remain outside Stage 5.
- High-risk admin operation previews and two-person release workflows remain future governance work.
- Legal review for children information protection is still required before public rollout.
