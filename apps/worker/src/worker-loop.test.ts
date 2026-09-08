import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWorkerShutdown,
  runWorkerLoop,
  type ClaimedJob,
  type ProcessingFailure,
  type ProcessingQueue,
  type ProcessingResult,
} from "./worker-loop";

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    runId: "22222222-2222-2222-2222-222222222222",
    ownerUserId: "00000000-0000-0000-0000-0000000000b1",
    spaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-0000-0000-0000000000b1",
    jobType: "normalize_source",
    attempt: 1,
    leaseExpiresAt: "2026-09-06T06:00:00.000Z",
    ...overrides,
  };
}

function createQueue(claimImpl: ProcessingQueue["claim"]): {
  queue: ProcessingQueue;
  completed: Array<{ job: ClaimedJob; result: ProcessingResult }>;
  failed: Array<{ job: ClaimedJob; failure: ProcessingFailure }>;
} {
  const completed: Array<{ job: ClaimedJob; result: ProcessingResult }> = [];
  const failed: Array<{ job: ClaimedJob; failure: ProcessingFailure }> = [];
  return {
    completed,
    failed,
    queue: {
      claim: claimImpl,
      async heartbeat() {
        return undefined;
      },
      async complete(claimed, result) {
        completed.push({ job: claimed, result });
      },
      async fail(claimed, failure) {
        failed.push({ job: claimed, failure });
      },
    },
  };
}

describe("runWorkerLoop", () => {
  it("claims a bounded batch and completes a matching processor", async () => {
    const claimed = job();
    const abort = new AbortController();
    let claimCount = 0;
    const { queue, completed, failed } = createQueue(async (limit) => {
      claimCount += 1;
      expect(limit).toBe(2);
      if (claimCount === 1) {
        return [claimed];
      }
      abort.abort();
      return [];
    });
    const processor = vi.fn(async () => ({ resultSummary: "normalized" }));

    await runWorkerLoop({
      queue,
      processors: { normalize_source: processor },
      batchSize: 2,
      pollIntervalMs: 1500,
      clock: { now: () => new Date("2026-09-06T06:00:00.000Z") },
      sleep: async () => {
        abort.abort();
      },
      signal: abort.signal,
    });

    expect(processor).toHaveBeenCalledWith(claimed);
    expect(completed).toEqual([
      { job: claimed, result: { resultSummary: "normalized" } },
    ]);
    expect(failed).toEqual([]);
  });

  it("fails unknown job types without retry and does not complete them", async () => {
    const claimed = job({ jobType: "suggest_topics" });
    const abort = new AbortController();
    let claimCount = 0;
    const { queue, completed, failed } = createQueue(async () => {
      claimCount += 1;
      if (claimCount === 1) {
        return [claimed];
      }
      abort.abort();
      return [];
    });

    await runWorkerLoop({
      queue,
      processors: {
        normalize_source: async () => ({ resultSummary: "unused" }),
      },
      batchSize: 1,
      pollIntervalMs: 1500,
      clock: { now: () => new Date("2026-09-06T06:00:00.000Z") },
      sleep: async () => {
        abort.abort();
      },
      signal: abort.signal,
    });

    expect(completed).toEqual([]);
    expect(failed).toEqual([
      {
        job: claimed,
        failure: {
          errorCode: "unknown_job_type",
          errorDetail: "No processor registered for suggest_topics",
          retryable: false,
        },
      },
    ]);
  });

  it("sleeps on an empty claim using the injected sleeper", async () => {
    const abort = new AbortController();
    const slept: number[] = [];
    const { queue } = createQueue(async () => []);

    await runWorkerLoop({
      queue,
      processors: {},
      batchSize: 5,
      pollIntervalMs: 2500,
      clock: { now: () => new Date("2026-09-06T06:00:00.000Z") },
      sleep: async (ms) => {
        slept.push(ms);
        abort.abort();
      },
      signal: abort.signal,
    });

    expect(slept).toEqual([2500]);
  });

  it("does not claim after the shutdown signal is raised", async () => {
    const abort = new AbortController();
    abort.abort();
    const claim = vi.fn(async () => [job()]);
    const { queue, completed } = createQueue(claim);

    await runWorkerLoop({
      queue,
      processors: {
        normalize_source: async () => ({ resultSummary: "normalized" }),
      },
      batchSize: 1,
      pollIntervalMs: 1500,
      clock: { now: () => new Date("2026-09-06T06:00:00.000Z") },
      sleep: async () => undefined,
      signal: abort.signal,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(completed).toEqual([]);
  });
});

describe("runWorkerLoop heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a long OCR job leased and leaves no timer after complete", async () => {
    vi.useFakeTimers();
    const claimed = job({ jobType: "ocr_assets" });
    const abort = new AbortController();
    let claimCount = 0;
    const heartbeat = vi.fn(async () => undefined);
    const { queue, completed, failed } = createQueue(async () => {
      claimCount += 1;
      if (claimCount === 1) return [claimed];
      abort.abort();
      return [];
    });
    queue.heartbeat = heartbeat;

    const loop = runWorkerLoop({
      queue,
      processors: {
        ocr_assets: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 130_000);
          });
          return { resultSummary: "recognized 1 of 1 images" };
        },
      },
      batchSize: 1,
      pollIntervalMs: 1500,
      heartbeatIntervalMs: 40_000,
      clock: { now: () => new Date("2026-09-08T06:00:00.000Z") },
      sleep: async () => {
        abort.abort();
      },
      signal: abort.signal,
    });

    await vi.advanceTimersByTimeAsync(130_000);
    await loop;

    expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(completed).toHaveLength(1);
    expect(failed).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("fails the job when heartbeat loses the lease", async () => {
    vi.useFakeTimers();
    const claimed = job({ jobType: "ocr_assets" });
    const abort = new AbortController();
    let claimCount = 0;
    const { queue, completed, failed } = createQueue(async () => {
      claimCount += 1;
      if (claimCount === 1) return [claimed];
      abort.abort();
      return [];
    });
    queue.heartbeat = vi.fn(async () => {
      const error = new Error("Queue RPC lease is not owned by this worker");
      (error as Error & { code: string }).code = "lease_not_owned";
      throw error;
    });

    const loop = runWorkerLoop({
      queue,
      processors: {
        ocr_assets: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 80_000);
          });
          return { resultSummary: "should not complete" };
        },
      },
      batchSize: 1,
      pollIntervalMs: 1500,
      heartbeatIntervalMs: 40_000,
      clock: { now: () => new Date("2026-09-08T06:00:00.000Z") },
      sleep: async () => {
        abort.abort();
      },
      signal: abort.signal,
    });

    await vi.advanceTimersByTimeAsync(80_000);
    await loop;

    expect(completed).toEqual([]);
    expect(failed[0]?.failure.errorCode).toBe("lease_not_owned");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("installWorkerShutdown", () => {
  it("aborts on SIGTERM without waiting", () => {
    const abort = new AbortController();
    const restore = installWorkerShutdown(abort);
    process.emit("SIGTERM");
    expect(abort.signal.aborted).toBe(true);
    restore();
  });
});
