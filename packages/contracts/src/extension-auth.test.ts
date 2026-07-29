import { describe, expect, it } from "vitest";
import {
  ExchangePairingCodeInputSchema,
  ExtensionCredentialSchema,
  StartPairingResultSchema
} from "./extension-auth";

describe("extension auth contracts", () => {
  it("normalizes a valid pairing code", () => {
    const result = ExchangePairingCodeInputSchema.parse({
      code: "abcd2345",
      label: "  Edge on laptop  "
    });

    expect(result).toEqual({
      code: "ABCD2345",
      label: "Edge on laptop"
    });
  });

  it("rejects ambiguous characters in pairing codes", () => {
    expect(
      StartPairingResultSchema.safeParse({
        code: "ABCD10O2",
        expiresAt: "2026-07-29T18:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("requires an expiring nonempty credential", () => {
    expect(
      ExtensionCredentialSchema.safeParse({
        token: "",
        expiresAt: "not-a-date"
      }).success
    ).toBe(false);
  });
});
