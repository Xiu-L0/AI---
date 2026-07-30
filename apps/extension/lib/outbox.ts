import {
  AttachmentMimeTypeSchema,
  CapturedMessageSchema,
  CaptureReceiptSchema,
  SensitivitySchema,
  UploadedAttachmentSchema,
  type CaptureReceipt,
} from "@recall/contracts";
import { z } from "zod";
import { browser } from "wxt/browser";

import type { AttachmentStore } from "./attachment-store";
import {
  type CaptureDraft,
  isUnresolvedOutboxItem,
  type OutboxItem,
} from "./outbox-types";

export const OUTBOX_STORAGE_KEY = "recall.captureOutbox";
export const UNRESOLVED_COUNT_STORAGE_KEY =
  "recall.outbox.unresolvedCount";

const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [
  30 * 1_000,
  2 * 60 * 1_000,
  10 * 60 * 1_000,
  60 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
] as const;

type LocalStorageArea = Pick<typeof browser.storage.local, "get" | "set">;

export type OutboxOperationOptions = {
  createId?: () => string;
  createIdempotencyKey?: () => string;
  now?: Date;
  recoveryOfItemId?: string;
  storage?: LocalStorageArea;
};

const StoredAttachmentSchema = z.object({
  blobKey: z.string().trim().min(1).max(500),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  clientId: z.string().trim().min(1).max(100),
  fileName: z.string().trim().min(1).max(255),
  mimeType: AttachmentMimeTypeSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const PendingRemoteImageSchema = z.object({
  alt: z.string().max(2_000),
  clientId: z.string().trim().min(1).max(100),
  fileName: z.string().trim().min(1).max(255),
  messageOrdinal: z.number().int().nonnegative(),
  sourceUrl: z.string().trim().min(1).max(10_000),
});

const CaptureDraftSchema: z.ZodType<CaptureDraft> = z.object({
  attachments: z.array(StoredAttachmentSchema).max(50),
  completeness: z.enum(["complete", "partial"]),
  externalRef: z.string().trim().min(1).max(1_000),
  messages: z.array(CapturedMessageSchema).max(5_000),
  missingElements: z.array(z.string().trim().min(1).max(500)).max(50),
  originConversationRef: z.string().trim().min(1).max(1_000),
  originTabId: z.number().int().nonnegative(),
  originUrl: z.string().trim().min(1).max(10_000),
  originWindowId: z.number().int().nonnegative(),
  pendingImages: z.array(PendingRemoteImageSchema).max(5_000),
  rawText: z.string(),
  scope: z.enum(["full_conversation", "qa_pair", "selection"]),
  sensitivity: SensitivitySchema,
  source: z.literal("chatgpt_web"),
  title: z.string().trim().min(1).max(500),
});

const TimestampSchema = z.iso.datetime({ offset: true });
const NullableTimestampSchema = TimestampSchema.nullable();
const OutboxItemSchema: z.ZodType<OutboxItem> = z.object({
  attachmentsPrepared: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  captureId: z.uuid().nullable(),
  createdAt: TimestampSchema,
  draft: CaptureDraftSchema,
  errorCode: z.string().min(1).max(200).nullable(),
  id: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(8).max(200),
  lastError: z.string().min(1).max(2_000).nullable(),
  lastNotifiedAttemptCount: z.number().int().nonnegative(),
  nextAttemptAt: NullableTimestampSchema,
  receipt: CaptureReceiptSchema.nullable(),
  receiptStoredAt: NullableTimestampSchema,
  recoveryOfItemId: z.string().trim().min(1).max(200).nullable(),
  resolvedAt: NullableTimestampSchema,
  resumeStage: z.enum(["preparing", "uploading", "finalizing"]),
  schemaVersion: z.literal(1),
  state: z.enum([
    "pending",
    "uploading",
    "finalizing",
    "retry_wait",
    "auth_paused",
    "terminal",
    "complete",
    "partial",
  ]),
  supersededByItemId: z.string().trim().min(1).max(200).nullable(),
  updatedAt: TimestampSchema,
  uploadedAttachments: z.array(UploadedAttachmentSchema).max(50),
}).superRefine((item, context) => {
  const hasReceiptState = item.state === "complete" || item.state === "partial";
  if (hasReceiptState && (item.receipt === null || item.receiptStoredAt === null)) {
    context.addIssue({
      code: "custom",
      message: "receipt states require an atomically stored server receipt",
      path: ["receipt"],
      input: item,
    });
  }
  if (!hasReceiptState && item.receipt !== null) {
    context.addIssue({
      code: "custom",
      message: "unconfirmed states cannot contain a server receipt",
      path: ["receipt"],
      input: item.receipt,
    });
  }
  if (
    item.receipt !== null &&
    hasReceiptState &&
    item.receipt.captureStatus !== item.state
  ) {
    context.addIssue({
      code: "custom",
      message: "outbox state must match the server receipt",
      path: ["state"],
      input: item.state,
    });
  }
  if (item.supersededByItemId !== null && item.resolvedAt === null) {
    context.addIssue({
      code: "custom",
      message: "superseded items must be marked resolved",
      path: ["resolvedAt"],
      input: item.resolvedAt,
    });
  }
});

const mutationTails = new WeakMap<object, Promise<void>>();

export class OutboxStorageError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "OutboxStorageError";
  }
}

export class OutboxItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Capture outbox item ${id} was not found`);
    this.name = "OutboxItemNotFoundError";
  }
}

function resolvedStorage(options?: Pick<OutboxOperationOptions, "storage">) {
  return options?.storage ?? browser.storage.local;
}

function resolvedNow(options?: Pick<OutboxOperationOptions, "now">) {
  return options?.now ?? new Date();
}

async function serialized<T>(
  storage: LocalStorageArea,
  operation: () => Promise<T>,
): Promise<T> {
  const storageKey = storage as object;
  const previous = mutationTails.get(storageKey) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  mutationTails.set(
    storageKey,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

function parseItems(value: unknown): OutboxItem[] {
  if (value === undefined) {
    return [];
  }
  const parsed = z.array(OutboxItemSchema).safeParse(value);
  if (!parsed.success) {
    throw new OutboxStorageError("Stored capture outbox is corrupt", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function readItems(storage: LocalStorageArea): Promise<OutboxItem[]> {
  const stored = await storage.get(OUTBOX_STORAGE_KEY);
  return parseItems(stored[OUTBOX_STORAGE_KEY]);
}

function sortedItems(items: readonly OutboxItem[]): OutboxItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
      left.id.localeCompare(right.id),
  );
}

async function writeItems(
  storage: LocalStorageArea,
  items: readonly OutboxItem[],
): Promise<void> {
  const parsed = z.array(OutboxItemSchema).parse(sortedItems(items));
  await storage.set({
    [OUTBOX_STORAGE_KEY]: parsed,
    [UNRESOLVED_COUNT_STORAGE_KEY]: parsed.filter(isUnresolvedOutboxItem)
      .length,
  });
}

function itemIndex(items: readonly OutboxItem[], id: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new OutboxItemNotFoundError(id);
  }
  return index;
}

function referencedBlobKeys(items: readonly OutboxItem[]): Set<string> {
  return new Set(
    items.flatMap((item) =>
      item.draft.attachments.map((attachment) => attachment.blobKey),
    ),
  );
}

export async function listOutbox(
  options: Pick<OutboxOperationOptions, "storage"> = {},
): Promise<OutboxItem[]> {
  return sortedItems(await readItems(resolvedStorage(options)));
}

export async function getOutboxItem(
  id: string,
  options: Pick<OutboxOperationOptions, "storage"> = {},
): Promise<OutboxItem> {
  const items = await listOutbox(options);
  return items[itemIndex(items, id)]!;
}

export async function listUnresolvedOutbox(
  options: Pick<OutboxOperationOptions, "storage"> = {},
): Promise<OutboxItem[]> {
  return (await listOutbox(options)).filter(isUnresolvedOutboxItem);
}

export async function enqueueDraft(
  draft: CaptureDraft,
  options: OutboxOperationOptions = {},
): Promise<OutboxItem> {
  const storage = resolvedStorage(options);
  const now = resolvedNow(options).toISOString();
  const parsedDraft = CaptureDraftSchema.parse(draft);

  return serialized(storage, async () => {
    const items = await readItems(storage);
    const id = (options.createId ?? (() => crypto.randomUUID()))();
    const idempotencyKey = (
      options.createIdempotencyKey ?? (() => crypto.randomUUID())
    )();
    if (items.some((item) => item.id === id)) {
      throw new OutboxStorageError(`Capture outbox item ${id} already exists`);
    }
    if (items.some((item) => item.idempotencyKey === idempotencyKey)) {
      throw new OutboxStorageError(
        `Capture idempotency key ${idempotencyKey} already exists`,
      );
    }
    const recoveryOfItemId = options.recoveryOfItemId ?? null;
    if (
      recoveryOfItemId !== null &&
      !items.some((item) => item.id === recoveryOfItemId)
    ) {
      throw new OutboxItemNotFoundError(recoveryOfItemId);
    }

    const item = OutboxItemSchema.parse({
      attachmentsPrepared: parsedDraft.pendingImages.length === 0,
      attemptCount: 0,
      captureId: null,
      createdAt: now,
      draft: parsedDraft,
      errorCode: null,
      id,
      idempotencyKey,
      lastError: null,
      lastNotifiedAttemptCount: 0,
      nextAttemptAt: now,
      receipt: null,
      receiptStoredAt: null,
      recoveryOfItemId,
      resolvedAt: null,
      resumeStage: "preparing",
      schemaVersion: 1,
      state: "pending",
      supersededByItemId: null,
      updatedAt: now,
      uploadedAttachments: [],
    });
    await writeItems(storage, [...items, item]);
    return item;
  });
}

export async function mutateOutboxItem(
  id: string,
  updater: (item: OutboxItem) => OutboxItem | Promise<OutboxItem>,
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem> {
  const storage = resolvedStorage(options);
  const now = resolvedNow(options).toISOString();
  return serialized(storage, async () => {
    const items = await readItems(storage);
    const index = itemIndex(items, id);
    const previous = items[index]!;
    const candidate = await updater(OutboxItemSchema.parse(previous));
    if (candidate.idempotencyKey !== previous.idempotencyKey) {
      throw new OutboxStorageError("Capture idempotency key is immutable");
    }
    if (candidate.recoveryOfItemId !== previous.recoveryOfItemId) {
      throw new OutboxStorageError("Capture recovery link is immutable");
    }
    if (
      previous.captureId !== null &&
      candidate.captureId !== previous.captureId
    ) {
      throw new OutboxStorageError("Persisted capture id is immutable");
    }
    if (
      previous.captureId !== null &&
      JSON.stringify(candidate.draft) !== JSON.stringify(previous.draft)
    ) {
      throw new OutboxStorageError(
        "Capture draft is immutable after the capture session starts",
      );
    }
    const updated = OutboxItemSchema.parse({
      ...candidate,
      createdAt: previous.createdAt,
      id: previous.id,
      schemaVersion: 1,
      updatedAt: now,
    });
    items[index] = updated;
    await writeItems(storage, items);
    return updated;
  });
}

export const updateOutboxItem = mutateOutboxItem;

export async function markAttemptFailed(
  id: string,
  errorCode: string,
  message = errorCode,
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem> {
  const now = resolvedNow(options);
  return mutateOutboxItem(
    id,
    (item) => {
      const attemptCount = item.attemptCount + 1;
      const retryDelay =
        RETRY_DELAYS_MS[
          Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)
        ]!;
      return {
        ...item,
        attemptCount,
        errorCode,
        lastError: message,
        nextAttemptAt: new Date(now.getTime() + retryDelay).toISOString(),
        state: "retry_wait",
      };
    },
    { now, storage: resolvedStorage(options) },
  );
}

export async function markAuthPaused(
  id: string,
  errorCode: string,
  message: string,
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem> {
  return mutateOutboxItem(
    id,
    (item) => ({
      ...item,
      errorCode,
      lastError: message,
      nextAttemptAt: null,
      state: "auth_paused",
    }),
    options,
  );
}

export async function markTerminal(
  id: string,
  errorCode: string,
  message: string,
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem> {
  return mutateOutboxItem(
    id,
    (item) => ({
      ...item,
      errorCode,
      lastError: message,
      nextAttemptAt: null,
      state: "terminal",
    }),
    options,
  );
}

export async function resumeAuthenticationPausedItems(
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem[]> {
  const storage = resolvedStorage(options);
  const now = resolvedNow(options).toISOString();
  return serialized(storage, async () => {
    const items = await readItems(storage);
    const resumedIds = new Set(
      items
        .filter((item) => item.state === "auth_paused")
        .map((item) => item.id),
    );
    const resumed = items.map((item) =>
      item.state === "auth_paused"
        ? OutboxItemSchema.parse({
            ...item,
            errorCode: null,
            lastError: null,
            nextAttemptAt: now,
            state: "pending",
            updatedAt: now,
          })
        : item,
    );
    await writeItems(storage, resumed);
    return resumed.filter((item) => resumedIds.has(item.id));
  });
}

export async function storeReceipt(
  id: string,
  receipt: CaptureReceipt,
  options: Pick<OutboxOperationOptions, "now" | "storage"> = {},
): Promise<OutboxItem> {
  const storage = resolvedStorage(options);
  const now = resolvedNow(options).toISOString();
  const parsedReceipt = CaptureReceiptSchema.parse(receipt);

  return serialized(storage, async () => {
    const items = await readItems(storage);
    const index = itemIndex(items, id);
    const item = items[index]!;
    if (item.captureId !== null && item.captureId !== parsedReceipt.captureId) {
      throw new OutboxStorageError(
        "Server receipt capture id does not match the outbox item",
      );
    }

    const updated = OutboxItemSchema.parse({
      ...item,
      captureId: parsedReceipt.captureId,
      errorCode: null,
      lastError: null,
      nextAttemptAt: null,
      receipt: parsedReceipt,
      receiptStoredAt: now,
      resolvedAt: parsedReceipt.captureStatus === "complete" ? now : null,
      state: parsedReceipt.captureStatus,
      updatedAt: now,
    });
    items[index] = updated;

    if (updated.recoveryOfItemId !== null) {
      const recoveredIndex = itemIndex(items, updated.recoveryOfItemId);
      const recovered = items[recoveredIndex]!;
      items[recoveredIndex] = OutboxItemSchema.parse({
        ...recovered,
        resolvedAt: now,
        supersededByItemId: updated.id,
        updatedAt: now,
      });
    }

    await writeItems(storage, items);
    return updated;
  });
}

export async function pruneCompletedOutbox(
  now: Date,
  attachmentStore: Pick<AttachmentStore, "deleteAttachment">,
  options: Pick<OutboxOperationOptions, "storage"> = {},
): Promise<string[]> {
  const storage = resolvedStorage(options);
  return serialized(storage, async () => {
    const items = await readItems(storage);
    const cutoff = now.getTime() - COMPLETED_RETENTION_MS;
    const removed = items.filter((item) => {
      const retentionTimestamp = item.resolvedAt ?? item.receiptStoredAt;
      return (
        retentionTimestamp !== null &&
        (item.state === "complete" || item.supersededByItemId !== null) &&
        new Date(retentionTimestamp).getTime() <= cutoff
      );
    });
    if (removed.length === 0) {
      return [];
    }
    const removedIds = new Set(removed.map((item) => item.id));
    const remaining = items.filter((item) => !removedIds.has(item.id));
    const stillReferenced = referencedBlobKeys(remaining);
    const removableBlobKeys = new Set(
      removed.flatMap((item) =>
        item.draft.attachments.map((attachment) => attachment.blobKey),
      ),
    );

    await writeItems(storage, remaining);
    for (const blobKey of [...removableBlobKeys].sort()) {
      if (!stillReferenced.has(blobKey)) {
        await attachmentStore.deleteAttachment(blobKey);
      }
    }
    return removed.map((item) => item.id);
  });
}

export async function reconcileOrphanAttachments(
  attachmentStore: Pick<AttachmentStore, "deleteOrphanedAttachments">,
  now: Date,
  options: Pick<OutboxOperationOptions, "storage"> = {},
): Promise<string[]> {
  const storage = resolvedStorage(options);
  return serialized(storage, async () => {
    const referenced = referencedBlobKeys(await readItems(storage));
    return attachmentStore.deleteOrphanedAttachments(
      referenced,
      new Date(now.getTime() - COMPLETED_RETENTION_MS),
    );
  });
}
