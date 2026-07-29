import { CaptureStatusResultSchema } from "@recall/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CaptureNotFoundError,
} from "@/features/capture/server/finalize-capture";
import {
  CapturePendingError,
  getCaptureStatus,
} from "@/features/capture/server/get-capture-status";
import {
  authenticateRequest,
  RequestAuthenticationError,
} from "@/features/extension/server/pairing";

type RouteContext = { params: Promise<{ captureId: string }> };

export async function GET(request: Request, context: RouteContext) {
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

  try {
    const result = await getCaptureStatus(
      authentication.ownerUserId,
      captureId.data,
    );
    return NextResponse.json(CaptureStatusResultSchema.parse(result));
  } catch (error) {
    if (error instanceof CaptureNotFoundError) {
      return NextResponse.json({ code: "capture_not_found" }, { status: 404 });
    }
    if (error instanceof CapturePendingError) {
      return NextResponse.json(
        { code: "capture_not_finalized" },
        { status: 409 },
      );
    }
    throw error;
  }
}
