import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  extractChatGptConversation,
  selectChatGptScope,
  type ChatGptExtraction,
  UnsupportedChatGptScopeStateError,
} from "./extract";

function fixture(name: string) {
  const rootCandidate = resolve("tests/fixtures/chatgpt", name);
  const fixturePath = existsSync(rootCandidate)
    ? rootCandidate
    : resolve("../../tests/fixtures/chatgpt", name);
  return readFileSync(
    fixturePath,
    "utf8",
  );
}

function fixtureDocument(name: string) {
  return new JSDOM(fixture(name), {
    url: "https://chatgpt.com/c/synthetic-conversation",
  }).window.document;
}

const scopedExtraction: ChatGptExtraction = {
  derivedMessageOrdinals: [],
  duplicateMessageIds: [],
  emptyMessageOrdinals: [],
  externalRef: "synthetic-conversation",
  generatingResponse: false,
  images: [],
  messages: [
    { externalMessageId: "u1", role: "user", text: "first question", ordinal: 0 },
    { externalMessageId: "a1", role: "assistant", text: "first answer", ordinal: 1 },
    { externalMessageId: "u2", role: "user", text: "latest question", ordinal: 2 },
    { externalMessageId: "a2", role: "assistant", text: "selected synthetic answer", ordinal: 3 },
  ],
  selectionMessageId: null,
  selectionText: null,
  title: "Synthetic conversation",
  unsupportedRoles: [],
};

describe("extractChatGptConversation", () => {
  it("extracts ordered roles, stable ids, visible text, and image metadata", () => {
    const fixtureDom = fixtureDocument("complete-conversation.html");
    const result = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/synthetic-conversation"),
    );

    expect(result.externalRef).toBe("synthetic-conversation");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    expect(new Set(result.messages.map((message) => message.externalMessageId)).size).toBe(3);
    expect(result.messages[0]?.text).not.toContain("复制");
    expect(result.messages[1]?.text).not.toContain("隐藏反馈标签");
    expect(result.images).toEqual([
      expect.objectContaining({
        messageExternalId: "synthetic-a2",
        messageOrdinal: 2,
        src: "https://chatgpt.com/generated-fixture.png",
        width: 64,
        height: 64,
      }),
    ]);
  });

  it("binds a DOM selection to the containing stable message id", () => {
    const fixtureDom = fixtureDocument("complete-conversation.html");
    const answer = fixtureDom.querySelector(
      "[data-message-id='synthetic-a1'] div",
    )!;
    const range = fixtureDom.createRange();
    range.selectNodeContents(answer);
    const selection = fixtureDom.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const extraction = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/synthetic-conversation"),
    );
    const scoped = selectChatGptScope(
      extraction,
      "selection",
      "It is generated test content with no real user data.",
    );

    expect(extraction.selectionMessageId).toBe("synthetic-a1");
    expect(scoped.messages).toEqual([
      expect.objectContaining({
        externalMessageId: "synthetic-a1",
        role: "assistant",
        text: "It is generated test content with no real user data.",
      }),
    ]);
  });

  it("returns only the latest complete question and answer", () => {
    const scoped = selectChatGptScope(scopedExtraction, "qa_pair", "");
    expect(scoped.messages.map((message) => message.externalMessageId)).toEqual([
      "u2",
      "a2",
    ]);
    expect(scoped.rawText).toBe("latest question\n\nselected synthetic answer");
    expect(scoped.externalRef).toMatch(/^synthetic-conversation:qa_pair:/);
  });

  it("uses the latest image-only assistant answer instead of an older text answer", () => {
    const extraction: ChatGptExtraction = {
      ...scopedExtraction,
      images: [
        {
          alt: "synthetic result",
          height: 64,
          messageExternalId: "a3",
          messageOrdinal: 4,
          src: "https://example.test/result.png",
          width: 64,
        },
      ],
      messages: [
        ...scopedExtraction.messages,
        { externalMessageId: "a3", role: "assistant", text: "", ordinal: 4 },
      ],
    };

    const scoped = selectChatGptScope(extraction, "qa_pair", "");

    expect(scoped.messages.map((message) => message.externalMessageId)).toEqual([
      "u2",
      "a3",
    ]);
    expect(scoped.images).toHaveLength(1);
  });

  it("returns full raw text and keeps full-conversation identity stable", () => {
    const scoped = selectChatGptScope(scopedExtraction, "full_conversation", "");

    expect(scoped.rawText).toBe(
      "first question\n\nfirst answer\n\nlatest question\n\nselected synthetic answer",
    );
    expect(scoped.externalRef).toBe("synthetic-conversation");
  });

  it("rejects selection text that is not backed by a DOM range", () => {
    expect(() =>
      selectChatGptScope(
        scopedExtraction,
        "selection",
        "selected synthetic answer",
      ),
    ).toThrow(UnsupportedChatGptScopeStateError);
  });

  it("rejects a selection spanning more than one message", () => {
    const fixtureDom = fixtureDocument("complete-conversation.html");
    const first = fixtureDom.querySelector("[data-message-id='synthetic-u1'] div")!;
    const second = fixtureDom.querySelector("[data-message-id='synthetic-a1'] div")!;
    const range = fixtureDom.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(second.firstChild!, second.textContent?.length ?? 0);
    const selection = fixtureDom.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const extraction = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/synthetic-conversation"),
    );

    expect(extraction.selectionMessageId).toBeNull();
    expect(() =>
      selectChatGptScope(extraction, "selection", selection.toString()),
    ).toThrow(UnsupportedChatGptScopeStateError);
  });

  it("uses deterministic fallback ids and marks them as degraded", () => {
    const fixtureDom = new JSDOM(
      "<main><article data-message-author-role='user'>same synthetic text</article></main>",
    ).window.document;
    const first = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/fallback"),
    );
    const second = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/fallback"),
    );

    expect(first.messages[0]?.externalMessageId).toBe(
      second.messages[0]?.externalMessageId,
    );
    expect(first.derivedMessageOrdinals).toEqual([0]);
  });

  it("ignores hidden, nested, duplicate-id, and avatar-like message content", () => {
    const fixtureDom = new JSDOM(`
      <main>
        <article data-message-author-role="user" data-message-id="same">
          visible
          <article data-message-author-role="assistant" data-message-id="nested">nested</article>
          <img class="avatar" src="https://example.test/avatar.png" />
        </article>
        <article hidden data-message-author-role="assistant" data-message-id="hidden">hidden</article>
        <article data-message-author-role="assistant" data-message-id="same">answer</article>
      </main>
    `).window.document;
    const extraction = extractChatGptConversation(
      fixtureDom,
      new URL("https://chatgpt.com/c/filtering"),
    );

    expect(extraction.messages).toHaveLength(2);
    expect(extraction.messages.map((message) => message.externalMessageId)).toEqual([
      "same",
      expect.stringMatching(/^derived-assistant-1-/),
    ]);
    expect(extraction.derivedMessageOrdinals).toEqual([1]);
    expect(extraction.images).toEqual([]);
  });

  it("preserves paragraph, list, table, and code boundaries", () => {
    const dom = new JSDOM(`
      <main>
        <article data-message-author-role="assistant" data-message-id="structured">
          <p>First paragraph.</p><p>Second paragraph.</p>
          <ul><li>First item</li><li>Second item</li></ul>
          <table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>B</td></tr></table>
          <pre>const value = 1;\n  return value;</pre>
        </article>
      </main>
    `);
    const extraction = extractChatGptConversation(
      dom.window.document,
      new URL("https://chatgpt.com/c/structured"),
    );

    expect(extraction.messages[0]?.text).toContain("First paragraph.\n\nSecond paragraph.");
    expect(extraction.messages[0]?.text).toContain("- First item");
    expect(extraction.messages[0]?.text).toContain("Name\tValue");
    expect(extraction.messages[0]?.text).toContain("const value = 1;\n  return value;");
  });

  it("records unknown roles and ignores hidden generating controls", () => {
    const dom = new JSDOM(`
      <main>
        <article data-message-author-role="future-role" data-message-id="future">future</article>
        <button hidden data-testid="stop-button">stop</button>
      </main>
    `);
    const extraction = extractChatGptConversation(
      dom.window.document,
      new URL("https://chatgpt.com/c/future"),
    );

    expect(extraction.unsupportedRoles).toEqual(["future-role"]);
    expect(extraction.generatingResponse).toBe(false);
  });

  it("excludes CSS-hidden content and detects a visible generating control", () => {
    const dom = new JSDOM(`
      <style>.hidden-image { display: none; }</style>
      <main>
        <article data-message-author-role="assistant" data-message-id="visible">
          saved text
          <span style="display:none">not saved</span>
          <img class="hidden-image" src="https://example.test/hidden.png" />
        </article>
        <button data-testid="stop-button">stop</button>
      </main>
    `);
    const extraction = extractChatGptConversation(
      dom.window.document,
      new URL("https://chatgpt.com/c/generating"),
    );

    expect(extraction.messages[0]?.text).toBe("saved text");
    expect(extraction.images).toEqual([]);
    expect(extraction.generatingResponse).toBe(true);
  });
});
