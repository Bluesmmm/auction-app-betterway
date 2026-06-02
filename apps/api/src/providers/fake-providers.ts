import type {
  ContentSafetyProvider,
  ContentSafetyResult,
  CreateReadGrantInput,
  FileReadGrantResult,
  ObjectStorageProvider,
  ProviderMode,
  ReviewContentSafetyInput,
  RiskLevel,
  SendSensitiveOperationVerificationInput,
  SendSubscriptionMessageInput,
  SensitiveOperationVerificationProvider,
  SensitiveOperationVerificationResult,
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

  async reviewContent(
    input: ReviewContentSafetyInput
  ): Promise<ContentSafetyResult> {
    if (this.options.mode === "failure") {
      return {
        ok: false,
        errorCode: "CONTENT_SAFETY_UNAVAILABLE",
        failureClosesBusiness: true
      };
    }

    const textResult = await this.reviewText(input.text);
    if (!textResult.ok) {
      return textResult;
    }

    const labels = new Set(textResult.labels);
    let riskLevel: RiskLevel = textResult.riskLevel;
    let ocrText: string | undefined;
    let qrOrBarcodeDetected = false;
    const metadataFindings: string[] = [];

    for (const media of input.media) {
      if (media.checksum.includes("ocr-contact")) {
        labels.add("ocr_contact");
        ocrText = "detected phone or wechat contact";
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("qr")) {
        labels.add("qr_or_barcode");
        qrOrBarcodeDetected = true;
        riskLevel = maxRisk(riskLevel, "severe");
      }

      if (media.checksum.includes("exif-privacy")) {
        labels.add("metadata_privacy");
        metadataFindings.push("exif_privacy");
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("risk:medium")) {
        riskLevel = maxRisk(riskLevel, "medium");
      }

      if (media.checksum.includes("risk:high")) {
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("risk:severe")) {
        riskLevel = maxRisk(riskLevel, "severe");
      }
    }

    return {
      ok: true,
      riskLevel,
      labels: [...labels],
      ...(ocrText ? { ocrText } : {}),
      ...(qrOrBarcodeDetected ? { qrOrBarcodeDetected } : {}),
      ...(metadataFindings.length > 0 ? { metadataFindings } : {})
    };
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

export class FakeSensitiveOperationVerificationProvider
  implements SensitiveOperationVerificationProvider
{
  private readonly deliveries: SendSensitiveOperationVerificationInput[] = [];

  constructor(private readonly options: FakeProviderOptions = {}) {}

  async send(
    input: SendSensitiveOperationVerificationInput
  ): Promise<SensitiveOperationVerificationResult> {
    if (this.options.mode === "failure") {
      return {
        ok: false,
        errorCode: "SENSITIVE_VERIFICATION_DELIVERY_FAILED",
        mutatesBusinessState: false
      };
    }

    this.deliveries.push(input);
    return {
      ok: true,
      providerMessageId: `fake_sensitive_verification_${input.challengeId}`,
      mutatesBusinessState: false
    };
  }

  getLastDelivery(): SendSensitiveOperationVerificationInput | null {
    return this.deliveries[this.deliveries.length - 1] ?? null;
  }
}

const riskOrder: RiskLevel[] = ["low", "medium", "high", "severe"];

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return riskOrder.indexOf(left) >= riskOrder.indexOf(right) ? left : right;
}
