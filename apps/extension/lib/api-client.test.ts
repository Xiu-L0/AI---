import { describe, expect, it, vi } from "vitest";

import {
  createCaptureApiClient,
  exchangeExtensionPairingCode,
  ExtensionApiError,
  ExtensionAuthExpiredError,
} from "./api-client";

const token = "a".repeat(43);

describe("CaptureApiClient", () => {
  it("rejects API URLs that are not a base origin", () => {
    expect(() =>
      createCaptureApiClient(token, {
        apiOrigin: "https://recall.example.test/api",
      }),
    ).toThrow("Extension API origin must use HTTPS");
  });

  it("rejects plaintext remote API origins", () => {
    expect(() =>
      createCaptureApiClient(token, {
        apiOrigin: "http://recall.example.test",
      }),
    ).toThrow("Extension API origin must use HTTPS");
  });

  it("sends the bearer token and validates a start response", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        captureId: "20000000-0000-4000-8000-000000000001",
        uploadTargets: [],
      }),
    );
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: fetchImplementation,
    });

    await client.start({
      attachments: [],
      externalRef: null,
      idempotencyKey: "capture-key-1",
      scope: "upload",
      sensitivity: "normal",
      source: "manual_text",
      title: "Synthetic",
    });

    const headers = fetchImplementation.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  it("clears the credential and throws a typed error on 401", async () => {
    const clearCredential = vi.fn(async () => undefined);
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      clearCredential,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { code: "authentication_required" },
          { headers: { "x-request-id": "request-1" }, status: 401 },
        ),
      ),
    });

    await expect(client.status("capture-id")).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionAuthExpiredError>>({
        requestId: "request-1",
        status: 401,
      }),
    );
    expect(clearCredential).toHaveBeenCalledOnce();
  });

  it("retains server error details for non-auth failures", async () => {
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { code: "capture_not_found", message: "Not found", requestId: "r2" },
          { status: 404 },
        ),
      ),
    });

    await expect(client.status("missing")).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        code: "capture_not_found",
        requestId: "r2",
        status: 404,
      }),
    );
  });

  it("retains a validated capture id for an already-finalized start", async () => {
    const captureId = "20000000-0000-4000-8000-000000000001";
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            captureId,
            code: "capture_already_finalized",
            message: "Capture already finalized",
            ignored: { arbitrary: "payload" },
          },
          { status: 409 },
        ),
      ),
    });

    await expect(
      client.start({
        attachments: [],
        externalRef: null,
        idempotencyKey: "capture-key-1",
        scope: "upload",
        sensitivity: "normal",
        source: "manual_text",
        title: "Synthetic",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        captureId,
        code: "capture_already_finalized",
        status: 409,
      }),
    );
  });

  it("drops an invalid capture id while retaining a recognized status error", async () => {
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            captureId: "not-a-uuid",
            code: "capture_not_finalized",
            message: "Capture is still pending",
          },
          { status: 409 },
        ),
      ),
    });

    await expect(
      client.status("20000000-0000-4000-8000-000000000001"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        captureId: undefined,
        code: "capture_not_finalized",
        status: 409,
      }),
    );
  });

  it("does not retain unknown error codes or unsafe oversized messages", async () => {
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: "future_untrusted_code",
            message: "x".repeat(2_001),
          },
          { status: 500 },
        ),
      ),
    });

    const request = client.status("20000000-0000-4000-8000-000000000001");
    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        code: undefined,
        message: "扩展 API 请求失败（HTTP 500）",
        status: 500,
      }),
    );
    await expect(request).rejects.not.toThrow("x".repeat(2_001));
  });

  it("maps recognized server errors to fixed safe user copy", async () => {
    const client = createCaptureApiClient(token, {
      apiOrigin: "http://127.0.0.1:3000",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: "capture_not_found",
            message: "database path C:/private and signed-token=secret",
          },
          { status: 404 },
        ),
      ),
    });

    const request = client.status("20000000-0000-4000-8000-000000000001");
    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        message: "服务器找不到该采集会话",
      }),
    );
    await expect(request).rejects.not.toThrow("signed-token");
  });

  it("keeps an invalid pairing code as a pairing error", async () => {
    await expect(
      exchangeExtensionPairingCode(
        { code: "ABCDEFGH", label: "Chrome" },
        {
          apiOrigin: "http://127.0.0.1:3000",
          fetch: vi.fn<typeof fetch>().mockResolvedValue(
            Response.json(
              { code: "invalid_or_expired_pairing_code" },
              { status: 401 },
            ),
          ),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExtensionApiError>>({
        code: "invalid_or_expired_pairing_code",
        status: 401,
      }),
    );
  });
});
