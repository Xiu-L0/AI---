import { z } from "zod";

import type { QueueRpcClient } from "../queue/processing-queue";
import { ProcessingQueueError } from "../queue/processing-queue";
import type { ClaimedJob } from "../worker-loop";
import { ProcessorError } from "../worker-loop";

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );

const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

const SourceMessageSchema = z.object({
  id: UuidSchema,
  external_message_id: z.string().min(1),
  role: MessageRoleSchema,
  body: z.string(),
  ordinal: z.coerce.number().int().nonnegative(),
});

const SourceAttachmentSchema = z.object({
  id: UuidSchema,
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  byte_size: z.coerce.number().int().nonnegative(),
});

const ClaimedSourceRowSchema = z.object({
  id: UuidSchema,
  owner_user_id: UuidSchema,
  source_item_id: UuidSchema,
  version: z.coerce.number().int().positive(),
  capture_status: z.string().min(1),
  missing_elements: z.array(z.string()),
  raw_text: z.string(),
  source_items: z.object({
    id: UuidSchema,
    title: z.string().min(1),
    source: z.string().min(1),
    space_id: UuidSchema,
    owner_user_id: UuidSchema,
  }),
  source_messages: z.array(SourceMessageSchema),
  source_attachments: z.array(SourceAttachmentSchema),
});

export type ClaimedSource = {
  item: {
    id: string;
    title: string;
    source: string;
    spaceId: string;
  };
  version: {
    id: string;
    sourceItemId: string;
    missingElements: string[];
    rawText: string;
    captureStatus: string;
  };
  messages: Array<{
    id: string;
    externalMessageId: string;
    role: z.infer<typeof MessageRoleSchema>;
    body: string;
    ordinal: number;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  }>;
};

export type SourceBlockDraft = {
  sourceMessageId: string;
  blockType: "message";
  ordinal: number;
  locatorKey: string;
  locatorJson: Record<string, unknown>;
  textContent: string;
  contentHash: string;
};

export interface SourceRepository {
  loadClaimedSource(job: ClaimedJob): Promise<ClaimedSource>;
  enqueueFollowupJob(job: ClaimedJob, jobType: string): Promise<void>;
  replaceSourceBlocks(job: ClaimedJob, blocks: SourceBlockDraft[]): Promise<void>;
}

export type SourceQueryClient = QueueRpcClient & {
  from(table: string): {
    select(columns: string): SourceFilterBuilder;
  };
};

type SourceFilterBuilder = {
  eq(column: string, value: string): SourceFilterBuilder;
  maybeSingle(): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
    status?: number;
  }>;
};

export class PostgresSourceRepository implements SourceRepository {
  constructor(
    private readonly client: SourceQueryClient,
    private readonly workerId: string,
  ) {}

  async loadClaimedSource(job: ClaimedJob): Promise<ClaimedSource> {
    const result = await this.client
      .from("source_versions")
      .select(
        "id, owner_user_id, source_item_id, version, capture_status, missing_elements, raw_text, source_items!inner(id, title, source, space_id, owner_user_id), source_messages(id, external_message_id, role, body, ordinal), source_attachments(id, file_name, mime_type, byte_size)",
      )
      .eq("id", job.sourceVersionId)
      .eq("owner_user_id", job.ownerUserId)
      .eq("source_items.space_id", job.spaceId)
      .eq("source_items.owner_user_id", job.ownerUserId)
      .maybeSingle();

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "load_claimed_source",
        code: result.error.code ?? "source_query_failed",
        httpStatus: result.status ?? null,
        message: "Source query failed",
      });
    }

    if (result.data == null) {
      throw new ProcessorError(
        "ancestry_mismatch",
        "Claimed source version was not found for owner, space and version",
        false,
      );
    }

    const parsed = ClaimedSourceRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ProcessorError("invalid_source_payload", "Source payload failed validation", false);
    }

    const row = parsed.data;
    if (
      row.source_items.space_id !== job.spaceId
      || row.source_items.owner_user_id !== job.ownerUserId
      || row.owner_user_id !== job.ownerUserId
      || row.id !== job.sourceVersionId
    ) {
      throw new ProcessorError(
        "ancestry_mismatch",
        "Claimed source version ancestry did not match the job",
        false,
      );
    }

    return {
      item: {
        id: row.source_items.id,
        title: row.source_items.title,
        source: row.source_items.source,
        spaceId: row.source_items.space_id,
      },
      version: {
        id: row.id,
        sourceItemId: row.source_item_id,
        missingElements: row.missing_elements,
        rawText: row.raw_text,
        captureStatus: row.capture_status,
      },
      messages: row.source_messages.map((message) => ({
        id: message.id,
        externalMessageId: message.external_message_id,
        role: message.role,
        body: message.body,
        ordinal: message.ordinal,
      })),
      attachments: row.source_attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        byteSize: attachment.byte_size,
      })),
    };
  }

  async enqueueFollowupJob(job: ClaimedJob, jobType: string): Promise<void> {
    const result = await this.client.rpc("enqueue_followup_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_job_type: jobType,
    });

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "enqueue_followup_processing_job",
        code: result.error.code ?? "queue_rpc_failed",
        httpStatus: result.status ?? null,
      });
    }
  }

  async replaceSourceBlocks(job: ClaimedJob, blocks: SourceBlockDraft[]): Promise<void> {
    const result = await this.client.rpc("replace_source_blocks_and_enqueue_extract", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_blocks: blocks.map((block) => ({
        source_message_id: block.sourceMessageId,
        block_type: block.blockType,
        ordinal: block.ordinal,
        locator_key: block.locatorKey,
        locator_json: block.locatorJson,
        text_content: block.textContent,
        content_hash: block.contentHash,
      })),
    });

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "replace_source_blocks_and_enqueue_extract",
        code: result.error.code ?? "queue_rpc_failed",
        httpStatus: result.status ?? null,
      });
    }
  }
}
