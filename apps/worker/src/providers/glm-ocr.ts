import {
  GlmOcrApiResponseSchema,
  OcrRequestSchema,
  OcrResultSchema,
  type OcrRequest,
  type OcrResult,
} from "@recall/contracts";
import { ZodError } from "zod";

import { OcrProviderError, type OcrProvider } from "./ocr-provider";

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_TIMEOUT_MS = 60_000;

export type GlmOcrProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: "glm-ocr";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function readTokenCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeOcrError(input: {
  code: string;
  retryable: boolean;
  httpStatus?: number | null;
}) {
  const statusPart =
    input.httpStatus === undefined || input.httpStatus === null
      ? ""
      : `, HTTP ${input.httpStatus}`;
  return new OcrProviderError({
    code: input.code,
    retryable: input.retryable,
    message: `zhipu OCR failed (${input.code}${statusPart})`,
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
  });
}

function mapZodError(error: ZodError) {
  const paths = error.issues.map((issue) => issue.path.join("."));
  if (paths.some((path) => path.includes("bbox_2d") || path.endsWith("bbox"))) {
    return safeOcrError({ code: "invalid_bbox", retryable: false });
  }
  if (paths.some((path) => path.includes("md_results") || path.endsWith("markdown"))) {
    return safeOcrError({ code: "empty_markdown", retryable: false });
  }
  return safeOcrError({ code: "invalid_schema", retryable: false });
}

export class GlmOcrProvider implements OcrProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: "glm-ocr";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GlmOcrProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === "") {
      throw safeOcrError({ code: "invalid_config", retryable: false });
    }
    const model = options.model ?? "glm-ocr";
    if (model !== "glm-ocr") {
      throw safeOcrError({ code: "invalid_config", retryable: false });
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw safeOcrError({ code: "invalid_config", retryable: false });
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async recognize(request: OcrRequest): Promise<OcrResult> {
    let parsedRequest: OcrRequest;
    try {
      parsedRequest = OcrRequestSchema.parse(request);
    } catch {
      throw safeOcrError({ code: "invalid_config", retryable: false });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/layout_parsing`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          file: `data:${parsedRequest.mimeType};base64,${Buffer.from(parsedRequest.bytes).toString("base64")}`,
          request_id: parsedRequest.requestId,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw safeOcrError({ code: "timeout", retryable: true });
      }
      throw safeOcrError({ code: "network_error", retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw safeOcrError({
        code: "http_error",
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        httpStatus: response.status,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw safeOcrError({ code: "invalid_json", retryable: false });
    }

    let apiResponse;
    try {
      apiResponse = GlmOcrApiResponseSchema.parse(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        throw mapZodError(error);
      }
      throw safeOcrError({ code: "invalid_schema", retryable: false });
    }

    if (apiResponse.md_results.trim() === "") {
      throw safeOcrError({ code: "empty_markdown", retryable: false });
    }

    const pages =
      apiResponse.data_info.pages && apiResponse.data_info.pages.length > 0
        ? apiResponse.data_info.pages
        : apiResponse.layout_details.map((pageRegions) => ({
            width: pageRegions[0]?.width ?? 1,
            height: pageRegions[0]?.height ?? 1,
          }));

    const regions = apiResponse.layout_details.flatMap((pageRegions, pageIndex) => {
      const page = pages[pageIndex] ?? pages[0];
      return pageRegions.map((region) => ({
        page: pageIndex + 1,
        index: region.index,
        label: region.label,
        bbox: region.bbox_2d,
        content: region.content ?? "",
        width: region.width ?? page?.width ?? 1,
        height: region.height ?? page?.height ?? 1,
      }));
    });

    try {
      return OcrResultSchema.parse({
        provider: "zhipu",
        model: "glm-ocr",
        markdown: apiResponse.md_results,
        pages,
        regions,
        requestId: parsedRequest.requestId,
        usage: {
          inputTokens: readTokenCount(apiResponse.usage.prompt_tokens),
          outputTokens: readTokenCount(apiResponse.usage.completion_tokens),
          totalTokens: readTokenCount(apiResponse.usage.total_tokens),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw mapZodError(error);
      }
      throw safeOcrError({ code: "invalid_schema", retryable: false });
    }
  }
}
