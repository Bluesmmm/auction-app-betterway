# ADR 0004: Stage 5 Uses Worker Settlement And Outbox-First Push

## Status

Accepted

## Context

Stage 5 introduces fixed-end auctions, bids, point holds, bid withdrawal, cancellation, and settlement. The roadmap mentions delayed settlement, scanner fallback, and WebSocket bid push.

Auction settlement changes PostgreSQL business facts and point holds. If ordinary read requests silently settle expired auctions, reads become writes and retry behavior becomes harder to reason about. A real WebSocket gateway also introduces connection lifecycle, fanout, authorization, and delivery concerns that are separate from the core auction accounting risk.

## Decision

Stage 5 settlement is performed by worker paths, not by ordinary read requests.

- A delayed BullMQ job is the primary settlement path.
- A PostgreSQL-backed scanner worker is the fallback for overdue active auctions.
- Settlement is idempotent and guarded by PostgreSQL row locks and business keys.
- Ordinary API reads may report that an auction is overdue or pending settlement, but they do not complete settlement.
- Stage 5 writes durable outbox events for bid accepted, bid outbid, bid withdrawn, auction cancelled, auction settled, and auction unsold.
- Stage 5 does not implement a real WebSocket server. Later stages can consume the outbox for WebSocket or subscription-message delivery.

## Consequences

- PostgreSQL remains the source of truth when Redis or BullMQ is delayed or unavailable.
- Settlement behavior is observable and retryable in worker traces instead of being hidden behind reads.
- Stage 5 can verify auction accounting without also solving realtime connection management.
- User-facing realtime experience is deferred; Stage 5 clients can poll or refresh from API state.
