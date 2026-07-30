import {
  CaptureReceiptSchema,
  ExtensionPairingCodeSchema,
  type CaptureReceipt,
  type CaptureScope,
  type ExtensionCredential,
  type Sensitivity,
} from "@recall/contracts";
import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";

import {
  exchangeExtensionPairingCode,
  ExtensionApiError,
} from "../../lib/api-client";
import {
  getExtensionCredential,
  saveExtensionCredential,
} from "../../lib/auth-store";

type PageContext = {
  label: string;
  supported: boolean;
  scopes: CaptureScope[];
};

export interface PopupServices {
  getCredential(): Promise<ExtensionCredential | null>;
  saveCredential(credential: ExtensionCredential): Promise<void>;
  exchangePairing(code: string, label: string): Promise<ExtensionCredential>;
  getPageContext(): Promise<PageContext>;
  getOutboxCount(): Promise<number>;
  capture(input: {
    scope: CaptureScope;
    sensitivity: Sensitivity;
  }): Promise<CaptureReceipt>;
}

async function defaultPageContext(): Promise<PageContext> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    return { label: "无法识别当前页面", scopes: [], supported: false };
  }
  const url = new URL(tab.url);
  if (url.hostname === "chatgpt.com") {
    return {
      label: "ChatGPT 网页版",
      scopes: ["full_conversation", "qa_pair", "selection"],
      supported: true,
    };
  }
  return { label: "当前页面暂不支持自动采集", scopes: [], supported: false };
}

async function defaultOutboxCount(): Promise<number> {
  const stored = await browser.storage.local.get("recall.outbox.unresolvedCount");
  const count = stored["recall.outbox.unresolvedCount"];
  return typeof count === "number" && Number.isInteger(count) && count > 0
    ? count
    : 0;
}

const defaultServices: PopupServices = {
  getCredential: getExtensionCredential,
  saveCredential: saveExtensionCredential,
  exchangePairing: (code, label) =>
    exchangeExtensionPairingCode({ code, label }),
  getPageContext: defaultPageContext,
  getOutboxCount: defaultOutboxCount,
  async capture(input) {
    return CaptureReceiptSchema.parse(
      await browser.runtime.sendMessage({
        type: "recall:capture-current-page",
        ...input,
      }),
    );
  },
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

export function App({ services = defaultServices }: { services?: PopupServices }) {
  const [credential, setCredential] = useState<ExtensionCredential | null>(null);
  const [context, setContext] = useState<PageContext | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState(browserLabel);
  const [scope, setScope] = useState<CaptureScope>("full_conversation");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("normal");
  const [status, setStatus] = useState<"ready" | "capturing" | "complete" | "partial" | "failed">("ready");
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      services.getCredential(),
      services.getPageContext(),
      services.getOutboxCount(),
    ])
      .then(([storedCredential, pageContext, unresolved]) => {
        if (!active) return;
        setCredential(storedCredential);
        setContext(pageContext);
        setScope(pageContext.scopes[0] ?? "full_conversation");
        setOutboxCount(unresolved);
        setLoading(false);
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

  const canCapture = useMemo(
    () => credential !== null && context?.supported === true && status !== "capturing",
    [context, credential, status],
  );

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
      setStatus("ready");
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPairing(false);
    }
  }

  async function capture() {
    setStatus("capturing");
    setError(null);
    setReceipt(null);
    try {
      const nextReceipt = await services.capture({ scope, sensitivity });
      setReceipt(nextReceipt);
      setStatus(nextReceipt.captureStatus);
    } catch (caught) {
      setError(readableError(caught));
      setStatus("failed");
    }
  }

  if (loading) {
    return <main><p role="status">正在读取扩展状态…</p></main>;
  }

  if (credential === null) {
    return (
      <main>
        <h1>连接 Recall AI</h1>
        <p>请在 Web 应用的设置页生成一次性配对码。</p>
        <label>8 位配对码<input aria-label="8 位配对码" maxLength={8} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} /></label>
        <label>设备名称<input aria-label="设备名称" maxLength={100} value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} /></label>
        <button disabled={pairing} type="button" onClick={() => void pair()}>{pairing ? "正在连接…" : "连接扩展"}</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  return (
    <main>
      <header><h1>Recall AI Capture</h1><p>待处理异常 {outboxCount}</p></header>
      <p>当前来源：{context?.label}</p>
      {context?.supported ? (
        <>
          <label>保存范围<select aria-label="保存范围" value={scope} onChange={(event) => setScope(event.target.value as CaptureScope)}>{context.scopes.map((item) => <option key={item} value={item}>{item === "full_conversation" ? "完整会话" : item === "qa_pair" ? "当前问答" : "选中文字"}</option>)}</select></label>
          <label>敏感级别<select aria-label="敏感级别" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as Sensitivity)}><option value="normal">普通</option><option value="sensitive">敏感</option><option value="strictly_sensitive">严格敏感</option></select></label>
          <button disabled={!canCapture} type="button" onClick={() => void capture()}>{status === "capturing" ? "正在采集…" : "保存到 Recall AI"}</button>
        </>
      ) : <p>可改用 Web 应用粘贴文字、文件或截图。</p>}
      {status === "complete" && receipt && <section><h2>完整采集成功</h2><p>已保存 {receipt.savedMessageCount} 条消息、{receipt.savedAttachmentCount} 个附件</p></section>}
      {status === "partial" && receipt && <section><h2>部分内容未采集</h2><ul>{receipt.missingElements.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      {receipt && <p data-processing-status={receipt.processingStatus}>{processingCopy[receipt.processingStatus]}</p>}
      {status === "failed" && <section role="alert"><h2>采集尚未完成</h2><p>{error}</p><button type="button" onClick={() => setStatus("ready")}>返回重试</button></section>}
    </main>
  );
}
