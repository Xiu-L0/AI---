import { expect, test } from "@playwright/test";

import {
  callAuthAdmin,
  createSyntheticUser,
  deleteSyntheticUser,
  publishableKey,
  signInSyntheticUser,
  supabaseUrl,
} from "./local-auth";

test("unauthenticated visitors are redirected to sign in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "登录你的知识库" }),
  ).toBeVisible();
});

test("an unknown email cannot create a public account", async ({ page }) => {
  const email = `recall-unknown-${crypto.randomUUID()}@example.test`;

  const signUpResponse = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    body: JSON.stringify({
      email,
      password: `Synthetic-${crypto.randomUUID()}`,
    }),
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  expect(signUpResponse.ok).toBe(false);

  await page.goto("/sign-in");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(
    page.getByRole("alert").getByText("登录链接发送失败，请稍后重试。"),
  ).toBeVisible();

  const usersResponse = await callAuthAdmin("/users?page=1&per_page=1000", {
    method: "GET",
  });
  expect(usersResponse.ok).toBe(true);

  const users = (await usersResponse.json()) as {
    users: Array<{ email?: string }>;
  };
  expect(users.users.some((user) => user.email === email)).toBe(false);
});

test("a seeded personal account reaches the protected app shell", async ({
  page,
}) => {
  const user = await createSyntheticUser("recall-e2e");

  try {
    await signInSyntheticUser(page, user.email);

    await expect(page.getByRole("link", { name: "今天" })).toBeVisible();
    await expect(page.getByRole("link", { name: "采集记录" })).toBeVisible();

    await page.goto("/sign-in");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
  } finally {
    expect(await deleteSyntheticUser(user.id)).toBe(true);
  }
});
