import { KnowledgeExtractionResultSchema } from "@recall/contracts";
import { describe, expect, it, vi } from "vitest";

import { promptVersion } from "../prompts/knowledge-extraction-v1";
import {
  TextModelError,
  type StructuredGenerationRequest,
  type TextModelProvider,
} from "../providers/text-model-provider";
import type {
  KnowledgeRepository,
  KnowledgeSourceBlock,
} from "../repositories/knowledge-repository";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import type { ClaimedJob } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import {
  buildExtractionKey,
  createExtractKnowledgeProcessor,
  EXTRACTION_CHAR_BUDGET,
  selectExtractionWindow,
} from "./extract-knowledge";

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "00000000-0000-4000-8000-0000000000c1",
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-4000-8000-0000000000c1",
    jobType: "extract_knowledge",
    attempt: 1,
    leaseExpiresAt: "2026-09-06T06:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<ClaimedSource> = {}): ClaimedSource {
  return {
    item: {
      id: "10000000-0000-4000-8000-0000000000c1",
      title: "ChatGPT extract fixture",
      source: "chatgpt_web",
      sourcePlatform: "chatgpt",
      sourceKind: "ai_conversation",
      sensitivity: "normal",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    version: {
      id: "30000000-0000-4000-8000-0000000000c1",
      sourceItemId: "10000000-0000-4000-8000-0000000000c1",
      missingElements: [],
      rawText: "",
      captureStatus: "complete",
      metadata: null,
    },
    messages: [],
    attachments: [],
    ...overrides,
  };
}

function blocks(): KnowledgeSourceBlock[] {
  return [
    {
      id: "60000000-0000-4000-8000-0000000000c1",
      locatorKey: "message:msg-user/body",
      ordinal: 0,
      text: "Evidence blocks keep citations stable.",
      role: "user",
      blockType: "message",
    },
    {
      id: "60000000-0000-4000-8000-0000000000c2",
      locatorKey: "message:msg-assistant/body",
      ordinal: 1,
      text: "A block is addressed by locatorKey.",
      role: "assistant",
      blockType: "message",
    },
  ];
}

function extraction(overrides: Record<string, unknown> = {}) {
  return KnowledgeExtractionResultSchema.parse({
    schemaVersion: "knowledge-extraction.v1",
    promptVersion,
    sourceVersionId: "30000000-0000-4000-8000-0000000000c1",
    knowledgeDrafts: [
      {
        clientKey: "draft-1",
        knowledgeType: "concept",
        title: "Stable cited concept",
        l0Summary: "Evidence blocks keep citations stable.",
        l1Content: "A block is addressed by locatorKey.",
        l2Content: "",
        conditions: ["ChatGPT text only"],
        limitations: ["No invented locators"],
        confidence: 0.72,
        evidenceMode: "cited",
      },
    ],
    citations: [
      {
        knowledgeClientKey: "draft-1",
        locatorKey: "message:msg-user/body",
        claimPath: "l0Summary",
        quoteExcerpt: "Evidence blocks keep citations stable.",
      },
    ],
    ...overrides,
  });
}

function defaultPersistResult() {
  return {
    items: [
      {
        knowledgeItemId: "80000000-0000-4000-8000-0000000000c1",
        extractionKey: "a".repeat(64),
        reviewTaskId: "90000000-0000-4000-8000-0000000000c1",
        reused: false,
        userGoverned: false,
      },
    ],
  };
}

function captureModel(impl: TextModelProvider["generateStructured"]) {
  const requests: Array<StructuredGenerationRequest<unknown>> = [];
  const generateStructured: TextModelProvider["generateStructured"] = async (request) => {
    requests.push(request);
    return impl(request);
  };
  return { model: { generateStructured }, requests };
}

function createProcessor(options: {
  source?: ClaimedSource;
  blocks?: KnowledgeSourceBlock[];
  model: TextModelProvider;
  persist?: KnowledgeRepository["persistExtraction"];
}) {
  const persistExtraction = vi.fn<KnowledgeRepository["persistExtraction"]>(
    options.persist ?? (async () => defaultPersistResult()),
  );
  const sources: SourceRepository = {
    loadClaimedSource: async () => options.source ?? source(),
    enqueueFollowupJob: async () => {
      throw new Error("extract_knowledge must not enqueue followup jobs");
    },
    replaceSourceBlocks: async () => {
      throw new Error("extract_knowledge must not replace source blocks");
    },
  };
  const knowledge: KnowledgeRepository = {
    listSourceBlocks: async () => options.blocks ?? blocks(),
    persistExtraction,
  };

  return {
    persistExtraction,
    processor: createExtractKnowledgeProcessor({
      sources,
      knowledge,
      model: options.model,
      modelName: "deepseek-v4-flash",
    }),
  };
}

describe("selectExtractionWindow", () => {
  it("keeps complete adjacent messages and never truncates a block", () => {
    const oversized = [
      { ...blocks()[0]!, text: "A".repeat(EXTRACTION_CHAR_BUDGET - 10), ordinal: 0 },
      { ...blocks()[1]!, text: "B".repeat(40), ordinal: 1 },
    ];
    const window = selectExtractionWindow(oversized);

    expect(window.inputScope.mode).toBe("window");
    expect(window.blocks).toHaveLength(1);
    expect(window.blocks[0]?.text).toHaveLength(EXTRACTION_CHAR_BUDGET - 10);
    expect(window.inputScope.locatorKeys).toEqual(["message:msg-user/body"]);
  });
});

describe("createExtractKnowledgeProcessor", () => {
  it("persists a validated extraction through the repository", async () => {
    const { model, requests } = captureModel(async (request) => ({
      value: request.parse(extraction()),
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { inputTokens: 11, outputTokens: 7 },
    }));
    const { processor, persistExtraction } = createProcessor({ model });

    const result = await processor(job());
    const expectedKey = buildExtractionKey({
      sourceVersionId: job().sourceVersionId,
      promptVersion,
      ordinal: 0,
      title: "Stable cited concept",
      knowledgeType: "concept",
    });

    expect(result.resultSummary).toBe("persisted 1 knowledge drafts");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.systemPrompt).toContain("JSON");
    expect(persistExtraction).toHaveBeenCalledOnce();
    expect(persistExtraction).toHaveBeenCalledWith(
      job(),
      expect.objectContaining({
        promptVersion,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        drafts: [
          expect.objectContaining({
            extractionKey: expectedKey,
            title: "Stable cited concept",
            citations: [
              expect.objectContaining({
                locatorKey: "message:msg-user/body",
                claimPath: "l0_summary",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("does not persist when a locator is invented", async () => {
    const persistExtraction = vi.fn(async () => {
      throw new Error("persist must not run");
    });
    const { processor } = createProcessor({
      persist: persistExtraction,
      model: {
        generateStructured: async (request) => ({
          value: request.parse(
            extraction({
              citations: [
                {
                  knowledgeClientKey: "draft-1",
                  locatorKey: "message:missing/body",
                  claimPath: "l0Summary",
                  quoteExcerpt: "invented",
                },
              ],
            }),
          ),
          provider: "deepseek",
          model: "deepseek-v4-flash",
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
    });

    await expect(processor(job())).rejects.toMatchObject({
      code: "invalid_locator",
      retryable: false,
    });
    expect(persistExtraction).not.toHaveBeenCalled();
  });

  it("fails before the model when no source blocks exist", async () => {
    const generateStructured = vi.fn(async () => {
      throw new Error("model must not run");
    });
    const persistExtraction = vi.fn(async () => {
      throw new Error("persist must not run");
    });
    const { model } = captureModel(generateStructured);
    const { processor } = createProcessor({
      blocks: [],
      persist: persistExtraction,
      model,
    });

    await expect(processor(job())).rejects.toBeInstanceOf(ProcessorError);
    await expect(processor(job())).rejects.toMatchObject({
      code: "no_source_blocks",
      retryable: false,
    });
    expect(generateStructured).not.toHaveBeenCalled();
    expect(persistExtraction).not.toHaveBeenCalled();
  });

  it("returns retryable provider errors to queue backoff without a repair prompt", async () => {
    const generateStructured = vi.fn(async () => {
      throw new TextModelError({
        code: "http_error",
        message: "DeepSeek returned HTTP 429",
        retryable: true,
        httpStatus: 429,
      });
    });
    const persistExtraction = vi.fn(async () => {
      throw new Error("persist must not run");
    });
    const { model } = captureModel(generateStructured);
    const { processor } = createProcessor({
      persist: persistExtraction,
      model,
    });

    await expect(processor(job())).rejects.toMatchObject({
      code: "http_error",
      retryable: true,
    });
    expect(generateStructured).toHaveBeenCalledOnce();
    expect(persistExtraction).not.toHaveBeenCalled();
  });

  it("allows one repair attempt for schema errors and then fails", async () => {
    const generateStructured = vi.fn(async () => {
      throw new TextModelError({
        code: "invalid_schema",
        message: "DeepSeek JSON failed schema validation",
        retryable: false,
      });
    });
    const persistExtraction = vi.fn(async () => {
      throw new Error("persist must not run");
    });
    const { model, requests } = captureModel(generateStructured);
    const { processor } = createProcessor({
      persist: persistExtraction,
      model,
    });

    await expect(processor(job())).rejects.toMatchObject({
      code: "invalid_schema",
      retryable: false,
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(requests[1]?.systemPrompt).toContain("Return corrected JSON only");
    expect(persistExtraction).not.toHaveBeenCalled();
  });

  it("replays the same persist payload for an identical extraction", async () => {
    const { model } = captureModel(async (request) => ({
      value: request.parse(extraction()),
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { inputTokens: 3, outputTokens: 2 },
    }));
    const persistExtraction = vi.fn<KnowledgeRepository["persistExtraction"]>(async () => ({
      items: [
        {
          knowledgeItemId: "80000000-0000-4000-8000-0000000000c1",
          extractionKey: "a".repeat(64),
          reviewTaskId: "90000000-0000-4000-8000-0000000000c1",
          reused: true,
          userGoverned: false,
        },
      ],
    }));
    const { processor } = createProcessor({
      persist: persistExtraction,
      model,
    });

    await processor(job());
    await processor(job());

    expect(persistExtraction).toHaveBeenCalledTimes(2);
    expect(persistExtraction.mock.calls[0]?.[1]).toEqual(persistExtraction.mock.calls[1]?.[1]);
  });

  it("extracts Xiaohongshu social-post blocks with source role and block type", async () => {
    const { model, requests } = captureModel(async (request) => ({
      value: request.parse(
        extraction({
          citations: [
            {
              knowledgeClientKey: "draft-1",
              locatorKey: "post:body",
              claimPath: "l0Summary",
              quoteExcerpt: "Evidence blocks keep citations stable.",
            },
          ],
        }),
      ),
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { inputTokens: 8, outputTokens: 4 },
    }));
    const { processor, persistExtraction } = createProcessor({
      model,
      source: source({
        item: {
          ...source().item,
          source: null,
          sourcePlatform: "xiaohongshu",
          sourceKind: "social_post",
          title: "Synthetic XHS",
        },
        messages: [],
      }),
      blocks: [
        {
          id: "60000000-0000-4000-8000-0000000000d1",
          locatorKey: "post:body",
          ordinal: 0,
          text: "Evidence blocks keep citations stable.",
          role: "source",
          blockType: "paragraph",
        },
        {
          id: "60000000-0000-4000-8000-0000000000d2",
          locatorKey: "image:xhs-image-1/page:1/region:0",
          ordinal: 2,
          text: "Synthetic OCR markdown.",
          role: "source",
          blockType: "ocr_region",
        },
      ],
    });

    const result = await processor(job());
    expect(result.resultSummary).toBe("persisted 1 knowledge drafts");
    expect(persistExtraction).toHaveBeenCalledOnce();
    expect(requests[0]?.userPayload).toMatchObject({
      blocks: [
        expect.objectContaining({
          locatorKey: "post:body",
          role: "source",
          blockType: "paragraph",
        }),
        expect.objectContaining({
          locatorKey: "image:xhs-image-1/page:1/region:0",
          role: "source",
          blockType: "ocr_region",
        }),
      ],
    });
  });
});
