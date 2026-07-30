import { afterEach, describe, expect, it } from "vitest";

import { hostPermission } from "./wxt.config";

const variableName = "WXT_TEST_SECURE_ORIGIN";

describe("extension host permissions", () => {
  afterEach(() => {
    delete process.env[variableName];
  });

  it("rejects plaintext remote production origins", () => {
    process.env[variableName] = "http://recall.example.test";

    expect(() => hostPermission(variableName, "https://fallback.test")).toThrow(
      "must use HTTPS",
    );
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:54321",
    "http://[::1]:3000",
    "https://recall.example.test",
  ])("accepts secure or explicitly local origin %s", (origin) => {
    process.env[variableName] = origin;

    expect(hostPermission(variableName, "https://fallback.test")).toBe(
      `${origin}/*`,
    );
  });
});
