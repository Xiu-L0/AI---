import {
  ExtensionCredentialSchema,
  type ExtensionCredential,
} from "@recall/contracts";
import { browser } from "wxt/browser";

const CREDENTIAL_KEY = "recall.extension.credential.v1";
type LocalStorageArea = Pick<
  typeof browser.storage.local,
  "get" | "set" | "remove"
>;

export async function getExtensionCredential(
  storage: LocalStorageArea = browser.storage.local,
  now: Date = new Date(),
): Promise<ExtensionCredential | null> {
  const stored = await storage.get(CREDENTIAL_KEY);
  const parsed = ExtensionCredentialSchema.safeParse(stored[CREDENTIAL_KEY]);
  if (!parsed.success) {
    return null;
  }
  if (new Date(parsed.data.expiresAt).getTime() <= now.getTime()) {
    await storage.remove(CREDENTIAL_KEY);
    return null;
  }
  return parsed.data;
}

export async function saveExtensionCredential(
  credential: ExtensionCredential,
  storage: LocalStorageArea = browser.storage.local,
): Promise<void> {
  await storage.set({
    [CREDENTIAL_KEY]: ExtensionCredentialSchema.parse(credential),
  });
}

export async function clearExtensionCredential(
  storage: LocalStorageArea = browser.storage.local,
): Promise<void> {
  await storage.remove(CREDENTIAL_KEY);
}
