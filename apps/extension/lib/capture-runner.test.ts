import type {
  CaptureReceipt,
  CaptureStatusResult,
  StartCaptureResult,
} from "@recall/contracts";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { ExtensionApiError, ExtensionAuthExpiredError } from "./api-client";
import type { CaptureApiClient } from "./api-client";
import {
  createCaptureRunner,
  type CaptureRunnerOutbox,
} from "./capture-runner";
import type { OutboxItem } from "./outbox-types";
import { StorageUploadError } from "./storage-upload";

const captureId = "10000000-0000-4000-8000-000000000001";
const sourceItemId = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-30T12:00:00.000Z");

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    attachmentsPrepared: true,
    attemptCount: 0,
    captureId: null,
    createdAt: now.toISOString(),
    draft: {
      attachments: [],
      completeness: "complete",
      externalRef: "conversation-1",
      messages: [
        { externalMessageId: "m1", ordinal: 0, role: "user", text: "Q" },
        { externalMessageId: "m2", ordinal: 1, role: "assistant", text: "A" },
      ],
      missingElements: [],
      originConversationRef: "conversation-1",
      originTabId: 1,
      originUrl: "https://chatgpt.com/c/conversation-1",
      originWindowId: 1,
      pendingImages: [],
      rawText: "Q\n\nA",
      scope: "full_conversation",
      sensitivity: "normal",
      source: "chatgpt_web",
      title: "Synthetic",
    },
    errorCode: null,
    id: "outbox-1",
    idempotencyKey: "idempotency-key-1",
    lastError: null,
    lastNotifiedAttemptCount: 0,
    nextAttemptAt: now.toISOString(),
    receipt: null,
    receiptStoredAt: null,
    recoveryOfItemId: null,
    resolvedAt: null,
    resumeStage: "preparing",
    schemaVersion: 1,
    state: "pending",
    supersededByItemId: null,
    updatedAt: now.toISOString(),
    uploadedAttachments: [],
    ...overrides,
  };
}

function receipt(
  captureStatus: "complete" | "partial" = "complete",
  missingElements: string[] = [],
): CaptureReceipt {
  return {
    captureId,
    captureStatus,
    missingElements,
    processingStatus: "queued",
    savedAttachmentCount: 0,
    savedMessageCount: 2,
    sourceItemId,
  };
}

function failureReport() {
  return {
    captureId,
    captureStatus: "failed" as const,
    failureReason: "The capture could not be completed safely",
  };
}

function fakeOutbox(initial = item(), related: OutboxItem[] = []) {
  let current = initial;
  const relatedById = new Map(related.map((entry) => [entry.id, entry]));
  const events: string[] = [];
  const port: CaptureRunnerOutbox = {
    async get(id) {
      events.push("get");
      if (id !== current.id) {
        const relatedItem = relatedById.get(id);
        if (!relatedItem) throw new Error(`Missing related outbox item ${id}`);
        return relatedItem;
      }
      return current;
    },
    async markAuthPaused(_id, code, message) {
      events.push("auth_paused");
      current = { ...current, errorCode: code, lastError: message, state: "auth_paused" };
      return current;
    },
    async markRetry(_id, code, message) {
      events.push("retry_wait");
      current = { ...current, errorCode: code, lastError: message, state: "retry_wait" };
      return current;
    },
    async markTerminal(_id, code, message) {
      events.push("terminal");
      current = {
        ...current,
        errorCode: code,
        failureReportAttemptCount: 0,
        failureReportNextAttemptAt:
          current.captureId === null ? null : now.toISOString(),
        failureReportStatus:
          current.captureId === null ? "not_applicable" : "pending",
        failureReportedAt: null,
        lastError: message,
        state: "terminal",
      };
      return current;
    },
    async mutate(_id, updater) {
      current = await updater(current);
      events.push(`mutate:${current.state}`);
      return current;
    },
    async storeReceipt(_id, savedReceipt) {
      events.push("receipt");
      current = {
        ...current,
        captureId: savedReceipt.captureId,
        receipt: savedReceipt,
        receiptStoredAt: now.toISOString(),
        state: savedReceipt.captureStatus,
      };
      return current;
    },
  };
  return { events, get current() { return current; }, port };
}

function startResult(): StartCaptureResult {
  return { captureId, uploadTargets: [] };
}

function pendingImageItem(sourceUrl = "https://images.example.test/image.png") {
  return item({
    attachmentsPrepared: false,
    draft: {
      ...item().draft,
      pendingImages: [
        {
          alt: "fixture",
          clientId: "image-1",
          fileName: "image-1.png",
          messageOrdinal: 1,
          sourceUrl,
        },
      ],
    },
  });
}

function syntheticPngBlob() {
  return new Blob(
    [syntheticPngBytes()],
    { type: "image/png" },
  );
}

function syntheticPngBytes() {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
}

async function bytesHash(bytes: Uint8Array) {
  const copied = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copied).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copied);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dependencies(
  outbox = fakeOutbox(),
  apiOverrides: Partial<CaptureApiClient> = {},
) {
  const api: CaptureApiClient = {
    finalize:
      apiOverrides.finalize ?? vi.fn(async () => receipt()),
    reportFailure:
      apiOverrides.reportFailure ?? vi.fn(async () => failureReport()),
    start: apiOverrides.start ?? vi.fn(async () => startResult()),
    status:
      apiOverrides.status ??
      vi.fn(async () => {
        throw new ExtensionApiError({
          code: "capture_not_finalized",
          status: 409,
        });
      }),
  };
  return {
    api,
    outbox,
    runner: createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      getApiClient: async () => api,
      outbox: outbox.port,
      upload: vi.fn(),
    }),
  };
}

describe("capture runner", () => {
  it("stores capture id before finalize and sends structured messages only once", async () => {
    const setup = dependencies();

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("complete");
    expect(setup.outbox.events).toEqual([
      "get",
      "mutate:uploading",
      "mutate:finalizing",
      "receipt",
    ]);
    expect(setup.api.finalize).toHaveBeenCalledWith(
      captureId,
      expect.objectContaining({
        idempotencyKey: "idempotency-key-1",
        rawText: "",
      }),
    );
    expect(setup.api.reportFailure).not.toHaveBeenCalled();
  });

  it("recovers a lost finalize response from a real status receipt", async () => {
    const statusReceipt: CaptureStatusResult = {
      ...receipt(),
      failureReason: null,
    };
    const setup = dependencies(fakeOutbox(), {
      finalize: vi.fn(async () => {
        throw new TypeError("connection closed");
      }),
      status: vi.fn(async () => statusReceipt),
    });

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.receipt).toEqual(receipt());
    expect(setup.outbox.events.at(-1)).toBe("receipt");
  });

  it("treats capture_already_finalized as a status recovery signal", async () => {
    const statusReceipt: CaptureStatusResult = {
      ...receipt(),
      failureReason: null,
    };
    const setup = dependencies(fakeOutbox(), {
      start: vi.fn(async () => {
        throw new ExtensionApiError({
          captureId,
          code: "capture_already_finalized",
          status: 409,
        });
      }),
      status: vi.fn(async () => statusReceipt),
    });

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("complete");
    expect(setup.api.status).toHaveBeenCalledWith(captureId);
  });

  it("refreshes start with the stable idempotency key on retry", async () => {
    const retryItem = item({
      captureId,
      resumeStage: "uploading",
      state: "retry_wait",
    });
    const setup = dependencies(fakeOutbox(retryItem));

    await setup.runner.processOutboxItem("outbox-1", now);

    expect(setup.api.start).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "idempotency-key-1" }),
    );
  });

  it("sends the prior server capture id for an explicit terminal recovery", async () => {
    const terminal = item({
      captureId,
      id: "terminal-outbox",
      state: "terminal",
    });
    const recovery = item({ recoveryOfItemId: terminal.id });
    const setup = dependencies(fakeOutbox(recovery, [terminal]));

    await setup.runner.processOutboxItem(recovery.id, now);

    expect(setup.api.start).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryCaptureId: captureId }),
    );
  });

  it("walks past a local-only terminal ancestor to the nearest server session", async () => {
    const serverTerminal = item({
      captureId,
      id: "server-terminal",
      state: "terminal",
    });
    const localTerminal = item({
      captureId: null,
      id: "local-terminal",
      recoveryOfItemId: serverTerminal.id,
      state: "terminal",
    });
    const recovery = item({ recoveryOfItemId: localTerminal.id });
    const setup = dependencies(
      fakeOutbox(recovery, [localTerminal, serverTerminal]),
    );

    await setup.runner.processOutboxItem(recovery.id, now);

    expect(setup.api.start).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryCaptureId: captureId }),
    );
  });

  it("does not treat a finalized partial screenshot supplement as failed-session recovery", async () => {
    const partial = item({
      captureId,
      id: "partial-outbox",
      receipt: receipt("partial", ["图片无法读取"]),
      receiptStoredAt: now.toISOString(),
      state: "partial",
    });
    const supplement = item({ recoveryOfItemId: partial.id });
    const setup = dependencies(fakeOutbox(supplement, [partial]));

    await setup.runner.processOutboxItem(supplement.id, now);

    expect(setup.api.start).toHaveBeenCalledWith(
      expect.not.objectContaining({ recoveryCaptureId: expect.anything() }),
    );
  });

  it("pauses an item when extension authentication expires", async () => {
    const setup = dependencies(fakeOutbox(), {
      start: vi.fn(async () => {
        throw new ExtensionAuthExpiredError();
      }),
    });

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("auth_paused");
    expect(result.receipt).toBeNull();
  });

  it.each([403, 422])(
    "terminates an unrecognized deterministic HTTP %s API response",
    async (status) => {
      const setup = dependencies(fakeOutbox(), {
        start: vi.fn(async () => {
          throw new ExtensionApiError({ status });
        }),
      });

      const result = await setup.runner.processOutboxItem("outbox-1", now);

      expect(result.state).toBe("terminal");
      expect(result.receipt).toBeNull();
      expect(setup.api.reportFailure).not.toHaveBeenCalled();
    },
  );

  it("retains a non-recoverable finalization contract error as terminal", async () => {
    const oversized = item({
      draft: {
        ...item().draft,
        messages: [
          {
            externalMessageId: "m1",
            ordinal: 0,
            role: "user",
            text: "a".repeat(2 * 1024 * 1024),
          },
          { externalMessageId: "m2", ordinal: 1, role: "assistant", text: "b" },
        ],
      },
    });
    const setup = dependencies(fakeOutbox(oversized));

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("invalid_capture");
    expect(setup.api.finalize).not.toHaveBeenCalled();
  });

  it("coalesces concurrent processing of the same item", async () => {
    let releaseStart!: (value: StartCaptureResult) => void;
    const startPromise = new Promise<StartCaptureResult>((resolve) => {
      releaseStart = resolve;
    });
    const setup = dependencies(fakeOutbox(), {
      start: vi.fn(() => startPromise),
    });

    const first = setup.runner.processOutboxItem("outbox-1", now);
    const second = setup.runner.processOutboxItem("outbox-1", now);
    releaseStart(startResult());
    await Promise.all([first, second]);

    expect(setup.api.start).toHaveBeenCalledTimes(1);
    expect(setup.api.finalize).toHaveBeenCalledTimes(1);
  });

  it("turns an unreadable pending image into an honest partial capture", async () => {
    const pending = pendingImageItem("https://images.example.test/missing.png");
    const outbox = fakeOutbox(pending);
    const api: CaptureApiClient = {
      finalize: vi.fn(async (_captureId, input) =>
        receipt("partial", input.missingElements),
      ),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => startResult()),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      fetch: vi.fn(async () => new Response("denied", { status: 403 })),
      getApiClient: async () => api,
      outbox: outbox.port,
      upload: vi.fn(),
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("partial");
    expect(result.receipt?.missingElements[0]).toContain("HTTP 403");
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [] }),
    );
  });

  it.each([429, 500, 503])(
    "keeps a pending image retryable after HTTP %s",
    async (status) => {
      const outbox = fakeOutbox(pendingImageItem());
      const api: CaptureApiClient = {
        finalize: vi.fn(),
        reportFailure: vi.fn(async () => failureReport()),
        start: vi.fn(async () => startResult()),
        status: vi.fn(),
      };
      const runner = createCaptureRunner({
        attachmentStore: {
          getAttachment: vi.fn(async () => null),
          putAttachment: vi.fn(async () => undefined),
        },
        fetch: vi.fn(async () => new Response(null, { status })),
        getApiClient: async () => api,
        outbox: outbox.port,
      });

      const result = await runner.processOutboxItem("outbox-1", now);

      expect(result.state).toBe("retry_wait");
      expect(result.attachmentsPrepared).toBe(false);
      expect(result.draft.pendingImages).toHaveLength(1);
      expect(api.start).not.toHaveBeenCalled();
    },
  );

  it("keeps a pending image retryable after a network failure", async () => {
    const outbox = fakeOutbox(pendingImageItem());
    const api: CaptureApiClient = {
      finalize: vi.fn(),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => startResult()),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      fetch: vi.fn(async () => {
        throw new TypeError("request failed for https://secret.example/path");
      }),
      getApiClient: async () => api,
      outbox: outbox.port,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("retry_wait");
    expect(result.lastError).toBe("图片下载暂时失败");
    expect(result.lastError).not.toContain("secret.example");
    expect(result.draft.pendingImages).toHaveLength(1);
  });

  it("blocks Recall API and Supabase origins without fetching them", async () => {
    for (const sourceUrl of [
      "https://api.recall.test/private.png",
      "https://project.supabase.co/storage.png",
    ]) {
      const outbox = fakeOutbox(pendingImageItem(sourceUrl));
      const fetcher = vi.fn<typeof fetch>();
      const api: CaptureApiClient = {
        finalize: vi.fn(async (_captureId, input) =>
          receipt("partial", input.missingElements),
        ),
        reportFailure: vi.fn(async () => failureReport()),
        start: vi.fn(async () => startResult()),
        status: vi.fn(),
      };
      const runner = createCaptureRunner({
        attachmentStore: {
          getAttachment: vi.fn(async () => null),
          putAttachment: vi.fn(async () => undefined),
        },
        blockedImageOrigins: [
          "https://api.recall.test",
          "https://project.supabase.co",
        ],
        fetch: fetcher,
        getApiClient: async () => api,
        outbox: outbox.port,
      });

      const result = await runner.processOutboxItem("outbox-1", now);

      expect(result.state).toBe("partial");
      expect(result.receipt?.missingElements.join(" ")).not.toContain(sourceUrl);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("does not follow image redirects before reading response bytes", async () => {
    const outbox = fakeOutbox(pendingImageItem());
    const blob = vi.fn(async () => syntheticPngBlob());
    const api: CaptureApiClient = {
      finalize: vi.fn(async (_captureId, input) =>
        receipt("partial", input.missingElements),
      ),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => startResult()),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      blockedImageOrigins: ["https://api.recall.test"],
      fetch: vi.fn(async () =>
        ({
          blob,
          ok: false,
          status: 0,
          type: "opaqueredirect",
          url: "",
        }) as unknown as Response,
      ),
      getApiClient: async () => api,
      outbox: outbox.port,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("partial");
    expect(blob).not.toHaveBeenCalled();
    expect(result.receipt?.missingElements.join(" ")).toContain(
      "图片重定向未被允许",
    );
  });

  it("rejects non-local HTTP image origins without requesting them", async () => {
    const outbox = fakeOutbox(
      pendingImageItem("http://images.example.test/insecure.png"),
    );
    const fetcher = vi.fn<typeof fetch>();
    const api: CaptureApiClient = {
      finalize: vi.fn(async (_captureId, input) =>
        receipt("partial", input.missingElements),
      ),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => startResult()),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      fetch: fetcher,
      getApiClient: async () => api,
      outbox: outbox.port,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("partial");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches permitted images without credentials and validates their signature", async () => {
    const outbox = fakeOutbox(pendingImageItem());
    const fetcher = vi.fn(async () =>
      new Response(syntheticPngBytes(), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const upload = vi.fn(async () => ({
      clientId: "image-1",
      etag: "etag-1",
      storagePath: "owner/capture/image-1.png",
    }));
    const api: CaptureApiClient = {
      finalize: vi.fn(async () => ({ ...receipt(), savedAttachmentCount: 1 })),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => ({
        captureId,
        uploadTargets: [
          {
            clientId: "image-1",
            storagePath: "owner/capture/image-1.png",
            token: "signed-token",
          },
        ],
      })),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => syntheticPngBlob()),
        putAttachment: vi.fn(async () => undefined),
      },
      fetch: fetcher,
      getApiClient: async () => api,
      outbox: outbox.port,
      upload,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("complete");
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("turns a forged image MIME type into a partial capture", async () => {
    const outbox = fakeOutbox(pendingImageItem());
    const api: CaptureApiClient = {
      finalize: vi.fn(async (_captureId, input) =>
        receipt("partial", input.missingElements),
      ),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => startResult()),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => null),
        putAttachment: vi.fn(async () => undefined),
      },
      fetch: vi.fn(async () =>
        new Response(new Blob(["not a png"], { type: "image/png" }), {
          headers: { "Content-Type": "image/png" },
        }),
      ),
      getApiClient: async () => api,
      outbox: outbox.port,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("partial");
    expect(result.receipt?.missingElements.join(" ")).toContain(
      "图片内容与声明格式不一致",
    );
  });

  it("terminates when upload target ids differ from the frozen manifest", async () => {
    const frozen = item({
      draft: {
        ...item().draft,
        attachments: [
          {
            blobKey: "blob-1",
            byteSize: 12,
            clientId: "image-1",
            fileName: "image-1.png",
            mimeType: "image/png",
            sha256: "a".repeat(64),
          },
        ],
      },
    });
    const outbox = fakeOutbox(frozen);
    const reportFailure = vi.fn(async () => {
      outbox.events.push("report-failure");
      return failureReport();
    });
    const setup = dependencies(outbox, {
      reportFailure,
      start: vi.fn(async () => ({
        captureId,
        uploadTargets: [
          {
            clientId: "different-image",
            storagePath: "owner/capture/different.png",
            token: "signed-token",
          },
        ],
      })),
    });

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("upload_target_mismatch");
    expect(result.failureReportStatus).toBe("reported");
    expect(reportFailure).toHaveBeenCalledWith(captureId, {
      failureCode: "upload_target_mismatch",
    });
    expect(outbox.events.indexOf("terminal")).toBeLessThan(
      outbox.events.indexOf("report-failure"),
    );
  });

  it("retries only failure reporting after a transient report network error", async () => {
    const frozen = item({
      draft: {
        ...item().draft,
        attachments: [
          {
            blobKey: "blob-1",
            byteSize: 12,
            clientId: "image-1",
            fileName: "image-1.png",
            mimeType: "image/png",
            sha256: "a".repeat(64),
          },
        ],
      },
    });
    const reportFailure = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(failureReport());
    const setup = dependencies(fakeOutbox(frozen), {
      reportFailure,
      start: vi.fn(async () => ({
        captureId,
        uploadTargets: [],
      })),
    });

    const first = await setup.runner.processOutboxItem(frozen.id, now);

    expect(first.state).toBe("terminal");
    expect(first.receipt).toBeNull();
    expect(first.failureReportStatus).toBe("pending");
    expect(first.failureReportAttemptCount).toBe(1);
    expect(first.failureReportNextAttemptAt).toBe(
      new Date(now.getTime() + 30_000).toISOString(),
    );

    const retried = await setup.runner.processOutboxItem(
      frozen.id,
      new Date(now.getTime() + 30_000),
    );

    expect(retried.state).toBe("terminal");
    expect(retried.receipt).toBeNull();
    expect(retried.failureReportStatus).toBe("reported");
    expect(retried.failureReportedAt).toBe(
      new Date(now.getTime() + 30_000).toISOString(),
    );
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(setup.api.start).toHaveBeenCalledTimes(1);
    expect(setup.api.finalize).not.toHaveBeenCalled();
  });

  it("settles a deterministic failure-report conflict without inventing success", async () => {
    const terminal = item({
      captureId,
      errorCode: "invalid_capture",
      failureReportNextAttemptAt: now.toISOString(),
      failureReportStatus: "pending",
      state: "terminal",
    });
    const setup = dependencies(fakeOutbox(terminal), {
      reportFailure: vi.fn(async () => {
        throw new ExtensionApiError({
          code: "capture_failure_conflict",
          status: 409,
        });
      }),
    });

    const result = await setup.runner.processOutboxItem(terminal.id, now);

    expect(result.state).toBe("terminal");
    expect(result.receipt).toBeNull();
    expect(result.failureReportStatus).toBe("rejected");
    expect(result.failureReportedAt).toBeNull();
    expect(setup.api.start).not.toHaveBeenCalled();
    expect(setup.api.finalize).not.toHaveBeenCalled();
  });

  it("terminates deterministic signed-upload client errors", async () => {
    const blob = syntheticPngBlob();
    const hash = await bytesHash(syntheticPngBytes());
    const frozen = item({
      draft: {
        ...item().draft,
        attachments: [
          {
            blobKey: "blob-1",
            byteSize: blob.size,
            clientId: "image-1",
            fileName: "image-1.png",
            mimeType: "image/png",
            sha256: hash,
          },
        ],
      },
    });
    const outbox = fakeOutbox(frozen);
    const api: CaptureApiClient = {
      finalize: vi.fn(),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => ({
        captureId,
        uploadTargets: [
          {
            clientId: "image-1",
            storagePath: "owner/capture/image-1.png",
            token: "signed-token",
          },
        ],
      })),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => blob),
        putAttachment: vi.fn(async () => undefined),
      },
      getApiClient: async () => api,
      outbox: outbox.port,
      upload: vi.fn(async () => {
        throw new StorageUploadError(400);
      }),
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("storage_upload_failed");
  });

  it("rejects a stored attachment whose bytes do not match its image signature", async () => {
    const forgedBytes = new TextEncoder().encode("not a png");
    const forgedBlob = new Blob([forgedBytes], { type: "image/png" });
    const frozen = item({
      draft: {
        ...item().draft,
        attachments: [
          {
            blobKey: "blob-1",
            byteSize: forgedBlob.size,
            clientId: "image-1",
            fileName: "image-1.png",
            mimeType: "image/png",
            sha256: await bytesHash(forgedBytes),
          },
        ],
      },
    });
    const outbox = fakeOutbox(frozen);
    const upload = vi.fn();
    const api: CaptureApiClient = {
      finalize: vi.fn(),
      reportFailure: vi.fn(async () => failureReport()),
      start: vi.fn(async () => ({
        captureId,
        uploadTargets: [
          {
            clientId: "image-1",
            storagePath: "owner/capture/image-1.png",
            token: "signed-token",
          },
        ],
      })),
      status: vi.fn(),
    };
    const runner = createCaptureRunner({
      attachmentStore: {
        getAttachment: vi.fn(async () => forgedBlob),
        putAttachment: vi.fn(async () => undefined),
      },
      getApiClient: async () => api,
      outbox: outbox.port,
      upload,
    });

    const result = await runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("attachment_manifest_conflict");
    expect(upload).not.toHaveBeenCalled();
  });

  it("treats malformed successful API data as terminal", async () => {
    const setup = dependencies(fakeOutbox(), {
      start: vi.fn(async () => {
        throw new ZodError([]);
      }),
    });

    const result = await setup.runner.processOutboxItem("outbox-1", now);

    expect(result.state).toBe("terminal");
    expect(result.errorCode).toBe("invalid_server_response");
  });
});
