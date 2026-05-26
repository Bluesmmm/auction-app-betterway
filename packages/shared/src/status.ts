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
