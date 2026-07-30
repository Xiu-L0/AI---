import type { ChatGptExtraction } from "./extract";
import { describe, expect, it } from "vitest";

import { toChatGptCaptureDraft } from "./to-capture-draft";

function extraction(
  overrides: Partial<ChatGptExtraction> = {},
): ChatGptExtraction {
  return {
    derivedMessageOrdinals: [],
    duplicateMessageIds: [],
    emptyMessageOrdinals: [],
    externalRef: "conversation-1",
    generatingResponse: false,
    images: [],
    messages: [
      { externalMessageId: "m1", ordinal: 0, role: "user", text: "Question" },
      { externalMessageId: "m2", ordinal: 1, role: "assistant", text: "Answer" },
      { externalMessageId: "m3", ordinal: 2, role: "user", text: "Next" },
      { externalMessageId: "m4", ordinal: 3, role: "assistant", text: "Reply" },
    ],
    selectionMessageId: null,
    selectionText: null,
    title: "Synthetic conversation",
    unsupportedRoles: [],
    ...overrides,
  };
}

const origin = {
  originTabId: 7,
  originUrl: "https://chatgpt.com/c/conversation-1",
  originWindowId: 3,
} as const;

describe("toChatGptCaptureDraft", () => {
  it("does not let an old missing image pollute the current QA pair", () => {
    const draft = toChatGptCaptureDraft({
      extraction: extraction({
        images: [
          {
            alt: "old image",
            height: 10,
            messageExternalId: "m2",
            messageOrdinal: 1,
            src: null,
            width: 10,
          },
        ],
      }),
      scope: "qa_pair",
      selectedText: "",
      sensitivity: "normal",
      ...origin,
    });

    expect(draft.messages.map((message) => message.externalMessageId)).toEqual([
      "m3",
      "m4",
    ]);
    expect(draft.completeness).toBe("complete");
    expect(draft.missingElements).toEqual([]);
  });

  it("keeps only scoped readable images as pending attachment references", () => {
    const draft = toChatGptCaptureDraft({
      extraction: extraction({
        images: [
          {
            alt: "result",
            height: 10,
            messageExternalId: "m4",
            messageOrdinal: 3,
            src: "https://images.example.test/result.png",
            width: 10,
          },
          {
            alt: "missing",
            height: 10,
            messageExternalId: "m4",
            messageOrdinal: 3,
            src: null,
            width: 10,
          },
        ],
      }),
      scope: "qa_pair",
      selectedText: "",
      sensitivity: "sensitive",
      ...origin,
    });

    expect(draft.pendingImages).toEqual([
      expect.objectContaining({
        messageOrdinal: 3,
        sourceUrl: "https://images.example.test/result.png",
      }),
    ]);
    expect(draft.completeness).toBe("partial");
    expect(draft.missingElements).toContain("第 4 条消息中的 1 张图片无法读取");
  });

  it("selection completeness ignores every image outside the selection", () => {
    const draft = toChatGptCaptureDraft({
      extraction: extraction({
        images: [
          {
            alt: "unrelated",
            height: null,
            messageExternalId: "m4",
            messageOrdinal: 3,
            src: null,
            width: null,
          },
        ],
        selectionMessageId: "m1",
        selectionText: "Question",
      }),
      scope: "selection",
      selectedText: "Question",
      sensitivity: "strictly_sensitive",
      ...origin,
    });

    expect(draft.completeness).toBe("complete");
    expect(draft.pendingImages).toEqual([]);
    expect(draft.originConversationRef).toBe("conversation-1");
    expect(draft.rawText).toBe("Question");
  });

  it("marks a scoped derived message id as partial", () => {
    const draft = toChatGptCaptureDraft({
      extraction: extraction({ derivedMessageOrdinals: [3] }),
      scope: "qa_pair",
      selectedText: "",
      sensitivity: "normal",
      ...origin,
    });

    expect(draft.completeness).toBe("partial");
    expect(draft.missingElements).toContain(
      "第 4 条消息缺少稳定标识，后续增量采集可能不准确",
    );
  });

  it("does not put oversized data URLs into storage.local metadata", () => {
    const draft = toChatGptCaptureDraft({
      extraction: extraction({
        images: [
          {
            alt: "inline",
            height: 10,
            messageExternalId: "m4",
            messageOrdinal: 3,
            src: `data:image/png;base64,${"a".repeat(10_001)}`,
            width: 10,
          },
        ],
      }),
      scope: "qa_pair",
      selectedText: "",
      sensitivity: "normal",
      ...origin,
    });

    expect(draft.pendingImages).toEqual([]);
    expect(draft.completeness).toBe("partial");
    expect(draft.missingElements).toContain("第 4 条消息中的 1 张图片无法读取");
  });
});
