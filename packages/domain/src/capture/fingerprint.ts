import type { CapturedMessage, CaptureSource } from "@recall/contracts";

export interface FingerprintInput {
  source: CaptureSource;
  externalRef: string | null;
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
  const canonicalValue = {
    source: input.source,
    externalRef: input.externalRef,
    rawText: normalizeText(input.rawText),
    messages: [...input.messages]
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
      })),
    attachmentHashes: [...input.attachmentHashes].sort()
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return bytesToHex(new Uint8Array(digest));
}
