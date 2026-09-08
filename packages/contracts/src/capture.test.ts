import { describe, expect, it } from "vitest";
import {
  CaptureReceiptSchema,
  FinalizeCaptureInputSchema,
  ReportCaptureFailureInputSchema,
  ReportCaptureFailureResultSchema,
  SourcePlatformSchema,
  StartCaptureInputSchema,
  StartCaptureResultSchema,
  resolveSourceIdentity
} from "./capture";

const MIB = 1024 * 1024;

function captureStartWith(
  attachments: Array<{
    clientId: string;
    fileName: string;
    mimeType: "image/png";
    byteSize: number;
    sha256: string;
  }>
) {
  return {
    idempotencyKey: "capture-start-key-1",
    source: "manual_screenshot",
    scope: "upload",
    title: "screenshots",
    sensitivity: "sensitive",
    externalRef: null,
    attachments
  };
}

function attachment(clientId: string, byteSize = 100) {
  return {
    clientId,
    fileName: `${clientId}.png`,
    mimeType: "image/png" as const,
    byteSize,
    sha256: "a".repeat(64)
  };
}

describe("capture contracts", () => {
  it("accepts only bounded, machine-readable capture failure reports", () => {
    expect(
      ReportCaptureFailureInputSchema.safeParse({
        failureCode: "upload_target_mismatch"
      }).success
    ).toBe(true);
    expect(
      ReportCaptureFailureInputSchema.safeParse({
        failureCode: "signed-url:https://example.test/token"
      }).success
    ).toBe(false);
    expect(
      ReportCaptureFailureInputSchema.safeParse({
        failureCode: "invalid_capture",
        failureReason: "raw content must never be accepted"
      }).success
    ).toBe(false);
  });

  it("requires a failed server result without a durable receipt", () => {
    const result = ReportCaptureFailureResultSchema.safeParse({
      captureId: "20000000-0000-4000-8000-000000000001",
      captureStatus: "failed",
      failureReason: "Capture data did not meet validation requirements"
    });

    expect(result.success).toBe(true);
    expect(
      ReportCaptureFailureResultSchema.safeParse({
        ...result.data,
        sourceItemId: "30000000-0000-4000-8000-000000000001"
      }).success
    ).toBe(false);
  });

  it("bounds signed upload target fields from successful API responses", () => {
    const result = StartCaptureResultSchema.safeParse({
      captureId: "10000000-0000-4000-8000-000000000001",
      uploadTargets: [
        {
          clientId: "file-1",
          storagePath: "owner/capture/file.png",
          token: "a".repeat(4_097)
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("allows the server to obtain attachment ETags from private storage", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "",
      messages: [],
      uploadedAttachments: [
        { clientId: "file-1", storagePath: "owner/capture/file-1.txt" }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects more than fifty attachments", () => {
    const attachments = Array.from({ length: 51 }, (_, index) =>
      attachment(`file-${index}`)
    );

    expect(
      StartCaptureInputSchema.safeParse(captureStartWith(attachments)).success
    ).toBe(false);
  });

  it("rejects duplicate attachment client ids", () => {
    const result = StartCaptureInputSchema.safeParse(
      captureStartWith([attachment("same"), attachment("same")])
    );

    expect(result.success).toBe(false);
  });

  it("accepts only a UUID as an explicit capture recovery link", () => {
    const valid = StartCaptureInputSchema.safeParse({
      ...captureStartWith([]),
      recoveryCaptureId: "20000000-0000-4000-8000-000000000001"
    });
    const invalid = StartCaptureInputSchema.safeParse({
      ...captureStartWith([]),
      recoveryCaptureId: "previous-capture"
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it.each([
    ["chatgpt_web", "upload", "conversation-1"],
    ["chatgpt_web", "full_conversation", null],
    ["manual_file", "selection", null],
    ["manual_screenshot", "full_conversation", null]
  ] as const)(
    "rejects unsupported source and scope combination %s/%s",
    (source, scope, externalRef) => {
      const result = StartCaptureInputSchema.safeParse({
        ...captureStartWith([]),
        source,
        scope,
        externalRef
      });

      expect(result.success).toBe(false);
    }
  );

  it("rejects attachments exceeding one hundred MiB in total", () => {
    const attachments = Array.from({ length: 11 }, (_, index) =>
      attachment(`file-${index}`, 10 * MIB)
    );

    expect(
      StartCaptureInputSchema.safeParse(captureStartWith(attachments)).success
    ).toBe(false);
  });

  it("requires missing elements for a partial capture", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "partial",
      missingElements: [],
      rawText: "saved text",
      messages: [],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing elements for a complete capture", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: ["an image"],
      rawText: "saved text",
      messages: [],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("measures the raw text limit as UTF-8 bytes", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "界".repeat(Math.floor((2 * MIB) / 3) + 1),
      messages: [],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("applies the UTF-8 limit to all message text in aggregate", () => {
    const text = "界".repeat(400_000);
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "",
      messages: [
        {
          externalMessageId: "m1",
          role: "user",
          text,
          ordinal: 0
        },
        {
          externalMessageId: "m2",
          role: "assistant",
          text,
          ordinal: 1
        }
      ],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("applies one UTF-8 limit across raw and structured text", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "a".repeat(MIB + 1),
      messages: [
        {
          externalMessageId: "m1",
          role: "user",
          text: "b".repeat(MIB),
          ordinal: 0
        }
      ],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate uploaded attachment ids and paths", () => {
    const base = {
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "",
      messages: []
    };
    const duplicateIds = FinalizeCaptureInputSchema.safeParse({
      ...base,
      uploadedAttachments: [
        { clientId: "same", storagePath: "one", etag: "etag-1" },
        { clientId: "same", storagePath: "two", etag: "etag-2" }
      ]
    });
    const duplicatePaths = FinalizeCaptureInputSchema.safeParse({
      ...base,
      uploadedAttachments: [
        { clientId: "one", storagePath: "same", etag: "etag-1" },
        { clientId: "two", storagePath: "same", etag: "etag-2" }
      ]
    });

    expect(duplicateIds.success).toBe(false);
    expect(duplicatePaths.success).toBe(false);
  });

  it("rejects a finalizable capture with no durable raw content", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "  ",
      messages: [],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate message ordinals", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "complete",
      missingElements: [],
      rawText: "",
      messages: [
        {
          externalMessageId: "m1",
          role: "user",
          text: "question",
          ordinal: 0
        },
        {
          externalMessageId: "m2",
          role: "assistant",
          text: "answer",
          ordinal: 0
        }
      ],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects Claude as a capture platform", () => {
    expect(SourcePlatformSchema.safeParse("claude").success).toBe(false);
  });

  it("accepts Xiaohongshu only as a social post web page", () => {
    expect(
      StartCaptureInputSchema.parse({
        idempotencyKey: "xhs-note-123456",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        scope: "web_page",
        title: "合成笔记",
        sensitivity: "normal",
        externalRef: "note-123",
        attachments: [],
      }).sourcePlatform,
    ).toBe("xiaohongshu");
    expect(() =>
      StartCaptureInputSchema.parse({
        idempotencyKey: "xhs-note-123456",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        scope: "full_conversation",
        title: "合成笔记",
        sensitivity: "normal",
        externalRef: "note-123",
        attachments: [],
      }),
    ).toThrow();
  });

  it("maps legacy ChatGPT payloads to typed identity", () => {
    const parsed = StartCaptureInputSchema.parse({
      idempotencyKey: "chatgpt-legacy-1",
      source: "chatgpt_web",
      scope: "full_conversation",
      title: "合成对话",
      sensitivity: "normal",
      externalRef: "conversation-1",
      attachments: [],
    });

    expect(resolveSourceIdentity(parsed)).toEqual({
      source: "chatgpt_web",
      sourceKind: "ai_conversation",
      sourcePlatform: "chatgpt",
    });
  });

  it("rejects mismatched legacy and typed identity", () => {
    expect(
      StartCaptureInputSchema.safeParse({
        idempotencyKey: "chatgpt-mismatch-1",
        source: "chatgpt_web",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        scope: "web_page",
        title: "合成笔记",
        sensitivity: "normal",
        externalRef: "note-123",
        attachments: [],
      }).success,
    ).toBe(false);
  });

  it("requires an external ref for ChatGPT and Xiaohongshu", () => {
    expect(
      StartCaptureInputSchema.safeParse({
        idempotencyKey: "chatgpt-missing-ref",
        sourceKind: "ai_conversation",
        sourcePlatform: "chatgpt",
        scope: "full_conversation",
        title: "合成对话",
        sensitivity: "normal",
        externalRef: "   ",
        attachments: [],
      }).success,
    ).toBe(false);
    expect(
      StartCaptureInputSchema.safeParse({
        idempotencyKey: "xhs-missing-ref",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        scope: "web_page",
        title: "合成笔记",
        sensitivity: "normal",
        externalRef: null,
        attachments: [],
      }).success,
    ).toBe(false);
  });

  it("keeps complete receipt missing elements empty", () => {
    const result = CaptureReceiptSchema.safeParse({
      captureId: "20000000-0000-4000-8000-000000000001",
      sourceItemId: "30000000-0000-4000-8000-000000000001",
      captureStatus: "complete",
      processingStatus: "queued",
      savedMessageCount: 1,
      savedAttachmentCount: 0,
      missingElements: ["unexpected"]
    });

    expect(result.success).toBe(false);
  });
});
