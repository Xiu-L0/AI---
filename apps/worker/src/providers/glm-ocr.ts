import {
  GlmOcrApiResponseSchema,
  OcrBboxSchema,
  OcrRequestSchema,
  OcrResultSchema,
  type OcrBbox,
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

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function resolveTrustedPageSize(
  region: { width?: number | undefined; height?: number | undefined },
  page: { width: number; height: number } | undefined,
): { width: number; height: number } | null {
  if (isPositiveInt(region.width) && isPositiveInt(region.height)) {
    return { width: region.width, height: region.height };
  }
  if (page && isPositiveInt(page.width) && isPositiveInt(page.height)) {
    return { width: page.width, height: page.height };
  }
  return null;
}

function invalidBbox(): never {
  throw safeOcrError({ code: "invalid_bbox", retryable: false });
}

export function normalizeGlmOcrBbox(
  bbox: readonly [number, number, number, number],
  size: { width: number; height: number } | null,
): OcrBbox {
  const [x1, y1, x2, y2] = bbox;
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    invalidBbox();
  }
  if ([x1, y1, x2, y2].some((value) => value < 0)) {
    invalidBbox();
  }
  if (x2 < x1 || y2 < y1) {
    invalidBbox();
  }
  if (!size || !isPositiveInt(size.width) || !isPositiveInt(size.height)) {
    invalidBbox();
  }

  const unit = bbox.some((value) => value > 1)
    ? x1 > size.width || x2 > size.width || y1 > size.height || y2 > size.height
      ? invalidBbox()
      : ([x1 / size.width, y1 / size.height, x2 / size.width, y2 / size.height] as const)
    : bbox;

  const parsed = OcrBboxSchema.safeParse(unit);
  if (!parsed.success) {
    invalidBbox();
  }
  return parsed.data;
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

    const dataPages = apiResponse.data_info.pages ?? [];
    const regions = apiResponse.layout_details.flatMap((pageRegions, pageIndex) => {
      const page = dataPages[pageIndex];
      return pageRegions.map((region) => {
        const size = resolveTrustedPageSize(region, page);
        return {
          page: pageIndex + 1,
          index: region.index,
          label: region.label,
          bbox: normalizeGlmOcrBbox(region.bbox_2d, size),
          content: region.content ?? "",
          width: size?.width ?? invalidBbox(),
          height: size?.height ?? invalidBbox(),
        };
      });
    });
    const pages =
      dataPages.length > 0
        ? dataPages
        : apiResponse.layout_details.map((_, pageIndex) => {
            const first = regions.find((region) => region.page === pageIndex + 1);
            if (!first) {
              invalidBbox();
            }
            return { width: first.width, height: first.height };
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
