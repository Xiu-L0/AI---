import {
  CaptureReceiptSchema,
  FinalizeCaptureInputSchema,
  StartCaptureInputSchema,
  type AttachmentMimeType,
  type CaptureFailureCode,
  type CaptureReceipt,
  type CaptureStatusResult,
  type StartCaptureInput,
  type UploadTarget,
  type UploadedAttachment,
} from "@recall/contracts";
import { ZodError } from "zod";

import {
  ExtensionApiError,
  ExtensionAuthExpiredError,
  type CaptureApiClient,
} from "./api-client";
import type { AttachmentStore } from "./attachment-store";
import { testFixtureOrigin } from "./chatgpt/origins";
import type { OutboxItem, StoredAttachment } from "./outbox-types";
import {
  StorageUploadError,
  uploadToSignedTarget,
} from "./storage-upload";

const MAX_ATTACHMENT_COUNT = 50;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<AttachmentMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const FAILURE_REPORT_RETRY_DELAYS_MS = [
  30 * 1_000,
  2 * 60 * 1_000,
  10 * 60 * 1_000,
  60 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
] as const;
const REPORTABLE_FAILURE_CODES = new Set<CaptureFailureCode>([
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
  "upload_target_mismatch",
]);

export type CaptureRunnerOutbox = {
  get(id: string): Promise<OutboxItem>;
  markAuthPaused(
    id: string,
    code: string,
    message: string,
    now: Date,
  ): Promise<OutboxItem>;
  markRetry(
    id: string,
    code: string,
    message: string,
    now: Date,
  ): Promise<OutboxItem>;
  markTerminal(
    id: string,
    code: string,
    message: string,
    now: Date,
  ): Promise<OutboxItem>;
  mutate(
    id: string,
    updater: (item: OutboxItem) => OutboxItem | Promise<OutboxItem>,
    now: Date,
  ): Promise<OutboxItem>;
  storeReceipt(
    id: string,
    receipt: CaptureReceipt,
    now: Date,
  ): Promise<OutboxItem>;
};

export type CaptureRunnerDependencies = {
  attachmentStore: Pick<AttachmentStore, "getAttachment" | "putAttachment">;
  blockedImageOrigins?: readonly string[];
  fetch?: typeof globalThis.fetch;
  getApiClient(): Promise<CaptureApiClient>;
  now?: () => Date;
  outbox: CaptureRunnerOutbox;
  upload?: typeof uploadToSignedTarget;
};

type StatusProbe =
  | { kind: "receipt"; receipt: CaptureReceipt }
  | { kind: "failed"; reason: string }
  | { kind: "pending" };

class RetryableImageFetchError extends Error {
  override readonly name = "RetryableImageFetchError";
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Capture attempt failed";
}

function errorCode(error: unknown): string {
  if (error instanceof ZodError) return "invalid_server_response";
  if (error instanceof ExtensionApiError && error.code) return error.code;
  if (error instanceof StorageUploadError) return "storage_upload_failed";
  return error instanceof Error && error.name
    ? error.name.toLowerCase()
    : "capture_failed";
}

function isAuthError(error: unknown): boolean {
  return (
    error instanceof ExtensionAuthExpiredError ||
    (error instanceof ExtensionApiError && error.status === 401)
  );
}

function isRetryableApiError(error: unknown): boolean {
  if (error instanceof StorageUploadError) {
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  if (!(error instanceof ExtensionApiError)) return true;
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.code === "capture_session_expired" ||
    error.code === "signed_upload_failed" ||
    error.code === "capture_not_finalized"
  );
}

function isTerminalApiError(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    (error instanceof StorageUploadError && !isRetryableApiError(error)) ||
    (error instanceof ExtensionApiError &&
      ((error.status >= 400 &&
        error.status < 500 &&
        !isRetryableApiError(error)) ||
        error.code === "invalid_capture" ||
        error.code === "idempotency_conflict" ||
        error.code === "capture_conflict" ||
        error.code === "capture_already_failed" ||
        error.code === "capture_not_found"))
  );
}

function statusReceipt(result: CaptureStatusResult): StatusProbe {
  if (result.captureStatus === "failed") {
    return { kind: "failed", reason: result.failureReason };
  }
  const { failureReason: _failureReason, ...receipt } = result;
  return { kind: "receipt", receipt: CaptureReceiptSchema.parse(receipt) };
}

async function probeStatus(
  api: CaptureApiClient,
  captureId: string,
): Promise<StatusProbe> {
  try {
    return statusReceipt(await api.status(captureId));
  } catch (error) {
    if (
      error instanceof ExtensionApiError &&
      error.code === "capture_not_finalized"
    ) {
      return { kind: "pending" };
    }
    throw error;
  }
}

function normalizeMimeType(value: string): AttachmentMimeType | null {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType as AttachmentMimeType)
    ? (mimeType as AttachmentMimeType)
    : null;
}

function configuredOrigin(value: string | undefined, fallback: string): string {
  try {
    return new URL(value ?? fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

function blockedImageOrigins(
  dependencies: CaptureRunnerDependencies,
): ReadonlySet<string> {
  return new Set(
    dependencies.blockedImageOrigins ?? [
      configuredOrigin(
        import.meta.env.WXT_PUBLIC_API_ORIGIN,
        "http://localhost:3000",
      ),
      configuredOrigin(
        import.meta.env.WXT_PUBLIC_SUPABASE_URL,
        "http://127.0.0.1:55321",
      ),
    ],
  );
}

function safeRemoteImageUrl(
  value: string,
  blockedOrigins: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("图片地址无效");
  }
  if (url.protocol === "data:") {
    if (!value.startsWith("data:image/")) {
      throw new Error("不支持的 data URL");
    }
    return url;
  }
  const isLocalTestOrigin = url.origin === testFixtureOrigin();
  if (
    url.protocol !== "https:" &&
    !isLocalTestOrigin &&
    !(url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
  ) {
    throw new Error("远程图片必须使用 HTTPS");
  }
  if (url.username || url.password || blockedOrigins.has(url.origin)) {
    throw new Error("图片来源不在允许的安全边界内");
  }
  return url;
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if ("arrayBuffer" in blob && typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer), {
      once: true,
    });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blobBytes(blob));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hasExpectedImageSignature(
  blob: Blob,
  mimeType: AttachmentMimeType,
): Promise<boolean> {
  const bytes = new Uint8Array(await blobBytes(blob.slice(0, 12)));
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function missingImageDescription(messageOrdinal: number, reason: string): string {
  return `第 ${messageOrdinal + 1} 条消息中的图片无法保存：${reason}`.slice(
    0,
    500,
  );
}

async function startInput(
  item: OutboxItem,
  outbox: Pick<CaptureRunnerOutbox, "get">,
): Promise<StartCaptureInput> {
  let recoveryCaptureId: string | null = null;
  let ancestorId = item.recoveryOfItemId;
  const visited = new Set<string>();
  while (ancestorId !== null && !visited.has(ancestorId)) {
    visited.add(ancestorId);
    const ancestor = await outbox.get(ancestorId);
    if (ancestor.state !== "terminal") break;
    if (ancestor.captureId !== null) {
      recoveryCaptureId = ancestor.captureId;
      break;
    }
    ancestorId = ancestor.recoveryOfItemId;
  }
  return {
    attachments: item.draft.attachments.map(
      ({ clientId, fileName, mimeType, byteSize, sha256: hash }) => ({
        byteSize,
        clientId,
        fileName,
        mimeType,
        sha256: hash,
      }),
    ),
    externalRef: item.draft.externalRef,
    idempotencyKey: item.idempotencyKey,
    ...(recoveryCaptureId === null ? {} : { recoveryCaptureId }),
    scope: item.draft.scope,
    sensitivity: item.draft.sensitivity,
    source: item.draft.source,
    title: item.draft.title,
  };
}

function finalizedInput(item: OutboxItem) {
  return {
    completeness: item.draft.completeness,
    idempotencyKey: item.idempotencyKey,
    messages: item.draft.messages,
    missingElements: item.draft.missingElements,
    rawText: "",
    uploadedAttachments: item.uploadedAttachments,
  } as const;
}

function targetMap(targets: readonly UploadTarget[]) {
  return new Map(targets.map((target) => [target.clientId, target]));
}

async function verifyStoredBlob(
  attachmentStore: Pick<AttachmentStore, "getAttachment">,
  attachment: StoredAttachment,
): Promise<Blob> {
  const blob = await attachmentStore.getAttachment(attachment.blobKey);
  if (blob === null) {
    throw new Error(`Attachment bytes are missing for ${attachment.clientId}`);
  }
  if (
    blob.size !== attachment.byteSize ||
    normalizeMimeType(blob.type) !== attachment.mimeType ||
    (await sha256(blob)) !== attachment.sha256
  ) {
    throw new Error(`Attachment bytes changed for ${attachment.clientId}`);
  }
  if (!(await hasExpectedImageSignature(blob, attachment.mimeType))) {
    throw new Error(`Attachment image signature is invalid for ${attachment.clientId}`);
  }
  return blob;
}

async function prepareAttachments(
  item: OutboxItem,
  dependencies: CaptureRunnerDependencies,
  now: Date,
): Promise<OutboxItem> {
  if (item.attachmentsPrepared) return item;

  const nextAttachments = [...item.draft.attachments];
  const nextMissing = [...item.draft.missingElements];
  let totalBytes = nextAttachments.reduce(
    (sum, attachment) => sum + attachment.byteSize,
    0,
  );
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const blockedOrigins = blockedImageOrigins(dependencies);
  const availableSlots = Math.max(0, MAX_ATTACHMENT_COUNT - nextAttachments.length);
  const pending = item.draft.pendingImages.slice(0, availableSlots);
  const omittedCount = item.draft.pendingImages.length - pending.length;
  if (omittedCount > 0) {
    nextMissing.push(`${omittedCount} 张图片因单次最多 50 个附件而未保存`);
  }

  for (const image of pending) {
    try {
      const sourceUrl = safeRemoteImageUrl(image.sourceUrl, blockedOrigins);
      let response: Response;
      try {
        response = await fetcher(sourceUrl, {
          credentials: "omit",
          redirect: "manual",
        });
      } catch {
        throw new RetryableImageFetchError("图片下载暂时失败");
      }
      if (
        response.type === "opaqueredirect" ||
        (response.status >= 300 && response.status < 400)
      ) {
        throw new Error("图片重定向未被允许");
      }
      if (!response.ok) {
        if (
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          throw new RetryableImageFetchError(
            `图片服务器暂时不可用（HTTP ${response.status}）`,
          );
        }
        throw new Error(`HTTP ${response.status}`);
      }
      let blob: Blob;
      try {
        blob = await response.blob();
      } catch {
        throw new RetryableImageFetchError("图片响应读取暂时失败");
      }
      const mimeType = normalizeMimeType(blob.type);
      if (mimeType === null) throw new Error("不支持的图片格式");
      if (blob.size <= 0) throw new Error("图片内容为空");
      if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error("图片超过 10 MiB");
      if (totalBytes + blob.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new Error("本次附件总量超过 100 MiB");
      }
      if (!(await hasExpectedImageSignature(blob, mimeType))) {
        throw new Error("图片内容与声明格式不一致");
      }
      const hash = await sha256(blob);
      const blobKey = `${item.id}:${image.clientId}:${hash.slice(0, 16)}`;
      try {
        await dependencies.attachmentStore.putAttachment(blobKey, blob);
      } catch {
        throw new RetryableImageFetchError("图片本地暂存暂时失败");
      }
      nextAttachments.push({
        blobKey,
        byteSize: blob.size,
        clientId: image.clientId,
        fileName: image.fileName,
        mimeType,
        sha256: hash,
      });
      totalBytes += blob.size;
    } catch (error) {
      if (error instanceof RetryableImageFetchError) throw error;
      nextMissing.push(
        missingImageDescription(image.messageOrdinal, readableError(error)),
      );
    }
  }

  const missingElements = [...new Set(nextMissing)].slice(0, 50);
  return dependencies.outbox.mutate(
    item.id,
    (current) => ({
      ...current,
      attachmentsPrepared: true,
      draft: {
        ...current.draft,
        attachments: nextAttachments,
        completeness: missingElements.length === 0 ? "complete" : "partial",
        missingElements,
        pendingImages: [],
      },
      resumeStage: "uploading",
    }),
    now,
  );
}

async function handleFailure(
  itemId: string,
  error: unknown,
  dependencies: CaptureRunnerDependencies,
  now: Date,
  api?: CaptureApiClient,
): Promise<OutboxItem> {
  const code = errorCode(error);
  const message = readableError(error);
  if (isAuthError(error)) {
    return dependencies.outbox.markAuthPaused(itemId, code, message, now);
  }
  if (isTerminalApiError(error)) {
    return markTerminalAndReport(itemId, code, message, dependencies, now, api);
  }
  return dependencies.outbox.markRetry(itemId, code, message, now);
}

function reportableFailureCode(code: string | null): CaptureFailureCode {
  return code !== null && REPORTABLE_FAILURE_CODES.has(code as CaptureFailureCode)
    ? (code as CaptureFailureCode)
    : "capture_failed";
}

function isRetryableFailureReportError(error: unknown): boolean {
  if (!(error instanceof ExtensionApiError)) return true;
  return (
    error.status === 0 ||
    error.status === 401 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

async function reportTerminalFailure(
  terminal: OutboxItem,
  api: CaptureApiClient,
  dependencies: CaptureRunnerDependencies,
  now: Date,
): Promise<OutboxItem> {
  if (
    terminal.captureId === null ||
    terminal.failureReportStatus !== "pending"
  ) {
    return terminal;
  }

  try {
    await api.reportFailure(terminal.captureId, {
      failureCode: reportableFailureCode(terminal.errorCode),
    });
    return dependencies.outbox.mutate(
      terminal.id,
      (current) => ({
        ...current,
        failureReportNextAttemptAt: null,
        failureReportStatus: "reported",
        failureReportedAt: now.toISOString(),
      }),
      now,
    );
  } catch (error) {
    if (!isRetryableFailureReportError(error)) {
      return dependencies.outbox.mutate(
        terminal.id,
        (current) => ({
          ...current,
          failureReportNextAttemptAt: null,
          failureReportStatus: "rejected",
          failureReportedAt: null,
        }),
        now,
      );
    }
    return dependencies.outbox.mutate(
      terminal.id,
      (current) => {
        const attemptCount = (current.failureReportAttemptCount ?? 0) + 1;
        const retryDelay =
          FAILURE_REPORT_RETRY_DELAYS_MS[
            Math.min(
              attemptCount - 1,
              FAILURE_REPORT_RETRY_DELAYS_MS.length - 1,
            )
          ]!;
        return {
          ...current,
          failureReportAttemptCount: attemptCount,
          failureReportNextAttemptAt: new Date(
            now.getTime() + retryDelay,
          ).toISOString(),
          failureReportStatus: "pending",
          failureReportedAt: null,
        };
      },
      now,
    );
  }
}

async function markTerminalAndReport(
  itemId: string,
  code: string,
  message: string,
  dependencies: CaptureRunnerDependencies,
  now: Date,
  api?: CaptureApiClient,
): Promise<OutboxItem> {
  const terminal = await dependencies.outbox.markTerminal(
    itemId,
    code,
    message,
    now,
  );
  return api === undefined
    ? terminal
    : reportTerminalFailure(terminal, api, dependencies, now);
}

export function createCaptureRunner(dependencies: CaptureRunnerDependencies) {
  const inFlight = new Map<string, Promise<OutboxItem>>();

  async function run(itemId: string, now: Date): Promise<OutboxItem> {
    let item = await dependencies.outbox.get(itemId);
    if (item.receipt !== null && (item.state === "complete" || item.state === "partial")) {
      return item;
    }
    if (item.state === "auth_paused") return item;
    if (item.state === "terminal") {
      if (item.failureReportStatus !== "pending" || item.captureId === null) {
        return item;
      }
      try {
        const api = await dependencies.getApiClient();
        return reportTerminalFailure(item, api, dependencies, now);
      } catch {
        return dependencies.outbox.mutate(
          item.id,
          (current) => {
            const attemptCount = (current.failureReportAttemptCount ?? 0) + 1;
            const retryDelay =
              FAILURE_REPORT_RETRY_DELAYS_MS[
                Math.min(
                  attemptCount - 1,
                  FAILURE_REPORT_RETRY_DELAYS_MS.length - 1,
                )
              ]!;
            return {
              ...current,
              failureReportAttemptCount: attemptCount,
              failureReportNextAttemptAt: new Date(
                now.getTime() + retryDelay,
              ).toISOString(),
            };
          },
          now,
        );
      }
    }

    let api: CaptureApiClient | undefined;
    try {
      api = await dependencies.getApiClient();
      item = await prepareAttachments(item, dependencies, now);
    } catch (error) {
      return handleFailure(itemId, error, dependencies, now, api);
    }

    if (api === undefined) {
      return dependencies.outbox.markRetry(
        itemId,
        "capture_failed",
        "Capture API client was unavailable",
        now,
      );
    }

    if (item.state === "finalizing" && item.captureId !== null) {
      try {
        const status = await probeStatus(api, item.captureId);
        if (status.kind === "receipt") {
          return dependencies.outbox.storeReceipt(itemId, status.receipt, now);
        }
      } catch (error) {
        if (isAuthError(error)) {
          return handleFailure(itemId, error, dependencies, now, api);
        }
        if (!isRetryableApiError(error)) {
          return handleFailure(itemId, error, dependencies, now, api);
        }
      }
    }

    const parsedStartInput = StartCaptureInputSchema.safeParse(
      await startInput(item, dependencies.outbox),
    );
    if (!parsedStartInput.success) {
      return markTerminalAndReport(
        itemId,
        "invalid_capture",
        parsedStartInput.error.issues[0]?.message ?? "Capture manifest is invalid",
        dependencies,
        now,
        api,
      );
    }

    let started: Awaited<ReturnType<CaptureApiClient["start"]>>;
    try {
      started = await api.start(parsedStartInput.data);
    } catch (error) {
      if (
        error instanceof ExtensionApiError &&
        error.code === "capture_already_finalized"
      ) {
        const captureId = item.captureId ?? error.captureId;
        if (captureId === undefined) {
          return dependencies.outbox.markRetry(
            itemId,
            error.code,
            "Server finalized the capture but did not return a capture id",
            now,
          );
        }
        try {
          const status = await probeStatus(api, captureId);
          if (status.kind === "receipt") {
            return dependencies.outbox.storeReceipt(itemId, status.receipt, now);
          }
          return dependencies.outbox.markRetry(
            itemId,
            "capture_not_finalized",
            "Server has not returned a durable receipt yet",
            now,
          );
        } catch (statusError) {
          return handleFailure(itemId, statusError, dependencies, now, api);
        }
      }
      return handleFailure(itemId, error, dependencies, now, api);
    }

    if (item.captureId !== null && item.captureId !== started.captureId) {
      return markTerminalAndReport(
        itemId,
        "capture_id_conflict",
        "Server returned a different capture id for the same outbox item",
        dependencies,
        now,
        api,
      );
    }

    item = await dependencies.outbox.mutate(
      itemId,
      (current) => ({
        ...current,
        captureId: started.captureId,
        errorCode: null,
        lastError: null,
        nextAttemptAt: null,
        resumeStage: "uploading",
        state: "uploading",
      }),
      now,
    );

    const targets = targetMap(started.uploadTargets);
    const attachmentIds = item.draft.attachments
      .map((attachment) => attachment.clientId)
      .sort();
    const targetIds = [...targets.keys()].sort();
    if (
      targets.size !== started.uploadTargets.length ||
      targets.size !== item.draft.attachments.length ||
      attachmentIds.some((clientId, index) => clientId !== targetIds[index])
    ) {
      return markTerminalAndReport(
        itemId,
        "upload_target_mismatch",
        "Server upload targets do not match the frozen attachment manifest",
        dependencies,
        now,
        api,
      );
    }

    const uploaded: UploadedAttachment[] = [];
    try {
      for (const attachment of item.draft.attachments) {
        const target = targets.get(attachment.clientId);
        if (!target) throw new Error(`Upload target missing for ${attachment.clientId}`);
        const blob = await verifyStoredBlob(
          dependencies.attachmentStore,
          attachment,
        );
        uploaded.push(
          await (dependencies.upload ?? uploadToSignedTarget)(target, blob),
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("Attachment bytes are missing") ||
          error.message.startsWith("Attachment bytes changed") ||
          error.message.startsWith("Attachment image signature is invalid"))
      ) {
        return markTerminalAndReport(
          itemId,
          "attachment_manifest_conflict",
          error.message,
          dependencies,
          now,
          api,
        );
      }
      return handleFailure(itemId, error, dependencies, now, api);
    }

    item = await dependencies.outbox.mutate(
      itemId,
      (current) => ({
        ...current,
        resumeStage: "finalizing",
        state: "finalizing",
        uploadedAttachments: uploaded,
      }),
      now,
    );

    const parsedFinalizeInput = FinalizeCaptureInputSchema.safeParse(
      finalizedInput(item),
    );
    if (!parsedFinalizeInput.success) {
      return markTerminalAndReport(
        itemId,
        "invalid_capture",
        parsedFinalizeInput.error.issues[0]?.message ??
          "Capture finalization input is invalid",
        dependencies,
        now,
        api,
      );
    }

    try {
      const receipt = await api.finalize(
        started.captureId,
        parsedFinalizeInput.data,
      );
      return dependencies.outbox.storeReceipt(itemId, receipt, now);
    } catch (error) {
      if (isAuthError(error)) return handleFailure(itemId, error, dependencies, now, api);
      try {
        const status = await probeStatus(api, started.captureId);
        if (status.kind === "receipt") {
          return dependencies.outbox.storeReceipt(itemId, status.receipt, now);
        }
      } catch (statusError) {
        if (isAuthError(statusError)) {
          return handleFailure(itemId, statusError, dependencies, now, api);
        }
      }
      return handleFailure(itemId, error, dependencies, now, api);
    }
  }

  return {
    processOutboxItem(itemId: string, now = dependencies.now?.() ?? new Date()) {
      const existing = inFlight.get(itemId);
      if (existing) return existing;
      const pending = run(itemId, now).finally(() => {
        if (inFlight.get(itemId) === pending) inFlight.delete(itemId);
      });
      inFlight.set(itemId, pending);
      return pending;
    },
  };
}
