import { KnowledgeExtractionResultSchema } from "@recall/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildKnowledgeExtractionPrompt,
  knowledgeExtractionExample,
  promptVersion,
} from "../prompts/knowledge-extraction-v1";
import { DeepSeekTextModel } from "./deepseek-text-model";
import { TextModelError } from "./text-model-provider";

const apiKey = "test-deepseek-key";

const validExtraction = {
  schemaVersion: "knowledge-extraction.v1",
  promptVersion,
  sourceVersionId: "30000000-0000-4000-8000-000000000001",
  knowledgeDrafts: [
    {
      clientKey: "draft-1",
      knowledgeType: "concept",
      title: "Stable evidence block",
      l0Summary: "Evidence blocks keep citations stable.",
      l1Content: "A block is addressed by locatorKey.",
      l2Content: "",
      conditions: ["ChatGPT text only"],
      limitations: ["No invented locators"],
      confidence: 0.8,
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
};

function completion(overrides: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4-flash",
    usage: { prompt_tokens: 120, completion_tokens: 80 },
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify(validExtraction),
          reasoning_content: "do-not-persist",
        },
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DeepSeekTextModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts JSON mode, disabled thinking, and bearer auth only in headers", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/chat/completions");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${apiKey}`);
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("deepseek-v4-flash");
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.max_tokens).toBe(8_192);
      expect(JSON.stringify(body)).not.toContain(apiKey);
      expect(JSON.stringify(body)).not.toContain("do-not-persist");
      return jsonResponse(completion());
    });

    const prompt = buildKnowledgeExtractionPrompt({
      title: "ChatGPT fixture",
      sourceVersionId: validExtraction.sourceVersionId,
      blocks: [
        {
          locatorKey: "message:msg-user/body",
          role: "user",
          ordinal: 0,
          text: "Evidence blocks keep citations stable.",
        },
      ],
    });
    expect(prompt.systemPrompt.toLowerCase()).toContain("json");
    expect(prompt.systemPrompt).toContain(JSON.stringify(knowledgeExtractionExample));
    expect(prompt.promptVersion).toBe("knowledge-extraction.2026-08-11.v1");

    const provider = new DeepSeekTextModel({ apiKey, fetchImpl });
    const result = await provider.generateStructured({
      operation: "extract_knowledge",
      model: "deepseek-v4-flash",
      schemaName: "knowledge-extraction.v1",
      systemPrompt: prompt.systemPrompt,
      userPayload: prompt.userPayload,
      parse: (value) => KnowledgeExtractionResultSchema.parse(value),
    });

    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-v4-flash");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
    expect(result.value.knowledgeDrafts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
  });

  it("allows deepseek-v4-pro through the request model", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("deepseek-v4-pro");
      return jsonResponse(completion({ model: "deepseek-v4-pro" }));
    });

    const provider = new DeepSeekTextModel({
      apiKey,
      model: "deepseek-v4-flash",
      fetchImpl,
    });
    const result = await provider.generateStructured({
      operation: "extract_knowledge",
      model: "deepseek-v4-pro",
      schemaName: "knowledge-extraction.v1",
      systemPrompt: "Return only valid JSON.",
      userPayload: { schemaVersion: "knowledge-extraction.v1" },
      parse: (value) => KnowledgeExtractionResultSchema.parse(value),
    });
    expect(result.model).toBe("deepseek-v4-pro");
  });

  it("maps non-2xx, timeout, empty, truncated, invalid JSON and schema failures", async () => {
    const httpProvider = new DeepSeekTextModel({
      apiKey,
      fetchImpl: async () => jsonResponse({ error: "busy" }, 503),
    });
    await expect(
      httpProvider.generateStructured({
        operation: "extract_knowledge",
        model: "deepseek-v4-flash",
        schemaName: "knowledge-extraction.v1",
        systemPrompt: "Return only valid JSON.",
        userPayload: { secret: apiKey, source: "private chat body ".repeat(20) },
        parse: (value) => value,
      }),
    ).rejects.toMatchObject({
      name: "TextModelError",
      code: "http_error",
      retryable: true,
      httpStatus: 503,
    });

    const timeoutProvider = new DeepSeekTextModel({
      apiKey,
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    await expect(
      timeoutProvider.generateStructured({
        operation: "extract_knowledge",
        model: "deepseek-v4-flash",
        schemaName: "knowledge-extraction.v1",
        systemPrompt: "Return only valid JSON.",
        userPayload: { source: "private chat body" },
        parse: (value) => value,
      }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });

    const cases: Array<{
      code: string;
      retryable: boolean;
      body: unknown;
    }> = [
      {
        code: "empty_content",
        retryable: true,
        body: completion({
          choices: [{ finish_reason: "stop", message: { content: "" } }],
        }),
      },
      {
        code: "truncated",
        retryable: false,
        body: completion({
          choices: [
            {
              finish_reason: "length",
              message: { content: JSON.stringify(validExtraction) },
            },
          ],
        }),
      },
      {
        code: "invalid_json",
        retryable: false,
        body: completion({
          choices: [{ finish_reason: "stop", message: { content: "{not-json" } }],
        }),
      },
      {
        code: "invalid_schema",
        retryable: false,
        body: completion({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ schemaVersion: "wrong" }) },
            },
          ],
        }),
      },
    ];

    for (const testCase of cases) {
      const provider = new DeepSeekTextModel({
        apiKey,
        fetchImpl: async () => jsonResponse(testCase.body),
      });
      try {
        await provider.generateStructured({
          operation: "extract_knowledge",
          model: "deepseek-v4-flash",
          schemaName: "knowledge-extraction.v1",
          systemPrompt: "Return only valid JSON.",
          userPayload: { secret: apiKey, source: "private chat body ".repeat(20) },
          parse: (value) => KnowledgeExtractionResultSchema.parse(value),
        });
        throw new Error(`expected ${testCase.code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TextModelError);
        const modelError = error as TextModelError;
        expect(modelError.code).toBe(testCase.code);
        expect(modelError.retryable).toBe(testCase.retryable);
        expect(modelError.message).not.toContain(apiKey);
        expect(modelError.message).not.toContain("private chat body");
        expect(JSON.stringify(modelError)).not.toContain(apiKey);
      }
    }
  });
});
