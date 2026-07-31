import {
  ReportCaptureFailureInputSchema,
  ReportCaptureFailureResultSchema,
} from "@recall/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CaptureFailureConflictError,
  CaptureFailureNotFoundError,
  reportCaptureFailure,
} from "@/features/capture/server/report-capture-failure";
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
      { code: "invalid_capture_failure", fieldErrors: {} },
      { status: 400 },
    );
  }
  const parsed = ReportCaptureFailureInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "invalid_capture_failure",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await reportCaptureFailure(
      authentication.ownerUserId,
      captureId.data,
      parsed.data,
    );
    return NextResponse.json(ReportCaptureFailureResultSchema.parse(result));
  } catch (error) {
    if (error instanceof CaptureFailureNotFoundError) {
      return NextResponse.json({ code: "capture_not_found" }, { status: 404 });
    }
    if (error instanceof CaptureFailureConflictError) {
      return NextResponse.json(
        { code: "capture_failure_conflict" },
        { status: 409 },
      );
    }
    throw error;
  }
}
