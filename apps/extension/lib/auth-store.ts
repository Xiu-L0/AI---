import {
  ExtensionCredentialSchema,
  type ExtensionCredential,
} from "@recall/contracts";
import { browser } from "wxt/browser";

export const EXTENSION_CREDENTIAL_STORAGE_KEY =
  "recall.extension.credential.v1";
type LocalStorageArea = Pick<
  typeof browser.storage.local,
  "get" | "set" | "remove"
>;

export async function getExtensionCredential(
  storage: LocalStorageArea = browser.storage.local,
  now: Date = new Date(),
): Promise<ExtensionCredential | null> {
  const stored = await storage.get(EXTENSION_CREDENTIAL_STORAGE_KEY);
  const parsed = ExtensionCredentialSchema.safeParse(
    stored[EXTENSION_CREDENTIAL_STORAGE_KEY],
  );
  if (!parsed.success) {
    return null;
  }
  if (new Date(parsed.data.expiresAt).getTime() <= now.getTime()) {
    await storage.remove(EXTENSION_CREDENTIAL_STORAGE_KEY);
    return null;
  }
  return parsed.data;
}

export async function saveExtensionCredential(
  credential: ExtensionCredential,
  storage: LocalStorageArea = browser.storage.local,
): Promise<void> {
  await storage.set({
    [EXTENSION_CREDENTIAL_STORAGE_KEY]: ExtensionCredentialSchema.parse(
      credential,
    ),
  });
}

export async function clearExtensionCredential(
  storage: LocalStorageArea = browser.storage.local,
): Promise<void> {
  await storage.remove(EXTENSION_CREDENTIAL_STORAGE_KEY);
}
