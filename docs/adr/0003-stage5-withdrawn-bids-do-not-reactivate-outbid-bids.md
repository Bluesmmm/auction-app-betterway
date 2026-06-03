# ADR 0003: Withdrawn Bids Do Not Reactivate Outbid Bids

## Status

Accepted

## Context

Stage 5 introduces bid withdrawal within a short window for the current highest bid. A traditional auction could restore the previous valid bidder after the current highest bidder withdraws.

In this product, every current highest bid is backed by frozen child points. When a bid is outbid, its point hold is released. After release, those points may be used elsewhere, and the child may later become restricted, leave the community, or enter guardian dispute freeze.

## Decision

When the current highest bid is withdrawn in Stage 5, the system releases that bid's point hold and clears the auction's current highest bid. It does not reactivate any historical outbid bid and does not automatically recreate point holds for previous bidders.

The next bid must be submitted explicitly and satisfy the auction's starting price and increment rules.

## Consequences

- Point accounting remains simple: only the current highest bid has an active hold.
- Historical outbid bids are facts, not standby commitments.
- The first Stage 5 implementation avoids automatic refreeze failures, surprising notifications, and hidden bidder reactivation.
- A future stage may introduce explicit standby or reactivation semantics, but that would require fresh balance checks, permission checks, notifications, and abuse controls.
