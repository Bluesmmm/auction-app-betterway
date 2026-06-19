import { Prisma } from "@prisma/client";
import type {
  DecisionPhase,
  DecisionValue,
  DeliveryMethod,
  GuardianRole,
  PrismaClient,
  TransactionStatus
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { runCriticalTransaction } from "../prisma/critical-transaction.js";
import type { GovernanceControlService } from "../stage8/governance-control.service.js";
import { AuctionPermissionsService } from "./auction-permissions.service.js";

type DecisionSide = "buyer" | "seller";

type IdempotencyReservation<T> =
  | { result: "reserved"; id: string }
  | { result: "replay"; response: T }
  | { result: "conflict" };

type TransactionDecisionRejectedErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_NOT_IN_GUARDIAN_CONFIRM"
  | "TRANSACTION_NOT_IN_DELIVERY_CONFIRM"
  | "PRIMARY_GUARDIAN_REQUIRED"
  | "SIDE_ALREADY_DECIDED"
  | "GUARDIAN_CONFIRM_DEADLINE_EXPIRED"
  | "DELIVERY_CONFIRM_DEADLINE_EXPIRED"
  | "POINT_HOLD_NOT_FOUND"
  | "POINT_ACCOUNT_NOT_FOUND"
  | "SELLER_POINT_ACCOUNT_NOT_FOUND"
  | "SELLER_DELIVERY_PROPOSAL_REQUIRED"
  | "DELIVERY_METHOD_REQUIRED"
  | "DELIVERY_METHOD_NOT_ALLOWED"
  | "DELIVERY_POINT_NOT_AVAILABLE"
  | "GUARDIAN_ARRANGED_DELIVERY_NOT_ALLOWED"
  | "GOVERNANCE_CONTROL_ACTIVE";

type AdminDisputeResolutionRejectedErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_NOT_IN_DISPUTE_REVIEW"
  | "COMMUNITY_ADMIN_REQUIRED";

type TransactionDetailRejectedErrorCode =
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_ACCESS_DENIED";

export type AdminDisputeResolutionAction =
  | "release_to_buyer"
  | "transfer_to_seller"
  | "keep_frozen_for_platform_review";

export type TransactionDecisionResult =
  | {
      result: "accepted";
      transactionId: string;
      phase: DecisionPhase;
      value: DecisionValue;
      side: DecisionSide;
      status: TransactionStatus;
      decisionId: string;
      buyerConfirmed: boolean;
      sellerConfirmed: boolean;
      releasedAmountPoints: number;
      transferredAmountPoints: number;
      deliveryConfirmDeadlineAt: string | null;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode: TransactionDecisionRejectedErrorCode;
    };

export type AdminDisputeResolutionResult =
  | {
      result: "accepted";
      transactionId: string;
      action: AdminDisputeResolutionAction;
      status: TransactionStatus;
      releasedAmountPoints: number;
      transferredAmountPoints: number;
      idempotencyKey: string;
    }
  | {
      result: "rejected";
      errorCode: AdminDisputeResolutionRejectedErrorCode;
    };

export type TransactionDetailResult =
  | {
      result: "accepted";
      transactionId: string;
      auctionSessionId: string;
      communityId: string;
      buyerChildId: string;
      sellerChildId: string;
      pointHoldId: string;
      pointsAmount: number;
      status: TransactionStatus;
      guardianConfirmDeadlineAt: string;
      deliveryConfirmDeadlineAt: string | null;
      version: number;
      deliveryRecord: {
        id: string;
        deliveryMethod: DeliveryMethod;
        deliveryPointId: string | null;
        status: string;
        deadlineAt: string | null;
        deliveryPoint: {
          id: string;
          name: string;
          addressText: string;
          availableTimeText: string;
          status: string;
        } | null;
      } | null;
      decisions: Array<{
        id: string;
        phase: DecisionPhase;
        value: DecisionValue;
        side: DecisionSide | null;
        childId: string | null;
        guardianRole: GuardianRole | null;
        transactionVersion: number | null;
        reason: string | null;
        createdAt: string;
      }>;
    }
  | {
      result: "rejected";
      errorCode: TransactionDetailRejectedErrorCode;
    };

type LockedTransactionRow = {
  id: string;
  auctionSessionId: string;
  buyerChildId: string;
  sellerChildId: string;
  pointHoldId: string;
  pointsAmount: number;
  status: TransactionStatus;
  guardianConfirmDeadlineAt: Date;
  deliveryConfirmDeadlineAt: Date | null;
  version: number;
};

type LockedPointAccountRow = {
  id: string;
  childId: string;
  availablePoints: number;
  frozenPoints: number;
  totalEarnedPoints: number;
  totalSpentPoints: number;
};

type PointHoldRow = {
  id: string;
  accountId: string;
  amountPoints: number;
  status: string;
};

type GuardianAuthorization = {
  side: DecisionSide;
  guardianId: string;
  childId: string;
  guardianRole: GuardianRole;
};

type DecisionState = {
  buyerDecision: DecisionValue | null;
  sellerDecision: DecisionValue | null;
  buyerConfirmed: boolean;
  sellerConfirmed: boolean;
  buyerDecided: boolean;
  sellerDecided: boolean;
};

const DELIVERY_CONFIRM_WINDOW_MS = 72 * 60 * 60 * 1000;

export class TransactionDecisionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly permissions = new AuctionPermissionsService(prisma),
    private readonly governanceControls?: GovernanceControlService
  ) {}

  async getTransactionDetail(input: {
    actorUserId: string;
    transactionId: string;
  }): Promise<TransactionDetailResult> {
    const transaction = await this.prisma.transaction.findUnique({
      where: {
        id: input.transactionId
      },
      select: {
        id: true,
        auctionSessionId: true,
        buyerChildId: true,
        sellerChildId: true,
        pointHoldId: true,
        pointsAmount: true,
        status: true,
        guardianConfirmDeadlineAt: true,
        deliveryConfirmDeadlineAt: true,
        version: true,
        auctionSession: {
          select: {
            item: {
              select: {
                communityId: true
              }
            }
          }
        },
        deliveryRecord: {
          select: {
            id: true,
            deliveryMethod: true,
            deliveryPointId: true,
            status: true,
            deadlineAt: true,
            deliveryPoint: {
              select: {
                id: true,
                name: true,
                addressText: true,
                availableTimeText: true,
                status: true
              }
            }
          }
        },
        decisions: {
          where: {
            effective: true
          },
          orderBy: {
            createdAt: "asc"
          },
          select: {
            id: true,
            phase: true,
            value: true,
            side: true,
            childId: true,
            guardianRole: true,
            transactionVersion: true,
            reason: true,
            createdAt: true
          }
        }
      }
    });

    if (!transaction) {
      return {
        result: "rejected",
        errorCode: "TRANSACTION_NOT_FOUND"
      };
    }

    const canReadAsGuardian = await this.prisma.guardianChildLink.findFirst({
      where: {
        childId: {
          in: [transaction.buyerChildId, transaction.sellerChildId]
        },
        status: "active",
        guardian: {
          userId: input.actorUserId,
          status: "active"
        },
        child: {
          status: "active"
        }
      },
      select: {
        id: true
      }
    });
    if (!canReadAsGuardian) {
      const admin = await this.permissions.canManageCommunityAuction({
        actorUserId: input.actorUserId,
        communityId: transaction.auctionSession.item.communityId
      });
      if (admin.result === "rejected") {
        return {
          result: "rejected",
          errorCode: "TRANSACTION_ACCESS_DENIED"
        };
      }
    }

    return {
      result: "accepted",
      transactionId: transaction.id,
      auctionSessionId: transaction.auctionSessionId,
      communityId: transaction.auctionSession.item.communityId,
      buyerChildId: transaction.buyerChildId,
      sellerChildId: transaction.sellerChildId,
      pointHoldId: transaction.pointHoldId,
      pointsAmount: transaction.pointsAmount,
      status: transaction.status,
      guardianConfirmDeadlineAt:
        transaction.guardianConfirmDeadlineAt.toISOString(),
      deliveryConfirmDeadlineAt:
        transaction.deliveryConfirmDeadlineAt?.toISOString() ?? null,
      version: transaction.version,
      deliveryRecord: transaction.deliveryRecord
        ? {
            id: transaction.deliveryRecord.id,
            deliveryMethod: transaction.deliveryRecord.deliveryMethod,
            deliveryPointId: transaction.deliveryRecord.deliveryPointId,
            status: transaction.deliveryRecord.status,
            deadlineAt:
              transaction.deliveryRecord.deadlineAt?.toISOString() ?? null,
            deliveryPoint: transaction.deliveryRecord.deliveryPoint
          }
        : null,
      decisions: transaction.decisions.map((decision) => ({
        ...decision,
        createdAt: decision.createdAt.toISOString()
      }))
    };
  }

  async decideGuardianConfirmation(input: {
    actorUserId: string;
    transactionId: string;
    value: DecisionValue;
    deliveryMethod?: DeliveryMethod;
    deliveryPointId?: string | null;
    reason?: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<TransactionDecisionResult> {
    return this.decide({
      ...input,
      phase: "guardian_confirm"
    });
  }

  async decideDeliveryConfirmation(input: {
    actorUserId: string;
    transactionId: string;
    value: DecisionValue;
    idempotencyKey: string;
    now?: Date;
  }): Promise<TransactionDecisionResult> {
    return this.decide({
      ...input,
      phase: "delivery_confirm"
    });
  }

  async resolveTransactionDispute(input: {
    actorUserId: string;
    transactionId: string;
    action: AdminDisputeResolutionAction;
    idempotencyKey: string;
    reason: string;
    now?: Date;
  }): Promise<AdminDisputeResolutionResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const reason = normalizeAdminReason(input.reason);
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      transactionId: input.transactionId,
      action: input.action,
      reason
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency =
        await reserveIdempotencyRecord<AdminDisputeResolutionResult>(tx, {
          key: idempotencyKey,
          actorUserId: input.actorUserId,
          action: "transaction.admin_dispute_resolution",
          targetType: "transaction",
          targetId: input.transactionId,
          requestHash
        });

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const transaction = await lockTransaction(tx, input.transactionId);
      if (!transaction) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        });
      }

      if (!canResolveDispute(transaction.status, input.action)) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_IN_DISPUTE_REVIEW"
        });
      }

      const communityId = await loadTransactionCommunityId(
        tx,
        transaction.auctionSessionId
      );
      if (!communityId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        });
      }

      const authorization = await this.permissions.canManageCommunityAuction(
        {
          actorUserId: input.actorUserId,
          communityId
        },
        tx
      );
      if (authorization.result === "rejected") {
        return completeIdempotency(tx, idempotency.id, authorization);
      }

      if (input.action === "release_to_buyer") {
        const releasedAmountPoints = await cancelTransactionAndReleaseHold(tx, {
          transaction,
          actorUserId: input.actorUserId,
          now,
          reason: "admin_release_to_buyer",
          ledgerReason: "transaction_admin_release_to_buyer",
          ledgerIdempotencyKey: `transaction:${transaction.id}:admin_release_to_buyer`,
          auditAction: "transaction.admin_release_to_buyer",
          eventType: "transaction.cancelled",
          payload: {
            adminAction: input.action,
            reason
          }
        });

        return completeIdempotency(tx, idempotency.id, {
          result: "accepted",
          transactionId: transaction.id,
          action: input.action,
          status: "cancelled",
          releasedAmountPoints,
          transferredAmountPoints: 0,
          idempotencyKey
        });
      }

      if (input.action === "transfer_to_seller") {
        await completeTransactionAndTransferPoints(tx, {
          transaction,
          actorUserId: input.actorUserId,
          now,
          transferOutLedgerReason: "transaction_admin_transfer_to_seller_out",
          transferInLedgerReason: "transaction_admin_transfer_to_seller_in",
          transferOutIdempotencyKey: `transaction:${transaction.id}:admin_transfer_to_seller:out`,
          transferInIdempotencyKey: `transaction:${transaction.id}:admin_transfer_to_seller:in`,
          auditAction: "transaction.admin_transfer_to_seller",
          eventType: "transaction.completed",
          payload: {
            adminAction: input.action,
            reason
          }
        });

        return completeIdempotency(tx, idempotency.id, {
          result: "accepted",
          transactionId: transaction.id,
          action: input.action,
          status: "completed",
          releasedAmountPoints: 0,
          transferredAmountPoints: transaction.pointsAmount,
          idempotencyKey
        });
      }

      await tx.transaction.update({
        where: {
          id: transaction.id
        },
        data: {
          status: "platform_review",
          version: {
            increment: 1
          }
        }
      });
      await writeTransactionAuditAndOutbox(tx, {
        actorUserId: input.actorUserId,
        action: "transaction.admin_keep_frozen_for_platform_review",
        eventType: "transaction.platform_review_required",
        transaction,
        status: "platform_review",
        now,
        payload: {
          adminAction: input.action,
          reason
        }
      });

      return completeIdempotency(tx, idempotency.id, {
        result: "accepted",
        transactionId: transaction.id,
        action: input.action,
        status: "platform_review",
        releasedAmountPoints: 0,
        transferredAmountPoints: 0,
        idempotencyKey
      });
    });
  }

  private async decide(input: {
    actorUserId: string;
    transactionId: string;
    phase: DecisionPhase;
    value: DecisionValue;
    deliveryMethod?: DeliveryMethod;
    deliveryPointId?: string | null;
    reason?: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<TransactionDecisionResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        result: "rejected",
        errorCode: "IDEMPOTENCY_KEY_REQUIRED"
      };
    }

    const now = input.now ?? new Date();
    const requestHash = createStableHash({
      actorUserId: input.actorUserId,
      transactionId: input.transactionId,
      phase: input.phase,
      value: input.value,
      deliveryMethod: input.deliveryMethod ?? "",
      deliveryPointId: input.deliveryPointId ?? "",
      reason: normalizeDecisionReason(input.reason)
    });

    return runCriticalTransaction(this.prisma, async (tx) => {
      const idempotency =
        await reserveIdempotencyRecord<TransactionDecisionResult>(tx, {
          key: idempotencyKey,
          actorUserId: input.actorUserId,
          action: buildDecisionAction(input.phase),
          targetType: "transaction",
          targetId: input.transactionId,
          requestHash
        });

      if (idempotency.result === "conflict") {
        return {
          result: "rejected",
          errorCode: "IDEMPOTENCY_CONFLICT"
        };
      }

      if (idempotency.result === "replay") {
        return idempotency.response;
      }

      const transaction = await lockTransaction(tx, input.transactionId);
      if (!transaction) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        });
      }

      const phaseValidation = validateTransactionPhase(
        transaction,
        input.phase,
        now
      );
      if (phaseValidation.result === "rejected") {
        return completeIdempotency(tx, idempotency.id, phaseValidation);
      }

      const communityId = await loadTransactionCommunityId(
        tx,
        transaction.auctionSessionId
      );
      if (!communityId) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        });
      }

      const pausedSettlement = await this.governanceControls?.checkActiveControl(
        {
          controlType: "pause_settlement",
          communityId,
          now
        },
        tx
      );
      if (pausedSettlement?.result === "blocked") {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "GOVERNANCE_CONTROL_ACTIVE"
        });
      }

      const authorization = await loadGuardianAuthorization(tx, {
        actorUserId: input.actorUserId,
        transaction
      });
      if (!authorization) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "PRIMARY_GUARDIAN_REQUIRED"
        });
      }

      const stateBefore = await loadDecisionState(tx, transaction, input.phase);
      if (hasSideDecided(stateBefore, authorization.side)) {
        return completeIdempotency(tx, idempotency.id, {
          result: "rejected",
          errorCode: "SIDE_ALREADY_DECIDED"
        });
      }

      const guardianProposalValidation = await validateGuardianProposal(tx, {
        phase: input.phase,
        value: input.value,
        transaction,
        authorization,
        stateBefore,
        deliveryMethod: input.deliveryMethod,
        deliveryPointId: input.deliveryPointId
      });
      if (guardianProposalValidation.result === "rejected") {
        return completeIdempotency(tx, idempotency.id, guardianProposalValidation);
      }

      const decision = await tx.guardianDecision.create({
        data: {
          transactionId: transaction.id,
          guardianId: authorization.guardianId,
          phase: input.phase,
          value: input.value,
          side: authorization.side,
          childId: authorization.childId,
          guardianRole: authorization.guardianRole,
          transactionVersion: transaction.version,
          reason: normalizeDecisionReason(input.reason) || null,
          effective: true,
          createdAt: now
        },
        select: {
          id: true
        }
      });

      if (input.phase === "guardian_confirm") {
        return completeIdempotency(
          tx,
          idempotency.id,
          await applyGuardianDecision(tx, {
            transaction,
            authorization,
            decisionId: decision.id,
            value: input.value,
            stateBefore,
            deliveryMethod: input.deliveryMethod,
            deliveryPointId: input.deliveryPointId,
            actorUserId: input.actorUserId,
            idempotencyKey,
            now
          })
        );
      }

      return completeIdempotency(
        tx,
        idempotency.id,
        await applyDeliveryDecision(tx, {
          transaction,
          authorization,
          decisionId: decision.id,
          value: input.value,
          stateBefore,
          actorUserId: input.actorUserId,
          idempotencyKey,
          now
        })
      );
    });
  }
}

async function applyGuardianDecision(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    authorization: GuardianAuthorization;
    decisionId: string;
    value: DecisionValue;
    stateBefore: DecisionState;
    deliveryMethod?: DeliveryMethod;
    deliveryPointId?: string | null;
    actorUserId: string;
    idempotencyKey: string;
    now: Date;
  }
): Promise<Extract<TransactionDecisionResult, { result: "accepted" }>> {
  const stateAfter = mergeDecisionState(input.stateBefore, {
    side: input.authorization.side,
    value: input.value
  });

  if (input.value === "rejected") {
    const releasedAmountPoints = await cancelTransactionAndReleaseHold(tx, {
      transaction: input.transaction,
      actorUserId: input.actorUserId,
      now: input.now,
      reason: "guardian_rejected",
      ledgerReason: "transaction_guardian_reject_release",
      ledgerIdempotencyKey: `transaction:${input.transaction.id}:guardian_reject_release`,
      auditAction: "transaction.cancel",
      eventType: "transaction.cancelled",
      payload: {
        reason: "guardian_rejected"
      }
    });

    return buildAcceptedResult({
      transaction: input.transaction,
      phase: "guardian_confirm",
      value: input.value,
      side: input.authorization.side,
      status: "cancelled",
      decisionId: input.decisionId,
      state: stateAfter,
      releasedAmountPoints,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: null,
      idempotencyKey: input.idempotencyKey
    });
  }

  if (input.authorization.side === "seller") {
    await tx.deliveryRecord.create({
      data: {
        transactionId: input.transaction.id,
        deliveryMethod: input.deliveryMethod as DeliveryMethod,
        deliveryPointId: input.deliveryPointId ?? null,
        status: "pending"
      }
    });
  }

  if (stateAfter.buyerConfirmed && stateAfter.sellerConfirmed) {
    const deliveryConfirmDeadlineAt = new Date(
      input.now.getTime() + DELIVERY_CONFIRM_WINDOW_MS
    );
    await tx.transaction.update({
      where: {
        id: input.transaction.id
      },
      data: {
        status: "pending_delivery_confirm",
        deliveryConfirmDeadlineAt,
        version: {
          increment: 1
        }
      }
    });
    await tx.deliveryRecord.update({
      where: {
        transactionId: input.transaction.id
      },
      data: {
        deadlineAt: deliveryConfirmDeadlineAt
      }
    });
    await writeTransactionAuditAndOutbox(tx, {
      actorUserId: input.actorUserId,
      action: "transaction.guardian_confirmed",
      eventType: "transaction.guardian_confirmed",
      transaction: input.transaction,
      status: "pending_delivery_confirm",
      now: input.now,
      payload: {
        deliveryConfirmDeadlineAt: deliveryConfirmDeadlineAt.toISOString()
      }
    });

    return buildAcceptedResult({
      transaction: input.transaction,
      phase: "guardian_confirm",
      value: input.value,
      side: input.authorization.side,
      status: "pending_delivery_confirm",
      decisionId: input.decisionId,
      state: stateAfter,
      releasedAmountPoints: 0,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt,
      idempotencyKey: input.idempotencyKey
    });
  }

  return buildAcceptedResult({
    transaction: input.transaction,
    phase: "guardian_confirm",
    value: input.value,
    side: input.authorization.side,
    status: "pending_guardian_confirm",
    decisionId: input.decisionId,
    state: stateAfter,
    releasedAmountPoints: 0,
    transferredAmountPoints: 0,
    deliveryConfirmDeadlineAt: null,
    idempotencyKey: input.idempotencyKey
  });
}

async function applyDeliveryDecision(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    authorization: GuardianAuthorization;
    decisionId: string;
    value: DecisionValue;
    stateBefore: DecisionState;
    actorUserId: string;
    idempotencyKey: string;
    now: Date;
  }
): Promise<Extract<TransactionDecisionResult, { result: "accepted" }>> {
  const stateAfter = mergeDecisionState(input.stateBefore, {
    side: input.authorization.side,
    value: input.value
  });

  if (input.value === "rejected") {
    await tx.transaction.update({
      where: {
        id: input.transaction.id
      },
      data: {
        status: "disputed",
        version: {
          increment: 1
        }
      }
    });
    await writeTransactionAuditAndOutbox(tx, {
      actorUserId: input.actorUserId,
      action: "transaction.dispute",
      eventType: "transaction.disputed",
      transaction: input.transaction,
      status: "disputed",
      now: input.now,
      payload: {
        rejectedBySide: input.authorization.side
      }
    });

    return buildAcceptedResult({
      transaction: input.transaction,
      phase: "delivery_confirm",
      value: input.value,
      side: input.authorization.side,
      status: "disputed",
      decisionId: input.decisionId,
      state: stateAfter,
      releasedAmountPoints: 0,
      transferredAmountPoints: 0,
      deliveryConfirmDeadlineAt: input.transaction.deliveryConfirmDeadlineAt,
      idempotencyKey: input.idempotencyKey
    });
  }

  if (stateAfter.buyerConfirmed && stateAfter.sellerConfirmed) {
    await completeTransactionAndTransferPoints(tx, {
      transaction: input.transaction,
      actorUserId: input.actorUserId,
      now: input.now,
      transferOutLedgerReason: "transaction_delivery_complete_transfer_out",
      transferInLedgerReason: "transaction_delivery_complete_transfer_in",
      transferOutIdempotencyKey: `transaction:${input.transaction.id}:transfer_out`,
      transferInIdempotencyKey: `transaction:${input.transaction.id}:transfer_in`,
      auditAction: "transaction.complete",
      eventType: "transaction.completed",
      payload: {}
    });

    return buildAcceptedResult({
      transaction: input.transaction,
      phase: "delivery_confirm",
      value: input.value,
      side: input.authorization.side,
      status: "completed",
      decisionId: input.decisionId,
      state: stateAfter,
      releasedAmountPoints: 0,
      transferredAmountPoints: input.transaction.pointsAmount,
      deliveryConfirmDeadlineAt: input.transaction.deliveryConfirmDeadlineAt,
      idempotencyKey: input.idempotencyKey
    });
  }

  return buildAcceptedResult({
    transaction: input.transaction,
    phase: "delivery_confirm",
    value: input.value,
    side: input.authorization.side,
    status: "pending_delivery_confirm",
    decisionId: input.decisionId,
    state: stateAfter,
    releasedAmountPoints: 0,
    transferredAmountPoints: 0,
    deliveryConfirmDeadlineAt: input.transaction.deliveryConfirmDeadlineAt,
    idempotencyKey: input.idempotencyKey
  });
}

async function cancelTransactionAndReleaseHold(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    actorUserId: string;
    now: Date;
    reason: string;
    ledgerReason: string;
    ledgerIdempotencyKey: string;
    auditAction: string;
    eventType: string;
    payload: Record<string, unknown>;
  }
) {
  const pointHold = await lockPointHold(tx, input.transaction.pointHoldId);
  if (!pointHold || pointHold.status !== "active") {
    throw new Error(`Transaction ${input.transaction.id} point hold is missing`);
  }

  const account = await lockPointAccount(tx, pointHold.accountId);
  if (
    !account ||
    account.childId !== input.transaction.buyerChildId ||
    account.frozenPoints < pointHold.amountPoints
  ) {
    throw new Error(
      `Transaction ${input.transaction.id} buyer point account is inconsistent`
    );
  }

  const availableAfter = account.availablePoints + pointHold.amountPoints;
  const frozenAfter = account.frozenPoints - pointHold.amountPoints;
  await tx.pointHold.update({
    where: {
      id: pointHold.id
    },
    data: {
      status: "released",
      releasedAt: input.now
    }
  });
  await tx.pointAccount.update({
    where: {
      id: account.id
    },
    data: {
      availablePoints: availableAfter,
      frozenPoints: frozenAfter
    }
  });
  await tx.pointLedgerEntry.create({
    data: {
      accountId: account.id,
      childId: input.transaction.buyerChildId,
      type: "release",
      amountPoints: pointHold.amountPoints,
      availableAfter,
      frozenAfter,
      relatedType: "transaction",
      relatedId: input.transaction.id,
      idempotencyKey: input.ledgerIdempotencyKey,
      reason: input.ledgerReason,
      createdByUserId: input.actorUserId,
      createdAt: input.now
    }
  });
  await tx.transaction.update({
    where: {
      id: input.transaction.id
    },
    data: {
      status: "cancelled",
      version: {
        increment: 1
      }
    }
  });
  await writeTransactionAuditAndOutbox(tx, {
    actorUserId: input.actorUserId,
    action: input.auditAction,
    eventType: input.eventType,
    transaction: input.transaction,
    status: "cancelled",
    now: input.now,
    payload: {
      reason: input.reason,
      releasedAmountPoints: pointHold.amountPoints,
      ...input.payload
    }
  });

  return pointHold.amountPoints;
}

async function completeTransactionAndTransferPoints(
  tx: Prisma.TransactionClient,
  input: {
    transaction: LockedTransactionRow;
    actorUserId: string;
    now: Date;
    transferOutLedgerReason: string;
    transferInLedgerReason: string;
    transferOutIdempotencyKey: string;
    transferInIdempotencyKey: string;
    auditAction: string;
    eventType: string;
    payload: Record<string, unknown>;
  }
) {
  const pointHold = await lockPointHold(tx, input.transaction.pointHoldId);
  if (!pointHold || pointHold.status !== "active") {
    throw new Error(`Transaction ${input.transaction.id} point hold is missing`);
  }

  const sellerAccount = await tx.pointAccount.findUnique({
    where: {
      childId: input.transaction.sellerChildId
    },
    select: {
      id: true
    }
  });
  if (!sellerAccount) {
    throw new Error(
      `Transaction ${input.transaction.id} seller point account is missing`
    );
  }

  const accounts = await lockPointAccounts(tx, [
    pointHold.accountId,
    sellerAccount.id
  ]);
  const buyerAccount = accounts.find((account) => account.id === pointHold.accountId);
  const lockedSellerAccount = accounts.find(
    (account) => account.id === sellerAccount.id
  );
  if (
    !buyerAccount ||
    buyerAccount.childId !== input.transaction.buyerChildId ||
    buyerAccount.frozenPoints < pointHold.amountPoints
  ) {
    throw new Error(
      `Transaction ${input.transaction.id} buyer point account is inconsistent`
    );
  }

  if (
    !lockedSellerAccount ||
    lockedSellerAccount.childId !== input.transaction.sellerChildId
  ) {
    throw new Error(
      `Transaction ${input.transaction.id} seller point account is inconsistent`
    );
  }

  const buyerFrozenAfter = buyerAccount.frozenPoints - pointHold.amountPoints;
  const sellerAvailableAfter =
    lockedSellerAccount.availablePoints + pointHold.amountPoints;
  await tx.pointHold.update({
    where: {
      id: pointHold.id
    },
    data: {
      status: "transferred",
      transferredAt: input.now
    }
  });
  await tx.pointAccount.update({
    where: {
      id: buyerAccount.id
    },
    data: {
      frozenPoints: buyerFrozenAfter,
      totalSpentPoints: {
        increment: pointHold.amountPoints
      }
    }
  });
  await tx.pointAccount.update({
    where: {
      id: lockedSellerAccount.id
    },
    data: {
      availablePoints: sellerAvailableAfter,
      totalEarnedPoints: {
        increment: pointHold.amountPoints
      }
    }
  });
  await tx.pointLedgerEntry.createMany({
    data: [
      {
        accountId: buyerAccount.id,
        childId: input.transaction.buyerChildId,
        type: "transfer_out",
        amountPoints: pointHold.amountPoints,
        availableAfter: buyerAccount.availablePoints,
        frozenAfter: buyerFrozenAfter,
        relatedType: "transaction",
        relatedId: input.transaction.id,
        idempotencyKey: input.transferOutIdempotencyKey,
        reason: input.transferOutLedgerReason,
        createdByUserId: input.actorUserId,
        createdAt: input.now
      },
      {
        accountId: lockedSellerAccount.id,
        childId: input.transaction.sellerChildId,
        type: "transfer_in",
        amountPoints: pointHold.amountPoints,
        availableAfter: sellerAvailableAfter,
        frozenAfter: lockedSellerAccount.frozenPoints,
        relatedType: "transaction",
        relatedId: input.transaction.id,
        idempotencyKey: input.transferInIdempotencyKey,
        reason: input.transferInLedgerReason,
        createdByUserId: input.actorUserId,
        createdAt: input.now
      }
    ]
  });
  await tx.transaction.update({
    where: {
      id: input.transaction.id
    },
    data: {
      status: "completed",
      version: {
        increment: 1
      }
    }
  });
  await writeTransactionAuditAndOutbox(tx, {
    actorUserId: input.actorUserId,
    action: input.auditAction,
    eventType: input.eventType,
    transaction: input.transaction,
    status: "completed",
    now: input.now,
    payload: {
      transferredAmountPoints: pointHold.amountPoints,
      ...input.payload
    }
  });
}

async function lockTransaction(
  tx: Prisma.TransactionClient,
  transactionId: string
): Promise<LockedTransactionRow | null> {
  const rows = await tx.$queryRaw<LockedTransactionRow[]>`
    SELECT
      "id",
      "auctionSessionId",
      "buyerChildId",
      "sellerChildId",
      "pointHoldId",
      "pointsAmount",
      "status",
      "guardianConfirmDeadlineAt",
      "deliveryConfirmDeadlineAt",
      "version"
    FROM "Transaction"
    WHERE "id" = ${transactionId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockPointHold(
  tx: Prisma.TransactionClient,
  pointHoldId: string
): Promise<PointHoldRow | null> {
  const rows = await tx.$queryRaw<PointHoldRow[]>`
    SELECT
      "id",
      "accountId",
      "amountPoints",
      "status"
    FROM "PointHold"
    WHERE "id" = ${pointHoldId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function lockPointAccount(
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedPointAccountRow | null> {
  const rows = await lockPointAccounts(tx, [accountId]);
  return rows[0] ?? null;
}

async function lockPointAccounts(
  tx: Prisma.TransactionClient,
  accountIds: string[]
): Promise<LockedPointAccountRow[]> {
  const sortedAccountIds = [...new Set(accountIds)].sort();
  return tx.$queryRaw<LockedPointAccountRow[]>(Prisma.sql`
    SELECT
      "id",
      "childId",
      "availablePoints",
      "frozenPoints",
      "totalEarnedPoints",
      "totalSpentPoints"
    FROM "PointAccount"
    WHERE "id" IN (${Prisma.join(sortedAccountIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

async function loadGuardianAuthorization(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    transaction: LockedTransactionRow;
  }
): Promise<GuardianAuthorization | null> {
  const candidates: Array<{ side: DecisionSide; childId: string }> = [
    {
      side: "buyer",
      childId: input.transaction.buyerChildId
    },
    {
      side: "seller",
      childId: input.transaction.sellerChildId
    }
  ];

  for (const candidate of candidates) {
    const link = await tx.guardianChildLink.findFirst({
      where: {
        childId: candidate.childId,
        role: "primary",
        status: "active",
        child: {
          status: "active"
        },
        guardian: {
          userId: input.actorUserId,
          status: "active"
        }
      },
      select: {
        guardianId: true,
        role: true
      }
    });
    if (link) {
      return {
        side: candidate.side,
        guardianId: link.guardianId,
        childId: candidate.childId,
        guardianRole: link.role
      };
    }
  }

  return null;
}

async function loadDecisionState(
  tx: Prisma.TransactionClient,
  transaction: LockedTransactionRow,
  phase: DecisionPhase
): Promise<DecisionState> {
  const [buyerGuardianIds, sellerGuardianIds, decisions] = await Promise.all([
    loadPrimaryGuardianIds(tx, transaction.buyerChildId),
    loadPrimaryGuardianIds(tx, transaction.sellerChildId),
    tx.guardianDecision.findMany({
      where: {
        transactionId: transaction.id,
        phase,
        effective: true
      },
      select: {
        guardianId: true,
        value: true
      },
      orderBy: {
        createdAt: "asc"
      }
    })
  ]);
  const buyerGuardianIdSet = new Set(buyerGuardianIds);
  const sellerGuardianIdSet = new Set(sellerGuardianIds);
  const buyerDecision =
    decisions.find((decision) => buyerGuardianIdSet.has(decision.guardianId))
      ?.value ?? null;
  const sellerDecision =
    decisions.find((decision) => sellerGuardianIdSet.has(decision.guardianId))
      ?.value ?? null;

  return {
    buyerDecision,
    sellerDecision,
    buyerConfirmed: buyerDecision === "confirmed",
    sellerConfirmed: sellerDecision === "confirmed",
    buyerDecided: buyerDecision !== null,
    sellerDecided: sellerDecision !== null
  };
}

async function loadPrimaryGuardianIds(
  tx: Prisma.TransactionClient,
  childId: string
) {
  const links = await tx.guardianChildLink.findMany({
    where: {
      childId,
      role: "primary",
      status: "active",
      child: {
        status: "active"
      },
      guardian: {
        status: "active"
      }
    },
    select: {
      guardianId: true
    }
  });

  return links.map((link) => link.guardianId);
}

async function loadTransactionCommunityId(
  tx: Prisma.TransactionClient,
  auctionSessionId: string
) {
  const auction = await tx.auctionSession.findUnique({
    where: {
      id: auctionSessionId
    },
    select: {
      item: {
        select: {
          communityId: true
        }
      }
    }
  });

  return auction?.item.communityId ?? null;
}

function validateTransactionPhase(
  transaction: LockedTransactionRow,
  phase: DecisionPhase,
  now: Date
): { result: "accepted" } | Extract<TransactionDecisionResult, { result: "rejected" }> {
  if (phase === "guardian_confirm") {
    if (transaction.status !== "pending_guardian_confirm") {
      return {
        result: "rejected",
        errorCode: "TRANSACTION_NOT_IN_GUARDIAN_CONFIRM"
      };
    }

    if (now > transaction.guardianConfirmDeadlineAt) {
      return {
        result: "rejected",
        errorCode: "GUARDIAN_CONFIRM_DEADLINE_EXPIRED"
      };
    }

    return {
      result: "accepted"
    };
  }

  if (transaction.status !== "pending_delivery_confirm") {
    return {
      result: "rejected",
      errorCode: "TRANSACTION_NOT_IN_DELIVERY_CONFIRM"
    };
  }

  if (
    !transaction.deliveryConfirmDeadlineAt ||
    now > transaction.deliveryConfirmDeadlineAt
  ) {
    return {
      result: "rejected",
      errorCode: "DELIVERY_CONFIRM_DEADLINE_EXPIRED"
    };
  }

  return {
    result: "accepted"
  };
}

function hasSideDecided(state: DecisionState, side: DecisionSide) {
  return side === "buyer" ? state.buyerDecided : state.sellerDecided;
}

function canResolveDispute(
  status: TransactionStatus,
  action: AdminDisputeResolutionAction
) {
  if (action === "keep_frozen_for_platform_review") {
    return status === "disputed";
  }

  return status === "disputed" || status === "platform_review";
}

async function validateGuardianProposal(
  tx: Prisma.TransactionClient,
  input: {
    phase: DecisionPhase;
    value: DecisionValue;
    transaction: LockedTransactionRow;
    authorization: GuardianAuthorization;
    stateBefore: DecisionState;
    deliveryMethod?: DeliveryMethod;
    deliveryPointId?: string | null;
  }
): Promise<
  { result: "accepted" } | Extract<TransactionDecisionResult, { result: "rejected" }>
> {
  if (input.phase !== "guardian_confirm" || input.value !== "confirmed") {
    return { result: "accepted" };
  }

  if (input.authorization.side === "buyer" && !input.stateBefore.sellerConfirmed) {
    return {
      result: "rejected",
      errorCode: "SELLER_DELIVERY_PROPOSAL_REQUIRED"
    };
  }

  if (input.authorization.side === "seller") {
    if (!input.deliveryMethod) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_METHOD_REQUIRED"
      };
    }

    if (input.deliveryMethod === "courier") {
      return {
        result: "rejected",
        errorCode: "DELIVERY_METHOD_NOT_ALLOWED"
      };
    }

    if (input.deliveryMethod === "designated_point" && !input.deliveryPointId) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_METHOD_REQUIRED"
      };
    }

    if (input.deliveryMethod === "designated_point" && input.deliveryPointId) {
      const communityId = await loadTransactionCommunityId(
        tx,
        input.transaction.auctionSessionId
      );
      if (!communityId) {
        return {
          result: "rejected",
          errorCode: "TRANSACTION_NOT_FOUND"
        };
      }

      const deliveryPoint = await tx.deliveryPoint.findFirst({
        where: {
          id: input.deliveryPointId,
          communityId,
          status: "active"
        },
        select: {
          id: true
        }
      });
      if (!deliveryPoint) {
        return {
          result: "rejected",
          errorCode: "DELIVERY_POINT_NOT_AVAILABLE"
        };
      }
    }

    if (
      input.deliveryMethod === "guardian_arranged" &&
      input.deliveryPointId
    ) {
      return {
        result: "rejected",
        errorCode: "DELIVERY_METHOD_NOT_ALLOWED"
      };
    }

    if (input.deliveryMethod === "guardian_arranged") {
      const settings = await tx.childGuardianSettings.findMany({
        where: {
          childId: {
            in: [
              input.transaction.buyerChildId,
              input.transaction.sellerChildId
            ]
          }
        },
        select: {
          childId: true,
          canUseGuardianArrangedDelivery: true
        }
      });
      const allowedChildIds = new Set(
        settings
          .filter((setting) => setting.canUseGuardianArrangedDelivery)
          .map((setting) => setting.childId)
      );
      if (
        !allowedChildIds.has(input.transaction.buyerChildId) ||
        !allowedChildIds.has(input.transaction.sellerChildId)
      ) {
        return {
          result: "rejected",
          errorCode: "GUARDIAN_ARRANGED_DELIVERY_NOT_ALLOWED"
        };
      }
    }
  }

  return { result: "accepted" };
}

function mergeDecisionState(
  state: DecisionState,
  decision: {
    side: DecisionSide;
    value: DecisionValue;
  }
): DecisionState {
  const buyerDecision =
    decision.side === "buyer" ? decision.value : state.buyerDecision;
  const sellerDecision =
    decision.side === "seller" ? decision.value : state.sellerDecision;

  return {
    buyerDecision,
    sellerDecision,
    buyerConfirmed: buyerDecision === "confirmed",
    sellerConfirmed: sellerDecision === "confirmed",
    buyerDecided: buyerDecision !== null,
    sellerDecided: sellerDecision !== null
  };
}

function buildAcceptedResult(input: {
  transaction: LockedTransactionRow;
  phase: DecisionPhase;
  value: DecisionValue;
  side: DecisionSide;
  status: TransactionStatus;
  decisionId: string;
  state: DecisionState;
  releasedAmountPoints: number;
  transferredAmountPoints: number;
  deliveryConfirmDeadlineAt: Date | null;
  idempotencyKey: string;
}): Extract<TransactionDecisionResult, { result: "accepted" }> {
  return {
    result: "accepted",
    transactionId: input.transaction.id,
    phase: input.phase,
    value: input.value,
    side: input.side,
    status: input.status,
    decisionId: input.decisionId,
    buyerConfirmed: input.state.buyerConfirmed,
    sellerConfirmed: input.state.sellerConfirmed,
    releasedAmountPoints: input.releasedAmountPoints,
    transferredAmountPoints: input.transferredAmountPoints,
    deliveryConfirmDeadlineAt:
      input.deliveryConfirmDeadlineAt?.toISOString() ?? null,
    idempotencyKey: input.idempotencyKey
  };
}

async function writeTransactionAuditAndOutbox(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    action: string;
    eventType: string;
    transaction: LockedTransactionRow;
    status: TransactionStatus;
    now: Date;
    payload: Record<string, unknown>;
  }
) {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "transaction",
      targetId: input.transaction.id,
      afterJson: {
        transactionId: input.transaction.id,
        auctionSessionId: input.transaction.auctionSessionId,
        buyerChildId: input.transaction.buyerChildId,
        sellerChildId: input.transaction.sellerChildId,
        pointHoldId: input.transaction.pointHoldId,
        pointsAmount: input.transaction.pointsAmount,
        status: input.status,
        ...input.payload
      },
      createdAt: input.now
    }
  });

  await tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      targetType: "transaction",
      targetId: input.transaction.id,
      idempotencyKey: buildOutboxIdempotencyKey(
        input.eventType,
        input.transaction.id
      ),
      payloadJson: {
        transactionId: input.transaction.id,
        auctionSessionId: input.transaction.auctionSessionId,
        buyerChildId: input.transaction.buyerChildId,
        sellerChildId: input.transaction.sellerChildId,
        pointHoldId: input.transaction.pointHoldId,
        pointsAmount: input.transaction.pointsAmount,
        status: input.status,
        ...input.payload
      },
      availableAt: input.now
    }
  });
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
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IdempotencyRecord" (
      "id",
      "key",
      "actorUserId",
      "action",
      "targetType",
      "targetId",
      "requestHash",
      "status"
    )
    VALUES (
      ${randomUUID()},
      ${input.key},
      ${input.actorUserId},
      ${input.action},
      ${input.targetType},
      ${input.targetId},
      ${input.requestHash},
      'processing'
    )
    ON CONFLICT ("key", "actorUserId", "action", "targetType", "targetId")
    DO NOTHING
    RETURNING "id"
  `;

  if (inserted[0]) {
    return {
      result: "reserved",
      id: inserted[0].id
    };
  }

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

  if (!existing || existing.requestHash !== input.requestHash) {
    return {
      result: "conflict"
    };
  }

  if (existing.status === "completed" && existing.responseJson) {
    return {
      result: "replay",
      response: existing.responseJson as T
    };
  }

  return {
    result: "conflict"
  };
}

async function completeIdempotency<T>(
  tx: Prisma.TransactionClient,
  idempotencyRecordId: string,
  response: T
): Promise<T> {
  await tx.idempotencyRecord.update({
    where: {
      id: idempotencyRecordId
    },
    data: {
      status: "completed",
      responseJson: response as Prisma.InputJsonValue
    }
  });

  return response;
}

function buildDecisionAction(phase: DecisionPhase) {
  return phase === "guardian_confirm"
    ? "transaction.guardian_confirm"
    : "transaction.delivery_confirm";
}

function buildOutboxIdempotencyKey(eventType: string, transactionId: string) {
  return `${eventType}:${createStableHash({ transactionId })}`;
}

function normalizeAdminReason(reason: string) {
  const trimmed = reason.trim();
  return trimmed ? trimmed.slice(0, 300) : "admin_dispute_resolution";
}

function normalizeDecisionReason(reason: string | undefined) {
  const trimmed = reason?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 300) : "";
}

function createStableHash(value: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
