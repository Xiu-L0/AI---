import { afterEach, describe, expect, it, vi } from "vitest";

import { GlmOcrProvider } from "./glm-ocr";
import { OcrProviderError } from "./ocr-provider";

const apiKey = "test-zhipu-key-not-for-git";
const requestId = "req-ocr-fixture-1";
const pngBytes = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156,
  99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
]);
const pngBase64 = Buffer.from(pngBytes).toString("base64");
const sensitiveMarkdown = "SENSITIVE_USER_NOTE_BODY_DO_NOT_LOG";

function validLayoutDetail(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    label: "text",
    bbox_2d: [0.1, 0.1, 0.5, 0.3],
    content: "Synthetic OCR markdown.",
    width: 600,
    height: 800,
    ...overrides,
  };
}

function validApiResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_fixture",
    created: 1727156815,
    model: "GLM-OCR",
    md_results: "# Fixture note\nSynthetic OCR markdown.",
    layout_details: [[validLayoutDetail()]],
    data_info: {
      num_pages: 1,
      pages: [{ width: 600, height: 800 }],
    },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
    request_id: requestId,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recognize(provider: GlmOcrProvider) {
  return provider.recognize({
    bytes: pngBytes,
    mimeType: "image/png",
    requestId,
  });
}

describe("GlmOcrProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts glm-ocr Base64 to layout_parsing without logging secrets", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "info").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://open.bigmodel.cn/api/paas/v4/layout_parsing");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${apiKey}`);
      expect(headers.get("Content-Type")).toBe("application/json");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("glm-ocr");
      expect(body.request_id).toBe(requestId);
      expect(body.file).toBe(`data:image/png;base64,${pngBase64}`);
      return jsonResponse(validApiResponse());
    });

    const provider = new GlmOcrProvider({ apiKey, fetchImpl });
    const result = await recognize(provider);

    expect(result.provider).toBe("zhipu");
    expect(result.model).toBe("glm-ocr");
    expect(result.markdown).toContain("Synthetic OCR markdown.");
    expect(result.regions[0]).toMatchObject({
      page: 1,
      index: 0,
      label: "text",
      bbox: [0.1, 0.1, 0.5, 0.3],
      content: "Synthetic OCR markdown.",
    });
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(pngBase64);
    expect(logs.join("\n")).not.toContain(apiKey);
    expect(logs.join("\n")).not.toContain(pngBase64);
    logSpy.mockRestore();
  });

  it("maps timeout, 401/403, 408/429/5xx, invalid JSON, invalid bbox and empty Markdown", async () => {
    const timeoutProvider = new GlmOcrProvider({
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
    await expect(recognize(timeoutProvider)).rejects.toMatchObject({
      name: "OcrProviderError",
      code: "timeout",
      retryable: true,
    });

    const cases: Array<{
      code: string;
      retryable: boolean;
      httpStatus?: number;
      status?: number;
      body?: unknown;
      text?: string;
    }> = [
      { code: "http_error", retryable: false, httpStatus: 401, status: 401, body: { error: { message: apiKey } } },
      { code: "http_error", retryable: false, httpStatus: 403, status: 403, body: { error: { message: pngBase64 } } },
      { code: "http_error", retryable: true, httpStatus: 408, status: 408, body: { error: { message: "timeout" } } },
      { code: "http_error", retryable: true, httpStatus: 429, status: 429, body: { error: { message: "busy" } } },
      { code: "http_error", retryable: true, httpStatus: 503, status: 503, body: { error: { message: sensitiveMarkdown } } },
      { code: "invalid_json", retryable: false, text: "{not-json" },
      {
        code: "invalid_bbox",
        retryable: false,
        body: validApiResponse({
          layout_details: [[validLayoutDetail({ bbox_2d: [1.5, 0, 0.2, 0.3] })]],
        }),
      },
      {
        code: "empty_markdown",
        retryable: false,
        body: validApiResponse({ md_results: "   " }),
      },
    ];

    for (const testCase of cases) {
      const provider = new GlmOcrProvider({
        apiKey,
        fetchImpl: async () =>
          testCase.text
            ? new Response(testCase.text, {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            : jsonResponse(testCase.body, testCase.status ?? 200),
      });
      try {
        await recognize(provider);
        throw new Error(`expected ${testCase.code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(OcrProviderError);
        const providerError = error as OcrProviderError;
        expect(providerError.code).toBe(testCase.code);
        expect(providerError.retryable).toBe(testCase.retryable);
        if (testCase.httpStatus !== undefined) {
          expect(providerError.httpStatus).toBe(testCase.httpStatus);
        }
        expect(providerError.message).toContain("zhipu");
        expect(providerError.message).not.toContain(apiKey);
        expect(providerError.message).not.toContain(pngBase64);
        expect(providerError.message).not.toContain(sensitiveMarkdown);
        expect(JSON.stringify(providerError)).not.toContain(apiKey);
        expect(JSON.stringify(providerError)).not.toContain(pngBase64);
        expect(JSON.stringify(providerError)).not.toContain(sensitiveMarkdown);
      }
    }
  });
});
