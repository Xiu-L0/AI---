import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readEnvironmentValue(name: string) {
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

export const supabaseUrl = readEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL");
export const publishableKey = readEnvironmentValue(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
);
export const serviceRoleKey = readEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");

export async function callAuthAdmin(path: string, init: RequestInit) {
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

const mailpitOrigin =
  process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

async function findMagicLink(email: string) {
  const messagesResponse = await fetch(
    `${mailpitOrigin}/api/v1/messages`,
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
    `${mailpitOrigin}/api/v1/message/${summary.ID}`,
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

export async function createSyntheticUser(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  const response = await callAuthAdmin("/users", {
    body: JSON.stringify({ email, email_confirm: true }),
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Unable to create synthetic user (${response.status})`);
  }

  const user = (await response.json()) as { id: string };
  return { email, id: user.id };
}

export async function deleteSyntheticUser(userId: string) {
  const response = await callAuthAdmin(`/users/${userId}`, {
    method: "DELETE",
  });
  return response.ok;
}

export async function signInSyntheticUser(page: Page, email: string) {
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
}
