import {
  CaptureReceiptSchema,
  CaptureStatusResultSchema,
  FinalizeCaptureInputSchema,
  StartCaptureInputSchema,
  StartCaptureResultSchema,
  type CaptureMetadata,
  type CaptureReceipt,
  type CaptureScope,
  type CaptureSource,
  type CapturedMessage,
  type FinalizableCompleteness,
  type Sensitivity,
  type SourceKind,
  type SourcePlatform,
  type StartCaptureResult,
} from "@recall/contracts";
import { z } from "zod";

export type BrowserCaptureAttachment = {
  clientId: string;
  file: File;
};

export type BrowserCaptureDraft = {
  attachments: readonly BrowserCaptureAttachment[];
  completeness: FinalizableCompleteness;
  externalRef: string | null;
  idempotencyKey?: string;
  recoveryCaptureId?: string;
  messages: readonly CapturedMessage[];
  metadata?: CaptureMetadata;
  missingElements: readonly string[];
  rawText: string;
  scope: CaptureScope;
  sensitivity: Sensitivity;
  source?: CaptureSource;
  sourceKind?: SourceKind;
  sourcePlatform?: SourcePlatform;
  title: string;
};

type SignedUploadTarget = StartCaptureResult["uploadTargets"][number];

export type UploadCaptureProgress =
  | { stage: "preparing" }
  | {
      stage: "uploading";
      completedFiles: number;
      totalFiles: number;
      currentFileName: string;
    }
  | { stage: "finalizing" };

export interface UploadCaptureDependencies {
  createIdempotencyKey?: () => string;
  fetch?: typeof globalThis.fetch;
  hashFile?: (file: File) => Promise<string>;
  onProgress?: (progress: UploadCaptureProgress) => void;
  uploadToSignedUrl?: (
    target: SignedUploadTarget,
    file: File,
  ) => Promise<void>;
}

export class CaptureUploadHttpError extends Error {
  readonly code: string | undefined;
  readonly payload: unknown;
  readonly status: number;

  constructor(
    status: number,
    payload: unknown,
    code: string | undefined,
  ) {
    super(`Capture request failed with HTTP ${status}`);
    this.name = "CaptureUploadHttpError";
    this.code = code;
    this.payload = payload;
    this.status = status;
  }
}

const idempotencyKeys = new WeakMap<BrowserCaptureDraft, string>();
const FinalizedStartErrorPayloadSchema = z.object({
  captureId: z.string().uuid(),
  code: z.literal("capture_already_finalized"),
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hashBrowserFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );

  return bytesToHex(new Uint8Array(digest));
}

function getIdempotencyKey(
  draft: BrowserCaptureDraft,
  createIdempotencyKey: () => string,
): string {
  if (draft.idempotencyKey !== undefined) {
    return draft.idempotencyKey;
  }

  const existing = idempotencyKeys.get(draft);
  if (existing !== undefined) {
    return existing;
  }

  const created = createIdempotencyKey();
  idempotencyKeys.set(draft, created);
  return created;
}

async function defaultUploadToSignedUrl(
  target: SignedUploadTarget,
  file: File,
): Promise<void> {
  const { createBrowserClient } = await import("@/lib/supabase/browser");
  const supabase = createBrowserClient();
  const { error } = await supabase.storage
    .from("raw-captures")
    .uploadToSignedUrl(target.storagePath, target.token, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw error;
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function serverErrorCode(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "code" in payload &&
    typeof payload.code === "string"
  ) {
    return payload.code;
  }
  return undefined;
}

async function postJson(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new CaptureUploadHttpError(
      response.status,
      payload,
      serverErrorCode(payload),
    );
  }

  return payload;
}

async function getJson(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
): Promise<unknown> {
  const response = await fetchImplementation(url, { method: "GET" });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new CaptureUploadHttpError(
      response.status,
      payload,
      serverErrorCode(payload),
    );
  }

  return payload;
}

async function recoverFinalizedReceipt(
  fetchImplementation: typeof globalThis.fetch,
  error: CaptureUploadHttpError,
): Promise<CaptureReceipt | null> {
  const finalized = FinalizedStartErrorPayloadSchema.safeParse(error.payload);
  if (!finalized.success) {
    return null;
  }

  const status = CaptureStatusResultSchema.parse(
    await getJson(
      fetchImplementation,
      `/api/captures/${finalized.data.captureId}/status`,
    ),
  );
  const receipt = CaptureReceiptSchema.parse(status);
  if (receipt.captureId !== finalized.data.captureId) {
    throw new Error("Capture status response returned the wrong capture id");
  }
  return receipt;
}

function targetsByClientId(
  result: StartCaptureResult,
): Map<string, SignedUploadTarget> {
  const targets = new Map<string, SignedUploadTarget>();
  for (const target of result.uploadTargets) {
    if (targets.has(target.clientId)) {
      throw new Error(`Duplicate upload target for ${target.clientId}`);
    }
    targets.set(target.clientId, target);
  }
  return targets;
}

export async function uploadCapture(
  draft: BrowserCaptureDraft,
  dependencies: UploadCaptureDependencies = {},
): Promise<CaptureReceipt> {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const hashFile = dependencies.hashFile ?? hashBrowserFile;
  const uploadToSignedUrl =
    dependencies.uploadToSignedUrl ?? defaultUploadToSignedUrl;
  const onProgress = dependencies.onProgress ?? (() => undefined);
  const idempotencyKey = getIdempotencyKey(
    draft,
    dependencies.createIdempotencyKey ?? (() => crypto.randomUUID()),
  );

  onProgress({ stage: "preparing" });
  const attachments = await Promise.all(
    draft.attachments.map(async ({ clientId, file }) => ({
      byteSize: file.size,
      clientId,
      fileName: file.name,
      mimeType: file.type,
      sha256: await hashFile(file),
    })),
  );
  const startInput = StartCaptureInputSchema.parse({
    attachments,
    externalRef: draft.externalRef,
    idempotencyKey,
    ...(draft.recoveryCaptureId === undefined
      ? {}
      : { recoveryCaptureId: draft.recoveryCaptureId }),
    scope: draft.scope,
    sensitivity: draft.sensitivity,
    ...(draft.source === undefined ? {} : { source: draft.source }),
    ...(draft.sourceKind === undefined ? {} : { sourceKind: draft.sourceKind }),
    ...(draft.sourcePlatform === undefined
      ? {}
      : { sourcePlatform: draft.sourcePlatform }),
    ...(draft.metadata === undefined ? {} : { metadata: draft.metadata }),
    title: draft.title,
  });
  let startResult: StartCaptureResult;
  try {
    startResult = StartCaptureResultSchema.parse(
      await postJson(fetchImplementation, "/api/captures/start", startInput),
    );
  } catch (error) {
    if (
      error instanceof CaptureUploadHttpError &&
      error.code === "capture_already_finalized"
    ) {
      onProgress({ stage: "finalizing" });
      const recovered = await recoverFinalizedReceipt(
        fetchImplementation,
        error,
      );
      if (recovered !== null) {
        return recovered;
      }
    }
    throw error;
  }
  const targets = targetsByClientId(startResult);
  const uploadedAttachments: Array<{
    clientId: string;
    storagePath: string;
  }> = [];

  for (const attachment of draft.attachments) {
    const target = targets.get(attachment.clientId);
    if (target === undefined) {
      throw new Error(
        `Capture start response omitted upload target ${attachment.clientId}`,
      );
    }
    onProgress({
      completedFiles: uploadedAttachments.length,
      currentFileName: attachment.file.name,
      stage: "uploading",
      totalFiles: draft.attachments.length,
    });
    await uploadToSignedUrl(target, attachment.file);
    uploadedAttachments.push({
      clientId: attachment.clientId,
      storagePath: target.storagePath,
    });
    onProgress({
      completedFiles: uploadedAttachments.length,
      currentFileName: attachment.file.name,
      stage: "uploading",
      totalFiles: draft.attachments.length,
    });
  }

  if (targets.size !== uploadedAttachments.length) {
    throw new Error("Capture start response contained unexpected upload targets");
  }

  const finalizeInput = FinalizeCaptureInputSchema.parse({
    completeness: draft.completeness,
    idempotencyKey,
    messages: [...draft.messages],
    missingElements: [...draft.missingElements],
    rawText: draft.rawText,
    uploadedAttachments,
  });
  onProgress({ stage: "finalizing" });
  const receiptPayload = await postJson(
    fetchImplementation,
    `/api/captures/${startResult.captureId}/finalize`,
    finalizeInput,
  );

  return CaptureReceiptSchema.parse(receiptPayload);
}
