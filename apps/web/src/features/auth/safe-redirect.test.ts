import { describe, expect, it } from "vitest";

import { toSafeLocalPath } from "./safe-redirect";

describe("toSafeLocalPath", () => {
  it("preserves an internal application path", () => {
    expect(toSafeLocalPath("/captures?source=manual#latest")).toBe(
      "/captures?source=manual#latest",
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5c%5cevil.example",
    "%E0%A4%A",
  ])("rejects an unsafe redirect target: %s", (target) => {
    expect(toSafeLocalPath(target)).toBe("/");
  });
});
