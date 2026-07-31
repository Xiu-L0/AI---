import {
  CaptureReceiptSchema,
  CaptureStatusResultSchema,
  ExchangePairingCodeInputSchema,
  ExchangePairingCodeResultSchema,
  FinalizeCaptureInputSchema,
  ReportCaptureFailureInputSchema,
  ReportCaptureFailureResultSchema,
  StartCaptureInputSchema,
  StartCaptureResultSchema,
  type CaptureReceipt,
  type CaptureStatusResult,
  type ExchangePairingCodeInput,
  type ExtensionCredential,
  type FinalizeCaptureInput,
  type ReportCaptureFailureInput,
  type ReportCaptureFailureResult,
  type StartCaptureInput,
  type StartCaptureResult,
} from "@recall/contracts";
import { z } from "zod";

import { clearExtensionCredential } from "./auth-store";

export interface CaptureApiClient {
  start(input: StartCaptureInput): Promise<StartCaptureResult>;
  finalize(
    captureId: string,
    input: FinalizeCaptureInput,
  ): Promise<CaptureReceipt>;
  status(captureId: string): Promise<CaptureStatusResult>;
  reportFailure(
    captureId: string,
    input: ReportCaptureFailureInput,
  ): Promise<ReportCaptureFailureResult>;
}

const ExtensionApiErrorCodeSchema = z.enum([
  "authentication_required",
  "capture_already_failed",
  "capture_already_finalized",
  "capture_conflict",
  "capture_failure_conflict",
  "capture_not_finalized",
  "capture_not_found",
  "capture_session_expired",
  "idempotency_conflict",
  "invalid_capture",
  "invalid_or_expired_pairing_code",
  "invalid_pairing_request",
  "signed_upload_failed",
]);

export type ExtensionApiErrorCode = z.infer<
  typeof ExtensionApiErrorCodeSchema
>;

const CaptureIdSchema = z.string().uuid();
const RequestIdSchema = z.string().trim().min(1).max(500);

const safeErrorMessages: Record<ExtensionApiErrorCode, string> = {
  capture_failure_conflict:
    "The capture session state no longer accepts failure reporting",
  authentication_required: "扩展连接已失效，请重新配对",
  capture_already_failed: "该采集会话已经失败，需要重新采集",
  capture_already_finalized: "服务器已经保存该采集，正在恢复回执",
  capture_conflict: "采集内容与服务器记录冲突，需要重新采集",
  capture_not_finalized: "服务器尚未完成保存确认",
  capture_not_found: "服务器找不到该采集会话",
  capture_session_expired: "采集会话已过期，扩展将自动重试",
  idempotency_conflict: "采集幂等标识发生冲突，需要重新采集",
  invalid_capture: "采集内容不符合服务器要求",
  invalid_or_expired_pairing_code: "配对码无效或已过期",
  invalid_pairing_request: "配对请求无效",
  signed_upload_failed: "附件签名上传暂时失败",
};

export class ExtensionApiError extends Error {
  readonly captureId: string | undefined;
  readonly code: ExtensionApiErrorCode | "extension_auth_expired" | undefined;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(input: {
    status: number;
    captureId?: string | undefined;
    code?: ExtensionApiErrorCode | "extension_auth_expired" | undefined;
    requestId?: string | undefined;
    message?: string | undefined;
  }) {
    super(input.message ?? `Extension API request failed with HTTP ${input.status}`);
    this.name = "ExtensionApiError";
    this.status = input.status;
    this.captureId = input.captureId;
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

function usesSecureTransport(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  );
}

function apiOrigin(override?: string): string {
  const configured =
    override ?? import.meta.env.WXT_PUBLIC_API_ORIGIN ?? "http://localhost:3000";
  const url = new URL(configured);
  if (
    !usesSecureTransport(url) ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      "Extension API origin must use HTTPS, except for local development",
    );
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

  const value = payload as Record<string, unknown>;
  return {
    captureId: CaptureIdSchema.safeParse(value.captureId).data,
    code: ExtensionApiErrorCodeSchema.safeParse(value.code).data,
    requestId: RequestIdSchema.safeParse(value.requestId).data,
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
  const headerRequestId = RequestIdSchema.safeParse(
    response.headers.get("x-request-id"),
  ).data;
  const requestId = headerRequestId ?? details.requestId;
  if (response.status === 401 && dependencies.authenticated) {
    await dependencies.clearCredential();
    throw new ExtensionAuthExpiredError(requestId ?? undefined);
  }
  throw new ExtensionApiError({
    captureId: details.captureId,
    code: details.code,
    message:
      details.code === undefined
        ? `扩展 API 请求失败（HTTP ${response.status}）`
        : safeErrorMessages[details.code],
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
      fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
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
    fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
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
    async reportFailure(captureId, input) {
      return ReportCaptureFailureResultSchema.parse(
        await requestJson(
          `/api/captures/${encodeURIComponent(captureId)}/fail`,
          {
            body: JSON.stringify(ReportCaptureFailureInputSchema.parse(input)),
            headers: headers(),
            method: "POST",
          },
          resolved,
        ),
      );
    },
  };
}
