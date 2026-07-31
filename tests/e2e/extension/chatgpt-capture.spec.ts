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

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/raw-captures`,
    {
      body: JSON.stringify({
        prefixes: paths,
      }),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "DELETE",
    },
  );
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

test("ChatGPT capture stays honest across complete, duplicate, partial, and offline retry paths", async ({
  extensionContext,
  openPopup,
  recallTestServer,
  serviceWorker,
}) => {
  test.setTimeout(120_000);
  const user = await createSyntheticUser("recall-extension-capture");
  const conversationId = `complete-${crypto.randomUUID()}`;
  const offlineConversationId = `offline-${crypto.randomUUID()}`;

  try {
    const webPage = await extensionContext.newPage();
    const pairingCode = await createPairingCode(webPage, user.email);
    await webPage.close();

    const chatPage = await extensionContext.newPage();
    await chatPage.goto(`${fixtureOrigin}/c/${conversationId}`);
    await expect(chatPage.locator("article")).toHaveCount(3);
    await expect
      .poll(() =>
        chatPage.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);

    let popup = await openPopupForActivePage(openPopup, chatPage);
    await pairPopup(popup, pairingCode);

    recallTestServer.delayFinalization();
    await chatPage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await recallTestServer.waitForDelayedFinalization();
    await expect(popup.getByRole("heading", { name: "完整采集成功" })).toHaveCount(0);
    await popup.close();

    popup = await openPopupForActivePage(openPopup, chatPage);
    await expect(
      popup.getByRole("heading", { name: "服务器尚未确认保存" }),
    ).toBeVisible();
    await expect(popup.getByRole("heading", { name: "完整采集成功" })).toHaveCount(0);

    recallTestServer.releaseFinalization();
    await expect
      .poll(async () => {
        await popup.reload();
        return popup.getByRole("heading", { name: "完整采集成功" }).count();
      })
      .toBe(1);
    await expect(popup.getByText(/已保存 3 条消息.*1 个附件/)).toBeVisible();

    const sourceItems = await adminRows<{ id: string }>(
      "source_items",
      { owner_user_id: user.id, external_ref: conversationId },
      "id",
    );
    expect(sourceItems).toHaveLength(1);
    const sourceItemId = sourceItems[0]!.id;
    expect(
      await adminRows<{ id: string }>(
        "source_messages",
        { owner_user_id: user.id, source_item_id: sourceItemId },
        "id",
      ),
    ).toHaveLength(3);

    await chatPage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await expect(popup.getByRole("heading", { name: "完整采集成功" })).toBeVisible();
    expect(
      await adminRows<{ id: string }>(
        "source_items",
        { owner_user_id: user.id, external_ref: conversationId },
        "id",
      ),
    ).toHaveLength(1);
    expect(
      await adminRows<{ id: string }>(
        "source_messages",
        { owner_user_id: user.id, source_item_id: sourceItemId },
        "id",
      ),
    ).toHaveLength(3);

    await chatPage.goto(`${fixtureOrigin}/c/missing-${crypto.randomUUID()}`);
    await expect(chatPage.locator("article")).toHaveCount(3);
    await popup.close();
    popup = await openPopupForActivePage(openPopup, chatPage);
    await chatPage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await expect(popup.getByRole("heading", { name: "部分内容未采集" })).toBeVisible();
    await expect(popup.getByText(/图片无法读取/)).toBeVisible();

    await chatPage.goto(`${fixtureOrigin}/c/${offlineConversationId}`);
    await expect
      .poll(() =>
        chatPage.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await popup.close();
    popup = await openPopupForActivePage(openPopup, chatPage);
    recallTestServer.setFinalizeOffline(true);
    await chatPage.bringToFront();
    await popup.getByRole("button", { name: "保存到 Recall AI" }).click();
    await expect(
      popup.getByRole("heading", { name: "服务器尚未确认保存" }),
    ).toBeVisible();
    expect(Number(await actionBadge(serviceWorker))).toBeGreaterThan(0);

    recallTestServer.setFinalizeOffline(false);
    await popup.getByRole("button", { name: "立即重试" }).click();
    await expect(popup.getByRole("heading", { name: "完整采集成功" })).toBeVisible();
    await expect(popup.getByText(/已保存 3 条消息.*1 个附件/)).toBeVisible();
  } finally {
    recallTestServer.setFinalizeOffline(false);
    const cleanupErrors: unknown[] = [];
    try {
      await deleteSyntheticStorageObjects(
        user.id,
        recallTestServer.storagePaths(),
      );
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
      throw new AggregateError(cleanupErrors, "Extension E2E cleanup failed");
    }
  }
});
