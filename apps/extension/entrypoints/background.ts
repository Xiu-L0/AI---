import { browser } from "wxt/browser";

import {
  createCaptureApiClient,
  ExtensionAuthExpiredError,
} from "../lib/api-client";
import { createAttachmentStore } from "../lib/attachment-store";
import {
  CAPTURE_RETRY_ALARM,
  createBackgroundController,
} from "../lib/background-controller";
import { createCaptureRunner } from "../lib/capture-runner";
import { EXTRACT_CHATGPT } from "../lib/chatgpt/content-message";
import { EXTRACT_XIAOHONGSHU } from "../lib/xiaohongshu/content-message";
import { getExtensionCredential } from "../lib/auth-store";
import {
  enqueueDraft,
  getOutboxItem,
  listOutbox,
  listUnresolvedOutbox,
  markAttemptFailed,
  markAuthPaused,
  markTerminal,
  mutateOutboxItem,
  pruneCompletedOutbox,
  reconcileOrphanAttachments,
  resumeAuthenticationPausedItems,
  storeReceipt,
} from "../lib/outbox";
import { isRecallRuntimeMessage } from "../lib/runtime-messages";
import { uploadToSignedTarget } from "../lib/storage-upload";

export default defineBackground(() => {
  function errorName(error: unknown): string {
    if (!(error instanceof Error)) return typeof error;
    const name = error.name.trim();
    return name.length > 0 ? name.slice(0, 80) : "Error";
  }

  const attachmentStore = createAttachmentStore();
  async function getApiClient() {
    const credential = await getExtensionCredential();
    if (credential === null) throw new ExtensionAuthExpiredError();
    return createCaptureApiClient(credential.token);
  }

  const runner = createCaptureRunner({
    attachmentStore,
    captureVisibleTab: (windowId) =>
      browser.tabs.captureVisibleTab(windowId, { format: "png" }),
    async focusTab(tabId) {
      await browser.tabs.update(tabId, { active: true });
    },
    getApiClient,
    outbox: {
      get: getOutboxItem,
      markAuthPaused: (id, code, message, now) =>
        markAuthPaused(id, code, message, { now }),
      markRetry: (id, code, message, now) =>
        markAttemptFailed(id, code, message, { now }),
      markTerminal: (id, code, message, now) =>
        markTerminal(id, code, message, { now }),
      mutate: (id, updater, now) => mutateOutboxItem(id, updater, { now }),
      storeReceipt: (id, receipt, now) => storeReceipt(id, receipt, { now }),
    },
    upload: uploadToSignedTarget,
  });

  const controller = createBackgroundController({
    attachmentStore,
    async captureVisibleTab(windowId) {
      return browser.tabs.captureVisibleTab(windowId, { format: "png" });
    },
    async clearRetryAlarm() {
      await browser.alarms.clear(CAPTURE_RETRY_ALARM);
    },
    async extractChatGpt(tabId) {
      return browser.tabs.sendMessage(tabId, { type: EXTRACT_CHATGPT });
    },
    async extractXiaohongshu(tabId) {
      return browser.tabs.sendMessage(tabId, { type: EXTRACT_XIAOHONGSHU });
    },
    async getActiveTab() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id !== undefined && tab.windowId !== undefined && tab.url
        ? { id: tab.id, url: tab.url, windowId: tab.windowId }
        : null;
    },
    getApiClient,
    getNotificationIconUrl: () => browser.runtime.getURL("/icon-128.png"),
    async notify(id, options) {
      await browser.notifications.create(id, {
        ...options,
        type: "basic",
      });
    },
    async openPopup() {
      await browser.action.openPopup();
    },
    outbox: {
      enqueue: (draft, options) => enqueueDraft(draft, options),
      get: getOutboxItem,
      list: listOutbox,
      listUnresolved: listUnresolvedOutbox,
      markRetry: (id, code, message, now) =>
        markAttemptFailed(id, code, message, { now }),
      mutate: (id, updater, now) => mutateOutboxItem(id, updater, { now }),
      resumeAuthentication: (now) =>
        resumeAuthenticationPausedItems({ now }),
    },
    processOutboxItem: runner.processOutboxItem,
    async scheduleRetryAlarm(when) {
      await browser.alarms.create(CAPTURE_RETRY_ALARM, { when });
    },
    async setBadgeText(text) {
      await browser.action.setBadgeText({ text });
    },
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!isRecallRuntimeMessage(message)) return undefined;
    return controller.handleMessage(message);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CAPTURE_RETRY_ALARM) {
      void controller.processDueItems().catch((error: unknown) => {
        console.error(`Recall capture alarm failed (${errorName(error)})`);
      });
    }
  });
  browser.notifications.onClicked.addListener((notificationId) => {
    void controller.onNotificationClicked(notificationId).catch((error: unknown) => {
      console.warn(`Recall capture popup open failed (${errorName(error)})`);
    });
  });
  void (async () => {
    try {
      await controller.initialize();
    } catch (error) {
      console.error(
        `Recall extension startup recovery failed (${errorName(error)})`,
      );
      await browser.action.setBadgeText({ text: "!" });
    }
    try {
      await pruneCompletedOutbox(new Date(), attachmentStore);
    } catch (error) {
      console.warn(
        `Recall extension outbox pruning failed (${errorName(error)})`,
      );
    }
    try {
      await reconcileOrphanAttachments(attachmentStore, new Date());
    } catch (error) {
      console.warn(
        `Recall extension orphan cleanup failed (${errorName(error)})`,
      );
    }
  })();
});
