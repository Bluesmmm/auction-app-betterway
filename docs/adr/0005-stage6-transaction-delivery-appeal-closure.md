# ADR 0005: Stage 6 Closes Transaction Delivery And Appeal Evidence

## Status

Accepted

## Context

The roadmap originally described Stage 6 as transaction, delivery, and appeal implementation. Stage 5 already created the first durable transaction accounting loop: auction settlement creates `transactions`, buyer points remain frozen through guardian confirmation and delivery confirmation, timeouts are handled by worker paths, and administrators can release to buyer, transfer to seller, or keep a transaction frozen for platform review.

Starting Stage 6 as a fresh transaction implementation would duplicate Stage 5's accounting surface and risk splitting the source of truth. The remaining risk is evidence and governance around delivery method selection, guardian decision history, appeals, private appeal attachments, and first-round verification.

## Decision

Stage 6 is a closure and evidence-hardening stage on top of the Stage 5 transaction loop, not a rewrite of transaction accounting.

- Stage 6 keeps the existing `transactions`, point holds, timeout workers, and administrator transaction-resolution actions as the accounting base.
- Stage 6 changes guardian confirmation from parallel confirmation to a sequenced contract: the seller primary guardian proposes the delivery method, then the buyer primary guardian accepts or rejects it.
- Stage 6 only opens `designated_point` and `guardian_arranged` delivery in the first version. `courier` is reserved in the model but API/UI paths must fail closed.
- Delivery points are community-scoped governance resources maintained by scoped activity admins, with platform admin fallback. Delivery points are disabled, not deleted, so historical transaction evidence remains readable.
- `guardian_decisions` must store evidence snapshots at decision time, including side, child, guardian role, transaction version, and reason. Historical decisions must not depend on current guardian relationships for interpretation.
- Secondary guardians cannot confirm transactions, accept delivery methods, confirm delivery, or override primary guardian rejection. They may submit appeals, supplementary statements, or review signals.
- Guardian transaction actions that change transaction status or point-freeze outcomes require sensitive-operation re-verification. Ordinary appeal submission does not, but the submitter must be a valid guardian of one transaction side.
- Transaction appeals use a new `appeals` fact instead of overloading `guardian_disputes`. `guardian_disputes` remains for true guardianship conflicts.
- Ordinary transaction appeals enter the scoped activity-admin queue first. Platform admins handle escalated, cross-community, high-risk, admin-complaint, suspected guardianship-conflict, or long-frozen cases.
- Stage 6 permits appeal image attachments, limited to at most four private images per appeal. It does not permit video, audio, PDFs, archives, exported chat logs, or arbitrary files.
- Appeal image attachments reuse Stage 3 private media assets, temporary private upload, content-safety provider checks, and private file-access grants. They do not create `ContentVersion`, `ModerationTask`, or child-visible public content.
- Stage 6 implementation is split into rounds. Round 1 covers schema, contracts, and service-layer state machines only. Round 2 adds API, permissions, minimal mini-program/admin entry points, and expanded verification.

## Consequences

- Stage 6 has a narrower first implementation surface than the original roadmap title suggests, but it targets the highest-risk gaps: state evidence, delivery governance, appeal evidence, and privacy boundaries.
- The transaction accounting source of truth remains PostgreSQL facts introduced in Stage 5; UI and API work must follow the service-layer contract rather than inventing new transaction state.
- Courier delivery and general file uploads remain deliberately closed until their privacy, logging, export, and provider-governance surfaces are explicitly designed.
- Future engineers should not replace `appeals` with `guardian_disputes` for ordinary transaction complaints unless the complaint becomes a true guardianship conflict.
