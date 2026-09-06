import { TextModelError, type TextModelProvider } from "./text-model-provider";

const ALLOWED_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 8_192;

export type DeepSeekTextModelOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: (typeof ALLOWED_MODELS)[number];
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
};

type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type DeepSeekMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

type DeepSeekChoice = {
  finish_reason?: string | null;
  message?: DeepSeekMessage;
};

type DeepSeekResponse = {
  model?: string;
  usage?: DeepSeekUsage;
  choices?: DeepSeekChoice[];
};

function isAllowedModel(model: string): model is (typeof ALLOWED_MODELS)[number] {
  return ALLOWED_MODELS.includes(model as (typeof ALLOWED_MODELS)[number]);
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function readTokenCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class DeepSeekTextModel implements TextModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: (typeof ALLOWED_MODELS)[number];
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekTextModelOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === "") {
      throw new TextModelError({
        code: "invalid_config",
        message: "DeepSeek API key is required",
        retryable: false,
      });
    }

    const model = options.model ?? "deepseek-v4-flash";
    if (!isAllowedModel(model)) {
      throw new TextModelError({
        code: "invalid_config",
        message: "DeepSeek model must be deepseek-v4-flash or deepseek-v4-pro",
        retryable: false,
      });
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateStructured<T>(request: {
    operation: "extract_knowledge";
    model: string;
    schemaName: "knowledge-extraction.v1";
    systemPrompt: string;
    userPayload: unknown;
    parse(value: unknown): T;
  }) {
    if (!isAllowedModel(request.model)) {
      throw new TextModelError({
        code: "invalid_config",
        message: "DeepSeek model must be deepseek-v4-flash or deepseek-v4-pro",
        retryable: false,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          temperature: 0,
          max_tokens: this.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new TextModelError({
          code: "timeout",
          message: "DeepSeek request timed out",
          retryable: true,
        });
      }
      throw new TextModelError({
        code: "network_error",
        message: "DeepSeek request failed",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new TextModelError({
        code: "http_error",
        message: `DeepSeek returned HTTP ${response.status}`,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        httpStatus: response.status,
      });
    }

    const payload = (await response.json()) as DeepSeekResponse;
    const choice = payload.choices?.[0];
    const content = choice?.message?.content?.trim() ?? "";

    if (choice?.finish_reason === "length") {
      throw new TextModelError({
        code: "truncated",
        message: "DeepSeek response was truncated",
        retryable: false,
      });
    }

    if (content === "") {
      throw new TextModelError({
        code: "empty_content",
        message: "DeepSeek returned empty content",
        retryable: true,
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new TextModelError({
        code: "invalid_json",
        message: "DeepSeek returned invalid JSON",
        retryable: false,
      });
    }

    try {
      return {
        value: request.parse(parsedJson),
        provider: "deepseek",
        model: payload.model ?? request.model,
        usage: {
          inputTokens: readTokenCount(payload.usage?.prompt_tokens),
          outputTokens: readTokenCount(payload.usage?.completion_tokens),
        },
      };
    } catch {
      throw new TextModelError({
        code: "invalid_schema",
        message: "DeepSeek JSON failed schema validation",
        retryable: false,
      });
    }
  }
}
