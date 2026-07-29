import { Buffer } from "node:buffer";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;
const PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export class PairingCodeInvalidError extends Error {
  constructor() {
    super("Pairing code is invalid, expired, or already used");
    this.name = "PairingCodeInvalidError";
  }
}

export class RequestAuthenticationError extends Error {
  constructor() {
    super("Request is not authenticated");
    this.name = "RequestAuthenticationError";
  }
}

export class PairingCodeCollisionError extends Error {
  constructor() {
    super("Pairing code collision");
    this.name = "PairingCodeCollisionError";
  }
}

type ActiveExtensionToken = {
  id: string;
  ownerUserId: string;
};

export interface PairingRepository {
  createPairingCode(input: {
    ownerUserId: string;
    codeHash: string;
    expiresAt: string;
  }): Promise<void>;
  exchangePairingCode(input: {
    codeHash: string;
    label: string;
    tokenHash: string;
    tokenExpiresAt: string;
  }): Promise<{ ownerUserId: string; expiresAt: string } | null>;
  findActiveExtensionToken(
    tokenHash: string,
    now: string,
  ): Promise<ActiveExtensionToken | null>;
  markExtensionTokenUsed(tokenId: string, usedAt: string): Promise<void>;
}

function getRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function createPairingCode() {
  const randomBytes = getRandomBytes(PAIRING_CODE_LENGTH);

  return Array.from(
    randomBytes,
    (value) => PAIRING_ALPHABET[value % PAIRING_ALPHABET.length],
  ).join("");
}

function createExtensionToken() {
  return Buffer.from(getRandomBytes(32)).toString("base64url");
}

export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function startPairingWithRepository(
  repository: PairingRepository,
  ownerUserId: string,
  now = new Date(),
) {
  const expiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS).toISOString();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = createPairingCode();

    try {
      await repository.createPairingCode({
        codeHash: await hashSecret(code),
        expiresAt,
        ownerUserId,
      });
      return { code, expiresAt };
    } catch (error) {
      if (!(error instanceof PairingCodeCollisionError)) {
        throw error;
      }
    }
  }

  throw new Error("Unable to allocate a unique pairing code");
}

export async function exchangePairingCodeWithRepository(
  repository: PairingRepository,
  code: string,
  label: string,
  now = new Date(),
) {
  const token = createExtensionToken();
  const tokenExpiresAt = new Date(
    now.getTime() + TOKEN_LIFETIME_MS,
  ).toISOString();
  const result = await repository.exchangePairingCode({
    codeHash: await hashSecret(code),
    label,
    tokenExpiresAt,
    tokenHash: await hashSecret(token),
  });

  if (!result) {
    throw new PairingCodeInvalidError();
  }

  return {
    expiresAt: result.expiresAt,
    token,
  };
}

export async function authenticateRequestWithRepository(
  repository: PairingRepository,
  request: Request,
  getWebUser: () => Promise<{ id: string } | null>,
  now = new Date(),
) {
  const authorization = request.headers.get("authorization");

  if (authorization !== null) {
    const match = authorization.match(/^Bearer ([^\s]+)$/i);
    if (!match?.[1]) {
      throw new RequestAuthenticationError();
    }

    const token = await repository.findActiveExtensionToken(
      await hashSecret(match[1]),
      now.toISOString(),
    );
    if (!token) {
      throw new RequestAuthenticationError();
    }

    await repository.markExtensionTokenUsed(token.id, now.toISOString());
    return {
      credential: "extension" as const,
      ownerUserId: token.ownerUserId,
    };
  }

  const user = await getWebUser();
  if (!user) {
    throw new RequestAuthenticationError();
  }

  return {
    credential: "web" as const,
    ownerUserId: user.id,
  };
}
