import type { Page, Worker } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  readEnvironmentValue,
  signInSyntheticUser,
  supabaseUrl,
} from "../web/local-auth";
import { expect, fixtureOrigin, test } from "./fixtures";

const serviceRoleKey = readEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");

async function adminRows<T>(
  table: string,
  filters: Record<string, string>,
  select: string,
): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("select", select);
  for (const [field, value] of Object.entries(filters)) {
    url.searchParams.set(field, `eq.${value}`);
  }
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to inspect ${table} (${response.status})`);
  }
  return (await response.json()) as T[];
}

async function createPairingCode(page: Page, email: string): Promise<string> {
  await signInSyntheticUser(page, email);
  await page.goto("/settings");
  await page.getByRole("button", { name: "生成配对码" }).click();
  const code = await page.getByLabel("一次性配对码").textContent();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  return code!;
}

async function deleteSyntheticStorageObjects(
  ownerUserId: string,
  signedStoragePaths: readonly string[],
) {
  const attachments = await adminRows<{ storage_path: string }>(
    "source_attachments",
    { owner_user_id: ownerUserId },
    "storage_path",
  );
  const paths = [
    ...new Set([
      ...signedStoragePaths,
      ...attachments.map((attachment) => attachment.storage_path),
    ]),
  ];
  if (paths.length === 0) return;

  const response = await fetch(`${supabaseUrl}/storage/v1/object/raw-captures`, {
    body: JSON.stringify({
      prefixes: paths,
    }),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Unable to remove synthetic storage objects (${response.status})`);
  }
}

async function openPopupForActivePage(
  openPopup: () => Promise<Page>,
  activePage: Page,
): Promise<Page> {
  const popup = await openPopup();
  await activePage.bringToFront();
  await popup.reload();
  return popup;
}

async function pairPopup(popup: Page, code: string) {
  await popup.getByLabel("8 位配对码").fill(code);
  await popup.getByLabel("设备名称").fill("Synthetic Chromium");
  await popup.getByRole("button", { name: "连接扩展" }).click();
  await expect(popup.getByRole("heading", { name: "Recall AI Capture" })).toBeVisible();
}

async function actionBadge(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        action: { getBadgeText(details: Record<string, never>): Promise<string> };
      };
    };
    return extensionGlobal.chrome.action.getBadgeText({});
  });
}

test("Xiaohongshu capture stays honest across complete, partial, restart, duplicate, and unsupported paths", async ({
  extensionContext,
  openPopup,
  recallTestServer,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  const user = await createSyntheticUser("recall-extension-xhs");
  const completeNoteId = `complete-${crypto.randomUUID()}`;
  const partialNoteId = `missing-${crypto.randomUUID()}`;

  try {
    const webPage = await extensionContext.newPage();
    const pairingCode = await createPairingCode(webPage, user.email);
    await webPage.close();

    const notePage = await extensionContext.newPage();
    await notePage.goto(`${fixtureOrigin}/explore/${completeNoteId}`);
    await expect(notePage.locator("article h1")).toHaveText("合成标题");
    await expect
      .poll(() =>
        notePage.locator("article img[alt='cover']").evaluate(
          (image: HTMLImageElement) => image.naturalWidth,
        ),
      )
      .toBeGreaterThan(0);

    let popup = await openPopupForActivePage(openPopup, notePage);
    await pairPopup(popup, pairingCode);
    await expect(popup.getByText("当前来源：小红书网页版")).toBeVisible();
    await expect(popup.getByLabel("保存范围")).toHaveValue("web_page");

    recallTestServer.delayFinalization();
    await notePage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await recallTestServer.waitForDelayedFinalization();
    await expect(
      popup.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toHaveCount(0);
    await popup.close();

    popup = await openPopupForActivePage(openPopup, notePage);
    await expect(
      popup.getByRole("heading", { name: "服务器尚未确认保存" }),
    ).toBeVisible();
    await expect(
      popup.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toHaveCount(0);
    expect(Number(await actionBadge(serviceWorker))).toBeGreaterThan(0);

    recallTestServer.releaseFinalization();
    await expect
      .poll(async () => {
        await popup.reload();
        return popup
          .getByRole("heading", { name: "完整采集成功，图片识别已排队" })
          .count();
      })
      .toBe(1);
    await expect(popup.getByText(/已保存 0 条消息.*3 个附件/)).toBeVisible();

    const sourceItems = await adminRows<{
      id: string;
      source: string | null;
      source_kind: string;
      source_platform: string;
    }>(
      "source_items",
      { owner_user_id: user.id, external_ref: completeNoteId },
      "id,source,source_kind,source_platform",
    );
    expect(sourceItems).toHaveLength(1);
    expect(sourceItems[0]).toMatchObject({
      source: null,
      source_kind: "social_post",
      source_platform: "xiaohongshu",
    });

    await notePage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await expect(
      popup.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toBeVisible();
    expect(
      await adminRows<{ id: string }>(
        "source_items",
        { owner_user_id: user.id, external_ref: completeNoteId },
        "id",
      ),
    ).toHaveLength(1);

    await notePage.goto(`${fixtureOrigin}/explore/${partialNoteId}`);
    await expect(notePage.locator("article h1")).toHaveText("部分可读的合成笔记");
    await popup.close();
    popup = await openPopupForActivePage(openPopup, notePage);
    await notePage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await expect(
      popup.getByRole("heading", {
        name: "部分采集成功，已保存可用内容；请查看缺失项",
      }),
    ).toBeVisible();
    await expect(popup.getByText("第 2 张图片无法读取：HTTP 403")).toBeVisible();
    await expect(popup.getByText("第 3 张图片无法读取")).toBeVisible();
    await expect(
      popup.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toHaveCount(0);

    const partialItems = await adminRows<{ id: string }>(
      "source_items",
      { owner_user_id: user.id, external_ref: partialNoteId },
      "id",
    );
    expect(partialItems).toHaveLength(1);
    const attachments = await adminRows<{ file_name: string }>(
      "source_attachments",
      { owner_user_id: user.id },
      "file_name",
    );
    const missingCopy = await popup.locator("section ul li").allTextContents();
    const fileNames = attachments.map((attachment) => attachment.file_name);
    expect(fileNames.some((name) => name === "xhs-image-1.png")).toBe(true);
    expect(
      fileNames.some((name) => name.startsWith("xhs-fallback-")) ||
        missingCopy.some((item) => item.includes("页面截图未能作为补充证据保存")),
    ).toBe(true);

    await notePage.goto(`${fixtureOrigin}/unsupported`);
    await popup.close();
    popup = await openPopupForActivePage(openPopup, notePage);
    await expect(popup.getByText(/当前页面暂不支持自动采集/)).toBeVisible();
    await expect(
      popup.getByText("当前页面未采集；可改用 Web 应用保存。"),
    ).toBeVisible();
    await expect(
      popup.getByRole("heading", { name: "完整采集成功，图片识别已排队" }),
    ).toHaveCount(0);
    await expect(popup.getByRole("button", { name: "保存到 Recall AI" })).toHaveCount(0);
  } finally {
    recallTestServer.releaseFinalization();
    const cleanupErrors: unknown[] = [];
    try {
      await deleteSyntheticStorageObjects(user.id, recallTestServer.storagePaths());
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (!(await deleteSyntheticUser(user.id))) {
        throw new Error("Unable to delete the synthetic extension user");
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Xiaohongshu extension E2E cleanup failed");
    }
  }
});
