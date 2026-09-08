import { z } from "zod";

import { ProcessingQueueError, type QueueRpcClient } from "../queue/processing-queue";
import type { ClaimedJob } from "../worker-loop";

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );

const SourceBlockRowSchema = z.object({
  id: UuidSchema,
  locator_key: z.string().min(1),
  ordinal: z.coerce.number().int().nonnegative(),
  text_content: z.string(),
  block_type: z.string().min(1).optional(),
  locator_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

const PersistItemSchema = z.object({
  knowledge_item_id: UuidSchema,
  extraction_key: z.string().regex(/^[a-f0-9]{64}$/),
  review_task_id: UuidSchema.nullable().optional(),
  reused: z.boolean(),
  user_governed: z.boolean(),
});

const PersistResultSchema = z.object({
  items: z.array(PersistItemSchema).min(1).max(12),
});

export type KnowledgeSourceBlock = {
  id: string;
  locatorKey: string;
  ordinal: number;
  text: string;
  role: string;
  blockType: string;
};

export type KnowledgeExtractionInputScope = {
  mode: "all" | "window";
  startOrdinal: number;
  endOrdinal: number;
  blockCount: number;
  characterCount: number;
  locatorKeys: string[];
};

export type KnowledgeCitationPersistDraft = {
  locatorKey: string;
  claimPath: "l0_summary" | "l1_content" | "l2_content" | "conditions" | "limitations";
  quoteExcerpt: string;
};

export type KnowledgePersistDraft = {
  extractionKey: string;
  knowledgeType: string;
  title: string;
  l0Summary: string;
  l1Content: string;
  l2Content: string;
  conditions: string[];
  limitations: string[];
  confidence: number;
  evidenceMode: string;
  citations: KnowledgeCitationPersistDraft[];
};

export type PersistKnowledgeExtractionInput = {
  promptVersion: string;
  provider: string;
  model: string;
  inputScope: KnowledgeExtractionInputScope;
  drafts: KnowledgePersistDraft[];
};

export type PersistKnowledgeExtractionResult = {
  items: Array<{
    knowledgeItemId: string;
    extractionKey: string;
    reviewTaskId: string | null;
    reused: boolean;
    userGoverned: boolean;
  }>;
};

export interface KnowledgeRepository {
  listSourceBlocks(job: ClaimedJob): Promise<KnowledgeSourceBlock[]>;
  persistExtraction(
    job: ClaimedJob,
    input: PersistKnowledgeExtractionInput,
  ): Promise<PersistKnowledgeExtractionResult>;
}

type FilterBuilder = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
}> & {
  eq(column: string, value: string): FilterBuilder;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder;
};

export type KnowledgeQueryClient = QueueRpcClient & {
  from(table: string): {
    select(columns: string): FilterBuilder;
  };
};

function readRole(locatorJson: Record<string, unknown> | null | undefined, blockType?: string) {
  const role = locatorJson?.role;
  if (typeof role === "string" && role.length > 0) return role;
  return blockType === "message" ? "user" : "source";
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly client: KnowledgeQueryClient,
    private readonly workerId: string,
  ) {}

  async listSourceBlocks(job: ClaimedJob): Promise<KnowledgeSourceBlock[]> {
    const result = await this.client
      .from("source_blocks")
      .select("id, locator_key, ordinal, text_content, block_type, locator_json")
      .eq("source_version_id", job.sourceVersionId)
      .eq("owner_user_id", job.ownerUserId)
      .eq("space_id", job.spaceId)
      .order("ordinal", { ascending: true });

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "list_source_blocks",
        code: result.error.code ?? "source_block_query_failed",
        httpStatus: result.status ?? null,
        message: "Source block query failed",
      });
    }

    const parsed = z.array(SourceBlockRowSchema).safeParse(result.data ?? []);
    if (!parsed.success) {
      throw new ProcessingQueueError({
        rpcName: "list_source_blocks",
        code: "invalid_source_block_payload",
        httpStatus: result.status ?? null,
        message: "Source block payload failed validation",
      });
    }

    return parsed.data.map((row) => ({
      id: row.id,
      locatorKey: row.locator_key,
      ordinal: row.ordinal,
      text: row.text_content,
      role: readRole(row.locator_json, row.block_type),
      blockType: row.block_type ?? "message",
    }));
  }

  async persistExtraction(
    job: ClaimedJob,
    input: PersistKnowledgeExtractionInput,
  ): Promise<PersistKnowledgeExtractionResult> {
    const result = await this.client.rpc("persist_knowledge_extraction", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_prompt_version: input.promptVersion,
      p_payload: {
        source_version_id: job.sourceVersionId,
        provider: input.provider,
        model: input.model,
        input_scope: {
          mode: input.inputScope.mode,
          start_ordinal: input.inputScope.startOrdinal,
          end_ordinal: input.inputScope.endOrdinal,
          block_count: input.inputScope.blockCount,
          character_count: input.inputScope.characterCount,
          locator_keys: input.inputScope.locatorKeys,
        },
        drafts: input.drafts.map((draft) => ({
          extraction_key: draft.extractionKey,
          knowledge_type: draft.knowledgeType,
          title: draft.title,
          l0_summary: draft.l0Summary,
          l1_content: draft.l1Content,
          l2_content: draft.l2Content,
          conditions: draft.conditions,
          limitations: draft.limitations,
          confidence: draft.confidence,
          evidence_mode: draft.evidenceMode,
          citations: draft.citations.map((citation) => ({
            locator_key: citation.locatorKey,
            claim_path: citation.claimPath,
            quote_excerpt: citation.quoteExcerpt,
          })),
        })),
      },
    });

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "persist_knowledge_extraction",
        code: result.error.code ?? "queue_rpc_failed",
        httpStatus: result.status ?? null,
      });
    }

    const parsed = PersistResultSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ProcessingQueueError({
        rpcName: "persist_knowledge_extraction",
        code: "invalid_persist_payload",
        httpStatus: result.status ?? null,
        message: "Persist payload failed validation",
      });
    }

    return {
      items: parsed.data.items.map((item) => ({
        knowledgeItemId: item.knowledge_item_id,
        extractionKey: item.extraction_key,
        reviewTaskId: item.review_task_id ?? null,
        reused: item.reused,
        userGoverned: item.user_governed,
      })),
    };
  }
}
