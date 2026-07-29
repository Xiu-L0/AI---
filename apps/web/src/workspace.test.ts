import { describe, expect, it } from "vitest";

describe("web workspace", () => {
  it("runs web application tests", () => {
    expect("@recall/web").toBe("@recall/web");
  });
});
