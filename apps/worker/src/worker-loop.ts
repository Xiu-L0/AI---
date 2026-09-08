export type ClaimedJob = {
  jobId: string;
  runId: string;
  ownerUserId: string;
  spaceId: string;
  sourceVersionId: string;
  jobType: string;
  attempt: number;
  leaseExpiresAt: string;
};

export type ProcessingResult = {
  resultSummary: string;
  usageJson?: Record<string, unknown>;
};

export type ProcessingFailure = {
  errorCode: string;
  errorDetail: string;
  retryable: boolean;
};

export interface ProcessingQueue {
  claim(limit: number): Promise<ClaimedJob[]>;
  heartbeat(job: ClaimedJob): Promise<void>;
  complete(job: ClaimedJob, result: ProcessingResult): Promise<void>;
  fail(job: ClaimedJob, failure: ProcessingFailure): Promise<void>;
}

export type JobProcessor = (job: ClaimedJob) => Promise<ProcessingResult>;

export type WorkerClock = {
  now(): Date;
};

export type WorkerLoopOptions = {
  queue: ProcessingQueue;
  processors: Readonly<Record<string, JobProcessor>>;
  batchSize: number;
  pollIntervalMs: number;
  heartbeatIntervalMs?: number;
  clock: WorkerClock;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
};

export class UnknownJobTypeError extends Error {
  readonly code = "unknown_job_type";
  readonly retryable = false;

  constructor(jobType: string) {
    super(`No processor registered for ${jobType}`);
    this.name = "UnknownJobTypeError";
  }
}

export class ProcessorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ProcessorError";
    this.code = code;
    this.retryable = retryable;
  }
}

function toFailure(error: unknown): ProcessingFailure {
  if (error instanceof UnknownJobTypeError || error instanceof ProcessorError) {
    return {
      errorCode: error.code,
      errorDetail: error.message.slice(0, 2000),
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      errorCode: "processor_failed",
      errorDetail: error.message.slice(0, 2000),
      retryable: true,
    };
  }

  return {
    errorCode: "processor_failed",
    errorDetail: "unknown processor failure",
    retryable: true,
  };
}

function isLeaseLoss(error: unknown) {
  return (
    error instanceof Error &&
    (/lease/i.test(error.message) || ("code" in error && error.code === "lease_not_owned"))
  );
}

async function withHeartbeat<T>(
  queue: ProcessingQueue,
  job: ClaimedJob,
  heartbeatIntervalMs: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (heartbeatIntervalMs === undefined || heartbeatIntervalMs <= 0) {
    return work();
  }

  let stopped = false;
  const heartbeatState: { inFlight: Promise<void> | null } = { inFlight: null };
  let leaseLost: unknown = null;
  const timer = setInterval(() => {
    if (stopped || heartbeatState.inFlight !== null) return;
    heartbeatState.inFlight = queue
      .heartbeat(job)
      .catch((error) => {
        leaseLost = error;
      })
      .finally(() => {
        heartbeatState.inFlight = null;
      });
  }, heartbeatIntervalMs);

  try {
    const result = await work();
    if (leaseLost !== null) {
      throw leaseLost instanceof Error
        ? leaseLost
        : new ProcessorError("lease_not_owned", "OCR heartbeat lost the processing lease", false);
    }
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    if (heartbeatState.inFlight !== null) {
      await heartbeatState.inFlight.catch(() => undefined);
    }
  }
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const { queue, processors, batchSize, pollIntervalMs, heartbeatIntervalMs, sleep, signal } =
    options;

  while (!signal.aborted) {
    const jobs = await queue.claim(batchSize);
    if (signal.aborted) {
      return;
    }

    if (jobs.length === 0) {
      await sleep(pollIntervalMs);
      continue;
    }

    for (const job of jobs) {
      const processor = processors[job.jobType];
      try {
        if (!processor) {
          throw new UnknownJobTypeError(job.jobType);
        }
        const result = await withHeartbeat(queue, job, heartbeatIntervalMs, () => processor(job));
        await queue.complete(job, result);
      } catch (error) {
        const failure = isLeaseLoss(error)
          ? {
              errorCode: "lease_not_owned",
              errorDetail: "Processing lease was lost during heartbeat",
              retryable: false,
            }
          : toFailure(error);
        await queue.fail(job, failure);
      }
    }
  }
}

export function installWorkerShutdown(abort: AbortController): () => void {
  const onStop = () => {
    abort.abort();
  };
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  return () => {
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
  };
}
