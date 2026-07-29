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
  token: z.string().min(32).max(512),
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
