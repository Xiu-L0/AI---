import {
  StartCaptureInputSchema,
  StartCaptureResultSchema,
} from "@recall/contracts";
import { NextResponse } from "next/server";

import {
  CaptureStartError,
  startCapture,
} from "@/features/capture/server/start-capture";
import {
  authenticateRequest,
  RequestAuthenticationError,
} from "@/features/extension/server/pairing";

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_capture", fieldErrors: {} },
      { status: 400 },
    );
  }
  const parsed = StartCaptureInputSchema.safeParse(body);
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
    const result = await startCapture(
      authentication.ownerUserId,
      parsed.data,
    );
    return NextResponse.json(StartCaptureResultSchema.parse(result), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof CaptureStartError) {
      const status =
        error.code === "invalid_capture"
          ? 400
          : error.code === "signed_upload_failed"
            ? 503
            : 409;
      return NextResponse.json(
        {
          captureId: error.captureId,
          code: error.code,
          message: error.message,
        },
        { status },
      );
    }
    throw error;
  }
}
