import { readFileSync } from "node:fs";

const checks = [
  {
    name: "blocked moderation state",
    file: "apps/api/prisma/schema.prisma",
    markers: ['blocked', 'block']
  },
  {
    name: "review original grant gateway",
    file: "apps/api/src/content/content-file-access.service.ts",
    markers: [
      "content_review_original",
      "REVIEW_TASK_NOT_ACTIVE",
      "canAdminReviewCommunity"
    ]
  },
  {
    name: "platform high-risk closure",
    file: "apps/api/src/content/content-review.service.ts",
    markers: [
      "platformReviewModerationTask",
      "PLATFORM_ADMIN_REQUIRED",
      "markTargetBlocked"
    ]
  },
  {
    name: "product safety fake labels",
    file: "apps/api/src/providers/fake-providers.ts",
    markers: [
      "safety_recalled_item",
      "safety_damaged_battery",
      "safety_magnetic_beads",
      "safety_small_parts_ingestion",
      "safety_sharp_parts"
    ]
  },
  {
    name: "history context review detail",
    file: "apps/api/src/content/content-review.service.ts",
    markers: ["historyContext", "findHistoryContext"]
  },
  {
    name: "admin history context",
    file: "apps/admin/src/stage3-views.tsx",
    markers: ["History Context", "historyContext"]
  },
  {
    name: "stage3 hardening docs",
    file: "docs/MVP_ROADMAP.md",
    markers: ["第四轮实施顺序", "content_review_original", "blocked"]
  },
  {
    name: "stage3 hardening tests",
    file: "apps/api/test/integration/stage3-content-review-flow.test.ts",
    markers: [
      "content_review_original",
      "platformReviewModerationTask",
      "safety_magnetic_beads",
      "historyContext"
    ]
  }
];

const failures = [];
for (const check of checks) {
  const content = readFileSync(check.file, "utf8");
  const missing = check.markers.filter((marker) => !content.includes(marker));
  if (missing.length > 0) {
    failures.push({ name: check.name, file: check.file, missing });
  }
}

if (failures.length > 0) {
  console.error("stage3 readiness failed");
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log("stage3 readiness passed");
