import type { FinalizeCaptureInput } from "@recall/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureExpiredError } from "@/features/capture/server/finalize-capture";

const ownerUserId = "00000000-0000-0000-0000-000000000001";
const captureId = "20000000-0000-4000-8000-000000000001";
const input: FinalizeCaptureInput = {
  completeness: "complete",
  idempotencyKey: "same-key-123",
  messages: [],
  missingElements: [],
  rawText: "saved text",
  uploadedAttachments: [],
};

const { authenticateRequest, finalizeCapture } = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  finalizeCapture: vi.fn(),
}));

vi.mock("@/features/extension/server/pairing", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/extension/server/pairing")
  >();
  return { ...actual, authenticateRequest };
});

vi.mock("@/features/capture/server/finalize-capture", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/capture/server/finalize-capture")
  >();
  return { ...actual, finalizeCapture };
});

import { POST } from "./route";

describe("POST /api/captures/:captureId/finalize", () => {
  beforeEach(() => {
    authenticateRequest.mockReset();
    finalizeCapture.mockReset();
    authenticateRequest.mockResolvedValue({ ownerUserId });
  });

  it("returns the retryable capture_session_expired code", async () => {
    finalizeCapture.mockRejectedValue(new CaptureExpiredError());

    const response = await POST(
      new Request(`http://localhost/api/captures/${captureId}/finalize`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ captureId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "capture_session_expired",
      message: "Capture session expired",
    });
  });
});
