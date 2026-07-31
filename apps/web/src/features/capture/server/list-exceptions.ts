import "server-only";

import { cache } from "react";

import type { Database } from "@/lib/supabase/database.types";
import { createServerClient } from "@/lib/supabase/server";

import type {
  CaptureSourceRecord,
  CaptureVersionRecord,
} from "./list-captures";

type CaptureSource = Database["public"]["Enums"]["capture_source"];

export type FailedCaptureSessionRecord = {
  captureId: string;
  createdAt: string;
  externalRef: string | null;
  failureReason: string;
  source: CaptureSource;
  sourceItemId: string | null;
  title: string;
};

export type FailedProcessingJobRecord = {
  failureReason: string;
  sourceVersionId: string;
  updatedAt: string;
};

export interface CaptureExceptionRepository {
  listFailedCaptureSessions(
    ownerUserId: string,
  ): Promise<FailedCaptureSessionRecord[]>;
  listFailedProcessingJobs(
    ownerUserId: string,
  ): Promise<FailedProcessingJobRecord[]>;
  listSourceItems(ownerUserId: string): Promise<CaptureSourceRecord[]>;
  listVersions(ownerUserId: string): Promise<CaptureVersionRecord[]>;
}

export type PartialCaptureException = {
  createdAt: string;
  id: string;
  kind: "partial_capture";
  missingElements: string[];
  rawDataSafe: true;
  recovery:
    | "extension_screenshot"
    | "independent_manual_screenshot";
  source: CaptureSource;
  sourceItemId: string;
  title: string;
  version: number;
};

export type FailedCaptureException = {
  captureId: string;
  createdAt: string;
  externalRef: string | null;
  failureReason: string;
  id: string;
  kind: "failed_capture";
  rawDataSafe: false;
  source: CaptureSource;
  sourceItemId: string | null;
  title: string;
};

export type FailedProcessingException = {
  createdAt: string;
  failureReason: string;
  id: string;
  kind: "processing_failed";
  rawDataSafe: true;
  source: CaptureSource;
  sourceItemId: string;
  title: string;
  version: number;
};

export type CaptureException =
  | PartialCaptureException
  | FailedCaptureException
  | FailedProcessingException;

function latestVersionByItem(versions: CaptureVersionRecord[]) {
  const latest = new Map<string, CaptureVersionRecord>();
  for (const version of versions) {
    const previous = latest.get(version.sourceItemId);
    if (!previous || version.version > previous.version) {
      latest.set(version.sourceItemId, version);
    }
  }
  return latest;
}

export async function listExceptionsWithRepository(
  repository: CaptureExceptionRepository,
  ownerUserId: string,
): Promise<CaptureException[]> {
  const [sourceItems, versions, failedSessions, failedJobs] =
    await Promise.all([
      repository.listSourceItems(ownerUserId),
      repository.listVersions(ownerUserId),
      repository.listFailedCaptureSessions(ownerUserId),
      repository.listFailedProcessingJobs(ownerUserId),
    ]);
  const itemsById = new Map(sourceItems.map((item) => [item.id, item]));
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const latestVersions = latestVersionByItem(versions);

  const partials: PartialCaptureException[] = [];
  for (const [sourceItemId, version] of latestVersions) {
    const item = itemsById.get(sourceItemId);
    if (!item || version.captureStatus !== "partial") {
      continue;
    }
    partials.push({
      createdAt: version.createdAt,
      id: `partial:${version.id}`,
      kind: "partial_capture",
      missingElements: version.missingElements,
      rawDataSafe: true,
      recovery:
        item.source === "chatgpt_web"
          ? "extension_screenshot"
          : "independent_manual_screenshot",
      source: item.source,
      sourceItemId,
      title: item.title,
      version: version.version,
    });
  }

  const sessionFailures: FailedCaptureException[] = failedSessions.map(
    (session) => ({
      captureId: session.captureId,
      createdAt: session.createdAt,
      externalRef: session.externalRef,
      failureReason: session.failureReason,
      id: `capture:${session.captureId}`,
      kind: "failed_capture",
      rawDataSafe: false,
      source: session.source,
      sourceItemId: session.sourceItemId,
      title: session.title,
    }),
  );

  const processingFailures: FailedProcessingException[] = failedJobs.flatMap(
    (job): FailedProcessingException[] => {
      const version = versionsById.get(job.sourceVersionId);
      const item = version ? itemsById.get(version.sourceItemId) : undefined;
      if (!version || !item) {
        return [];
      }
      return [
        {
          createdAt: job.updatedAt,
          failureReason: job.failureReason,
          id: `processing:${job.sourceVersionId}`,
          kind: "processing_failed",
          rawDataSafe: true,
          source: item.source,
          sourceItemId: item.id,
          title: item.title,
          version: version.version,
        },
      ];
    },
  );

  return [...partials, ...sessionFailures, ...processingFailures].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function createCaptureExceptionRepository(): Promise<CaptureExceptionRepository> {
  const supabase = await createServerClient();

  return {
    async listFailedCaptureSessions(ownerUserId) {
      const { data, error } = await supabase
        .from("capture_sessions")
        .select(
          "id, source_item_id, source, title, external_ref, failure_reason, created_at",
        )
        .eq("owner_user_id", ownerUserId)
        .eq("status", "failed")
        .is("resolved_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map((row) => ({
        captureId: row.id,
        createdAt: row.created_at,
        externalRef: row.external_ref,
        failureReason: row.failure_reason ?? "采集未完成",
        source: row.source,
        sourceItemId: row.source_item_id,
        title: row.title,
      }));
    },
    async listFailedProcessingJobs(ownerUserId) {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("source_version_id, failure_reason, updated_at")
        .eq("owner_user_id", ownerUserId)
        .eq("status", "failed")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data.map((row) => ({
        failureReason: row.failure_reason ?? "后台处理失败",
        sourceVersionId: row.source_version_id,
        updatedAt: row.updated_at,
      }));
    },
    async listSourceItems(ownerUserId) {
      const { data, error } = await supabase
        .from("source_items")
        .select(
          "id, source, title, sensitivity, current_version, created_at, updated_at",
        )
        .eq("owner_user_id", ownerUserId)
        .is("deleted_at", null);
      if (error) throw error;
      return data.map((row) => ({
        createdAt: row.created_at,
        currentVersion: row.current_version,
        id: row.id,
        sensitivity: row.sensitivity,
        source: row.source,
        title: row.title,
        updatedAt: row.updated_at,
      }));
    },
    async listVersions(ownerUserId) {
      const { data, error } = await supabase
        .from("source_versions")
        .select(
          "id, source_item_id, version, capture_session_id, capture_status, missing_elements, raw_text, created_at",
        )
        .eq("owner_user_id", ownerUserId)
        .order("version", { ascending: false });
      if (error) throw error;
      return data.map((row) => ({
        captureSessionId: row.capture_session_id,
        captureStatus: row.capture_status,
        createdAt: row.created_at,
        id: row.id,
        missingElements: row.missing_elements,
        rawText: row.raw_text,
        sourceItemId: row.source_item_id,
        version: row.version,
      }));
    },
  };
}

const listExceptionsForRequest = cache(async (ownerUserId: string) => {
  return listExceptionsWithRepository(
    await createCaptureExceptionRepository(),
    ownerUserId,
  );
});

export async function listExceptions(ownerUserId: string) {
  return listExceptionsForRequest(ownerUserId);
}
