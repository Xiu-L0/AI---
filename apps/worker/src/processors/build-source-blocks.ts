import { createHash } from "node:crypto";

import type { OcrResult } from "@recall/contracts";
import { OcrResultSchema } from "@recall/contracts";

import type { PersistedOcrResult, OcrRepository } from "../repositories/ocr-repository";
import type { ClaimedSource, SourceBlockDraft, SourceRepository } from "../repositories/source-repository";
import type { ClaimedJob, JobProcessor, ProcessingResult } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import { isChatGptSource, isXiaohongshuSource, normalizeSource, type NormalizedSourceV1 } from "./normalize-source";

export function hashMessageBlock(role: string, body: string) {
  return createHash("sha256")
    .update(`message\0${role}\0${body}`, "utf8")
    .digest("hex");
}

export function hashSocialBlock(kind: string, text: string, extra = "") {
  return createHash("sha256")
    .update(`${kind}\0${text}\0${extra}`, "utf8")
    .digest("hex");
}

export function buildSourceBlocks(normalized: NormalizedSourceV1): SourceBlockDraft[] {
  return normalized.messages.map((message) => ({
    sourceMessageId: message.sourceMessageId,
    sourceAttachmentId: null,
    blockType: "message",
    ordinal: message.ordinal,
    locatorKey: `message:${message.externalMessageId}/body`,
    locatorJson: {
      sourceMessageId: message.sourceMessageId,
      externalMessageId: message.externalMessageId,
      role: message.role,
      ordinal: message.ordinal,
    },
    textContent: message.body,
    contentHash: hashMessageBlock(message.role, message.body),
  }));
}

function metadataString(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function parsePersistedRegions(result: PersistedOcrResult): OcrResult["regions"] {
  const parsed = OcrResultSchema.safeParse({
    provider: "zhipu",
    model: "glm-ocr",
    markdown: result.markdown,
    pages: Array.isArray((result.dataInfo as { pages?: unknown })?.pages)
      ? (result.dataInfo as { pages: OcrResult["pages"] }).pages
      : [{ width: 1, height: 1 }],
    regions: result.layoutDetails,
    requestId: result.providerRequestId,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  });
  if (parsed.success) return parsed.data.regions;
  if (Array.isArray(result.layoutDetails)) {
    return result.layoutDetails as OcrResult["regions"];
  }
  return [];
}

export function buildSocialPostBlocks(
  source: ClaimedSource,
  ocrResults: PersistedOcrResult[],
): SourceBlockDraft[] {
  const metadata = source.version.metadata ?? {};
  const author = metadataString(metadata, "author");
  const canonicalUrl = metadataString(metadata, "canonicalUrl");
  const body = source.version.rawText.trim();
  const blocks: SourceBlockDraft[] = [
    {
      sourceMessageId: null,
      sourceAttachmentId: null,
      blockType: "paragraph",
      ordinal: 0,
      locatorKey: "post:body",
      locatorJson: { kind: "body" },
      textContent: body,
      contentHash: hashSocialBlock("paragraph", body),
    },
    {
      sourceMessageId: null,
      sourceAttachmentId: null,
      blockType: "metadata",
      ordinal: 1,
      locatorKey: "post:metadata",
      locatorJson: { author, canonicalUrl },
      textContent: [author, canonicalUrl].filter((value) => value.length > 0).join("\n"),
      contentHash: hashSocialBlock("metadata", `${author}\n${canonicalUrl}`),
    },
  ];

  const attachmentsById = new Map(source.attachments.map((attachment) => [attachment.id, attachment]));
  let ordinal = 2;
  for (const result of ocrResults) {
    const attachment = attachmentsById.get(result.sourceAttachmentId);
    const regions = parsePersistedRegions(result).filter(
      (region) =>
        region.label !== "image" &&
        region.content.trim() !== "",
    );
    for (const region of regions) {
      const bboxKey = region.bbox.join(",");
      blocks.push({
        sourceMessageId: null,
        sourceAttachmentId: result.sourceAttachmentId,
        blockType: "ocr_region",
        ordinal,
        locatorKey: `image:${attachment?.clientId ?? result.sourceAttachmentId}/page:${region.page}/region:${region.index}`,
        locatorJson: {
          page: region.page,
          index: region.index,
          label: region.label,
          bbox: region.bbox,
          provider: result.provider,
          model: result.model,
          sourceAttachmentId: result.sourceAttachmentId,
        },
        textContent: region.content,
        contentHash: hashSocialBlock("ocr_region", region.content, bboxKey),
      });
      ordinal += 1;
    }
  }

  return blocks;
}

export function createBuildSourceBlocksProcessor(
  repository: SourceRepository,
  ocr: OcrRepository,
): JobProcessor {
  return async (job: ClaimedJob): Promise<ProcessingResult> => {
    const source = await repository.loadClaimedSource(job);
    let blocks: SourceBlockDraft[];
    if (isChatGptSource(source)) {
      blocks = buildSourceBlocks(normalizeSource(source));
    } else if (isXiaohongshuSource(source)) {
      const results = await ocr.listResults(job);
      blocks = buildSocialPostBlocks(source, results);
    } else {
      throw new ProcessorError(
        "unsupported_source",
        "No block builder is registered for this source identity",
        false,
      );
    }
    await repository.replaceSourceBlocks(job, blocks);
    return {
      resultSummary: `persisted ${blocks.length} source blocks`,
    };
  };
}
