import { defineConfig } from "wxt";

function usesSecureTransport(url: URL) {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  );
}

export function hostPermission(name: string, fallback: string) {
  const configured = process.env[name] ?? fallback;
  const url = new URL(configured);
  if (
    !usesSecureTransport(url) ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      `${name} must use HTTPS, except for local development`,
    );
  }
  return `${url.origin}/*`;
}

export function optionalTestHostPermission(
  name: string,
  testBuildName = "WXT_TEST_BUILD",
) {
  if (process.env[testBuildName] !== "1") return [];
  const configured = process.env[name];
  if (configured === undefined) {
    throw new Error(`${name} is required for a test extension build`);
  }
  const url = new URL(configured);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${name} must use an exact loopback origin`);
  }
  return [hostPermission(name, configured)];
}

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Recall AI Capture",
    description:
      "Save selected conversations and pages to your private Recall AI library.",
    permissions: [
      "storage",
      "unlimitedStorage",
      "activeTab",
      "scripting",
      "notifications",
      "alarms",
    ],
    host_permissions: [
      "https://chatgpt.com/*",
      hostPermission("WXT_PUBLIC_API_ORIGIN", "http://localhost:3000"),
      hostPermission("WXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321"),
      ...optionalTestHostPermission("WXT_TEST_FIXTURE_ORIGIN"),
    ],
  },
});
