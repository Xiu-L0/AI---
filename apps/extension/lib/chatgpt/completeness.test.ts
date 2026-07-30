import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { assessChatGptCompleteness } from "./completeness";
import { extractChatGptConversation } from "./extract";

function extractFixture(name: string) {
  const rootCandidate = resolve("tests/fixtures/chatgpt", name);
  const fixturePath = existsSync(rootCandidate)
    ? rootCandidate
    : resolve("../../tests/fixtures/chatgpt", name);
  const html = readFileSync(
    fixturePath,
    "utf8",
  );
  const fixtureDocument = new JSDOM(html, {
    url: "https://chatgpt.com/c/synthetic-conversation",
  }).window.document;
  return extractChatGptConversation(
    fixtureDocument,
    new URL("https://chatgpt.com/c/synthetic-conversation"),
  );
}

describe("assessChatGptCompleteness", () => {
  it("reports the complete fixture as complete", () => {
    expect(
      assessChatGptCompleteness(extractFixture("complete-conversation.html")),
    ).toEqual({ completeness: "complete", missingElements: [] });
  });

  it("reports the exact missing image and retains usable content", () => {
    expect(
      assessChatGptCompleteness(
        extractFixture("conversation-with-missing-image.html"),
      ),
    ).toEqual({
      completeness: "partial",
      missingElements: ["第 3 条消息中的 1 张图片无法读取"],
    });
  });

  it("reports missing identity, messages, and a generating response", () => {
    const fixtureDocument = new JSDOM(
      "<main><button data-testid='stop-button'>stop</button></main>",
    ).window.document;
    const extraction = extractChatGptConversation(
      fixtureDocument,
      new URL("https://chatgpt.com/"),
    );

    expect(assessChatGptCompleteness(extraction)).toEqual({
      completeness: "partial",
      missingElements: [
        "无法识别 ChatGPT 会话标识",
        "未找到可采集的 ChatGPT 消息",
        "页面仍在生成回答",
      ],
    });
  });

  it("reports degraded ids, duplicate ids, and unsupported roles", () => {
    const fixtureDocument = new JSDOM(`
      <main>
        <article data-message-author-role="user" data-message-id="same">question</article>
        <article data-message-author-role="assistant" data-message-id="same">answer</article>
        <article data-message-author-role="future-role" data-message-id="future">future</article>
      </main>
    `).window.document;
    const extraction = extractChatGptConversation(
      fixtureDocument,
      new URL("https://chatgpt.com/c/degraded"),
    );

    expect(assessChatGptCompleteness(extraction)).toEqual({
      completeness: "partial",
      missingElements: [
        "第 2 条消息缺少稳定标识，后续增量采集可能不准确",
        "页面包含重复消息标识 same，已降级为安全的临时标识",
        "发现暂不支持的消息角色 future-role",
      ],
    });
  });
});
