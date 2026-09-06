import { z } from "zod";

import type {
  ClaimedJob,
  ProcessingFailure,
  ProcessingQueue,
  ProcessingResult,
} from "../worker-loop";

export type QueueRpcClient = {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: {
      code?: string;
      message?: string;
    } | null;
    status?: number;
    statusText?: string;
  }>;
};

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );

const ClaimedJobRowSchema = z.object({
  job_id: UuidSchema,
  run_id: UuidSchema,
  owner_user_id: UuidSchema,
  space_id: UuidSchema,
  source_version_id: UuidSchema,
  job_type: z.string().min(1),
  attempt: z.coerce.number().int().positive(),
  lease_expires_at: z.string().min(1),
});

const ClaimedJobRowsSchema = z.array(ClaimedJobRowSchema);

export class ProcessingQueueError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly rpcName: string;

  constructor(input: {
    rpcName: string;
    code: string;
    httpStatus?: number | null;
    message?: string;
  }) {
    super(input.message ?? `Queue RPC ${input.rpcName} failed`);
    this.name = "ProcessingQueueError";
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? null;
    this.rpcName = input.rpcName;
  }
}

const SECRET_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi;

function containsSecret(value: string) {
  return /bearer\s+[a-z0-9._~+/=-]+|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/i.test(
    value,
  );
}

function redact(value: string) {
  return value.replace(SECRET_PATTERN, "[redacted]");
}

function looksLikeSourceContent(value: string) {
  return /raw_text|source content|quote_excerpt|select\s+/i.test(value) && value.length > 80;
}

function toQueueError(rpcName: string, error: { code?: string; message?: string }, httpStatus?: number) {
  const code = error.code?.trim() || "queue_rpc_failed";
  const rawMessage = error.message ?? "";
  const safeMessage =
    looksLikeSourceContent(rawMessage) || containsSecret(rawMessage)
      ? `Queue RPC ${rpcName} failed`
      : redact(rawMessage) || `Queue RPC ${rpcName} failed`;

  return new ProcessingQueueError({
    rpcName,
    code,
    httpStatus: httpStatus ?? null,
    message: safeMessage,
  });
}

function mapRow(row: z.infer<typeof ClaimedJobRowSchema>): ClaimedJob {
  return {
    jobId: row.job_id,
    runId: row.run_id,
    ownerUserId: row.owner_user_id,
    spaceId: row.space_id,
    sourceVersionId: row.source_version_id,
    jobType: row.job_type,
    attempt: row.attempt,
    leaseExpiresAt:
      typeof row.lease_expires_at === "string"
        ? row.lease_expires_at
        : row.lease_expires_at,
  };
}

export class PostgresProcessingQueue implements ProcessingQueue {
  constructor(
    private readonly client: QueueRpcClient,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  async claim(limit: number): Promise<ClaimedJob[]> {
    const result = await this.client.rpc("claim_processing_jobs", {
      p_worker_id: this.workerId,
      p_limit: limit,
      p_lease_seconds: this.leaseSeconds,
    });

    if (result.error) {
      throw toQueueError("claim_processing_jobs", result.error, result.status);
    }

    if (result.data == null) {
      return [];
    }

    const parsed = ClaimedJobRowsSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new ProcessingQueueError({
        rpcName: "claim_processing_jobs",
        code: "invalid_claim_payload",
        httpStatus: result.status ?? null,
      });
    }

    return parsed.data.map(mapRow);
  }

  async heartbeat(job: ClaimedJob): Promise<void> {
    await this.callVoid("heartbeat_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_lease_seconds: this.leaseSeconds,
    });
  }

  async complete(job: ClaimedJob, result: ProcessingResult): Promise<void> {
    await this.callVoid("complete_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_usage_json: result.usageJson ?? null,
      p_result_summary: result.resultSummary,
    });
  }

  async fail(job: ClaimedJob, failure: ProcessingFailure): Promise<void> {
    await this.callVoid("fail_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: this.workerId,
      p_error_code: failure.errorCode,
      p_error_detail: failure.errorDetail.slice(0, 2000),
      p_retryable: failure.retryable,
    });
  }

  private async callVoid(rpcName: string, args: Record<string, unknown>) {
    const result = await this.client.rpc(rpcName, args);
    if (result.error) {
      const error = toQueueError(rpcName, result.error, result.status);
      if (/lease/i.test(result.error.message ?? "") || result.error.code === "42501") {
        throw new ProcessingQueueError({
          rpcName,
          code: "lease_not_owned",
          httpStatus: result.status ?? null,
          message: "Queue RPC lease is not owned by this worker",
        });
      }
      throw error;
    }
  }
}
