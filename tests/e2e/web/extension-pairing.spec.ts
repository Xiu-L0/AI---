import { expect, test } from "@playwright/test";

import {
  createSyntheticUser,
  deleteSyntheticUser,
  signInSyntheticUser,
} from "./local-auth";

test("a personal account pairs and revokes one extension", async ({
  page,
  request,
}) => {
  const unauthenticatedStart = await request.post(
    "/api/extension/pairing/start",
  );
  expect(unauthenticatedStart.status()).toBe(401);

  const user = await createSyntheticUser("recall-pairing");

  try {
    await signInSyntheticUser(page, user.email);
    await page.goto("/settings");
    await page.getByRole("button", { name: "生成配对码" }).click();

    const pairingCode = await page
      .getByLabel("一次性配对码")
      .textContent();
    expect(pairingCode).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
    );

    const exchangeResponse = await request.post(
      "/api/extension/pairing/exchange",
      {
        data: {
          code: pairingCode,
          label: "Synthetic Edge",
        },
      },
    );
    expect(exchangeResponse.status()).toBe(200);
    expect(exchangeResponse.headers()["cache-control"]).toBe("no-store");

    const credential = (await exchangeResponse.json()) as {
      token: string;
      expiresAt: string;
    };
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(credential.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const repeatedExchange = await request.post(
      "/api/extension/pairing/exchange",
      {
        data: {
          code: pairingCode,
          label: "Duplicate Edge",
        },
      },
    );
    expect(repeatedExchange.status()).toBe(401);

    await page.reload();
    await expect(page.getByText("Synthetic Edge")).toBeVisible();
    await expect(page.getByText(credential.token)).toHaveCount(0);

    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.getByText(/已撤销：/)).toBeVisible();
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});
