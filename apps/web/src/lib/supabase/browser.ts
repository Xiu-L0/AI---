import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing public Supabase configuration");
  }

  return { publishableKey, url };
}

export function createBrowserClient() {
  const { publishableKey, url } = getPublicSupabaseConfig();

  return createSupabaseBrowserClient<Database>(url, publishableKey);
}
