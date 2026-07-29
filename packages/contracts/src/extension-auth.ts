import { z } from "zod";

export const ExtensionPairingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

export const StartPairingResultSchema = z.object({
  code: ExtensionPairingCodeSchema,
  expiresAt: z.iso.datetime({ offset: true })
});

export const ExchangePairingCodeInputSchema = z.object({
  code: ExtensionPairingCodeSchema,
  label: z.string().trim().min(1).max(100)
});

export const ExtensionCredentialSchema = z.object({
  token: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{43}$/,
      "extension token must be 32 random bytes encoded as base64url"
    ),
  expiresAt: z.iso.datetime({ offset: true })
});

export const ExchangePairingCodeResultSchema = ExtensionCredentialSchema;

export type ExtensionPairingCode = z.infer<
  typeof ExtensionPairingCodeSchema
>;
export type StartPairingResult = z.infer<typeof StartPairingResultSchema>;
export type ExchangePairingCodeInput = z.infer<
  typeof ExchangePairingCodeInputSchema
>;
export type ExtensionCredential = z.infer<typeof ExtensionCredentialSchema>;
export type ExchangePairingCodeResult = z.infer<
  typeof ExchangePairingCodeResultSchema
>;
