export const stage9GateStatuses = [
  "passed",
  "failed",
  "manual_gate",
  "not_covered"
];

export const stage9OverallStatuses = [
  "ready_for_pilot",
  "ready_with_manual_gates",
  "blocked"
];

export const stage9GateMaturities = [
  "declared",
  "mapped",
  "automated",
  "rehearsed",
  "pilot_ready"
];

export const stage9GateModes = ["skip", "discover", "verify"];

export const stage9GateCategories = [
  "stage-verification",
  "state-machine",
  "ledger",
  "concurrency",
  "authorization",
  "privacy-content",
  "file-search-notification",
  "governance",
  "runtime-rehearsal",
  "deletion-retention",
  "manual-pilot"
];

export const stage9ReportPaths = {
  json: "artifacts/stage9/prepilot-verification-report.json",
  markdown: "artifacts/stage9/prepilot-verification-report.md"
};

const stageVerifyScripts = [
  "stage1:verify",
  "stage2:verify",
  "stage3:verify",
  "stage4:verify",
  "stage5:verify",
  "stage6:verify",
  "stage7:verify",
  "stage8:verify"
];

export const stage9Gates = [
  {
    id: "stage-baseline-branches-present",
    category: "stage-verification",
    title: "Stage 1-8 verification baselines are present before Stage 9",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "package_scripts",
        scripts: stageVerifyScripts,
        requiredFor: ["discover", "verify", "full"]
      },
      {
        kind: "file_exists",
        paths: [
          "scripts/stage1/check-connectivity.mjs",
          "scripts/stage2/verify-stage2.mjs",
          "scripts/stage3/verify-stage3.mjs",
          "scripts/stage4/verify-stage4.mjs",
          "scripts/stage5/verify-stage5.mjs",
          "scripts/stage6/verify-stage6.mjs",
          "scripts/stage7/verify-stage7.mjs",
          "scripts/stage8/verify-stage8.mjs",
          "docs/MVP_ROADMAP.md",
          "docs/STAGE9_PREPILOT_VERIFICATION.md",
          "docs/adr/0008-stage9-prepilot-verification-gate.md"
        ],
        requiredFor: ["discover", "verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:449",
      "docs/MVP_ROADMAP.md:667"
    ],
    manual: null
  },
  {
    id: "stage1-to-stage8-full-verification",
    category: "stage-verification",
    title: "Final pre-pilot full mode runs Stage 1-8 verification",
    gateType: "hard",
    maturity: "mapped",
    defaultMode: "skip",
    fullMode: "verify",
    evidence: stageVerifyScripts.map((script) => ({
      kind: "command",
      command: `npm run ${script}`,
      binary: "npm",
      args: ["run", script],
      requiredFor: ["full"]
    })),
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:453",
      "docs/MVP_ROADMAP.md:472"
    ],
    manual: null
  },
  {
    id: "stage9-runtime-script-contract",
    category: "stage-verification",
    title: "Stage 9 runtime script contract is covered by Vitest",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm test -- apps/api/test/runtime/stage9-scripts.test.ts",
        binary: "npm",
        args: ["test", "--", "apps/api/test/runtime/stage9-scripts.test.ts"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: ["docs/MVP_ROADMAP.md:453"],
    manual: null
  },
  {
    id: "stage9-quality-gates",
    category: "stage-verification",
    title: "Stage 9 keeps typecheck, build, and diff hygiene green",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run db:generate",
        binary: "npm",
        args: ["run", "db:generate"],
        requiredFor: ["verify", "full"]
      },
      {
        kind: "command",
        command: "npm run typecheck",
        binary: "npm",
        args: ["run", "typecheck"],
        requiredFor: ["verify", "full"]
      },
      {
        kind: "command",
        command: "npm run build",
        binary: "npm",
        args: ["run", "build"],
        requiredFor: ["verify", "full"]
      },
      {
        kind: "command",
        command: "git diff --check",
        binary: "git",
        args: ["diff", "--check"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: ["docs/MVP_ROADMAP.md:667"],
    manual: null
  },
  {
    id: "minimal-auction-state-machine-e2e",
    category: "state-machine",
    title:
      "Minimal auction loop and abnormal state paths have service-level pre-pilot state-machine evidence",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:state-machine",
        binary: "npm",
        args: ["run", "stage9:state-machine"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:472",
      "docs/MVP_ROADMAP.md:473",
      "docs/MVP_ROADMAP.md:478",
      "docs/MVP_ROADMAP.md:487",
      "docs/MVP_ROADMAP.md:493",
      "docs/MVP_ROADMAP.md:676"
    ],
    manual: null
  },
  {
    id: "ledger-recompute-clean",
    category: "ledger",
    title: "Ledger recomputation has no anomalies before pilot",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:ledger",
        binary: "npm",
        args: ["run", "stage9:ledger"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:474",
      "docs/MVP_ROADMAP.md:501"
    ],
    manual: null
  },
  {
    id: "outbox-worker-failure-recovery",
    category: "concurrency",
    title:
      "Outbox duplicate consumption, worker crash, and lease expiry do not change business facts",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:outbox-worker",
        binary: "npm",
        args: ["run", "stage9:outbox-worker"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:523",
      "docs/MVP_ROADMAP.md:525",
      "docs/MVP_ROADMAP.md:593"
    ],
    manual: null
  },
  {
    id: "authorization-privacy-cross-community",
    category: "authorization",
    title:
      "Parents, children, activity admins, and platform admins cannot cross current scope boundaries",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:authorization",
        binary: "npm",
        args: ["run", "stage9:authorization"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:531",
      "docs/MVP_ROADMAP.md:542",
      "docs/MVP_ROADMAP.md:543",
      "docs/MVP_ROADMAP.md:678"
    ],
    manual: null
  },
  {
    id: "privacy-content-hard-stop",
    category: "privacy-content",
    title:
      "Unreviewed content, sensitive text, unsafe images, and high-risk content fail closed",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:privacy-content",
        binary: "npm",
        args: ["run", "stage9:privacy-content"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:550",
      "docs/MVP_ROADMAP.md:558"
    ],
    manual: null
  },
  {
    id: "file-search-notification-regression",
    category: "file-search-notification",
    title:
      "File authorization, search source-of-truth checks, and notification refresh semantics hold under stale data",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:file-search-notification",
        binary: "npm",
        args: ["run", "stage9:file-search-notification"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:567",
      "docs/MVP_ROADMAP.md:571"
    ],
    manual: null
  },
  {
    id: "governance-pause-and-review-recovery",
    category: "governance",
    title:
      "Governance pause, recovery, preview, and high-risk review paths work as pilot brakes",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:governance",
        binary: "npm",
        args: ["run", "stage9:governance"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:476",
      "docs/MVP_ROADMAP.md:579",
      "docs/MVP_ROADMAP.md:659",
      "docs/MVP_ROADMAP.md:683"
    ],
    manual: null
  },
  {
    id: "runtime-rehearsal-coverage",
    category: "runtime-rehearsal",
    title:
      "Runtime, backup restore, migration release, grey release, and vendor downgrade rehearsals are evidenced",
    gateType: "hard",
    maturity: "rehearsed",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:runtime-rehearsal",
        binary: "npm",
        args: ["run", "stage9:runtime-rehearsal"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:465",
      "docs/MVP_ROADMAP.md:593"
    ],
    manual: null
  },
  {
    id: "deletion-retention-coverage",
    category: "deletion-retention",
    title:
      "Deletion and anonymization cover primary database, search, object storage, exports, cache, notifications, and backups",
    gateType: "hard",
    maturity: "automated",
    defaultMode: "verify",
    fullMode: "verify",
    evidence: [
      {
        kind: "command",
        command: "npm run stage9:deletion-retention",
        binary: "npm",
        args: ["run", "stage9:deletion-retention"],
        requiredFor: ["verify", "full"]
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:595",
      "docs/MVP_ROADMAP.md:681",
      "docs/TECHNICAL_ARCHITECTURE.md:375"
    ],
    manual: null
  },
  {
    id: "legal-prepilot-review",
    category: "manual-pilot",
    title: "Legal review is recorded before pilot",
    gateType: "manual",
    maturity: "mapped",
    defaultMode: "discover",
    fullMode: "discover",
    evidence: [
      {
        kind: "manual",
        requiredEvidence:
          "Legal review record for user agreement, privacy policy, children information protection rules, and pilot consent materials."
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:670",
      "docs/README.md"
    ],
    manual: {
      owner: "legal",
      requiredEvidence:
        "Approved legal review record covering user agreement, privacy policy, children information protection rules, and pilot consent materials.",
      validFor: "90d",
      blockingIfMissing: true
    }
  },
  {
    id: "operations-pilot-materials",
    category: "manual-pilot",
    title: "Pilot community, admin, and parent operating materials are ready",
    gateType: "manual",
    maturity: "mapped",
    defaultMode: "discover",
    fullMode: "discover",
    evidence: [
      {
        kind: "manual",
        requiredEvidence:
          "Operations packet for pilot community setup, admin training, parent instructions, pause and recovery rehearsal, and appeal handling."
      }
    ],
    roadmapRefs: ["docs/MVP_ROADMAP.md:684"],
    manual: {
      owner: "operations",
      requiredEvidence:
        "Pilot community setup checklist, administrator training record, parent instructions, and pause/recovery rehearsal notes.",
      validFor: "30d",
      blockingIfMissing: true
    }
  },
  {
    id: "vendor-production-config",
    category: "manual-pilot",
    title:
      "Production vendor configuration is reviewed for minimum data, key rotation, downgrade, and audit logging",
    gateType: "manual",
    maturity: "mapped",
    defaultMode: "discover",
    fullMode: "discover",
    evidence: [
      {
        kind: "manual",
        requiredEvidence:
          "Vendor owner record for content safety, object storage, notification, and logging provider data minimization, key rotation, downgrade strategy, and audit logging."
      }
    ],
    roadmapRefs: [
      "docs/MVP_ROADMAP.md:596",
      "docs/MVP_ROADMAP.md:680"
    ],
    manual: {
      owner: "vendor_owner",
      requiredEvidence:
        "Provider configuration review covering data minimization, key rotation, downgrade behavior, field allowlist, and audit logging.",
      validFor: "60d",
      blockingIfMissing: true
    }
  }
];
