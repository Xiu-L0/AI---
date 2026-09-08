import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import type { OcrResult } from "@recall/contracts";

import { OcrProviderError, type OcrProvider } from "../providers/ocr-provider";
import type { ClaimedAttachment, OcrRepository } from "../repositories/ocr-repository";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import type { ClaimedJob, JobProcessor, ProcessingResult } from "../worker-loop";
import { ProcessorError } from "../worker-loop";

const ELIGIBLE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const SENSITIVE = new Set(["sensitive", "strictly_sensitive"]);

export type OcrAssetsProcessorOptions = {
  sources: SourceRepository;
  ocr: OcrRepository;
  provider: OcrProvider;
  allowSensitiveExternalAi: boolean;
  convertWebpToPng?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetOrdinals(source: ClaimedSource) {
  const assets = source.version.metadata?.assets;
  const map = new Map<string, number>();
  if (!Array.isArray(assets)) return map;
  for (const asset of assets) {
    if (
      asset &&
      typeof asset === "object" &&
      "clientId" in asset &&
      typeof asset.clientId === "string" &&
      "ordinal" in asset &&
      typeof asset.ordinal === "number"
    ) {
      map.set(asset.clientId, asset.ordinal);
    }
  }
  return map;
}

export function eligibleOcrAttachments(source: ClaimedSource): ClaimedAttachment[] {
  const ordinals = assetOrdinals(source);
  return source.attachments
    .filter((attachment) => ELIGIBLE_MIME.has(attachment.mimeType) && ordinals.has(attachment.clientId))
    .sort(
      (left, right) => (ordinals.get(left.clientId) ?? 0) - (ordinals.get(right.clientId) ?? 0),
    );
}

async function defaultWebpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  return new Uint8Array(await sharp(bytes).png().toBuffer());
}

function toProcessorError(error: unknown): never {
  if (error instanceof ProcessorError) throw error;
  if (error instanceof OcrProviderError) {
    throw new ProcessorError(error.code, error.message, error.retryable);
  }
  throw error;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(
    items.length,
  );
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index]!) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

export function createOcrAssetsProcessor(options: OcrAssetsProcessorOptions): JobProcessor {
  const convertWebpToPng = options.convertWebpToPng ?? defaultWebpToPng;

  return async (job: ClaimedJob): Promise<ProcessingResult> => {
    const source = await options.sources.loadClaimedSource(job);
    if (SENSITIVE.has(source.item.sensitivity) && !options.allowSensitiveExternalAi) {
      throw new ProcessorError(
        "paused_sensitive_external_ai",
        "Sensitive OCR is paused until ALLOW_SENSITIVE_EXTERNAL_AI=true",
        false,
      );
    }

    const eligible = eligibleOcrAttachments(source);
    if (eligible.length === 0) {
      await options.sources.enqueueFollowupJob(job, "build_source_blocks");
      return { resultSummary: "recognized 0 of 0 images" };
    }

    const outcomes = await mapPool(eligible, 2, async (attachment) => {
      const downloaded = await options.ocr.downloadAttachment(job, attachment);
      let bytes = downloaded;
      let mimeType: "image/jpeg" | "image/png" = attachment.mimeType === "image/jpeg"
        ? "image/jpeg"
        : "image/png";
      if (attachment.mimeType === "image/webp") {
        bytes = await convertWebpToPng(downloaded);
        mimeType = "image/png";
      } else if (attachment.mimeType !== "image/jpeg" && attachment.mimeType !== "image/png") {
        throw new ProcessorError("unsupported_ocr_mime", "OCR only accepts JPEG, PNG or WebP", false);
      }

      const inputSha256 = sha256Hex(bytes);
      const existing = await options.ocr.findResult({
        job,
        attachmentId: attachment.id,
        inputSha256,
        provider: "zhipu",
        model: "glm-ocr",
      });
      if (existing) return existing;

      let recognized: OcrResult;
      try {
        recognized = await options.provider.recognize({
          bytes,
          mimeType,
          requestId: randomUUID().replace(/-/g, "").slice(0, 24),
        });
      } catch (error) {
        toProcessorError(error);
      }
      return options.ocr.persistResult(job, attachment, recognized, inputSha256);
    });

    const firstFailure = outcomes.find((outcome) => outcome && !outcome.ok);
    if (firstFailure && !firstFailure.ok) {
      toProcessorError(firstFailure.error);
    }

    const completed = outcomes.filter((outcome) => outcome?.ok).length;
    await options.sources.enqueueFollowupJob(job, "build_source_blocks");
    const usage = outcomes.reduce(
      (sum, outcome) => {
        if (!outcome?.ok) return sum;
        const value = outcome.value as { usage?: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null } };
        return {
          images: sum.images + 1,
          inputTokens: sum.inputTokens + (value.usage?.inputTokens ?? 0),
          outputTokens: sum.outputTokens + (value.usage?.outputTokens ?? 0),
          totalTokens: sum.totalTokens + (value.usage?.totalTokens ?? 0),
        };
      },
      { images: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );

    return {
      resultSummary: `recognized ${completed} of ${eligible.length} images`,
      usageJson: usage,
    };
  };
}
