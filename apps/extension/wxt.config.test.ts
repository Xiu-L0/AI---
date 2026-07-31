import { afterEach, describe, expect, it } from "vitest";

import { hostPermission, optionalTestHostPermission } from "./wxt.config";

const variableName = "WXT_TEST_SECURE_ORIGIN";
const testBuildName = "WXT_TEST_BUILD_FOR_CONFIG_TEST";

describe("extension host permissions", () => {
  afterEach(() => {
    delete process.env[variableName];
    delete process.env[testBuildName];
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

  it("omits the fixture host unless a test build explicitly sets it", () => {
    process.env[variableName] = "http://127.0.0.1:41739";
    expect(optionalTestHostPermission(variableName, testBuildName)).toEqual([]);
    process.env[testBuildName] = "1";
    expect(optionalTestHostPermission(variableName, testBuildName)).toEqual([
      "http://127.0.0.1:41739/*",
    ]);
  });

  it("rejects non-loopback hosts in a test build", () => {
    process.env[testBuildName] = "1";
    process.env[variableName] = "https://fixture.example.test";
    expect(() => optionalTestHostPermission(variableName, testBuildName)).toThrow(
      "exact loopback origin",
    );
  });

  it("requires an explicit fixture origin in a test build", () => {
    process.env[testBuildName] = "1";
    expect(() => optionalTestHostPermission(variableName, testBuildName)).toThrow(
      "is required",
    );
  });
});
