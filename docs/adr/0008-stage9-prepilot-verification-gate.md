# Stage 9 Uses A Pre-Pilot Verification Gate

Stage 9 is a pre-pilot verification gate, not another product feature stage. We will implement it as an explicit gate matrix with `stage9:discover` for gap discovery, `stage9:verify` for strict daily gating, and `stage9:verify:full` for final pre-pilot evidence that also runs Stage 1-8 verification.

**Status:** accepted

**Considered Options**

- Run every Stage 1-8 verification command on every Stage 9 run.
- Keep Stage 9 as a hand-written checklist outside the codebase.
- Use a matrix-driven gate that can distinguish automated failures, manual gates, and uncovered requirements.

**Decision**

Stage 9 will use a matrix-driven verification gate. `failed` and `not_covered` gates block the strict verifier. `manual_gate` items require named owners and evidence requirements, but cannot raise the final conclusion above `ready_with_manual_gates`. JSON reports in `artifacts/stage9/` are the machine-readable fact source; Markdown reports are review views generated from the same matrix and are not committed by default.

**Consequences**

The first Stage 9 implementation may intentionally fail because uncovered roadmap gates are represented honestly as `not_covered`. This is preferable to a green checklist that hides missing evidence. Stage 9 issues must reduce uncovered gates or promote manual gates into automated or rehearsed evidence.
