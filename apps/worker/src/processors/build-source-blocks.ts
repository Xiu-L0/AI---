import { createHash } from "node:crypto";

import type { ClaimedJob, JobProcessor, ProcessingResult } from "../worker-loop";
import type { SourceBlockDraft, SourceRepository } from "../repositories/source-repository";
import { normalizeSource, type NormalizedSourceV1 } from "./normalize-source";

export function hashMessageBlock(role: string, body: string) {
  return createHash("sha256")
    .update(`message\0${role}\0${body}`, "utf8")
    .digest("hex");
}

export function buildSourceBlocks(normalized: NormalizedSourceV1): SourceBlockDraft[] {
  return normalized.messages.map((message) => ({
    sourceMessageId: message.sourceMessageId,
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

export function createBuildSourceBlocksProcessor(
  repository: SourceRepository,
): JobProcessor {
  return async (job: ClaimedJob): Promise<ProcessingResult> => {
    const source = await repository.loadClaimedSource(job);
    const blocks = buildSourceBlocks(normalizeSource(source));
    await repository.replaceSourceBlocks(job, blocks);
    return {
      resultSummary: `persisted ${blocks.length} source blocks`,
    };
  };
}
