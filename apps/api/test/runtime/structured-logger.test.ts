import { describe, expect, it } from "vitest";
import { StructuredLogger } from "../../src/runtime/structured-logger.js";

describe("StructuredLogger", () => {
  it("redacts sensitive fields and literals before serialization", () => {
    const logger = new StructuredLogger();
    const serialized = logger.serialize({
      level: "info",
      event: "admin.export_requested",
      requestId: "request_1",
      actorUserId: "user_1",
      targetType: "child_profile",
      targetId: "child_1",
      now: new Date("2026-05-27T16:00:00.000Z"),
      payload: {
        phone: "13812345678",
        addressText: "上海市浦东新区测试路 1 号",
        storageKey: "private/children/raw/object-key-123456789.jpg",
        signedUrl:
          "https://cdn.example.com/private/children/raw/object-key-123456789.jpg?signature=abc",
        nested: {
          courierTrackingNo: "SF123456789"
        },
        message: "请送到上海市浦东新区测试路 1 号",
        note: "快递单号 SF987654321"
      }
    });

    expect(serialized).toContain("admin.export_requested");
    expect(serialized).not.toContain("13812345678");
    expect(serialized).not.toContain("上海市浦东新区测试路");
    expect(serialized).not.toContain("object-key-123456789");
    expect(serialized).not.toContain("signature=abc");
    expect(serialized).not.toContain("SF123456789");
    expect(serialized).not.toContain("上海市浦东新区测试路");
    expect(serialized).not.toContain("SF987654321");
  });
});
