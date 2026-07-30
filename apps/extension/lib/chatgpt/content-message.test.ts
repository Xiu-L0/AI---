import { describe, expect, it } from "vitest";

import { extractCurrentChatGptPage } from "./content-message";

describe("ChatGPT content script extraction", () => {
  it("returns a typed unsupported-page error instead of partial unsavable data", () => {
    document.body.innerHTML = "<main></main>";

    expect(
      extractCurrentChatGptPage(
        document,
        new URL("https://chatgpt.com/"),
      ),
    ).toEqual({
      error: {
        code: "unsupported_page",
        message: "当前页面不是可采集的 ChatGPT 会话",
      },
      ok: false,
    });
  });

  it("returns only JSON-serializable extraction data", () => {
    document.body.innerHTML =
      "<main><article data-message-author-role='user' data-message-id='u1'>synthetic</article></main>";

    const response = extractCurrentChatGptPage(
      document,
      new URL("https://chatgpt.com/c/synthetic"),
    );

    expect(response.ok).toBe(true);
    expect(() => JSON.stringify(response)).not.toThrow();
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });

  it("rejects an empty conversation that cannot satisfy finalization", () => {
    document.body.innerHTML =
      "<main><article data-message-author-role='assistant' data-message-id='a1'></article></main>";

    expect(
      extractCurrentChatGptPage(
        document,
        new URL("https://chatgpt.com/c/empty-synthetic"),
      ),
    ).toEqual({
      error: {
        code: "unsupported_page",
        message: "当前页面不是可采集的 ChatGPT 会话",
      },
      ok: false,
    });
  });
});
