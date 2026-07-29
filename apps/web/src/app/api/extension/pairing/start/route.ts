import { NextResponse } from "next/server";

import { startPairing } from "@/features/extension/server/pairing";
import { createServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json(
      { code: "authentication_required" },
      { status: 401 },
    );
  }

  const result = await startPairing(data.user.id);
  return NextResponse.json(result, { status: 201 });
}
