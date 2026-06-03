# Stage 4 Uses a Periodic Ledger Check Worker

Stage 4 will introduce a periodic ledger check worker instead of limiting ledger verification to an offline script. This adds database access, scheduling, locking, and runtime observability to the worker layer earlier than the minimum ledger implementation would require, but it gives the pilot a repeatable way to detect point ledger anomalies before bidding, settlement, and delivery flows depend on the ledger.

The worker must not automatically repair balances or silently overwrite ledger state. It records ledger check runs and diffs, emits observable failure evidence, and feeds readiness gates; automatic business pauses and remediation workflows remain later-stage governance decisions.
