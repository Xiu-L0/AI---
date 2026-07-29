import { NextResponse } from "next/server";

import { toSafeLocalPath } from "@/features/auth/safe-redirect";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appOrigin =
    process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:3000"
      : requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const next = toSafeLocalPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, appOrigin));
    }
  }

  return NextResponse.redirect(
    new URL("/sign-in?error=invalid_or_expired_link", appOrigin),
  );
}
