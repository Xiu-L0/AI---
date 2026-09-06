import type { ClaimedJob, JobProcessor, ProcessingResult } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";

export type NormalizedMessageRole = "user" | "assistant" | "system" | "tool";

export type NormalizedSourceV1 = {
  schemaVersion: "normalized-source.v1";
  sourceVersionId: string;
  title: string;
  messages: Array<{
    sourceMessageId: string;
    externalMessageId: string;
    ordinal: number;
    role: NormalizedMessageRole;
    body: string;
  }>;
  missingElements: string[];
};

const FENCE = "```";

function normalizeProse(text: string) {
  return text
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeMessageBody(body: string) {
  const segments: string[] = [];
  let index = 0;

  while (index < body.length) {
    if (body.startsWith(FENCE, index)) {
      const close = body.indexOf(FENCE, index + FENCE.length);
      if (close !== -1) {
        segments.push(body.slice(index, close + FENCE.length));
        index = close + FENCE.length;
        continue;
      }
    }

    const nextFence = body.indexOf(FENCE, index);
    const prose = nextFence === -1 ? body.slice(index) : body.slice(index, nextFence);
    const normalized = normalizeProse(prose);
    if (normalized !== "") {
      segments.push(normalized);
    }
    index = nextFence === -1 ? body.length : nextFence;
  }

  return segments.join("\n\n");
}

export function normalizeSource(source: ClaimedSource): NormalizedSourceV1 {
  if (source.item.source !== "chatgpt_web") {
    throw new ProcessorError(
      "unsupported_source",
      `Stage 1B only normalizes chatgpt_web sources`,
      false,
    );
  }

  const messages = [...source.messages]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((message) => ({
      sourceMessageId: message.id,
      externalMessageId: message.externalMessageId,
      ordinal: message.ordinal,
      role: message.role,
      body: normalizeMessageBody(message.body),
    }));

  return {
    schemaVersion: "normalized-source.v1",
    sourceVersionId: source.version.id,
    title: source.item.title,
    messages,
    missingElements: [...source.version.missingElements],
  };
}

export function createNormalizeSourceProcessor(
  repository: SourceRepository,
): JobProcessor {
  return async (job: ClaimedJob): Promise<ProcessingResult> => {
    const source = await repository.loadClaimedSource(job);
    const normalized = normalizeSource(source);
    await repository.enqueueFollowupJob(job, "build_source_blocks");
    return {
      resultSummary: `normalized ${normalized.messages.length} messages`,
    };
  };
}
