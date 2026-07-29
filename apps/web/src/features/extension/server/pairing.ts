import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import {
  authenticateRequestWithRepository,
  exchangePairingCodeWithRepository,
  PairingCodeCollisionError,
  type PairingRepository,
  startPairingWithRepository,
} from "./pairing-core";

export {
  createPairingCode,
  hashSecret,
  PairingCodeInvalidError,
  RequestAuthenticationError,
} from "./pairing-core";

export type ExtensionTokenSummary = {
  id: string;
  label: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const ExchangePairingRpcResultSchema = z.object({
  ownerUserId: z.string().uuid(),
  tokenExpiresAt: z.iso.datetime({ offset: true }),
});

function createPairingRepository(): PairingRepository {
  const admin = createAdminClient();

  return {
    async createPairingCode(input) {
      const { error } = await admin.from("extension_pairing_codes").insert({
        code_hash: input.codeHash,
        expires_at: input.expiresAt,
        owner_user_id: input.ownerUserId,
      });

      if (error?.code === "23505") {
        throw new PairingCodeCollisionError();
      }
      if (error) {
        throw error;
      }
    },
    async exchangePairingCode(input) {
      const { data, error } = await admin.rpc(
        "exchange_extension_pairing_code",
        {
          p_code_hash: input.codeHash,
          p_label: input.label,
          p_token_expires_at: input.tokenExpiresAt,
          p_token_hash: input.tokenHash,
        },
      );

      if (error?.code === "P0002") {
        return null;
      }
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }
      const result = ExchangePairingRpcResultSchema.parse(data);

      return {
        expiresAt: result.tokenExpiresAt,
        ownerUserId: result.ownerUserId,
      };
    },
    async findActiveExtensionToken(tokenHash, now) {
      const { data, error } = await admin
        .from("extension_tokens")
        .select("id, owner_user_id")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", now)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data
        ? { id: data.id, ownerUserId: data.owner_user_id }
        : null;
    },
    async markExtensionTokenUsed(tokenId, usedAt) {
      const { error } = await admin
        .from("extension_tokens")
        .update({ last_used_at: usedAt })
        .eq("id", tokenId);

      if (error) {
        throw error;
      }
    },
  };
}

export async function startPairing(ownerUserId: string) {
  return startPairingWithRepository(createPairingRepository(), ownerUserId);
}

export async function exchangePairingCode(code: string, label: string) {
  return exchangePairingCodeWithRepository(
    createPairingRepository(),
    code,
    label,
  );
}

export async function authenticateRequest(request: Request) {
  const supabase = await createServerClient();

  return authenticateRequestWithRepository(
    createPairingRepository(),
    request,
    async () => {
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
  );
}

export async function listExtensionTokens(ownerUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("extension_tokens")
    .select("id, label, expires_at, last_used_at, revoked_at")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data.map(
    (token): ExtensionTokenSummary => ({
      expiresAt: token.expires_at,
      id: token.id,
      label: token.label,
      lastUsedAt: token.last_used_at,
      revokedAt: token.revoked_at,
    }),
  );
}

export async function revokeExtensionToken(
  ownerUserId: string,
  tokenId: string,
  now = new Date(),
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("extension_tokens")
    .update({ revoked_at: now.toISOString() })
    .eq("id", tokenId)
    .eq("owner_user_id", ownerUserId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data !== null;
}
