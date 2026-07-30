import { defineConfig } from "wxt";

function apiHostPermission() {
  const origin = process.env.WXT_PUBLIC_API_ORIGIN ?? "http://localhost:3000";
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WXT_PUBLIC_API_ORIGIN must use HTTP or HTTPS");
  }
  return `${url.origin}/*`;
}

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Recall AI Capture",
    description:
      "Save selected conversations and pages to your private Recall AI library.",
    permissions: ["storage", "activeTab", "scripting", "notifications"],
    host_permissions: ["https://chatgpt.com/*", apiHostPermission()],
  },
});
