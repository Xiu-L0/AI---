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

function toFailure(error: unknown): ProcessingFailure {
  if (error instanceof UnknownJobTypeError) {
    return {
      errorCode: error.code,
      errorDetail: error.message,
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

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const { queue, processors, batchSize, pollIntervalMs, sleep, signal } = options;

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
        const result = await processor(job);
        await queue.complete(job, result);
      } catch (error) {
        await queue.fail(job, toFailure(error));
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
