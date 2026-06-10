## Summary

- Add Stage 7 notification facts, preferences, in-app notification APIs, fake subscription delivery, and miniprogram notification shell.
- Add Stage 7 search/list/favorites with source-of-truth visibility checks, typed notification actions, and miniprogram search/favorite shell.
- Add Stage 7 realtime refresh hints over authenticated WebSocket rooms, Redis outbox publication, permission revocation, stale/duplicate suppression, and miniprogram REST compensation shell.

## Safety Boundaries

- Notifications, search index rows, favorites, and realtime hints do not adjudicate auction, transaction, delivery, or points facts.
- Search/list/favorites re-check PostgreSQL source state before returning indexed candidates.
- Realtime frames only set `refreshRequired` or red-dot state; clients must refresh via REST after reconnect, foreground recovery, or notification jumps.
- Realtime hint publish failures are isolated from outbox dispatch and do not roll back business state.

## Test Plan

- `npm run stage7:verify`
  - starts Postgres/Redis runtime
  - runs Prisma generate/validate/deploy
  - runs Stage 7 notification/search/realtime contract and integration tests
  - runs worker notification/outbox/realtime publisher tests
  - runs miniprogram Stage 7 shell tests
  - runs `npm run typecheck`
  - runs `npm run build`
  - runs `git diff --check`
