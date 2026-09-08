import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaptureUploadHttpError,
  type BrowserCaptureDraft,
  uploadCapture,
} from "./upload-capture";

const CAPTURE_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_ITEM_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `00000000-0000-4000-8000-000000000001/${CAPTURE_ID}/file-1-${"a".repeat(64)}-note.txt`;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function makeDraft(): BrowserCaptureDraft {
  return {
    attachments: [
      {
        clientId: "file-1",
        file: new File(["synthetic"], "note.txt", {
          type: "text/plain",
        }),
      },
    ],
    completeness: "complete",
    externalRef: null,
    messages: [],
    missingElements: [],
    rawText: "",
    scope: "upload",
    sensitivity: "normal",
    source: "manual_file",
    title: "Synthetic note",
  };
}

function startResponse() {
  return {
    captureId: CAPTURE_ID,
    uploadTargets: [
      {
        clientId: "file-1",
        storagePath: STORAGE_PATH,
        token: "signed-token",
      },
    ],
  };
}

function receiptResponse() {
  return {
    captureId: CAPTURE_ID,
    captureStatus: "complete",
    missingElements: [],
    processingStatus: "queued",
    savedAttachmentCount: 1,
    savedMessageCount: 0,
    sourceItemId: SOURCE_ITEM_ID,
  };
}

describe("uploadCapture", () => {
  const hashFile = vi.fn(async () => "a".repeat(64));
  const uploadToSignedUrl = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hashes, starts, uploads, and finalizes with one idempotency key", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(startResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));

    await expect(
      uploadCapture(makeDraft(), {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).resolves.toEqual(receiptResponse());

    const startBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    ) as { idempotencyKey: string };
    const finalizeBody = JSON.parse(
      String(fetchImplementation.mock.calls[1]?.[1]?.body),
    ) as {
      idempotencyKey: string;
      uploadedAttachments: Array<Record<string, unknown>>;
    };
    expect(startBody.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(finalizeBody.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(finalizeBody.uploadedAttachments).toEqual([
      { clientId: "file-1", storagePath: STORAGE_PATH },
    ]);
    expect(finalizeBody.uploadedAttachments[0]).not.toHaveProperty("etag");
    expect(uploadToSignedUrl).toHaveBeenCalledOnce();
  });

  it("starts a typed Xiaohongshu capture without a legacy source", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ captureId: CAPTURE_ID, uploadTargets: [] }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...receiptResponse(), savedAttachmentCount: 0 }),
      );

    await uploadCapture(
      {
        attachments: [],
        completeness: "complete",
        externalRef: "65abc123",
        messages: [],
        missingElements: [],
        rawText: "合成正文",
        scope: "web_page",
        sensitivity: "normal",
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
        title: "合成小红书笔记",
        metadata: {
          adapterName: "xiaohongshu",
          adapterVersion: "2026-09-08.v1",
          assets: [],
          author: "合成作者",
          capturedAt: "2026-09-08T01:00:00.000Z",
          canonicalUrl: "https://www.xiaohongshu.com/explore/65abc123",
        },
      },
      {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      },
    );

    const startBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    ) as {
      source?: string;
      sourceKind?: string;
      sourcePlatform?: string;
    };
    expect(startBody.sourceKind).toBe("social_post");
    expect(startBody.sourcePlatform).toBe("xiaohongshu");
    expect(startBody.source).toBeUndefined();
  });

  it("sends an explicit failed-session recovery link only in the start request", async () => {
    const recoveryCaptureId =
      "20000000-0000-4000-8000-000000000099";
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(startResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));

    await uploadCapture(
      { ...makeDraft(), recoveryCaptureId },
      {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      },
    );

    const startBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    ) as { recoveryCaptureId?: string };
    const finalizeBody = JSON.parse(
      String(fetchImplementation.mock.calls[1]?.[1]?.body),
    ) as { recoveryCaptureId?: string };
    expect(startBody.recoveryCaptureId).toBe(recoveryCaptureId);
    expect(finalizeBody).not.toHaveProperty("recoveryCaptureId");
  });

  it("surfaces a start failure without uploading or finalizing", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ code: "capture_unavailable" }, 503),
      );

    await expect(
      uploadCapture(makeDraft(), {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toMatchObject({
      code: "capture_unavailable",
      status: 503,
    });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("stops before finalize when a signed upload fails", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(startResponse(), 201));
    const uploadFailure = new Error("synthetic upload failure");
    uploadToSignedUrl.mockRejectedValueOnce(uploadFailure);

    await expect(
      uploadCapture(makeDraft(), {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toBe(uploadFailure);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("restarts every upload with the same key after a later file fails", async () => {
    const secondStoragePath = STORAGE_PATH.replace("file-1", "file-2");
    const firstDraft = makeDraft();
    const draft: BrowserCaptureDraft = {
      ...firstDraft,
      attachments: [
        ...firstDraft.attachments,
        {
          clientId: "file-2",
          file: new File(["synthetic second"], "second.txt", {
            type: "text/plain",
          }),
        },
      ],
    };
    const retryStartResponse = {
      captureId: CAPTURE_ID,
      uploadTargets: [
        startResponse().uploadTargets[0],
        {
          clientId: "file-2",
          storagePath: secondStoragePath,
          token: "signed-token-2",
        },
      ],
    };
    const retryReceipt = {
      ...receiptResponse(),
      savedAttachmentCount: 2,
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(retryStartResponse, 201))
      .mockResolvedValueOnce(jsonResponse(retryStartResponse, 200))
      .mockResolvedValueOnce(jsonResponse(retryReceipt));
    const uploadImplementation = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second upload failed"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      uploadCapture(draft, {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl: uploadImplementation,
      }),
    ).rejects.toThrow("second upload failed");
    await expect(
      uploadCapture(draft, {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl: uploadImplementation,
      }),
    ).resolves.toEqual(retryReceipt);

    const requestKeys = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as { idempotencyKey: string },
    );
    expect(requestKeys.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      IDEMPOTENCY_KEY,
      IDEMPOTENCY_KEY,
      IDEMPOTENCY_KEY,
    ]);
    expect(
      uploadImplementation.mock.calls.map(([target]) => target.clientId),
    ).toEqual(["file-1", "file-2", "file-1", "file-2"]);
  });

  it("surfaces finalize failure without constructing a receipt", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(startResponse(), 201))
      .mockResolvedValueOnce(
        jsonResponse({ code: "finalize_failed" }, 500),
      );

    await expect(
      uploadCapture(makeDraft(), {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toMatchObject({
      code: "finalize_failed",
      status: 500,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("recovers the committed receipt when the finalize response is lost", async () => {
    const draft = makeDraft();
    const statusReceipt = { ...receiptResponse(), failureReason: null };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(startResponse(), 201))
      .mockRejectedValueOnce(new TypeError("finalize response lost"))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            captureId: CAPTURE_ID,
            code: "capture_already_finalized",
            message: "The capture session is already finalized",
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(statusReceipt));

    await expect(
      uploadCapture(draft, {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toThrow("finalize response lost");
    await expect(
      uploadCapture(draft, {
        createIdempotencyKey: () => IDEMPOTENCY_KEY,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).resolves.toEqual(receiptResponse());

    expect(uploadToSignedUrl).toHaveBeenCalledOnce();
    const submittedKeys = fetchImplementation.mock.calls
      .filter(([, init]) => init?.body !== undefined)
      .map(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          idempotencyKey: string;
        };
        return body.idempotencyKey;
      });
    expect(submittedKeys).toEqual([
      IDEMPOTENCY_KEY,
      IDEMPOTENCY_KEY,
      IDEMPOTENCY_KEY,
    ]);
    expect(fetchImplementation.mock.calls[3]?.[0]).toBe(
      `/api/captures/${CAPTURE_ID}/status`,
    );
  });

  it("keeps the generated idempotency key when the same draft retries", async () => {
    const draft = makeDraft();
    const createIdempotencyKey = vi.fn(() => IDEMPOTENCY_KEY);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: "offline" }, 503))
      .mockResolvedValueOnce(jsonResponse({ code: "offline" }, 503));

    await expect(
      uploadCapture(draft, {
        createIdempotencyKey,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toBeInstanceOf(CaptureUploadHttpError);
    await expect(
      uploadCapture(draft, {
        createIdempotencyKey,
        fetch: fetchImplementation,
        hashFile,
        uploadToSignedUrl,
      }),
    ).rejects.toBeInstanceOf(CaptureUploadHttpError);

    const keys = fetchImplementation.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as {
        idempotencyKey: string;
      };
      return body.idempotencyKey;
    });
    expect(keys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("reuses an explicit idempotency key across different draft objects", async () => {
    const createIdempotencyKey = vi.fn(() => crypto.randomUUID());
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: "offline" }, 503))
      .mockResolvedValueOnce(jsonResponse({ code: "offline" }, 503));

    await expect(
      uploadCapture(
        { ...makeDraft(), idempotencyKey: IDEMPOTENCY_KEY },
        {
          createIdempotencyKey,
          fetch: fetchImplementation,
          hashFile,
          uploadToSignedUrl,
        },
      ),
    ).rejects.toBeInstanceOf(CaptureUploadHttpError);
    await expect(
      uploadCapture(
        { ...makeDraft(), idempotencyKey: IDEMPOTENCY_KEY },
        {
          createIdempotencyKey,
          fetch: fetchImplementation,
          hashFile,
          uploadToSignedUrl,
        },
      ),
    ).rejects.toBeInstanceOf(CaptureUploadHttpError);

    const keys = fetchImplementation.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as {
        idempotencyKey: string;
      };
      return body.idempotencyKey;
    });
    expect(keys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(createIdempotencyKey).not.toHaveBeenCalled();
  });

  it("reports preparation, per-file upload, and finalization progress", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(startResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(receiptResponse()));
    const onProgress = vi.fn();

    await uploadCapture(makeDraft(), {
      createIdempotencyKey: () => IDEMPOTENCY_KEY,
      fetch: fetchImplementation,
      hashFile,
      onProgress,
      uploadToSignedUrl,
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { stage: "preparing" },
      {
        completedFiles: 0,
        currentFileName: "note.txt",
        stage: "uploading",
        totalFiles: 1,
      },
      {
        completedFiles: 1,
        currentFileName: "note.txt",
        stage: "uploading",
        totalFiles: 1,
      },
      { stage: "finalizing" },
    ]);
  });
});
