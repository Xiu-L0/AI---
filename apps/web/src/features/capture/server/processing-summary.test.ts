import { describe, expect, it } from "vitest";

import {
  ocrProgressLabel,
  processingExceptionHeading,
  summarizeProcessingJobs,
  type ProcessingJobSnapshot,
} from "./processing-summary";

function job(
  overrides: Partial<ProcessingJobSnapshot> &
    Pick<ProcessingJobSnapshot, "jobType" | "status">,
): ProcessingJobSnapshot {
  return {
    failureReason: null,
    updatedAt: "2026-09-08T01:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeProcessingJobs", () => {
  it("selects a failed OCR job over a completed normalize job", () => {
    expect(
      summarizeProcessingJobs([
        job({
          jobType: "normalize_source",
          status: "complete",
          failureReason: null,
          updatedAt: "2026-09-08T01:00:00Z",
        }),
        job({
          jobType: "ocr_assets",
          status: "failed",
          failureReason: "provider timeout",
          updatedAt: "2026-09-08T01:01:00Z",
        }),
      ]),
    ).toMatchObject({
      status: "failed",
      failedJobType: "ocr_assets",
      failureReason: "provider timeout",
    });
  });

  it("uses failed > processing > queued > paused > complete", () => {
    const jobs = [
      job({ jobType: "normalize_source", status: "complete" }),
      job({
        jobType: "build_source_blocks",
        status: "queued",
        updatedAt: "2026-09-08T01:02:00Z",
      }),
      job({
        jobType: "ocr_assets",
        status: "processing",
        updatedAt: "2026-09-08T01:03:00Z",
      }),
      job({
        jobType: "extract_knowledge",
        status: "paused",
        updatedAt: "2026-09-08T01:04:00Z",
      }),
    ];
    expect(summarizeProcessingJobs(jobs).status).toBe("processing");
    expect(
      summarizeProcessingJobs([
        ...jobs,
        job({
          jobType: "ocr_assets",
          status: "failed",
          failureReason: "glm timeout",
          updatedAt: "2026-09-08T01:05:00Z",
        }),
      ]),
    ).toMatchObject({ status: "failed", failedJobType: "ocr_assets" });
  });

  it("returns complete only when every current job is complete", () => {
    expect(
      summarizeProcessingJobs([
        job({ jobType: "normalize_source", status: "complete" }),
        job({ jobType: "ocr_assets", status: "complete" }),
      ]),
    ).toMatchObject({ status: "complete", failedJobType: null });
  });

  it("treats an empty job list as paused instead of complete", () => {
    expect(summarizeProcessingJobs([])).toMatchObject({
      status: "paused",
      failedJobType: null,
    });
  });
});

describe("ocrProgressLabel", () => {
  it("describes queued, in-flight, complete and failed OCR", () => {
    expect(
      ocrProgressLabel({
        ocrJob: job({ jobType: "ocr_assets", status: "queued" }),
        eligibleImageCount: 2,
        recognizedCount: 0,
      }),
    ).toBe("等待图片识别");
    expect(
      ocrProgressLabel({
        ocrJob: job({ jobType: "ocr_assets", status: "processing" }),
        eligibleImageCount: 2,
        recognizedCount: 0,
      }),
    ).toBe("正在识别第 1 张");
    expect(
      ocrProgressLabel({
        ocrJob: job({ jobType: "ocr_assets", status: "complete" }),
        eligibleImageCount: 2,
        recognizedCount: 2,
      }),
    ).toBe("图片识别完成");
    expect(
      ocrProgressLabel({
        ocrJob: job({
          jobType: "ocr_assets",
          status: "failed",
          failureReason: "provider timeout",
        }),
        eligibleImageCount: 2,
        recognizedCount: 1,
      }),
    ).toBe("图片识别失败");
  });
});

describe("processingExceptionHeading", () => {
  it("labels OCR failures distinctly", () => {
    expect(processingExceptionHeading("ocr_assets")).toBe("图片识别失败");
    expect(processingExceptionHeading("extract_knowledge")).toBe(
      "原文已保存，后台处理失败",
    );
  });
});
