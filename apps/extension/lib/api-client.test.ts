import { describe, expect, it, vi } from "vitest";

import {
  createCaptureApiClient,
  exchangeExtensionPairingCode,
  ExtensionApiError,
  ExtensionAuthExpiredError,
} from "./api-client";

const token = "a".repeat(43);

describe("CaptureApiClient", () => {
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
