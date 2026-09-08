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

export const SourceKindSchema = z.enum([
  "ai_conversation",
  "web_article",
  "social_post",
  "code_repository",
  "manual_text",
  "manual_file",
  "screenshot"
]);

export const SourcePlatformSchema = z.enum([
  "chatgpt",
  "doubao",
  "deepseek",
  "wechat",
  "xiaohongshu",
  "github",
  "generic_web",
  "manual"
]);

export const CaptureAssetMetadataSchema = z
  .object({
    clientId: z.string().trim().min(1).max(100),
    ordinal: z.number().int().nonnegative(),
    alt: z.string().max(2000)
  })
  .strict();

export const CaptureMetadataSchema = z
  .object({
    adapterName: z.enum(["chatgpt", "xiaohongshu", "manual"]),
    adapterVersion: z.string().trim().min(1).max(50),
    canonicalUrl: z.url().max(10_000),
    author: z.string().trim().min(1).max(500).nullable(),
    capturedAt: z.iso.datetime({ offset: true }),
    assets: z.array(CaptureAssetMetadataSchema).max(50)
  })
  .strict();

export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type SourcePlatform = z.infer<typeof SourcePlatformSchema>;
export type CaptureAssetMetadata = z.infer<typeof CaptureAssetMetadataSchema>;
export type CaptureMetadata = z.infer<typeof CaptureMetadataSchema>;

const LEGACY_SOURCE_IDENTITY = {
  chatgpt_web: { sourceKind: "ai_conversation", sourcePlatform: "chatgpt" },
  manual_text: { sourceKind: "manual_text", sourcePlatform: "manual" },
  manual_file: { sourceKind: "manual_file", sourcePlatform: "manual" },
  manual_screenshot: { sourceKind: "screenshot", sourcePlatform: "manual" }
} as const;

const STARTABLE_SOURCE_PLATFORMS = new Set<SourcePlatform>([
  "chatgpt",
  "xiaohongshu",
  "manual"
]);

function isAllowedSourcePair(
  sourceKind: SourceKind,
  sourcePlatform: SourcePlatform
): boolean {
  return (
    (sourcePlatform === "chatgpt" && sourceKind === "ai_conversation") ||
    (sourcePlatform === "xiaohongshu" && sourceKind === "social_post") ||
    (sourcePlatform === "manual" &&
      (sourceKind === "manual_text" ||
        sourceKind === "manual_file" ||
        sourceKind === "screenshot")) ||
    ((sourcePlatform === "doubao" || sourcePlatform === "deepseek") &&
      sourceKind === "ai_conversation") ||
    ((sourcePlatform === "wechat" || sourcePlatform === "generic_web") &&
      sourceKind === "web_article") ||
    (sourcePlatform === "github" && sourceKind === "code_repository")
  );
}

function legacySourceFor(
  sourceKind: SourceKind,
  sourcePlatform: SourcePlatform
): CaptureSource | null {
  const match = (
    Object.entries(LEGACY_SOURCE_IDENTITY) as Array<
      [CaptureSource, { sourceKind: SourceKind; sourcePlatform: SourcePlatform }]
    >
  ).find(
    ([, identity]) =>
      identity.sourceKind === sourceKind &&
      identity.sourcePlatform === sourcePlatform
  );
  return match?.[0] ?? null;
}

export function resolveSourceIdentity(input: {
  source?: CaptureSource | null | undefined;
  sourceKind?: SourceKind | null | undefined;
  sourcePlatform?: SourcePlatform | null | undefined;
}): {
  source: CaptureSource | null;
  sourceKind: SourceKind;
  sourcePlatform: SourcePlatform;
} {
  const legacySource = input.source ?? undefined;
  const hasTypedFields =
    input.sourceKind != null || input.sourcePlatform != null;
  if (hasTypedFields && (input.sourceKind == null || input.sourcePlatform == null)) {
    throw new Error("sourceKind and sourcePlatform must be provided together");
  }

  if (legacySource != null && hasTypedFields) {
    const mapped = LEGACY_SOURCE_IDENTITY[legacySource];
    if (
      mapped.sourceKind !== input.sourceKind ||
      mapped.sourcePlatform !== input.sourcePlatform
    ) {
      throw new Error("legacy source does not match typed source identity");
    }
  }

  if (legacySource != null) {
    const mapped = LEGACY_SOURCE_IDENTITY[legacySource];
    return {
      source: legacySource,
      sourceKind: mapped.sourceKind,
      sourcePlatform: mapped.sourcePlatform
    };
  }

  if (input.sourceKind != null && input.sourcePlatform != null) {
    if (!isAllowedSourcePair(input.sourceKind, input.sourcePlatform)) {
      throw new Error("sourceKind is not valid for sourcePlatform");
    }
    return {
      source: legacySourceFor(input.sourceKind, input.sourcePlatform),
      sourceKind: input.sourceKind,
      sourcePlatform: input.sourcePlatform
    };
  }

  throw new Error("capture requires a legacy source or typed source identity");
}

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
    source: CaptureSourceSchema.optional(),
    sourceKind: SourceKindSchema.optional(),
    sourcePlatform: SourcePlatformSchema.optional(),
    scope: CaptureScopeSchema,
    title: z.string().trim().min(1).max(500),
    sensitivity: SensitivitySchema,
    externalRef: z.string().max(1000).nullable(),
    recoveryCaptureId: z.uuid().nullable().optional(),
    attachments: z.array(AttachmentManifestSchema).max(50),
    metadata: CaptureMetadataSchema.optional()
  })
  .superRefine((value, context) => {
    let identity: ReturnType<typeof resolveSourceIdentity>;
    try {
      identity = resolveSourceIdentity(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: value.source == null ? ["sourceKind"] : ["source"],
        message:
          error instanceof Error
            ? error.message
            : "capture requires a legacy source or typed source identity",
        input: value.source ?? value.sourceKind
      });
      return;
    }

    if (!STARTABLE_SOURCE_PLATFORMS.has(identity.sourcePlatform)) {
      context.addIssue({
        code: "custom",
        path: ["sourcePlatform"],
        message: `source platform ${identity.sourcePlatform} is not startable yet`,
        input: identity.sourcePlatform
      });
      return;
    }

    const allowedScopes: readonly CaptureScope[] =
      identity.sourcePlatform === "chatgpt"
        ? ["full_conversation", "qa_pair", "selection"]
        : identity.sourcePlatform === "xiaohongshu"
          ? ["web_page"]
          : identity.sourceKind === "manual_text"
            ? ["selection", "web_page", "upload"]
            : ["upload"];
    if (!allowedScopes.includes(value.scope)) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: `scope ${value.scope} is not supported for ${identity.sourcePlatform}/${identity.sourceKind}`,
        input: value.scope
      });
    }

    if (
      (identity.sourcePlatform === "chatgpt" ||
        identity.sourcePlatform === "xiaohongshu") &&
      (value.externalRef === null || value.externalRef.trim().length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalRef"],
        message:
          identity.sourcePlatform === "chatgpt"
            ? "ChatGPT capture requires a conversation reference"
            : "Xiaohongshu capture requires a note reference",
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
  etag: z.string().min(1).max(1000).optional()
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
  clientId: z.string().min(1).max(100),
  storagePath: z.string().min(1).max(2_000),
  token: z.string().min(1).max(4_096)
});

export const StartCaptureResultSchema = z.object({
  captureId: z.string().uuid(),
  uploadTargets: z.array(UploadTargetSchema).max(50)
});

export const CaptureFailureCodeSchema = z.enum([
  "attachment_manifest_conflict",
  "capture_already_failed",
  "capture_conflict",
  "capture_failed",
  "capture_id_conflict",
  "capture_not_found",
  "idempotency_conflict",
  "invalid_capture",
  "invalid_server_response",
  "storage_upload_failed",
  "upload_target_mismatch"
]);

export const ReportCaptureFailureInputSchema = z.object({
  failureCode: CaptureFailureCodeSchema
}).strict();

export const ReportCaptureFailureResultSchema = z.object({
  captureId: z.string().uuid(),
  captureStatus: z.literal("failed"),
  failureReason: z.string().trim().min(1).max(2000)
}).strict();

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
export type ReportCaptureFailureInput = z.infer<
  typeof ReportCaptureFailureInputSchema
>;
export type CaptureFailureCode = z.infer<typeof CaptureFailureCodeSchema>;
export type ReportCaptureFailureResult = z.infer<
  typeof ReportCaptureFailureResultSchema
>;
export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;
export type FailedCaptureStatus = z.infer<typeof FailedCaptureStatusSchema>;
export type CaptureStatusResult = z.infer<typeof CaptureStatusResultSchema>;
