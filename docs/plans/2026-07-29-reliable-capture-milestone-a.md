# Reliable Capture Milestone A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal, testable Web application and Chrome/Edge extension that reliably saves manual inputs and ChatGPT conversations, distinguishes complete/partial/failed capture, and never reports success before the server confirms durable storage.

**Architecture:** Use a pnpm TypeScript monorepo with a Next.js App Router Web application, a WXT Manifest V3 extension, shared Zod contracts, pure domain modules, and Supabase Auth/Postgres/private Storage. Capture uses a two-phase protocol: create a capture session and signed attachment uploads, then finalize in one database transaction that creates the source version and queued processing job. The extension keeps an outbox in `chrome.storage.local` until finalization returns a durable receipt.

**Tech Stack:** Node.js 20.9 or newer, pnpm workspaces, TypeScript, Next.js App Router, React, Tailwind CSS, WXT Manifest V3, Supabase Auth/Postgres/Storage, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Milestone A covers reliable capture only. AI/OCR processing, knowledge cards, mixed search, research projects, daily review, and weekly email belong to later milestone plans.
- The Web application must work in current Chrome and Edge; the extension must build as Manifest V3 for Chromium.
- The server must confirm durable raw-content storage before any UI displays “完整采集成功”.
- Capture state and processing state are separate fields. `capture_status` is `complete | partial | failed`; `processing_status` is `queued | processing | complete | failed | paused`.
- A partial capture must list missing elements and a recovery action.
- A failed capture must remain in the extension outbox and Web exception list until retried successfully. Milestone A has no silent discard action.
- Every business table must contain `owner_user_id`; Row Level Security must restrict access to `auth.uid() = owner_user_id`.
- Raw attachments use a private bucket. The extension and browser never receive a service-role key.
- Plain text per capture is limited to 2 MiB. Each attachment is limited to 10 MiB. A capture may contain at most 50 attachments and 100 MiB total.
- Supported attachment MIME types in Milestone A are `image/png`, `image/jpeg`, `image/webp`, `text/plain`, `text/markdown`, and `application/pdf`.
- Sensitive and strictly sensitive data are stored but not sent to any AI API in Milestone A.
- No credential, access token, service-role key, or real user content may be committed.
- Tests use synthetic ChatGPT fixtures and generated images only.
- Every task ends with passing focused tests and a small Git commit.

---

## Scope Decomposition

The approved design contains four independently testable products:

1. **Milestone A — reliable capture:** this plan.
2. **Milestone B — OCR, knowledge cards, mixed retrieval, and cited Q&A:** write after Milestone A is tested with real captures.
3. **Milestone C — daily review, weekly review, topic map, and light research projects:** write after Milestone B retrieval evaluation.
4. **Milestone D — hardening, evaluation, and in-system similar-question reminders:** write after real usage produces a representative dataset.

This plan intentionally avoids placeholder UI for later milestones. Navigation may show only “今天”, “采集记录”, “异常”, and “设置” until the corresponding feature exists.

## File Structure

```text
.
├── apps/
│   ├── web/
│   │   ├── vitest.config.ts
│   │   ├── src/app/
│   │   │   ├── (app)/layout.tsx
│   │   │   ├── (app)/page.tsx
│   │   │   ├── (app)/captures/page.tsx
│   │   │   ├── (app)/captures/[sourceItemId]/page.tsx
│   │   │   ├── (app)/exceptions/page.tsx
│   │   │   ├── (auth)/sign-in/page.tsx
│   │   │   └── api/
│   │   │       ├── captures/start/route.ts
│   │   │       ├── captures/[captureId]/finalize/route.ts
│   │   │       ├── captures/[captureId]/status/route.ts
│   │   │       └── extension/pairing/
│   │   │           ├── start/route.ts
│   │   │           └── exchange/route.ts
│   │   ├── src/features/capture/
│   │   │   ├── components/manual-capture-form.tsx
│   │   │   ├── components/capture-receipt.tsx
│   │   │   ├── server/start-capture.ts
│   │   │   ├── server/finalize-capture.ts
│   │   │   ├── server/get-capture-status.ts
│   │   │   └── server/list-captures.ts
│   │   ├── src/features/extension/server/pairing.ts
│   │   └── src/lib/supabase/
│   │       ├── browser.ts
│   │       ├── server.ts
│   │       └── admin.ts
│   └── extension/
│       ├── vitest.config.ts
│       ├── entrypoints/background.ts
│       ├── entrypoints/chatgpt.content.ts
│       ├── entrypoints/popup/App.tsx
│       ├── entrypoints/popup/main.tsx
│       ├── lib/api-client.ts
│       ├── lib/auth-store.ts
│       ├── lib/outbox.ts
│       ├── lib/capture-runner.ts
│       ├── lib/chatgpt/extract.ts
│       ├── lib/chatgpt/completeness.ts
│       └── wxt.config.ts
├── packages/
│   ├── contracts/src/capture.ts
│   ├── contracts/src/extension-auth.ts
│   ├── contracts/src/index.ts
│   └── domain/src/capture/
│       ├── fingerprint.ts
│       ├── merge.ts
│       ├── state.ts
│       └── index.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/202607290001_capture_schema.sql
│   ├── seed.sql
│   └── tests/001_capture_rls.test.sql
├── tests/
│   ├── fixtures/chatgpt/complete-conversation.html
│   ├── fixtures/chatgpt/conversation-with-missing-image.html
│   ├── e2e/web/manual-capture.spec.ts
│   └── e2e/extension/chatgpt-capture.spec.ts
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
└── playwright.config.ts
```

Responsibilities are intentionally separated:

- `packages/contracts` owns wire types and runtime validation.
- `packages/domain` owns deterministic logic with no database, browser, or framework imports.
- `apps/web/src/features/*/server` owns use cases and database orchestration.
- Next.js route files only authenticate, parse, call a use case, and translate the result to HTTP.
- Extension entrypoints only connect browser events to testable modules under `lib/`.
- Supabase migrations are the only source of truth for schema, storage configuration, and RLS.

---

### Task 1: Create the Reproducible Monorepo Baseline

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `playwright.config.ts`
- Create: `apps/web/**` through `create-next-app`
- Create: `apps/extension/**` through WXT React bootstrap
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/workspace.test.ts`
- Create: `packages/domain/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: none.
- Produces: workspace packages `@recall/web`, `@recall/extension`, `@recall/contracts`, and `@recall/domain`; root commands `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm e2e`.

- [ ] **Step 1: Record the runtime and workspace configuration**

Create the root `package.json`:

```json
{
  "name": "recall-ai",
  "private": true,
  "packageManager": "pnpm@10",
  "engines": {
    "node": ">=20.9.0"
  },
  "scripts": {
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.0.0",
    "typescript": "^5.1.0",
    "vitest": "^3.0.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "target": "ES2022",
    "moduleResolution": "Bundler"
  }
}
```

- [ ] **Step 2: Scaffold the Web and extension applications**

Run:

```bash
pnpm dlx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
pnpm dlx wxt@latest init apps/extension
```

Select the React and pnpm options when WXT prompts. Rename the generated package names to `@recall/web` and `@recall/extension`. Add `"test": "vitest run"` and `"typecheck": "tsc --noEmit"` to both packages and ensure the WXT build command is `"build": "wxt build --mv3"`.

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm --filter @recall/web dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true
  }
});
```

Append these entries to `.gitignore`:

```gitignore
node_modules/
.next/
.output/
.wxt/
coverage/
playwright-report/
test-results/
.env
.env.local
.env.*.local
supabase/.temp/
```

- [ ] **Step 3: Create shared package manifests**

Create `packages/contracts/package.json`:

```json
{
  "name": "@recall/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

Create `packages/domain/package.json`:

```json
{
  "name": "@recall/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/capture/index.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@recall/contracts": "workspace:*"
  }
}
```

- [ ] **Step 4: Write a workspace resolution test**

Create `packages/contracts/src/workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs shared-package tests", () => {
    expect("recall-ai").toBe("recall-ai");
  });
});
```

Create `vitest.workspace.ts`:

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*",
  "apps/web",
  "apps/extension"
]);
```

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true
  }
});
```

Create `apps/extension/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true
  }
});
```

- [ ] **Step 5: Install and verify the clean baseline**

Run:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit `0`; WXT emits a Manifest V3 build under `apps/extension/.output/chrome-mv3`.

- [ ] **Step 6: Commit the baseline**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts playwright.config.ts apps packages .gitignore
git commit -m "chore: scaffold recall monorepo"
```

---

### Task 2: Define Capture Contracts and Deterministic Domain Rules

**Files:**
- Create: `packages/contracts/src/capture.ts`
- Create: `packages/contracts/src/extension-auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/capture/fingerprint.ts`
- Create: `packages/domain/src/capture/merge.ts`
- Create: `packages/domain/src/capture/state.ts`
- Create: `packages/domain/src/capture/index.ts`
- Test: `packages/contracts/src/capture.test.ts`
- Test: `packages/domain/src/capture/fingerprint.test.ts`
- Test: `packages/domain/src/capture/merge.test.ts`
- Test: `packages/domain/src/capture/state.test.ts`

**Interfaces:**
- Consumes: Zod.
- Produces:
  - `StartCaptureInput`, `StartCaptureResult`, `FinalizeCaptureInput`, `CaptureReceipt`, `CaptureStatusResult`.
  - `computeContentFingerprint(input: FingerprintInput): Promise<string>`.
  - `mergeMessages(previous: CapturedMessage[], incoming: CapturedMessage[]): MergeResult`.
  - `toCaptureReceipt(input: ReceiptInput): CaptureReceipt`.

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FinalizeCaptureInputSchema,
  StartCaptureInputSchema
} from "./capture";

describe("capture contracts", () => {
  it("rejects more than fifty attachments", () => {
    const attachments = Array.from({ length: 51 }, (_, index) => ({
      clientId: `file-${index}`,
      fileName: `${index}.png`,
      mimeType: "image/png",
      byteSize: 100,
      sha256: "a".repeat(64)
    }));

    const result = StartCaptureInputSchema.safeParse({
      idempotencyKey: "capture-start-key-1",
      source: "manual_screenshot",
      scope: "upload",
      title: "screenshots",
      sensitivity: "sensitive",
      externalRef: null,
      attachments
    });

    expect(result.success).toBe(false);
  });

  it("requires missing elements for a partial capture", () => {
    const result = FinalizeCaptureInputSchema.safeParse({
      idempotencyKey: "capture-key-1",
      completeness: "partial",
      missingElements: [],
      rawText: "saved text",
      messages: [],
      uploadedAttachments: []
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract tests and verify failure**

Run:

```bash
pnpm vitest run packages/contracts/src/capture.test.ts
```

Expected: FAIL because `capture.ts` does not exist.

- [ ] **Step 3: Implement the wire contracts**

Create `packages/contracts/src/capture.ts` with these exported schemas and inferred types:

```ts
import { z } from "zod";

export const CaptureSourceSchema = z.enum([
  "chatgpt_web",
  "manual_text",
  "manual_file",
  "manual_screenshot"
]);

export const CaptureScopeSchema = z.enum([
  "full_conversation",
  "qa_pair",
  "selection",
  "web_page",
  "upload"
]);

export const SensitivitySchema = z.enum([
  "normal",
  "sensitive",
  "strictly_sensitive"
]);

export const CaptureCompletenessSchema = z.enum([
  "complete",
  "partial",
  "failed"
]);

export const FinalizableCompletenessSchema = z.enum([
  "complete",
  "partial"
]);

export const ProcessingStatusSchema = z.enum([
  "queued",
  "processing",
  "complete",
  "failed",
  "paused"
]);

export const AttachmentManifestSchema = z.object({
  clientId: z.string().min(1).max(100),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "text/markdown",
    "application/pdf"
  ]),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export const CapturedMessageSchema = z.object({
  externalMessageId: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string().max(2 * 1024 * 1024),
  ordinal: z.number().int().nonnegative()
});

export const StartCaptureInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  source: CaptureSourceSchema,
  scope: CaptureScopeSchema,
  title: z.string().min(1).max(500),
  sensitivity: SensitivitySchema,
  externalRef: z.string().max(1000).nullable(),
  attachments: z.array(AttachmentManifestSchema).max(50)
}).superRefine((value, context) => {
  const total = value.attachments.reduce((sum, item) => sum + item.byteSize, 0);
  if (total > 100 * 1024 * 1024) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attachments"],
      message: "attachments exceed 100 MiB total"
    });
  }
});

export const FinalizeCaptureInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  completeness: FinalizableCompletenessSchema,
  missingElements: z.array(z.string().min(1).max(500)).max(50),
  rawText: z.string(),
  messages: z.array(CapturedMessageSchema).max(5000),
  uploadedAttachments: z.array(z.object({
    clientId: z.string().min(1),
    storagePath: z.string().min(1),
    etag: z.string().min(1)
  })).max(50)
}).superRefine((value, context) => {
  if (new TextEncoder().encode(value.rawText).byteLength > 2 * 1024 * 1024) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rawText"],
      message: "raw text exceeds 2 MiB"
    });
  }
  if (value.completeness === "partial" && value.missingElements.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["missingElements"],
      message: "partial capture requires at least one missing element"
    });
  }
});

export const StartCaptureResultSchema = z.object({
  captureId: z.string().uuid(),
  uploadTargets: z.array(z.object({
    clientId: z.string(),
    storagePath: z.string(),
    token: z.string()
  }))
});

export const CaptureReceiptSchema = z.object({
  captureId: z.string().uuid(),
  sourceItemId: z.string().uuid(),
  captureStatus: FinalizableCompletenessSchema,
  processingStatus: ProcessingStatusSchema,
  savedMessageCount: z.number().int().nonnegative(),
  savedAttachmentCount: z.number().int().nonnegative(),
  missingElements: z.array(z.string())
});

export const FailedCaptureStatusSchema = z.object({
  captureId: z.string().uuid(),
  sourceItemId: z.null(),
  captureStatus: z.literal("failed"),
  processingStatus: z.literal("paused"),
  savedMessageCount: z.literal(0),
  savedAttachmentCount: z.literal(0),
  missingElements: z.array(z.string()),
  failureReason: z.string().min(1)
});

export const CaptureStatusResultSchema = z.union([
  CaptureReceiptSchema.extend({ failureReason: z.null() }),
  FailedCaptureStatusSchema
]);

export type AttachmentManifest = z.infer<typeof AttachmentManifestSchema>;
export type CapturedMessage = z.infer<typeof CapturedMessageSchema>;
export type StartCaptureInput = z.infer<typeof StartCaptureInputSchema>;
export type FinalizeCaptureInput = z.infer<typeof FinalizeCaptureInputSchema>;
export type StartCaptureResult = z.infer<typeof StartCaptureResultSchema>;
export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;
export type CaptureStatusResult = z.infer<typeof CaptureStatusResultSchema>;
```

Export every public schema and type from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Write failing domain tests**

Create `packages/domain/src/capture/fingerprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeContentFingerprint } from "./fingerprint";

describe("computeContentFingerprint", () => {
  it("normalizes line endings and surrounding whitespace", async () => {
    const first = await computeContentFingerprint({
      source: "manual_text",
      externalRef: null,
      rawText: "  hello\r\nworld  ",
      attachmentHashes: []
    });
    const second = await computeContentFingerprint({
      source: "manual_text",
      externalRef: null,
      rawText: "hello\nworld",
      attachmentHashes: []
    });

    expect(first).toBe(second);
  });
});
```

Create `packages/domain/src/capture/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeMessages } from "./merge";

describe("mergeMessages", () => {
  it("keeps existing messages and appends only new ids", () => {
    const previous = [
      { externalMessageId: "m1", role: "user" as const, text: "Q", ordinal: 0 }
    ];
    const incoming = [
      { externalMessageId: "m1", role: "user" as const, text: "Q", ordinal: 0 },
      { externalMessageId: "m2", role: "assistant" as const, text: "A", ordinal: 1 }
    ];

    expect(mergeMessages(previous, incoming)).toEqual({
      messages: [previous[0], incoming[1]],
      appendedIds: ["m2"],
      changedIds: []
    });
  });
});
```

- [ ] **Step 5: Implement deterministic domain functions**

Implement `computeContentFingerprint` using `crypto.subtle.digest("SHA-256", bytes)`, a canonical JSON object, normalized `\n` line endings, trimmed text, sorted attachment hashes, and no timestamps.

Implement `mergeMessages` keyed by `externalMessageId`:

- unchanged id and text: retain previous message;
- existing id with changed text or role: replace with incoming and include id in `changedIds`;
- new id: append and include id in `appendedIds`;
- final list sorted by `ordinal`.

Implement `toCaptureReceipt(input)` so:

- `complete` is returned only when finalization committed;
- `partial` preserves `missingElements`;
- `processingStatus` begins as `queued`;
- saved counts come from committed rows, not client claims.

- [ ] **Step 6: Run shared tests**

Run:

```bash
pnpm vitest run packages/contracts packages/domain
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit contracts and domain logic**

```bash
git add packages/contracts packages/domain
git commit -m "feat: define reliable capture contracts"
```

---

### Task 3: Create the Capture Database, Private Storage, and RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202607290001_capture_schema.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/001_capture_rls.test.sql`
- Create: `apps/web/src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: contract enum values from Task 2.
- Produces tables `source_items`, `source_versions`, `source_messages`, `source_attachments`, `capture_sessions`, `processing_jobs`, `extension_tokens`; private Storage bucket `raw-captures`; RLS policies based on `owner_user_id`.

- [ ] **Step 1: Initialize Supabase local development**

Run:

```bash
pnpm add -Dw supabase
pnpm supabase init
```

Set the local Storage bucket in `supabase/config.toml`:

```toml
[storage.buckets.raw-captures]
public = false
file_size_limit = "10MiB"
allowed_mime_types = ["image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "application/pdf"]
```

- [ ] **Step 2: Write the failing RLS test first**

Create `supabase/tests/001_capture_rls.test.sql`:

```sql
begin;
select plan(3);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.source_items (
  id, owner_user_id, source, external_ref, title, sensitivity, archived_at, deleted_at
) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'manual_text',
  null,
  'owner item',
  'normal',
  null,
  null
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.source_items),
  1,
  'owner sees own source item'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.source_items),
  0,
  'other user cannot see owner source item'
);

delete from public.source_items
where id = '10000000-0000-0000-0000-000000000001';

reset role;
select is(
  (
    select count(*)::integer
    from public.source_items
    where id = '10000000-0000-0000-0000-000000000001'
  ),
  1,
  'other user delete leaves owner source item intact'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run the database test and verify failure**

Run:

```bash
pnpm supabase start
pnpm supabase test db
```

Expected: FAIL because `public.source_items` does not exist.

- [ ] **Step 4: Write the capture migration**

Create `supabase/migrations/202607290001_capture_schema.sql` with:

```sql
create extension if not exists pgcrypto;

create type public.capture_source as enum (
  'chatgpt_web', 'manual_text', 'manual_file', 'manual_screenshot'
);
create type public.capture_scope as enum (
  'full_conversation', 'qa_pair', 'selection', 'web_page', 'upload'
);
create type public.sensitivity_level as enum (
  'normal', 'sensitive', 'strictly_sensitive'
);
create type public.capture_completeness as enum (
  'complete', 'partial', 'failed'
);
create type public.processing_state as enum (
  'queued', 'processing', 'complete', 'failed', 'paused'
);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source public.capture_source not null,
  external_ref text,
  title text not null check (char_length(title) between 1 and 500),
  sensitivity public.sensitivity_level not null,
  current_version integer not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, source, external_ref)
);

create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid references public.source_items(id) on delete cascade,
  idempotency_key text not null,
  source public.capture_source not null,
  scope public.capture_scope not null,
  title text not null,
  sensitivity public.sensitivity_level not null,
  external_ref text,
  expected_attachments jsonb not null default '[]'::jsonb,
  status text not null check (status in ('awaiting_upload', 'finalized', 'failed')),
  failure_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (owner_user_id, idempotency_key)
);

create table public.source_versions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete cascade,
  version integer not null,
  capture_session_id uuid not null references public.capture_sessions(id),
  capture_status public.capture_completeness not null,
  missing_elements text[] not null default '{}',
  raw_text text not null check (octet_length(raw_text) <= 2097152),
  content_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (source_item_id, version),
  unique (owner_user_id, content_fingerprint)
);

create table public.source_messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete cascade,
  source_version_id uuid not null references public.source_versions(id) on delete cascade,
  external_message_id text not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  body text not null,
  ordinal integer not null check (ordinal >= 0),
  unique (source_item_id, external_message_id)
);

create table public.source_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_version_id uuid not null references public.source_versions(id) on delete cascade,
  client_id text not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  etag text not null
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_version_id uuid not null references public.source_versions(id) on delete cascade,
  job_type text not null check (job_type = 'prepare_for_milestone_b'),
  status public.processing_state not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_version_id, job_type)
);

create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index source_items_owner_updated_idx
  on public.source_items (owner_user_id, updated_at desc);
create index capture_sessions_owner_status_idx
  on public.capture_sessions (owner_user_id, status, created_at desc);
create index processing_jobs_owner_status_idx
  on public.processing_jobs (owner_user_id, status, next_attempt_at);

alter table public.source_items enable row level security;
alter table public.capture_sessions enable row level security;
alter table public.source_versions enable row level security;
alter table public.source_messages enable row level security;
alter table public.source_attachments enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.extension_tokens enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'source_items', 'capture_sessions', 'source_versions', 'source_messages',
    'source_attachments', 'processing_jobs', 'extension_tokens'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_user_id) with check ((select auth.uid()) = owner_user_id)',
      table_name || '_owner_all',
      table_name
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'raw-captures',
  'raw-captures',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy raw_captures_owner_select
on storage.objects for select to authenticated
using (
  bucket_id = 'raw-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy raw_captures_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy raw_captures_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'raw-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
```

- [ ] **Step 5: Reset the database and run RLS tests**

Run:

```bash
pnpm supabase db reset
pnpm supabase test db
pnpm supabase gen types --lang typescript --local
```

Write the generated output to `apps/web/src/lib/supabase/database.types.ts`.

Expected: all three pgTAP assertions pass.

- [ ] **Step 6: Commit schema and RLS**

```bash
git add supabase apps/web/src/lib/supabase/database.types.ts package.json pnpm-lock.yaml
git commit -m "feat: add capture schema and owner isolation"
```

---

### Task 4: Add Personal Authentication and the Web Shell

**Files:**
- Create: `apps/web/src/lib/supabase/browser.ts`
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/supabase/admin.ts`
- Create: `apps/web/src/app/(auth)/sign-in/page.tsx`
- Create: `apps/web/src/app/auth/confirm/route.ts`
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/app/(app)/page.tsx`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/components/app-sidebar.tsx`
- Test: `apps/web/src/components/app-sidebar.test.tsx`
- Test: `tests/e2e/web/auth.spec.ts`

**Interfaces:**
- Consumes: Supabase Auth session cookie.
- Produces:
  - `createBrowserClient(): SupabaseClient<Database>`.
  - `createServerClient(): Promise<SupabaseClient<Database>>`.
  - `requireUser(): Promise<{ id: string; email: string | null }>` in `server.ts`.
  - Protected app routes and personal magic-link sign-in.

- [ ] **Step 1: Install Web dependencies**

Run:

```bash
pnpm --filter @recall/web add @supabase/ssr @supabase/supabase-js zod
pnpm --filter @recall/web add -D @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write a failing navigation test**

Create `apps/web/src/components/app-sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppSidebar } from "./app-sidebar";

describe("AppSidebar", () => {
  it("shows only milestone A destinations", () => {
    render(<AppSidebar exceptionCount={2} />);
    expect(screen.getByRole("link", { name: "今天" })).toBeVisible();
    expect(screen.getByRole("link", { name: "采集记录" })).toBeVisible();
    expect(screen.getByRole("link", { name: "异常 2" })).toBeVisible();
    expect(screen.queryByText("知识卡片")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the navigation test and verify failure**

Run:

```bash
pnpm vitest run apps/web/src/components/app-sidebar.test.tsx
```

Expected: FAIL because `AppSidebar` does not exist.

- [ ] **Step 4: Implement Supabase clients and auth**

Implement:

```ts
export async function requireUser() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user == null) {
    redirect("/sign-in");
  }
  return { id: data.user.id, email: data.user.email ?? null };
}
```

The sign-in form accepts an email address and calls `signInWithOtp` with `emailRedirectTo: "${origin}/auth/confirm"`. The confirmation route exchanges the code for a session and redirects to `/`.

`admin.ts` reads `SUPABASE_SERVICE_ROLE_KEY` only on the server and throws at import-time if used in a browser bundle.

- [ ] **Step 5: Implement the milestone A shell**

Create `AppSidebar` with links:

```tsx
const links = [
  { href: "/", label: "今天" },
  { href: "/captures", label: "采集记录" },
  { href: "/exceptions", label: `异常 ${exceptionCount}` },
  { href: "/settings", label: "设置" }
];
```

The home page contains a “快速添加” action and empty-state cards for today’s captures, queued processing, and unresolved exceptions. Do not render navigation for unimplemented later milestones.

- [ ] **Step 6: Run focused and browser tests**

Run:

```bash
pnpm vitest run apps/web/src/components/app-sidebar.test.tsx
pnpm --filter @recall/web typecheck
pnpm e2e tests/e2e/web/auth.spec.ts
```

Expected: sidebar test passes; unauthenticated `/` redirects to `/sign-in`; a seeded test session reaches the app shell.

- [ ] **Step 7: Commit authentication and shell**

```bash
git add apps/web tests/e2e/web/auth.spec.ts
git commit -m "feat: add personal auth and capture shell"
```

---

### Task 5: Add Revocable Extension Pairing

**Files:**
- Create: `packages/contracts/src/extension-auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/features/extension/server/pairing.ts`
- Create: `apps/web/src/app/api/extension/pairing/start/route.ts`
- Create: `apps/web/src/app/api/extension/pairing/exchange/route.ts`
- Create: `apps/web/src/app/(app)/settings/page.tsx`
- Test: `apps/web/src/features/extension/server/pairing.test.ts`

**Interfaces:**
- Consumes: authenticated Web user for pairing start.
- Produces:
  - `startPairing(ownerUserId: string): Promise<{ code: string; expiresAt: string }>`.
  - `exchangePairingCode(code: string, label: string): Promise<{ token: string; expiresAt: string }>`.
  - Bearer token accepted by capture routes through `authenticateRequest(request): Promise<{ ownerUserId: string; credential: "web" | "extension" }>`.

- [ ] **Step 1: Write failing pairing tests**

Create `apps/web/src/features/extension/server/pairing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPairingCode, hashSecret } from "./pairing";

describe("extension pairing", () => {
  it("creates an eight-character code without ambiguous characters", () => {
    const code = createPairingCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("hashes secrets deterministically without returning the secret", async () => {
    const first = await hashSecret("sample-secret");
    const second = await hashSecret("sample-secret");
    expect(first).toBe(second);
    expect(first).not.toContain("sample-secret");
  });
});
```

- [ ] **Step 2: Verify pairing tests fail**

Run:

```bash
pnpm vitest run apps/web/src/features/extension/server/pairing.test.ts
```

Expected: FAIL because `pairing.ts` does not exist.

- [ ] **Step 3: Implement one-time pairing**

Create `supabase/migrations/202607290002_extension_pairing.sql`:

```sql
create table public.extension_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.extension_pairing_codes enable row level security;

create policy extension_pairing_codes_owner_all
on public.extension_pairing_codes
for all
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

create index extension_pairing_codes_expiry_idx
on public.extension_pairing_codes (expires_at)
where used_at is null;
```

`startPairing` stores only the code hash. `exchangePairingCode` atomically marks the code used, generates 32 random bytes encoded as base64url, stores only the token hash in `extension_tokens`, and returns the raw token once. Extension tokens expire after 30 days and can be revoked from settings.

- [ ] **Step 4: Implement request authentication**

`authenticateRequest` follows this order:

1. If an `Authorization: Bearer` header exists, hash the token and look up a non-revoked, non-expired `extension_tokens` row.
2. Otherwise read the Supabase Web session.
3. Reject with `401` when neither succeeds.
4. Update `last_used_at` for extension tokens after successful use.

- [ ] **Step 5: Add the settings pairing UI**

The settings page:

- creates and displays the 8-character code;
- shows a 10-minute countdown;
- lists paired extension labels, last-used time, expiry, and revoke action;
- never displays stored token values.

- [ ] **Step 6: Run pairing and authorization tests**

Run:

```bash
pnpm vitest run apps/web/src/features/extension/server/pairing.test.ts
pnpm supabase test db
pnpm --filter @recall/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit extension pairing**

```bash
git add packages/contracts apps/web supabase/migrations
git commit -m "feat: add revocable extension pairing"
```

---

### Task 6: Implement Two-Phase Capture Start, Finalize, and Status APIs

**Files:**
- Create: `apps/web/src/features/capture/server/start-capture.ts`
- Create: `apps/web/src/features/capture/server/finalize-capture.ts`
- Create: `apps/web/src/features/capture/server/get-capture-status.ts`
- Create: `apps/web/src/app/api/captures/start/route.ts`
- Create: `apps/web/src/app/api/captures/[captureId]/finalize/route.ts`
- Create: `apps/web/src/app/api/captures/[captureId]/status/route.ts`
- Test: `apps/web/src/features/capture/server/start-capture.test.ts`
- Test: `apps/web/src/features/capture/server/finalize-capture.test.ts`

**Interfaces:**
- Consumes: Task 2 contracts, Task 3 tables, Task 5 `authenticateRequest`.
- Produces:
  - `startCapture(ownerUserId: string, input: StartCaptureInput): Promise<StartCaptureResult>`
  - `finalizeCapture(ownerUserId: string, captureId: string, input: FinalizeCaptureInput): Promise<CaptureReceipt>`
  - `getCaptureStatus(ownerUserId: string, captureId: string): Promise<CaptureStatusResult>`
  - HTTP routes with `201`, `200`, `400`, `401`, `404`, and `409` semantics.

- [ ] **Step 1: Write a failing finalize-use-case test**

Create `apps/web/src/features/capture/server/finalize-capture.test.ts` with a repository fake:

```ts
import { describe, expect, it } from "vitest";
import { finalizeCaptureWithRepository } from "./finalize-capture";

describe("finalizeCaptureWithRepository", () => {
  it("returns the existing receipt when the idempotency key repeats", async () => {
    const existingReceipt = {
      captureId: "20000000-0000-0000-0000-000000000001",
      sourceItemId: "30000000-0000-0000-0000-000000000001",
      captureStatus: "complete" as const,
      processingStatus: "queued" as const,
      savedMessageCount: 2,
      savedAttachmentCount: 0,
      missingElements: []
    };
    const repository = {
      findReceiptByIdempotencyKey: async () => existingReceipt,
      commitFinalization: async () => {
        throw new Error("must not write twice");
      }
    };

    const result = await finalizeCaptureWithRepository(repository, {
      ownerUserId: "00000000-0000-0000-0000-000000000001",
      captureId: existingReceipt.captureId,
      input: {
        idempotencyKey: "same-key-123",
        completeness: "complete",
        missingElements: [],
        rawText: "Q\nA",
        messages: [],
        uploadedAttachments: []
      }
    });

    expect(result).toEqual(existingReceipt);
  });
});
```

- [ ] **Step 2: Run the use-case test and verify failure**

Run:

```bash
pnpm vitest run apps/web/src/features/capture/server/finalize-capture.test.ts
```

Expected: FAIL because the use case does not exist.

- [ ] **Step 3: Implement capture start**

`startCapture` must:

1. validate attachment count, MIME type, individual size, and total size;
2. find an existing capture session for `(owner_user_id, idempotency_key)` or insert one with `status = 'awaiting_upload'` and two-hour expiry;
3. build immutable paths as `${ownerUserId}/${captureId}/${clientId}-${sha256}-${safeFileName}`;
4. call `createSignedUploadUrl(storagePath)` on the private bucket;
5. return `captureId`, `storagePath`, and signed upload token for each attachment.

If a retry finds an unexpired awaiting-upload session, generate fresh signed upload tokens for its existing immutable paths and return the same `captureId`. If signed URL creation fails, mark the session failed and return a typed `CaptureStartError`; never return a partially populated successful result.

- [ ] **Step 4: Implement atomic capture finalization**

Create `supabase/migrations/202607290003_finalize_capture.sql` with this RPC. The application verifies Storage object metadata before calling it; the RPC owns every database write:

```sql
create or replace function public.finalize_capture(
  p_owner_user_id uuid,
  p_capture_id uuid,
  p_idempotency_key text,
  p_capture_status public.capture_completeness,
  p_missing_elements text[],
  p_raw_text text,
  p_content_fingerprint text,
  p_messages jsonb,
  p_attachments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.capture_sessions%rowtype;
  v_existing_version public.source_versions%rowtype;
  v_source_item_id uuid;
  v_source_version_id uuid;
  v_version integer;
  v_saved_message_count integer;
  v_saved_attachment_count integer;
begin
  if p_capture_status = 'failed' then
    raise exception using
      errcode = '22023',
      message = 'failed captures cannot be finalized';
  end if;

  select sv.*
  into v_existing_version
  from public.capture_sessions cs
  join public.source_versions sv on sv.capture_session_id = cs.id
  where cs.owner_user_id = p_owner_user_id
    and cs.idempotency_key = p_idempotency_key
    and cs.status = 'finalized'
  limit 1;

  if found then
    select count(*)::integer
    into v_saved_message_count
    from public.source_messages
    where source_item_id = v_existing_version.source_item_id;

    select count(*)::integer
    into v_saved_attachment_count
    from public.source_attachments
    where source_version_id = v_existing_version.id;

    return jsonb_build_object(
      'captureId', v_existing_version.capture_session_id,
      'sourceItemId', v_existing_version.source_item_id,
      'captureStatus', v_existing_version.capture_status,
      'processingStatus', 'queued',
      'savedMessageCount', v_saved_message_count,
      'savedAttachmentCount', v_saved_attachment_count,
      'missingElements', to_jsonb(v_existing_version.missing_elements)
    );
  end if;

  select *
  into v_session
  from public.capture_sessions
  where id = p_capture_id
    and owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'capture session not found';
  end if;

  if v_session.status <> 'awaiting_upload' then
    raise exception using errcode = '23505', message = 'capture session already finalized';
  end if;

  if v_session.expires_at <= now() then
    update public.capture_sessions
    set status = 'failed', failure_reason = 'capture session expired'
    where id = p_capture_id;
    raise exception using errcode = '22023', message = 'capture session expired';
  end if;

  update public.capture_sessions
  set idempotency_key = p_idempotency_key
  where id = p_capture_id;

  select *
  into v_existing_version
  from public.source_versions
  where owner_user_id = p_owner_user_id
    and content_fingerprint = p_content_fingerprint
  limit 1;

  if found then
    update public.capture_sessions
    set
      source_item_id = v_existing_version.source_item_id,
      status = 'finalized',
      finalized_at = now()
    where id = p_capture_id;

    select count(*)::integer
    into v_saved_message_count
    from public.source_messages
    where source_item_id = v_existing_version.source_item_id;

    select count(*)::integer
    into v_saved_attachment_count
    from public.source_attachments
    where source_version_id = v_existing_version.id;

    return jsonb_build_object(
      'captureId', p_capture_id,
      'sourceItemId', v_existing_version.source_item_id,
      'captureStatus', v_existing_version.capture_status,
      'processingStatus', 'queued',
      'savedMessageCount', v_saved_message_count,
      'savedAttachmentCount', v_saved_attachment_count,
      'missingElements', to_jsonb(v_existing_version.missing_elements)
    );
  end if;

  if v_session.external_ref is not null then
    select id
    into v_source_item_id
    from public.source_items
    where owner_user_id = p_owner_user_id
      and source = v_session.source
      and external_ref = v_session.external_ref
    for update;
  end if;

  if v_source_item_id is null then
    insert into public.source_items (
      owner_user_id, source, external_ref, title, sensitivity
    ) values (
      p_owner_user_id,
      v_session.source,
      v_session.external_ref,
      v_session.title,
      v_session.sensitivity
    )
    returning id into v_source_item_id;
  end if;

  select coalesce(max(version), 0) + 1
  into v_version
  from public.source_versions
  where source_item_id = v_source_item_id;

  insert into public.source_versions (
    owner_user_id,
    source_item_id,
    version,
    capture_session_id,
    capture_status,
    missing_elements,
    raw_text,
    content_fingerprint
  ) values (
    p_owner_user_id,
    v_source_item_id,
    v_version,
    p_capture_id,
    p_capture_status,
    p_missing_elements,
    p_raw_text,
    p_content_fingerprint
  )
  returning id into v_source_version_id;

  insert into public.source_messages (
    owner_user_id,
    source_item_id,
    source_version_id,
    external_message_id,
    role,
    body,
    ordinal
  )
  select
    p_owner_user_id,
    v_source_item_id,
    v_source_version_id,
    message->>'externalMessageId',
    message->>'role',
    message->>'text',
    (message->>'ordinal')::integer
  from jsonb_array_elements(p_messages) as message
  on conflict (source_item_id, external_message_id)
  do update set
    source_version_id = excluded.source_version_id,
    role = excluded.role,
    body = excluded.body,
    ordinal = excluded.ordinal;

  insert into public.source_attachments (
    owner_user_id,
    source_version_id,
    client_id,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    sha256,
    etag
  )
  select
    p_owner_user_id,
    v_source_version_id,
    attachment->>'clientId',
    attachment->>'storagePath',
    attachment->>'fileName',
    attachment->>'mimeType',
    (attachment->>'byteSize')::bigint,
    attachment->>'sha256',
    attachment->>'etag'
  from jsonb_array_elements(p_attachments) as attachment;

  insert into public.processing_jobs (
    owner_user_id, source_version_id, job_type, status
  ) values (
    p_owner_user_id,
    v_source_version_id,
    'prepare_for_milestone_b',
    'queued'
  );

  update public.source_items
  set
    current_version = v_version,
    title = v_session.title,
    sensitivity = v_session.sensitivity,
    updated_at = now()
  where id = v_source_item_id;

  update public.capture_sessions
  set
    source_item_id = v_source_item_id,
    status = 'finalized',
    finalized_at = now()
  where id = p_capture_id;

  select count(*)::integer
  into v_saved_message_count
  from public.source_messages
  where source_item_id = v_source_item_id;

  select count(*)::integer
  into v_saved_attachment_count
  from public.source_attachments
  where source_version_id = v_source_version_id;

  return jsonb_build_object(
    'captureId', p_capture_id,
    'sourceItemId', v_source_item_id,
    'captureStatus', p_capture_status,
    'processingStatus', 'queued',
    'savedMessageCount', v_saved_message_count,
    'savedAttachmentCount', v_saved_attachment_count,
    'missingElements', to_jsonb(p_missing_elements)
  );
end;
$$;

revoke all on function public.finalize_capture(
  uuid, uuid, text, public.capture_completeness, text[], text, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.finalize_capture(
  uuid, uuid, text, public.capture_completeness, text[], text, text, jsonb, jsonb
) to service_role;
```

`finalizeCapture` loads `capture_sessions.expected_attachments`, matches every `uploadedAttachments.clientId`, verifies each Storage object’s path, size, MIME type, SHA-256, and ETag, then builds the enriched `p_attachments` JSON expected by the SQL function. It calculates the content fingerprint server-side and ignores client-provided counts.

- [ ] **Step 5: Implement status and HTTP adapters**

Route behavior:

```text
POST /api/captures/start
201 { captureId, uploadTargets }

POST /api/captures/:captureId/finalize
200 { captureId, sourceItemId, captureStatus, processingStatus, savedMessageCount, savedAttachmentCount, missingElements }

GET /api/captures/:captureId/status
200 { receipt fields, failureReason }
```

Invalid Zod input returns `400` with `{ code: "invalid_capture", fieldErrors }`. Wrong owner returns `404`, not `403`, to avoid disclosing ids. An idempotency conflict with different content returns `409`.

- [ ] **Step 6: Run API and database tests**

Run:

```bash
pnpm vitest run apps/web/src/features/capture/server
pnpm supabase db reset
pnpm supabase test db
pnpm --filter @recall/web typecheck
```

Expected: repeated finalization returns the same receipt; failed finalization leaves no source version or job; other-user ids return not found.

- [ ] **Step 7: Commit the capture protocol**

```bash
git add apps/web/src/features/capture apps/web/src/app/api/captures supabase/migrations
git commit -m "feat: add durable two-phase capture api"
```

---

### Task 7: Build Manual Text, File, and Screenshot Capture in the Web App

**Files:**
- Create: `apps/web/src/features/capture/components/manual-capture-form.tsx`
- Create: `apps/web/src/features/capture/components/capture-receipt.tsx`
- Create: `apps/web/src/features/capture/client/upload-capture.ts`
- Modify: `apps/web/src/app/(app)/page.tsx`
- Create: `apps/web/src/app/(app)/captures/new/page.tsx`
- Test: `apps/web/src/features/capture/components/manual-capture-form.test.tsx`
- Test: `tests/e2e/web/manual-capture.spec.ts`

**Interfaces:**
- Consumes: Task 6 HTTP routes.
- Produces:
  - `uploadCapture(input: BrowserCaptureDraft): Promise<CaptureReceipt>`.
  - Web form for text, files, screenshots, title, and sensitivity.
  - Receipt UI that never conflates capture status and processing status.

- [ ] **Step 1: Write the failing form test**

Create `manual-capture-form.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManualCaptureForm } from "./manual-capture-form";

describe("ManualCaptureForm", () => {
  it("blocks a file larger than ten MiB before upload", async () => {
    render(<ManualCaptureForm submitCapture={vi.fn()} />);
    const file = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" }
    );
    fireEvent.change(screen.getByLabelText("添加文件或截图"), {
      target: { files: [file] }
    });
    expect(await screen.findByText("单个文件不能超过 10 MiB")).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the form test fails**

Run:

```bash
pnpm vitest run apps/web/src/features/capture/components/manual-capture-form.test.tsx
```

Expected: FAIL because the form does not exist.

- [ ] **Step 3: Implement the browser upload client**

`uploadCapture` must:

1. hash files with Web Crypto;
2. call `/api/captures/start`;
3. upload each file using `uploadToSignedUrl(storagePath, token, file)`;
4. collect storage path and returned ETag;
5. use one stable UUID idempotency key for both start and finalize, retained for the entire attempt and every retry;
6. return the server receipt;
7. never convert an HTTP/network error to a successful receipt.

- [ ] **Step 4: Implement the capture form**

Fields:

- title, required;
- text, optional when files exist;
- file picker with `multiple`;
- sensitivity: normal, sensitive, strictly sensitive;
- local validation matching the global constraints;
- progress by file and overall state.

Receipt copy:

- complete: `完整采集成功，原始资料已保存`;
- partial: `部分内容未采集` plus each missing element;
- network/finalize failure: `采集尚未完成，服务器未确认保存`;
- queued processing: `原文已保存，等待后台处理`.

- [ ] **Step 5: Write and run the Web end-to-end test**

Create `tests/e2e/web/manual-capture.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("manual text capture shows success only after finalize", async ({ page }) => {
  await page.goto("/captures/new");
  await page.getByLabel("标题").fill("测试资料");
  await page.getByLabel("正文").fill("这是一条真实保存流程的合成测试内容。");
  await page.getByRole("button", { name: "保存并后台整理" }).click();
  await expect(page.getByText("完整采集成功，原始资料已保存")).toBeVisible();
  await expect(page.getByText("原文已保存，等待后台处理")).toBeVisible();
});
```

Run:

```bash
pnpm vitest run apps/web/src/features/capture/components/manual-capture-form.test.tsx
pnpm e2e tests/e2e/web/manual-capture.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit manual capture**

```bash
git add apps/web/src/features/capture apps/web/src/app tests/e2e/web/manual-capture.spec.ts
git commit -m "feat: add manual capture workflow"
```

---

### Task 8: Scaffold and Pair the Manifest V3 Extension

**Files:**
- Modify: `apps/extension/wxt.config.ts`
- Create: `apps/extension/lib/auth-store.ts`
- Create: `apps/extension/lib/api-client.ts`
- Create: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/main.tsx`
- Test: `apps/extension/lib/auth-store.test.ts`
- Test: `apps/extension/entrypoints/popup/App.test.tsx`

**Interfaces:**
- Consumes: Task 5 pairing exchange, Task 6 capture routes.
- Produces:
  - `getExtensionCredential(): Promise<ExtensionCredential | null>`.
  - `saveExtensionCredential(credential): Promise<void>`.
  - `CaptureApiClient` with `start`, `finalize`, and `status`.
  - Popup states `unpaired | ready | capturing | complete | partial | failed`.

- [ ] **Step 1: Restrict extension permissions**

Set `wxt.config.ts`:

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "Recall AI Capture",
    description: "Save selected conversations and pages to your private Recall AI library.",
    permissions: ["storage", "activeTab", "scripting", "notifications"],
    host_permissions: [
      "https://chatgpt.com/*",
      "http://localhost:3000/*"
    ]
  }
});
```

Production API origin is injected at build time as `WXT_PUBLIC_API_ORIGIN`; it must be added explicitly to host permissions in the production build configuration.

- [ ] **Step 2: Write failing credential storage tests**

Create `apps/extension/lib/auth-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  clearExtensionCredential,
  getExtensionCredential,
  saveExtensionCredential
} from "./auth-store";

describe("auth store", () => {
  beforeEach(() => fakeBrowser.reset());

  it("stores the token only in extension local storage", async () => {
    await saveExtensionCredential({
      token: "secret-token",
      expiresAt: "2026-08-28T00:00:00.000Z"
    });
    expect(await getExtensionCredential()).toEqual({
      token: "secret-token",
      expiresAt: "2026-08-28T00:00:00.000Z"
    });
    await clearExtensionCredential();
    expect(await getExtensionCredential()).toBeNull();
  });
});
```

- [ ] **Step 3: Implement pairing and token storage**

The popup’s unpaired state asks for:

- 8-character pairing code;
- device label, defaulting to the browser name.

The API origin comes only from the build-time `WXT_PUBLIC_API_ORIGIN`, because Manifest V3 host permissions cannot safely follow arbitrary user-entered origins. The popup calls `/api/extension/pairing/exchange`, saves the returned token with `browser.storage.local`, clears the code input, and never logs the token.

- [ ] **Step 4: Implement the typed API client**

`CaptureApiClient`:

```ts
export interface CaptureApiClient {
  start(input: StartCaptureInput): Promise<StartCaptureResult>;
  finalize(captureId: string, input: FinalizeCaptureInput): Promise<CaptureReceipt>;
  status(captureId: string): Promise<CaptureStatusResult>;
}
```

Every request includes `Authorization: Bearer ${token}`. A `401` clears the credential and returns a typed `ExtensionAuthExpiredError`. Other non-2xx responses retain the server error code and request id.

- [ ] **Step 5: Implement popup state rendering**

The popup must show:

- unpaired instructions;
- current supported page and selected capture scope;
- sensitivity selector;
- submit button;
- complete/partial/failed receipt;
- unresolved outbox count.

Do not show tags or research projects in Milestone A.

- [ ] **Step 6: Run extension unit and build checks**

Run:

```bash
pnpm --filter @recall/extension test
pnpm --filter @recall/extension typecheck
pnpm --filter @recall/extension build
```

Expected: PASS; generated manifest contains only the declared permissions and host origins.

- [ ] **Step 7: Commit extension pairing**

```bash
git add apps/extension packages/contracts
git commit -m "feat: pair chromium capture extension"
```

---

### Task 9: Extract Complete, Partial, and Incremental ChatGPT Conversations

**Files:**
- Create: `apps/extension/lib/chatgpt/extract.ts`
- Create: `apps/extension/lib/chatgpt/completeness.ts`
- Create: `apps/extension/entrypoints/chatgpt.content.ts`
- Create: `tests/fixtures/chatgpt/complete-conversation.html`
- Create: `tests/fixtures/chatgpt/conversation-with-missing-image.html`
- Test: `apps/extension/lib/chatgpt/extract.test.ts`
- Test: `apps/extension/lib/chatgpt/completeness.test.ts`

**Interfaces:**
- Consumes: current ChatGPT DOM after an explicit popup request.
- Produces:
  - `extractChatGptConversation(document: Document, url: URL): ChatGptExtraction`.
  - `selectChatGptScope(extraction: ChatGptExtraction, scope: "full_conversation" | "qa_pair" | "selection", selectedText: string): ScopedChatGptCapture`.
  - `assessChatGptCompleteness(extraction): { completeness: "complete" | "partial"; missingElements: string[] }`.
  - Runtime message `EXTRACT_CHATGPT` returning the extraction or typed unsupported-page error.

- [ ] **Step 1: Create synthetic DOM fixtures**

`complete-conversation.html` must contain:

- one `main` region;
- three synthetic message articles with `data-message-author-role`;
- stable synthetic message ids;
- one user message, one assistant text answer, and one assistant answer containing an image with `src`, `alt`, width, and height.

`conversation-with-missing-image.html` contains the same structure but the image has an empty `src`.

Do not copy real ChatGPT content or user data into fixtures.

- [ ] **Step 2: Write failing extractor tests**

Create `apps/extension/lib/chatgpt/extract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractChatGptConversation } from "./extract";

describe("extractChatGptConversation", () => {
  it("extracts ordered roles and stable ids", () => {
    const html = readFileSync(
      resolve("../../tests/fixtures/chatgpt/complete-conversation.html"),
      "utf8"
    );
    const dom = new JSDOM(html);
    const result = extractChatGptConversation(
      dom.window.document,
      new URL("https://chatgpt.com/c/synthetic-conversation")
    );

    expect(result.externalRef).toBe("synthetic-conversation");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant"
    ]);
    expect(new Set(result.messages.map((message) => message.externalMessageId)).size).toBe(3);
  });
});
```

Add scope tests:

```ts
const scopedExtraction = {
  externalRef: "synthetic-conversation",
  title: "Synthetic conversation",
  messages: [
    { externalMessageId: "u1", role: "user" as const, text: "first question", ordinal: 0 },
    { externalMessageId: "a1", role: "assistant" as const, text: "first answer", ordinal: 1 },
    { externalMessageId: "u2", role: "user" as const, text: "latest question", ordinal: 2 },
    {
      externalMessageId: "a2",
      role: "assistant" as const,
      text: "selected synthetic answer",
      ordinal: 3
    }
  ],
  images: []
};

it("returns only the latest complete question and answer", () => {
  const scoped = selectChatGptScope(scopedExtraction, "qa_pair", "");
  expect(scoped.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant"
  ]);
});

it("returns selected text with the containing message id", () => {
  const scoped = selectChatGptScope(
    scopedExtraction,
    "selection",
    "selected synthetic answer"
  );
  expect(scoped.rawText).toBe("selected synthetic answer");
  expect(scoped.messages).toHaveLength(1);
});
```

- [ ] **Step 3: Verify extractor tests fail**

Run:

```bash
pnpm vitest run apps/extension/lib/chatgpt
```

Expected: FAIL because the extractor does not exist.

- [ ] **Step 4: Implement layered DOM extraction**

Extraction order:

1. find the conversation id from `/c/:id`;
2. find message containers with known semantic attributes;
3. derive role from `data-message-author-role`;
4. use a stable page-provided message id when available;
5. otherwise derive an id from role, ordinal, and normalized text hash;
6. extract visible text while excluding buttons, copy labels, feedback controls, and hidden elements;
7. collect image metadata without downloading images in the content script;
8. retain message ordinal.

Keep selectors in one exported `CHATGPT_SELECTORS` object so page changes affect one file.

`selectChatGptScope` applies these exact rules:

- `full_conversation`: return every extracted message;
- `qa_pair`: scan backward for the latest assistant message, then pair it with the nearest preceding user message;
- `selection`: require non-empty selected text, locate the containing extracted message by DOM range, and emit one message retaining that message’s stable id and role;
- no valid pair or selection: return a typed `unsupported_scope_state` error rather than silently falling back to the full conversation.

- [ ] **Step 5: Implement completeness assessment**

Return `partial` with specific messages when:

- no conversation id is available;
- no messages are found;
- any discovered image lacks a usable source URL;
- a message container has a role but no text and no attachment;
- the page shows a still-generating response indicator.

Example missing item: `第 3 条消息中的 1 张图片无法读取`.

- [ ] **Step 6: Implement on-demand content-script messaging**

The content script runs only on `https://chatgpt.com/*` and performs extraction only after receiving `EXTRACT_CHATGPT` from the popup. It returns serializable data and never sends network requests itself.

- [ ] **Step 7: Run extractor tests**

Run:

```bash
pnpm vitest run apps/extension/lib/chatgpt
pnpm --filter @recall/extension typecheck
```

Expected: complete fixture returns `complete`; missing-image fixture returns `partial` and the exact missing-image message.

- [ ] **Step 8: Commit ChatGPT extraction**

```bash
git add apps/extension tests/fixtures/chatgpt
git commit -m "feat: extract chatgpt conversations safely"
```

---

### Task 10: Add the Durable Extension Outbox, Retry, and Honest Status UI

**Files:**
- Create: `apps/extension/lib/outbox.ts`
- Create: `apps/extension/lib/capture-runner.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Test: `apps/extension/lib/outbox.test.ts`
- Test: `apps/extension/lib/capture-runner.test.ts`

**Interfaces:**
- Consumes: Task 8 API client, Task 9 extraction.
- Produces:
  - `enqueueDraft(draft: CaptureDraft): Promise<OutboxItem>`.
  - `processOutboxItem(id: string, now: Date): Promise<OutboxItem>`.
  - `listUnresolvedOutbox(): Promise<OutboxItem[]>`.
  - Browser notifications for attempts that remain unresolved after automatic retry.

- [ ] **Step 1: Write failing outbox state tests**

Create `apps/extension/lib/outbox.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { enqueueDraft, markAttemptFailed } from "./outbox";

describe("capture outbox", () => {
  beforeEach(() => fakeBrowser.reset());

  it("keeps an item unresolved after a network failure", async () => {
    const item = await enqueueDraft({
      idempotencyKey: "retry-key-123",
      source: "chatgpt_web",
      scope: "full_conversation",
      title: "Synthetic conversation",
      sensitivity: "normal",
      externalRef: "synthetic-conversation",
      rawText: "Q\nA",
      messages: [],
      attachments: [],
      completeness: "complete",
      missingElements: []
    });

    const failed = await markAttemptFailed(item.id, "network_error");
    expect(failed.state).toBe("retry_wait");
    expect(failed.attemptCount).toBe(1);
    expect(failed.receipt).toBeNull();
  });
});
```

- [ ] **Step 2: Verify outbox tests fail**

Run:

```bash
pnpm vitest run apps/extension/lib/outbox.test.ts
```

Expected: FAIL because `outbox.ts` does not exist.

- [ ] **Step 3: Implement outbox persistence**

Store JSON-serializable outbox items under `recall.captureOutbox` in `browser.storage.local`.

States:

```ts
type OutboxState =
  | "pending"
  | "uploading"
  | "finalizing"
  | "retry_wait"
  | "complete"
  | "partial";
```

Rules:

- items are created before the first network call;
- idempotency key never changes across retries;
- raw draft remains until a server receipt is stored;
- complete and partial receipts remain for seven days, then may be pruned;
- failed items remain until successful retry;
- retry delay is 30 seconds, 2 minutes, 10 minutes, 1 hour, then 6 hours;
- extension badge shows unresolved item count.

- [ ] **Step 4: Implement the capture runner**

`processOutboxItem`:

1. loads the current item;
2. starts the capture session if `captureId` is absent;
3. uploads attachments;
4. finalizes with the stable idempotency key;
5. stores the receipt before updating the popup;
6. maps server `complete` to complete and `partial` to partial;
7. on network/server failure stores `retry_wait` and the human-readable reason;
8. never creates a synthetic success receipt.

- [ ] **Step 5: Implement automatic retries and notifications**

The service worker:

- creates a browser alarm for the nearest `nextAttemptAt`;
- processes due items when the alarm fires;
- updates the badge;
- shows `采集仍未完成` notification after three failed attempts;
- opens the popup/outbox view when the notification is clicked.

- [ ] **Step 6: Implement honest popup status**

Copy:

- complete: green, `完整采集成功`, saved message/attachment counts;
- partial: amber, `部分内容未采集`, missing list, retry or add-screenshot action;
- retry wait: red, `服务器尚未确认保存`, next retry time and immediate retry;
- processing failed from status endpoint: blue, `原文已保存，后台处理失败`, no capture-loss language.

The add-screenshot action calls `browser.tabs.captureVisibleTab()` while `activeTab` permission is active, converts the data URL to an `image/png` Blob, hashes it, appends it to a new outbox attempt linked to the same `externalRef`, and finalizes a new source version. If screenshot permission or capture fails, retain the original partial receipt and show the exact browser error.

- [ ] **Step 7: Run outbox and extension tests**

Run:

```bash
pnpm vitest run apps/extension/lib/outbox.test.ts apps/extension/lib/capture-runner.test.ts
pnpm --filter @recall/extension typecheck
pnpm --filter @recall/extension build
```

Expected: network failure leaves an unresolved outbox item; repeated retry reuses the idempotency key; popup shows success only after a stored server receipt.

- [ ] **Step 8: Commit reliable retry**

```bash
git add apps/extension
git commit -m "feat: persist failed captures and retry honestly"
```

---

### Task 11: Add Capture History, Exception Recovery, and Milestone A End-to-End Verification

**Files:**
- Create: `apps/web/src/features/capture/server/list-captures.ts`
- Create: `apps/web/src/features/capture/server/list-exceptions.ts`
- Create: `apps/web/src/app/(app)/captures/page.tsx`
- Create: `apps/web/src/app/(app)/captures/[sourceItemId]/page.tsx`
- Create: `apps/web/src/app/(app)/exceptions/page.tsx`
- Modify: `apps/web/src/app/(app)/page.tsx`
- Create: `tests/e2e/extension/fixtures.ts`
- Create: `tests/e2e/extension/chatgpt-capture.spec.ts`
- Create: `tests/e2e/web/capture-exceptions.spec.ts`
- Create: `docs/runbooks/milestone-a-local.md`
- Create: `docs/runbooks/milestone-a-acceptance.md`

**Interfaces:**
- Consumes: all prior Milestone A interfaces.
- Produces:
  - history list with source, title, capture status, processing status, counts, and time;
  - exception list with missing/failure reason and recovery action;
  - automated end-to-end evidence for complete, partial, duplicate, unauthorized, and network-failure paths.

- [ ] **Step 1: Write a failing exception-page test**

Create `tests/e2e/web/capture-exceptions.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("partial capture remains visible until resolved", async ({ page }) => {
  await page.goto("/exceptions");
  await expect(page.getByText("部分内容未采集")).toBeVisible();
  await expect(page.getByText("2 张图片无法读取")).toBeVisible();
  await expect(page.getByRole("button", { name: "补充截图" })).toBeVisible();
});
```

- [ ] **Step 2: Implement history and exception queries**

`listCaptures(ownerUserId, cursor, limit)` returns the latest source version for each item, ordered by `updated_at desc`.

`listExceptions(ownerUserId)` returns:

- partial capture versions;
- failed capture sessions;
- processing jobs with `failed`;
- no records from other owners.

The home page exception count uses the same query.

- [ ] **Step 3: Implement history and exception pages**

History row fields:

- source icon/name;
- title;
- capture status;
- processing status;
- message and attachment counts;
- saved time;
- details link.

The details page loads by `sourceItemId` and owner, then displays the original text, message order, attachment metadata, capture completeness, missing elements, sensitivity, and every saved version. Attachment downloads use a 60-second signed download URL created on the server.

Exception card fields:

- severity and status copy;
- failure or missing-element list;
- whether raw data is already safe;
- `在扩展中重试` guidance for extension failures;
- upload supplement action for partial captures;
- no dismiss action for unresolved failed captures in Milestone A.

- [ ] **Step 4: Build the Playwright extension fixture**

Use `chromium.launchPersistentContext` with the built WXT output. Resolve the Manifest V3 service worker and extension id, expose the popup page, and serve synthetic ChatGPT fixture HTML from a local test server at a host allowed by the test manifest.

Do not rely on a real ChatGPT account in automated tests.

- [ ] **Step 5: Write the complete and partial extension journeys**

`chatgpt-capture.spec.ts` must cover:

1. pair extension using a seeded one-time code;
2. open complete synthetic conversation;
3. click full-conversation capture;
4. assert popup does not show success before delayed finalize responds;
5. assert complete receipt after finalize;
6. capture the same conversation again and assert one source item with no duplicate message rows;
7. open missing-image fixture;
8. assert partial receipt includes the missing image;
9. simulate offline finalize;
10. assert outbox badge and `服务器尚未确认保存`;
11. restore network, retry, and assert complete receipt.

- [ ] **Step 6: Add the local runbook**

`docs/runbooks/milestone-a-local.md` must contain exact commands:

```bash
pnpm install
pnpm supabase start
pnpm supabase db reset
pnpm --filter @recall/web dev
pnpm --filter @recall/extension dev
```

It must document required local environment variable names without values:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
WXT_PUBLIC_API_ORIGIN
```

It must explain pairing, loading the extension in Chrome/Edge, and checking the outbox.

- [ ] **Step 7: Add and execute the acceptance checklist**

`docs/runbooks/milestone-a-acceptance.md` includes:

- manual text, file, and multi-screenshot capture;
- ChatGPT complete, incremental, and selected capture;
- partial capture with missing detail;
- server-down capture retained locally;
- automatic and manual retry;
- other-user RLS denial;
- no secrets in built extension;
- Chrome and Edge manual smoke test;
- 30 real supported capture attempts for the formal 90% metric, marked as a later user-assisted acceptance session rather than synthetic CI.

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm supabase db reset
pnpm supabase test db
pnpm e2e
git diff --check
```

Expected: all automated checks pass.

- [ ] **Step 8: Inspect the built extension and secret surface**

Run:

```bash
rg -n "SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|secret-token" apps/extension/.output apps/web/.next/static
```

Expected: no matches.

Open the generated manifest and verify:

- `manifest_version` is `3`;
- permissions are only `storage`, `activeTab`, `scripting`, and `notifications`;
- host permissions are only ChatGPT and the configured API origin.

- [ ] **Step 9: Commit the Milestone A vertical slice**

```bash
git add apps/web tests docs/runbooks
git commit -m "feat: complete reliable capture milestone"
```

---

## Milestone A Review Gate

Before writing the Milestone B plan:

1. Install the unpacked build in the user’s Chrome and Edge.
2. Perform at least 30 supported real capture attempts across ChatGPT, manual text, files, and screenshots.
3. Record automatic success, partial, failed, retry-recovered, and manual-fallback counts separately.
4. Confirm no attempt was reported successful before durable finalization.
5. Review every failure sample and decide whether it is a bug, unsupported page state, permission issue, or platform change.
6. Update the design spec only if real use invalidates a confirmed requirement; preserve the change in Git.
7. Write the Milestone B plan using the actual raw-content shapes and failure data.

## Official References

- [Next.js installation and Node.js requirements](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/quickstarts/nextjs)
- [Supabase local migrations](https://supabase.com/docs/guides/local-development/overview)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase private Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase signed upload URLs](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)
- [Supabase upload to signed URL](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl)
- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [WXT installation](https://wxt.dev/guide/installation)
- [WXT manifest generation](https://wxt.dev/guide/essentials/config/manifest)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
