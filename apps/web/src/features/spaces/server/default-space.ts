import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const OwnerUserIdSchema = z.uuid();
const SpaceIdSchema = z.uuid();

export interface DefaultSpaceGateway {
  resolvePrivateSpaceId(ownerUserId: string): Promise<unknown>;
}

export async function ensureDefaultPrivateSpaceWithGateway(
  gateway: DefaultSpaceGateway,
  ownerUserId: string,
): Promise<{ id: string; name: string }> {
  const ownerId = OwnerUserIdSchema.parse(ownerUserId);
  const spaceId = SpaceIdSchema.parse(
    await gateway.resolvePrivateSpaceId(ownerId),
  );

  return {
    id: spaceId,
    name: "我的知识库",
  };
}

export async function ensureDefaultPrivateSpace(
  ownerUserId: string,
): Promise<{ id: string; name: string }> {
  const admin = createAdminClient();

  return ensureDefaultPrivateSpaceWithGateway(
    {
      async resolvePrivateSpaceId(resolvedOwnerUserId) {
        const { data, error } = await admin.rpc("ensure_private_space", {
          p_owner_user_id: resolvedOwnerUserId,
        });
        if (error) {
          throw error;
        }
        return data;
      },
    },
    ownerUserId,
  );
}
