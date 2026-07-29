import { describe, expect, it } from "vitest";
import { toCaptureReceipt } from "./state";

describe("toCaptureReceipt", () => {
  it("builds a queued receipt from committed row counts", () => {
    expect(
      toCaptureReceipt({
        committed: true,
        captureId: "20000000-0000-4000-8000-000000000001",
        sourceItemId: "30000000-0000-4000-8000-000000000001",
        captureStatus: "complete",
        missingElements: [],
        committedMessageCount: 2,
        committedAttachmentCount: 1
      })
    ).toEqual({
      captureId: "20000000-0000-4000-8000-000000000001",
      sourceItemId: "30000000-0000-4000-8000-000000000001",
      captureStatus: "complete",
      processingStatus: "queued",
      savedMessageCount: 2,
      savedAttachmentCount: 1,
      missingElements: []
    });
  });

  it("preserves the missing elements of a committed partial capture", () => {
    const receipt = toCaptureReceipt({
      committed: true,
      captureId: "20000000-0000-4000-8000-000000000001",
      sourceItemId: "30000000-0000-4000-8000-000000000001",
      captureStatus: "partial",
      missingElements: ["第 3 条消息中的图片无法读取"],
      committedMessageCount: 3,
      committedAttachmentCount: 0
    });

    expect(receipt.captureStatus).toBe("partial");
    expect(receipt.missingElements).toEqual([
      "第 3 条消息中的图片无法读取"
    ]);
  });

  it("rejects an uncommitted runtime input", () => {
    expect(() =>
      toCaptureReceipt({
        committed: false,
        captureId: "20000000-0000-4000-8000-000000000001",
        sourceItemId: "30000000-0000-4000-8000-000000000001",
        captureStatus: "complete",
        missingElements: [],
        committedMessageCount: 0,
        committedAttachmentCount: 0
      } as unknown as Parameters<typeof toCaptureReceipt>[0])
    ).toThrow("committed finalization");
  });
});
