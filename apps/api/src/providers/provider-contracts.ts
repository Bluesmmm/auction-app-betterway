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
