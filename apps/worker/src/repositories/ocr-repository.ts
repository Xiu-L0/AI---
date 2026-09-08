import { createHash } from "node:crypto";

import { z } from "zod";

import type { OcrResult } from "@recall/contracts";

import { ProcessingQueueError, type QueueRpcClient } from "../queue/processing-queue";
import type { ClaimedJob } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import type { ClaimedSource } from "./source-repository";

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );

const PersistedOcrRowSchema = z.object({
  id: UuidSchema,
  source_attachment_id: UuidSchema,
  input_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().min(1),
  model: z.string().min(1),
  provider_request_id: z.string().min(1),
  markdown_text: z.string().min(1),
  layout_details: z.unknown(),
  data_info: z.unknown(),
  usage_json: z.unknown().nullable().optional(),
});

export type ClaimedAttachment = ClaimedSource["attachments"][number];

export type PersistedOcrResult = {
  id: string;
  sourceAttachmentId: string;
  inputSha256: string;
  provider: string;
  model: string;
  providerRequestId: string;
  markdown: string;
  layoutDetails: unknown;
  dataInfo: unknown;
  usage: unknown;
};

export interface OcrRepository {
  downloadAttachment(job: ClaimedJob, attachment: ClaimedAttachment): Promise<Uint8Array>;
  findResult(input: {
    job: ClaimedJob;
    attachmentId: string;
    inputSha256: string;
    provider: string;
    model: string;
  }): Promise<PersistedOcrResult | null>;
  persistResult(
    job: ClaimedJob,
    attachment: ClaimedAttachment,
    result: OcrResult,
    inputSha256: string,
  ): Promise<PersistedOcrResult>;
  listResults(job: ClaimedJob): Promise<PersistedOcrResult[]>;
}

type FilterBuilder = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
}> & {
  eq(column: string, value: string): FilterBuilder;
  maybeSingle(): FilterBuilder;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder;
};

export type OcrQueryClient = QueueRpcClient & {
  from(table: string): {
    select(columns: string): FilterBuilder;
  };
  storage: {
    from(bucket: string): {
      download(path: string): PromiseLike<{
        data: Blob | ArrayBuffer | Uint8Array | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function toBytes(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if ("arrayBuffer" in data && typeof data.arrayBuffer === "function") {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new ProcessorError("invalid_attachment_bytes", "Storage download did not return bytes", false);
}

function mapRow(row: z.infer<typeof PersistedOcrRowSchema>): PersistedOcrResult {
  return {
    id: row.id,
    sourceAttachmentId: row.source_attachment_id,
    inputSha256: row.input_sha256,
    provider: row.provider,
    model: row.model,
    providerRequestId: row.provider_request_id,
    markdown: row.markdown_text,
    layoutDetails: row.layout_details,
    dataInfo: row.data_info,
    usage: row.usage_json ?? null,
  };
}

export class PostgresOcrRepository implements OcrRepository {
  constructor(
    private readonly client: OcrQueryClient,
    private readonly workerId: string,
  ) {}

  async downloadAttachment(job: ClaimedJob, attachment: ClaimedAttachment): Promise<Uint8Array> {
    if (!attachment.storagePath.startsWith(`${job.ownerUserId}/`)) {
      throw new ProcessorError(
        "ancestry_mismatch",
        "Attachment storage path does not belong to the claimed owner",
        false,
      );
    }

    const downloaded = await this.client.storage.from("raw-captures").download(attachment.storagePath);
    if (downloaded.error || downloaded.data == null) {
      throw new ProcessorError("attachment_download_failed", "Private attachment download failed", true);
    }

    const bytes = await toBytes(downloaded.data);
    if (sha256Hex(bytes) !== attachment.sha256) {
      throw new ProcessorError(
        "attachment_sha_mismatch",
        "Downloaded attachment SHA did not match the stored digest",
        false,
      );
    }
    return bytes;
  }

  async findResult(input: {
    job: ClaimedJob;
    attachmentId: string;
    inputSha256: string;
    provider: string;
    model: string;
  }): Promise<PersistedOcrResult | null> {
    const result = await this.client
      .from("asset_ocr_results")
      .select(
        "id, source_attachment_id, input_sha256, provider, model, provider_request_id, markdown_text, layout_details, data_info, usage_json",
      )
      .eq("source_attachment_id", input.attachmentId)
      .eq("input_sha256", input.inputSha256)
      .eq("provider", input.provider)
      .eq("model", input.model)
      .eq("owner_user_id", input.job.ownerUserId)
      .eq("space_id", input.job.spaceId)
      .eq("source_version_id", input.job.sourceVersionId)
      .maybeSingle();

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "find_asset_ocr_result",
        code: result.error.code ?? "ocr_query_failed",
        httpStatus: result.status ?? null,
        message: "OCR result query failed",
      });
    }

    if (result.data == null) return null;
    const parsed = PersistedOcrRowSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ProcessorError("invalid_ocr_payload", "OCR result payload failed validation", false);
    }
    return mapRow(parsed.data);
  }

  async persistResult(
    job: ClaimedJob,
    attachment: ClaimedAttachment,
    result: OcrResult,
    inputSha256: string,
  ): Promise<PersistedOcrResult> {
    const rpc = await this.client.rpc("persist_asset_ocr_result", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_attachment_id: attachment.id,
      p_input_sha256: inputSha256,
      p_provider: result.provider,
      p_model: result.model,
      p_provider_request_id: result.requestId,
      p_markdown_text: result.markdown,
      p_layout_details: result.regions,
      p_data_info: { pages: result.pages },
      p_usage_json: result.usage,
    });

    if (rpc.error) {
      throw new ProcessingQueueError({
        rpcName: "persist_asset_ocr_result",
        code: rpc.error.code ?? "ocr_persist_failed",
        httpStatus: rpc.status ?? null,
        message: "OCR persist failed",
      });
    }

    const existing = await this.findResult({
      job,
      attachmentId: attachment.id,
      inputSha256,
      provider: result.provider,
      model: result.model,
    });
    if (existing === null) {
      throw new ProcessorError("ocr_persist_missing", "OCR persist did not return a stored result", true);
    }
    return existing;
  }

  async listResults(job: ClaimedJob): Promise<PersistedOcrResult[]> {
    const result = await this.client
      .from("asset_ocr_results")
      .select(
        "id, source_attachment_id, input_sha256, provider, model, provider_request_id, markdown_text, layout_details, data_info, usage_json",
      )
      .eq("owner_user_id", job.ownerUserId)
      .eq("space_id", job.spaceId)
      .eq("source_version_id", job.sourceVersionId)
      .order("created_at", { ascending: true });

    if (result.error) {
      throw new ProcessingQueueError({
        rpcName: "list_asset_ocr_results",
        code: result.error.code ?? "ocr_query_failed",
        httpStatus: result.status ?? null,
        message: "OCR result query failed",
      });
    }

    const parsed = z.array(PersistedOcrRowSchema).safeParse(result.data ?? []);
    if (!parsed.success) {
      throw new ProcessorError("invalid_ocr_payload", "OCR result payload failed validation", false);
    }
    return parsed.data.map(mapRow);
  }
}
