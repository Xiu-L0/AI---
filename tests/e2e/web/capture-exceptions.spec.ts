import { expect, test } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  readEnvironmentValue,
  signInSyntheticUser,
  supabaseUrl,
} from "./local-auth";

const serviceRoleKey = readEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");

async function adminRequest(path: string, init: RequestInit) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

test("partial capture remains visible until resolved", async ({ page }) => {
  const user = await createSyntheticUser("recall-partial-exception");
  const otherUser = await createSyntheticUser("recall-other-exception");

  try {
    await signInSyntheticUser(page, user.email);
    const response = await page.evaluate(async () => {
      const idempotencyKey = `partial-${crypto.randomUUID()}`;
      const start = await fetch("/api/captures/start", {
        body: JSON.stringify({
          attachments: [],
          externalRef: null,
          idempotencyKey,
          scope: "selection",
          sensitivity: "normal",
          source: "manual_text",
          title: "缺图的合成采集",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const started = (await start.json()) as { captureId?: string };
      if (!start.ok || !started.captureId) {
        return { ok: false, stage: "start", status: start.status };
      }

      const finalize = await fetch(
        `/api/captures/${started.captureId}/finalize`,
        {
          body: JSON.stringify({
            completeness: "partial",
            idempotencyKey,
            messages: [],
            missingElements: ["2 张图片无法读取"],
            rawText: "正文已保存",
            uploadedAttachments: [],
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      return { ok: finalize.ok, stage: "finalize", status: finalize.status };
    });
    expect(response).toEqual({ ok: true, stage: "finalize", status: 200 });

    await page.goto("/exceptions");
    await expect(page.getByText("部分内容未采集")).toBeVisible();
    await expect(page.getByText("2 张图片无法读取")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "手动上传新截图" }),
    ).toBeVisible();
    await expect(
      page.getByText("你可以手动上传新截图，但它会保存为独立资料，不会自动解决当前异常。"),
    ).toBeVisible();
    await expect(
      page.getByText("已采集到的原文安全保存在服务器中。"),
    ).toBeVisible();

    await page.context().clearCookies();
    await signInSyntheticUser(page, otherUser.email);
    await page.goto("/exceptions");
    await expect(page.getByText("缺图的合成采集")).toHaveCount(0);
    await expect(page.getByText("部分内容未采集")).toHaveCount(0);
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
    expect(await deleteSyntheticUser(otherUser.id)).toBe(true);
  }
});

test("a manual failed session disappears only after an explicit durable recovery", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-manual-recovery");
  const failedCaptureId = crypto.randomUUID();

  try {
    const seeded = await adminRequest("capture_sessions", {
      body: JSON.stringify({
        expected_attachments: [],
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        failure_reason: "capture session expired",
        id: failedCaptureId,
        idempotency_key: `failed-${crypto.randomUUID()}`,
        owner_user_id: user.id,
        scope: "upload",
        sensitivity: "normal",
        source: "manual_text",
        status: "failed",
        title: "需要显式恢复的手动资料",
      }),
      method: "POST",
    });
    expect(seeded.ok).toBe(true);

    await signInSyntheticUser(page, user.email);
    await page.goto("/exceptions");
    await expect(page.getByText("需要显式恢复的手动资料")).toBeVisible();
    await page.getByRole("link", { name: "重新填写并恢复" }).click();
    await expect(page.getByText("这是一次明确的失败恢复。", { exact: false })).toBeVisible();

    await page.getByLabel("标题").fill("已恢复的手动资料");
    await page.getByLabel("正文").fill("重新填写的合成正文");
    await page.getByRole("button", { name: "保存并后台整理" }).click();
    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toBeVisible();

    await page.goto("/exceptions");
    await expect(page.getByText("需要显式恢复的手动资料")).toHaveCount(0);

    const inspected = await adminRequest(
      `capture_sessions?id=eq.${failedCaptureId}&select=resolved_at,resolved_by_capture_session_id`,
      { method: "GET" },
    );
    expect(inspected.ok).toBe(true);
    const rows = (await inspected.json()) as Array<{
      resolved_at: string | null;
      resolved_by_capture_session_id: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolved_at).not.toBeNull();
    expect(rows[0]?.resolved_by_capture_session_id).not.toBeNull();
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});
