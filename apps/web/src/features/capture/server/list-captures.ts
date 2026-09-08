import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { createServerClient } from "@/lib/supabase/server";

type CaptureSource = Database["public"]["Enums"]["capture_source"];
type CaptureStatus = Database["public"]["Enums"]["capture_completeness"];
type ProcessingStatus = Database["public"]["Enums"]["processing_state"];
type Sensitivity = Database["public"]["Enums"]["sensitivity_level"];

const RAW_CAPTURE_BUCKET = "raw-captures";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidCaptureSourceItemId(value: string) {
  return UUID_PATTERN.test(value);
}

export type CaptureCursor = {
  sourceItemId: string;
  updatedAt: string;
};

export type CaptureSourceRecord = {
  createdAt: string;
  currentVersion: number;
  id: string;
  sensitivity: Sensitivity;
  source: CaptureSource | null;
  title: string;
  updatedAt: string;
};

export type CaptureVersionRecord = {
  captureSessionId: string;
  captureStatus: CaptureStatus;
  createdAt: string;
  id: string;
  missingElements: string[];
  rawText: string;
  sourceItemId: string;
  version: number;
};

export type CaptureMessageRecord = {
  body: string;
  externalMessageId: string;
  id: string;
  ordinal: number;
  role: string;
  sourceVersionId: string;
};

export type CaptureAttachmentRecord = {
  byteSize: number;
  clientId: string;
  fileName: string;
  id: string;
  mimeType: string;
  sha256: string;
  sourceVersionId: string;
  storagePath: string;
};

export type CaptureProcessingRecord = {
  failureReason: string | null;
  sourceVersionId: string;
  status: ProcessingStatus;
};

export interface CaptureHistoryRepository {
  createAttachmentDownloadUrl(
    ownerUserId: string,
    storagePath: string,
    expiresInSeconds: number,
  ): Promise<string>;
  listAttachments(
    ownerUserId: string,
    sourceVersionIds: string[],
  ): Promise<CaptureAttachmentRecord[]>;
  listMessages(
    ownerUserId: string,
    sourceVersionIds: string[],
  ): Promise<CaptureMessageRecord[]>;
  listProcessingJobs(
    ownerUserId: string,
    sourceVersionIds: string[],
  ): Promise<CaptureProcessingRecord[]>;
  listSourceItems(
    ownerUserId: string,
    options: { cursor: CaptureCursor | null; limit: number },
  ): Promise<CaptureSourceRecord[]>;
  listVersions(
    ownerUserId: string,
    sourceItemIds: string[],
  ): Promise<CaptureVersionRecord[]>;
  loadSourceItem(
    ownerUserId: string,
    sourceItemId: string,
  ): Promise<CaptureSourceRecord | null>;
}

export type CaptureHistoryItem = {
  captureStatus: CaptureStatus;
  createdAt: string;
  missingElements: string[];
  processingFailureReason: string | null;
  processingStatus: ProcessingStatus;
  savedAttachmentCount: number;
  savedMessageCount: number;
  sensitivity: Sensitivity;
  source: CaptureSource | null;
  sourceItemId: string;
  sourceVersionId: string;
  title: string;
  updatedAt: string;
  version: number;
};

export type CaptureHistoryPage = {
  items: CaptureHistoryItem[];
  nextCursor: string | null;
};

export type CaptureAttachmentDetails = CaptureAttachmentRecord & {
  downloadUrl: string;
};

export type CaptureVersionDetails = CaptureVersionRecord & {
  attachments: CaptureAttachmentDetails[];
  messages: CaptureMessageRecord[];
  processingFailureReason: string | null;
  processingStatus: ProcessingStatus;
};

export type CaptureDetails = CaptureSourceRecord & {
  versions: CaptureVersionDetails[];
};

function countByVersion(
  records: Array<{ sourceVersionId: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(
      record.sourceVersionId,
      (counts.get(record.sourceVersionId) ?? 0) + 1,
    );
  }
  return counts;
}

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

function normalizedLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

function decodeCursor(cursor: string | null): CaptureCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CaptureCursor>;
    if (
      typeof value.updatedAt !== "string" ||
      Number.isNaN(Date.parse(value.updatedAt)) ||
      typeof value.sourceItemId !== "string" ||
      !UUID_PATTERN.test(value.sourceItemId)
    ) {
      return null;
    }
    return {
      sourceItemId: value.sourceItemId,
      updatedAt: new Date(value.updatedAt).toISOString(),
    };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: CaptureCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function listCapturesWithRepository(
  repository: CaptureHistoryRepository,
  ownerUserId: string,
  cursor: string | null = null,
  limit?: number,
): Promise<CaptureHistoryPage> {
  const pageSize = normalizedLimit(limit);
  const sourceRows = await repository.listSourceItems(ownerUserId, {
    cursor: decodeCursor(cursor),
    limit: pageSize + 1,
  });
  const hasMore = sourceRows.length > pageSize;
  const pageRows = sourceRows.slice(0, pageSize);
  const sourceItemIds = pageRows.map((item) => item.id);

  if (sourceItemIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const versions = await repository.listVersions(ownerUserId, sourceItemIds);
  const latestVersions = latestVersionByItem(versions);
  const sourceVersionIds = [...latestVersions.values()].map(
    (version) => version.id,
  );
  const [messages, attachments, jobs] = await Promise.all([
    repository.listMessages(ownerUserId, sourceVersionIds),
    repository.listAttachments(ownerUserId, sourceVersionIds),
    repository.listProcessingJobs(ownerUserId, sourceVersionIds),
  ]);
  const messageCounts = countByVersion(messages);
  const attachmentCounts = countByVersion(attachments);
  const jobsByVersion = new Map(
    jobs.map((job) => [job.sourceVersionId, job]),
  );

  const items = pageRows.flatMap((sourceItem): CaptureHistoryItem[] => {
    const version = latestVersions.get(sourceItem.id);
    if (!version) {
      return [];
    }
    const job = jobsByVersion.get(version.id);
    return [
      {
        captureStatus: version.captureStatus,
        createdAt: version.createdAt,
        missingElements: version.missingElements,
        processingFailureReason: job?.failureReason ?? null,
        processingStatus: job?.status ?? "paused",
        savedAttachmentCount: attachmentCounts.get(version.id) ?? 0,
        savedMessageCount: messageCounts.get(version.id) ?? 0,
        sensitivity: sourceItem.sensitivity,
        source: sourceItem.source,
        sourceItemId: sourceItem.id,
        sourceVersionId: version.id,
        title: sourceItem.title,
        updatedAt: sourceItem.updatedAt,
        version: version.version,
      },
    ];
  });

  return {
    items,
    nextCursor:
      hasMore && pageRows.length > 0
        ? encodeCursor({
            sourceItemId: pageRows[pageRows.length - 1]!.id,
            updatedAt: pageRows[pageRows.length - 1]!.updatedAt,
          })
        : null,
  };
}

export async function getCaptureDetailsWithRepository(
  repository: CaptureHistoryRepository,
  ownerUserId: string,
  sourceItemId: string,
): Promise<CaptureDetails | null> {
  if (!isValidCaptureSourceItemId(sourceItemId)) {
    return null;
  }
  const sourceItem = await repository.loadSourceItem(
    ownerUserId,
    sourceItemId,
  );
  if (!sourceItem) {
    return null;
  }

  const versions = await repository.listVersions(ownerUserId, [sourceItemId]);
  const versionIds = versions.map((version) => version.id);
  const [messages, attachments, jobs] = await Promise.all([
    repository.listMessages(ownerUserId, versionIds),
    repository.listAttachments(ownerUserId, versionIds),
    repository.listProcessingJobs(ownerUserId, versionIds),
  ]);
  const jobsByVersion = new Map(
    jobs.map((job) => [job.sourceVersionId, job]),
  );

  const attachmentsWithUrls = await Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      downloadUrl: await repository.createAttachmentDownloadUrl(
        ownerUserId,
        attachment.storagePath,
        60,
      ),
    })),
  );

  return {
    ...sourceItem,
    versions: [...versions]
      .sort((left, right) => right.version - left.version)
      .map((version) => {
        const job = jobsByVersion.get(version.id);
        return {
          ...version,
          attachments: attachmentsWithUrls.filter(
            (attachment) => attachment.sourceVersionId === version.id,
          ),
          messages: messages
            .filter((message) => message.sourceVersionId === version.id)
            .sort((left, right) => left.ordinal - right.ordinal),
          processingFailureReason: job?.failureReason ?? null,
          processingStatus: job?.status ?? "paused",
        };
      }),
  };
}

function mapSourceRow(row: {
  created_at: string;
  current_version: number;
  id: string;
  sensitivity: Sensitivity;
  source: CaptureSource | null;
  title: string;
  updated_at: string;
}): CaptureSourceRecord {
  return {
    createdAt: row.created_at,
    currentVersion: row.current_version,
    id: row.id,
    sensitivity: row.sensitivity,
    source: row.source,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export async function createCaptureHistoryRepository(): Promise<CaptureHistoryRepository> {
  const supabase = await createServerClient();

  return {
    async createAttachmentDownloadUrl(ownerUserId, storagePath, expiresIn) {
      if (!storagePath.startsWith(`${ownerUserId}/`)) {
        throw new Error("Attachment path does not belong to the owner");
      }
      const { data, error } = await supabase.storage
        .from(RAW_CAPTURE_BUCKET)
        .createSignedUrl(storagePath, expiresIn);
      if (error) {
        throw error;
      }
      return data.signedUrl;
    },
    async listAttachments(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("source_attachments")
        .select(
          "id, source_version_id, client_id, storage_path, file_name, mime_type, byte_size, sha256",
        )
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds);
      if (error) throw error;
      return data.map((row) => ({
        byteSize: row.byte_size,
        clientId: row.client_id,
        fileName: row.file_name,
        id: row.id,
        mimeType: row.mime_type,
        sha256: row.sha256,
        sourceVersionId: row.source_version_id,
        storagePath: row.storage_path,
      }));
    },
    async listMessages(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("source_messages")
        .select(
          "id, source_version_id, external_message_id, role, body, ordinal",
        )
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds)
        .order("ordinal", { ascending: true });
      if (error) throw error;
      return data.map((row) => ({
        body: row.body,
        externalMessageId: row.external_message_id,
        id: row.id,
        ordinal: row.ordinal,
        role: row.role,
        sourceVersionId: row.source_version_id,
      }));
    },
    async listProcessingJobs(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return [];
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("source_version_id, status, failure_reason")
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds);
      if (error) throw error;
      return data.map((row) => ({
        failureReason: row.failure_reason,
        sourceVersionId: row.source_version_id,
        status: row.status,
      }));
    },
    async listSourceItems(ownerUserId, options) {
      let query = supabase
        .from("source_items")
        .select(
          "id, source, title, sensitivity, current_version, created_at, updated_at",
        )
        .eq("owner_user_id", ownerUserId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(options.limit);
      if (options.cursor) {
        query = query.or(
          `updated_at.lt.${options.cursor.updatedAt},and(updated_at.eq.${options.cursor.updatedAt},id.lt.${options.cursor.sourceItemId})`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data.map(mapSourceRow);
    },
    async listVersions(ownerUserId, sourceItemIds) {
      if (sourceItemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("source_versions")
        .select(
          "id, source_item_id, version, capture_session_id, capture_status, missing_elements, raw_text, created_at",
        )
        .eq("owner_user_id", ownerUserId)
        .in("source_item_id", sourceItemIds)
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
    async loadSourceItem(ownerUserId, sourceItemId) {
      const { data, error } = await supabase
        .from("source_items")
        .select(
          "id, source, title, sensitivity, current_version, created_at, updated_at",
        )
        .eq("owner_user_id", ownerUserId)
        .eq("id", sourceItemId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data ? mapSourceRow(data) : null;
    },
  };
}

export async function listCaptures(
  ownerUserId: string,
  cursor: string | null = null,
  limit?: number,
) {
  return listCapturesWithRepository(
    await createCaptureHistoryRepository(),
    ownerUserId,
    cursor,
    limit,
  );
}

export async function getCaptureDetails(
  ownerUserId: string,
  sourceItemId: string,
) {
  if (!isValidCaptureSourceItemId(sourceItemId)) {
    return null;
  }
  return getCaptureDetailsWithRepository(
    await createCaptureHistoryRepository(),
    ownerUserId,
    sourceItemId,
  );
}
