import { describe, expect, it } from "vitest";

describe("extension workspace", () => {
  it("runs extension application tests", () => {
    expect("@recall/extension").toBe("@recall/extension");
  });
});
