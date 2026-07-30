import type { CaptureReceipt } from "@recall/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { AttachmentStore } from "./attachment-store";
import {
  enqueueDraft,
  getOutboxItem,
  listOutbox,
  listUnresolvedOutbox,
  markAttemptFailed,
  markAuthPaused,
  markTerminal,
  mutateOutboxItem,
  OUTBOX_STORAGE_KEY,
  pruneCompletedOutbox,
  reconcileOrphanAttachments,
  resumeAuthenticationPausedItems,
  storeReceipt,
  UNRESOLVED_COUNT_STORAGE_KEY,
} from "./outbox";
import type { CaptureDraft } from "./outbox-types";

const NOW = new Date("2026-07-30T12:00:00.000Z");

function draft(overrides: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    attachments: [],
    completeness: "complete",
    externalRef: "synthetic-conversation",
    messages: [
      {
        externalMessageId: "message-1",
        ordinal: 0,
        role: "user",
        text: "Synthetic question",
      },
    ],
    missingElements: [],
    originConversationRef: "synthetic-conversation",
    originTabId: 12,
    originUrl: "https://chatgpt.com/c/synthetic-conversation",
    originWindowId: 8,
    pendingImages: [],
    rawText: "Synthetic question",
    scope: "full_conversation",
    sensitivity: "normal",
    source: "chatgpt_web",
    title: "Synthetic conversation",
    ...overrides,
  };
}

function receipt(
  captureStatus: "complete" | "partial" = "complete",
): CaptureReceipt {
  return {
    captureId: "20000000-0000-4000-8000-000000000001",
    captureStatus,
    missingElements:
      captureStatus === "partial" ? ["Synthetic image was unavailable"] : [],
    processingStatus: "queued",
    savedAttachmentCount: 0,
    savedMessageCount: 1,
    sourceItemId: "30000000-0000-4000-8000-000000000001",
  };
}

function options(sequence = 1) {
  return {
    createId: () => `outbox-${sequence}`,
    createIdempotencyKey: () => `idempotency-${sequence}`,
    now: NOW,
    storage: fakeBrowser.storage.local,
  };
}

describe("capture outbox", () => {
  beforeEach(() => fakeBrowser.reset());

  it("persists a draft and unresolved count before processing", async () => {
    const item = await enqueueDraft(draft(), options());

    expect(item).toMatchObject({
      id: "outbox-1",
      idempotencyKey: "idempotency-1",
      state: "pending",
    });
    expect(await listUnresolvedOutbox({ storage: fakeBrowser.storage.local })).toEqual([
      item,
    ]);
    expect(
      await fakeBrowser.storage.local.get(UNRESOLVED_COUNT_STORAGE_KEY),
    ).toEqual({ [UNRESOLVED_COUNT_STORAGE_KEY]: 1 });
  });

  it("persists more than fifty pending image references before materialization", async () => {
    const pendingImages = Array.from({ length: 51 }, (_, index) => ({
      alt: `Synthetic ${index}`,
      clientId: `image-${index}`,
      fileName: `image-${index}.png`,
      messageOrdinal: 0,
      sourceUrl: `https://images.example.test/${index}.png`,
    }));

    const item = await enqueueDraft(draft({ pendingImages }), options());

    expect(item.attachmentsPrepared).toBe(false);
    expect(item.draft.pendingImages).toHaveLength(51);
  });

  it("serializes concurrent failures without losing an attempt", async () => {
    const item = await enqueueDraft(draft(), options());
    const time = new Date("2026-07-30T12:00:10.000Z");

    await Promise.all([
      markAttemptFailed(item.id, "network_error", "Offline", {
        now: time,
        storage: fakeBrowser.storage.local,
      }),
      markAttemptFailed(item.id, "network_error", "Offline again", {
        now: time,
        storage: fakeBrowser.storage.local,
      }),
    ]);

    expect(await getOutboxItem(item.id, { storage: fakeBrowser.storage.local })).toMatchObject({
      attemptCount: 2,
      nextAttemptAt: "2026-07-30T12:02:10.000Z",
      state: "retry_wait",
    });
  });

  it("prevents mutation from changing the stable idempotency key", async () => {
    const item = await enqueueDraft(draft(), options());

    await expect(
      mutateOutboxItem(
        item.id,
        (current) => ({ ...current, idempotencyKey: "different-key" }),
        { storage: fakeBrowser.storage.local },
      ),
    ).rejects.toThrow("Capture idempotency key is immutable");
  });

  it("uses the capped retry schedule", async () => {
    const item = await enqueueDraft(draft(), options());
    const expectedDelays = [30, 120, 600, 3600, 21600, 21600];

    for (const [index, delaySeconds] of expectedDelays.entries()) {
      const now = new Date(NOW.getTime() + index * 1_000);
      const failed = await markAttemptFailed(
        item.id,
        "network_error",
        "Offline",
        { now, storage: fakeBrowser.storage.local },
      );
      expect(new Date(failed.nextAttemptAt!).getTime() - now.getTime()).toBe(
        delaySeconds * 1_000,
      );
    }
  });

  it("keeps authentication and terminal failures unresolved without alarms", async () => {
    const auth = await enqueueDraft(draft(), options(1));
    const terminal = await enqueueDraft(draft(), options(2));

    await markAuthPaused(auth.id, "authentication_required", "Pair again", {
      now: NOW,
      storage: fakeBrowser.storage.local,
    });
    await markTerminal(terminal.id, "idempotency_conflict", "Needs recovery", {
      now: NOW,
      storage: fakeBrowser.storage.local,
    });

    expect(await listUnresolvedOutbox({ storage: fakeBrowser.storage.local })).toEqual([
      expect.objectContaining({ nextAttemptAt: null, state: "auth_paused" }),
      expect.objectContaining({ nextAttemptAt: null, state: "terminal" }),
    ]);

    expect(
      await resumeAuthenticationPausedItems({
        now: new Date("2026-07-30T12:10:00.000Z"),
        storage: fakeBrowser.storage.local,
      }),
    ).toEqual([
      expect.objectContaining({
        id: auth.id,
        nextAttemptAt: "2026-07-30T12:10:00.000Z",
        state: "pending",
      }),
    ]);
  });

  it("stores a real receipt and its complete state in one storage write", async () => {
    const item = await enqueueDraft(draft(), options());
    const set = vi.spyOn(fakeBrowser.storage.local, "set");

    const saved = await storeReceipt(item.id, receipt(), {
      now: NOW,
      storage: fakeBrowser.storage.local,
    });

    expect(saved).toMatchObject({
      receipt: receipt(),
      receiptStoredAt: NOW.toISOString(),
      resolvedAt: NOW.toISOString(),
      state: "complete",
    });
    const finalWrite = set.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(finalWrite).toHaveProperty(OUTBOX_STORAGE_KEY);
    expect(finalWrite).toHaveProperty(UNRESOLVED_COUNT_STORAGE_KEY, 0);
  });

  it("supersedes the previous partial when a linked recovery gets a receipt", async () => {
    const original = await enqueueDraft(
      draft({
        completeness: "partial",
        missingElements: ["Synthetic image was unavailable"],
      }),
      options(1),
    );
    await storeReceipt(original.id, receipt("partial"), {
      now: NOW,
      storage: fakeBrowser.storage.local,
    });
    const recovery = await enqueueDraft(draft(), {
      ...options(2),
      recoveryOfItemId: original.id,
    });

    await storeReceipt(recovery.id, receipt("partial"), {
      now: new Date("2026-07-30T12:05:00.000Z"),
      storage: fakeBrowser.storage.local,
    });

    expect(await getOutboxItem(original.id, { storage: fakeBrowser.storage.local })).toMatchObject({
      resolvedAt: "2026-07-30T12:05:00.000Z",
      supersededByItemId: recovery.id,
    });
    expect((await listUnresolvedOutbox({ storage: fakeBrowser.storage.local })).map(
      (candidate) => candidate.id,
    )).toEqual([recovery.id]);
  });

  it("prunes complete items after seven days without deleting shared Blobs", async () => {
    const unique = await enqueueDraft(
      draft({
        attachments: [
          {
            blobKey: "unique-blob",
            byteSize: 3,
            clientId: "unique",
            fileName: "unique.txt",
            mimeType: "text/plain",
            sha256: "a".repeat(64),
          },
        ],
      }),
      options(1),
    );
    const shared = await enqueueDraft(
      draft({
        attachments: [
          {
            blobKey: "shared-blob",
            byteSize: 3,
            clientId: "shared-complete",
            fileName: "shared.txt",
            mimeType: "text/plain",
            sha256: "b".repeat(64),
          },
        ],
      }),
      options(2),
    );
    await enqueueDraft(
      draft({
        attachments: [
          {
            blobKey: "shared-blob",
            byteSize: 3,
            clientId: "shared-terminal",
            fileName: "shared.txt",
            mimeType: "text/plain",
            sha256: "b".repeat(64),
          },
        ],
      }),
      options(3),
    );
    await storeReceipt(unique.id, receipt(), {
      now: new Date("2026-07-20T00:00:00.000Z"),
      storage: fakeBrowser.storage.local,
    });
    await storeReceipt(shared.id, receipt(), {
      now: new Date("2026-07-20T00:00:00.000Z"),
      storage: fakeBrowser.storage.local,
    });
    const deleted: string[] = [];
    const attachmentStore = {
      deleteAttachment: async (blobKey: string) => {
        deleted.push(blobKey);
      },
    } as AttachmentStore;

    const pruned = await pruneCompletedOutbox(
      new Date("2026-07-30T00:00:00.000Z"),
      attachmentStore,
      { storage: fakeBrowser.storage.local },
    );

    expect(pruned.sort()).toEqual([unique.id, shared.id].sort());
    expect(deleted).toEqual(["unique-blob"]);
    expect((await listOutbox({ storage: fakeBrowser.storage.local })).map(
      (candidate) => candidate.id,
    )).toEqual(["outbox-3"]);
  });

  it("prunes a resolved superseded partial but keeps the active recovery", async () => {
    const original = await enqueueDraft(
      draft({
        completeness: "partial",
        missingElements: ["Synthetic image was unavailable"],
      }),
      { ...options(1), now: new Date("2026-07-10T00:00:00.000Z") },
    );
    await storeReceipt(original.id, receipt("partial"), {
      now: new Date("2026-07-10T00:01:00.000Z"),
      storage: fakeBrowser.storage.local,
    });
    const recovery = await enqueueDraft(draft(), {
      ...options(2),
      now: new Date("2026-07-11T00:00:00.000Z"),
      recoveryOfItemId: original.id,
    });
    await storeReceipt(recovery.id, receipt("partial"), {
      now: new Date("2026-07-11T00:01:00.000Z"),
      storage: fakeBrowser.storage.local,
    });

    expect(
      await pruneCompletedOutbox(
        new Date("2026-07-30T00:00:00.000Z"),
        { deleteAttachment: vi.fn() },
        { storage: fakeBrowser.storage.local },
      ),
    ).toEqual([original.id]);
    expect(
      (await listOutbox({ storage: fakeBrowser.storage.local })).map(
        (candidate) => candidate.id,
      ),
    ).toEqual([recovery.id]);
  });

  it("passes every referenced Blob key to orphan reconciliation", async () => {
    await enqueueDraft(
      draft({
        attachments: [
          {
            blobKey: "referenced-blob",
            byteSize: 3,
            clientId: "file-1",
            fileName: "file.txt",
            mimeType: "text/plain",
            sha256: "a".repeat(64),
          },
        ],
      }),
      options(),
    );
    const deleteOrphanedAttachments = vi.fn(async () => ["orphan"]);

    const deleted = await reconcileOrphanAttachments(
      {
        deleteOrphanedAttachments,
      } as unknown as AttachmentStore,
      new Date("2026-07-30T00:00:00.000Z"),
      { storage: fakeBrowser.storage.local },
    );

    expect(deleted).toEqual(["orphan"]);
    expect(deleteOrphanedAttachments).toHaveBeenCalledWith(
      new Set(["referenced-blob"]),
      new Date("2026-07-23T00:00:00.000Z"),
    );
  });

  it("surfaces corrupt persisted data instead of replacing it", async () => {
    await fakeBrowser.storage.local.set({ [OUTBOX_STORAGE_KEY]: { bad: true } });

    await expect(
      mutateOutboxItem("missing", (item) => item, {
        storage: fakeBrowser.storage.local,
      }),
    ).rejects.toThrow("Stored capture outbox is corrupt");

    expect(await fakeBrowser.storage.local.get(OUTBOX_STORAGE_KEY)).toEqual({
      [OUTBOX_STORAGE_KEY]: { bad: true },
    });
  });

  it("rejects a stored success state without an atomic receipt", async () => {
    const item = await enqueueDraft(draft(), options());
    await fakeBrowser.storage.local.set({
      [OUTBOX_STORAGE_KEY]: [{ ...item, state: "complete" }],
    });

    await expect(
      listOutbox({ storage: fakeBrowser.storage.local }),
    ).rejects.toThrow("Stored capture outbox is corrupt");
  });
});
