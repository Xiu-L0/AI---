import { createHash } from "node:crypto";

import {
  KnowledgeClaimPathToDb,
  KnowledgeExtractionResultSchema,
  type KnowledgeExtractionResult,
} from "@recall/contracts";

import { buildKnowledgeExtractionPrompt, promptVersion } from "../prompts/knowledge-extraction-v1";
import {
  TextModelError,
  type StructuredGenerationResult,
  type TextModelProvider,
} from "../providers/text-model-provider";
import type {
  KnowledgePersistDraft,
  KnowledgeRepository,
  KnowledgeSourceBlock,
} from "../repositories/knowledge-repository";
import type { SourceRepository } from "../repositories/source-repository";
import type { ClaimedJob, JobProcessor, ProcessingResult } from "../worker-loop";
import { ProcessorError } from "../worker-loop";

export const EXTRACTION_CHAR_BUDGET = 24_000;
const REPAIRABLE_CODES = new Set(["invalid_json", "invalid_schema", "empty_content", "truncated"]);

export type ExtractionWindow = {
  blocks: KnowledgeSourceBlock[];
  inputScope: {
    mode: "all" | "window";
    startOrdinal: number;
    endOrdinal: number;
    blockCount: number;
    characterCount: number;
    locatorKeys: string[];
  };
};

export function buildExtractionKey(input: {
  sourceVersionId: string;
  promptVersion: string;
  ordinal: number;
  title: string;
  knowledgeType: string;
}) {
  return createHash("sha256")
    .update(
      `${input.sourceVersionId}\0${input.promptVersion}\0${input.ordinal}\0${input.title.trim()}\0${input.knowledgeType}`,
      "utf8",
    )
    .digest("hex");
}

export function selectExtractionWindow(
  blocks: KnowledgeSourceBlock[],
  budget = EXTRACTION_CHAR_BUDGET,
): ExtractionWindow {
  const sorted = [...blocks].sort((left, right) => left.ordinal - right.ordinal);
  const selected: KnowledgeSourceBlock[] = [];
  let characterCount = 0;

  for (const block of sorted) {
    const size = block.text.length;
    if (selected.length > 0 && characterCount + size > budget) {
      break;
    }
    selected.push(block);
    characterCount += size;
    if (selected.length === 1 && characterCount > budget) {
      break;
    }
  }

  const locatorKeys = selected.map((block) => block.locatorKey);
  return {
    blocks: selected,
    inputScope: {
      mode: selected.length === sorted.length ? "all" : "window",
      startOrdinal: selected[0]?.ordinal ?? 0,
      endOrdinal: selected.at(-1)?.ordinal ?? 0,
      blockCount: selected.length,
      characterCount,
      locatorKeys,
    },
  };
}

function toProcessorError(error: unknown): never {
  if (error instanceof ProcessorError) {
    throw error;
  }
  if (error instanceof TextModelError) {
    throw new ProcessorError(error.code, error.message, error.retryable);
  }
  throw error;
}

function isRepairable(error: unknown) {
  return error instanceof TextModelError && REPAIRABLE_CODES.has(error.code);
}

function parseExtraction(value: unknown) {
  return KnowledgeExtractionResultSchema.parse(value);
}

function sortDrafts(result: KnowledgeExtractionResult) {
  return [...result.knowledgeDrafts].sort((left, right) => {
    const typeOrder = left.knowledgeType.localeCompare(right.knowledgeType);
    if (typeOrder !== 0) {
      return typeOrder;
    }
    const titleOrder = left.title.localeCompare(right.title);
    if (titleOrder !== 0) {
      return titleOrder;
    }
    return left.clientKey.localeCompare(right.clientKey);
  });
}

function toPersistDrafts(
  result: KnowledgeExtractionResult,
  job: ClaimedJob,
  allowedLocators: Set<string>,
): KnowledgePersistDraft[] {
  if (result.sourceVersionId !== job.sourceVersionId) {
    throw new ProcessorError(
      "ancestry_mismatch",
      "Extraction source version did not match the claimed job",
      false,
    );
  }

  const drafts = sortDrafts(result);
  const clientKeys = new Set(drafts.map((draft) => draft.clientKey));

  for (const citation of result.citations) {
    if (!clientKeys.has(citation.knowledgeClientKey)) {
      throw new ProcessorError("invalid_citation", "Citation referenced an unknown draft", false);
    }
    if (!allowedLocators.has(citation.locatorKey)) {
      throw new ProcessorError("invalid_locator", "Extraction cited an unknown locator", false);
    }
  }

  return drafts.map((draft, ordinal) => {
    const citations = result.citations
      .filter((citation) => citation.knowledgeClientKey === draft.clientKey)
      .map((citation) => ({
        locatorKey: citation.locatorKey,
        claimPath: KnowledgeClaimPathToDb[citation.claimPath],
        quoteExcerpt: citation.quoteExcerpt,
      }));

    if (draft.evidenceMode === "cited" && citations.length === 0) {
      throw new ProcessorError("invalid_citation", "Cited draft is missing citations", false);
    }

    return {
      extractionKey: buildExtractionKey({
        sourceVersionId: job.sourceVersionId,
        promptVersion,
        ordinal,
        title: draft.title,
        knowledgeType: draft.knowledgeType,
      }),
      knowledgeType: draft.knowledgeType,
      title: draft.title,
      l0Summary: draft.l0Summary,
      l1Content: draft.l1Content,
      l2Content: draft.l2Content,
      conditions: draft.conditions,
      limitations: draft.limitations,
      confidence: draft.confidence,
      evidenceMode: draft.evidenceMode,
      citations,
    };
  });
}

export function createExtractKnowledgeProcessor(options: {
  sources: SourceRepository;
  knowledge: KnowledgeRepository;
  model: TextModelProvider;
  modelName: string;
}): JobProcessor {
  const { sources, knowledge, model, modelName } = options;

  return async (job: ClaimedJob): Promise<ProcessingResult> => {
    const source = await sources.loadClaimedSource(job);
    if (source.item.source !== "chatgpt_web") {
      throw new ProcessorError(
        "unsupported_source",
        "Stage 1B only extracts chatgpt_web sources",
        false,
      );
    }

    const blocks = await knowledge.listSourceBlocks(job);
    if (blocks.length === 0) {
      throw new ProcessorError("no_source_blocks", "No source blocks available for extraction", false);
    }

    const window = selectExtractionWindow(blocks);
    const prompt = buildKnowledgeExtractionPrompt({
      title: source.item.title,
      sourceVersionId: job.sourceVersionId,
      blocks: window.blocks.map((block) => ({
        locatorKey: block.locatorKey,
        role: block.role,
        ordinal: block.ordinal,
        text: block.text,
      })),
    });

    const request = {
      operation: "extract_knowledge" as const,
      model: modelName,
      schemaName: "knowledge-extraction.v1" as const,
      systemPrompt: prompt.systemPrompt,
      userPayload: prompt.userPayload,
      parse: parseExtraction,
    };

    let generated: StructuredGenerationResult<KnowledgeExtractionResult>;
    try {
      generated = await model.generateStructured(request);
    } catch (error) {
      if (!isRepairable(error)) {
        toProcessorError(error);
      }

      try {
        generated = await model.generateStructured({
          ...request,
          systemPrompt: `${prompt.systemPrompt} Previous output failed structured validation. Return corrected JSON only.`,
        });
      } catch (repairError) {
        toProcessorError(repairError);
      }
    }

    const drafts = toPersistDrafts(
      generated.value,
      job,
      new Set(blocks.map((block) => block.locatorKey)),
    );
    const persisted = await knowledge.persistExtraction(job, {
      promptVersion,
      provider: generated.provider,
      model: generated.model,
      inputScope: window.inputScope,
      drafts,
    });

    return {
      resultSummary: `persisted ${persisted.items.length} knowledge drafts`,
      usageJson: {
        provider: generated.provider,
        model: generated.model,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        inputScope: window.inputScope,
      },
    };
  };
}
