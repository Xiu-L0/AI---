import { describe, expect, it, vi } from "vitest";

import {
  PostgresProcessingQueue,
  ProcessingQueueError,
  type QueueRpcClient,
} from "./processing-queue";

const claimedRow = {
  job_id: "11111111-1111-1111-1111-111111111111",
  run_id: "22222222-2222-2222-2222-222222222222",
  owner_user_id: "00000000-0000-0000-0000-0000000000b1",
  space_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  source_version_id: "30000000-0000-0000-0000-0000000000b1",
  job_type: "normalize_source",
  attempt: 1,
  lease_expires_at: "2026-09-06T06:00:00.000Z",
};

const job = {
  jobId: claimedRow.job_id,
  runId: claimedRow.run_id,
  ownerUserId: claimedRow.owner_user_id,
  spaceId: claimedRow.space_id,
  sourceVersionId: claimedRow.source_version_id,
  jobType: claimedRow.job_type,
  attempt: claimedRow.attempt,
  leaseExpiresAt: claimedRow.lease_expires_at,
};

function createClient(
  impl: QueueRpcClient["rpc"],
): QueueRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(impl) };
}

describe("PostgresProcessingQueue", () => {
  it("claims jobs with the exact RPC argument names and parses rows", async () => {
    const client = createClient(async () => ({ data: [claimedRow], error: null, status: 200 }));
    const queue = new PostgresProcessingQueue(client, "worker-a", 60);

    await expect(queue.claim(2)).resolves.toEqual([job]);
    expect(client.rpc).toHaveBeenCalledWith("claim_processing_jobs", {
      p_worker_id: "worker-a",
      p_limit: 2,
      p_lease_seconds: 60,
    });
  });

  it("treats a null claim payload as an empty batch", async () => {
    const client = createClient(async () => ({ data: null, error: null, status: 200 }));
    const queue = new PostgresProcessingQueue(client, "worker-a", 60);

    await expect(queue.claim(5)).resolves.toEqual([]);
  });

  it("completes, fails and heartbeats through the four queue RPCs", async () => {
    const client = createClient(async () => ({ data: null, error: null, status: 204 }));
    const queue = new PostgresProcessingQueue(client, "worker-a", 60);

    await queue.complete(job, {
      resultSummary: "normalized",
      usageJson: { inputTokens: 1 },
    });
    await queue.fail(job, {
      errorCode: "model_timeout",
      errorDetail: "retry later",
      retryable: true,
    });
    await queue.heartbeat(job);

    expect(client.rpc).toHaveBeenNthCalledWith(1, "complete_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: "worker-a",
      p_usage_json: { inputTokens: 1 },
      p_result_summary: "normalized",
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, "fail_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: "worker-a",
      p_error_code: "model_timeout",
      p_error_detail: "retry later",
      p_retryable: true,
    });
    expect(client.rpc).toHaveBeenNthCalledWith(3, "heartbeat_processing_job", {
      p_job_id: job.jobId,
      p_run_id: job.runId,
      p_worker_id: "worker-a",
      p_lease_seconds: 60,
    });
  });

  it("maps heartbeat ownership failures to a safe typed error", async () => {
    const client = createClient(async () => ({
      data: null,
      error: {
        code: "42501",
        message: "processing job lease is not owned by this worker",
      },
      status: 401,
    }));
    const queue = new PostgresProcessingQueue(client, "worker-b", 60);

    await expect(queue.heartbeat(job)).rejects.toMatchObject({
      name: "ProcessingQueueError",
      code: "lease_not_owned",
      httpStatus: 401,
      rpcName: "heartbeat_processing_job",
    });
  });

  it("redacts bearer tokens, query text and source content from adapter errors", async () => {
    const client = createClient(async () => ({
      data: null,
      error: {
        code: "PGRST301",
        message:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb leaked; query=select raw_text from source_versions; source content: private chat body",
      },
      status: 500,
    }));
    const queue = new PostgresProcessingQueue(client, "worker-a", 60);

    try {
      await queue.claim(1);
      throw new Error("expected claim to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingQueueError);
      const queueError = error as ProcessingQueueError;
      expect(queueError.code).toBe("PGRST301");
      expect(queueError.httpStatus).toBe(500);
      expect(queueError.rpcName).toBe("claim_processing_jobs");
      expect(queueError.message).not.toMatch(/eyJ/);
      expect(queueError.message).not.toMatch(/Bearer/i);
      expect(queueError.message).not.toMatch(/raw_text/);
      expect(queueError.message).not.toMatch(/private chat body/);
    }
  });
});
