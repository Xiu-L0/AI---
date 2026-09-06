import "server-only";

import {
  type EditableKnowledgeField,
  type KnowledgeEvidenceMode,
  type KnowledgeStatus,
  type KnowledgeType,
} from "@recall/contracts";
import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";

const FieldFromDb: Record<string, EditableKnowledgeField> = {
  title: "title",
  l0_summary: "l0Summary",
  l1_content: "l1Content",
  l2_content: "l2Content",
  conditions: "conditions",
  limitations: "limitations",
};

export type KnowledgeReviewCitation = {
  claimPath: string;
  evidenceHref: string;
  id: string;
  locatorKey: string;
  ordinal: number;
  quoteExcerpt: string;
  reviewStatus: "pending" | "approved" | "rejected";
  role: string;
  sourceItemId: string;
  sourceVersionId: string;
};

export type KnowledgeReview = {
  citations: KnowledgeReviewCitation[];
  conditions: string[];
  confidence: number;
  currentVersion: number;
  evidenceMode: KnowledgeEvidenceMode;
  humanLockedFields: EditableKnowledgeField[];
  knowledgeItemId: string;
  knowledgeType: KnowledgeType;
  l0Summary: string;
  l1Content: string;
  l2Content: string;
  limitations: string[];
  sourceItemId: string | null;
  sourceTitle: string;
  sourceVersionId: string | null;
  status: KnowledgeStatus;
  title: string;
};

export type KnowledgeItemReviewRecord = {
  conditions: string[];
  confidence: number;
  currentVersion: number;
  evidenceMode: string;
  humanLockedFields: string[];
  id: string;
  knowledgeType: string;
  l0Summary: string;
  l1Content: string;
  l2Content: string;
  limitations: string[];
  sourceVersionId: string | null;
  status: string;
  title: string;
};

export type CitationReviewRecord = {
  claimPath: string;
  id: string;
  knowledgeItemId: string;
  locatorKey: string;
  ordinal: number;
  quoteExcerpt: string;
  reviewStatus: "pending" | "approved" | "rejected";
  role: string;
  sourceItemId: string;
  sourceVersionId: string;
};

export type SourceTitleRecord = {
  sourceItemId: string;
  sourceVersionId: string;
  title: string;
};

export interface KnowledgeReviewRepository {
  loadCitations(
    ownerUserId: string,
    knowledgeItemId: string,
  ): Promise<CitationReviewRecord[]>;
  loadKnowledgeItem(
    ownerUserId: string,
    knowledgeItemId: string,
  ): Promise<KnowledgeItemReviewRecord | null>;
  loadSourceTitle(
    ownerUserId: string,
    sourceVersionId: string,
  ): Promise<SourceTitleRecord | null>;
}

export type SourceVersionProvenance = {
  blockCount: number;
  draftCount: number;
  runStatus: string;
  sourceVersionId: string;
};

export interface CaptureProvenanceRepository {
  countBlocks(ownerUserId: string, sourceVersionIds: string[]): Promise<Map<string, number>>;
  countDrafts(ownerUserId: string, sourceVersionIds: string[]): Promise<Map<string, number>>;
  listLatestRunStatus(
    ownerUserId: string,
    sourceVersionIds: string[],
  ): Promise<Map<string, string>>;
}

type FilterBuilder = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> & {
  eq(column: string, value: string): FilterBuilder;
  in(column: string, values: string[]): FilterBuilder;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder;
  limit(value: number): FilterBuilder;
  maybeSingle(): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

type KnowledgeQueryClient = {
  from(table: string): {
    select(columns: string): FilterBuilder;
  };
};

export async function getKnowledgeReviewWithRepository(
  repository: KnowledgeReviewRepository,
  ownerUserId: string,
  knowledgeItemId: string,
): Promise<KnowledgeReview | null> {
  const ownerId = z.uuid().parse(ownerUserId);
  const itemId = z.uuid().parse(knowledgeItemId);
  const item = await repository.loadKnowledgeItem(ownerId, itemId);
  if (!item) {
    return null;
  }

  const [citations, source] = await Promise.all([
    repository.loadCitations(ownerId, itemId),
    item.sourceVersionId
      ? repository.loadSourceTitle(ownerId, item.sourceVersionId)
      : Promise.resolve(null),
  ]);

  return {
    citations: citations.map((citation) => ({
      ...citation,
      evidenceHref: `/captures/${citation.sourceItemId}#${citation.locatorKey}`,
    })),
    conditions: item.conditions,
    confidence: item.confidence,
    currentVersion: item.currentVersion,
    evidenceMode: item.evidenceMode as KnowledgeEvidenceMode,
    humanLockedFields: item.humanLockedFields.flatMap((field) => {
      const mapped = FieldFromDb[field];
      return mapped ? [mapped] : [];
    }),
    knowledgeItemId: item.id,
    knowledgeType: item.knowledgeType as KnowledgeType,
    l0Summary: item.l0Summary,
    l1Content: item.l1Content,
    l2Content: item.l2Content,
    limitations: item.limitations,
    sourceItemId: source?.sourceItemId ?? citations[0]?.sourceItemId ?? null,
    sourceTitle: source?.title ?? "未命名来源",
    sourceVersionId: item.sourceVersionId,
    status: item.status as KnowledgeStatus,
    title: item.title,
  };
}

export async function getCaptureKnowledgeProvenanceWithRepository(
  repository: CaptureProvenanceRepository,
  ownerUserId: string,
  sourceVersionIds: string[],
): Promise<SourceVersionProvenance[]> {
  const ownerId = z.uuid().parse(ownerUserId);
  const ids = sourceVersionIds.filter((id) => z.uuid().safeParse(id).success);
  const [blocks, drafts, runs] = await Promise.all([
    repository.countBlocks(ownerId, ids),
    repository.countDrafts(ownerId, ids),
    repository.listLatestRunStatus(ownerId, ids),
  ]);

  return ids.map((sourceVersionId) => ({
    blockCount: blocks.get(sourceVersionId) ?? 0,
    draftCount: drafts.get(sourceVersionId) ?? 0,
    runStatus: runs.get(sourceVersionId) ?? "queued",
    sourceVersionId,
  }));
}

function countBy(
  rows: Array<{ source_version_id: string }>,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.source_version_id, (counts.get(row.source_version_id) ?? 0) + 1);
  }
  return counts;
}

export async function createKnowledgeReviewRepository(): Promise<
  KnowledgeReviewRepository & CaptureProvenanceRepository
> {
  const client = (await createServerClient()) as unknown as KnowledgeQueryClient;

  return {
    async loadKnowledgeItem(ownerUserId, knowledgeItemId) {
      const result = await client
        .from("knowledge_items")
        .select(
          "id, title, knowledge_type, l0_summary, l1_content, l2_content, conditions, limitations, confidence, status, current_version, evidence_mode, human_locked_fields, source_version_id",
        )
        .eq("owner_user_id", ownerUserId)
        .eq("id", knowledgeItemId)
        .maybeSingle();
      if (result.error) throw result.error;
      if (result.data == null) return null;
      const row = result.data as {
        conditions: string[];
        confidence: number;
        current_version: number;
        evidence_mode: string;
        human_locked_fields: string[];
        id: string;
        knowledge_type: string;
        l0_summary: string;
        l1_content: string;
        l2_content: string;
        limitations: string[];
        source_version_id: string | null;
        status: string;
        title: string;
      };
      return {
        conditions: row.conditions,
        confidence: Number(row.confidence),
        currentVersion: row.current_version,
        evidenceMode: row.evidence_mode,
        humanLockedFields: row.human_locked_fields,
        id: row.id,
        knowledgeType: row.knowledge_type,
        l0Summary: row.l0_summary,
        l1Content: row.l1_content,
        l2Content: row.l2_content,
        limitations: row.limitations,
        sourceVersionId: row.source_version_id,
        status: row.status,
        title: row.title,
      };
    },
    async loadCitations(ownerUserId, knowledgeItemId) {
      const citations = await client
        .from("citations")
        .select("id, knowledge_item_id, source_block_id, claim_path, quote_excerpt, review_status")
        .eq("owner_user_id", ownerUserId)
        .eq("knowledge_item_id", knowledgeItemId);
      if (citations.error) throw citations.error;
      const citationRows = (citations.data ?? []) as Array<{
        claim_path: string;
        id: string;
        knowledge_item_id: string;
        quote_excerpt: string;
        review_status: "pending" | "approved" | "rejected";
        source_block_id: string;
      }>;
      if (citationRows.length === 0) return [];

      const blocks = await client
        .from("source_blocks")
        .select("id, locator_key, ordinal, source_item_id, source_version_id, locator_json")
        .eq("owner_user_id", ownerUserId)
        .in(
          "id",
          citationRows.map((row) => row.source_block_id),
        );
      if (blocks.error) throw blocks.error;
      const blockRows = (blocks.data ?? []) as Array<{
        id: string;
        locator_json: { role?: string } | null;
        locator_key: string;
        ordinal: number;
        source_item_id: string;
        source_version_id: string;
      }>;
      const blockById = new Map(blockRows.map((row) => [row.id, row]));

      return citationRows.flatMap((row) => {
        const block = blockById.get(row.source_block_id);
        if (!block) return [];
        return [
          {
            claimPath: row.claim_path,
            id: row.id,
            knowledgeItemId: row.knowledge_item_id,
            locatorKey: block.locator_key,
            ordinal: block.ordinal,
            quoteExcerpt: row.quote_excerpt,
            reviewStatus: row.review_status,
            role: block.locator_json?.role ?? "user",
            sourceItemId: block.source_item_id,
            sourceVersionId: block.source_version_id,
          },
        ];
      });
    },
    async loadSourceTitle(ownerUserId, sourceVersionId) {
      const version = await client
        .from("source_versions")
        .select("id, source_item_id")
        .eq("owner_user_id", ownerUserId)
        .eq("id", sourceVersionId)
        .maybeSingle();
      if (version.error) throw version.error;
      const versionRow = version.data as { id: string; source_item_id: string } | null;
      if (!versionRow) return null;
      const source = await client
        .from("source_items")
        .select("id, title")
        .eq("owner_user_id", ownerUserId)
        .eq("id", versionRow.source_item_id)
        .maybeSingle();
      if (source.error) throw source.error;
      const sourceRow = source.data as { id: string; title: string } | null;
      if (!sourceRow) return null;
      return {
        sourceItemId: sourceRow.id,
        sourceVersionId: versionRow.id,
        title: sourceRow.title,
      };
    },
    async countBlocks(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return new Map();
      const result = await client
        .from("source_blocks")
        .select("id, source_version_id")
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds);
      if (result.error) throw result.error;
      return countBy((result.data ?? []) as Array<{ source_version_id: string }>);
    },
    async countDrafts(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return new Map();
      const result = await client
        .from("knowledge_items")
        .select("id, source_version_id")
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds);
      if (result.error) throw result.error;
      return countBy(
        ((result.data ?? []) as Array<{ source_version_id: string | null }>).flatMap((row) =>
          row.source_version_id ? [{ source_version_id: row.source_version_id }] : [],
        ),
      );
    },
    async listLatestRunStatus(ownerUserId, sourceVersionIds) {
      if (sourceVersionIds.length === 0) return new Map();
      const jobs = await client
        .from("processing_jobs")
        .select("id, source_version_id, status")
        .eq("owner_user_id", ownerUserId)
        .in("source_version_id", sourceVersionIds);
      if (jobs.error) throw jobs.error;
      const jobRows = (jobs.data ?? []) as Array<{
        id: string;
        source_version_id: string;
        status: string;
      }>;
      const jobIds = jobRows.map((row) => row.id);
      const statusByVersion = new Map(jobRows.map((row) => [row.source_version_id, row.status]));
      if (jobIds.length === 0) {
        return statusByVersion;
      }

      const runs = await client
        .from("processing_runs")
        .select("processing_job_id, status, started_at")
        .eq("owner_user_id", ownerUserId)
        .in("processing_job_id", jobIds)
        .order("started_at", { ascending: false });
      if (!runs.error) {
        const runRows = (runs.data ?? []) as Array<{
          processing_job_id: string;
          status: string;
        }>;
        const jobToVersion = new Map(jobRows.map((row) => [row.id, row.source_version_id]));
        for (const run of runRows) {
          const versionId = jobToVersion.get(run.processing_job_id);
          if (versionId && !statusByVersion.has(versionId + ":run")) {
            statusByVersion.set(versionId, run.status);
            statusByVersion.set(versionId + ":run", run.status);
          }
        }
        for (const versionId of sourceVersionIds) {
          statusByVersion.delete(versionId + ":run");
        }
      }
      return statusByVersion;
    },
  };
}

export async function getKnowledgeReview(ownerUserId: string, knowledgeItemId: string) {
  return getKnowledgeReviewWithRepository(
    await createKnowledgeReviewRepository(),
    ownerUserId,
    knowledgeItemId,
  );
}

export async function getCaptureKnowledgeProvenance(
  ownerUserId: string,
  sourceVersionIds: string[],
) {
  return getCaptureKnowledgeProvenanceWithRepository(
    await createKnowledgeReviewRepository(),
    ownerUserId,
    sourceVersionIds,
  );
}
