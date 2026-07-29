import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs shared-package tests", () => {
    expect("recall-ai").toBe("recall-ai");
  });
});
