import type {
  PointAdjustmentRequest,
  PointAdjustmentRequestType,
  PointAdjustmentStatus,
  PointLedgerEntryType,
  Prisma,
  PrismaClient
} from "@prisma/client";
import { createHash } from "node:crypto";
import {
  SensitiveOperationService,
  SensitiveOperationType
} from "../accounts/sensitive-operation.service.js";
import { AppConfigService } from "../config/app-config.service.js";
import { runCriticalTransaction } from "../prisma/critical-transaction.js";

type AdjustmentDecision = "approve" | "reject";
type GuardianRequestType = Extract<
  PointAdjustmentRequestType,
  "correction" | "activity_reward"
>;
type AdminRequestType = Extract<
  PointAdjustmentRequestType,
  "correction" | "admin_award" | "admin_penalty" | "batch_award"
>;

type IdempotencyReservation<T> =
  | { result: "reserved"; id: string }
  | { result: "replay"; response: T }
  | { result: "conflict" };

type PlatformAdminAuthorizationResult =
  | { result: "accepted" }
  | { result: "rejected"; errorCode: "PLATFORM_ADMIN_REQUIRED" };

export type CreateGuardianAdjustmentRequestInput = {
  actorUserId: string;
  childId: string;
  requestType: GuardianRequestType;
  requestedPoints: number;
  reason: string;
  idempotencyKey: string;
  now?: Date;
};

export type CreateAdminAdjustmentRequestInput = {
  platformAdminUserId: string;
  childId: string;
  requestType: AdminRequestType;
  requestedPoints: number;
  reason: string;
  idempotencyKey: string;
  batchKey?: string;
  now?: Date;
};

export type ReviewAdjustmentRequestInput = {
  platformAdminUserId: string;
  sessionId: string;
  requestId: string;
  decision: AdjustmentDecision;
  reviewReason: string;
  challengeId?: string;
  idempotencyKey: string;
  now?: Date;
};

export type CreateAdjustmentRequestResult =
  | {
      result: "accepted";
      requestId: string;
      status: PointAdjustmentStatus;
      requiresSecondReview: boolean;
    }
  | {
      result: "rejected";
      errorCode:
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "IDEMPOTENCY_CONFLICT"
        | "INVALID_POINT_AMOUNT"
        | "POINT_REASON_REQUIRED"
        | "PRIMARY_GUARDIAN_REQUIRED"
        | "CHILD_NOT_ACTIVE"
        | "GUARDIAN_DISPUTE_FROZEN"
        | "RISK_RESTRICTED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "POINT_ACCOUNT_NOT_FOUND";
    };

export type ReviewAdjustmentRequestResult =
  | {
      result: "accepted";
      requestId: string;
      status: PointAdjustmentStatus;
      ledgerEntryId: string | null;
      availablePoints?: number;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode:
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "IDEMPOTENCY_CONFLICT"
        | "POINT_ADJUSTMENT_REQUEST_NOT_FOUND"
        | "POINT_ADJUSTMENT_REQUEST_NOT_PENDING"
        | "PLATFORM_ADMIN_REQUIRED"
        | "SENSITIVE_CHALLENGE_REQUIRED"
        | "SENSITIVE_CHALLENGE_EXPIRED"
        | "SESSION_REVOKED"
        | "DEVICE_NOT_TRUSTED"
        | "SECOND_REVIEWER_REQUIRED"
        | "INSUFFICIENT_AVAILABLE_POINTS";
    };

export type PointSummary = {
  result: "accepted";
  childId: string;
  availablePoints: number;
  frozenPoints: number;
  totalEarnedPoints: number;
  totalSpentPoints: number;
  totalAwardedPoints: number;
  totalPenaltyPoints: number;
};

export type PointReadRejected = {
  result: "rejected";
  errorCode: "POINT_ACCOUNT_ACCESS_DENIED" | "POINT_ACCOUNT_NOT_FOUND";
};

export type PointLedgerEntryRow = {
  id: string;
  type: string;
  amountPoints: number;
  availableAfter: number;
  frozenAfter: number;
  relatedType: string;
  relatedId: string;
  reason: string | null;
  createdAt: string;
};

export type PointLedgerEntriesResult =
  | {
      result: "accepted";
      childId: string;
      entries: PointLedgerEntryRow[];
    }
  | PointReadRejected;

export type PointAdjustmentRequestRow = {
  id: string;
  source: string;
  requestType: string;
  status: string;
  childId: string;
  requestedPoints: number;
  requiresSecondReview: boolean;
  createdAt: string;
};

export type ListPointAdjustmentRequestsResult =
  | {
      result: "accepted";
      requests: PointAdjustmentRequestRow[];
    }
  | {
      result: "rejected";
      errorCode: "PLATFORM_ADMIN_REQUIRED";
    };

export class PointLedgerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sensitiveOperations?: SensitiveOperationService,
    private readonly config: AppConfigService = new AppConfigService()
  ) {}

  async getChildPointSummary(input: {
    actorUserId: string;
    childId: string;
  }): Promise<PointSummary | PointReadRejected> {
    if (!(await this.canReadChildPoints(input.actorUserId, input.childId))) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_ACCESS_DENIED" };
    }

    const account = await this.prisma.pointAccount.findUnique({
      where: { childId: input.childId }
    });

    if (!account) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_NOT_FOUND" };
    }

    return {
      result: "accepted",
      childId: input.childId,
      availablePoints: account.availablePoints,
      frozenPoints: account.frozenPoints,
      totalEarnedPoints: account.totalEarnedPoints,
      totalSpentPoints: account.totalSpentPoints,
      totalAwardedPoints: account.totalAwardedPoints,
      totalPenaltyPoints: account.totalPenaltyPoints
    };
  }

  async listChildLedgerEntries(input: {
    actorUserId: string;
    childId: string;
    limit?: number;
  }): Promise<PointLedgerEntriesResult> {
    if (!(await this.canReadChildPoints(input.actorUserId, input.childId))) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_ACCESS_DENIED" };
    }

    const account = await this.prisma.pointAccount.findUnique({
      where: { childId: input.childId },
      select: { id: true }
    });
    if (!account) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_NOT_FOUND" };
    }

    const entries = await this.prisma.pointLedgerEntry.findMany({
      where: { childId: input.childId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(input.limit ?? 50, 1), 100),
      select: {
        id: true,
        type: true,
        amountPoints: true,
        availableAfter: true,
        frozenAfter: true,
        relatedType: true,
        relatedId: true,
        reason: true,
        createdAt: true
      }
    });

    return {
      result: "accepted",
      childId: input.childId,
      entries: entries.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }

  async listAdjustmentRequests(input: {
    platformAdminUserId: string;
    status?: PointAdjustmentStatus;
    limit?: number;
  }): Promise<ListPointAdjustmentRequestsResult> {
    const authorization = await this.authorizePlatformAdmin({
      platformAdminUserId: input.platformAdminUserId
    });
    if (authorization.result === "rejected") {
      return authorization;
    }

    const rows = await this.prisma.pointAdjustmentRequest.findMany({
      where: input.status ? { status: input.status } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(input.limit ?? 50, 1), 100),
      select: {
        id: true,
        source: true,
        requestType: true,
        status: true,
        childId: true,
        requestedPoints: true,
        requiresSecondReview: true,
        createdAt: true
      }
    });

    return {
      result: "accepted",
      requests: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString()
      }))
    };
  }

  async authorizePlatformAdmin(
    input: { platformAdminUserId: string }
  ): Promise<PlatformAdminAuthorizationResult> {
    if (
      !(await this.isActiveMfaPlatformAdmin(
        this.prisma,
        input.platformAdminUserId
      ))
    ) {
      return { result: "rejected", errorCode: "PLATFORM_ADMIN_REQUIRED" };
    }

    return { result: "accepted" };
  }

  async createGuardianAdjustmentRequest(
    input: CreateGuardianAdjustmentRequestInput
  ): Promise<CreateAdjustmentRequestResult> {
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      childId: input.childId,
      requestType: input.requestType,
      requestedPoints: String(input.requestedPoints),
      reason: input.reason
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency = await reserveIdempotencyRecord<CreateAdjustmentRequestResult>(
        tx,
        {
          key: input.idempotencyKey,
          actorUserId: input.actorUserId,
          action: "point_adjustment_request.create_guardian",
          targetType: "child_profile",
          targetId: input.childId,
          requestHash
        }
      );

      if (idempotency.result === "conflict") {
        return { result: "rejected", errorCode: "IDEMPOTENCY_CONFLICT" };
      }
      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const rejected = await this.validateGuardianAdjustmentRequest(tx, input, now);
      if (rejected) {
        return completeIdempotency(tx, idempotency.id, rejected);
      }

      const primaryLink = await this.findPrimaryGuardianLink(tx, {
        actorUserId: input.actorUserId,
        childId: input.childId
      });
      if (!primaryLink) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "PRIMARY_GUARDIAN_REQUIRED"
        });
      }

      const created = await tx.pointAdjustmentRequest.create({
        data: {
          source: "guardian_request",
          requestType: input.requestType,
          status: "pending_review",
          childId: input.childId,
          guardianId: primaryLink.guardianId,
          requestedByUserId: input.actorUserId,
          requestedPoints: input.requestedPoints,
          reason: input.reason.trim(),
          requiresSecondReview: requiresSecondReview(
            input.requestType,
            input.requestedPoints,
            this.config.pointAdjustmentSingleReviewLimit
          ),
          idempotencyKey: input.idempotencyKey,
          createdAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "point_adjustment_request.create_guardian",
          targetType: "point_adjustment_request",
          targetId: created.id,
          reason: input.reason.trim(),
          afterJson: {
            childId: input.childId,
            requestType: input.requestType,
            requestedPoints: input.requestedPoints
          }
        }
      });

      return completeIdempotency(tx, idempotency.id, {
        result: "accepted",
        requestId: created.id,
        status: created.status,
        requiresSecondReview: created.requiresSecondReview
      });
    });
  }

  async createAdminAdjustmentRequest(
    input: CreateAdminAdjustmentRequestInput
  ): Promise<CreateAdjustmentRequestResult> {
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      platformAdminUserId: input.platformAdminUserId,
      childId: input.childId,
      requestType: input.requestType,
      requestedPoints: String(input.requestedPoints),
      reason: input.reason,
      batchKey: input.batchKey ?? ""
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency = await reserveIdempotencyRecord<CreateAdjustmentRequestResult>(
        tx,
        {
          key: input.idempotencyKey,
          actorUserId: input.platformAdminUserId,
          action: "point_adjustment_request.create_admin",
          targetType: "child_profile",
          targetId: input.childId,
          requestHash
        }
      );

      if (idempotency.result === "conflict") {
        return { result: "rejected", errorCode: "IDEMPOTENCY_CONFLICT" };
      }
      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const rejected = await this.validateAdminAdjustmentRequest(tx, input);
      if (rejected) {
        return completeIdempotency(tx, idempotency.id, rejected);
      }

      const created = await tx.pointAdjustmentRequest.create({
        data: {
          source: "admin_initiated",
          requestType: input.requestType,
          status: "pending_review",
          childId: input.childId,
          requestedByUserId: input.platformAdminUserId,
          requestedPoints: input.requestedPoints,
          reason: input.reason.trim(),
          requiresSecondReview: requiresSecondReview(
            input.requestType,
            input.requestedPoints,
            this.config.pointAdjustmentSingleReviewLimit,
            input.batchKey
          ),
          batchKey: input.batchKey,
          idempotencyKey: input.idempotencyKey,
          createdAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.platformAdminUserId,
          action: "point_adjustment_request.create_admin",
          targetType: "point_adjustment_request",
          targetId: created.id,
          reason: input.reason.trim(),
          afterJson: {
            childId: input.childId,
            requestType: input.requestType,
            requestedPoints: input.requestedPoints,
            requiresSecondReview: created.requiresSecondReview,
            batchKey: input.batchKey ?? null
          }
        }
      });

      return completeIdempotency(tx, idempotency.id, {
        result: "accepted",
        requestId: created.id,
        status: created.status,
        requiresSecondReview: created.requiresSecondReview
      });
    });
  }

  async reviewAdjustmentRequest(
    input: ReviewAdjustmentRequestInput
  ): Promise<ReviewAdjustmentRequestResult> {
    return this.reviewRequest(input, "point_adjustment_request.review", false);
  }

  async secondReviewAdjustmentRequest(
    input: ReviewAdjustmentRequestInput
  ): Promise<ReviewAdjustmentRequestResult> {
    return this.reviewRequest(input, "point_adjustment_request.second_review", true);
  }

  private async reviewRequest(
    input: ReviewAdjustmentRequestInput,
    action: string,
    secondReview: boolean
  ): Promise<ReviewAdjustmentRequestResult> {
    if (!input.idempotencyKey.trim()) {
      return { result: "rejected", errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      platformAdminUserId: input.platformAdminUserId,
      requestId: input.requestId,
      decision: input.decision,
      reviewReason: input.reviewReason,
      challengeId: input.challengeId ?? "",
      secondReview: String(secondReview)
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency =
        await reserveIdempotencyRecord<ReviewAdjustmentRequestResult>(tx, {
          key: input.idempotencyKey,
          actorUserId: input.platformAdminUserId,
          action,
          targetType: "point_adjustment_request",
          targetId: input.requestId,
          requestHash
        });

      if (idempotency.result === "conflict") {
        return { result: "rejected", errorCode: "IDEMPOTENCY_CONFLICT" };
      }
      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const adminRejected = await this.validatePlatformAdmin(tx, {
        platformAdminUserId: input.platformAdminUserId
      });
      if (adminRejected) {
        return completeIdempotency(tx, idempotency.id, adminRejected);
      }

      const sensitiveRejected = await this.authorizePointAdjustmentChallenge(input, now);
      if (sensitiveRejected) {
        return completeIdempotency(tx, idempotency.id, sensitiveRejected);
      }

      const request = await lockPointAdjustmentRequest(tx, input.requestId);
      if (!request) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "POINT_ADJUSTMENT_REQUEST_NOT_FOUND"
        });
      }

      if (!secondReview && request.status !== "pending_review") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "POINT_ADJUSTMENT_REQUEST_NOT_PENDING"
        });
      }

      if (secondReview && request.status !== "pending_second_review") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "POINT_ADJUSTMENT_REQUEST_NOT_PENDING"
        });
      }

      if (
        secondReview &&
        (request.requestedByUserId === input.platformAdminUserId ||
          request.reviewedByUserId === input.platformAdminUserId)
      ) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "SECOND_REVIEWER_REQUIRED"
        });
      }

      if (input.decision === "reject") {
        const rejected = await this.rejectRequest(tx, {
          request,
          input,
          now,
          secondReview
        });
        return completeIdempotency(tx, idempotency.id, rejected);
      }

      if (!secondReview && request.requiresSecondReview) {
        const updated = await tx.pointAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: "pending_second_review",
            reviewedByUserId: input.platformAdminUserId,
            reviewedAt: now,
            reviewReason: input.reviewReason.trim()
          }
        });

        const response = {
          result: "accepted" as const,
          requestId: updated.id,
          status: updated.status,
          ledgerEntryId: null,
          idempotencyKey: input.idempotencyKey
        };
        await tx.auditLog.create({
          data: {
            actorUserId: input.platformAdminUserId,
            action: "point_adjustment_request.review_requires_second_review",
            targetType: "point_adjustment_request",
            targetId: request.id,
            reason: input.reviewReason.trim()
          }
        });
        return completeIdempotency(tx, idempotency.id, response);
      }

      const posted = await this.postApprovedAdjustment(tx, {
        request,
        input,
        now,
        secondReview
      });
      if (posted.result === "rejected") {
        return completeIdempotency(tx, idempotency.id, posted);
      }

      return completeIdempotency(tx, idempotency.id, posted);
    });
  }

  private async validateGuardianAdjustmentRequest(
    tx: Prisma.TransactionClient,
    input: CreateGuardianAdjustmentRequestInput,
    now: Date
  ): Promise<CreateAdjustmentRequestResult | null> {
    if (!isValidPointAmount(input.requestType, input.requestedPoints)) {
      return { result: "rejected", errorCode: "INVALID_POINT_AMOUNT" };
    }

    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "POINT_REASON_REQUIRED" };
    }

    const child = await tx.childProfile.findUnique({
      where: { id: input.childId },
      select: { status: true, pointAccount: { select: { id: true } } }
    });
    if (!child || child.status !== "active") {
      return { result: "rejected", errorCode: "CHILD_NOT_ACTIVE" };
    }
    if (!child.pointAccount) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_NOT_FOUND" };
    }

    if (await hasFrozenGuardianDispute(tx, input.childId)) {
      return { result: "rejected", errorCode: "GUARDIAN_DISPUTE_FROZEN" };
    }

    if (await hasActiveSuspension(tx, input.actorUserId, input.childId, now)) {
      return { result: "rejected", errorCode: "RISK_RESTRICTED" };
    }

    return null;
  }

  private async validateAdminAdjustmentRequest(
    tx: Prisma.TransactionClient,
    input: CreateAdminAdjustmentRequestInput
  ): Promise<CreateAdjustmentRequestResult | null> {
    const adminRejected = await this.validatePlatformAdmin(tx, {
      platformAdminUserId: input.platformAdminUserId
    });
    if (adminRejected) {
      return adminRejected;
    }

    if (!isValidPointAmount(input.requestType, input.requestedPoints)) {
      return { result: "rejected", errorCode: "INVALID_POINT_AMOUNT" };
    }

    if (!input.reason.trim()) {
      return { result: "rejected", errorCode: "POINT_REASON_REQUIRED" };
    }

    const child = await tx.childProfile.findUnique({
      where: { id: input.childId },
      select: { status: true, pointAccount: { select: { id: true } } }
    });
    if (!child || child.status !== "active") {
      return { result: "rejected", errorCode: "CHILD_NOT_ACTIVE" };
    }
    if (!child.pointAccount) {
      return { result: "rejected", errorCode: "POINT_ACCOUNT_NOT_FOUND" };
    }

    return null;
  }

  private async validatePlatformAdmin(
    tx: Prisma.TransactionClient,
    input: { platformAdminUserId: string }
  ): Promise<{ result: "rejected"; errorCode: "PLATFORM_ADMIN_REQUIRED" } | null> {
    if (!(await this.isActiveMfaPlatformAdmin(tx, input.platformAdminUserId))) {
      return { result: "rejected", errorCode: "PLATFORM_ADMIN_REQUIRED" };
    }

    return null;
  }

  private async canReadChildPoints(
    actorUserId: string,
    childId: string
  ): Promise<boolean> {
    const primaryGuardian = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId,
        role: "primary",
        status: "active",
        guardian: {
          userId: actorUserId,
          status: "active"
        },
        child: {
          status: "active"
        }
      },
      select: { id: true }
    });
    if (primaryGuardian) {
      return true;
    }

    return this.isActiveMfaPlatformAdmin(this.prisma, actorUserId);
  }

  private async isActiveMfaPlatformAdmin(
    client: PrismaClient | Prisma.TransactionClient,
    userId: string
  ): Promise<boolean> {
    const admin = await client.adminProfile.findUnique({
      where: { userId },
      select: { role: true, status: true, mfaEnabled: true }
    });

    return (
      admin?.role === "platform_admin" &&
      admin.status === "active" &&
      admin.mfaEnabled
    );
  }

  private async authorizePointAdjustmentChallenge(
    input: ReviewAdjustmentRequestInput,
    now: Date
  ): Promise<ReviewAdjustmentRequestResult | null> {
    if (!this.sensitiveOperations) {
      return { result: "rejected", errorCode: "SENSITIVE_CHALLENGE_REQUIRED" };
    }

    const authorization = await this.sensitiveOperations.authorizeFreshChallenge({
      actorUserId: input.platformAdminUserId,
      sessionId: input.sessionId,
      operationType: SensitiveOperationType.adjustPoints,
      targetType: "point_adjustment_request",
      targetId: input.requestId,
      challengeId: input.challengeId,
      now
    });

    if (authorization.result === "accepted") {
      return null;
    }

    return {
      result: "rejected",
      errorCode: authorization.errorCode
    };
  }

  private async findPrimaryGuardianLink(
    tx: Prisma.TransactionClient,
    input: { actorUserId: string; childId: string }
  ) {
    return tx.guardianChildLink.findFirst({
      where: {
        childId: input.childId,
        role: "primary",
        status: "active",
        guardian: {
          userId: input.actorUserId,
          status: "active"
        }
      },
      select: {
        guardianId: true
      }
    });
  }

  private async rejectRequest(
    tx: Prisma.TransactionClient,
    input: {
      request: PointAdjustmentRequest;
      input: ReviewAdjustmentRequestInput;
      now: Date;
      secondReview: boolean;
    }
  ): Promise<ReviewAdjustmentRequestResult> {
    const updated = await tx.pointAdjustmentRequest.update({
      where: { id: input.request.id },
      data: input.secondReview
        ? {
            status: "rejected",
            secondReviewedByUserId: input.input.platformAdminUserId,
            secondReviewedAt: input.now,
            secondReviewReason: input.input.reviewReason.trim(),
            decidedAt: input.now
          }
        : {
            status: "rejected",
            reviewedByUserId: input.input.platformAdminUserId,
            reviewedAt: input.now,
            reviewReason: input.input.reviewReason.trim(),
            decidedAt: input.now
          }
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.input.platformAdminUserId,
        action: input.secondReview
          ? "point_adjustment_request.second_review_reject"
          : "point_adjustment_request.review_reject",
        targetType: "point_adjustment_request",
        targetId: input.request.id,
        reason: input.input.reviewReason.trim()
      }
    });

    return {
      result: "accepted",
      requestId: updated.id,
      status: updated.status,
      ledgerEntryId: null,
      idempotencyKey: input.input.idempotencyKey
    };
  }

  private async postApprovedAdjustment(
    tx: Prisma.TransactionClient,
    input: {
      request: PointAdjustmentRequest;
      input: ReviewAdjustmentRequestInput;
      now: Date;
      secondReview: boolean;
    }
  ): Promise<ReviewAdjustmentRequestResult> {
    const account = await lockPointAccount(tx, input.request.childId);
    if (!account) {
      return {
        result: "rejected",
        errorCode: "POINT_ADJUSTMENT_REQUEST_NOT_FOUND"
      };
    }

    const availableAfter = account.availablePoints + input.request.requestedPoints;
    if (availableAfter < 0) {
      return {
        result: "rejected",
        errorCode: "INSUFFICIENT_AVAILABLE_POINTS"
      };
    }

    const entryType = ledgerEntryTypeFor(input.request.requestType);
    const ledgerEntry = await tx.pointLedgerEntry.create({
      data: {
        accountId: account.id,
        childId: input.request.childId,
        type: entryType,
        amountPoints: input.request.requestedPoints,
        availableAfter,
        frozenAfter: account.frozenPoints,
        relatedType: "point_adjustment_request",
        relatedId: input.request.id,
        idempotencyKey: `point_adjustment:${input.request.id}:approve`,
        reason: input.input.reviewReason.trim(),
        createdByUserId: input.input.platformAdminUserId,
        createdAt: input.now
      }
    });

    await tx.pointAccount.update({
      where: { id: account.id },
      data: {
        availablePoints: availableAfter,
        totalEarnedPoints:
          input.request.requestedPoints > 0
            ? { increment: input.request.requestedPoints }
            : undefined,
        totalSpentPoints:
          input.request.requestedPoints < 0
            ? { increment: Math.abs(input.request.requestedPoints) }
            : undefined,
        totalAwardedPoints:
          entryType === "admin_award"
            ? { increment: input.request.requestedPoints }
            : undefined,
        totalPenaltyPoints:
          entryType === "admin_penalty"
            ? { increment: Math.abs(input.request.requestedPoints) }
            : undefined
      }
    });

    const updated = await tx.pointAdjustmentRequest.update({
      where: { id: input.request.id },
      data: input.secondReview
        ? {
            status: "approved",
            secondReviewedByUserId: input.input.platformAdminUserId,
            secondReviewedAt: input.now,
            secondReviewReason: input.input.reviewReason.trim(),
            decidedAt: input.now,
            ledgerEntryId: ledgerEntry.id
          }
        : {
            status: "approved",
            reviewedByUserId: input.input.platformAdminUserId,
            reviewedAt: input.now,
            reviewReason: input.input.reviewReason.trim(),
            decidedAt: input.now,
            ledgerEntryId: ledgerEntry.id
          }
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.input.platformAdminUserId,
        action: input.secondReview
          ? "point_adjustment_request.second_review_approve"
          : "point_adjustment_request.review_approve",
        targetType: "point_adjustment_request",
        targetId: input.request.id,
        reason: input.input.reviewReason.trim(),
        afterJson: {
          ledgerEntryId: ledgerEntry.id,
          availableAfter
        }
      }
    });

    return {
      result: "accepted",
      requestId: updated.id,
      status: updated.status,
      ledgerEntryId: ledgerEntry.id,
      availablePoints: availableAfter,
      idempotencyKey: input.input.idempotencyKey
    };
  }
}

async function reserveIdempotencyRecord<T>(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestHash: string;
  }
): Promise<IdempotencyReservation<T>> {
  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      key_actorUserId_action_targetType_targetId: {
        key: input.key,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId
      }
    },
    select: {
      id: true,
      requestHash: true,
      status: true,
      responseJson: true
    }
  });

  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      return { result: "conflict" };
    }

    if (existing.status === "completed" && existing.responseJson) {
      return {
        result: "replay",
        response: existing.responseJson as T
      };
    }

    return { result: "conflict" };
  }

  const created = await tx.idempotencyRecord.create({
    data: {
      key: input.key,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestHash: input.requestHash,
      status: "processing"
    },
    select: { id: true }
  });

  return {
    result: "reserved",
    id: created.id
  };
}

async function completeIdempotency<T>(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: T
): Promise<T> {
  await tx.idempotencyRecord.update({
    where: { id: idempotencyRecordId },
    data: {
      status: "completed",
      responseJson: response as Prisma.InputJsonValue
    }
  });

  return response;
}

async function lockPointAdjustmentRequest(
  tx: Prisma.TransactionClient,
  requestId: string
): Promise<PointAdjustmentRequest | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PointAdjustmentRequest"
    WHERE "id" = ${requestId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    return null;
  }

  return tx.pointAdjustmentRequest.findUnique({
    where: { id: requestId }
  });
}

async function lockPointAccount(tx: Prisma.TransactionClient, childId: string) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      childId: string;
      availablePoints: number;
      frozenPoints: number;
      totalEarnedPoints: number;
      totalSpentPoints: number;
      totalAwardedPoints: number;
      totalPenaltyPoints: number;
    }>
  >`
    SELECT
      "id",
      "childId",
      "availablePoints",
      "frozenPoints",
      "totalEarnedPoints",
      "totalSpentPoints",
      "totalAwardedPoints",
      "totalPenaltyPoints"
    FROM "PointAccount"
    WHERE "childId" = ${childId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

function requiresSecondReview(
  requestType: PointAdjustmentRequestType,
  requestedPoints: number,
  singleReviewLimit: number,
  batchKey?: string
): boolean {
  return (
    Boolean(batchKey) ||
    requestType === "batch_award" ||
    requestType === "correction" ||
    Math.abs(requestedPoints) > singleReviewLimit
  );
}

function isValidPointAmount(
  requestType: PointAdjustmentRequestType,
  requestedPoints: number
): boolean {
  if (!Number.isInteger(requestedPoints) || requestedPoints === 0) {
    return false;
  }

  if (
    requestType === "activity_reward" ||
    requestType === "admin_award" ||
    requestType === "batch_award"
  ) {
    return requestedPoints > 0;
  }

  if (requestType === "admin_penalty") {
    return requestedPoints < 0;
  }

  return true;
}

function ledgerEntryTypeFor(
  requestType: PointAdjustmentRequestType
): PointLedgerEntryType {
  if (requestType === "admin_penalty") {
    return "admin_penalty";
  }

  if (requestType === "correction") {
    return "correction";
  }

  return "admin_award";
}

async function hasFrozenGuardianDispute(
  tx: Prisma.TransactionClient,
  childId: string
): Promise<boolean> {
  return Boolean(
    await tx.guardianDispute.findFirst({
      where: {
        childId,
        status: {
          in: ["pending_platform_review", "frozen"]
        }
      },
      select: { id: true }
    })
  );
}

async function hasActiveSuspension(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  childId: string,
  now: Date
): Promise<boolean> {
  const child = await tx.childProfile.findUnique({
    where: { id: childId },
    select: {
      guardianLinks: {
        where: {
          role: "primary",
          status: "active"
        },
        select: {
          guardianId: true
        },
        take: 1
      }
    }
  });
  const guardianId = child?.guardianLinks[0]?.guardianId;
  const restriction = await tx.riskRestriction.findFirst({
    where: {
      status: "active",
      type: "suspended",
      startsAt: {
        lte: now
      },
      OR: [
        { expiresAt: null },
        {
          expiresAt: {
            gt: now
          }
        }
      ],
      AND: [
        {
          OR: [
            { scope: "user", targetUserId: actorUserId },
            { scope: "child", childId },
            ...(guardianId ? [{ scope: "guardian" as const, guardianId }] : [])
          ]
        }
      ]
    },
    select: { id: true }
  });

  return Boolean(restriction);
}

function createStableHash(value: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
