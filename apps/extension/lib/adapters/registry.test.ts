import { describe, expect, it } from "vitest";

import { adapterForUrl } from "./registry";

describe("source adapter registry", () => {
  it("matches exact ChatGPT and Xiaohongshu origins and rejects look-alikes", () => {
    expect(adapterForUrl("https://chatgpt.com/c/abc")?.id).toBe("chatgpt");
    expect(adapterForUrl("https://www.xiaohongshu.com/explore/abc")?.id).toBe(
      "xiaohongshu",
    );
    expect(
      adapterForUrl("https://xiaohongshu.com.attacker.example/explore/abc"),
    ).toBeNull();
    expect(adapterForUrl("http://www.xiaohongshu.com/explore/abc")).toBeNull();
  });
});
