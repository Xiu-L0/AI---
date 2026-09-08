import { describe, expect, it } from "vitest";

import { parseXiaohongshuContentMessage } from "./content-message";

describe("Xiaohongshu content messages", () => {
  it("accepts only the dedicated extract request", () => {
    expect(parseXiaohongshuContentMessage({ type: "EXTRACT_XIAOHONGSHU" })).toEqual({
      ok: true,
      type: "EXTRACT_XIAOHONGSHU",
    });
    expect(parseXiaohongshuContentMessage({ type: "EXTRACT_CHATGPT" })).toEqual({
      ok: false,
      error: { code: "ignored", message: "unrelated message" },
    });
  });
});
