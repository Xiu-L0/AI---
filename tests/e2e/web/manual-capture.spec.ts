import { expect, test } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  signInSyntheticUser,
} from "./local-auth";

test("manual text shows success only after durable finalization", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-manual-text");
  let releaseFinalize: (() => void) | undefined;
  const finalizeGate = new Promise<void>((resolve) => {
    releaseFinalize = resolve;
  });

  try {
    await signInSyntheticUser(page, user.email);
    await page.route("**/api/captures/*/finalize", async (route) => {
      await finalizeGate;
      await route.continue();
    });
    await page.goto("/captures/new");
    await page.getByLabel("标题").fill("测试资料");
    await page
      .getByLabel("正文")
      .fill("这是一条真实保存流程的合成测试内容。");
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(
      "正在等待服务器确认保存",
    );

    releaseFinalize?.();
    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toBeVisible();
    await expect(
      page.getByText("原文已保存，等待后台处理"),
    ).toBeVisible();
  } finally {
    releaseFinalize?.();
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});

test("multiple screenshots can be saved without body text", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-manual-screenshots");
  let failedSecondUpload = false;
  const startKeys: string[] = [];
  const generatedPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  try {
    await signInSyntheticUser(page, user.email);
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/captures/start")
      ) {
        const body = request.postDataJSON() as { idempotencyKey: string };
        startKeys.push(body.idempotencyKey);
      }
    });
    await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
      const requestUrl = decodeURIComponent(route.request().url());
      if (!failedSecondUpload && requestUrl.includes("file-2-")) {
        failedSecondUpload = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.goto("/captures/new");
    await page.getByLabel("标题").fill("两张合成截图");
    await page.getByLabel("添加文件或截图").setInputFiles([
      {
        name: "screen-1.png",
        mimeType: "image/png",
        buffer: generatedPng,
      },
      {
        name: "screen-2.png",
        mimeType: "image/png",
        buffer: generatedPng,
      },
    ]);
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("采集尚未完成，服务器未确认保存"),
    ).toBeVisible();
    expect(failedSecondUpload).toBe(true);
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toBeVisible();
    await expect(
      page.getByText("原文已保存，等待后台处理"),
    ).toBeVisible();
    await expect(page.getByText("已保存附件").locator("..")).toContainText(
      "2",
    );
    expect(startKeys).toHaveLength(2);
    expect(startKeys[1]).toBe(startKeys[0]);
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});

test("a committed capture recovers after its finalize response is lost", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-manual-lost-finalize");
  let droppedCommittedResponse = false;

  try {
    await signInSyntheticUser(page, user.email);
    await page.route("**/api/captures/*/finalize", async (route) => {
      if (!droppedCommittedResponse) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        droppedCommittedResponse = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.goto("/captures/new");
    await page.getByLabel("标题").fill("响应丢失恢复测试");
    await page.getByLabel("正文").fill("原文应只保存一次，并从状态接口恢复回执。");
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("采集尚未完成，服务器未确认保存"),
    ).toBeVisible();
    expect(droppedCommittedResponse).toBe(true);
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toBeVisible();
    await expect(
      page.getByText("原文已保存，等待后台处理"),
    ).toBeVisible();
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});

test("a generated text file is saved as a manual attachment", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-manual-file");

  try {
    await signInSyntheticUser(page, user.email);
    await page.goto("/captures/new");
    await page.getByLabel("标题").fill("合成文本附件");
    await page.getByLabel("添加文件或截图").setInputFiles({
      name: "synthetic-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic Recall AI attachment fixture.", "utf8"),
    });
    await page.getByRole("button", { name: "保存并后台整理" }).click();

    await expect(
      page.getByText("完整采集成功，原始资料已保存"),
    ).toBeVisible();
    await expect(page.getByText("已保存附件").locator("..")).toContainText(
      "1",
    );
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});
