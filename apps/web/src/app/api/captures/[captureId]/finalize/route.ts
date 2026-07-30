import {
  CaptureReceiptSchema,
  FinalizeCaptureInputSchema,
} from "@recall/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CaptureConflictError,
  CaptureExpiredError,
  CaptureNotFoundError,
  CaptureVerificationError,
  finalizeCapture,
} from "@/features/capture/server/finalize-capture";
import {
  authenticateRequest,
  RequestAuthenticationError,
} from "@/features/extension/server/pairing";

type RouteContext = { params: Promise<{ captureId: string }> };

export async function POST(request: Request, context: RouteContext) {
  let authentication: Awaited<ReturnType<typeof authenticateRequest>>;
  try {
    authentication = await authenticateRequest(request);
  } catch (error) {
    if (error instanceof RequestAuthenticationError) {
      return NextResponse.json(
        { code: "authentication_required" },
        { status: 401 },
      );
    }
    throw error;
  }

  const captureId = z.uuid().safeParse((await context.params).captureId);
  if (!captureId.success) {
    return NextResponse.json({ code: "capture_not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_capture", fieldErrors: {} },
      { status: 400 },
    );
  }
  const parsed = FinalizeCaptureInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "invalid_capture",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const receipt = await finalizeCapture(
      authentication.ownerUserId,
      captureId.data,
      parsed.data,
    );
    return NextResponse.json(CaptureReceiptSchema.parse(receipt));
  } catch (error) {
    if (error instanceof CaptureNotFoundError) {
      return NextResponse.json({ code: "capture_not_found" }, { status: 404 });
    }
    if (error instanceof CaptureExpiredError) {
      return NextResponse.json(
        { code: "capture_session_expired", message: error.message },
        { status: 409 },
      );
    }
    if (
      error instanceof CaptureConflictError ||
      error instanceof CaptureVerificationError
    ) {
      return NextResponse.json(
        { code: "capture_conflict", message: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}
