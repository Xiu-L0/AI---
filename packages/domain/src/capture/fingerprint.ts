import {
  resolveSourceIdentity,
  type CapturedMessage,
  type CaptureSource,
  type SourceKind,
  type SourcePlatform
} from "@recall/contracts";

export interface FingerprintInput {
  source?: CaptureSource;
  sourceKind?: SourceKind;
  sourcePlatform?: SourcePlatform;
  externalRef: string | null;
  metadata?: {
    author?: string | null;
    canonicalUrl?: string | null;
    capturedAt?: string;
    assets?: ReadonlyArray<{
      clientId: string;
      ordinal: number;
      alt?: string;
    }>;
  } | null;
  rawText: string;
  messages: readonly CapturedMessage[];
  attachmentHashes: readonly string[];
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export async function computeContentFingerprint(
  input: FingerprintInput
): Promise<string> {
  const identity = resolveSourceIdentity(input);
  const canonicalMessages = [...input.messages]
    .sort(
      (left, right) =>
        left.ordinal - right.ordinal ||
        left.externalMessageId.localeCompare(right.externalMessageId)
    )
    .map((message) => ({
      externalMessageId: message.externalMessageId,
      role: message.role,
      text: normalizeText(message.text),
      ordinal: message.ordinal
    }));
  const canonicalValue = {
    sourceKind: identity.sourceKind,
    sourcePlatform: identity.sourcePlatform,
    externalRef: input.externalRef,
    metadata: {
      author: input.metadata?.author ?? null,
      canonicalUrl: input.metadata?.canonicalUrl ?? null,
      assets: [...(input.metadata?.assets ?? [])].sort(
        (left, right) =>
          left.ordinal - right.ordinal ||
          left.clientId.localeCompare(right.clientId)
      )
    },
    rawText: normalizeText(input.rawText),
    messages: canonicalMessages,
    attachmentHashes: [...input.attachmentHashes].sort()
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return bytesToHex(new Uint8Array(digest));
}
