# Stage 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the phase 1 engineering foundation for the WeChat points auction app: workspace skeleton, shared contracts, Prisma schema, fake providers, and first contract-test targets.

**Architecture:** Use a TypeScript npm workspace with `apps/api`, `apps/admin`, `apps/miniprogram`, and `packages/shared`. Put business contracts in shared types first, then anchor persistence in Prisma schema, then add a thin NestJS API skeleton and pure contract tests before feature UI work.

**Tech Stack:** Node.js, npm workspaces, TypeScript, NestJS, Prisma, PostgreSQL, Vitest.

---

## File Structure

- `package.json` — npm workspace scripts and root dev tooling.
- `tsconfig.base.json` — shared TypeScript compiler options.
- `vitest.config.ts` — test runner config for shared and API tests.
- `packages/shared/src/status.ts` — canonical status enums from `docs/STATE_MACHINES.md`.
- `packages/shared/src/api-response.ts` — write API adjudication response shape.
- `packages/shared/src/idempotency.ts` — idempotency key contract helpers.
- `packages/shared/src/index.ts` — shared package export barrel.
- `packages/shared/package.json` — shared package metadata.
- `apps/api/package.json` — API package metadata.
- `apps/api/prisma/schema.prisma` — first PostgreSQL schema with enum and model contracts.
- `apps/api/src/main.ts` — NestJS bootstrap.
- `apps/api/src/app.module.ts` — root module.
- `apps/api/src/health.controller.ts` — minimal health endpoint.
- `apps/api/src/providers/provider-contracts.ts` — fake/real external provider interfaces.
- `apps/api/src/providers/fake-providers.ts` — deterministic fake providers for tests.
- `apps/api/test/contracts/shared-contracts.test.ts` — enum/API/idempotency tests.
- `apps/api/test/contracts/provider-contracts.test.ts` — fake provider failure-close tests.
- `apps/admin/package.json` — admin app skeleton package.
- `apps/miniprogram/project.config.json` — WeChat miniprogram skeleton config.

## Task 1: Workspace And Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/shared/package.json`
- Create: `apps/api/package.json`
- Create: `apps/admin/package.json`
- Create: `apps/miniprogram/project.config.json`

- [ ] **Step 1: Create root npm workspace**

Create `package.json`:

```json
{
  "name": "auction-app-betterway",
  "private": true,
  "version": "0.1.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.base.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create base TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@auction/shared": ["packages/shared/src/index.ts"]
    }
  },
  "include": [
    "apps/**/*.ts",
    "packages/**/*.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@auction/shared": "/packages/shared/src/index.ts"
    }
  }
});
```

- [ ] **Step 4: Create package metadata**

Create `packages/shared/package.json`:

```json
{
  "name": "@auction/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

Create `apps/api/package.json`:

```json
{
  "name": "@auction/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p ../../tsconfig.base.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@prisma/client": "^5.14.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "prisma": "^5.14.0"
  }
}
```

Create `apps/admin/package.json`:

```json
{
  "name": "@auction/admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "echo \"admin skeleton\"",
    "test": "echo \"admin tests pending\""
  }
}
```

Create `apps/miniprogram/project.config.json`:

```json
{
  "appid": "touristappid",
  "projectname": "auction-app-betterway",
  "setting": {
    "urlCheck": false,
    "es6": true,
    "minified": true
  },
  "compileType": "miniprogram"
}
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: dependency install succeeds and creates `package-lock.json`.

## Task 2: Shared Implementation Contracts

**Files:**
- Create: `packages/shared/src/status.ts`
- Create: `packages/shared/src/api-response.ts`
- Create: `packages/shared/src/idempotency.ts`
- Create: `packages/shared/src/index.ts`
- Test: `apps/api/test/contracts/shared-contracts.test.ts`

- [ ] **Step 1: Write failing shared contract tests**

Create `apps/api/test/contracts/shared-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AuctionSessionStatus,
  TransactionStatus,
  createIdempotencyFingerprint,
  writeAccepted,
  writeUnknown
} from "@auction/shared";

describe("shared implementation contracts", () => {
  it("keeps auction and transaction status machines separated", () => {
    expect(AuctionSessionStatus).toContain("settled");
    expect(AuctionSessionStatus).not.toContain("pending_guardian_confirm");
    expect(TransactionStatus).toContain("pending_guardian_confirm");
    expect(TransactionStatus).toContain("platform_review");
  });

  it("builds adjudicated write responses instead of bare success", () => {
    const response = writeAccepted({
      serverTime: "2026-05-26T12:00:00.000Z",
      targetType: "auction_session",
      targetId: "auction_1",
      targetVersion: 3,
      latestStatus: "active"
    });

    expect(response.result).toBe("accepted");
    expect(response.refreshRequired).toBe(false);
    expect(response.targetVersion).toBe(3);
  });

  it("marks unknown write results as refresh required", () => {
    const response = writeUnknown({
      serverTime: "2026-05-26T12:00:00.000Z",
      targetType: "bid",
      targetId: "bid_1",
      targetVersion: 1,
      latestStatus: "unknown",
      errorCode: "TRANSACTION_RESULT_UNKNOWN"
    });

    expect(response.result).toBe("unknown");
    expect(response.refreshRequired).toBe(true);
    expect(response.errorCode).toBe("TRANSACTION_RESULT_UNKNOWN");
  });

  it("rejects idempotency reuse when request hashes differ", () => {
    const first = createIdempotencyFingerprint({
      idempotencyKey: "same-key",
      actorId: "user_1",
      action: "bid.create",
      targetType: "auction_session",
      targetId: "auction_1",
      requestHash: "hash_a"
    });
    const second = createIdempotencyFingerprint({
      ...first,
      requestHash: "hash_b"
    });

    expect(first.conflictsWith(second)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/api/test/contracts/shared-contracts.test.ts`

Expected: FAIL because `@auction/shared` exports do not exist yet.

- [ ] **Step 3: Implement shared status enums**

Create `packages/shared/src/status.ts`:

```ts
export const AuctionSessionStatus = [
  "pending_start",
  "active",
  "pending_settlement",
  "settled",
  "cancelled",
  "unsold",
  "delisted"
] as const;

export type AuctionSessionStatus = (typeof AuctionSessionStatus)[number];

export const TransactionStatus = [
  "pending_guardian_confirm",
  "pending_delivery_confirm",
  "completed",
  "cancelled",
  "disputed",
  "platform_review"
] as const;

export type TransactionStatus = (typeof TransactionStatus)[number];

export const ContentVersionStatus = [
  "pending_ai",
  "pending_manual",
  "approved",
  "rejected",
  "escalated",
  "blocked"
] as const;

export type ContentVersionStatus = (typeof ContentVersionStatus)[number];
```

- [ ] **Step 4: Implement write response helpers**

Create `packages/shared/src/api-response.ts`:

```ts
export type WriteResult = "accepted" | "rejected" | "pending" | "unknown";

export type WriteResponseInput = {
  serverTime: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  latestStatus: string;
  errorCode?: string;
};

export type WriteResponse = {
  serverTime: string;
  targetType: string;
  targetId: string;
  targetVersion: number;
  latestStatus: string;
  result: WriteResult;
  refreshRequired: boolean;
  errorCode?: string;
};

export function writeAccepted(input: WriteResponseInput): WriteResponse {
  return { ...input, result: "accepted", refreshRequired: false };
}

export function writeUnknown(input: WriteResponseInput): WriteResponse {
  return { ...input, result: "unknown", refreshRequired: true };
}
```

- [ ] **Step 5: Implement idempotency fingerprint**

Create `packages/shared/src/idempotency.ts`:

```ts
export type IdempotencyFingerprintInput = {
  idempotencyKey: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  requestHash: string;
};

export type IdempotencyFingerprint = IdempotencyFingerprintInput & {
  conflictsWith(other: IdempotencyFingerprintInput): boolean;
};

export function createIdempotencyFingerprint(
  input: IdempotencyFingerprintInput
): IdempotencyFingerprint {
  return {
    ...input,
    conflictsWith(other) {
      return (
        input.idempotencyKey === other.idempotencyKey &&
        input.actorId === other.actorId &&
        input.action === other.action &&
        input.targetType === other.targetType &&
        input.targetId === other.targetId &&
        input.requestHash !== other.requestHash
      );
    }
  };
}
```

- [ ] **Step 6: Export shared package**

Create `packages/shared/src/index.ts`:

```ts
export * from "./api-response.js";
export * from "./idempotency.js";
export * from "./status.js";
```

- [ ] **Step 7: Run tests**

Run: `npm test -- apps/api/test/contracts/shared-contracts.test.ts`

Expected: PASS.

## Task 3: Prisma Schema Foundation

**Files:**
- Create: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Create Prisma schema with core enums and models**

Create `apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  active
  restricted
  closed
}

enum GuardianStatus {
  active
  restricted
  closed
}

enum ChildStatus {
  pending_guardian
  active
  restricted
  closed
}

enum GuardianRole {
  primary
  secondary
}

enum LinkStatus {
  pending
  active
  revoked
}

enum CommunityStatus {
  draft
  pending_review
  active
  suspended
  closed
  rejected
}

enum InviteCodeStatus {
  active
  disabled
  expired
}

enum CommunityMemberStatus {
  pending_guardian
  pending_admin
  active
  removed
  banned
}

enum ContentTargetType {
  item
  wanted_request
  wanted_response
  avatar
}

enum ContentVersionStatus {
  pending_ai
  pending_manual
  approved
  rejected
  escalated
  blocked
}

enum ModerationTaskStatus {
  pending
  processing
  needs_manual_review
  approved
  rejected
  escalated
  failed
}

enum MediaVisibility {
  temp_private
  formal_private
  deleted
}

enum ItemStatus {
  draft
  ai_reviewing
  manual_reviewing
  approved
  rejected
  listed
  withdrawn
  delisted
}

enum AuctionSessionStatus {
  pending_start
  active
  pending_settlement
  settled
  cancelled
  unsold
  delisted
}

enum BidStatus {
  active
  outbid
  withdrawn
  invalidated
}

enum PointHoldStatus {
  active
  released
  transferred
  cancelled
  disputed
}

enum PointLedgerEntryType {
  initial_grant
  admin_adjustment
  hold
  release
  transfer_out
  transfer_in
  reversal
}

enum TransactionStatus {
  pending_guardian_confirm
  pending_delivery_confirm
  completed
  cancelled
  disputed
  platform_review
}

enum DecisionPhase {
  guardian_confirm
  delivery_confirm
}

enum DecisionValue {
  confirmed
  rejected
}

enum IdempotencyStatus {
  processing
  completed
  failed
  conflict
}

enum OutboxStatus {
  pending
  processing
  sent
  failed
  cancelled
}

model User {
  id               String             @id @default(cuid())
  status           UserStatus          @default(active)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
  wechatIdentities WechatIdentity[]
  guardianProfile  GuardianProfile?
  childProfile     ChildProfile?
  auditLogs        AuditLog[]
}

model WechatIdentity {
  id          String    @id @default(cuid())
  userId      String
  openid      String    @unique
  unionid     String?
  avatarUrl   String?
  nickname    String?
  lastLoginAt DateTime?
  user        User      @relation(fields: [userId], references: [id])
}

model GuardianProfile {
  id             String              @id @default(cuid())
  userId         String              @unique
  phoneHash      String
  phoneLast4     String
  consentVersion String
  consentedAt    DateTime
  status         GuardianStatus      @default(active)
  user           User                @relation(fields: [userId], references: [id])
  childLinks     GuardianChildLink[]
}

model ChildProfile {
  id                     String                 @id @default(cuid())
  userId                 String?                @unique
  displayName            String
  avatarAssetId          String?
  gradeBand              String
  status                 ChildStatus            @default(pending_guardian)
  createdByGuardianId    String?
  initialPointsGrantedAt DateTime?
  createdAt              DateTime               @default(now())
  user                   User?                  @relation(fields: [userId], references: [id])
  guardianLinks          GuardianChildLink[]
  memberships            CommunityMember[]
  pointAccount           PointAccount?
  items                  Item[]
  bids                   Bid[]
}

model GuardianChildLink {
  id          String          @id @default(cuid())
  guardianId  String
  childId     String
  role        GuardianRole
  status      LinkStatus      @default(pending)
  confirmedAt DateTime?
  guardian    GuardianProfile @relation(fields: [guardianId], references: [id])
  child       ChildProfile    @relation(fields: [childId], references: [id])

  @@unique([guardianId, childId])
  @@index([childId, role, status])
}

model AuctionCommunity {
  id                            String               @id @default(cuid())
  name                          String
  description                   String?
  creatorGuardianId             String
  status                        CommunityStatus       @default(draft)
  defaultAuctionDurationMinutes Int
  createdAt                     DateTime              @default(now())
  inviteCodes                   CommunityInviteCode[]
  members                       CommunityMember[]
  items                         Item[]
}

model CommunityInviteCode {
  id          String            @id @default(cuid())
  communityId String
  code        String            @unique
  status      InviteCodeStatus  @default(active)
  maxUses     Int?
  usedCount   Int               @default(0)
  expiresAt   DateTime?
  community   AuctionCommunity  @relation(fields: [communityId], references: [id])

  @@index([communityId, status])
}

model CommunityMember {
  id          String                @id @default(cuid())
  communityId String
  childId     String
  status      CommunityMemberStatus @default(pending_guardian)
  joinedAt    DateTime?
  community   AuctionCommunity      @relation(fields: [communityId], references: [id])
  child       ChildProfile          @relation(fields: [childId], references: [id])

  @@unique([communityId, childId])
  @@index([childId, status])
}

model MediaAsset {
  id                 String          @id @default(cuid())
  ownerUserId         String
  storageBucket       String
  storageKey          String
  visibility          MediaVisibility @default(temp_private)
  mimeType            String
  sizeBytes           Int
  checksum            String
  accessPolicyVersion Int             @default(1)
  revokedAt           DateTime?
  createdAt           DateTime        @default(now())

  @@index([ownerUserId, visibility])
}

model Item {
  id                     String            @id @default(cuid())
  communityId            String
  sellerChildId          String
  status                 ItemStatus         @default(draft)
  startPoints            Int
  minIncrementPoints     Int
  currentPublicVersionId String?
  latestVersionId        String?
  version                Int                @default(1)
  createdAt              DateTime           @default(now())
  community              AuctionCommunity   @relation(fields: [communityId], references: [id])
  sellerChild            ChildProfile       @relation(fields: [sellerChildId], references: [id])
  auctionSessions        AuctionSession[]

  @@index([communityId, status])
  @@index([sellerChildId])
}

model ContentVersion {
  id          String               @id @default(cuid())
  targetType  ContentTargetType
  targetId    String
  versionNo   Int
  status      ContentVersionStatus @default(pending_ai)
  title       String?
  description String?
  payloadJson Json
  riskLevel   String?
  approvedAt  DateTime?
  createdAt   DateTime             @default(now())
  task        ModerationTask?

  @@unique([targetType, targetId, versionNo])
  @@index([targetType, targetId, status])
}

model ModerationTask {
  id               String               @id @default(cuid())
  contentVersionId String               @unique
  status           ModerationTaskStatus @default(pending)
  providerRiskLevel String?
  ruleTagsJson     Json?
  reviewerUserId   String?
  reviewedAt       DateTime?
  failureReason    String?
  contentVersion   ContentVersion      @relation(fields: [contentVersionId], references: [id])
}

model AuctionSession {
  id                    String               @id @default(cuid())
  itemId                String
  status                AuctionSessionStatus @default(active)
  startAt               DateTime
  endAt                 DateTime
  startPoints           Int
  minIncrementPoints    Int
  currentPricePoints    Int                  @default(0)
  highestBidId          String?
  highestBidderChildId  String?
  version               Int                  @default(1)
  item                  Item                 @relation(fields: [itemId], references: [id])
  bids                  Bid[]
  pointHolds            PointHold[]
  transaction           Transaction?

  @@index([status, endAt])
  @@index([itemId, status])
}

model Bid {
  id               String         @id @default(cuid())
  auctionSessionId String
  bidderChildId    String
  amountPoints     Int
  status           BidStatus      @default(active)
  idempotencyKey   String         @unique
  createdAt        DateTime       @default(now())
  auctionSession   AuctionSession @relation(fields: [auctionSessionId], references: [id])
  bidderChild      ChildProfile   @relation(fields: [bidderChildId], references: [id])
  pointHold        PointHold?

  @@index([auctionSessionId, createdAt])
}

model PointAccount {
  id                 String             @id @default(cuid())
  childId            String             @unique
  availablePoints    Int                @default(0)
  frozenPoints       Int                @default(0)
  totalEarnedPoints  Int                @default(0)
  totalSpentPoints   Int                @default(0)
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  child              ChildProfile       @relation(fields: [childId], references: [id])
  holds              PointHold[]
  ledgerEntries      PointLedgerEntry[]
}

model PointHold {
  id               String          @id @default(cuid())
  accountId         String
  auctionSessionId  String
  bidId             String?         @unique
  amountPoints      Int
  status            PointHoldStatus @default(active)
  createdAt         DateTime        @default(now())
  releasedAt        DateTime?
  transferredAt     DateTime?
  account           PointAccount    @relation(fields: [accountId], references: [id])
  auctionSession    AuctionSession  @relation(fields: [auctionSessionId], references: [id])
  bid               Bid?            @relation(fields: [bidId], references: [id])

  @@index([auctionSessionId, status])
}

model PointLedgerEntry {
  id             String               @id @default(cuid())
  accountId      String
  type           PointLedgerEntryType
  amountPoints   Int
  availableAfter Int
  frozenAfter    Int
  relatedType    String
  relatedId      String
  idempotencyKey String               @unique
  createdAt      DateTime             @default(now())
  account        PointAccount         @relation(fields: [accountId], references: [id])

  @@index([accountId, createdAt])
}

model Transaction {
  id                        String            @id @default(cuid())
  auctionSessionId          String            @unique
  buyerChildId              String
  sellerChildId             String
  pointHoldId               String
  pointsAmount              Int
  status                    TransactionStatus @default(pending_guardian_confirm)
  guardianConfirmDeadlineAt DateTime
  deliveryConfirmDeadlineAt DateTime?
  version                   Int               @default(1)
  createdAt                 DateTime          @default(now())
  auctionSession            AuctionSession    @relation(fields: [auctionSessionId], references: [id])
  decisions                 GuardianDecision[]
}

model GuardianDecision {
  id            String        @id @default(cuid())
  transactionId String
  guardianId    String
  phase         DecisionPhase
  value         DecisionValue
  effective     Boolean       @default(true)
  createdAt     DateTime      @default(now())
  transaction   Transaction   @relation(fields: [transactionId], references: [id])

  @@index([transactionId, phase, effective])
}

model IdempotencyRecord {
  id             String            @id @default(cuid())
  key            String
  actorUserId    String
  action         String
  targetType     String
  targetId       String
  requestHash    String
  status         IdempotencyStatus @default(processing)
  responseJson   Json?
  createdAt      DateTime          @default(now())

  @@unique([key, actorUserId, action, targetType, targetId])
}

model OutboxEvent {
  id             String       @id @default(cuid())
  eventType      String
  targetType     String
  targetId       String
  idempotencyKey String       @unique
  payloadJson    Json
  status         OutboxStatus @default(pending)
  availableAt    DateTime     @default(now())
  lockedAt       DateTime?
  lockedBy       String?
  attempts       Int          @default(0)
  createdAt      DateTime     @default(now())

  @@index([status, availableAt])
}

model AuditLog {
  id          String   @id @default(cuid())
  actorUserId String?
  action      String
  targetType  String
  targetId    String
  reason      String?
  beforeJson  Json?
  afterJson   Json?
  createdAt   DateTime @default(now())
  actor       User?    @relation(fields: [actorUserId], references: [id])

  @@index([targetType, targetId, createdAt])
}
```

- [ ] **Step 2: Validate schema**

Run: `npx prisma validate --schema apps/api/prisma/schema.prisma`

Expected: PASS.

## Task 4: Fake Provider Contracts

**Files:**
- Create: `apps/api/src/providers/provider-contracts.ts`
- Create: `apps/api/src/providers/fake-providers.ts`
- Test: `apps/api/test/contracts/provider-contracts.test.ts`

- [ ] **Step 1: Write fake provider tests**

Create `apps/api/test/contracts/provider-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FakeContentSafetyProvider,
  FakeObjectStorageProvider,
  FakeSubscriptionMessageProvider,
  FakeWechatAuthProvider
} from "../../src/providers/fake-providers.js";

describe("fake provider contracts", () => {
  it("maps mock WeChat codes to internal identity results", async () => {
    const provider = new FakeWechatAuthProvider();
    const result = await provider.exchangeCode("mock_openid_child_1");

    expect(result.ok).toBe(true);
    expect(result.openid).toBe("mock_openid_child_1");
  });

  it("fails closed when content safety cannot parse or scan content", async () => {
    const provider = new FakeContentSafetyProvider({
      mode: "failure"
    });

    const result = await provider.reviewText("normal title");

    expect(result.ok).toBe(false);
    expect(result.failureClosesBusiness).toBe(true);
  });

  it("flags unsafe text deterministically", async () => {
    const provider = new FakeContentSafetyProvider();
    const result = await provider.reviewText("这里有电话和微信号");

    expect(result.ok).toBe(true);
    expect(result.riskLevel).toBe("high");
    expect(result.labels).toContain("contact_info");
  });

  it("creates short-lived private file grants only after permission input", async () => {
    const provider = new FakeObjectStorageProvider();
    const grant = await provider.createReadGrant({
      mediaAssetId: "asset_1",
      granteeUserId: "user_1",
      purpose: "item_image_view",
      ttlSeconds: 60
    });

    expect(grant.ok).toBe(true);
    expect(grant.url).toContain("asset_1");
    expect(grant.expiresAt).toMatch(/Z$/);
  });

  it("notification failure does not mutate business state", async () => {
    const provider = new FakeSubscriptionMessageProvider({
      mode: "failure"
    });

    const result = await provider.send({
      recipientUserId: "user_1",
      templateKey: "auction_outbid",
      payload: { auctionId: "auction_1" }
    });

    expect(result.ok).toBe(false);
    expect(result.mutatesBusinessState).toBe(false);
  });
});
```

- [ ] **Step 2: Implement provider interfaces and fakes**

Create `apps/api/src/providers/provider-contracts.ts`:

```ts
export type ProviderMode = "normal" | "failure";

export type WechatIdentityResult =
  | { ok: true; openid: string; unionid?: string }
  | { ok: false; errorCode: string; failureClosesBusiness: true };

export interface WechatAuthProvider {
  exchangeCode(code: string): Promise<WechatIdentityResult>;
}

export type RiskLevel = "low" | "medium" | "high" | "severe";

export type ContentSafetyResult =
  | { ok: true; riskLevel: RiskLevel; labels: string[] }
  | { ok: false; errorCode: string; failureClosesBusiness: true };

export interface ContentSafetyProvider {
  reviewText(text: string): Promise<ContentSafetyResult>;
}

export type CreateReadGrantInput = {
  mediaAssetId: string;
  granteeUserId: string;
  purpose: string;
  ttlSeconds: number;
};

export type FileReadGrantResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; errorCode: string; failureClosesBusiness: true };

export interface ObjectStorageProvider {
  createReadGrant(input: CreateReadGrantInput): Promise<FileReadGrantResult>;
}

export type SendSubscriptionMessageInput = {
  recipientUserId: string;
  templateKey: string;
  payload: Record<string, unknown>;
};

export type SendSubscriptionMessageResult =
  | { ok: true; providerMessageId: string; mutatesBusinessState: false }
  | { ok: false; errorCode: string; mutatesBusinessState: false };

export interface SubscriptionMessageProvider {
  send(input: SendSubscriptionMessageInput): Promise<SendSubscriptionMessageResult>;
}
```

Create `apps/api/src/providers/fake-providers.ts`:

```ts
import type {
  ContentSafetyProvider,
  ContentSafetyResult,
  CreateReadGrantInput,
  FileReadGrantResult,
  ObjectStorageProvider,
  ProviderMode,
  SendSubscriptionMessageInput,
  SendSubscriptionMessageResult,
  SubscriptionMessageProvider,
  WechatAuthProvider,
  WechatIdentityResult
} from "./provider-contracts.js";

type FakeProviderOptions = {
  mode?: ProviderMode;
};

export class FakeWechatAuthProvider implements WechatAuthProvider {
  constructor(private readonly options: FakeProviderOptions = {}) {}

  async exchangeCode(code: string): Promise<WechatIdentityResult> {
    if (this.options.mode === "failure" || !code.startsWith("mock_openid_")) {
      return {
        ok: false,
        errorCode: "WECHAT_AUTH_FAILED",
        failureClosesBusiness: true
      };
    }

    return { ok: true, openid: code };
  }
}

export class FakeContentSafetyProvider implements ContentSafetyProvider {
  constructor(private readonly options: FakeProviderOptions = {}) {}

  async reviewText(text: string): Promise<ContentSafetyResult> {
    if (this.options.mode === "failure") {
      return {
        ok: false,
        errorCode: "CONTENT_SAFETY_UNAVAILABLE",
        failureClosesBusiness: true
      };
    }

    if (/电话|手机号|微信|二维码/.test(text)) {
      return {
        ok: true,
        riskLevel: "high",
        labels: ["contact_info"]
      };
    }

    if (/刀|枪|药/.test(text)) {
      return {
        ok: true,
        riskLevel: "severe",
        labels: ["prohibited_item"]
      };
    }

    return { ok: true, riskLevel: "low", labels: [] };
  }
}

export class FakeObjectStorageProvider implements ObjectStorageProvider {
  constructor(private readonly options: FakeProviderOptions = {}) {}

  async createReadGrant(input: CreateReadGrantInput): Promise<FileReadGrantResult> {
    if (this.options.mode === "failure") {
      return {
        ok: false,
        errorCode: "OBJECT_STORAGE_UNAVAILABLE",
        failureClosesBusiness: true
      };
    }

    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();

    return {
      ok: true,
      url: `https://private.local/grants/${input.mediaAssetId}?user=${input.granteeUserId}&purpose=${input.purpose}`,
      expiresAt
    };
  }
}

export class FakeSubscriptionMessageProvider implements SubscriptionMessageProvider {
  constructor(private readonly options: FakeProviderOptions = {}) {}

  async send(
    input: SendSubscriptionMessageInput
  ): Promise<SendSubscriptionMessageResult> {
    if (this.options.mode === "failure") {
      return {
        ok: false,
        errorCode: "SUBSCRIPTION_MESSAGE_FAILED",
        mutatesBusinessState: false
      };
    }

    return {
      ok: true,
      providerMessageId: `fake_${input.recipientUserId}_${input.templateKey}`,
      mutatesBusinessState: false
    };
  }
}
```

- [ ] **Step 3: Run provider tests**

Run: `npm test -- apps/api/test/contracts/provider-contracts.test.ts`

Expected: PASS.

## Task 5: NestJS API Skeleton

**Files:**
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health.controller.ts`

- [ ] **Step 1: Add minimal NestJS app**

Create a root module and `/health` controller returning `{ "status": "ok" }`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 6: Verification And Commit

**Files:**
- Modify: all files from tasks 1-5.

- [ ] **Step 1: Run full checks**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npx prisma validate --schema apps/api/prisma/schema.prisma`

Expected: PASS.

- [ ] **Step 2: Commit phase 1 foundation**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts apps packages docs/superpowers/plans/2026-05-26-stage1-foundation.md
git commit -m "feat: scaffold stage 1 foundation"
```

Expected: commit succeeds on `feature/stage1-foundation`.

## Self-Review

- Spec coverage: covers stage 1 workspace, shared contracts, schema foundation, fake providers, API skeleton, and first contract-test targets from `docs/IMPLEMENTATION_CONTRACTS.md`.
- Placeholder scan: the plan contains concrete file paths, commands, schema content, provider interfaces, fake provider implementations, and test content for the first foundation slice.
- Type consistency: shared exports use `@auction/shared`; API tests import that alias; TypeScript path config maps the alias to shared source.
