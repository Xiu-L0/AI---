import { describe, expect, it } from "vitest";

import type { XiaohongshuExtraction } from "./extract";
import { toXiaohongshuCaptureDraft } from "./to-capture-draft";

function extraction(
  overrides: Partial<XiaohongshuExtraction> = {},
): XiaohongshuExtraction {
  return {
    author: "合成作者",
    body: "合成正文，用于扩展采集测试。",
    canonicalUrl: "https://www.xiaohongshu.com/explore/65abc123",
    declaredImageCount: 3,
    externalRef: "65abc123",
    hasVideo: false,
    images: [
      {
        alt: "cover",
        src: "https://sns-webpic-qc.xhscdn.com/fixture/cover.png",
      },
      {
        alt: "detail 1",
        src: "https://sns-webpic-qc.xhscdn.com/fixture/detail-1.png",
      },
      {
        alt: "detail 2",
        src: "https://sns-webpic-qc.xhscdn.com/fixture/detail-2.png",
      },
    ],
    title: "合成标题",
    ...overrides,
  };
}

describe("toXiaohongshuCaptureDraft", () => {
  it("returns a complete typed social-post draft", () => {
    const draft = toXiaohongshuCaptureDraft({
      capturedAt: "2026-09-08T01:00:00.000Z",
      extraction: extraction(),
      originTabId: 4,
      originUrl: "https://www.xiaohongshu.com/explore/65abc123",
      originWindowId: 1,
      sensitivity: "normal",
    });

    expect(draft.completeness).toBe("complete");
    expect(draft.missingElements).toEqual([]);
    expect(draft.sourceKind).toBe("social_post");
    expect(draft.sourcePlatform).toBe("xiaohongshu");
    expect(draft.scope).toBe("web_page");
    expect(draft.metadata?.adapterName).toBe("xiaohongshu");
    expect(draft.pendingImages).toHaveLength(3);
  });

  it("returns partial with readable missing-element labels", () => {
    const draft = toXiaohongshuCaptureDraft({
      capturedAt: "2026-09-08T01:00:00.000Z",
      extraction: extraction({
        author: null,
        declaredImageCount: 2,
        hasVideo: true,
        images: [
          {
            alt: "cover",
            src: "https://sns-webpic-qc.xhscdn.com/fixture/cover.png",
          },
          { alt: "unreadable", src: null },
        ],
        title: "部分可读的合成笔记",
      }),
      originTabId: 4,
      originUrl: "https://www.xiaohongshu.com/explore/65abc123",
      originWindowId: 1,
      sensitivity: "normal",
    });

    expect(draft.completeness).toBe("partial");
    expect(draft.missingElements).toEqual(
      expect.arrayContaining([
        "第 2 张图片无法读取",
        "当前是视频笔记，首版只保存可见文字和封面",
      ]),
    );
    expect(draft.pendingImages).toHaveLength(1);
  });

  it("fails closed when the note id or body is missing", () => {
    expect(() =>
      toXiaohongshuCaptureDraft({
        capturedAt: "2026-09-08T01:00:00.000Z",
        extraction: extraction({ body: "", externalRef: "65abc123" }),
        originTabId: 4,
        originUrl: "https://www.xiaohongshu.com/explore/65abc123",
        originWindowId: 1,
        sensitivity: "normal",
      }),
    ).toThrow(/正文|无法采集/);
    expect(() =>
      toXiaohongshuCaptureDraft({
        capturedAt: "2026-09-08T01:00:00.000Z",
        extraction: extraction({ body: "合成正文", externalRef: "" }),
        originTabId: 4,
        originUrl: "https://www.xiaohongshu.com/explore/65abc123",
        originWindowId: 1,
        sensitivity: "normal",
      }),
    ).toThrow(/笔记|无法采集/);
  });
});
