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

export const ContentMediaRole = [
  "front",
  "back",
  "side",
  "detail",
  "avatar"
] as const;

export type ContentMediaRole = (typeof ContentMediaRole)[number];

export const WantedPostStatus = [
  "draft",
  "ai_reviewing",
  "manual_reviewing",
  "active",
  "closed",
  "rejected",
  "delisted"
] as const;

export type WantedPostStatus = (typeof WantedPostStatus)[number];

export const WantedResponseStatus = [
  "submitted",
  "reviewing",
  "approved",
  "converted_to_item",
  "rejected",
  "cancelled"
] as const;

export type WantedResponseStatus = (typeof WantedResponseStatus)[number];
