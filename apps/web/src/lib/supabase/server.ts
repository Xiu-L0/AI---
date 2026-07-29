import "server-only";

import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { Database } from "./database.types";

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing public Supabase configuration");
  }

  return { publishableKey, url };
}

export async function createServerClient() {
  const cookieStore = await cookies();
  const { publishableKey, url } = getPublicSupabaseConfig();

  return createSupabaseServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, options, value } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write response cookies. The proxy refreshes
          // sessions before protected pages render.
        }
      },
    },
  });
}

export async function requireUser() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || data.user == null) {
    redirect("/sign-in");
  }

  return {
    email: data.user.email ?? null,
    id: data.user.id,
  };
}
