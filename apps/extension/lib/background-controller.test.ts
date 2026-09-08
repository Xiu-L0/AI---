import type { CaptureReceipt, CaptureStatusResult } from "@recall/contracts";
import { describe, expect, it, vi } from "vitest";

import { adapterForUrl } from "./adapters/registry";
import {
  CAPTURE_NOTIFICATION_PREFIX,
  CAPTURE_RETRY_ALARM,
  createBackgroundController,
  type BackgroundControllerDependencies,
} from "./background-controller";
import type { CaptureDraft, OutboxItem } from "./outbox-types";
import {
  CAPTURE_CURRENT_PAGE,
  isRecallRuntimeMessage,
  PAIRING_UPDATED,
  RETRY_OUTBOX_ITEM,
} from "./runtime-messages";

const captureId = "10000000-0000-4000-8000-000000000001";
const sourceItemId = "20000000-0000-4000-8000-000000000001";
const fixedNow = new Date("2026-07-30T12:00:00.000Z");

function draft(): CaptureDraft {
  return {
    attachments: [],
    completeness: "complete",
    externalRef: "conversation-1",
    messages: [
      { externalMessageId: "m1", ordinal: 0, role: "user", text: "Q" },
      { externalMessageId: "m2", ordinal: 1, role: "assistant", text: "A" },
    ],
    missingElements: [],
    originConversationRef: "conversation-1",
    originTabId: 7,
    originUrl: "https://chatgpt.com/c/conversation-1",
    originWindowId: 3,
    pendingImages: [],
    rawText: "Q\n\nA",
    scope: "full_conversation",
    sensitivity: "normal",
    source: "chatgpt_web",
    sourceKind: "ai_conversation",
    sourcePlatform: "chatgpt",
    title: "Synthetic",
  };
}

function receipt(
  status: "complete" | "partial" = "complete",
): CaptureReceipt {
  return {
    captureId,
    captureStatus: status,
    missingElements: status === "partial" ? ["missing image"] : [],
    processingStatus: "queued",
    savedAttachmentCount: 0,
    savedMessageCount: 2,
    sourceItemId,
  };
}

function outboxItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    attachmentsPrepared: true,
    attemptCount: 0,
    captureId: null,
    createdAt: fixedNow.toISOString(),
    draft: draft(),
    errorCode: null,
    id: "item-1",
    idempotencyKey: "idempotency-key-1",
    lastError: null,
    lastNotifiedAttemptCount: 0,
    nextAttemptAt: fixedNow.toISOString(),
    receipt: null,
    receiptStoredAt: null,
    recoveryOfItemId: null,
    resolvedAt: null,
    resumeStage: "preparing",
    schemaVersion: 1,
    state: "pending",
    supersededByItemId: null,
    updatedAt: fixedNow.toISOString(),
    uploadedAttachments: [],
    ...overrides,
  };
}

function setup(initial: OutboxItem[] = []) {
  let items = [...initial];
  const events: string[] = [];
  const scheduled: number[] = [];
  const notifications: string[] = [];
  const process = vi.fn(async (id: string) => {
    events.push(`process:${id}`);
    return items.find((item) => item.id === id)!;
  });
  const dependencies: BackgroundControllerDependencies = {
    attachmentStore: {
      putAttachment: vi.fn(async () => undefined),
    },
    captureVisibleTab: vi.fn(
      async () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    clearRetryAlarm: vi.fn(async () => undefined),
    createId: () => "screenshot-id",
    extractChatGpt: vi.fn(async () => ({
      completeness: { completeness: "complete" as const, missingElements: [] },
      extraction: {
        derivedMessageOrdinals: [],
        duplicateMessageIds: [],
        emptyMessageOrdinals: [],
        externalRef: "conversation-1",
        generatingResponse: false,
        images: [],
        messages: draft().messages,
        selectionMessageId: null,
        selectionText: null,
        title: "Synthetic",
        unsupportedRoles: [],
      },
      ok: true as const,
      selectedText: "",
    })),
    extractXiaohongshu: vi.fn(async () => ({
      error: {
        code: "extraction_failed" as const,
        message: "小红书笔记提取尚未绑定",
      },
      ok: false as const,
    })),
    getActiveTab: vi.fn(async () => ({
      id: 7,
      url: "https://chatgpt.com/c/conversation-1",
      windowId: 3,
    })),
    getApiClient: vi.fn(async () => ({
      finalize: vi.fn(),
      reportFailure: vi.fn(),
      start: vi.fn(),
      status: vi.fn(),
    })),
    getNotificationIconUrl: () => "chrome-extension://id/icon-128.png",
    notify: vi.fn(async (id) => {
      notifications.push(id);
    }),
    now: () => fixedNow,
    openPopup: vi.fn(async () => undefined),
    outbox: {
      async enqueue(nextDraft, options) {
        events.push("enqueue");
        const queued = outboxItem({
          attachmentsPrepared: nextDraft.pendingImages.length === 0,
          draft: nextDraft,
          id: `item-${items.length + 1}`,
          recoveryOfItemId: options?.recoveryOfItemId ?? null,
        });
        items.push(queued);
        return queued;
      },
      async get(id) {
        return items.find((item) => item.id === id)!;
      },
      async list() {
        return items;
      },
      async listUnresolved() {
        return items.filter(
          (item) => item.state !== "complete" && item.resolvedAt === null,
        );
      },
      async markRetry(id, code, message, currentTime) {
        const index = items.findIndex((item) => item.id === id);
        const current = items[index]!;
        const failed = {
          ...current,
          attemptCount: current.attemptCount + 1,
          errorCode: code,
          lastError: message,
          nextAttemptAt: new Date(currentTime.getTime() + 30_000).toISOString(),
          state: "retry_wait" as const,
        };
        items[index] = failed;
        return failed;
      },
      async mutate(id, updater) {
        const index = items.findIndex((item) => item.id === id);
        items[index] = await updater(items[index]!);
        return items[index]!;
      },
      async resumeAuthentication() {
        return [];
      },
    },
    processOutboxItem: process,
    async scheduleRetryAlarm(when) {
      events.push("schedule-alarm");
      scheduled.push(when);
    },
    setBadgeText: vi.fn(async () => undefined),
  };
  return {
    controller: createBackgroundController(dependencies),
    dependencies,
    events,
    get items() {
      return items;
    },
    notifications,
    process,
    scheduled,
  };
}

describe("background controller", () => {
  it("persists the capture draft before the runner can call the API", async () => {
    const test = setup();

    await test.controller.handleMessage({
      scope: "full_conversation",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });

    expect(test.events.slice(0, 3)).toEqual([
      "enqueue",
      "schedule-alarm",
      "process:item-1",
    ]);
    expect(test.scheduled[0]).toBe(fixedNow.getTime() + 30_000);
  });

  it("keeps a watchdog alarm for interrupted uploads and finalization", async () => {
    for (const state of ["uploading", "finalizing"] as const) {
      const test = setup([
        outboxItem({ id: state, nextAttemptAt: null, state }),
      ]);

      await test.controller.synchronizeUiAndAlarm();

      expect(test.scheduled.at(-1)).toBe(fixedNow.getTime() + 30_000);
    }
  });

  it("synchronizes the watchdog again when immediate processing throws", async () => {
    const test = setup();
    test.process.mockRejectedValueOnce(new Error("signed-url-with-secret"));

    await expect(
      test.controller.handleMessage({
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).rejects.toThrow("signed-url-with-secret");

    expect(test.scheduled).toHaveLength(2);
  });

  it("continues durable processing when preflight UI synchronization fails", async () => {
    const test = setup();
    test.dependencies.scheduleRetryAlarm = vi
      .fn()
      .mockRejectedValueOnce(new Error("browser alarm unavailable"))
      .mockResolvedValue(undefined);

    await test.controller.handleMessage({
      scope: "full_conversation",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });

    expect(test.process).toHaveBeenCalledWith("item-1", fixedNow);
    expect(test.dependencies.scheduleRetryAlarm).toHaveBeenCalledTimes(2);
  });

  it("processes only due items and schedules the nearest future retry", async () => {
    const dueItem = outboxItem({ id: "due" });
    const future = outboxItem({
      id: "future",
      nextAttemptAt: "2026-07-30T13:00:00.000Z",
      state: "retry_wait",
    });
    const terminalReport = outboxItem({
      captureId,
      failureReportNextAttemptAt: "2026-07-30T12:30:00.000Z",
      failureReportStatus: "pending",
      id: "terminal-report-future",
      nextAttemptAt: null,
      state: "terminal",
    });
    const test = setup([dueItem, future, terminalReport]);
    test.process.mockImplementation(async (id: string) =>
      test.dependencies.outbox.mutate(
        id,
        (current) => ({
          ...current,
          resolvedAt: fixedNow.toISOString(),
          state: "complete",
        }),
        fixedNow,
      ),
    );

    await test.controller.processDueItems(fixedNow);

    expect(test.process).toHaveBeenCalledTimes(1);
    expect(test.process).toHaveBeenCalledWith("due", fixedNow);
    expect(test.scheduled.at(-1)).toBe(
      new Date(terminalReport.failureReportNextAttemptAt!).getTime(),
    );
  });

  it("retries a due terminal failure report without changing it to capture retry", async () => {
    const reportTime = "2026-07-30T12:00:00.000Z";
    const terminal = outboxItem({
      captureId,
      errorCode: "upload_target_mismatch",
      failureReportAttemptCount: 1,
      failureReportNextAttemptAt: reportTime,
      failureReportStatus: "pending",
      id: "terminal-report",
      nextAttemptAt: null,
      state: "terminal",
    });
    const test = setup([terminal]);
    test.process.mockImplementation(async (id) =>
      test.dependencies.outbox.mutate(
        id,
        (current) => ({
          ...current,
          failureReportNextAttemptAt: null,
          failureReportStatus: "reported",
          failureReportedAt: fixedNow.toISOString(),
        }),
        fixedNow,
      ),
    );

    await test.controller.processDueItems(fixedNow);

    expect(test.process).toHaveBeenCalledWith(terminal.id, fixedNow);
    expect(test.items[0]).toMatchObject({
      failureReportStatus: "reported",
      nextAttemptAt: null,
      state: "terminal",
    });
  });

  it("keeps terminal state when the failure-report runner throws", async () => {
    const terminal = outboxItem({
      captureId,
      errorCode: "upload_target_mismatch",
      failureReportAttemptCount: 1,
      failureReportNextAttemptAt: fixedNow.toISOString(),
      failureReportStatus: "pending",
      id: "terminal-report-error",
      nextAttemptAt: null,
      state: "terminal",
    });
    const test = setup([terminal]);
    const markRetry = vi.spyOn(test.dependencies.outbox, "markRetry");
    const start = vi.fn();
    const upload = vi.fn();
    const finalize = vi.fn();
    const reportFailure = vi.fn(async () => undefined);
    test.process.mockRejectedValueOnce(new Error("runner boundary failed"));

    await test.controller.processDueItems(fixedNow);

    expect(markRetry).not.toHaveBeenCalled();
    expect(test.items[0]).toMatchObject({
      failureReportAttemptCount: 2,
      failureReportNextAttemptAt: new Date(
        fixedNow.getTime() + 2 * 60_000,
      ).toISOString(),
      failureReportStatus: "pending",
      nextAttemptAt: null,
      state: "terminal",
    });

    const retryTime = new Date(fixedNow.getTime() + 2 * 60_000);
    test.process.mockImplementationOnce(async (id) => {
      await reportFailure();
      return test.dependencies.outbox.mutate(
        id,
        (current) => ({
          ...current,
          failureReportNextAttemptAt: null,
          failureReportStatus: "reported",
          failureReportedAt: retryTime.toISOString(),
        }),
        retryTime,
      );
    });

    await test.controller.processDueItems(retryTime);

    expect(reportFailure).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(test.items[0]).toMatchObject({
      failureReportStatus: "reported",
      nextAttemptAt: null,
      state: "terminal",
    });
  });

  it("processes due items with concurrency capped at two", async () => {
    const test = setup([
      outboxItem({ id: "due-1" }),
      outboxItem({ id: "due-2" }),
      outboxItem({ id: "due-3" }),
    ]);
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    test.process.mockImplementation(async (id: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return test.items.find((item) => item.id === id)!;
    });

    const processing = test.controller.processDueItems(fixedNow);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0, 2).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await processing;

    expect(maximumActive).toBe(2);
    expect(test.process).toHaveBeenCalledTimes(3);
  });

  it("resolves terminal recovery ancestry after an automatic retry receipt", async () => {
    const terminal = outboxItem({
      id: "terminal-parent",
      nextAttemptAt: null,
      state: "terminal",
    });
    const retrying = outboxItem({
      id: "retrying-child",
      recoveryOfItemId: terminal.id,
      state: "retry_wait",
    });
    const test = setup([terminal, retrying]);
    test.process.mockImplementation(async (id: string) =>
      test.dependencies.outbox.mutate(
        id,
        (item) => ({
          ...item,
          captureId,
          nextAttemptAt: null,
          receipt: receipt(),
          receiptStoredAt: fixedNow.toISOString(),
          resolvedAt: fixedNow.toISOString(),
          state: "complete",
        }),
        fixedNow,
      ),
    );

    await test.controller.processDueItems(fixedNow);

    expect(test.items.find((item) => item.id === terminal.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: retrying.id,
    });
  });

  it("does not log a rejected runner error message", async () => {
    const test = setup([outboxItem({ id: "due-secret" })]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    test.process.mockRejectedValueOnce(
      new Error("https://storage.test/path?token=signed-secret"),
    );

    await test.controller.processDueItems(fixedNow);

    expect(consoleError).toHaveBeenCalledWith(
      "Recall capture retry failed before state persistence (Error)",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("signed-secret");
    expect(test.items[0]).toMatchObject({
      attemptCount: 1,
      errorCode: "capture_runner_failed",
      nextAttemptAt: "2026-07-30T12:00:30.000Z",
      state: "retry_wait",
    });
    consoleError.mockRestore();
  });

  it("keeps a 30-second watchdog when runner failure state cannot be persisted", async () => {
    const test = setup([outboxItem({ id: "due-local-storage-failure" })]);
    test.process.mockRejectedValueOnce(new Error("runner failed"));
    test.dependencies.outbox.markRetry = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await test.controller.processDueItems(fixedNow);

    expect(test.scheduled.at(-1)).toBe(fixedNow.getTime() + 30_000);
    consoleError.mockRestore();
  });

  it("notifies once after three failures without changing the receipt", async () => {
    const failed = outboxItem({
      attemptCount: 3,
      id: "failed",
      lastError: "offline",
      state: "retry_wait",
    });
    const test = setup([failed]);

    await test.controller.processDueItems(fixedNow);
    await test.controller.processDueItems(fixedNow);

    expect(test.notifications).toEqual([
      `${CAPTURE_NOTIFICATION_PREFIX}failed`,
    ]);
    expect(test.items[0]?.receipt).toBeNull();
  });

  it("completes a partial capture with exactly one fresh screenshot", async () => {
    const originalReceipt = receipt("partial");
    const inherited = {
      blobKey: "old-screenshot-blob",
      byteSize: 123,
      clientId: "old-screenshot",
      fileName: "old-screenshot.png",
      mimeType: "image/png" as const,
      sha256: "a".repeat(64),
    };
    const original = outboxItem({
      captureId,
      draft: {
        ...draft(),
        attachments: [inherited],
        completeness: "partial",
        missingElements: originalReceipt.missingElements,
      },
      receipt: originalReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      state: "partial",
    });
    const test = setup([original]);
    test.process.mockImplementation(async (id: string) =>
      test.dependencies.outbox.mutate(
        id,
        (item) => ({
          ...item,
          captureId,
          receipt: receipt("complete"),
          receiptStoredAt: fixedNow.toISOString(),
          resolvedAt: fixedNow.toISOString(),
          state: "complete",
        }),
        fixedNow,
      ),
    );

    const result = await test.controller.addScreenshotRecovery(original.id);
    const recovery = test.items.find((item) => item.id === result.id)!;

    expect(recovery.draft.attachments).toHaveLength(1);
    expect(recovery.draft.attachments[0]?.clientId).toContain(
      "recovery-screenshot-",
    );
    expect(recovery.draft.attachments[0]?.clientId).not.toBe("old-screenshot");
    expect(recovery.draft.completeness).toBe("complete");
    expect(recovery.draft.missingElements).toEqual([]);
    expect(recovery.draft.pendingImages).toEqual([]);
    expect(recovery.draft).toMatchObject({
      externalRef: original.draft.externalRef,
      messages: original.draft.messages,
      originConversationRef: original.draft.originConversationRef,
      originTabId: original.draft.originTabId,
      originUrl: original.draft.originUrl,
      originWindowId: original.draft.originWindowId,
      scope: original.draft.scope,
      sensitivity: original.draft.sensitivity,
      source: original.draft.source,
      title: original.draft.title,
    });
    expect(result.state).toBe("complete");
    expect(test.items.find((item) => item.id === original.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: result.id,
    });
  });

  it("returns the existing direct screenshot recovery instead of creating another", async () => {
    const originalReceipt = receipt("partial");
    const original = outboxItem({
      captureId,
      draft: {
        ...draft(),
        completeness: "partial",
        missingElements: originalReceipt.missingElements,
      },
      receipt: originalReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      state: "partial",
    });
    const screenshotAttachment = {
      blobKey: "existing-screenshot-blob",
      byteSize: 123,
      clientId: "recovery-screenshot-existing",
      fileName: "existing-screenshot.png",
      mimeType: "image/png" as const,
      sha256: "b".repeat(64),
    };
    const existing = outboxItem({
      draft: {
        ...draft(),
        attachments: [screenshotAttachment],
        completeness: "complete",
        missingElements: [],
      },
      id: "existing-screenshot-recovery",
      recoveryOfItemId: original.id,
      state: "pending",
    });
    const test = setup([original, existing]);
    const enqueue = vi.spyOn(test.dependencies.outbox, "enqueue");

    const result = await test.controller.addScreenshotRecovery(original.id);

    expect(result.id).toBe(existing.id);
    expect(test.dependencies.captureVisibleTab).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(test.items).toHaveLength(2);
  });

  it("shares one screenshot recovery across concurrent calls", async () => {
    const originalReceipt = receipt("partial");
    const original = outboxItem({
      captureId,
      draft: {
        ...draft(),
        completeness: "partial",
        missingElements: originalReceipt.missingElements,
      },
      receipt: originalReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      state: "partial",
    });
    const test = setup([original]);
    const enqueue = vi.spyOn(test.dependencies.outbox, "enqueue");
    let releaseProcess!: () => void;
    const processBlocked = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    test.process.mockImplementation(async (id: string) => {
      await processBlocked;
      return test.dependencies.outbox.mutate(
        id,
        (item) => ({
          ...item,
          captureId,
          receipt: receipt("complete"),
          receiptStoredAt: fixedNow.toISOString(),
          resolvedAt: fixedNow.toISOString(),
          state: "complete",
        }),
        fixedNow,
      );
    });

    const first = test.controller.addScreenshotRecovery(original.id);
    const second = test.controller.addScreenshotRecovery(original.id);

    await vi.waitFor(() => expect(test.process).toHaveBeenCalled());
    expect(test.dependencies.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(test.process).toHaveBeenCalledTimes(1);

    releaseProcess();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(test.items).toHaveLength(2);
  });

  it("keeps the original partial recoverable when screenshot capture fails", async () => {
    const originalReceipt = receipt("partial");
    const original = outboxItem({
      captureId,
      draft: {
        ...draft(),
        completeness: "partial",
        missingElements: originalReceipt.missingElements,
      },
      receipt: originalReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      state: "partial",
    });
    const test = setup([original]);
    const enqueue = vi.spyOn(test.dependencies.outbox, "enqueue");
    test.dependencies.captureVisibleTab = vi.fn(async () => {
      throw new Error("The active tab cannot be captured");
    });

    await expect(
      test.controller.addScreenshotRecovery(original.id),
    ).rejects.toThrow("The active tab cannot be captured");

    const snapshot = test.items.find((item) => item.id === original.id);
    expect(snapshot).toMatchObject({
      receipt: originalReceipt,
      resolvedAt: null,
      state: "partial",
      supersededByItemId: null,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(test.process).not.toHaveBeenCalled();
    expect(test.items).toHaveLength(1);

    test.dependencies.captureVisibleTab = vi.fn(
      async () =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    );
    const first = test.controller.addScreenshotRecovery(original.id);
    const second = test.controller.addScreenshotRecovery(original.id);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      test.items.filter((item) => item.recoveryOfItemId === original.id),
    ).toHaveLength(1);
    expect(test.items.find((item) => item.id === original.id)?.state).toBe(
      "partial",
    );
  });

  it("keeps the original partial recoverable when local screenshot storage fails", async () => {
    const originalReceipt = receipt("partial");
    const original = outboxItem({
      captureId,
      draft: {
        ...draft(),
        completeness: "partial",
        missingElements: originalReceipt.missingElements,
      },
      receipt: originalReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      state: "partial",
    });
    const test = setup([original]);
    const enqueue = vi.spyOn(test.dependencies.outbox, "enqueue");
    test.dependencies.attachmentStore.putAttachment = vi.fn(async () => {
      throw new Error("IndexedDB write failed");
    });

    await expect(
      test.controller.addScreenshotRecovery(original.id),
    ).rejects.toThrow("IndexedDB write failed");

    expect(test.dependencies.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(test.items.find((item) => item.id === original.id)).toMatchObject({
      receipt: originalReceipt,
      resolvedAt: null,
      state: "partial",
      supersededByItemId: null,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(test.items).toHaveLength(1);

    test.dependencies.attachmentStore.putAttachment = vi.fn(async () => undefined);
    const recovered = await test.controller.addScreenshotRecovery(original.id);

    expect(recovered.recoveryOfItemId).toBe(original.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      test.items.filter((item) => item.recoveryOfItemId === original.id),
    ).toHaveLength(1);
  });

  it("persists extraction failure as a local terminal item without calling the API", async () => {
    const test = setup();
    test.dependencies.extractChatGpt = vi.fn(async () => ({
      error: {
        code: "extraction_failed" as const,
        message: "页面结构已变化",
      },
      ok: false as const,
    }));

    const result = await test.controller.handleMessage({
      scope: "full_conversation",
      sensitivity: "sensitive",
      type: CAPTURE_CURRENT_PAGE,
    });
    if (Array.isArray(result)) throw new Error("expected one terminal item");

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("chatgpt_extraction_failed");
    expect(result.lastError).toBe("页面结构已变化");
    expect(result.draft.messages).toEqual([]);
    expect(result.draft.sensitivity).toBe("sensitive");
    expect(test.process).not.toHaveBeenCalled();
  });

  it("persists a rejected content-script extraction as a local terminal item", async () => {
    const test = setup();
    test.dependencies.extractChatGpt = vi.fn(async () => {
      throw new Error("content script unavailable");
    });

    const result = await test.controller.handleMessage({
      scope: "qa_pair",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });
    if (Array.isArray(result)) throw new Error("expected one terminal item");

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("chatgpt_extraction_failed");
    expect(result.lastError).toBe("content script unavailable");
    expect(test.process).not.toHaveBeenCalled();
  });

  it("persists invalid selected scope as a local terminal item", async () => {
    const test = setup();

    const result = await test.controller.handleMessage({
      scope: "selection",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });
    if (Array.isArray(result)) throw new Error("expected one terminal item");

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("chatgpt_scope_failed");
    expect(result.draft.scope).toBe("selection");
    expect(test.process).not.toHaveBeenCalled();
  });

  it("links a terminal recapture and resolves its terminal ancestry only after receipt", async () => {
    const root = outboxItem({
      errorCode: "chatgpt_extraction_failed",
      id: "terminal-root",
      lastError: "first failure",
      nextAttemptAt: null,
      state: "terminal",
    });
    const retryFailure = outboxItem({
      errorCode: "chatgpt_scope_failed",
      id: "terminal-retry",
      lastError: "second failure",
      nextAttemptAt: null,
      recoveryOfItemId: root.id,
      state: "terminal",
    });
    const test = setup([root, retryFailure]);
    test.process.mockImplementation(async (id: string) =>
      test.dependencies.outbox.mutate(
        id,
        (item) => ({
          ...item,
          captureId,
          nextAttemptAt: null,
          receipt: receipt(),
          receiptStoredAt: fixedNow.toISOString(),
          resolvedAt: fixedNow.toISOString(),
          state: "complete",
        }),
        fixedNow,
      ),
    );

    const result = await test.controller.handleMessage({
      recoveryOfItemId: retryFailure.id,
      scope: "full_conversation",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });
    if (Array.isArray(result)) throw new Error("expected one receipt item");

    expect(result.recoveryOfItemId).toBe(retryFailure.id);
    expect(result.receipt).not.toBeNull();
    expect(test.items.find((item) => item.id === retryFailure.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: result.id,
    });
    expect(test.items.find((item) => item.id === root.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: result.id,
    });
  });

  it("does not allow recapture to supersede a non-terminal item", async () => {
    const pending = outboxItem({ id: "still-pending" });
    const test = setup([pending]);

    await expect(
      test.controller.handleMessage({
        recoveryOfItemId: pending.id,
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).rejects.toThrow("只有尚未解决的本地采集异常可以重新采集");

    expect(test.dependencies.extractChatGpt).not.toHaveBeenCalled();
    expect(test.process).not.toHaveBeenCalled();
  });

  it("does not let another ChatGPT conversation resolve a terminal capture", async () => {
    const terminal = outboxItem({
      id: "conversation-a-terminal",
      nextAttemptAt: null,
      state: "terminal",
    });
    const test = setup([terminal]);
    test.dependencies.getActiveTab = vi.fn(async () => ({
      id: 8,
      url: "https://chatgpt.com/c/conversation-2",
      windowId: 3,
    }));

    await expect(
      test.controller.handleMessage({
        recoveryOfItemId: terminal.id,
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).rejects.toThrow("当前标签页不是原采集异常所属的 ChatGPT 会话");

    expect(test.dependencies.extractChatGpt).not.toHaveBeenCalled();
    expect(test.items[0]).toMatchObject({ resolvedAt: null, state: "terminal" });
  });

  it("reconciles a saved receipt's full recovery chain on startup", async () => {
    const root = outboxItem({
      id: "terminal-root",
      nextAttemptAt: null,
      state: "terminal",
    });
    const parent = outboxItem({
      id: "terminal-parent",
      nextAttemptAt: null,
      recoveryOfItemId: root.id,
      state: "terminal",
    });
    const saved = outboxItem({
      captureId,
      id: "saved-recovery",
      nextAttemptAt: null,
      receipt: receipt(),
      receiptStoredAt: fixedNow.toISOString(),
      recoveryOfItemId: parent.id,
      resolvedAt: fixedNow.toISOString(),
      state: "complete",
    });
    const test = setup([root, parent, saved]);

    await test.controller.initialize();

    expect(test.items.find((item) => item.id === root.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: saved.id,
    });
    expect(test.items.find((item) => item.id === parent.id)).toMatchObject({
      resolvedAt: fixedNow.toISOString(),
      supersededByItemId: saved.id,
    });
  });

  it("selects adapters by exact origin before extraction", () => {
    expect(adapterForUrl("https://chatgpt.com/c/abc")?.id).toBe("chatgpt");
    expect(adapterForUrl("https://www.xiaohongshu.com/explore/abc")?.id).toBe(
      "xiaohongshu",
    );
    expect(
      adapterForUrl("https://xiaohongshu.com.attacker.example/explore/abc"),
    ).toBeNull();
    expect(adapterForUrl("http://www.xiaohongshu.com/explore/abc")).toBeNull();
  });

  it("does not send Xiaohongshu pages to the ChatGPT extractor", async () => {
    const test = setup();
    test.dependencies.getActiveTab = vi.fn(async () => ({
      id: 11,
      url: "https://www.xiaohongshu.com/explore/65abc123",
      windowId: 4,
    }));

    const result = await test.controller.handleMessage({
      scope: "web_page",
      sensitivity: "normal",
      type: CAPTURE_CURRENT_PAGE,
    });
    if (Array.isArray(result)) throw new Error("expected one outbox item");

    expect(test.dependencies.extractChatGpt).not.toHaveBeenCalled();
    expect(test.dependencies.extractXiaohongshu).toHaveBeenCalledWith(11);
    expect(result.draft.sourcePlatform).toBe("xiaohongshu");
    expect(result.state).toBe("terminal");
  });

  it("rejects lookalike ChatGPT hosts before extraction", async () => {
    const test = setup();
    test.dependencies.getActiveTab = vi.fn(async () => ({
      id: 7,
      url: "https://chatgpt.com.evil.test/c/conversation-1",
      windowId: 3,
    }));

    await expect(
      test.controller.handleMessage({
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).rejects.toThrow("当前标签页不是可采集的 ChatGPT 会话");

    expect(test.dependencies.extractChatGpt).not.toHaveBeenCalled();
  });

  it("resumes authentication-paused items without waiting for network", async () => {
    const authPaused = outboxItem({
      id: "auth-paused",
      nextAttemptAt: null,
      state: "auth_paused",
    });
    const test = setup([authPaused]);
    test.dependencies.outbox.resumeAuthentication = vi.fn(async (currentTime) => {
      const resumed = await test.dependencies.outbox.mutate(
        authPaused.id,
        (item) => ({
          ...item,
          nextAttemptAt: currentTime.toISOString(),
          state: "pending",
        }),
        currentTime,
      );
      return [resumed];
    });

    await test.controller.handleMessage({ type: PAIRING_UPDATED });

    expect(test.process).not.toHaveBeenCalled();
    expect(test.scheduled.at(-1)).toBe(fixedNow.getTime());
  });

  it("refreshes processing failure without changing capture completeness", async () => {
    const savedReceipt = receipt();
    const saved = outboxItem({
      captureId,
      receipt: savedReceipt,
      receiptStoredAt: fixedNow.toISOString(),
      resolvedAt: fixedNow.toISOString(),
      state: "complete",
    });
    const test = setup([saved]);
    const status: CaptureStatusResult = {
      ...savedReceipt,
      failureReason: null,
      processingStatus: "failed",
    };
    vi.mocked((await test.dependencies.getApiClient()).status).mockResolvedValue(
      status,
    );
    test.dependencies.getApiClient = vi.fn(async () => ({
      finalize: vi.fn(),
      reportFailure: vi.fn(),
      start: vi.fn(),
      status: vi.fn(async () => status),
    }));

    const refreshed = await test.controller.refresh(saved.id);

    expect(refreshed.state).toBe("complete");
    expect(refreshed.receipt?.processingStatus).toBe("failed");
  });
});

describe("runtime message validation", () => {
  it("validates capture scope and sensitivity", () => {
    expect(
      isRecallRuntimeMessage({
        scope: "qa_pair",
        sensitivity: "strictly_sensitive",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(true);
    expect(
      isRecallRuntimeMessage({
        scope: "web_page",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(true);
    expect(
      isRecallRuntimeMessage({
        scope: "everything",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(false);
    expect(
      isRecallRuntimeMessage({
        scope: { toString: () => { throw new Error("must not execute"); } },
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(false);
    expect(
      isRecallRuntimeMessage({
        recoveryOfItemId: "terminal-1",
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(true);
    expect(
      isRecallRuntimeMessage({
        recoveryOfItemId: " ",
        scope: "full_conversation",
        sensitivity: "normal",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(false);
    expect(
      isRecallRuntimeMessage({
        scope: "selection",
        sensitivity: "public",
        type: CAPTURE_CURRENT_PAGE,
      }),
    ).toBe(false);
  });

  it("requires bounded non-empty item ids", () => {
    expect(
      isRecallRuntimeMessage({ itemId: "item-1", type: RETRY_OUTBOX_ITEM }),
    ).toBe(true);
    expect(
      isRecallRuntimeMessage({ itemId: " ", type: RETRY_OUTBOX_ITEM }),
    ).toBe(false);
    expect(
      isRecallRuntimeMessage({ itemId: " item-1", type: RETRY_OUTBOX_ITEM }),
    ).toBe(false);
    expect(
      isRecallRuntimeMessage({ itemId: "x".repeat(201), type: RETRY_OUTBOX_ITEM }),
    ).toBe(false);
  });

  it("uses the stable retry alarm name", () => {
    expect(CAPTURE_RETRY_ALARM).toBe("recall.capture.retry");
  });
});
