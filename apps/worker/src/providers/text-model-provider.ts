export type TextModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type StructuredGenerationRequest<T> = {
  operation: "extract_knowledge";
  model: string;
  schemaName: "knowledge-extraction.v1";
  systemPrompt: string;
  userPayload: unknown;
  parse(value: unknown): T;
};

export type StructuredGenerationResult<T> = {
  value: T;
  provider: string;
  model: string;
  usage: TextModelUsage;
};

export interface TextModelProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
}

export class TextModelError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    httpStatus?: number | null;
  }) {
    super(input.message);
    this.name = "TextModelError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.httpStatus = input.httpStatus ?? null;
  }
}
