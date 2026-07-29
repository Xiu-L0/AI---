import { describe, expect, it } from "vitest";
import {
  CaptureReceiptSchema,
  FinalizeCaptureInputSchema,
  StartCaptureInputSchema
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
