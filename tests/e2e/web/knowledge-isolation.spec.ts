import { expect, test, type Page } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  publishableKey,
  serviceRoleKey,
  signInSyntheticUser,
  supabaseUrl,
} from "./local-auth";

const SYNTHETIC_DRAFT_TITLE = "Synthetic private-space isolation draft";
const SYNTHETIC_DRAFT_L0 =
  "This isolation draft belongs only to the first disposable account.";

type JsonResponse = {
  status: number;
  body: unknown;
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
        body: (await response.json()) as unknown,
      };
    },
    { path, init },
  );
}

async function rest(
  path: string,
  init: {
    accessToken: string;
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
  },
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
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
  const body = text === "" ? null : (JSON.parse(text) as unknown);
  return { status: response.status, body };
}

async function restAsService(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
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

async function deleteOwnedRows(ownerUserId: string) {
  const tables = [
    "review_tasks",
    "citations",
    "knowledge_items",
    "source_blocks",
    "processing_runs",
    "processing_jobs",
    "source_items",
    "capture_sessions",
    "space_members",
    "spaces",
  ];
  for (const table of tables) {
    const filter =
      table === "space_members"
        ? `user_id=eq.${ownerUserId}`
        : `owner_user_id=eq.${ownerUserId}`;
    await restAsService(`${table}?${filter}`, { method: "DELETE" });
  }
}

async function deleteDisposableUser(userId: string) {
  await deleteOwnedRows(userId);
  if (await deleteSyntheticUser(userId)) {
    return;
  }
  const retry = await deleteSyntheticUser(userId);
  expect(retry, `failed to delete disposable user ${userId}`).toBe(true);
}

test("a second private space cannot list or infer another owner's knowledge", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const owner = await createSyntheticUser("recall-knowledge-owner");
  const visitor = await createSyntheticUser("recall-knowledge-visitor");

  try {
    await signInSyntheticUser(page, owner.email);
    const idempotencyKey = `isolation-${crypto.randomUUID()}`;
    const start = await browserJsonRequest(page, "/api/captures/start", {
      method: "POST",
      body: {
        idempotencyKey,
        source: "chatgpt_web",
        scope: "full_conversation",
        title: "Synthetic isolation conversation",
        sensitivity: "normal",
        externalRef: `isolation-${crypto.randomUUID()}`,
        attachments: [],
      },
    });
    expect(start.status).toBe(201);
    const captureId = String(
      (start.body as { captureId: string }).captureId,
    );

    const finalized = await browserJsonRequest(
      page,
      `/api/captures/${captureId}/finalize`,
      {
        method: "POST",
        body: {
          idempotencyKey,
          completeness: "complete",
          missingElements: [],
          rawText: "Synthetic isolation question\nSynthetic isolation answer",
          messages: [
            {
              externalMessageId: "isolation-msg-1",
              role: "user",
              text: "Synthetic isolation question",
              ordinal: 0,
            },
            {
              externalMessageId: "isolation-msg-2",
              role: "assistant",
              text: "Synthetic isolation answer",
              ordinal: 1,
            },
          ],
          uploadedAttachments: [],
        },
      },
    );
    expect(finalized.status).toBe(200);
    const sourceItemId = String(
      (finalized.body as { sourceItemId: string }).sourceItemId,
    );

    const items = await restAsService(
      `source_items?id=eq.${sourceItemId}&select=id,owner_user_id,space_id`,
    );
    expect(items.status).toBe(200);
    const item = (items.body as Array<{
      id: string;
      owner_user_id: string;
      space_id: string;
    }>)[0];
    expect(item.owner_user_id).toBe(owner.id);

    const versions = await restAsService(
      `source_versions?source_item_id=eq.${sourceItemId}&select=id,owner_user_id`,
    );
    const sourceVersionId = (versions.body as Array<{ id: string }>)[0].id;
    const messages = await restAsService(
      `source_messages?source_version_id=eq.${sourceVersionId}&select=id,external_message_id,ordinal,role&order=ordinal.asc`,
    );
    const message = (messages.body as Array<{
      id: string;
      external_message_id: string;
      ordinal: number;
      role: string;
    }>)[0];
    const jobs = await restAsService(
      `processing_jobs?source_version_id=eq.${sourceVersionId}&select=id,job_type,status,owner_user_id`,
    );
    const ownerJob = (jobs.body as Array<{
      id: string;
      job_type: string;
      status: string;
      owner_user_id: string;
    }>)[0];
    expect(ownerJob.owner_user_id).toBe(owner.id);
    expect(ownerJob.job_type).toBe("normalize_source");
    expect(ownerJob.status).toBe("queued");

    const block = await restAsService("source_blocks", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: item.space_id,
        source_item_id: sourceItemId,
        source_version_id: sourceVersionId,
        source_message_id: message.id,
        block_type: "message",
        ordinal: message.ordinal,
        locator_key: `message:${message.external_message_id}/body`,
        locator_json: {
          externalMessageId: message.external_message_id,
          role: message.role,
          ordinal: message.ordinal,
        },
        content_hash: "a".repeat(64),
        text_content: "Synthetic isolation question",
      },
    });
    expect(block.status).toBe(201);
    const sourceBlockId = (block.body as Array<{ id: string }>)[0].id;

    const run = await restAsService("processing_runs", {
      method: "POST",
      body: {
        processing_job_id: ownerJob.id,
        owner_user_id: owner.id,
        space_id: item.space_id,
        attempt: 1,
        processor_type: "extract_knowledge",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        prompt_or_pipeline_version: "knowledge-extraction.2026-08-11.v1",
        status: "complete",
        finished_at: new Date().toISOString(),
        result_summary: "synthetic isolation run",
        usage_json: { provider: "deepseek", model: "deepseek-v4-flash" },
      },
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    const runId = (run.body as Array<{ id: string }>)[0].id;

    const knowledge = await restAsService("knowledge_items", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: item.space_id,
        created_by_user_id: owner.id,
        source_version_id: sourceVersionId,
        knowledge_type: "fact",
        title: SYNTHETIC_DRAFT_TITLE,
        l0_summary: SYNTHETIC_DRAFT_L0,
        l1_content: "Synthetic isolation L1",
        confidence: 0.9,
        status: "pending_review",
        evidence_mode: "cited",
        extraction_key: "b".repeat(64),
      },
    });
    expect(knowledge.status).toBe(201);
    const knowledgeItemId = (knowledge.body as Array<{ id: string }>)[0].id;

    const citation = await restAsService("citations", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: item.space_id,
        knowledge_item_id: knowledgeItemId,
        source_block_id: sourceBlockId,
        claim_path: "l0_summary",
        quote_excerpt: "Synthetic isolation question",
        origin_type: "ai",
      },
    });
    expect(citation.status).toBe(201);

    const reviewTask = await restAsService("review_tasks", {
      method: "POST",
      body: {
        owner_user_id: owner.id,
        space_id: item.space_id,
        knowledge_item_id: knowledgeItemId,
        task_type: "knowledge_draft",
        status: "open",
        priority: 50,
        reason: "synthetic isolation review",
      },
    });
    expect(reviewTask.status).toBe(201);

    await page.goto("/knowledge");
    await expect(page.getByRole("link", { name: "知识审核 1" })).toBeVisible();
    await expect(page.getByText(SYNTHETIC_DRAFT_L0)).toBeVisible();

    await page.context().clearCookies();
    await signInSyntheticUser(page, visitor.email);

    await expect(page.getByRole("link", { name: "知识审核 0" })).toBeVisible();
    await expect(page.getByRole("link", { name: /共享/ })).toHaveCount(0);
    await page.goto("/knowledge");
    await expect(
      page.getByRole("heading", { name: "目前没有待审核知识" }),
    ).toBeVisible();
    await expect(page.getByText(SYNTHETIC_DRAFT_L0)).toHaveCount(0);
    await expect(page.getByText(SYNTHETIC_DRAFT_TITLE)).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "浏览器扩展", exact: true })).toBeVisible();
    await expect(page.getByText(/共享空间/)).toHaveCount(0);

    const visitorToken = sessionAccessToken(await page.context().cookies());
    const tables = [
      "knowledge_items",
      "citations",
      "source_blocks",
      "processing_runs",
      "review_tasks",
      "processing_jobs",
    ] as const;
    for (const table of tables) {
      const listed = await rest(`${table}?select=id`, {
        accessToken: visitorToken,
      });
      expect(listed.status, table).toBe(200);
      expect(listed.body, table).toEqual([]);
    }

    const hiddenKnowledge = await rest(
      `knowledge_items?id=eq.${knowledgeItemId}&select=id`,
      { accessToken: visitorToken },
    );
    expect(hiddenKnowledge.body).toEqual([]);
    const hiddenRun = await rest(`processing_runs?id=eq.${runId}&select=id`, {
      accessToken: visitorToken,
    });
    expect(hiddenRun.body).toEqual([]);
    const visitorSpaces = await rest("spaces?select=id,type", {
      accessToken: visitorToken,
    });
    expect(visitorSpaces.status).toBe(200);
    const spaces = visitorSpaces.body as Array<{ id: string; type: string }>;
    expect(spaces).toHaveLength(1);
    expect(spaces[0]?.type).toBe("private");

    const notFoundReview = await page.goto(
      `/knowledge/review/${knowledgeItemId}`,
    );
    expect(notFoundReview?.status()).toBe(404);
    const notFoundCapture = await page.goto(`/captures/${sourceItemId}`);
    expect(notFoundCapture?.status()).toBe(404);

    const visitorKey = `visitor-${crypto.randomUUID()}`;
    const visitorStart = await browserJsonRequest(page, "/api/captures/start", {
      method: "POST",
      body: {
        idempotencyKey: visitorKey,
        source: "chatgpt_web",
        scope: "full_conversation",
        title: "Visitor isolation conversation",
        sensitivity: "normal",
        externalRef: `visitor-${crypto.randomUUID()}`,
        attachments: [],
      },
    });
    expect(visitorStart.status).toBe(201);
    const visitorCaptureId = String(
      (visitorStart.body as { captureId: string }).captureId,
    );
    const visitorFinalized = await browserJsonRequest(
      page,
      `/api/captures/${visitorCaptureId}/finalize`,
      {
        method: "POST",
        body: {
          idempotencyKey: visitorKey,
          completeness: "complete",
          missingElements: [],
          rawText: "Visitor question\nVisitor answer",
          messages: [
            {
              externalMessageId: "visitor-msg-1",
              role: "user",
              text: "Visitor question",
              ordinal: 0,
            },
            {
              externalMessageId: "visitor-msg-2",
              role: "assistant",
              text: "Visitor answer",
              ordinal: 1,
            },
          ],
          uploadedAttachments: [],
        },
      },
    );
    expect(visitorFinalized.status).toBe(200);

    const visitorJobs = await rest(
      "processing_jobs?select=id,owner_user_id,job_type,status",
      { accessToken: visitorToken },
    );
    expect(visitorJobs.status).toBe(200);
    const visibleJobs = visitorJobs.body as Array<{
      id: string;
      owner_user_id: string;
      job_type: string;
    }>;
    expect(visibleJobs.length).toBeGreaterThan(0);
    expect(visibleJobs.every((job) => job.owner_user_id === visitor.id)).toBe(
      true,
    );
    expect(visibleJobs.some((job) => job.id === ownerJob.id)).toBe(false);

    await page.goto("/");
    await expect(page.getByRole("link", { name: "知识审核 0" })).toBeVisible();
  } finally {
    await deleteDisposableUser(owner.id);
    await deleteDisposableUser(visitor.id);
  }
});
