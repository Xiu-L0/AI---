import type { OcrRequest, OcrResult } from "@recall/contracts";

export type { OcrRequest, OcrResult };

export interface OcrProvider {
  recognize(request: OcrRequest): Promise<OcrResult>;
}

export class OcrProviderError extends Error {
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
    this.name = "OcrProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.httpStatus = input.httpStatus ?? null;
  }
}
