import { describe, expect, it } from "vitest";

import {
  isAllowedXiaohongshuImageUrl,
  isSupportedXiaohongshuUrl,
  xiaohongshuCanonicalUrl,
  xiaohongshuMatchPatterns,
  xiaohongshuNoteId,
} from "./origins";

describe("Xiaohongshu origins", () => {
  it("accepts only HTTPS www.xiaohongshu.com note routes", () => {
    expect(
      xiaohongshuNoteId("https://www.xiaohongshu.com/explore/65abc123"),
    ).toBe("65abc123");
    expect(
      xiaohongshuNoteId("https://www.xiaohongshu.com/discovery/item/65abc123"),
    ).toBe("65abc123");
    expect(
      xiaohongshuCanonicalUrl(
        "https://www.xiaohongshu.com/explore/65abc123?xsec_token=synthetic",
      ),
    ).toBe("https://www.xiaohongshu.com/explore/65abc123");
    expect(xiaohongshuMatchPatterns(undefined, false)).toEqual([
      "https://www.xiaohongshu.com/*",
    ]);
  });

  it("rejects look-alikes, http, and query-only ids", () => {
    expect(
      isSupportedXiaohongshuUrl(
        "https://xiaohongshu.com.attacker.example/explore/65abc123",
      ),
    ).toBe(false);
    expect(
      xiaohongshuNoteId("http://www.xiaohongshu.com/explore/65abc123"),
    ).toBeNull();
    expect(
      xiaohongshuNoteId("https://www.xiaohongshu.com/explore?id=65abc123"),
    ).toBeNull();
    expect(
      xiaohongshuNoteId("https://xiaohongshu.com/explore/65abc123"),
    ).toBeNull();
  });

  it("allows HTTPS CDN images and test-fixture loopback images only", () => {
    expect(
      isAllowedXiaohongshuImageUrl(
        "https://sns-webpic-qc.xhscdn.com/a.png",
      ),
    ).toBe(true);
    expect(
      isAllowedXiaohongshuImageUrl("https://xhscdn.com.attacker.example/a.png"),
    ).toBe(false);
    expect(
      isAllowedXiaohongshuImageUrl("https://images.example.test/a.png"),
    ).toBe(false);
    expect(isAllowedXiaohongshuImageUrl("https://xhscdn.com/a.png")).toBe(false);
    expect(
      isAllowedXiaohongshuImageUrl("http://127.0.0.1:41739/a.png"),
    ).toBe(false);
    expect(
      isAllowedXiaohongshuImageUrl(
        "http://127.0.0.1:41739/a.png",
        "http://127.0.0.1:41739",
        true,
      ),
    ).toBe(true);
    expect(
      isAllowedXiaohongshuImageUrl(
        "http://127.0.0.1:9999/a.png",
        "http://127.0.0.1:41739",
        true,
      ),
    ).toBe(false);
  });
});
