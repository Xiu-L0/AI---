import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App, type PopupServices } from "./App";

const credential = { token: "a".repeat(43), expiresAt: "2026-08-28T00:00:00.000Z" };

function services(overrides: Partial<PopupServices> = {}): PopupServices {
  return {
    getCredential: vi.fn(async () => null),
    saveCredential: vi.fn(async () => undefined),
    exchangePairing: vi.fn(async () => credential),
    getPageContext: vi.fn(async () => ({
      label: "ChatGPT 网页版",
      supported: true,
      scopes: ["full_conversation" as const],
    })),
    getOutboxCount: vi.fn(async () => 0),
    capture: vi.fn(),
    ...overrides,
  };
}

describe("extension popup", () => {
  it("pairs once and clears the code from the UI", async () => {
    const popupServices = services();
    render(<App services={popupServices} />);

    await userEvent.type(await screen.findByLabelText("8 位配对码"), "ABCDEFGH");
    await userEvent.click(screen.getByRole("button", { name: "连接扩展" }));

    expect(await screen.findByText("当前来源：ChatGPT 网页版")).toBeVisible();
    expect(screen.queryByDisplayValue("ABCDEFGH")).not.toBeInTheDocument();
    expect(popupServices.saveCredential).toHaveBeenCalledWith(credential);
  });

  it("shows partial capture separately from processing", async () => {
    const popupServices = services({
      getCredential: vi.fn(async () => credential),
      getOutboxCount: vi.fn(async () => 2),
      capture: vi.fn(async () => ({
        captureId: "20000000-0000-4000-8000-000000000001",
        sourceItemId: "30000000-0000-4000-8000-000000000001",
        captureStatus: "partial" as const,
        processingStatus: "queued" as const,
        savedMessageCount: 4,
        savedAttachmentCount: 0,
        missingElements: ["1 张图片无法读取"],
      })),
    });
    render(<App services={popupServices} />);

    expect(await screen.findByText("待处理异常 2")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "保存到 Recall AI" }));

    expect(await screen.findByText("部分内容未采集")).toBeVisible();
    expect(screen.getByText("1 张图片无法读取")).toBeVisible();
    expect(screen.getByText("原文已保存，等待后台处理")).toBeVisible();
    expect(screen.queryByText("完整采集成功")).not.toBeInTheDocument();
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
