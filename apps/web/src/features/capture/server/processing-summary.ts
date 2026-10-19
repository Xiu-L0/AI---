import type { Database } from "@/lib/supabase/database.types";

export type ProcessingStatus = Database["public"]["Enums"]["processing_state"];

export type ProcessingJobSnapshot = {
  jobType: string;
  status: ProcessingStatus;
  failureReason: string | null;
  updatedAt: string;
};

export type ProcessingSummary = {
  status: ProcessingStatus;
  failedJobType: string | null;
  failureReason: string | null;
  updatedAt: string | null;
};

const STATUS_RANK: Record<ProcessingStatus, number> = {
  failed: 0,
  processing: 1,
  queued: 2,
  paused: 3,
  complete: 4,
};

function laterTimestamp(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

export function summarizeProcessingJobs(
  jobs: ProcessingJobSnapshot[],
): ProcessingSummary {
  if (jobs.length === 0) {
    return {
      status: "paused",
      failedJobType: null,
      failureReason: null,
      updatedAt: null,
    };
  }

  const byRank = [...jobs].sort((left, right) => {
    const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];
    if (rank !== 0) return rank;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  const selected = byRank[0]!;
  const latestFailure = [...jobs]
    .filter((job) => job.status === "failed" || job.status === "paused")
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    )[0];

  const latestUpdatedAt = jobs.reduce(
    (latest, job) => laterTimestamp(latest, job.updatedAt),
    jobs[0]!.updatedAt,
  );

  if (selected.status === "complete") {
    const allComplete = jobs.every((job) => job.status === "complete");
    if (allComplete) {
      return {
        status: "complete",
        failedJobType: null,
        failureReason: null,
        updatedAt: latestUpdatedAt,
      };
    }
  }

  return {
    status: selected.status,
    failedJobType: latestFailure?.jobType ?? null,
    failureReason: latestFailure?.failureReason ?? selected.failureReason,
    updatedAt: selected.updatedAt,
  };
}

export function ocrProgressLabel(input: {
  ocrJob: ProcessingJobSnapshot | null;
  eligibleImageCount: number;
  recognizedCount: number;
}): string | null {
  if (input.ocrJob === null || input.eligibleImageCount <= 0) return null;
  switch (input.ocrJob.status) {
    case "queued":
      return "等待图片识别";
    case "processing": {
      const current = Math.min(
        input.eligibleImageCount,
        Math.max(1, input.recognizedCount + 1),
      );
      return `正在识别第 ${current} 张`;
    }
    case "complete":
      return "图片识别完成";
    case "failed":
    case "paused":
      return "图片识别失败";
    default:
      return null;
  }
}

export function processingExceptionHeading(jobType: string | null) {
  if (jobType === "ocr_assets") return "图片识别失败";
  return "原文已保存，后台处理失败";
}
