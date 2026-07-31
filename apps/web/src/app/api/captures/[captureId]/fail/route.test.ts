import type { ReportCaptureFailureInput } from "@recall/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaptureFailureConflictError,
  CaptureFailureNotFoundError,
} from "@/features/capture/server/report-capture-failure";
import { RequestAuthenticationError } from "@/features/extension/server/pairing";

const ownerUserId = "00000000-0000-0000-0000-000000000061";
const captureId = "20000000-0000-4000-8000-000000000061";
const input: ReportCaptureFailureInput = {
  failureCode: "upload_target_mismatch",
};
const failureReason =
  "Upload targets did not match the frozen attachment manifest";

const { authenticateRequest, reportCaptureFailure } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  reportCaptureFailure: vi.fn(),
}));

vi.mock("@/features/extension/server/pairing", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/extension/server/pairing")
  >();
  return { ...actual, authenticateRequest };
});

vi.mock(
  "@/features/capture/server/report-capture-failure",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/features/capture/server/report-capture-failure")
    >();
    return { ...actual, reportCaptureFailure };
  },
);

import { POST } from "./route";

function request(body: unknown = input) {
  return new Request(`http://localhost/api/captures/${captureId}/fail`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function context(id = captureId) {
  return { params: Promise.resolve({ captureId: id }) };
}

describe("POST /api/captures/:captureId/fail", () => {
  beforeEach(() => {
    authenticateRequest.mockReset();
    reportCaptureFailure.mockReset();
    authenticateRequest.mockResolvedValue({ ownerUserId });
    reportCaptureFailure.mockResolvedValue({
      captureId,
      captureStatus: "failed",
      failureReason,
    });
  });

  it("supports the shared Web or extension authentication boundary", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(authenticateRequest).toHaveBeenCalledOnce();
    expect(reportCaptureFailure).toHaveBeenCalledWith(
      ownerUserId,
      captureId,
      input,
    );
    await expect(response.json()).resolves.toEqual({
      captureId,
      captureStatus: "failed",
      failureReason,
    });
  });

  it("rejects unauthenticated requests", async () => {
    authenticateRequest.mockRejectedValue(new RequestAuthenticationError());

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "authentication_required",
    });
  });

  it("rejects invalid ids and bounded failure contracts", async () => {
    const invalidId = await POST(request(), context("not-a-capture-id"));
    const invalidBody = await POST(
      request({ failureCode: "signed-url:https://example.test" }),
      context(),
    );

    expect(invalidId.status).toBe(404);
    expect(invalidBody.status).toBe(400);
    expect(reportCaptureFailure).not.toHaveBeenCalled();
  });

  it("does not expose whether another owner session exists", async () => {
    reportCaptureFailure.mockRejectedValue(new CaptureFailureNotFoundError());

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: "capture_not_found" });
  });

  it("rejects finalized, already failed, resolved, or raced sessions", async () => {
    reportCaptureFailure.mockRejectedValue(new CaptureFailureConflictError());

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "capture_failure_conflict",
    });
  });
});
