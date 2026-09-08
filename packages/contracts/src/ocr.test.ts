import { describe, expect, it } from "vitest";

import {
  GlmOcrApiResponseSchema,
  OcrRequestSchema,
  OcrResultSchema,
} from "./ocr";

const MIB = 1024 * 1024;
const LAYOUT_JSON_LIMIT = 64 * 1024;

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    bytes: new Uint8Array([137, 80, 78, 71]),
    mimeType: "image/png",
    requestId: "req-ocr-fixture-1",
    ...overrides,
  };
}

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
    request_id: "req-ocr-fixture-1",
    ...overrides,
  };
}

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    provider: "zhipu",
    model: "glm-ocr",
    markdown: "# Fixture note\nSynthetic OCR markdown.",
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
    requestId: "req-ocr-fixture-1",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    ...overrides,
  };
}

describe("OCR contracts", () => {
  it("accepts a bounded JPEG/PNG OCR request", () => {
    expect(OcrRequestSchema.parse(validRequest()).mimeType).toBe("image/png");
    expect(
      OcrRequestSchema.parse(validRequest({ mimeType: "image/jpeg" })).mimeType,
    ).toBe("image/jpeg");
    expect(OcrRequestSchema.safeParse(validRequest({ mimeType: "image/webp" })).success).toBe(
      false,
    );
    expect(OcrRequestSchema.safeParse(validRequest({ bytes: new Uint8Array() })).success).toBe(
      false,
    );
    expect(
      OcrRequestSchema.safeParse(validRequest({ requestId: "short" })).success,
    ).toBe(false);
  });

  it("accepts official GLM-OCR success fields and normalized 0-1 bbox", () => {
    const parsed = GlmOcrApiResponseSchema.parse(validApiResponse());
    expect(parsed.md_results).toContain("Synthetic OCR markdown.");
    expect(parsed.layout_details[0]?.[0]?.bbox_2d).toEqual([0.1, 0.1, 0.5, 0.3]);
    expect(parsed.data_info.num_pages).toBe(1);
    expect(parsed.usage.total_tokens).toBe(30);
    expect(parsed.request_id).toBe("req-ocr-fixture-1");
  });

  it("rejects empty Markdown, invalid bbox and oversized layout JSON", () => {
    expect(OcrResultSchema.safeParse(validResult({ markdown: "   " })).success).toBe(false);
    expect(
      GlmOcrApiResponseSchema.safeParse(
        validApiResponse({
          layout_details: [[validLayoutDetail({ bbox_2d: [1.2, 0, 0.5, 0.3] })]],
        }),
      ).success,
    ).toBe(false);
    expect(
      GlmOcrApiResponseSchema.safeParse(
        validApiResponse({
          layout_details: [[validLayoutDetail({ bbox_2d: [0.5, 0.1, 0.2, 0.3] })]],
        }),
      ).success,
    ).toBe(false);
    expect(
      GlmOcrApiResponseSchema.safeParse(
        validApiResponse({
          layout_details: [[validLayoutDetail({ bbox_2d: [0.1, 0.1, 0.5] })]],
        }),
      ).success,
    ).toBe(false);

    const oversized = validApiResponse({
      layout_details: [
        [validLayoutDetail({ content: "x".repeat(LAYOUT_JSON_LIMIT) })],
      ],
    });
    expect(GlmOcrApiResponseSchema.safeParse(oversized).success).toBe(false);
    expect(
      OcrResultSchema.safeParse(validResult({ markdown: "m".repeat(MIB + 1) })).success,
    ).toBe(false);
  });

  it("maps a provider-neutral OCR result without leaking image bytes", () => {
    const result = OcrResultSchema.parse(validResult());
    expect(result.provider).toBe("zhipu");
    expect(result.model).toBe("glm-ocr");
    expect(JSON.stringify(result)).not.toMatch(/data:image\//);
    expect(JSON.stringify(result)).not.toContain("ZHIPU");
  });
});
