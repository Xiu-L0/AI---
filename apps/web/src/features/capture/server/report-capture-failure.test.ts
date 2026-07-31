import type {
  ReportCaptureFailureInput,
  ReportCaptureFailureResult,
} from "@recall/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CaptureFailureConflictError,
  CaptureFailureNotFoundError,
  reportCaptureFailureWithRepository,
  type ReportCaptureFailureRepository,
} from "./report-capture-failure";

const ownerUserId = "00000000-0000-0000-0000-000000000061";
const captureId = "20000000-0000-4000-8000-000000000061";
const input: ReportCaptureFailureInput = {
  failureCode: "upload_target_mismatch",
};
const result: ReportCaptureFailureResult = {
  captureId,
  captureStatus: "failed",
  failureReason: "Upload targets did not match the frozen attachment manifest",
};

function repository(
  outcome: Awaited<ReturnType<ReportCaptureFailureRepository["reportFailure"]>>,
) {
  return {
    reportFailure: vi.fn(async () => outcome),
  } satisfies ReportCaptureFailureRepository;
}

describe("reportCaptureFailureWithRepository", () => {
  it("reports only the owner, capture id, and bounded safe reason", async () => {
    const repo = repository({ kind: "reported", result });

    await expect(
      reportCaptureFailureWithRepository(repo, {
        captureId,
        input,
        ownerUserId,
      }),
    ).resolves.toEqual(result);

    expect(repo.reportFailure).toHaveBeenCalledWith({
      captureId,
      failureReason: result.failureReason,
      ownerUserId,
    });
    expect(JSON.stringify(repo.reportFailure.mock.calls)).not.toContain(
      "upload_target_mismatch",
    );
  });

  it("hides missing and other-owner sessions behind not found", async () => {
    const repo = repository({ kind: "not_found" });

    await expect(
      reportCaptureFailureWithRepository(repo, {
        captureId,
        input,
        ownerUserId,
      }),
    ).rejects.toBeInstanceOf(CaptureFailureNotFoundError);
  });

  it("rejects finalized, failed, resolved, or concurrently changed sessions", async () => {
    const repo = repository({ kind: "conflict" });

    await expect(
      reportCaptureFailureWithRepository(repo, {
        captureId,
        input,
        ownerUserId,
      }),
    ).rejects.toBeInstanceOf(CaptureFailureConflictError);
  });

  it("rejects malformed repository output instead of inventing failure state", async () => {
    const repo = repository({
      kind: "reported",
      result: {
        ...result,
        captureStatus: "complete",
      } as unknown as ReportCaptureFailureResult,
    });

    await expect(
      reportCaptureFailureWithRepository(repo, {
        captureId,
        input,
        ownerUserId,
      }),
    ).rejects.toThrow();
  });
});
