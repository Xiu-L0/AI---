import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  publishableKey,
  serviceRoleKey,
  signInSyntheticUser,
  supabaseUrl,
} from "./local-auth";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const PNG_SHA = createHash("sha256").update(PNG_BYTES).digest("hex");
const OCR_MARKDOWN = "Synthetic Xiaohongshu OCR excerpt.";

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
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    },
    { path, init },
  );
}

async function rest(
  path: string,
  init: {
    accessToken: string;
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    query?: string;
  },
) {
  const url = `${supabaseUrl}/rest/v1/${path}${init.query ?? ""}`;
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.accessToken === serviceRoleKey ? serviceRoleKey : publishableKey,
      Authorization: `Bearer ${init.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : (JSON.parse(text) as unknown),
  };
}

async function restAsService(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: string } = {},
) {
  return rest(path, { accessToken: serviceRoleKey, ...init });
}

function sessionAccessToken(cookies: Array<{ name: string; value: string }>) {
  const chunks = cookies
    .filter((cookie) => /auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const raw = chunks.map((cookie) => decodeURIComponent(cookie.value)).join("");
  const payload = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64").toString("utf8")
    : raw;
  const parsed = JSON.parse(payload) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error("Signed-in session is missing an access token");
  }
  return parsed.access_token;
}

async function uploadPng(
  page: Page,
  uploadTarget: { storagePath: string; token: string },
) {
  return page.evaluate(
    async ({ pngBase64, supabaseUrl, uploadTarget }) => {
      const binary = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      const encodedPath = uploadTarget.storagePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", new Blob([binary], { type: "image/png" }), "xhs-image-1.png");
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/upload/sign/raw-captures/${encodedPath}?token=${encodeURIComponent(uploadTarget.token)}`,
        { method: "PUT", headers: { "x-upsert": "false" }, body: form },
      );
      return { status: response.status, body: await response.text() };
    },
    { pngBase64: PNG_BASE64, supabaseUrl, uploadTarget },
  );
}

async function captureXiaohongshuNote(page: Page, title: string) {
  const idempotencyKey = `xhs-ocr-${crypto.randomUUID()}`;
  const start = await browserJsonRequest(page, "/api/captures/start", {
    method: "POST",
    body: {
      idempotencyKey,
      sourcePlatform: "xiaohongshu",
      sourceKind: "social_post",
      scope: "web_page",
      title,
      sensitivity: "normal",
      externalRef: `note-${crypto.randomUUID()}`,
      metadata: {
        adapterName: "xiaohongshu",
        adapterVersion: "stage-2c-e2e",
        canonicalUrl: "https://www.xiaohongshu.com/explore/note-e2e-ocr",
        author: "合成作者",
        capturedAt: new Date().toISOString(),
        assets: [{ clientId: "xhs-image-1", ordinal: 0, alt: "" }],
      },
      attachments: [
        {
          clientId: "xhs-image-1",
          fileName: "xhs-image-1.png",
          mimeType: "image/png",
          byteSize: PNG_BYTES.byteLength,
          sha256: PNG_SHA,
        },
      ],
    },
  });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  const captureId = String(start.body.captureId);
  const [uploadTarget] = start.body.uploadTargets as Array<{
    storagePath: string;
    token: string;
  }>;
  const uploaded = await uploadPng(page, uploadTarget);
  expect(uploaded.status, uploaded.body).toBe(200);

  const finalized = await browserJsonRequest(
    page,
    `/api/captures/${captureId}/finalize`,
    {
      method: "POST",
      body: {
        idempotencyKey,
        completeness: "complete",
        missingElements: [],
        rawText: "synthetic xiaohongshu body",
        messages: [],
        uploadedAttachments: [
          {
            clientId: "xhs-image-1",
            storagePath: uploadTarget.storagePath,
          },
        ],
      },
    },
  );
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  return {
    captureId,
    sourceItemId: String(finalized.body.sourceItemId),
    storagePath: uploadTarget.storagePath,
  };
}

async function loadOwnedCapture(ownerUserId: string, sourceItemId: string) {
  const item = await restAsService("source_items", {
    query: `?id=eq.${sourceItemId}&owner_user_id=eq.${ownerUserId}&select=id,space_id`,
  });
  const versions = await restAsService("source_versions", {
    query: `?source_item_id=eq.${sourceItemId}&owner_user_id=eq.${ownerUserId}&select=id`,
  });
  const attachments = await restAsService("source_attachments", {
    query: `?source_version_id=eq.${(versions.body as Array<{ id: string }>)[0]?.id}&owner_user_id=eq.${ownerUserId}&select=id,source_version_id,client_id`,
  });
  const jobs = await restAsService("processing_jobs", {
    query: `?owner_user_id=eq.${ownerUserId}&select=id,job_type,status,source_version_id,space_id`,
  });
  const sourceItem = (item.body as Array<{ id: string; space_id: string }>)[0];
  const version = (versions.body as Array<{ id: string }>)[0];
  const attachment = (attachments.body as Array<{
    id: string;
    source_version_id: string;
    client_id: string;
  }>)[0];
  const jobRows = jobs.body as Array<{
    id: string;
    job_type: string;
    status: string;
    source_version_id: string;
    space_id: string;
  }>;
  expect(sourceItem).toBeTruthy();
  expect(version).toBeTruthy();
  expect(attachment).toBeTruthy();
  return { sourceItem, version, attachment, jobs: jobRows };
}

test("account A sees Xiaohongshu OCR evidence while account B cannot", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const owner = await createSyntheticUser("recall-xhs-ocr-owner");
  const visitor = await createSyntheticUser("recall-xhs-ocr-visitor");

  try {
    await signInSyntheticUser(page, owner.email);
    const captured = await captureXiaohongshuNote(page, "合成小红书 OCR 成功");
    const owned = await loadOwnedCapture(owner.id, captured.sourceItemId);
    const now = new Date().toISOString();
    const ocrJob = await restAsService("processing_jobs", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: owned.sourceItem.space_id,
        source_version_id: owned.version.id,
        job_type: "ocr_assets",
        status: "complete",
        completed_at: now,
      },
    });
    expect(ocrJob.status, JSON.stringify(ocrJob.body)).toBe(201);
    const ocrJobId = (ocrJob.body as Array<{ id: string }>)[0]!.id;
    const run = await restAsService("processing_runs", {
      method: "POST",
      body: {
        processing_job_id: ocrJobId,
        owner_user_id: owner.id,
        space_id: owned.sourceItem.space_id,
        attempt: 1,
        processor_type: "ocr_assets",
        provider: "zhipu",
        model: "glm-ocr",
        status: "complete",
        finished_at: now,
        result_summary: "recognized 1 of 1 images",
      },
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    const runId = (run.body as Array<{ id: string }>)[0]!.id;
    const ocr = await restAsService("asset_ocr_results", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: owned.sourceItem.space_id,
        source_item_id: owned.sourceItem.id,
        source_version_id: owned.version.id,
        source_attachment_id: owned.attachment.id,
        processing_run_id: runId,
        input_sha256: PNG_SHA,
        provider: "zhipu",
        model: "glm-ocr",
        provider_request_id: "req-e2e-ocr1",
        markdown_text: OCR_MARKDOWN,
        layout_details: [
          {
            page: 1,
            index: 0,
            label: "text",
            bbox: [0.1, 0.1, 0.5, 0.3],
            content: OCR_MARKDOWN,
          },
        ],
        data_info: { pages: [{ width: 1, height: 1 }] },
        usage_json: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      },
    });
    expect(ocr.status, JSON.stringify(ocr.body)).toBe(201);

    await page.goto(`/captures/${captured.sourceItemId}`);
    await expect(page.getByText("图片识别完成")).toBeVisible();
    await expect(page.getByText(OCR_MARKDOWN)).toBeVisible();
    await expect(page.getByText("bbox 0.1, 0.1, 0.5, 0.3")).toBeVisible();
    await expect(page.getByRole("img", { name: "xhs-image-1.png" })).toBeVisible();

    await page.context().clearCookies();
    await signInSyntheticUser(page, visitor.email);
    await page.goto("/exceptions");
    await expect(page.getByText("合成小红书 OCR 成功")).toHaveCount(0);
    await page.goto(`/captures/${captured.sourceItemId}`);
    await expect(page.getByText("合成小红书 OCR 成功")).toHaveCount(0);
    const visitorToken = sessionAccessToken(await page.context().cookies());
    const visitorOcr = await rest("asset_ocr_results", {
      accessToken: visitorToken,
      query: `?source_item_id=eq.${captured.sourceItemId}&select=id`,
    });
    expect(visitorOcr.body).toEqual([]);
  } finally {
    expect(await deleteSyntheticUser(owner.id)).toBe(true);
    expect(await deleteSyntheticUser(visitor.id)).toBe(true);
  }
});

test("mixed complete normalize and failed OCR stays visible as an OCR failure", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const owner = await createSyntheticUser("recall-xhs-ocr-fail");
  const visitor = await createSyntheticUser("recall-xhs-ocr-fail-visitor");

  try {
    await signInSyntheticUser(page, owner.email);
    const captured = await captureXiaohongshuNote(page, "合成小红书 OCR 失败");
    const owned = await loadOwnedCapture(owner.id, captured.sourceItemId);
    const now = new Date().toISOString();
    await restAsService("processing_jobs", {
      method: "PATCH",
      query: `?owner_user_id=eq.${owner.id}&job_type=eq.normalize_source`,
      body: { status: "complete", completed_at: now },
    });
    const ocrJob = await restAsService("processing_jobs", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: owned.sourceItem.space_id,
        source_version_id: owned.version.id,
        job_type: "ocr_assets",
        status: "failed",
        failure_reason: "provider timeout",
      },
    });
    expect(ocrJob.status, JSON.stringify(ocrJob.body)).toBe(201);

    await page.goto("/exceptions");
    await expect(page.getByText("图片识别失败")).toBeVisible();
    await expect(page.getByText("原图和正文已安全保存")).toBeVisible();
    await expect(page.getByRole("link", { name: "查看已保存内容" })).toBeVisible();

    await page.goto(`/captures/${captured.sourceItemId}`);
    await expect(page.getByText("图片识别失败")).toBeVisible();
    await expect(page.getByRole("img", { name: "xhs-image-1.png" })).toBeVisible();

    await page.context().clearCookies();
    await signInSyntheticUser(page, visitor.email);
    await page.goto("/exceptions");
    await expect(page.getByText("合成小红书 OCR 失败")).toHaveCount(0);
    await page.goto(`/captures/${captured.sourceItemId}`);
    await expect(page.getByText("合成小红书 OCR 失败")).toHaveCount(0);
  } finally {
    expect(await deleteSyntheticUser(owner.id)).toBe(true);
    expect(await deleteSyntheticUser(visitor.id)).toBe(true);
  }
});
