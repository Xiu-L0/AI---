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
});
