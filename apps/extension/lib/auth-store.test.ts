import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  clearExtensionCredential,
  getExtensionCredential,
  saveExtensionCredential,
} from "./auth-store";

const credential = {
  token: "a".repeat(43),
  expiresAt: "2026-08-28T00:00:00.000Z",
};

describe("auth store", () => {
  beforeEach(() => fakeBrowser.reset());

  it("stores the token only in extension local storage", async () => {
    await saveExtensionCredential(credential, fakeBrowser.storage.local);

    expect(
      await getExtensionCredential(
        fakeBrowser.storage.local,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toEqual(credential);
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});

    await clearExtensionCredential(fakeBrowser.storage.local);
    expect(await getExtensionCredential(fakeBrowser.storage.local)).toBeNull();
  });

  it("ignores malformed stored credentials", async () => {
    await fakeBrowser.storage.local.set({
      "recall.extension.credential.v1": { token: "short", expiresAt: "bad" },
    });

    expect(await getExtensionCredential(fakeBrowser.storage.local)).toBeNull();
  });

  it("clears an expired credential before returning it", async () => {
    await saveExtensionCredential(credential, fakeBrowser.storage.local);

    expect(
      await getExtensionCredential(
        fakeBrowser.storage.local,
        new Date("2026-08-29T00:00:00.000Z"),
      ),
    ).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });
});
