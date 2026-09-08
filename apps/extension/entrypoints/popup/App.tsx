import {
  CaptureReceiptSchema,
  ExtensionPairingCodeSchema,
  type CaptureReceipt,
  type CaptureScope,
  type ExtensionCredential,
  type Sensitivity,
} from "@recall/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { adapterForUrl } from "../../lib/adapters/registry";
import {
  exchangeExtensionPairingCode,
  ExtensionApiError,
} from "../../lib/api-client";
import {
  getExtensionCredential,
  saveExtensionCredential,
} from "../../lib/auth-store";
import {
  isUnresolvedOutboxItem,
  type OutboxItem,
  type OutboxState,
} from "../../lib/outbox-types";
import {
  ADD_SCREENSHOT_RECOVERY,
  CAPTURE_CURRENT_PAGE,
  LIST_OUTBOX,
  PAIRING_UPDATED,
  REFRESH_OUTBOX_ITEM,
  RETRY_OUTBOX_ITEM,
} from "../../lib/runtime-messages";

type PopupCaptureScope = Extract<
  CaptureScope,
  "full_conversation" | "qa_pair" | "selection" | "web_page"
>;

export type PageContext = {
  label: string;
  supported: boolean;
  scopes: PopupCaptureScope[];
};

export interface PopupServices {
  getCredential(): Promise<ExtensionCredential | null>;
  saveCredential(credential: ExtensionCredential): Promise<void>;
  exchangePairing(code: string, label: string): Promise<ExtensionCredential>;
  getPageContext(): Promise<PageContext>;
  listOutbox(): Promise<OutboxItem[]>;
  capture(input: {
    recoveryOfItemId?: string;
    scope: PopupCaptureScope;
    sensitivity: Sensitivity;
  }): Promise<OutboxItem>;
  retry(itemId: string): Promise<OutboxItem>;
  addScreenshotRecovery(itemId: string): Promise<OutboxItem>;
  refresh(itemId: string): Promise<OutboxItem>;
}

export function pageContextForUrl(urlValue: string | undefined): PageContext {
  if (!urlValue) {
    return { label: "无法识别当前页面", scopes: [], supported: false };
  }
  const adapter = adapterForUrl(urlValue);
  if (adapter === null) {
    return { label: "当前页面暂不支持自动采集", scopes: [], supported: false };
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { label: "无法识别当前页面", scopes: [], supported: false };
  }
  const page = adapter.match(url);
  if (page === null) {
    return { label: "当前页面暂不支持自动采集", scopes: [], supported: false };
  }
  return {
    label: page.label,
    scopes: page.scopes.filter(
      (scope): scope is PopupCaptureScope =>
        scope === "full_conversation" ||
        scope === "qa_pair" ||
        scope === "selection" ||
        scope === "web_page",
    ),
    supported: true,
  };
}

async function defaultPageContext(): Promise<PageContext> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return pageContextForUrl(tab?.url);
}

function isOutboxItem(value: unknown): value is OutboxItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OutboxItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.state === "string" &&
    [
      "pending",
      "uploading",
      "finalizing",
      "retry_wait",
      "auth_paused",
      "terminal",
      "complete",
      "partial",
    ].includes(candidate.state)
  );
}

async function sendOutboxItem(message: object): Promise<OutboxItem> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isOutboxItem(response)) {
    throw new Error("扩展后台返回了无法识别的采集状态");
  }
  return response;
}

const defaultServices: PopupServices = {
  getCredential: getExtensionCredential,
  async saveCredential(credential) {
    await saveExtensionCredential(credential);
    await browser.runtime.sendMessage({ type: PAIRING_UPDATED });
  },
  exchangePairing: (code, label) =>
    exchangeExtensionPairingCode({ code, label }),
  getPageContext: defaultPageContext,
  async listOutbox() {
    const response: unknown = await browser.runtime.sendMessage({
      type: LIST_OUTBOX,
    });
    if (!Array.isArray(response) || !response.every(isOutboxItem)) {
      throw new Error("扩展后台返回了无法识别的异常列表");
    }
    return response;
  },
  capture: (input) =>
    sendOutboxItem({ type: CAPTURE_CURRENT_PAGE, ...input }),
  retry: (itemId) =>
    sendOutboxItem({ itemId, type: RETRY_OUTBOX_ITEM }),
  addScreenshotRecovery: (itemId) =>
    sendOutboxItem({ itemId, type: ADD_SCREENSHOT_RECOVERY }),
  refresh: (itemId) =>
    sendOutboxItem({ itemId, type: REFRESH_OUTBOX_ITEM }),
};

function browserLabel() {
  return navigator.userAgent.includes("Edg/") ? "Edge 扩展" : "Chrome 扩展";
}

function readableError(error: unknown) {
  if (error instanceof ExtensionApiError) {
    return error.code ? `${error.message}（${error.code}）` : error.message;
  }
  return error instanceof Error ? error.message : "操作未完成，请重试";
}

const processingCopy: Record<CaptureReceipt["processingStatus"], string> = {
  queued: "原文已保存，等待后台处理",
  processing: "原文已保存，正在后台处理",
  complete: "原文已保存，后台处理完成",
  failed: "原文已保存，后台处理失败",
  paused: "原文已保存，后台处理已暂停",
};

function storedReceipt(item: OutboxItem | null): CaptureReceipt | null {
  if (
    item === null ||
    item.receipt === null ||
    item.receiptStoredAt === null ||
    (item.state !== "complete" && item.state !== "partial")
  ) {
    return null;
  }
  const parsed = CaptureReceiptSchema.safeParse(item.receipt);
  if (!parsed.success || parsed.data.captureStatus !== item.state) {
    return null;
  }
  return parsed.data;
}

function displayState(item: OutboxItem | null): OutboxState | "ready" {
  if (item === null) return "ready";
  if (
    (item.state === "complete" || item.state === "partial") &&
    storedReceipt(item) === null
  ) {
    return "retry_wait";
  }
  return item.state;
}

function latestItem(items: OutboxItem[]): OutboxItem | null {
  return (
    [...items].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
    )[0] ?? null
  );
}

function unresolvedItems(items: OutboxItem[]): OutboxItem[] {
  return [...items]
    .filter(isUnresolvedOutboxItem)
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
    );
}

function preferredItem(items: OutboxItem[]): OutboxItem | null {
  return unresolvedItems(items)[0] ?? latestItem(items);
}

function replaceOrAppendItem(
  items: OutboxItem[],
  replacement: OutboxItem,
): OutboxItem[] {
  const existingIndex = items.findIndex((item) => item.id === replacement.id);
  if (existingIndex === -1) return [...items, replacement];
  return items.map((item) =>
    item.id === replacement.id ? replacement : item,
  );
}

const unresolvedStateCopy: Record<OutboxState, string> = {
  pending: "等待上传",
  uploading: "正在上传",
  finalizing: "正在确认保存",
  retry_wait: "等待重试",
  auth_paused: "需要重新配对",
  terminal: "需要重新采集",
  complete: "已完成",
  partial: "部分内容未采集",
};

function formatRetryTime(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

export function App({ services = defaultServices }: { services?: PopupServices }) {
  const [credential, setCredential] = useState<ExtensionCredential | null>(null);
  const [context, setContext] = useState<PageContext | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [currentItem, setCurrentItem] = useState<OutboxItem | null>(null);
  const selectedItemId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState(browserLabel);
  const [scope, setScope] =
    useState<PopupCaptureScope>("full_conversation");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("normal");
  const [operation, setOperation] = useState<
    "idle" | "capturing" | "retrying" | "screenshot" | "refreshing"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [processingRefreshError, setProcessingRefreshError] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      services.getCredential(),
      services.getPageContext(),
      services.listOutbox(),
    ])
      .then(([storedCredential, pageContext, items]) => {
        if (!active) return;
        setCredential(storedCredential);
        setContext(pageContext);
        setScope(pageContext.scopes[0] ?? "full_conversation");
        const initialItem = preferredItem(items);
        setOutboxItems(items);
        setOutboxCount(items.filter(isUnresolvedOutboxItem).length);
        selectedItemId.current = initialItem?.id ?? null;
        setCurrentItem(initialItem);
        setLoading(false);

        if (storedCredential !== null && storedReceipt(initialItem) !== null) {
          void services
            .refresh(initialItem!.id)
            .then((refreshedItem) => {
              if (!active || storedReceipt(refreshedItem) === null) {
                if (active) {
                  setProcessingRefreshError(
                    "原文保存回执仍在本地，后台处理状态暂时无法刷新：后台返回的状态无效",
                  );
                }
                return;
              }
              setOutboxItems((currentItems) =>
                replaceOrAppendItem(currentItems, refreshedItem),
              );
              if (selectedItemId.current === refreshedItem.id) {
                setCurrentItem(refreshedItem);
              }
            })
            .catch((caught) => {
              if (!active) return;
              setProcessingRefreshError(
                `原文保存回执仍在本地，后台处理状态暂时无法刷新：${readableError(caught)}`,
              );
            });
        }
      })
      .catch((caught) => {
        if (!active) return;
        setCredential(null);
        setContext({
          label: "无法读取当前页面",
          scopes: [],
          supported: false,
        });
        setError(readableError(caught));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [services]);

  const state = displayState(currentItem);
  const receipt = storedReceipt(currentItem);
  const pageSupported = context?.supported === true;
  const selectedUnresolved =
    currentItem !== null && isUnresolvedOutboxItem(currentItem);
  const showHistoricalResult = pageSupported || selectedUnresolved;
  const visibleState = showHistoricalResult ? state : "ready";
  const visibleReceipt = showHistoricalResult ? receipt : null;
  const unresolved = useMemo(
    () => unresolvedItems(outboxItems),
    [outboxItems],
  );
  const canCapture = useMemo(
    () =>
      credential !== null &&
      context?.supported === true &&
      operation === "idle",
    [context, credential, operation],
  );

  function selectItem(item: OutboxItem | null) {
    selectedItemId.current = item?.id ?? null;
    setCurrentItem(item);
    setProcessingRefreshError(null);
  }

  async function acceptItem(item: OutboxItem) {
    const storedItems = await services.listOutbox();
    const nextItems = replaceOrAppendItem(storedItems, item);
    setOutboxItems(nextItems);
    setOutboxCount(nextItems.filter(isUnresolvedOutboxItem).length);
    selectItem(item);
  }

  async function pair() {
    setError(null);
    const parsedCode = ExtensionPairingCodeSchema.safeParse(pairingCode);
    if (!parsedCode.success || deviceLabel.trim().length === 0) {
      setError("请输入 Web 设置页生成的 8 位配对码和设备名称");
      return;
    }
    setPairing(true);
    try {
      const nextCredential = await services.exchangePairing(
        parsedCode.data,
        deviceLabel.trim(),
      );
      await services.saveCredential(nextCredential);
      setCredential(nextCredential);
      setPairingCode("");
      const items = await services.listOutbox();
      setOutboxItems(items);
      setOutboxCount(items.filter(isUnresolvedOutboxItem).length);
      selectItem(preferredItem(items));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPairing(false);
    }
  }

  async function capture(recoveryOfItemId?: string) {
    setOperation("capturing");
    setError(null);
    try {
      await acceptItem(
        await services.capture({
          ...(recoveryOfItemId ? { recoveryOfItemId } : {}),
          scope,
          sensitivity,
        }),
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function retry() {
    if (currentItem === null) return;
    setOperation("retrying");
    setError(null);
    try {
      await acceptItem(await services.retry(currentItem.id));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function addScreenshotRecovery() {
    if (currentItem === null) return;
    setOperation("screenshot");
    setError(null);
    try {
      await acceptItem(
        await services.addScreenshotRecovery(currentItem.id),
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setOperation("idle");
    }
  }

  async function refreshStatus() {
    if (currentItem === null) return;
    setOperation("refreshing");
    setError(null);
    setProcessingRefreshError(null);
    try {
      const refreshedItem = await services.refresh(currentItem.id);
      if (storedReceipt(refreshedItem) === null) {
        throw new Error("后台返回的状态无效");
      }
      await acceptItem(refreshedItem);
    } catch (caught) {
      setProcessingRefreshError(
        `原文保存回执仍在本地，后台处理状态暂时无法刷新：${readableError(caught)}`,
      );
    } finally {
      setOperation("idle");
    }
  }

  if (loading) {
    return (
      <main>
        <p role="status">正在读取扩展状态…</p>
      </main>
    );
  }

  if (credential === null) {
    return (
      <main>
        <h1>连接 Recall AI</h1>
        <p>请在 Web 应用的设置页生成一次性配对码。</p>
        <label>
          8 位配对码
          <input
            aria-label="8 位配对码"
            maxLength={8}
            value={pairingCode}
            onChange={(event) =>
              setPairingCode(event.target.value.toUpperCase())
            }
          />
        </label>
        <label>
          设备名称
          <input
            aria-label="设备名称"
            maxLength={100}
            value={deviceLabel}
            onChange={(event) => setDeviceLabel(event.target.value)}
          />
        </label>
        <button disabled={pairing} type="button" onClick={() => void pair()}>
          {pairing ? "正在连接…" : "连接扩展"}
        </button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>Recall AI Capture</h1>
        <p>待处理异常 {outboxCount}</p>
      </header>
      <p>当前来源：{context?.label}</p>
      {context?.supported ? (
        <>
          <label>
            保存范围
            <select
              aria-label="保存范围"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as PopupCaptureScope)
              }
            >
              {context.scopes.map((item) => (
                <option key={item} value={item}>
                  {item === "full_conversation"
                    ? "完整会话"
                    : item === "qa_pair"
                      ? "当前问答"
                      : item === "web_page"
                        ? "整篇笔记"
                        : "选中文字"}
                </option>
              ))}
            </select>
          </label>
          <label>
            敏感级别
            <select
              aria-label="敏感级别"
              value={sensitivity}
              onChange={(event) =>
                setSensitivity(event.target.value as Sensitivity)
              }
            >
              <option value="normal">普通</option>
              <option value="sensitive">敏感</option>
              <option value="strictly_sensitive">严格敏感</option>
            </select>
          </label>
          <button
            disabled={!canCapture}
            type="button"
            onClick={() => void capture()}
          >
            {operation === "capturing" ? "正在采集…" : "保存到 Recall AI"}
          </button>
        </>
      ) : (
        <p>当前页面未采集；可改用 Web 应用保存。</p>
      )}

      {unresolved.length > 0 && (
        <section aria-label="待处理采集">
          <h2>待处理采集</h2>
          <ul>
            {unresolved.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={currentItem?.id === item.id}
                  disabled={operation !== "idle"}
                  type="button"
                  onClick={() => selectItem(item)}
                >
                  {item.draft.title} · {unresolvedStateCopy[item.state]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visibleState === "complete" && visibleReceipt && (
        <section>
          <h2>完整采集成功</h2>
          <p>
            已保存 {visibleReceipt.savedMessageCount} 条消息、
            {visibleReceipt.savedAttachmentCount} 个附件
          </p>
        </section>
      )}

      {visibleState === "partial" && visibleReceipt && currentItem && (
        <section>
          <h2>部分内容未采集</h2>
          <ul>
            {visibleReceipt.missingElements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            disabled={operation !== "idle"}
            type="button"
            onClick={() => void addScreenshotRecovery()}
          >
            {operation === "screenshot" ? "正在补充…" : "补充截图"}
          </button>
        </section>
      )}

      {(visibleState === "pending" ||
        visibleState === "uploading" ||
        visibleState === "finalizing") && (
        <section aria-live="polite">
          <h2>服务器尚未确认保存</h2>
          <p>采集正在继续，请不要把当前状态视为成功。</p>
        </section>
      )}

      {visibleState === "retry_wait" && currentItem && (
        <section>
          <h2>服务器尚未确认保存</h2>
          {currentItem.lastError && <p>{currentItem.lastError}</p>}
          {formatRetryTime(currentItem.nextAttemptAt) && (
            <p>
              下次自动重试：
              <time dateTime={currentItem.nextAttemptAt ?? undefined}>
                {formatRetryTime(currentItem.nextAttemptAt)}
              </time>
            </p>
          )}
          <button
            disabled={operation !== "idle"}
            type="button"
            onClick={() => void retry()}
          >
            {operation === "retrying" ? "正在重试…" : "立即重试"}
          </button>
        </section>
      )}

      {visibleState === "auth_paused" && currentItem && (
        <section>
          <h2>扩展连接已失效，请重新配对</h2>
          {currentItem.lastError && <p>{currentItem.lastError}</p>}
          <button type="button" onClick={() => setCredential(null)}>
            重新配对
          </button>
        </section>
      )}

      {visibleState === "terminal" && currentItem && (
        <section>
          <h2>采集无法自动恢复，需要重新采集</h2>
          {currentItem.lastError && <p>{currentItem.lastError}</p>}
          {context?.supported && (
            <button
              disabled={!canCapture}
              type="button"
              onClick={() => void capture(currentItem.id)}
            >
              {operation === "capturing" ? "正在重新采集…" : "重新采集当前页面"}
            </button>
          )}
        </section>
      )}

      {visibleReceipt && (
        <>
          <p data-processing-status={visibleReceipt.processingStatus}>
            {processingCopy[visibleReceipt.processingStatus]}
          </p>
          <button
            disabled={operation !== "idle"}
            type="button"
            onClick={() => void refreshStatus()}
          >
            {operation === "refreshing" ? "正在刷新…" : "刷新状态"}
          </button>
        </>
      )}

      {processingRefreshError && <p role="alert">{processingRefreshError}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
