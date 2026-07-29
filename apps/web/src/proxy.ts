import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Missing public Supabase configuration");
  }

  return { publishableKey, url };
}

export async function proxy(request: NextRequest) {
  const { publishableKey, url } = getPublicSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, options, value } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = typeof data?.claims.sub === "string";
  const isSignInRoute = request.nextUrl.pathname === "/sign-in";
  const isAuthCallback = request.nextUrl.pathname === "/auth/confirm";

  function redirectWithRefreshedCookies(pathname: string) {
    const redirectResponse = NextResponse.redirect(
      new URL(pathname, request.url),
    );

    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
  }

  if (!isAuthenticated && !isSignInRoute && !isAuthCallback) {
    return redirectWithRefreshedCookies("/sign-in");
  }

  if (isAuthenticated && isSignInRoute) {
    return redirectWithRefreshedCookies("/");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
