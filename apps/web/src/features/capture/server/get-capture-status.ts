import "server-only";

import {
  CaptureStatusResultSchema,
  type CaptureStatusResult,
} from "@recall/contracts";

import { createAdminClient } from "@/lib/supabase/admin";

import { CaptureNotFoundError } from "./finalize-capture";

export class CapturePendingError extends Error {
  constructor() {
    super("Capture session has not been finalized");
    this.name = "CapturePendingError";
  }
}

export async function getCaptureStatus(
  ownerUserId: string,
  captureId: string,
  now = new Date(),
  allowExpiryTransition = true,
): Promise<CaptureStatusResult> {
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("capture_sessions")
    .select(
      "id, status, failure_reason, source_item_id, result_source_version_id, expires_at",
    )
    .eq("id", captureId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (sessionError) {
    throw sessionError;
  }
  if (!session) {
    throw new CaptureNotFoundError();
  }
  if (
    session.status === "awaiting_upload" &&
    new Date(session.expires_at).getTime() <= now.getTime()
  ) {
    const { data: failedSession, error: failureError } = await admin
      .from("capture_sessions")
      .update({
        failure_reason: "capture session expired",
        status: "failed",
      })
      .eq("id", captureId)
      .eq("owner_user_id", ownerUserId)
      .eq("status", "awaiting_upload")
      .lte("expires_at", now.toISOString())
      .select("id")
      .maybeSingle();
    if (failureError) {
      throw failureError;
    }
    if (!failedSession && allowExpiryTransition) {
      return getCaptureStatus(ownerUserId, captureId, now, false);
    }
    if (failedSession) {
      return CaptureStatusResultSchema.parse({
        captureId: session.id,
        sourceItemId: null,
        captureStatus: "failed",
        processingStatus: "paused",
        savedMessageCount: 0,
        savedAttachmentCount: 0,
        missingElements: [],
        failureReason: "capture session expired",
      });
    }
  }
  if (session.status === "failed") {
    return CaptureStatusResultSchema.parse({
      captureId: session.id,
      sourceItemId: null,
      captureStatus: "failed",
      processingStatus: "paused",
      savedMessageCount: 0,
      savedAttachmentCount: 0,
      missingElements: [],
      failureReason: session.failure_reason ?? "capture failed",
    });
  }
  if (session.status !== "finalized" || !session.source_item_id) {
    throw new CapturePendingError();
  }

  let versionQuery = admin
    .from("source_versions")
    .select("id, capture_status, missing_elements")
    .eq("owner_user_id", ownerUserId);
  versionQuery = session.result_source_version_id
    ? versionQuery.eq("id", session.result_source_version_id)
    : versionQuery.eq("capture_session_id", captureId);
  const { data: version, error: versionError } = await versionQuery.single();
  if (versionError) {
    throw versionError;
  }

  const [
    { count: savedMessageCount, error: messageError },
    { count: savedAttachmentCount, error: attachmentError },
    { data: job, error: jobError },
  ] = await Promise.all([
    admin
      .from("source_messages")
      .select("id", { count: "exact", head: true })
      .eq("source_version_id", version.id)
      .eq("owner_user_id", ownerUserId),
    admin
      .from("source_attachments")
      .select("id", { count: "exact", head: true })
      .eq("source_version_id", version.id)
      .eq("owner_user_id", ownerUserId),
    admin
      .from("processing_jobs")
      .select("status, failure_reason")
      .eq("source_version_id", version.id)
      .eq("owner_user_id", ownerUserId)
      .single(),
  ]);
  if (messageError || attachmentError || jobError) {
    throw messageError ?? attachmentError ?? jobError;
  }

  return CaptureStatusResultSchema.parse({
    captureId: session.id,
    sourceItemId: session.source_item_id,
    captureStatus: version.capture_status,
    processingStatus: job.status,
    savedMessageCount: savedMessageCount ?? 0,
    savedAttachmentCount: savedAttachmentCount ?? 0,
    missingElements: version.missing_elements,
    failureReason: null,
  });
}
