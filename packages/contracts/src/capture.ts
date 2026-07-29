import { z } from "zod";

const MIB = 1024 * 1024;
const MAX_PLAIN_TEXT_BYTES = 2 * MIB;
const MAX_ATTACHMENT_BYTES = 10 * MIB;
const MAX_CAPTURE_ATTACHMENT_BYTES = 100 * MIB;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function addDuplicateIssue(
  values: readonly string[],
  path: PropertyKey,
  context: z.core.$RefinementCtx<unknown>,
  message: string
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path: [path],
      message,
      input: values
    });
  }
}

export const CaptureSourceSchema = z.enum([
  "chatgpt_web",
  "manual_text",
  "manual_file",
  "manual_screenshot"
]);

export const CaptureScopeSchema = z.enum([
  "full_conversation",
  "qa_pair",
  "selection",
  "web_page",
  "upload"
]);

export const SensitivitySchema = z.enum([
  "normal",
  "sensitive",
  "strictly_sensitive"
]);

export const CaptureCompletenessSchema = z.enum([
  "complete",
  "partial",
  "failed"
]);

export const FinalizableCompletenessSchema = z.enum([
  "complete",
  "partial"
]);

export const ProcessingStatusSchema = z.enum([
  "queued",
  "processing",
  "complete",
  "failed",
  "paused"
]);

export const AttachmentMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/pdf"
]);

export const AttachmentManifestSchema = z.object({
  clientId: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255),
  mimeType: AttachmentMimeTypeSchema,
  byteSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export const CapturedMessageSchema = z.object({
  externalMessageId: z.string().min(1).max(500),
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string().max(MAX_PLAIN_TEXT_BYTES),
  ordinal: z.number().int().nonnegative()
});

export const StartCaptureInputSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    source: CaptureSourceSchema,
    scope: CaptureScopeSchema,
    title: z.string().trim().min(1).max(500),
    sensitivity: SensitivitySchema,
    externalRef: z.string().max(1000).nullable(),
    attachments: z.array(AttachmentManifestSchema).max(50)
  })
  .superRefine((value, context) => {
    const allowedScopesBySource: Record<
      z.infer<typeof CaptureSourceSchema>,
      readonly z.infer<typeof CaptureScopeSchema>[]
    > = {
      chatgpt_web: ["full_conversation", "qa_pair", "selection"],
      manual_text: ["selection", "web_page", "upload"],
      manual_file: ["upload"],
      manual_screenshot: ["upload"]
    };
    if (!allowedScopesBySource[value.source].includes(value.scope)) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: `scope ${value.scope} is not supported for ${value.source}`,
        input: value.scope
      });
    }
    if (
      value.source === "chatgpt_web" &&
      (value.externalRef === null || value.externalRef.trim().length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalRef"],
        message: "ChatGPT capture requires a conversation reference",
        input: value.externalRef
      });
    }

    const totalBytes = value.attachments.reduce(
      (sum, item) => sum + item.byteSize,
      0
    );
    if (totalBytes > MAX_CAPTURE_ATTACHMENT_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "attachments exceed 100 MiB total",
        input: value.attachments
      });
    }

    addDuplicateIssue(
      value.attachments.map((item) => item.clientId),
      "attachments",
      context,
      "attachment client ids must be unique"
    );
  });

export const UploadedAttachmentSchema = z.object({
  clientId: z.string().min(1).max(100),
  storagePath: z.string().min(1).max(2000),
  etag: z.string().min(1).max(1000)
});

export const FinalizeCaptureInputSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    completeness: FinalizableCompletenessSchema,
    missingElements: z
      .array(z.string().trim().min(1).max(500))
      .max(50),
    rawText: z.string(),
    messages: z.array(CapturedMessageSchema).max(5000),
    uploadedAttachments: z.array(UploadedAttachmentSchema).max(50)
  })
  .superRefine((value, context) => {
    const hasRawContent =
      value.rawText.trim().length > 0 ||
      value.messages.some((message) => message.text.trim().length > 0) ||
      value.uploadedAttachments.length > 0;
    if (!hasRawContent) {
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "capture must contain text, messages, or an attachment",
        input: value
      });
    }

    const messageBytes = value.messages.reduce(
      (sum, message) => sum + utf8ByteLength(message.text),
      0
    );
    const totalPlainTextBytes =
      utf8ByteLength(value.rawText) + messageBytes;
    if (totalPlainTextBytes > MAX_PLAIN_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "plain text exceeds 2 MiB in total",
        input: {
          rawText: value.rawText,
          messages: value.messages
        }
      });
    }

    if (
      value.completeness === "partial" &&
      value.missingElements.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["missingElements"],
        message: "partial capture requires at least one missing element",
        input: value.missingElements
      });
    }
    if (
      value.completeness === "complete" &&
      value.missingElements.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["missingElements"],
        message: "complete capture cannot contain missing elements",
        input: value.missingElements
      });
    }

    addDuplicateIssue(
      value.missingElements,
      "missingElements",
      context,
      "missing elements must be unique"
    );
    addDuplicateIssue(
      value.messages.map((message) => message.externalMessageId),
      "messages",
      context,
      "message ids must be unique"
    );
    addDuplicateIssue(
      value.messages.map((message) => String(message.ordinal)),
      "messages",
      context,
      "message ordinals must be unique"
    );
    addDuplicateIssue(
      value.uploadedAttachments.map((attachment) => attachment.clientId),
      "uploadedAttachments",
      context,
      "uploaded attachment client ids must be unique"
    );
    addDuplicateIssue(
      value.uploadedAttachments.map((attachment) => attachment.storagePath),
      "uploadedAttachments",
      context,
      "uploaded attachment storage paths must be unique"
    );
  });

export const UploadTargetSchema = z.object({
  clientId: z.string().min(1),
  storagePath: z.string().min(1),
  token: z.string().min(1)
});

export const StartCaptureResultSchema = z.object({
  captureId: z.string().uuid(),
  uploadTargets: z.array(UploadTargetSchema).max(50)
});

const CaptureReceiptBaseSchema = z.object({
  captureId: z.string().uuid(),
  sourceItemId: z.string().uuid(),
  captureStatus: FinalizableCompletenessSchema,
  processingStatus: ProcessingStatusSchema,
  savedMessageCount: z.number().int().nonnegative(),
  savedAttachmentCount: z.number().int().nonnegative(),
  missingElements: z.array(z.string().min(1).max(500)).max(50)
});

function enforceReceiptCompleteness(
  value: z.infer<typeof CaptureReceiptBaseSchema>,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.captureStatus === "complete" && value.missingElements.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["missingElements"],
      message: "complete receipt cannot contain missing elements",
      input: value.missingElements
    });
  }
  if (value.captureStatus === "partial" && value.missingElements.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["missingElements"],
      message: "partial receipt requires at least one missing element",
      input: value.missingElements
    });
  }
}

export const CaptureReceiptSchema = CaptureReceiptBaseSchema.superRefine(
  enforceReceiptCompleteness
);

export const FailedCaptureStatusSchema = z.object({
  captureId: z.string().uuid(),
  sourceItemId: z.null(),
  captureStatus: z.literal("failed"),
  processingStatus: z.literal("paused"),
  savedMessageCount: z.literal(0),
  savedAttachmentCount: z.literal(0),
  missingElements: z.array(z.string().min(1).max(500)).max(50),
  failureReason: z.string().trim().min(1).max(2000)
});

const SuccessfulCaptureStatusSchema = CaptureReceiptBaseSchema.extend({
  failureReason: z.null()
}).superRefine(enforceReceiptCompleteness);

export const CaptureStatusResultSchema = z.union([
  SuccessfulCaptureStatusSchema,
  FailedCaptureStatusSchema
]);

export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
export type CaptureScope = z.infer<typeof CaptureScopeSchema>;
export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type CaptureCompleteness = z.infer<typeof CaptureCompletenessSchema>;
export type FinalizableCompleteness = z.infer<
  typeof FinalizableCompletenessSchema
>;
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;
export type AttachmentMimeType = z.infer<typeof AttachmentMimeTypeSchema>;
export type AttachmentManifest = z.infer<typeof AttachmentManifestSchema>;
export type CapturedMessage = z.infer<typeof CapturedMessageSchema>;
export type StartCaptureInput = z.infer<typeof StartCaptureInputSchema>;
export type UploadedAttachment = z.infer<typeof UploadedAttachmentSchema>;
export type FinalizeCaptureInput = z.infer<typeof FinalizeCaptureInputSchema>;
export type UploadTarget = z.infer<typeof UploadTargetSchema>;
export type StartCaptureResult = z.infer<typeof StartCaptureResultSchema>;
export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;
export type FailedCaptureStatus = z.infer<typeof FailedCaptureStatusSchema>;
export type CaptureStatusResult = z.infer<typeof CaptureStatusResultSchema>;
