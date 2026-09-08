import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { extractCurrentXiaohongshuPage } from "./extract";

function fixture(name: string) {
  const rootCandidate = resolve("tests/fixtures/xiaohongshu", name);
  const fixturePath = existsSync(rootCandidate)
    ? rootCandidate
    : resolve("../../tests/fixtures/xiaohongshu", name);
  return readFileSync(fixturePath, "utf8");
}

function fixtureDocument(name: string, url: string) {
  return new JSDOM(fixture(name), { url }).window.document;
}

describe("extractCurrentXiaohongshuPage", () => {
  it("extracts a complete sanitized note and ignores comments", () => {
    const result = extractCurrentXiaohongshuPage(
      fixtureDocument(
        "complete-note.html",
        "https://www.xiaohongshu.com/explore/65abc123",
      ),
      new URL("https://www.xiaohongshu.com/explore/65abc123"),
    );

    expect(result.title).toBe("合成标题");
    expect(result.author).toBe("合成作者");
    expect(result.canonicalUrl).toBe(
      "https://www.xiaohongshu.com/explore/65abc123",
    );
    expect(result.body).toContain("合成正文");
    expect(result.body).not.toContain("这是一条评论");
    expect(result.images).toHaveLength(3);
    expect(result.externalRef).toBe("65abc123");
    expect(result.hasVideo).toBe(false);
  });

  it("marks a video note with a missing image as partial-capable extraction", () => {
    const result = extractCurrentXiaohongshuPage(
      fixtureDocument(
        "partial-note.html",
        "https://www.xiaohongshu.com/explore/65abc123",
      ),
      new URL("https://www.xiaohongshu.com/explore/65abc123"),
    );

    expect(result.body).toContain("可读图片");
    expect(result.author).toBeNull();
    expect(result.hasVideo).toBe(true);
    expect(result.images.some((image) => image.src === null)).toBe(true);
    expect(result.declaredImageCount).toBe(2);
  });

  it("rejects a spoofed origin even if the document looks like a note", () => {
    expect(() =>
      extractCurrentXiaohongshuPage(
        fixtureDocument(
          "complete-note.html",
          "https://xiaohongshu.com.attacker.example/explore/65abc123",
        ),
        new URL("https://xiaohongshu.com.attacker.example/explore/65abc123"),
      ),
    ).toThrow(/不是可采集的小红书笔记|不受支持/);
  });

  it("returns an empty body when the note has no readable text", () => {
    const dom = new JSDOM(
      `<html><head><link rel="canonical" href="https://www.xiaohongshu.com/explore/65abc123" /></head><body><article></article></body></html>`,
      { url: "https://www.xiaohongshu.com/explore/65abc123" },
    );
    const result = extractCurrentXiaohongshuPage(
      dom.window.document,
      new URL("https://www.xiaohongshu.com/explore/65abc123"),
    );
    expect(result.body).toBe("");
    expect(result.externalRef).toBe("65abc123");
  });
});
