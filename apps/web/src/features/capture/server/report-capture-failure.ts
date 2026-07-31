import "server-only";

import {
  ReportCaptureFailureResultSchema,
  type CaptureFailureCode,
  type ReportCaptureFailureInput,
  type ReportCaptureFailureResult,
} from "@recall/contracts";

import { createAdminClient } from "@/lib/supabase/admin";

export class CaptureFailureNotFoundError extends Error {
  constructor() {
    super("Capture session was not found");
    this.name = "CaptureFailureNotFoundError";
  }
}

export class CaptureFailureConflictError extends Error {
  constructor() {
    super("Capture session cannot be reported as failed");
    this.name = "CaptureFailureConflictError";
  }
}

type ReportFailureRepositoryResult =
  | { kind: "reported"; result: ReportCaptureFailureResult }
  | { kind: "not_found" }
  | { kind: "conflict" };

export interface ReportCaptureFailureRepository {
  reportFailure(input: {
    captureId: string;
    failureReason: string;
    ownerUserId: string;
  }): Promise<ReportFailureRepositoryResult>;
}

const FAILURE_REASON_BY_CODE: Record<CaptureFailureCode, string> = {
  attachment_manifest_conflict:
    "Attachment data no longer matches the frozen capture manifest",
  capture_already_failed: "The capture session was already reported as failed",
  capture_conflict: "Capture data conflicts with the server session",
  capture_failed: "The capture could not be completed safely",
  capture_id_conflict: "The server returned an unexpected capture session",
  capture_not_found: "The capture session is no longer available",
  idempotency_conflict: "The capture retry key conflicts with existing data",
  invalid_capture: "Capture data did not meet validation requirements",
  invalid_server_response: "The server returned an invalid capture response",
  storage_upload_failed: "An attachment could not be uploaded safely",
  upload_target_mismatch:
    "Upload targets did not match the frozen attachment manifest",
};

export async function reportCaptureFailureWithRepository(
  repository: ReportCaptureFailureRepository,
  args: {
    captureId: string;
    input: ReportCaptureFailureInput;
    ownerUserId: string;
  },
): Promise<ReportCaptureFailureResult> {
  const outcome = await repository.reportFailure({
    captureId: args.captureId,
    failureReason: FAILURE_REASON_BY_CODE[args.input.failureCode],
    ownerUserId: args.ownerUserId,
  });

  if (outcome.kind === "not_found") {
    throw new CaptureFailureNotFoundError();
  }
  if (outcome.kind === "conflict") {
    throw new CaptureFailureConflictError();
  }
  return ReportCaptureFailureResultSchema.parse(outcome.result);
}

function createReportCaptureFailureRepository(): ReportCaptureFailureRepository {
  const admin = createAdminClient();

  return {
    async reportFailure(input) {
      const { data, error } = await admin.rpc("report_capture_failure", {
        p_capture_id: input.captureId,
        p_failure_reason: input.failureReason,
        p_owner_user_id: input.ownerUserId,
      });
      if (error?.code === "P0002") {
        return { kind: "not_found" };
      }
      if (error?.code === "22023") {
        return { kind: "conflict" };
      }
      if (error) {
        throw error;
      }
      return {
        kind: "reported",
        result: ReportCaptureFailureResultSchema.parse(data),
      };
    },
  };
}

export async function reportCaptureFailure(
  ownerUserId: string,
  captureId: string,
  input: ReportCaptureFailureInput,
): Promise<ReportCaptureFailureResult> {
  return reportCaptureFailureWithRepository(
    createReportCaptureFailureRepository(),
    { captureId, input, ownerUserId },
  );
}
