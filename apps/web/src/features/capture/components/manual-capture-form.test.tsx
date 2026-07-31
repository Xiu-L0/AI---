import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ManualCaptureForm,
  type SubmitCapture
} from "./manual-capture-form";

const completeReceipt = {
  captureId: "20000000-0000-4000-8000-000000000001",
  sourceItemId: "30000000-0000-4000-8000-000000000001",
  captureStatus: "complete" as const,
  processingStatus: "queued" as const,
  savedMessageCount: 1,
  savedAttachmentCount: 0,
  missingElements: []
};

function renderForm(submitCapture: SubmitCapture = vi.fn()) {
  render(<ManualCaptureForm submitCapture={submitCapture} />);
  return screen
    .getByRole("button", { name: "保存并后台整理" })
    .closest("form") as HTMLFormElement;
}

describe("ManualCaptureForm", () => {
  it("blocks a file larger than ten MiB before upload", async () => {
    renderForm();
    const file = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" }
    );

    fireEvent.change(screen.getByLabelText("添加文件或截图"), {
      target: { files: [file] }
    });

    expect(
      await screen.findByText("单个文件不能超过 10 MiB")
    ).toBeVisible();
  });

  it("requires a title", () => {
    const submitCapture = vi.fn();
    const form = renderForm(submitCapture);
    fireEvent.change(screen.getByLabelText("正文"), {
      target: { value: "Synthetic body" }
    });

    fireEvent.submit(form);

    expect(screen.getByText("请输入标题")).toBeVisible();
    expect(submitCapture).not.toHaveBeenCalled();
  });

  it("requires text or a file", async () => {
    const submitCapture = vi.fn();
    const form = renderForm(submitCapture);
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");

    fireEvent.submit(form);

    expect(screen.getByText("请填写正文或添加文件")).toBeVisible();
    expect(submitCapture).not.toHaveBeenCalled();
  });

  it("does not show success before the server confirms storage", async () => {
    let rejectSubmission: ((reason: Error) => void) | undefined;
    const submitCapture = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectSubmission = reject;
        })
    );
    const form = renderForm(submitCapture);
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");
    await userEvent.type(screen.getByLabelText("正文"), "Synthetic body");

    fireEvent.submit(form);

    expect(
      await screen.findByText("正在准备采集内容")
    ).toBeVisible();
    expect(
      screen.queryByText("完整采集成功，原始资料已保存")
    ).not.toBeInTheDocument();

    rejectSubmission?.(new Error("network unavailable"));

    expect(
      await screen.findByText("采集尚未完成，服务器未确认保存")
    ).toBeVisible();
    expect(screen.getByText("network unavailable")).toBeVisible();
    expect(
      screen.queryByText("完整采集成功，原始资料已保存")
    ).not.toBeInTheDocument();
  });

  it("shows complete capture and queued processing separately", async () => {
    const submitCapture = vi.fn().mockResolvedValue(completeReceipt);
    const form = renderForm(submitCapture);
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");
    await userEvent.type(screen.getByLabelText("正文"), "Synthetic body");

    fireEvent.submit(form);

    expect(
      await screen.findByText("完整采集成功，原始资料已保存")
    ).toBeVisible();
    expect(
      screen.getByText("原文已保存，等待后台处理")
    ).toBeVisible();
    await waitFor(() => expect(submitCapture).toHaveBeenCalledTimes(1));
  });

  it("shows a partial receipt with every missing element", async () => {
    const submitCapture = vi.fn().mockResolvedValue({
      ...completeReceipt,
      captureStatus: "partial",
      missingElements: [
        "第 3 条消息中的 1 张图片无法读取",
        "页面仍在生成回答"
      ]
    });
    const form = renderForm(submitCapture);
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");
    await userEvent.type(screen.getByLabelText("正文"), "Synthetic body");

    fireEvent.submit(form);

    expect(await screen.findByText("部分内容未采集")).toBeVisible();
    expect(
      screen.getByText("第 3 条消息中的 1 张图片无法读取")
    ).toBeVisible();
    expect(screen.getByText("页面仍在生成回答")).toBeVisible();
    expect(
      screen.queryByText("完整采集成功，原始资料已保存")
    ).not.toBeInTheDocument();
  });

  it("reuses the idempotency key when retrying unchanged content", async () => {
    const submitCapture = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(completeReceipt);
    const form = renderForm(submitCapture);
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");
    await userEvent.type(screen.getByLabelText("正文"), "Synthetic body");

    fireEvent.submit(form);
    expect(
      await screen.findByText("采集尚未完成，服务器未确认保存")
    ).toBeVisible();

    fireEvent.submit(form);
    expect(
      await screen.findByText("完整采集成功，原始资料已保存")
    ).toBeVisible();

    const firstKey = submitCapture.mock.calls[0]?.[0].idempotencyKey;
    const retryKey = submitCapture.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
  });

  it("keeps an explicit server recovery link on the submitted draft", async () => {
    const submitCapture = vi.fn().mockResolvedValue(completeReceipt);
    const recoveryCaptureId =
      "20000000-0000-4000-8000-000000000099";
    render(
      <ManualCaptureForm
        recoveryCaptureId={recoveryCaptureId}
        submitCapture={submitCapture}
      />,
    );
    await userEvent.type(screen.getByLabelText("标题"), "Recovered title");
    await userEvent.type(screen.getByLabelText("正文"), "Recovered body");

    await userEvent.click(
      screen.getByRole("button", { name: "保存并后台整理" }),
    );

    await waitFor(() => expect(submitCapture).toHaveBeenCalledOnce());
    expect(submitCapture.mock.calls[0]?.[0].recoveryCaptureId).toBe(
      recoveryCaptureId,
    );
  });

  it("creates a new idempotency key after the draft changes", async () => {
    const submitCapture = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(completeReceipt);
    const form = renderForm(submitCapture);
    const body = screen.getByLabelText("正文");
    await userEvent.type(screen.getByLabelText("标题"), "Synthetic title");
    await userEvent.type(body, "Synthetic body");

    fireEvent.submit(form);
    expect(
      await screen.findByText("采集尚未完成，服务器未确认保存")
    ).toBeVisible();

    await userEvent.type(body, " changed");
    fireEvent.submit(form);
    expect(
      await screen.findByText("完整采集成功，原始资料已保存")
    ).toBeVisible();

    const firstKey = submitCapture.mock.calls[0]?.[0].idempotencyKey;
    const changedKey = submitCapture.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(changedKey).toBeTruthy();
    expect(changedKey).not.toBe(firstKey);
  });
});
