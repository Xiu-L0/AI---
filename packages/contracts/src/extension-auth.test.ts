import { describe, expect, it } from "vitest";
import {
  ExchangePairingCodeInputSchema,
  ExchangePairingCodeResultSchema,
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

  it("accepts a 32-byte base64url credential returned by exchange", () => {
    const token = "A".repeat(42) + "_";

    expect(
      ExchangePairingCodeResultSchema.parse({
        token,
        expiresAt: "2026-08-28T18:00:00.000Z"
      })
    ).toEqual({
      token,
      expiresAt: "2026-08-28T18:00:00.000Z"
    });
  });

  it("rejects credentials that are not 32-byte base64url tokens", () => {
    expect(
      ExtensionCredentialSchema.safeParse({
        token: "A".repeat(42) + "=",
        expiresAt: "2026-08-28T18:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
