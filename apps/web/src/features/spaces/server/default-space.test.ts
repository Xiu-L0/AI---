import { describe, expect, it, vi } from "vitest";

import {
  ensureDefaultPrivateSpaceWithGateway,
  type DefaultSpaceGateway,
} from "./default-space";

const ownerA = "00000000-0000-4000-8000-0000000000aa";
const ownerB = "00000000-0000-4000-8000-0000000000bb";
const spaceA = "10000000-0000-4000-8000-0000000000aa";
const spaceB = "10000000-0000-4000-8000-0000000000bb";

describe("ensureDefaultPrivateSpaceWithGateway", () => {
  it("resolves a private space from the owner identity only", async () => {
    const gateway: DefaultSpaceGateway = {
      resolvePrivateSpaceId: vi.fn(async () => spaceA),
    };

    await expect(
      ensureDefaultPrivateSpaceWithGateway(gateway, ownerA),
    ).resolves.toEqual({
      id: spaceA,
      name: "我的知识库",
    });
    expect(gateway.resolvePrivateSpaceId).toHaveBeenCalledWith(ownerA);
  });

  it("does not reuse one owner result for another owner", async () => {
    const gateway: DefaultSpaceGateway = {
      resolvePrivateSpaceId: vi.fn(async (ownerUserId) =>
        ownerUserId === ownerA ? spaceA : spaceB,
      ),
    };

    const first = await ensureDefaultPrivateSpaceWithGateway(gateway, ownerA);
    const second = await ensureDefaultPrivateSpaceWithGateway(gateway, ownerB);

    expect(first.id).toBe(spaceA);
    expect(second.id).toBe(spaceB);
    expect(gateway.resolvePrivateSpaceId).toHaveBeenCalledTimes(2);
  });

  it("rejects a client-supplied space identifier or invalid owner id", async () => {
    const gateway: DefaultSpaceGateway = {
      resolvePrivateSpaceId: vi.fn(async () => "not-a-space-id"),
    };

    await expect(
      ensureDefaultPrivateSpaceWithGateway(gateway, "not-a-user"),
    ).rejects.toThrow();
    expect(gateway.resolvePrivateSpaceId).not.toHaveBeenCalled();

    await expect(
      ensureDefaultPrivateSpaceWithGateway(gateway, ownerA),
    ).rejects.toThrow();
  });
});
