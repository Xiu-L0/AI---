import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OutboxItem } from "../../lib/outbox-types";
import { App, pageContextForUrl, type PopupServices } from "./App";

const credential = {
  token: "a".repeat(43),
  expiresAt: "2026-08-28T00:00:00.000Z",
};

function outboxItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  const receipt = {
    captureId: "20000000-0000-4000-8000-000000000001",
    sourceItemId: "30000000-0000-4000-8000-000000000001",
    captureStatus: "complete" as const,
    processingStatus: "queued" as const,
    savedMessageCount: 4,
    savedAttachmentCount: 1,
    missingElements: [],
  };
  return {
    attachmentsPrepared: true,
    attemptCount: 0,
    captureId: receipt.captureId,
    createdAt: "2026-07-30T00:00:00.000Z",
    draft: {
      attachments: [],
      completeness: "complete",
      externalRef: "conversation-1",
      messages: [],
      missingElements: [],
      originConversationRef: "conversation-1",
      originTabId: 1,
      originUrl: "https://chatgpt.com/c/conversation-1",
      originWindowId: 1,
      pendingImages: [],
      rawText: "Question\nAnswer",
      scope: "full_conversation",
      sensitivity: "normal",
      source: "chatgpt_web",
      sourceKind: "ai_conversation",
      sourcePlatform: "chatgpt",
      title: "Synthetic conversation",
    },
    errorCode: null,
    id: "outbox-1",
    idempotencyKey: "idempotency-key-1",
    lastError: null,
    lastNotifiedAttemptCount: 0,
    nextAttemptAt: null,
    receipt,
    receiptStoredAt: "2026-07-30T00:00:01.000Z",
    recoveryOfItemId: null,
    resolvedAt: "2026-07-30T00:00:01.000Z",
    resumeStage: "finalizing",
    schemaVersion: 1,
    state: "complete",
    supersededByItemId: null,
    updatedAt: "2026-07-30T00:00:01.000Z",
    uploadedAttachments: [],
    ...overrides,
  };
}

function services(overrides: Partial<PopupServices> = {}): PopupServices {
  return {
    getCredential: vi.fn(async () => null),
    saveCredential: vi.fn(async () => undefined),
    exchangePairing: vi.fn(async () => credential),
    getPageContext: vi.fn(async () => ({
      adapterId: "chatgpt" as const,
      label: "ChatGPT 网页版",
      originRef: "conversation-1",
      supported: true,
      scopes: ["full_conversation" as const],
    })),
    listOutbox: vi.fn(async () => []),
    capture: vi.fn(),
    retry: vi.fn(),
    addScreenshotRecovery: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe("extension popup", () => {
  it("supports only the exact secure ChatGPT origin", () => {
    expect(
      pageContextForUrl("https://chatgpt.com/c/conversation-1").supported,
    ).toBe(true);
    expect(pageContextForUrl("http://chatgpt.com/c/conversation-1").supported).toBe(
      false,
    );
    expect(
      pageContextForUrl("https://chatgpt.com.attacker.example/c/conversation-1")
        .supported,
    ).toBe(false);
  });

  it("recognizes Xiaohongshu notes and rejects look-alike hosts", () => {
    expect(pageContextForUrl("https://www.xiaohongshu.com/explore/abc")).toMatchObject({
      label: "小红书网页版",
      scopes: ["web_page"],
      supported: true,
    });
    expect(
      pageContextForUrl("https://xiaohongshu.com.attacker.example/explore/abc")
        .supported,
    ).toBe(false);
    expect(
      pageContextForUrl("http://www.xiaohongshu.com/explore/abc").supported,
    ).toBe(false);
  });

  it("pairs once and clears the code from the UI", async () => {
    const popupServices = services();
    render(<App services={popupServices} />);

    await userEvent.type(await screen.findByLabelText("8 位配对码"), "ABCDEFGH");
    await userEvent.click(screen.getByRole("button", { name: "连接扩展" }));

    expect(await screen.findByText("当前来源：ChatGPT 网页版")).toBeVisible();
    expect(screen.queryByDisplayValue("ABCDEFGH")).not.toBeInTheDocument();
    expect(popupServices.saveCredential).toHaveBeenCalledWith(credential);
  });

  it("shows partial separately from processing and keeps it after screenshot failure", async () => {
    const partial = outboxItem({
      draft: {
        ...outboxItem().draft,
        completeness: "partial",
        missingElements: ["1 张图片无法读取"],
      },
      receipt: {
        ...outboxItem().receipt!,
        captureStatus: "partial",
        processingStatus: "queued",
        savedAttachmentCount: 0,
        missingElements: ["1 张图片无法读取"],
      },
      resolvedAt: null,
      state: "partial",
    });
    const popupServices = services({
      getCredential: vi.fn(async () => credential),
      capture: vi.fn(async () => partial),
      addScreenshotRecovery: vi.fn(async () => {
        throw new Error("The active tab cannot be captured");
      }),
    });
    render(<App services={popupServices} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "保存到 Recall AI" }),
    );

    expect(await screen.findByText("部分内容未采集")).toBeVisible();
    expect(screen.getByText("1 张图片无法读取")).toBeVisible();
    expect(screen.getByText("原文已保存，等待后台处理")).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "补充截图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The active tab cannot be captured",
    );
    expect(screen.getByText("部分内容未采集")).toBeVisible();
    expect(screen.getByText("1 张图片无法读取")).toBeVisible();
    expect(screen.getByRole("button", { name: "补充截图" })).toBeVisible();
  });

  it("retries a retry-wait item immediately and refreshes the exception count", async () => {
    const waiting = outboxItem({
      attemptCount: 2,
      captureId: null,
      lastError: "network unavailable",
      nextAttemptAt: "2026-07-30T00:10:00.000Z",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state: "retry_wait",
    });
    const complete = outboxItem({ id: waiting.id });
    const listOutbox = vi
      .fn<PopupServices["listOutbox"]>()
      .mockResolvedValueOnce([waiting])
      .mockResolvedValueOnce([complete]);
    const popupServices = services({
      getCredential: vi.fn(async () => credential),
      listOutbox,
      retry: vi.fn(async () => complete),
    });
    render(<App services={popupServices} />);

    expect(await screen.findByText("待处理异常 1")).toBeVisible();
    expect(screen.getByText("服务器尚未确认保存")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "立即重试" }));

    expect(await screen.findByText("完整采集成功")).toBeVisible();
    expect(await screen.findByText("待处理异常 0")).toBeVisible();
    expect(popupServices.retry).toHaveBeenCalledWith(waiting.id);
  });

  it("prioritizes older unresolved items over a newer complete receipt and lets the user switch between them", async () => {
    const complete = outboxItem({
      id: "complete-newer",
      updatedAt: "2026-07-30T00:10:00.000Z",
    });
    const terminal = outboxItem({
      captureId: null,
      draft: { ...outboxItem().draft, title: "结构变化" },
      id: "terminal-older",
      lastError: "页面结构已变化",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state: "terminal",
      updatedAt: "2026-07-30T00:01:00.000Z",
    });
    const waiting = outboxItem({
      captureId: null,
      draft: { ...outboxItem().draft, title: "网络中断" },
      id: "retry-middle",
      lastError: "network unavailable",
      nextAttemptAt: "2026-07-30T00:20:00.000Z",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state: "retry_wait",
      updatedAt: "2026-07-30T00:02:00.000Z",
    });
    const partial = outboxItem({
      draft: {
        ...outboxItem().draft,
        completeness: "partial",
        missingElements: ["1 张图片无法读取"],
        title: "缺少图片",
      },
      id: "partial-middle",
      receipt: {
        ...outboxItem().receipt!,
        captureStatus: "partial",
        missingElements: ["1 张图片无法读取"],
      },
      resolvedAt: null,
      state: "partial",
      updatedAt: "2026-07-30T00:03:00.000Z",
    });
    const authPaused = outboxItem({
      captureId: null,
      draft: { ...outboxItem().draft, title: "登录失效" },
      id: "auth-newest-unresolved",
      lastError: "credential expired",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state: "auth_paused",
      updatedAt: "2026-07-30T00:04:00.000Z",
    });
    const popupServices = services({
      getCredential: vi.fn(async () => credential),
      listOutbox: vi.fn(async () => [
        complete,
        terminal,
        waiting,
        partial,
        authPaused,
      ]),
    });
    render(<App services={popupServices} />);

    expect(
      await screen.findByText("扩展连接已失效，请重新配对"),
    ).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登录失效 · 需要重新配对" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "重新配对" })).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "网络中断 · 等待重试" }),
    );
    expect(await screen.findByText("服务器尚未确认保存")).toBeVisible();
    expect(screen.getByRole("button", { name: "立即重试" })).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "缺少图片 · 部分内容未采集" }),
    );
    expect(await screen.findByText("部分内容未采集")).toBeVisible();
    expect(screen.getByRole("button", { name: "补充截图" })).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "结构变化 · 需要重新采集" }),
    );
    expect(
      await screen.findByText("采集无法自动恢复，需要重新采集"),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "重新采集当前页面" }),
    );
    expect(popupServices.capture).toHaveBeenCalledWith({
      recoveryOfItemId: terminal.id,
      scope: "full_conversation",
      sensitivity: "normal",
    });
  });

  it("automatically refreshes processing status for a stored receipt on initialization", async () => {
    const queued = outboxItem();
    const processingFailed = outboxItem({
      receipt: { ...queued.receipt!, processingStatus: "failed" },
    });
    const refresh = vi.fn(async () => processingFailed);
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          listOutbox: vi.fn(async () => [queued]),
          refresh,
        })}
      />,
    );

    expect(await screen.findByText("原文已保存，后台处理失败")).toBeVisible();
    expect(refresh).toHaveBeenCalledWith(queued.id);
  });

  it("keeps a stored receipt visible when automatic processing refresh fails", async () => {
    const queued = outboxItem();
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          listOutbox: vi.fn(async () => [queued]),
          refresh: vi.fn(async () => {
            throw new Error("status endpoint unavailable");
          }),
        })}
      />,
    );

    expect(await screen.findByText("完整采集成功")).toBeVisible();
    expect(screen.getByText("原文已保存，等待后台处理")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "原文保存回执仍在本地，后台处理状态暂时无法刷新：status endpoint unavailable",
    );
  });

  it.each([
    ["auth_paused", "扩展连接已失效，请重新配对"],
    ["terminal", "采集无法自动恢复，需要重新采集"],
  ] as const)("shows %s as unresolved without success copy", async (state, copy) => {
    const item = outboxItem({
      captureId: null,
      lastError: "capture blocked",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state,
    });
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          listOutbox: vi.fn(async () => [item]),
        })}
      />,
    );

    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.getByText("capture blocked")).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
  });

  it("does not show success before the real receipt is stored locally", async () => {
    const unsafeComplete = outboxItem({ receiptStoredAt: null });
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          capture: vi.fn(async () => unsafeComplete),
        })}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "保存到 Recall AI" }),
    );

    expect(await screen.findByText("服务器尚未确认保存")).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
  });

  it("refreshes processing status without using capture-loss language", async () => {
    const queued = outboxItem();
    const processingFailed = outboxItem({
      receipt: {
        ...queued.receipt!,
        processingStatus: "failed",
      },
    });
    const popupServices = services({
      getCredential: vi.fn(async () => credential),
      capture: vi.fn(async () => queued),
      refresh: vi.fn(async () => processingFailed),
    });
    render(<App services={popupServices} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "保存到 Recall AI" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "刷新状态" }),
    );

    expect(await screen.findByText("原文已保存，后台处理失败")).toBeVisible();
    expect(screen.queryByText("采集失败")).not.toBeInTheDocument();
  });

  it("does not treat a historical complete receipt as the current unsupported page result", async () => {
    const complete = outboxItem();
    const waiting = outboxItem({
      captureId: null,
      draft: { ...outboxItem().draft, title: "网络中断" },
      id: "retry-unsupported",
      lastError: "network unavailable",
      nextAttemptAt: "2026-07-30T00:20:00.000Z",
      receipt: null,
      receiptStoredAt: null,
      resolvedAt: null,
      state: "retry_wait",
      updatedAt: "2026-07-30T00:02:00.000Z",
    });
    const listOutbox = vi.fn<PopupServices["listOutbox"]>(async () => [
      complete,
      waiting,
    ]);
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          getPageContext: vi.fn(async () => ({
            label: "当前页面暂不支持自动采集",
            scopes: [],
            supported: false,
          })),
          listOutbox,
        })}
      />,
    );

    expect(
      await screen.findByText(/当前页面暂不支持自动采集/),
    ).toBeVisible();
    expect(
      screen.getByText("当前页面未采集；可改用 Web 应用保存。"),
    ).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
    expect(screen.queryByText(/已保存 4 条消息/)).not.toBeInTheDocument();
    expect(screen.queryByText("原文已保存，等待后台处理")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "网络中断 · 等待重试" }),
    ).toBeVisible();
    expect(listOutbox).toHaveBeenCalled();
    expect(await listOutbox.mock.results[0]?.value).toEqual([
      complete,
      waiting,
    ]);
  });

  it("hides a lone historical success when the current page is unsupported", async () => {
    const complete = outboxItem();
    const listOutbox = vi.fn<PopupServices["listOutbox"]>(async () => [complete]);
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          getPageContext: vi.fn(async () => ({
            label: "当前页面暂不支持自动采集",
            scopes: [],
            supported: false,
          })),
          listOutbox,
          refresh: vi.fn(async () => complete),
        })}
      />,
    );

    expect(
      await screen.findByText(/当前页面暂不支持自动采集/),
    ).toBeVisible();
    expect(
      screen.getByText("当前页面未采集；可改用 Web 应用保存。"),
    ).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
    expect(screen.queryByText(/已保存 4 条消息/)).not.toBeInTheDocument();
    expect(screen.queryByText("原文已保存，等待后台处理")).not.toBeInTheDocument();
    expect(await listOutbox.mock.results[0]?.value).toEqual([complete]);
  });

  it("still shows a complete receipt on a supported ChatGPT page", async () => {
    const complete = outboxItem();
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          listOutbox: vi.fn(async () => [complete]),
          refresh: vi.fn(async () => complete),
        })}
      />,
    );

    expect(await screen.findByText("当前来源：ChatGPT 网页版")).toBeVisible();
    expect(await screen.findByText("完整采集成功")).toBeVisible();
    expect(screen.getByText(/已保存 4 条消息、\s*1 个附件/)).toBeVisible();
    expect(screen.getByText("原文已保存，等待后台处理")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "立即重试" }),
    ).not.toBeInTheDocument();
  });

  it("shows Xiaohongshu receipt copy and only the whole-note scope", async () => {
    const complete = outboxItem({
      draft: {
        ...outboxItem().draft,
        originConversationRef: "65abc123",
        originUrl: "https://www.xiaohongshu.com/explore/65abc123",
        scope: "web_page",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        title: "合成标题",
      },
    });
    const { source: _legacySource, ...typedDraft } = complete.draft;
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          getPageContext: vi.fn(async () => ({
            adapterId: "xiaohongshu" as const,
            label: "小红书网页版",
            originRef: "65abc123",
            scopes: ["web_page" as const],
            supported: true,
          })),
          listOutbox: vi.fn(async () => [
            { ...complete, draft: typedDraft },
          ]),
          refresh: vi.fn(async () => ({ ...complete, draft: typedDraft })),
        })}
      />,
    );

    expect(await screen.findByText("当前来源：小红书网页版")).toBeVisible();
    expect(screen.getByLabelText("保存范围")).toHaveDisplayValue("整篇笔记");
    expect(
      screen.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /^完整采集成功$/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show a prior ChatGPT receipt as the current Xiaohongshu result", async () => {
    const chatgptComplete = outboxItem();
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          getPageContext: vi.fn(async () => ({
            adapterId: "xiaohongshu" as const,
            label: "小红书网页版",
            originRef: "65abc123",
            scopes: ["web_page" as const],
            supported: true,
          })),
          listOutbox: vi.fn(async () => [chatgptComplete]),
          refresh: vi.fn(async () => chatgptComplete),
        })}
      />,
    );

    expect(await screen.findByText("当前来源：小红书网页版")).toBeVisible();
    expect(screen.getByLabelText("保存范围")).toHaveDisplayValue("整篇笔记");
    expect(screen.getByRole("button", { name: "保存到 Recall AI" })).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
    expect(screen.queryByText(/已保存 4 条消息/)).not.toBeInTheDocument();
  });

  it("shows Xiaohongshu partial copy without promoting it to complete", async () => {
    const partial = outboxItem({
      draft: {
        ...outboxItem().draft,
        completeness: "partial",
        missingElements: ["第 2 张图片无法读取：HTTP 403"],
        originConversationRef: "65abc123",
        originUrl: "https://www.xiaohongshu.com/explore/65abc123",
        scope: "web_page",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        title: "部分可读的合成笔记",
      },
      receipt: {
        ...outboxItem().receipt!,
        captureStatus: "partial",
        missingElements: ["第 2 张图片无法读取：HTTP 403"],
        savedAttachmentCount: 2,
        savedMessageCount: 0,
      },
      resolvedAt: null,
      state: "partial",
    });
    const { source: _legacySource, ...typedDraft } = partial.draft;
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => credential),
          getPageContext: vi.fn(async () => ({
            adapterId: "xiaohongshu" as const,
            label: "小红书网页版",
            originRef: "65abc123",
            scopes: ["web_page" as const],
            supported: true,
          })),
          listOutbox: vi.fn(async () => [{ ...partial, draft: typedDraft }]),
          refresh: vi.fn(async () => ({ ...partial, draft: typedDraft })),
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "部分采集成功，已保存可用内容；请查看缺失项",
      }),
    ).toBeVisible();
    expect(screen.getByText("第 2 张图片无法读取：HTTP 403")).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补充截图" })).not.toBeInTheDocument();
  });

  it("does not stay loading when extension state cannot be read", async () => {
    render(
      <App
        services={services({
          getCredential: vi.fn(async () => {
            throw new Error("storage unavailable");
          }),
        })}
      />,
    );

    expect(await screen.findByText("连接 Recall AI")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("storage unavailable");
    expect(screen.queryByText("正在读取扩展状态…")).not.toBeInTheDocument();
  });
});
