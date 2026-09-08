import { describe, expect, it } from "vitest";
import { computeContentFingerprint } from "./fingerprint";

describe("computeContentFingerprint", () => {
  it("normalizes all line endings and surrounding whitespace", async () => {
    const first = await computeContentFingerprint({
      source: "manual_text",
      externalRef: null,
      rawText: "  hello\r\nworld\rnext  ",
      messages: [],
      attachmentHashes: []
    });
    const second = await computeContentFingerprint({
      source: "manual_text",
      externalRef: null,
      rawText: "hello\nworld\nnext",
      messages: [],
      attachmentHashes: []
    });

    expect(first).toBe(second);
  });

  it("is independent of attachment hash order", async () => {
    const first = await computeContentFingerprint({
      source: "manual_file",
      externalRef: null,
      rawText: "",
      messages: [],
      attachmentHashes: ["b".repeat(64), "a".repeat(64)]
    });
    const second = await computeContentFingerprint({
      source: "manual_file",
      externalRef: null,
      rawText: "",
      messages: [],
      attachmentHashes: ["a".repeat(64), "b".repeat(64)]
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the source identity changes", async () => {
    const first = await computeContentFingerprint({
      source: "manual_text",
      externalRef: null,
      rawText: "same",
      messages: [],
      attachmentHashes: []
    });
    const second = await computeContentFingerprint({
      source: "chatgpt_web",
      externalRef: "conversation-1",
      rawText: "same",
      messages: [],
      attachmentHashes: []
    });

    expect(first).not.toBe(second);
  });

  it("changes when structured messages change", async () => {
    const base = {
      source: "chatgpt_web" as const,
      externalRef: "conversation-1",
      rawText: "",
      attachmentHashes: [] as const
    };
    const first = await computeContentFingerprint({
      ...base,
      messages: [
        {
          externalMessageId: "m1",
          role: "user",
          text: "first",
          ordinal: 0
        }
      ]
    });
    const second = await computeContentFingerprint({
      ...base,
      messages: [
        {
          externalMessageId: "m1",
          role: "user",
          text: "second",
          ordinal: 0
        }
      ]
    });

    expect(first).not.toBe(second);
  });

  it("maps legacy ChatGPT identity to the typed fingerprint", async () => {
    const messages = [
      {
        externalMessageId: "m1",
        role: "user" as const,
        text: "same question",
        ordinal: 0
      }
    ];
    const legacy = await computeContentFingerprint({
      source: "chatgpt_web",
      externalRef: "conversation-1",
      rawText: "same",
      messages,
      attachmentHashes: []
    });
    const typed = await computeContentFingerprint({
      sourceKind: "ai_conversation",
      sourcePlatform: "chatgpt",
      externalRef: "conversation-1",
      rawText: "same",
      messages,
      attachmentHashes: []
    });

    expect(legacy).toBe(typed);
  });

  it("ignores capturedAt and canonicalizes asset metadata", async () => {
    const first = await computeContentFingerprint({
      sourceKind: "social_post",
      sourcePlatform: "xiaohongshu",
      externalRef: "note-123",
      metadata: {
        author: "合成作者",
        canonicalUrl: "https://www.xiaohongshu.com/explore/note-123",
        capturedAt: "2026-09-08T01:00:00.000Z",
        assets: [
          { clientId: "img-b", ordinal: 1, alt: "second" },
          { clientId: "img-a", ordinal: 0, alt: "first" }
        ]
      },
      rawText: "合成正文",
      messages: [],
      attachmentHashes: ["b".repeat(64), "a".repeat(64)]
    });
    const second = await computeContentFingerprint({
      sourceKind: "social_post",
      sourcePlatform: "xiaohongshu",
      externalRef: "note-123",
      metadata: {
        author: "合成作者",
        canonicalUrl: "https://www.xiaohongshu.com/explore/note-123",
        capturedAt: "2026-09-08T02:00:00.000Z",
        assets: [
          { clientId: "img-a", ordinal: 0, alt: "first" },
          { clientId: "img-b", ordinal: 1, alt: "second" }
        ]
      },
      rawText: "合成正文",
      messages: [],
      attachmentHashes: ["a".repeat(64), "b".repeat(64)]
    });

    expect(first).toBe(second);
  });
});
