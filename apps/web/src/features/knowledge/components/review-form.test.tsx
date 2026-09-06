import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeReview } from "../server/get-knowledge-review";
import { ReviewForm } from "./review-form";

const review: KnowledgeReview = {
  citations: [
    {
      claimPath: "l0_summary",
      evidenceHref: "/captures/10000000-0000-4000-8000-0000000000d1#message:msg-user/body",
      id: "70000000-0000-4000-8000-0000000000d1",
      locatorKey: "message:msg-user/body",
      ordinal: 0,
      quoteExcerpt: "A cited draft summary",
      reviewStatus: "pending",
      role: "user",
      sourceItemId: "10000000-0000-4000-8000-0000000000d1",
      sourceVersionId: "30000000-0000-4000-8000-0000000000d1",
    },
  ],
  conditions: ["ChatGPT text only"],
  confidence: 0.72,
  currentVersion: 1,
  evidenceMode: "cited",
  humanLockedFields: ["title"],
  knowledgeItemId: "80000000-0000-4000-8000-0000000000d1",
  knowledgeType: "concept",
  l0Summary: "A cited draft summary",
  l1Content: "A cited draft body",
  l2Content: "A cited draft detail",
  limitations: ["No invented locators"],
  sourceItemId: "10000000-0000-4000-8000-0000000000d1",
  sourceTitle: "ChatGPT fixture",
  sourceVersionId: "30000000-0000-4000-8000-0000000000d1",
  status: "pending_review",
  title: "Stable cited concept",
};

describe("ReviewForm", () => {
  it("lets the reviewer edit L0/L1/L2, conditions and limitations", () => {
    render(<ReviewForm review={review} submitReview={vi.fn()} />);

    expect(screen.getByLabelText("L0")).toHaveValue("A cited draft summary");
    expect(screen.getByLabelText("L1")).toHaveValue("A cited draft body");
    expect(screen.getByLabelText("L2")).toHaveValue("A cited draft detail");
    expect(screen.getByLabelText("条件")).toHaveValue("ChatGPT text only");
    expect(screen.getByLabelText("限制")).toHaveValue("No invented locators");
  });

  it("starts citations pending and can approve or reject them", async () => {
    render(<ReviewForm review={review} submitReview={vi.fn()} />);

    expect(screen.getByText("当前：待审核")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "通过引用" }));
    expect(screen.getByText("当前：已通过")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "拒绝引用" }));
    expect(screen.getByText("当前：已拒绝")).toBeVisible();
  });

  it("disables confirm until the evidence rule passes", () => {
    render(<ReviewForm review={review} submitReview={vi.fn()} />);
    expect(screen.getByRole("button", { name: "确认并锁定" })).toBeDisabled();
  });

  it("submits expectedVersion and selected locked fields", async () => {
    const submitReview = vi.fn(async () => ({ ok: true as const }));
    render(<ReviewForm review={review} submitReview={submitReview} />);

    await userEvent.click(screen.getByRole("button", { name: "通过引用" }));
    await userEvent.click(screen.getByLabelText("锁定 L0"));
    await userEvent.click(screen.getByRole("button", { name: "确认并锁定" }));

    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "confirm",
        expectedVersion: 1,
        approvedCitationIds: ["70000000-0000-4000-8000-0000000000d1"],
        lockedFields: expect.arrayContaining(["title", "l0Summary"]),
      }),
    );
  });

  it("requires a rejection reason", async () => {
    const submitReview = vi.fn(async () => ({ ok: true as const }));
    render(<ReviewForm review={review} submitReview={submitReview} />);

    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(screen.getByText("拒绝时需要填写原因")).toBeVisible();
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("keeps typed text after a stale-version conflict", async () => {
    const submitReview = vi.fn(async () => ({
      ok: false as const,
      conflict: true as const,
      message: "这条知识已被更新，请刷新后再审核",
    }));
    render(<ReviewForm review={review} submitReview={submitReview} />);

    await userEvent.clear(screen.getByLabelText("L0"));
    await userEvent.type(screen.getByLabelText("L0"), "Local edited L0");
    await userEvent.click(screen.getByRole("button", { name: "通过引用" }));
    await userEvent.click(screen.getByRole("button", { name: "确认并锁定" }));

    expect(
      await screen.findByText("这条知识已被更新，请刷新后再审核"),
    ).toBeVisible();
    expect(screen.getByLabelText("L0")).toHaveValue("Local edited L0");
  });

  it("does not render API keys or raw processing payloads", () => {
    const { container } = render(
      <ReviewForm review={review} submitReview={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/DEEPSEEK|sk-|prompt_tokens|raw processing/i);
  });
});
