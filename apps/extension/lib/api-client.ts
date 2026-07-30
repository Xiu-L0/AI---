import {
  CaptureReceiptSchema,
  CaptureStatusResultSchema,
  ExchangePairingCodeInputSchema,
  ExchangePairingCodeResultSchema,
  FinalizeCaptureInputSchema,
  StartCaptureInputSchema,
  StartCaptureResultSchema,
  type CaptureReceipt,
  type CaptureStatusResult,
  type ExchangePairingCodeInput,
  type ExtensionCredential,
  type FinalizeCaptureInput,
  type StartCaptureInput,
  type StartCaptureResult,
} from "@recall/contracts";

import { clearExtensionCredential } from "./auth-store";

export interface CaptureApiClient {
  start(input: StartCaptureInput): Promise<StartCaptureResult>;
  finalize(
    captureId: string,
    input: FinalizeCaptureInput,
  ): Promise<CaptureReceipt>;
  status(captureId: string): Promise<CaptureStatusResult>;
}

export class ExtensionApiError extends Error {
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(input: {
    status: number;
    code?: string | undefined;
    requestId?: string | undefined;
    message?: string | undefined;
  }) {
    super(input.message ?? `Extension API request failed with HTTP ${input.status}`);
    this.name = "ExtensionApiError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
  }
}

export class ExtensionAuthExpiredError extends ExtensionApiError {
  constructor(requestId?: string | undefined) {
    super({
      code: "extension_auth_expired",
      message: "Extension authentication expired",
      requestId,
      status: 401,
    });
    this.name = "ExtensionAuthExpiredError";
  }
}

type ApiDependencies = {
  apiOrigin?: string;
  fetch?: typeof globalThis.fetch;
  clearCredential?: () => Promise<void>;
};

function apiOrigin(override?: string): string {
  const configured =
    override ?? import.meta.env.WXT_PUBLIC_API_ORIGIN ?? "http://localhost:3000";
  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Extension API origin must use HTTP or HTTPS");
  }
  return url.origin;
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorDetails(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return {};
  }
  return {
    code:
      "code" in payload && typeof payload.code === "string"
        ? payload.code
        : undefined,
    message:
      "message" in payload && typeof payload.message === "string"
        ? payload.message
        : undefined,
    requestId:
      "requestId" in payload && typeof payload.requestId === "string"
        ? payload.requestId
        : undefined,
  };
}

async function requestJson(
  path: string,
  init: RequestInit,
  dependencies: Required<Pick<ApiDependencies, "fetch" | "clearCredential">> & {
    apiOrigin: string;
    authenticated: boolean;
  },
): Promise<unknown> {
  const response = await dependencies.fetch(`${dependencies.apiOrigin}${path}`, init);
  const payload = await readPayload(response);
  if (response.ok) {
    return payload;
  }

  const details = errorDetails(payload);
  const requestId = response.headers.get("x-request-id") ?? details.requestId;
  if (response.status === 401 && dependencies.authenticated) {
    await dependencies.clearCredential();
    throw new ExtensionAuthExpiredError(requestId ?? undefined);
  }
  throw new ExtensionApiError({
    code: details.code,
    message: details.message,
    requestId: requestId ?? undefined,
    status: response.status,
  });
}

export async function exchangeExtensionPairingCode(
  input: ExchangePairingCodeInput,
  dependencies: Omit<ApiDependencies, "clearCredential"> = {},
): Promise<ExtensionCredential> {
  const body = ExchangePairingCodeInputSchema.parse(input);
  const payload = await requestJson(
    "/api/extension/pairing/exchange",
    {
      body: JSON.stringify(body),
      headers: new Headers({ "content-type": "application/json" }),
      method: "POST",
    },
    {
      apiOrigin: apiOrigin(dependencies.apiOrigin),
      authenticated: false,
      clearCredential: async () => undefined,
      fetch: dependencies.fetch ?? globalThis.fetch,
    },
  );
  return ExchangePairingCodeResultSchema.parse(payload);
}

export function createCaptureApiClient(
  token: string,
  dependencies: ApiDependencies = {},
): CaptureApiClient {
  const resolved = {
    apiOrigin: apiOrigin(dependencies.apiOrigin),
    authenticated: true,
    clearCredential: dependencies.clearCredential ?? clearExtensionCredential,
    fetch: dependencies.fetch ?? globalThis.fetch,
  };
  const headers = () =>
    new Headers({
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });

  return {
    async start(input) {
      return StartCaptureResultSchema.parse(
        await requestJson(
          "/api/captures/start",
          {
            body: JSON.stringify(StartCaptureInputSchema.parse(input)),
            headers: headers(),
            method: "POST",
          },
          resolved,
        ),
      );
    },
    async finalize(captureId, input) {
      return CaptureReceiptSchema.parse(
        await requestJson(
          `/api/captures/${encodeURIComponent(captureId)}/finalize`,
          {
            body: JSON.stringify(FinalizeCaptureInputSchema.parse(input)),
            headers: headers(),
            method: "POST",
          },
          resolved,
        ),
      );
    },
    async status(captureId) {
      return CaptureStatusResultSchema.parse(
        await requestJson(
          `/api/captures/${encodeURIComponent(captureId)}/status`,
          { headers: headers(), method: "GET" },
          resolved,
        ),
      );
    },
  };
}
