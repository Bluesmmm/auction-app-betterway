# ADR 0007: Stage 8 3A Uses High-Risk Governance Review for Two-Person Approval

## Status

Proposed

## Context

Stage 8 second-round governance controls already require administrator MFA, a fresh sensitive-operation challenge, preview evidence, scoped authorization, audit evidence, and outbox events. The third-round roadmap expands from governance controls into category-scoped controls, export/delete governance, provider governance, two-person review, and administrator notifications.

Sensitive-operation challenges prove that the current actor is still trusted, but they do not provide independent approval. Export, deletion/anonymization, provider governance, and settlement-affecting controls need a second qualified administrator to confirm the frozen request before the business mutation executes.

## Decision

Stage 8 third-round work is a design package implemented in sub-stages. Stage 8 3A introduces a shared **high-risk governance review** workflow and first connects it only to governance-control create/lift for `pause_settlement`.

High-risk governance review is a business approval fact, not a sensitive-operation challenge. The initiator must complete sensitive-operation verification when submitting the request, the reviewer must complete sensitive-operation verification when approving it, and the reviewer must be a different user from the initiator.

The first 3A integration requires two different `platform_admin` users for `pause_settlement` create/lift. Existing `pause_publish`, `pause_bid`, and `force_platform_review` governance controls continue to use the second-round sensitive-operation challenge path until later sub-stages explicitly migrate them.

Review requests use immutable frozen payloads. Approval automatically executes the frozen payload; it does not return to the initiator for a second execution click. Submitting the review request locks and consumes the source preview and copies its evidence into the review request, so the source preview TTL no longer controls approval after the request is created. If the review request has expired or the action-specific critical impact surface has changed at review time, the request becomes invalidated and must be recreated.

Review requests have an independent default expiry window of 30 minutes. Rejected, expired, invalidated, withdrawn, or execution-failed requests cannot be reused. A new attempt requires a new request and new evidence.

Expiry is advanced through both a worker and API-side lazy expiry. The worker creates timely expiry events and initiator notifications, while API-side lazy expiry prevents delayed workers from allowing stale approvals.

Creating a high-risk governance review request must be idempotent. A retry with the same actor, action, target, frozen payload, and idempotency key returns the same request instead of creating a duplicate or surfacing a duplicate-pending error.

Approving a review request must also be idempotent for the same reviewer and request. A retry after network loss returns the existing approval and execution result, and it must not execute the frozen payload more than once.

All terminal transitions from `pending` use first-writer-wins semantics. Approval, rejection, withdrawal, expiry, and invalidation must each atomically move the request out of `pending`; later attempts see the already-processed request and do not create duplicate events, notifications, or executions.

For 3A's database-backed governance-control execution path, approval decision recording, lifecycle events, business mutation, execution-state recording, and outbox writes commit in one database transaction. The system must not durably expose `approved + not_started` for this path. `approved + failed` is reserved for an execution adapter that deliberately records a failed execution result without a partial business mutation; infrastructure failures roll back the transaction or are retried through an idempotent recovery path before later sub-stages attach external side effects.

The review model separates human decision state from execution state. The first status vocabulary is:

- Decision state: `pending`, `approved`, `rejected`, `expired`, `withdrawn`, `invalidated`
- Execution state: `not_started`, `succeeded`, `failed`

Each review request also needs a lifecycle event log. Current state is not enough for audit, UI timelines, notification replay, or execution failure diagnosis. Events include creation, approval, rejection, withdrawal, expiry, invalidation, execution success, and execution failure.

Rejected requests require a reviewer reason. Initiators may withdraw pending requests, but withdrawal requires a reason and the request cannot be reused.

The first notification matrix is administrator-only: eligible reviewers receive a pending-review notification, and the initiator receives result notifications for approval, rejection, expiry, invalidation, withdrawal, or execution failure. End-user parent/child notifications are out of scope for 3A.

Notification delivery is not part of review-request state. Delivery failure is recorded and retried through notification infrastructure, but it must not prevent request creation, approval, rejection, expiry, invalidation, withdrawal, or execution-result recording.

The existing governance-control API remains the intent entry point. For controls that require high-risk governance review, the mutation returns a pending-review result instead of immediately mutating business state. Pending review does not block business writes; only an active governance control does.

For governance-control creation, submitting a pending review locks the referenced preview evidence. The same preview cannot be used to submit multiple review requests, and a failed or expired review requires a fresh preview. A duplicate pending review for the same scope and control type is rejected at submission time, and approval-time execution still rechecks for an already-active control.

Creating a `pause_settlement` review request requires at least one other active `platform_admin` who is eligible to review it. If no such reviewer exists, creation fails with `NO_ELIGIBLE_REVIEWER` instead of creating a request that can never complete.

The `pause_settlement` high-risk governance review route must be controlled by a runtime routing flag. The route is enabled by default in test verification contexts and disabled by default in production unless explicitly configured. Disabling the route returns `pause_settlement` create/lift to the Stage 8 second-round synchronous behavior and invalidates unexecuted pending review requests rather than silently executing or preserving them.

Idempotency lookup for an existing review request takes precedence over routing flag evaluation. If a client created a pending request while the flag was enabled and then retries the same idempotency key after the flag is disabled, the API returns the existing request state instead of synchronously executing the governance-control mutation.

## Consequences

Stage 8 3A changes who may create or lift `pause_settlement`, but it does not change the business guard semantics of `pause_settlement`. It continues to block ordinary settlement progress, guardian confirmation, and shared delivery-confirmation paths, without blocking appeals, platform review, read-only governance views, ledger checks, or explicit platform-admin recovery actions.

Later sub-stages can attach category controls, export/delete governance, and provider governance to the same high-risk governance review workflow without redefining two-person approval, immutable payloads, expiry, review notifications, or execution-failure semantics.

The implementation must store enough evidence to enforce action-specific stale checks. Governance controls care about scope, control type, blocked actions, and critical impact counts; export/delete workflows and provider governance will define their own critical-impact checks when they are attached in later sub-stages.

Stage 8 3A is not complete until the workflow, administrator notification loop, and second-round compatibility are all verified. The minimum acceptance bar is: pending-review creation for `pause_settlement` create/lift, independent platform-admin approval execution, no-eligible-reviewer rejection, rejection, withdrawal, expiry, invalidation, execution-failure handling, terminal-transition race handling, source-preview TTL independence after request creation, administrator-only notifications, preservation of existing low-impact governance-control behavior, admin UI support, contract tests, integration tests, runtime shell tests, type checking, build, and the Stage 8 verification script.
