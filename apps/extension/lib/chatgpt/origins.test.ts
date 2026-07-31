import { describe, expect, it } from "vitest";

import {
  chatGptConversationRef,
  chatGptMatchPatterns,
  isSupportedChatGptUrl,
  testFixtureOrigin,
} from "./origins";

describe("ChatGPT origins", () => {
  it("uses only the production ChatGPT origin without a test build origin", () => {
    expect(chatGptMatchPatterns(undefined, false)).toEqual(["https://chatgpt.com/*"]);
    expect(isSupportedChatGptUrl("https://chatgpt.com/c/conversation", undefined, false)).toBe(true);
    expect(isSupportedChatGptUrl("http://127.0.0.1:41739/c/conversation", undefined, false)).toBe(false);
  });

  it("adds one exact fixture origin for a test build", () => {
    const fixture = "http://127.0.0.1:41739";
    expect(testFixtureOrigin(fixture, true)).toBe(fixture);
    expect(chatGptMatchPatterns(fixture, true)).toEqual([
      "https://chatgpt.com/*",
      `${fixture}/*`,
    ]);
    expect(isSupportedChatGptUrl(`${fixture}/c/synthetic`, fixture, true)).toBe(true);
    expect(chatGptConversationRef(`${fixture}/c/synthetic`, fixture, true)).toBe("synthetic");
  });

  it("ignores a fixture origin unless the explicit test-build gate is enabled", () => {
    const fixture = "http://127.0.0.1:41739";
    expect(testFixtureOrigin(fixture, false)).toBeNull();
    expect(chatGptMatchPatterns(fixture, false)).toEqual(["https://chatgpt.com/*"]);
  });

  it.each([
    "ftp://127.0.0.1",
    "http://127.0.0.1:41739/path",
    "http://user:password@127.0.0.1:41739",
    "https://fixture.example.test",
    "not a URL",
  ])("fails closed for malformed fixture origin %s", (fixture) => {
    expect(testFixtureOrigin(fixture, true)).toBeNull();
    expect(chatGptMatchPatterns(fixture, true)).toEqual(["https://chatgpt.com/*"]);
  });

  it("does not accept lookalike hosts", () => {
    expect(
      isSupportedChatGptUrl(
        "http://127.0.0.1.evil.test:41739/c/synthetic",
        "http://127.0.0.1:41739",
        true,
      ),
    ).toBe(false);
  });
});
