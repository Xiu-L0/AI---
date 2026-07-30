import { expect, test, type Page } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  signInSyntheticUser,
  supabaseUrl,
} from "./local-auth";

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

async function browserJsonRequest(
  page: Page,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<JsonResponse> {
  return page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, {
        method: init.method,
        headers:
          init.body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body:
          init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    },
    { path, init },
  );
}

async function uploadSignedTarget(
  page: Page,
  uploadTarget: { storagePath: string; token: string },
  contents: string,
) {
  return page.evaluate(
    async ({ contents, supabaseUrl, uploadTarget }) => {
      const encodedPath = uploadTarget.storagePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append(
        "",
        new Blob([contents], { type: "text/plain" }),
        "notes.txt",
      );
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/upload/sign/raw-captures/${encodedPath}?token=${encodeURIComponent(uploadTarget.token)}`,
        {
          method: "PUT",
          headers: { "x-upsert": "false" },
          body: form,
        },
      );
      return {
        status: response.status,
        etag: response.headers.get("etag"),
        body: await response.text(),
      };
    },
    { contents, supabaseUrl, uploadTarget },
  );
}

test("capture API finalizes durably, is idempotent, and hides other owners", async ({
  page,
  request,
}) => {
  const unauthenticated = await request.post("/api/captures/start", {
    data: {},
  });
  expect(unauthenticated.status()).toBe(401);

  const owner = await createSyntheticUser("recall-capture-owner");
  const other = await createSyntheticUser("recall-capture-other");

  try {
    await signInSyntheticUser(page, owner.email);
    const idempotencyKey = `capture-${crypto.randomUUID()}`;
    const start = await browserJsonRequest(page, "/api/captures/start", {
      method: "POST",
      body: {
        idempotencyKey,
        source: "chatgpt_web",
        scope: "full_conversation",
        title: "Synthetic durable capture",
        sensitivity: "normal",
        externalRef: "synthetic-durable-conversation",
        attachments: [],
      },
    });
    expect(start.status).toBe(201);
    expect(start.body.uploadTargets).toEqual([]);
    expect(start.body.captureId).toEqual(expect.any(String));
    const captureId = String(start.body.captureId);

    const finalization = {
      idempotencyKey,
      completeness: "complete",
      missingElements: [],
      rawText: "Synthetic question\nSynthetic answer",
      messages: [
        {
          externalMessageId: "message-1",
          role: "user",
          text: "Synthetic question",
          ordinal: 0,
        },
        {
          externalMessageId: "message-2",
          role: "assistant",
          text: "Synthetic answer",
          ordinal: 1,
        },
      ],
      uploadedAttachments: [],
    };
    const finalized = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/finalize`,
      { method: "POST", body: finalization },
    );
    expect(finalized.status).toBe(200);
    expect(finalized.body).toMatchObject({
      captureId,
      captureStatus: "complete",
      processingStatus: "queued",
      savedMessageCount: 2,
      savedAttachmentCount: 0,
      missingElements: [],
    });

    const repeated = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/finalize`,
      { method: "POST", body: finalization },
    );
    expect(repeated).toEqual(finalized);

    const conflict = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/finalize`,
      {
        method: "POST",
        body: { ...finalization, rawText: "Different retry content." },
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("capture_conflict");

    const status = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/status`,
      { method: "GET" },
    );
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      captureId,
      captureStatus: "complete",
      processingStatus: "queued",
      failureReason: null,
    });

    const duplicateKey = `capture-${crypto.randomUUID()}`;
    const duplicateStart = await browserJsonRequest(
      page,
      "/api/captures/start",
      {
        method: "POST",
        body: {
          idempotencyKey: duplicateKey,
          source: "chatgpt_web",
          scope: "full_conversation",
          title: "Synthetic durable capture again",
          sensitivity: "normal",
          externalRef: "synthetic-durable-conversation",
          attachments: [],
        },
      },
    );
    expect(duplicateStart.status).toBe(201);
    const duplicateCaptureId = String(duplicateStart.body.captureId);
    const duplicate = await browserJsonRequest(
      page,
      `/api/captures/${duplicateCaptureId}/finalize`,
      {
        method: "POST",
        body: { ...finalization, idempotencyKey: duplicateKey },
      },
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      captureId: duplicateCaptureId,
      sourceItemId: finalized.body.sourceItemId,
      savedMessageCount: 2,
      savedAttachmentCount: 0,
    });

    const attachmentText = "Synthetic attachment bytes.";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(attachmentText),
    );
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const attachmentKey = `attachment-${crypto.randomUUID()}`;
    const attachmentStart = await browserJsonRequest(
      page,
      "/api/captures/start",
      {
        method: "POST",
        body: {
          idempotencyKey: attachmentKey,
          source: "manual_file",
          scope: "upload",
          title: "Synthetic attachment",
          sensitivity: "normal",
          externalRef: null,
          attachments: [
            {
              clientId: "file-1",
              fileName: "notes.txt",
              mimeType: "text/plain",
              byteSize: new TextEncoder().encode(attachmentText).byteLength,
              sha256,
            },
          ],
        },
      },
    );
    expect(attachmentStart.status).toBe(201);
    const attachmentCaptureId = String(attachmentStart.body.captureId);
    const [uploadTarget] = attachmentStart.body.uploadTargets as Array<{
      storagePath: string;
      token: string;
      clientId: string;
    }>;
    const uploaded = await uploadSignedTarget(
      page,
      uploadTarget,
      attachmentText,
    );
    expect(uploaded.status, uploaded.body).toBe(200);
    expect(uploaded.etag).toBeNull();

    const attachmentRetryStart = await browserJsonRequest(
      page,
      "/api/captures/start",
      {
        method: "POST",
        body: {
          idempotencyKey: attachmentKey,
          source: "manual_file",
          scope: "upload",
          title: "Synthetic attachment",
          sensitivity: "normal",
          externalRef: null,
          attachments: [
            {
              clientId: "file-1",
              fileName: "notes.txt",
              mimeType: "text/plain",
              byteSize: new TextEncoder().encode(attachmentText).byteLength,
              sha256,
            },
          ],
        },
      },
    );
    expect(attachmentRetryStart.status).toBe(201);
    expect(attachmentRetryStart.body.captureId).toBe(attachmentCaptureId);
    const [retryUploadTarget] = attachmentRetryStart.body
      .uploadTargets as Array<{
      storagePath: string;
      token: string;
      clientId: string;
    }>;
    expect(retryUploadTarget).toMatchObject({
      clientId: uploadTarget.clientId,
      storagePath: uploadTarget.storagePath,
    });

    // The server creates this retry token with upsert enabled. The extension's
    // direct signed-upload request deliberately keeps x-upsert=false, matching
    // storage-js; overwrite authority comes from the signed token.
    const retriedUpload = await uploadSignedTarget(
      page,
      retryUploadTarget,
      attachmentText,
    );
    expect(retriedUpload.status, retriedUpload.body).toBe(200);

    const attachmentFinalize = await browserJsonRequest(
      page,
      `/api/captures/${attachmentCaptureId}/finalize`,
      {
        method: "POST",
        body: {
          idempotencyKey: attachmentKey,
          completeness: "complete",
          missingElements: [],
          rawText: "",
          messages: [],
          uploadedAttachments: [
            {
              clientId: uploadTarget.clientId,
              storagePath: uploadTarget.storagePath,
            },
          ],
        },
      },
    );
    expect(attachmentFinalize.status).toBe(200);
    expect(attachmentFinalize.body).toMatchObject({
      captureId: attachmentCaptureId,
      captureStatus: "complete",
      savedAttachmentCount: 1,
    });

    const invalidHashKey = `attachment-${crypto.randomUUID()}`;
    const invalidHashStart = await browserJsonRequest(
      page,
      "/api/captures/start",
      {
        method: "POST",
        body: {
          idempotencyKey: invalidHashKey,
          source: "manual_file",
          scope: "upload",
          title: "Synthetic invalid attachment",
          sensitivity: "normal",
          externalRef: null,
          attachments: [
            {
              clientId: "file-1",
              fileName: "notes.txt",
              mimeType: "text/plain",
              byteSize: new TextEncoder().encode(attachmentText).byteLength,
              sha256: "f".repeat(64),
            },
          ],
        },
      },
    );
    expect(invalidHashStart.status).toBe(201);
    const invalidHashCaptureId = String(invalidHashStart.body.captureId);
    const [invalidHashTarget] = invalidHashStart.body
      .uploadTargets as Array<{
      storagePath: string;
      token: string;
      clientId: string;
    }>;
    const invalidHashUpload = await uploadSignedTarget(
      page,
      invalidHashTarget,
      attachmentText,
    );
    expect(invalidHashUpload.status, invalidHashUpload.body).toBe(200);

    const rejectedAttachment = await browserJsonRequest(
      page,
      `/api/captures/${invalidHashCaptureId}/finalize`,
      {
        method: "POST",
        body: {
          idempotencyKey: invalidHashKey,
          completeness: "complete",
          missingElements: [],
          rawText: "",
          messages: [],
          uploadedAttachments: [
            {
              clientId: invalidHashTarget.clientId,
              storagePath: invalidHashTarget.storagePath,
            },
          ],
        },
      },
    );
    expect(rejectedAttachment.status).toBe(409);
    expect(rejectedAttachment.body.code).toBe("capture_conflict");
    const rejectedStatus = await browserJsonRequest(
      page,
      `/api/captures/${invalidHashCaptureId}/status`,
      { method: "GET" },
    );
    expect(rejectedStatus.status).toBe(409);
    expect(rejectedStatus.body.code).toBe("capture_not_finalized");

    await page.context().clearCookies();
    await signInSyntheticUser(page, other.email);
    const hidden = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/status`,
      { method: "GET" },
    );
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe("capture_not_found");
  } finally {
    expect(await deleteSyntheticUser(owner.id)).toBe(true);
    expect(await deleteSyntheticUser(other.id)).toBe(true);
  }
});
