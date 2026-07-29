import {
  ExchangePairingCodeInputSchema,
  ExchangePairingCodeResultSchema,
} from "@recall/contracts";
import { NextResponse } from "next/server";

import {
  exchangePairingCode,
  PairingCodeInvalidError,
} from "@/features/extension/server/pairing";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_pairing_request" },
      { status: 400 },
    );
  }

  const parsed = ExchangePairingCodeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "invalid_pairing_request",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await exchangePairingCode(
      parsed.data.code,
      parsed.data.label,
    );
    return NextResponse.json(ExchangePairingCodeResultSchema.parse(result), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PairingCodeInvalidError) {
      return NextResponse.json(
        { code: "invalid_or_expired_pairing_code" },
        { status: 401 },
      );
    }

    throw error;
  }
}
