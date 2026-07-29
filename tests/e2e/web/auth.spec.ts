import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readEnvironmentValue(name: string) {
  if (process.env[name]) {
    return process.env[name];
  }

  const localEnv = readFileSync(
    resolve("apps/web/.env.local"),
    "utf8",
  ).replace(/^\uFEFF/, "");
  const entry = localEnv
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`));

  if (!entry) {
    throw new Error(`Missing ${name} for the authentication test`);
  }

  return entry.slice(name.length + 1);
}

const supabaseUrl = readEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = readEnvironmentValue(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
);
const serviceRoleKey = readEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");

async function callAuthAdmin(path: string, init: RequestInit) {
  return fetch(`${supabaseUrl}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function findMagicLink(email: string) {
  const messagesResponse = await fetch(
    "http://127.0.0.1:54324/api/v1/messages",
  );
  if (!messagesResponse.ok) {
    return null;
  }

  const inbox = (await messagesResponse.json()) as {
    messages: Array<{
      ID: string;
      To: Array<{ Address: string }>;
    }>;
  };
  const summary = inbox.messages.find((message) =>
    message.To.some((recipient) => recipient.Address === email),
  );

  if (!summary) {
    return null;
  }

  const messageResponse = await fetch(
    `http://127.0.0.1:54324/api/v1/message/${summary.ID}`,
  );
  if (!messageResponse.ok) {
    return null;
  }

  const message = (await messageResponse.json()) as {
    HTML?: string;
    Text?: string;
  };
  const body = `${message.HTML ?? ""}\n${message.Text ?? ""}`;
  const match = body.match(
    /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/,
  );

  return match?.[0]?.replaceAll("&amp;", "&") ?? null;
}

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
  const email = `recall-e2e-${crypto.randomUUID()}@example.test`;
  const createdResponse = await callAuthAdmin("/users", {
    body: JSON.stringify({ email, email_confirm: true }),
    method: "POST",
  });
  expect(createdResponse.ok).toBe(true);

  const createdUser = (await createdResponse.json()) as { id: string };

  try {
    await page.goto("/sign-in");
    await page.getByLabel("邮箱").fill(email);
    await page.getByRole("button", { name: "发送登录链接" }).click();
    await expect(
      page.getByText("登录链接已发送，请打开邮箱完成登录。"),
    ).toBeVisible();

    let magicLink: string | null = null;
    await expect
      .poll(
        async () => {
          magicLink = await findMagicLink(email);
          return magicLink;
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();

    await page.goto(magicLink!);

    await expect(page).toHaveURL("http://127.0.0.1:3000/");
    await expect(page.getByRole("link", { name: "今天" })).toBeVisible();
    await expect(page.getByRole("link", { name: "采集记录" })).toBeVisible();

    await page.goto("/sign-in");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
  } finally {
    const deletedResponse = await callAuthAdmin(`/users/${createdUser.id}`, {
      method: "DELETE",
    });
    expect(deletedResponse.ok).toBe(true);
  }
});
