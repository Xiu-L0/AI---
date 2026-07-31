import {
  CaptureReceiptSchema,
  type CaptureReceipt,
  type CaptureStatusResult,
} from "@recall/contracts";

import type { CaptureApiClient } from "./api-client";
import type { AttachmentStore } from "./attachment-store";
import type { ExtractChatGptResponse } from "./chatgpt/content-message";
import { chatGptConversationRef } from "./chatgpt/origins";
import { toChatGptCaptureDraft } from "./chatgpt/to-capture-draft";
import type { CaptureDraft, OutboxItem } from "./outbox-types";
import {
  ADD_SCREENSHOT_RECOVERY,
  CAPTURE_CURRENT_PAGE,
  LIST_OUTBOX,
  PAIRING_UPDATED,
  REFRESH_OUTBOX_ITEM,
  RETRY_OUTBOX_ITEM,
  type RecallRuntimeMessage,
} from "./runtime-messages";

export const CAPTURE_RETRY_ALARM = "recall.capture.retry";
export const CAPTURE_NOTIFICATION_PREFIX = "recall.capture.unresolved.";
const CAPTURE_WATCHDOG_DELAY_MS = 30 * 1_000;
const FAILURE_REPORT_RETRY_DELAYS_MS = [
  30 * 1_000,
  2 * 60 * 1_000,
  10 * 60 * 1_000,
  60 * 60 * 1_000,
  6 * 60 * 60 * 1_000,
] as const;

type BrowserTab = {
  id: number;
  url: string;
  windowId: number;
};

type BackgroundOutbox = {
  enqueue(
    draft: CaptureDraft,
    options?: { recoveryOfItemId?: string; now?: Date },
  ): Promise<OutboxItem>;
  get(id: string): Promise<OutboxItem>;
  list(): Promise<OutboxItem[]>;
  listUnresolved(): Promise<OutboxItem[]>;
  markRetry(
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
  resumeAuthentication(now: Date): Promise<OutboxItem[]>;
};

export type BackgroundControllerDependencies = {
  attachmentStore: Pick<AttachmentStore, "putAttachment">;
  captureVisibleTab(windowId: number): Promise<string>;
  clearRetryAlarm(): Promise<void>;
  createId?: () => string;
  extractChatGpt(tabId: number): Promise<ExtractChatGptResponse>;
  getActiveTab(): Promise<BrowserTab | null>;
  getApiClient(): Promise<CaptureApiClient>;
  getNotificationIconUrl(): string;
  notify(
    id: string,
    options: { iconUrl: string; message: string; title: string },
  ): Promise<void>;
  now?: () => Date;
  openPopup(): Promise<void>;
  outbox: BackgroundOutbox;
  processOutboxItem(id: string, now: Date): Promise<OutboxItem>;
  scheduleRetryAlarm(when: number): Promise<void>;
  setBadgeText(text: string): Promise<void>;
};

function conversationRef(urlValue: string): string | null {
  return chatGptConversationRef(urlValue);
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const name = error.name.trim();
  return name.length > 0 ? name.slice(0, 80) : "Error";
}

function safeFailureReason(value: unknown, fallback: string): string {
  const raw = value instanceof Error ? value.message : value;
  if (typeof raw !== "string") return fallback;
  const normalized = raw.replace(/\s+/g, " ").trim();
  return (normalized.length > 0 ? normalized : fallback).slice(0, 500);
}

function statusReceipt(result: CaptureStatusResult): CaptureReceipt | null {
  if (result.captureStatus === "failed") return null;
  const { failureReason: _failureReason, ...receipt } = result;
  return CaptureReceiptSchema.parse(receipt);
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

async function dataUrlBlob(value: string): Promise<Blob> {
  if (!value.startsWith("data:image/png")) {
    throw new Error("浏览器截图没有返回 image/png 数据");
  }
  const response = await fetch(value);
  const blob = await response.blob();
  if (blob.type !== "image/png" || blob.size === 0) {
    throw new Error("浏览器截图返回了无效的 PNG 数据");
  }
  return blob;
}

function due(item: OutboxItem, now: Date): boolean {
  if (item.state === "uploading" || item.state === "finalizing") return true;
  if (item.state === "terminal" && item.failureReportStatus === "pending") {
    return (
      item.failureReportNextAttemptAt === null ||
      item.failureReportNextAttemptAt === undefined ||
      new Date(item.failureReportNextAttemptAt).getTime() <= now.getTime()
    );
  }
  if (item.state !== "pending" && item.state !== "retry_wait") return false;
  return (
    item.nextAttemptAt === null ||
    new Date(item.nextAttemptAt).getTime() <= now.getTime()
  );
}

function nextRetryAt(
  items: readonly OutboxItem[],
  currentTime: Date,
  activeItemIds: ReadonlySet<string>,
): number | null {
  const times = items.flatMap((item) => {
    if (
      activeItemIds.has(item.id) ||
      item.state === "uploading" ||
      item.state === "finalizing"
    ) {
      return [currentTime.getTime() + CAPTURE_WATCHDOG_DELAY_MS];
    }
    if (
      item.state === "terminal" &&
      item.failureReportStatus === "pending" &&
      item.failureReportNextAttemptAt !== null &&
      item.failureReportNextAttemptAt !== undefined
    ) {
      const time = new Date(item.failureReportNextAttemptAt).getTime();
      return Number.isFinite(time) ? [time] : [];
    }
    if (
      (item.state !== "pending" && item.state !== "retry_wait") ||
      item.nextAttemptAt === null
    ) {
      return [];
    }
    const time = new Date(item.nextAttemptAt).getTime();
    return Number.isFinite(time) ? [time] : [];
  });
  return times.length === 0 ? null : Math.min(...times);
}

function screenshotRecoveryDraft(
  original: OutboxItem,
  attachment: CaptureDraft["attachments"][number],
): CaptureDraft {
  return {
    ...original.draft,
    attachments: [...original.draft.attachments, attachment],
    completeness: "partial",
    pendingImages: [],
  };
}

export function createBackgroundController(
  dependencies: BackgroundControllerDependencies,
) {
  const now = () => dependencies.now?.() ?? new Date();

  async function synchronizeUiAndAlarm(
    activeItemIds: ReadonlySet<string> = new Set(),
  ) {
    const unresolved = await dependencies.outbox.listUnresolved();
    await dependencies.setBadgeText(
      unresolved.length === 0 ? "" : String(unresolved.length),
    );
    const nearest = nextRetryAt(unresolved, now(), activeItemIds);
    if (nearest === null) {
      await dependencies.clearRetryAlarm();
    } else {
      await dependencies.scheduleRetryAlarm(nearest);
    }
  }

  async function synchronizeUiAndAlarmSafely(
    activeItemIds: ReadonlySet<string> = new Set(),
  ) {
    try {
      await synchronizeUiAndAlarm(activeItemIds);
    } catch (error) {
      console.warn(
        `Recall capture UI synchronization failed (${safeErrorName(error)})`,
      );
    }
  }

  async function notifyIfNeeded(item: OutboxItem, currentTime: Date) {
    if (
      item.resolvedAt !== null ||
      item.attemptCount < 3 ||
      item.lastNotifiedAttemptCount >= 3
    ) {
      return item;
    }
    try {
      await dependencies.notify(`${CAPTURE_NOTIFICATION_PREFIX}${item.id}`, {
        iconUrl: dependencies.getNotificationIconUrl(),
        message: item.lastError ?? "服务器仍未确认保存，扩展会继续保留原始内容。",
        title: "采集仍未完成",
      });
      return dependencies.outbox.mutate(
        item.id,
        (current) => ({
          ...current,
          lastNotifiedAttemptCount: current.attemptCount,
        }),
        currentTime,
      );
    } catch (error) {
      console.warn(
        `Recall capture notification failed (${safeErrorName(error)})`,
      );
      return item;
    }
  }

  async function processDueItems(currentTime = now()) {
    const unresolved = await dependencies.outbox.listUnresolved();
    const dueItems = unresolved.filter((candidate) => due(candidate, currentTime));
    const watchdogItemIds = new Set<string>();
    if (dueItems.length > 0) {
      await synchronizeUiAndAlarmSafely(
        new Set(dueItems.map((item) => item.id)),
      );
    }
    for (let index = 0; index < dueItems.length; index += 2) {
      await Promise.all(
        dueItems.slice(index, index + 2).map(async (item) => {
          try {
            const processed = await dependencies.processOutboxItem(
              item.id,
              currentTime,
            );
            await resolveRecoveryAncestors(processed, currentTime);
            await notifyIfNeeded(processed, currentTime);
          } catch (error) {
            console.error(
              `Recall capture retry failed before state persistence (${safeErrorName(error)})`,
            );
            try {
              if (
                item.state === "terminal" &&
                item.failureReportStatus === "pending"
              ) {
                await dependencies.outbox.mutate(
                  item.id,
                  (current) => {
                    const attemptCount =
                      (current.failureReportAttemptCount ?? 0) + 1;
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
                        currentTime.getTime() + retryDelay,
                      ).toISOString(),
                      failureReportStatus: "pending",
                      failureReportedAt: null,
                      nextAttemptAt: null,
                      state: "terminal",
                    };
                  },
                  currentTime,
                );
              } else {
                const failed = await dependencies.outbox.markRetry(
                item.id,
                "capture_runner_failed",
                "采集执行器暂时无法继续，扩展会自动重试",
                currentTime,
              );
                await notifyIfNeeded(failed, currentTime);
              }
            } catch (persistenceError) {
              watchdogItemIds.add(item.id);
              console.error(
                `Recall capture retry state persistence failed (${safeErrorName(persistenceError)})`,
              );
            }
          }
        }),
      );
    }
    await synchronizeUiAndAlarmSafely(watchdogItemIds);
  }

  async function persistLocalTerminalCapture(input: {
    code: string;
    message: unknown;
    runtimeMessage: Extract<
      RecallRuntimeMessage,
      { type: typeof CAPTURE_CURRENT_PAGE }
    >;
    tab: BrowserTab;
  }): Promise<OutboxItem> {
    const originConversationRef = conversationRef(input.tab.url);
    if (originConversationRef === null) {
      throw new Error("当前标签页不是可采集的 ChatGPT 会话");
    }
    const failureReason = safeFailureReason(
      input.message,
      "ChatGPT 页面内容暂时无法提取",
    );
    const currentTime = now();
    const queued = await dependencies.outbox.enqueue(
      {
        attachments: [],
        completeness: "partial",
        externalRef: `${originConversationRef}#${input.runtimeMessage.scope}:local-failure`,
        messages: [],
        missingElements: [failureReason],
        originConversationRef,
        originTabId: input.tab.id,
        originUrl: input.tab.url,
        originWindowId: input.tab.windowId,
        pendingImages: [],
        rawText: "",
        scope: input.runtimeMessage.scope,
        sensitivity: input.runtimeMessage.sensitivity,
        source: "chatgpt_web",
        title: "ChatGPT 采集异常",
      },
      {
        now: currentTime,
        ...(input.runtimeMessage.recoveryOfItemId === undefined
          ? {}
          : { recoveryOfItemId: input.runtimeMessage.recoveryOfItemId }),
      },
    );
    const terminal = await dependencies.outbox.mutate(
      queued.id,
      (item) => ({
        ...item,
        errorCode: input.code.slice(0, 200),
        lastError: failureReason,
        nextAttemptAt: null,
        state: "terminal",
      }),
      currentTime,
    );
    await synchronizeUiAndAlarm();
    return terminal;
  }

  async function resolveRecoveryAncestors(
    savedItem: OutboxItem,
    currentTime: Date,
  ): Promise<void> {
    if (
      savedItem.receipt === null ||
      savedItem.receiptStoredAt === null ||
      (savedItem.state !== "complete" && savedItem.state !== "partial")
    ) {
      return;
    }
    let ancestorId = savedItem.recoveryOfItemId;
    const visited = new Set<string>();
    while (ancestorId !== null && !visited.has(ancestorId)) {
      visited.add(ancestorId);
      const ancestor = await dependencies.outbox.get(ancestorId);
      const nextAncestorId = ancestor.recoveryOfItemId;
      if (ancestor.resolvedAt === null) {
        await dependencies.outbox.mutate(
          ancestor.id,
          (item) => ({
            ...item,
            resolvedAt: savedItem.receiptStoredAt,
            supersededByItemId: savedItem.id,
          }),
          currentTime,
        );
      }
      ancestorId = nextAncestorId;
    }
  }

  async function captureCurrentPage(
    message: Extract<RecallRuntimeMessage, { type: typeof CAPTURE_CURRENT_PAGE }>,
  ) {
    const tab = await dependencies.getActiveTab();
    if (tab === null || conversationRef(tab.url) === null) {
      throw new Error("当前标签页不是可采集的 ChatGPT 会话");
    }
    if (message.recoveryOfItemId !== undefined) {
      const recoveryTarget = await dependencies.outbox.get(
        message.recoveryOfItemId,
      );
      if (
        recoveryTarget.state !== "terminal" ||
        recoveryTarget.resolvedAt !== null
      ) {
        throw new Error("只有尚未解决的本地采集异常可以重新采集");
      }
      if (
        recoveryTarget.draft.originConversationRef !== conversationRef(tab.url)
      ) {
        throw new Error("当前标签页不是原采集异常所属的 ChatGPT 会话");
      }
    }
    let extracted: ExtractChatGptResponse;
    try {
      extracted = await dependencies.extractChatGpt(tab.id);
    } catch (error) {
      return persistLocalTerminalCapture({
        code: "chatgpt_extraction_failed",
        message: error,
        runtimeMessage: message,
        tab,
      });
    }
    if (!extracted.ok) {
      return persistLocalTerminalCapture({
        code: `chatgpt_${extracted.error.code}`,
        message: extracted.error.message,
        runtimeMessage: message,
        tab,
      });
    }
    let draft: CaptureDraft;
    try {
      draft = toChatGptCaptureDraft({
        extraction: extracted.extraction,
        originTabId: tab.id,
        originUrl: tab.url,
        originWindowId: tab.windowId,
        scope: message.scope,
        selectedText: extracted.selectedText,
        sensitivity: message.sensitivity,
      });
    } catch (error) {
      return persistLocalTerminalCapture({
        code: "chatgpt_scope_failed",
        message: error,
        runtimeMessage: message,
        tab,
      });
    }
    const queued = await dependencies.outbox.enqueue(draft, {
      now: now(),
      ...(message.recoveryOfItemId === undefined
        ? {}
        : { recoveryOfItemId: message.recoveryOfItemId }),
    });
    await synchronizeUiAndAlarmSafely(new Set([queued.id]));
    try {
      const currentTime = now();
      const processed = await dependencies.processOutboxItem(
        queued.id,
        currentTime,
      );
      await resolveRecoveryAncestors(processed, currentTime);
      return processed;
    } finally {
      await synchronizeUiAndAlarmSafely();
    }
  }

  async function retry(itemId: string) {
    const currentTime = now();
    const current = await dependencies.outbox.get(itemId);
    if (current.state !== "retry_wait" && current.state !== "pending") {
      throw new Error("当前采集状态不能立即重试");
    }
    await dependencies.outbox.mutate(
      itemId,
      (item) => ({ ...item, nextAttemptAt: currentTime.toISOString(), state: "pending" }),
      currentTime,
    );
    await synchronizeUiAndAlarmSafely(new Set([itemId]));
    try {
      const processed = await dependencies.processOutboxItem(
        itemId,
        currentTime,
      );
      await resolveRecoveryAncestors(processed, currentTime);
      return processed;
    } finally {
      await synchronizeUiAndAlarmSafely();
    }
  }

  async function addScreenshotRecovery(itemId: string) {
    const original = await dependencies.outbox.get(itemId);
    if (original.state !== "partial" || original.receipt === null) {
      throw new Error("只有已确认的部分采集可以补充截图");
    }
    const tab = await dependencies.getActiveTab();
    if (
      tab === null ||
      conversationRef(tab.url) !== original.draft.originConversationRef
    ) {
      throw new Error("当前标签页已不是原来的 ChatGPT 会话");
    }
    const blob = await dataUrlBlob(await dependencies.captureVisibleTab(tab.windowId));
    if (blob.size > 10 * 1024 * 1024) throw new Error("截图超过 10 MiB");
    if (original.draft.attachments.length >= 50) {
      throw new Error("本次采集已达到 50 个附件上限");
    }
    const existingBytes = original.draft.attachments.reduce(
      (sum, attachment) => sum + attachment.byteSize,
      0,
    );
    if (existingBytes + blob.size > 100 * 1024 * 1024) {
      throw new Error("本次附件总量超过 100 MiB");
    }

    const id = dependencies.createId?.() ?? crypto.randomUUID();
    const hash = await sha256(blob);
    const blobKey = `screenshot:${id}:${hash.slice(0, 16)}`;
    await dependencies.attachmentStore.putAttachment(blobKey, blob);
    const draft = screenshotRecoveryDraft(original, {
      blobKey,
      byteSize: blob.size,
      clientId: `recovery-screenshot-${id}`.slice(0, 100),
      fileName: `recall-recovery-${id}.png`.slice(0, 255),
      mimeType: "image/png",
      sha256: hash,
    });
    const queued = await dependencies.outbox.enqueue(draft, {
      now: now(),
      recoveryOfItemId: original.id,
    });
    await synchronizeUiAndAlarmSafely(new Set([queued.id]));
    try {
      const currentTime = now();
      const processed = await dependencies.processOutboxItem(
        queued.id,
        currentTime,
      );
      await resolveRecoveryAncestors(processed, currentTime);
      return processed;
    } finally {
      await synchronizeUiAndAlarmSafely();
    }
  }

  async function refresh(itemId: string) {
    const item = await dependencies.outbox.get(itemId);
    if (item.captureId === null || item.receipt === null) return item;
    const api = await dependencies.getApiClient();
    const serverReceipt = statusReceipt(await api.status(item.captureId));
    if (serverReceipt === null) return item;
    const updated = await dependencies.outbox.mutate(
      itemId,
      (current) => ({
        ...current,
        captureId: serverReceipt.captureId,
        receipt: serverReceipt,
        state: serverReceipt.captureStatus,
      }),
      now(),
    );
    await synchronizeUiAndAlarm();
    return updated;
  }

  async function onCredentialStored() {
    const currentTime = now();
    await dependencies.outbox.resumeAuthentication(currentTime);
    await synchronizeUiAndAlarm();
  }

  async function reconcileRecoveryChains(currentTime: Date) {
    const savedRecoveries = (await dependencies.outbox.list()).filter(
      (item) =>
        item.recoveryOfItemId !== null &&
        item.receipt !== null &&
        item.receiptStoredAt !== null &&
        (item.state === "complete" || item.state === "partial"),
    );
    for (const item of savedRecoveries) {
      try {
        await resolveRecoveryAncestors(item, currentTime);
      } catch (error) {
        console.warn(
          `Recall recovery-chain reconciliation failed (${safeErrorName(error)})`,
        );
      }
    }
  }

  return {
    addScreenshotRecovery,
    async handleMessage(message: RecallRuntimeMessage) {
      switch (message.type) {
        case CAPTURE_CURRENT_PAGE:
          return captureCurrentPage(message);
        case LIST_OUTBOX:
          return dependencies.outbox.list();
        case RETRY_OUTBOX_ITEM:
          return retry(message.itemId);
        case ADD_SCREENSHOT_RECOVERY:
          return addScreenshotRecovery(message.itemId);
        case REFRESH_OUTBOX_ITEM:
          return refresh(message.itemId);
        case PAIRING_UPDATED:
          await onCredentialStored();
          return dependencies.outbox.list();
      }
    },
    async initialize() {
      await reconcileRecoveryChains(now());
      await processDueItems(now());
    },
    onCredentialStored,
    async onNotificationClicked(notificationId: string) {
      if (notificationId.startsWith(CAPTURE_NOTIFICATION_PREFIX)) {
        await dependencies.openPopup();
      }
    },
    processDueItems,
    refresh,
    retry,
    synchronizeUiAndAlarm,
  };
}
