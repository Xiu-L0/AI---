import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { OcrRequest, OcrResult } from "@recall/contracts";

import { OcrProviderError, type OcrProvider } from "../providers/ocr-provider";
import type { OcrRepository, PersistedOcrResult } from "../repositories/ocr-repository";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import type { ClaimedJob } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import { createOcrAssetsProcessor } from "./ocr-assets";

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngSha = createHash("sha256").update(pngBytes).digest("hex");

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "00000000-0000-4000-8000-0000000000e1",
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-4000-8000-0000000000e1",
    jobType: "ocr_assets",
    attempt: 1,
    leaseExpiresAt: "2026-09-08T06:00:00.000Z",
    ...overrides,
  };
}

function attachment(index: number, mimeType = "image/png") {
  return {
    id: `50000000-0000-4000-8000-00000000000${index}`,
    clientId: `xhs-image-${index}`,
    fileName: `xhs-image-${index}.png`,
    mimeType,
    byteSize: pngBytes.byteLength,
    sha256: "a".repeat(64),
    storagePath: `00000000-0000-4000-8000-0000000000e1/xhs-image-${index}.png`,
  };
}

function xhs(overrides: Partial<ClaimedSource> = {}): ClaimedSource {
  return {
    item: {
      id: "10000000-0000-4000-8000-0000000000e1",
      title: "Synthetic XHS",
      source: null,
      sourcePlatform: "xiaohongshu",
      sourceKind: "social_post",
      sensitivity: "normal",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    version: {
      id: "30000000-0000-4000-8000-0000000000e1",
      sourceItemId: "10000000-0000-4000-8000-0000000000e1",
      missingElements: [],
      rawText: "synthetic xiaohongshu body",
      captureStatus: "complete",
      metadata: {
        author: "合成作者",
        canonicalUrl: "https://www.xiaohongshu.com/explore/note-1",
        assets: [
          { clientId: "xhs-image-1", ordinal: 0, alt: "" },
          { clientId: "xhs-image-2", ordinal: 1, alt: "" },
        ],
      },
    },
    messages: [],
    attachments: [attachment(1), attachment(2)],
    ...overrides,
  };
}

function ocrResult(requestId: string): OcrResult {
  return {
    provider: "zhipu",
    model: "glm-ocr",
    markdown: "Synthetic OCR markdown.",
    pages: [{ width: 600, height: 800 }],
    regions: [
      {
        page: 1,
        index: 0,
        label: "text",
        bbox: [0.1, 0.1, 0.5, 0.3],
        content: "Synthetic OCR markdown.",
        width: 600,
        height: 800,
      },
    ],
    requestId,
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
  };
}

function persisted(attachmentId: string): PersistedOcrResult {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    sourceAttachmentId: attachmentId,
    inputSha256: pngSha,
    provider: "zhipu",
    model: "glm-ocr",
    providerRequestId: "req-ocr-stored",
    markdown: "Synthetic OCR markdown.",
    layoutDetails: ocrResult("req-ocr-stored").regions,
    dataInfo: { pages: [{ width: 600, height: 800 }] },
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
  };
}

describe("createOcrAssetsProcessor", () => {
  it("skips a paid call when the same SHA/provider/model already exists", async () => {
    const recognize = vi.fn(async (_request: OcrRequest) => ocrResult("paid"));
    const persistResult = vi.fn(async () => persisted(attachment(1).id));
    const enqueueFollowupJob = vi.fn(async () => undefined);
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: false,
      convertWebpToPng: async () => pngBytes,
      sources: {
        loadClaimedSource: async () => xhs({ attachments: [attachment(1)] }),
        enqueueFollowupJob,
        replaceSourceBlocks: async () => undefined,
      } satisfies SourceRepository,
      ocr: {
        downloadAttachment: async () => pngBytes,
        findResult: async () => persisted(attachment(1).id),
        persistResult,
        listResults: async () => [],
      } satisfies OcrRepository,
      provider: { recognize } satisfies OcrProvider,
    });

    const result = await processor(job());
    expect(recognize).not.toHaveBeenCalled();
    expect(persistResult).not.toHaveBeenCalled();
    expect(enqueueFollowupJob).toHaveBeenCalledWith(job(), "build_source_blocks");
    expect(result.resultSummary).toBe("recognized 1 of 1 images");
  });

  it("converts WebP to PNG before the provider call", async () => {
    const recognize = vi.fn(async (request: OcrRequest) => {
      expect(request.mimeType).toBe("image/png");
      expect(request.bytes).toEqual(pngBytes);
      return ocrResult(request.requestId);
    });
    const convertWebpToPng = vi.fn(async () => pngBytes);
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: false,
      convertWebpToPng,
      sources: {
        loadClaimedSource: async () =>
          xhs({
            attachments: [attachment(1, "image/webp")],
            version: {
              ...xhs().version,
              metadata: {
                ...xhs().version.metadata,
                assets: [{ clientId: "xhs-image-1", ordinal: 0, alt: "" }],
              },
            },
          }),
        enqueueFollowupJob: async () => undefined,
        replaceSourceBlocks: async () => undefined,
      },
      ocr: {
        downloadAttachment: async () => Uint8Array.from([1, 2, 3]),
        findResult: async () => null,
        persistResult: async (_job, attachment, result) => persisted(attachment.id),
        listResults: async () => [],
      },
      provider: { recognize },
    });

    await processor(job());
    expect(convertWebpToPng).toHaveBeenCalledOnce();
    expect(recognize).toHaveBeenCalledOnce();
  });

  it("persists two images and enqueues one follow-up, skipping a completed image on retry", async () => {
    const recognize = vi.fn(async (request: OcrRequest) => ocrResult(request.requestId));
    const persistResult = vi.fn(async (_job, attachment, _result, _sha) => persisted(attachment.id));
    const known = new Set<string>();
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: false,
      convertWebpToPng: async () => pngBytes,
      sources: {
        loadClaimedSource: async () => xhs(),
        enqueueFollowupJob: async () => undefined,
        replaceSourceBlocks: async () => undefined,
      },
      ocr: {
        downloadAttachment: async () => pngBytes,
        findResult: async (input) => {
          if (known.has(input.attachmentId)) return persisted(input.attachmentId);
          return null;
        },
        persistResult: async (jobArg, attachment, result, sha) => {
          known.add(attachment.id);
          return persistResult(jobArg, attachment, result, sha);
        },
        listResults: async () => [],
      },
      provider: { recognize },
    });

    await processor(job());
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(persistResult).toHaveBeenCalledTimes(2);

    await processor(job());
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("pauses sensitive content when external AI is disallowed", async () => {
    const recognize = vi.fn(async () => ocrResult("paid"));
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: false,
      sources: {
        loadClaimedSource: async () =>
          xhs({
            item: { ...xhs().item, sensitivity: "sensitive" },
          }),
        enqueueFollowupJob: async () => {
          throw new Error("must not enqueue");
        },
        replaceSourceBlocks: async () => undefined,
      },
      ocr: {
        downloadAttachment: async () => pngBytes,
        findResult: async () => null,
        persistResult: async () => persisted(attachment(1).id),
        listResults: async () => [],
      },
      provider: { recognize },
    });

    await expect(processor(job())).rejects.toBeInstanceOf(ProcessorError);
    await expect(processor(job())).rejects.toMatchObject({
      code: "paused_sensitive_external_ai",
      retryable: false,
    });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("calls the provider for strictly sensitive content when external AI is allowed", async () => {
    const recognize = vi.fn(async (request: OcrRequest) => ocrResult(request.requestId));
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: true,
      convertWebpToPng: async () => pngBytes,
      sources: {
        loadClaimedSource: async () =>
          xhs({
            item: { ...xhs().item, sensitivity: "strictly_sensitive" },
            attachments: [attachment(1)],
          }),
        enqueueFollowupJob: async () => undefined,
        replaceSourceBlocks: async () => undefined,
      },
      ocr: {
        downloadAttachment: async () => pngBytes,
        findResult: async () => null,
        persistResult: async (_job, current) => persisted(current.id),
        listResults: async () => [],
      },
      provider: { recognize },
    });

    await processor(job());
    expect(recognize).toHaveBeenCalledOnce();
  });

  it("does not recall a completed image after a later image fails", async () => {
    let failOnce = true;
    const recognize = vi.fn(async (request: OcrRequest) => {
      if (known.size >= 1 && failOnce) {
        failOnce = false;
        throw new OcrProviderError({
          code: "ocr_http_429",
          message: "zhipu HTTP 429",
          retryable: true,
          httpStatus: 429,
        });
      }
      return ocrResult(request.requestId);
    });
    const known = new Set<string>();
    const processor = createOcrAssetsProcessor({
      allowSensitiveExternalAi: false,
      convertWebpToPng: async () => pngBytes,
      sources: {
        loadClaimedSource: async () => xhs(),
        enqueueFollowupJob: async () => undefined,
        replaceSourceBlocks: async () => undefined,
      },
      ocr: {
        downloadAttachment: async (_job, current) => {
          if (current.clientId === "xhs-image-2") {
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });
          }
          return pngBytes;
        },
        findResult: async (input) => {
          if (known.has(input.attachmentId)) return persisted(input.attachmentId);
          return null;
        },
        persistResult: async (_job, current) => {
          known.add(current.id);
          return persisted(current.id);
        },
        listResults: async () => [],
      },
      provider: { recognize },
    });

    await expect(processor(job())).rejects.toMatchObject({
      code: "ocr_http_429",
      retryable: true,
    });
    expect(known.size).toBe(1);

    await processor(job());
    expect(recognize).toHaveBeenCalledTimes(3);
    expect(known.size).toBe(2);
  });
});
