export const QueueName = {
  outboxNotifications: "outbox.notifications",
  auctionSettlementTriggers: "auction.settlement.triggers"
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];
