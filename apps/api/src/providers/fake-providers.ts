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

    const safetySignals = productSafetySignals(text);
    if (safetySignals.labels.length > 0) {
      return {
        ok: true,
        riskLevel: safetySignals.riskLevel,
        labels: safetySignals.labels
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

      if (media.checksum.includes("safety:recalled")) {
        labels.add("safety_recalled_item");
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("safety:battery")) {
        labels.add("safety_damaged_battery");
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("safety:magnet")) {
        labels.add("safety_magnetic_beads");
        riskLevel = maxRisk(riskLevel, "severe");
      }

      if (media.checksum.includes("safety:small-parts")) {
        labels.add("safety_small_parts_ingestion");
        riskLevel = maxRisk(riskLevel, "high");
      }

      if (media.checksum.includes("safety:sharp")) {
        labels.add("safety_sharp_parts");
        riskLevel = maxRisk(riskLevel, "high");
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

function productSafetySignals(text: string): {
  riskLevel: RiskLevel;
  labels: string[];
} {
  const labels = new Set<string>();
  let riskLevel: RiskLevel = "low";

  if (/召回/.test(text)) {
    labels.add("safety_recalled_item");
    riskLevel = maxRisk(riskLevel, "high");
  }
  if (/破损电池|鼓包电池|漏液电池|电池破损/.test(text)) {
    labels.add("safety_damaged_battery");
    riskLevel = maxRisk(riskLevel, "high");
  }
  if (/磁力珠|强磁/.test(text)) {
    labels.add("safety_magnetic_beads");
    riskLevel = maxRisk(riskLevel, "severe");
  }
  if (/小零件|误食/.test(text)) {
    labels.add("safety_small_parts_ingestion");
    riskLevel = maxRisk(riskLevel, "high");
  }
  if (/尖锐|锋利|尖角/.test(text)) {
    labels.add("safety_sharp_parts");
    riskLevel = maxRisk(riskLevel, "high");
  }

  return { riskLevel, labels: [...labels] };
}
