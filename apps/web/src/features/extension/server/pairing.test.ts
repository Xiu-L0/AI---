import { describe, expect, it, vi } from "vitest";

import {
  authenticateRequestWithRepository,
  createPairingCode,
  exchangePairingCodeWithRepository,
  hashSecret,
  PairingCodeInvalidError,
  type PairingRepository,
  RequestAuthenticationError,
  startPairingWithRepository,
} from "./pairing-core";

function createRepository(
  overrides: Partial<PairingRepository> = {},
): PairingRepository {
  return {
    createPairingCode: vi.fn(),
    exchangePairingCode: vi.fn(),
    findActiveExtensionToken: vi.fn(async () => null),
    markExtensionTokenUsed: vi.fn(),
    ...overrides,
  };
}

describe("extension pairing", () => {
  it("creates an eight-character code without ambiguous characters", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(createPairingCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
      );
    }
  });

  it("hashes secrets deterministically without returning the secret", async () => {
    const first = await hashSecret("sample-secret");
    const second = await hashSecret("sample-secret");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("sample-secret");
  });

  it("stores only a pairing-code hash with a ten-minute expiry", async () => {
    const createPairingCodeRecord = vi.fn();
    const repository = createRepository({
      createPairingCode: createPairingCodeRecord,
    });

    const result = await startPairingWithRepository(
      repository,
      "owner-id",
      new Date("2026-07-29T18:00:00.000Z"),
    );

    expect(result.expiresAt).toBe("2026-07-29T18:10:00.000Z");
    expect(createPairingCodeRecord).toHaveBeenCalledWith({
      codeHash: await hashSecret(result.code),
      expiresAt: result.expiresAt,
      ownerUserId: "owner-id",
    });
    expect(
      JSON.stringify(createPairingCodeRecord.mock.calls[0]?.[0]),
    ).not.toContain(result.code);
  });

  it("returns a raw token once while the repository receives only its hash", async () => {
    const exchangePairingCodeRecord = vi.fn(async (input) => ({
      expiresAt: input.tokenExpiresAt,
      ownerUserId: "owner-id",
    }));
    const repository = createRepository({
      exchangePairingCode: exchangePairingCodeRecord,
    });

    const result = await exchangePairingCodeWithRepository(
      repository,
      "ABCD2345",
      "Edge",
      new Date("2026-07-29T18:00:00.000Z"),
    );

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toBe("2026-08-28T18:00:00.000Z");
    expect(exchangePairingCodeRecord).toHaveBeenCalledWith({
      codeHash: await hashSecret("ABCD2345"),
      label: "Edge",
      tokenExpiresAt: result.expiresAt,
      tokenHash: await hashSecret(result.token),
    });
  });

  it("rejects an invalid or already-used pairing code", async () => {
    await expect(
      exchangePairingCodeWithRepository(
        createRepository({
          exchangePairingCode: vi.fn(async () => null),
        }),
        "ABCD2345",
        "Edge",
      ),
    ).rejects.toBeInstanceOf(PairingCodeInvalidError);
  });

  it("authenticates a valid extension token and records its use", async () => {
    const markExtensionTokenUsed = vi.fn();
    const repository = createRepository({
      findActiveExtensionToken: vi.fn(async () => ({
        id: "token-id",
        ownerUserId: "owner-id",
      })),
      markExtensionTokenUsed,
    });

    await expect(
      authenticateRequestWithRepository(
        repository,
        new Request("https://recall.example/api", {
          headers: { Authorization: "Bearer extension-secret" },
        }),
        vi.fn(async () => ({ id: "web-owner" })),
        new Date("2026-07-29T18:00:00.000Z"),
      ),
    ).resolves.toEqual({
      credential: "extension",
      ownerUserId: "owner-id",
    });
    expect(markExtensionTokenUsed).toHaveBeenCalledWith(
      "token-id",
      "2026-07-29T18:00:00.000Z",
    );
  });

  it("does not fall back to Web auth for an invalid bearer token", async () => {
    const getWebUser = vi.fn(async () => ({ id: "web-owner" }));

    await expect(
      authenticateRequestWithRepository(
        createRepository(),
        new Request("https://recall.example/api", {
          headers: { Authorization: "Bearer invalid-token" },
        }),
        getWebUser,
      ),
    ).rejects.toBeInstanceOf(RequestAuthenticationError);
    expect(getWebUser).not.toHaveBeenCalled();
  });

  it("uses the Web session only when no authorization header exists", async () => {
    await expect(
      authenticateRequestWithRepository(
        createRepository(),
        new Request("https://recall.example/api"),
        vi.fn(async () => ({ id: "web-owner" })),
      ),
    ).resolves.toEqual({
      credential: "web",
      ownerUserId: "web-owner",
    });
  });
});
