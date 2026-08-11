# Stage 1B Knowledge Processing and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一条已可靠保存的 ChatGPT 会话自动经过 PostgreSQL 队列、证据块构建和 DeepSeek 结构化提取，形成带引用的知识草稿，并允许用户在 Web 中审核、修改、确认或拒绝。

**Architecture:** 新增独立 `apps/worker` TypeScript 进程，通过 service role 调用受限 PostgreSQL RPC 原子领取任务。处理链为 `normalize_source → build_source_blocks → extract_knowledge`；每一步幂等、可重试且记录 `processing_runs`。DeepSeek 只返回版本化 JSON 草稿，Zod 校验和引用解析通过后才由单个数据库 RPC 原子写入知识、版本、引用和审核任务。Web 使用登录用户的 RLS 读取数据，审核写入走服务端领域规则和数据库事务。

**Tech Stack:** Node.js 22、TypeScript 5.9、Supabase PostgreSQL/RLS/pgTAP、原生 `fetch`、DeepSeek OpenAI-compatible Chat Completions、Zod 4、Vitest 4、Next.js 16/React 19。

## Global Constraints

- Stage 1A 必须已通过并完成数据备份；本计划不重建空间或原始采集表。
- Worker 只能在服务端读取 `SUPABASE_SERVICE_ROLE_KEY` 和 `DEEPSEEK_API_KEY`；密钥不得进入 `NEXT_PUBLIC_*`、扩展、浏览器 bundle、日志或 Git。
- 首版只处理 `chatgpt_web` 的文本消息。图片 OCR、Claude/豆包/DeepSeek 采集、网页、微信、GitHub、小红书属于阶段 2。
- AI 结果始终写为 `ai_draft`/`pending_review`，不能直接 `confirmed`。
- 每条草稿引用必须解析到当前 source version 的 `source_blocks`；模型虚构 locator 时整个提取运行失败，不写半套知识。
- 人工编辑字段受 `human_locked_fields` 保护；重跑同一来源版本不得静默覆盖已确认知识。
- 原文仍是唯一证据。`processing_runs` 普通错误字段不存完整消息、完整 prompt 或完整模型响应。
- 当前使用 PostgreSQL 队列，不引入 Redis、Kafka、Temporal 或独立 Python 服务。
- DeepSeek 当前官方模型名称使用 `deepseek-v4-flash`/`deepseek-v4-pro`；旧 `deepseek-chat`、`deepseek-reasoner` 已于 2026-07-24 退役，禁止写入默认配置。

---

## Repository Map

### Files to create

- `supabase/migrations/202608110004_processing_queue.sql`
- `supabase/migrations/202608110005_persist_knowledge_extraction.sql`
- `supabase/migrations/202608110006_review_knowledge.sql`
- `supabase/tests/010_processing_queue.test.sql`
- `supabase/tests/011_persist_knowledge_extraction.test.sql`
- `supabase/tests/012_review_knowledge.test.sql`
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/vitest.config.ts`
- `apps/worker/.env.example`
- `apps/worker/src/config.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/worker-loop.ts`
- `apps/worker/src/worker-loop.test.ts`
- `apps/worker/src/queue/processing-queue.ts`
- `apps/worker/src/queue/processing-queue.test.ts`
- `apps/worker/src/repositories/source-repository.ts`
- `apps/worker/src/repositories/knowledge-repository.ts`
- `apps/worker/src/processors/normalize-source.ts`
- `apps/worker/src/processors/normalize-source.test.ts`
- `apps/worker/src/processors/build-source-blocks.ts`
- `apps/worker/src/processors/build-source-blocks.test.ts`
- `apps/worker/src/processors/extract-knowledge.ts`
- `apps/worker/src/processors/extract-knowledge.test.ts`
- `apps/worker/src/providers/text-model-provider.ts`
- `apps/worker/src/providers/deepseek-text-model.ts`
- `apps/worker/src/providers/deepseek-text-model.test.ts`
- `apps/worker/src/prompts/knowledge-extraction-v1.ts`
- `apps/web/src/features/knowledge/server/list-review-tasks.ts`
- `apps/web/src/features/knowledge/server/list-review-tasks.test.ts`
- `apps/web/src/features/knowledge/server/get-knowledge-review.ts`
- `apps/web/src/features/knowledge/server/get-knowledge-review.test.ts`
- `apps/web/src/features/knowledge/server/review-knowledge.ts`
- `apps/web/src/features/knowledge/server/review-knowledge.test.ts`
- `apps/web/src/features/knowledge/components/review-form.tsx`
- `apps/web/src/features/knowledge/components/review-form.test.tsx`
- `apps/web/src/app/(app)/knowledge/page.tsx`
- `apps/web/src/app/(app)/knowledge/review/[knowledgeItemId]/page.tsx`
- `docs/runbooks/knowledge-worker-local.md`

### Files to modify

- `package.json`
- `pnpm-lock.yaml`
- `apps/web/src/lib/supabase/database.types.ts`
- `apps/web/src/components/app-sidebar.tsx`
- `apps/web/src/components/app-sidebar.test.tsx`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/app/(app)/captures/[sourceItemId]/page.tsx`
- `packages/contracts/src/knowledge.ts`
- `packages/contracts/src/knowledge.test.ts`
- `docs/runbooks/milestone-a-local.md`

### First vertical slice

```text
source_versions (ChatGPT)
  -> normalize_source job
  -> build_source_blocks job
  -> source_blocks (one stable block per message)
  -> extract_knowledge job
  -> DeepSeek JSON + Zod validation
  -> knowledge_items/versions/citations/review_tasks
  -> /knowledge review UI
  -> confirmed knowledge with approved citation
```

---

### Task 1: Turn the existing processing-job stub into a leased PostgreSQL queue

**Files:**

- Create: `supabase/migrations/202608110004_processing_queue.sql`
- Create: `supabase/tests/010_processing_queue.test.sql`

- [ ] **Step 1: Write failing pgTAP queue-concurrency tests**

Create queued jobs for two owners/spaces and assert:

- `claim_processing_jobs(worker-a, 2, 60)` atomically claims at most two due jobs ordered by `next_attempt_at, created_at`;
- a second worker cannot claim an unexpired lease;
- after lease expiry, a job becomes claimable and gets a new run;
- attempt count increments once per claim, not once per poll;
- completing a job closes the matching run and cannot close another worker’s lease;
- retryable failure returns job to `queued` with future `next_attempt_at`;
- fifth/max failure marks it `failed` and creates no further claim;
- owner/space/source-version mismatch is rejected;
- execute privileges are service-role only.

Run:

```bash
pnpm supabase test db supabase/tests/010_processing_queue.test.sql
```

Expected: FAIL because queue RPCs and run rows do not exist.

- [ ] **Step 2: Extend `processing_jobs`**

Add:

- `max_attempts integer not null default 5 check (max_attempts between 1 and 20)`
- `locked_by text`
- `lease_expires_at timestamptz`
- `last_started_at timestamptz`
- `completed_at timestamptz`

Add a state-consistency check:

- `processing` requires `locked_by`, `lease_expires_at`, `last_started_at`;
- `queued/failed/paused/complete` has no active lease;
- `complete` requires `completed_at`;
- `queued` may have a future `next_attempt_at`.

- [ ] **Step 3: Create `processing_runs`**

Exact columns:

- `id uuid primary key default gen_random_uuid()`
- `processing_job_id uuid not null`
- `owner_user_id uuid not null`
- `space_id uuid not null`
- `attempt integer not null`
- `processor_type text not null`
- nullable `provider`, `model`, `prompt_or_pipeline_version`, `input_scope jsonb`
- `status processing_state not null default 'processing'`
- `started_at`, nullable `finished_at`
- nullable `usage_json jsonb`, `estimated_cost numeric(12,6)`, `result_summary text`, `error_code text`, `error_detail text`
- unique `(processing_job_id, attempt)` and `(id, processing_job_id, owner_user_id, space_id)`

Limit `result_summary`/`error_detail` to 2,000 chars. Explicitly forbid raw source text columns.

- [ ] **Step 4: Implement claim/complete/fail RPCs**

Create service-role-only functions with fixed empty search paths:

```text
claim_processing_jobs(p_worker_id text, p_limit integer, p_lease_seconds integer)
complete_processing_job(p_job_id uuid, p_run_id uuid, p_worker_id text, p_usage_json jsonb, p_result_summary text)
fail_processing_job(p_job_id uuid, p_run_id uuid, p_worker_id text, p_error_code text, p_error_detail text, p_retryable boolean)
heartbeat_processing_job(p_job_id uuid, p_run_id uuid, p_worker_id text, p_lease_seconds integer)
```

`claim` must use one transaction with `for update skip locked`, update jobs, insert runs and return job + run records. Retry backoff in SQL is deterministic: 30 seconds, 2 minutes, 10 minutes, 1 hour, then failed.

- [ ] **Step 5: Add RLS and indexes**

Users may select their own processing runs for status display; users cannot write queue/run rows. Add:

- `processing_jobs_claim_idx (status, next_attempt_at, created_at) where status = 'queued'`
- `processing_jobs_lease_idx (lease_expires_at) where status = 'processing'`
- `processing_runs_job_attempt_idx`
- `processing_runs_space_started_idx`

- [ ] **Step 6: Run and commit**

```bash
pnpm supabase test db supabase/tests/010_processing_queue.test.sql
pnpm supabase db lint --local --level warning
git add supabase/migrations/202608110004_processing_queue.sql supabase/tests/010_processing_queue.test.sql
git commit -m "feat: add leased postgres processing queue"
```

---

### Task 2: Scaffold the TypeScript Worker and configuration boundary

**Files:**

- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/.env.example`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/worker-loop.ts`
- Create: `apps/worker/src/worker-loop.test.ts`
- Create: `apps/worker/src/main.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing configuration tests**

`loadWorkerConfig(env)` must validate:

- `SUPABASE_URL` is an HTTP(S) URL;
- `SUPABASE_SERVICE_ROLE_KEY` and `DEEPSEEK_API_KEY` are non-empty server secrets;
- default `DEEPSEEK_BASE_URL = https://api.deepseek.com`;
- default `DEEPSEEK_MODEL = deepseek-v4-flash`;
- `WORKER_ID`, poll interval, lease seconds, batch size and shutdown timeout have bounded values;
- no env name starts with `NEXT_PUBLIC_` or `WXT_PUBLIC_`.

- [ ] **Step 2: Add the workspace package**

Use package name `@recall/worker`, `type: module`, and scripts:

```json
{
  "dev": "tsx watch src/main.ts",
  "start": "tsx src/main.ts",
  "build": "tsc --noEmit",
  "lint": "tsc --noEmit",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

Dependencies: `@recall/contracts`, `@recall/domain`, `@supabase/supabase-js`, `zod`. Dev dependencies: `tsx`, `typescript`, `vitest`, `@types/node`.

- [ ] **Step 3: Implement a dependency-injected worker loop**

`runWorkerLoop` receives a queue port, processor registry, clock, sleep function and `AbortSignal`. It claims a bounded batch, dispatches by exact job type, completes or fails through the queue port, and stops cleanly on `SIGINT`/`SIGTERM` without claiming new jobs.

Tests must use a fake clock/sleep; never add real waiting to tests.

- [ ] **Step 4: Add root convenience scripts**

```json
{
  "scripts": {
    "worker:dev": "pnpm --filter @recall/worker dev",
    "worker:start": "pnpm --filter @recall/worker start"
  }
}
```

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @recall/worker test
pnpm --filter @recall/worker typecheck
git add apps/worker package.json pnpm-lock.yaml
git commit -m "feat: scaffold knowledge processing worker"
```

---

### Task 3: Implement the queue repository and processing telemetry

**Files:**

- Create: `apps/worker/src/queue/processing-queue.ts`
- Create: `apps/worker/src/queue/processing-queue.test.ts`
- Modify: `apps/worker/src/main.ts`

- [ ] **Step 1: Write failing adapter tests**

Mock the Supabase client and test exact RPC argument names, Zod parsing of returned jobs/runs, empty-claim behavior, failure redaction and heartbeat ownership errors.

The adapter error must retain safe fields (`code`, HTTP status, RPC name) and drop query text, bearer token and source content.

- [ ] **Step 2: Implement `PostgresProcessingQueue`**

Expose:

```ts
interface ProcessingQueue {
  claim(limit: number): Promise<ClaimedJob[]>;
  heartbeat(job: ClaimedJob): Promise<void>;
  complete(job: ClaimedJob, result: ProcessingResult): Promise<void>;
  fail(job: ClaimedJob, failure: ProcessingFailure): Promise<void>;
}
```

Use the four Stage 1B RPCs only. Do not update queue rows with free-form Supabase `.update()` calls from processors.

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @recall/worker test -- processing-queue.test.ts worker-loop.test.ts
pnpm --filter @recall/worker typecheck
git add apps/worker/src/queue apps/worker/src/main.ts
git commit -m "feat: connect worker to postgres queue"
```

---

### Task 4: Normalize ChatGPT messages and build stable evidence blocks

**Files:**

- Create: `apps/worker/src/repositories/source-repository.ts`
- Create: `apps/worker/src/processors/normalize-source.ts`
- Create: `apps/worker/src/processors/normalize-source.test.ts`
- Create: `apps/worker/src/processors/build-source-blocks.ts`
- Create: `apps/worker/src/processors/build-source-blocks.test.ts`
- Modify: `apps/worker/src/main.ts`

- [ ] **Step 1: Write failing normalization tests**

Fixtures must cover:

- ordered ChatGPT `user/assistant/system/tool` messages;
- empty raw text with messages present;
- duplicate whitespace and CRLF normalization without altering code-body text;
- a partial capture with missing image note;
- rerunning the same version producing identical locator keys and hashes.

- [ ] **Step 2: Implement the source repository**

Load one claimed source version with its item, ordered messages and attachments using all three predicates: `owner_user_id`, `space_id`, `source_version_id`. Reject missing ancestry rather than falling back to an owner-only query.

- [ ] **Step 3: Implement deterministic normalization**

For Stage 1B, normalization output is an in-memory `NormalizedSourceV1`:

```ts
type NormalizedSourceV1 = {
  schemaVersion: "normalized-source.v1";
  sourceVersionId: string;
  title: string;
  messages: Array<{
    sourceMessageId: string;
    externalMessageId: string;
    ordinal: number;
    role: "user" | "assistant" | "system" | "tool";
    body: string;
  }>;
  missingElements: string[];
};
```

No LLM is called. Enqueue `build_source_blocks` idempotently for the same version after success.

- [ ] **Step 4: Implement one stable block per ChatGPT message**

Each message becomes:

- `blockType = message`
- `ordinal = message.ordinal`
- `locatorKey = message:<externalMessageId>/body`
- locator JSON containing message ID, external ID, role and ordinal
- `textContent = body`
- `contentHash = sha256("message\0" + role + "\0" + body)`

If a message body contains fenced code, keep it in the message block for the first slice; code sub-block splitting is deferred to Stage 2. Use an upsert keyed by source version + locator + hash and delete stale service-generated blocks for that same source version in the same transaction. Enqueue `extract_knowledge` only after block persistence succeeds.

- [ ] **Step 5: Add an atomic block-replacement RPC**

Add a narrowly scoped service-role RPC to `202608110005_persist_knowledge_extraction.sql` named `replace_source_blocks_and_enqueue_extract`. It validates the active claimed job/run, replaces blocks for that source version, and enqueues `extract_knowledge` in one transaction. It must derive owner/space/source-version ancestry from the claimed job rather than trusting duplicate values in the block payload.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @recall/worker test -- normalize-source.test.ts build-source-blocks.test.ts
pnpm --filter @recall/worker typecheck
git add apps/worker/src/repositories/source-repository.ts apps/worker/src/processors apps/worker/src/main.ts supabase/migrations/202608110005_persist_knowledge_extraction.sql
git commit -m "feat: build stable chatgpt evidence blocks"
```

---

### Task 5: Implement the replaceable DeepSeek text-model provider

**Files:**

- Create: `apps/worker/src/providers/text-model-provider.ts`
- Create: `apps/worker/src/providers/deepseek-text-model.ts`
- Create: `apps/worker/src/providers/deepseek-text-model.test.ts`
- Create: `apps/worker/src/prompts/knowledge-extraction-v1.ts`
- Modify: `packages/contracts/src/knowledge.ts`
- Modify: `packages/contracts/src/knowledge.test.ts`

- [ ] **Step 1: Freeze the provider interface**

```ts
export interface TextModelProvider {
  generateStructured<T>(request: {
    operation: "extract_knowledge";
    model: string;
    schemaName: "knowledge-extraction.v1";
    systemPrompt: string;
    userPayload: unknown;
    parse(value: unknown): T;
  }): Promise<{
    value: T;
    provider: string;
    model: string;
    usage: { inputTokens: number | null; outputTokens: number | null };
  }>;
}
```

No processor imports a DeepSeek-specific response type.

- [ ] **Step 2: Write failing HTTP adapter tests**

Using mocked `fetch`, assert:

- POST target is `${baseUrl}/chat/completions`;
- bearer auth exists only in the request header;
- request sets `model`, non-thinking mode for deterministic extraction, bounded `max_tokens`, and `response_format: { type: "json_object" }`;
- the prompt explicitly asks for JSON and includes the v1 example shape;
- non-2xx, timeout, empty content, truncated `finish_reason = length`, invalid JSON and Zod-invalid JSON are typed failures;
- logs/errors do not include API key or full source payload;
- usage fields are recorded when available.

DeepSeek’s official JSON Output guide requires both `response_format` and an explicit JSON instruction, and warns that empty content can occur; implement both requirements: [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) and [Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion).

- [ ] **Step 3: Implement the adapter with native fetch**

Use an `AbortController` timeout. Default to `deepseek-v4-flash`; allow `deepseek-v4-pro` through config. Do not add the OpenAI SDK for this single compatible endpoint. Disable thinking for extraction so the response body contains only the requested JSON; do not persist `reasoning_content`.

- [ ] **Step 4: Freeze prompt v1**

`knowledge-extraction-v1.ts` exports `promptVersion = "knowledge-extraction.2026-08-11.v1"` and a builder. Instruct the model to:

- extract only claims supported by supplied blocks;
- use one of the nine knowledge types;
- produce L0/L1/L2, conditions, limitations and confidence;
- cite one or more exact `locatorKey` values per draft;
- preserve disagreements as separate drafts;
- never invent source locators or mark anything confirmed;
- return 1–12 drafts to prevent unbounded output.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @recall/worker test -- deepseek-text-model.test.ts
pnpm vitest run packages/contracts/src/knowledge.test.ts
pnpm --filter @recall/worker typecheck
git add apps/worker/src/providers apps/worker/src/prompts packages/contracts/src/knowledge.ts packages/contracts/src/knowledge.test.ts
git commit -m "feat: add deepseek structured extraction provider"
```

---

### Task 6: Persist validated drafts, citations and review tasks atomically

**Files:**

- Create or Modify: `supabase/migrations/202608110005_persist_knowledge_extraction.sql`
- Create: `supabase/tests/011_persist_knowledge_extraction.test.sql`
- Create: `apps/worker/src/repositories/knowledge-repository.ts`
- Create: `apps/worker/src/processors/extract-knowledge.ts`
- Create: `apps/worker/src/processors/extract-knowledge.test.ts`
- Modify: `apps/worker/src/main.ts`

- [ ] **Step 1: Write failing database atomicity tests**

Test `persist_knowledge_extraction` with:

- valid v1 drafts producing matching item/version/citation/review rows;
- one invalid locator causing zero rows from the whole payload;
- wrong owner/space/source version causing zero rows;
- duplicate replay for the same source version + prompt version returning the original draft IDs without duplication;
- a reprocess after a user-confirmed item leaving that item/version untouched and creating at most a separate suggestion/review task;
- processor run ancestry recorded on versions.

- [ ] **Step 2: Add extraction identity fields**

Add to `knowledge_items`:

- nullable `source_version_id` for initial AI extraction ancestry;
- nullable `extraction_key`.

Use a unique partial index `(space_id, source_version_id, extraction_key) where extraction_key is not null`. `extraction_key` is SHA-256 of source version + prompt version + stable draft ordinal/title/type, generated by Worker and validated by SQL format.

Add the Stage 1A deferred FK from `knowledge_versions.processor_run_id` to `processing_runs` with owner/space ancestry.

- [ ] **Step 3: Implement one service-role persistence RPC**

`persist_knowledge_extraction(p_job_id, p_run_id, p_worker_id, p_prompt_version, p_payload jsonb)` must:

1. lock and validate the active claimed job/run;
2. validate every citation locator against blocks from the same source version;
3. upsert AI draft identity only when no user-governed state exists;
4. insert immutable version 1 snapshots;
5. insert pending citations and one open `knowledge_draft` review task per draft;
6. enqueue no downstream graph/vector jobs yet;
7. return created/reused knowledge IDs;
8. commit all-or-nothing.

Revoke execute from public/anon/authenticated; grant service role only.

- [ ] **Step 4: Write failing processor tests**

Mock blocks, model and repository. Cover valid extraction, invalid locator, no blocks, provider retryable error, schema error after one repair attempt, and idempotent replay. Ensure no repository write occurs before Zod and locator validation.

- [ ] **Step 5: Implement `extractKnowledge`**

Build a payload containing title, source metadata and an array of `{ locatorKey, role, ordinal, text }`. Apply a deterministic per-request character/token budget; for an oversized conversation, select complete adjacent message windows and record the input scope in `processing_runs`. Do not silently truncate a block mid-sentence.

Allow one repair request only for parse/schema errors; network/rate-limit errors return to queue backoff without a repair prompt.

- [ ] **Step 6: Run and commit**

```bash
pnpm supabase test db supabase/tests/011_persist_knowledge_extraction.test.sql
pnpm --filter @recall/worker test -- extract-knowledge.test.ts
pnpm --filter @recall/worker typecheck
git add supabase/migrations/202608110005_persist_knowledge_extraction.sql supabase/tests/011_persist_knowledge_extraction.test.sql apps/worker/src/repositories/knowledge-repository.ts apps/worker/src/processors/extract-knowledge.ts apps/worker/src/processors/extract-knowledge.test.ts apps/worker/src/main.ts
git commit -m "feat: persist cited knowledge drafts atomically"
```

---

### Task 7: Add user review transactions that protect human edits

**Files:**

- Create: `supabase/migrations/202608110006_review_knowledge.sql`
- Create: `supabase/tests/012_review_knowledge.test.sql`
- Create: `apps/web/src/features/knowledge/server/review-knowledge.ts`
- Create: `apps/web/src/features/knowledge/server/review-knowledge.test.ts`

- [ ] **Step 1: Write failing database lifecycle tests**

Create `review_knowledge_item` tests for:

- confirm with edited title/L0/L1/L2, approved citations and selected locked fields;
- reject with reason;
- concurrent stale `expectedVersion` conflict;
- owner B cannot review owner A item;
- confirm fails if no approved citation unless it is an explicit personal inference opinion;
- each decision appends exactly one immutable knowledge version;
- review task resolves in the same transaction;
- later AI persistence cannot overwrite locked fields or confirmed status.

- [ ] **Step 2: Implement the user-authenticated review RPC**

Signature:

```text
review_knowledge_item(
  p_knowledge_item_id uuid,
  p_expected_version integer,
  p_decision text,
  p_patch jsonb,
  p_approved_citation_ids uuid[],
  p_locked_fields text[],
  p_rejection_reason text
)
```

Derive user from `auth.uid()`; never accept owner ID. Validate membership, lock item, compare version, update citations, append snapshot, update item/status/locked fields and resolve open review task atomically.

- [ ] **Step 3: Implement the Web server wrapper**

Parse `KnowledgeReviewDecisionSchema`, call the RPC through the authenticated server client, map stale-version to a typed `KnowledgeReviewConflict`, and call `revalidatePath` for `/knowledge`, the review page and related capture detail.

Before implementation, read the installed Next.js 16 server-actions/forms/revalidation documentation under `apps/web/node_modules/next/dist/docs/` as required by `apps/web/AGENTS.md`; do not rely on older Next conventions.

- [ ] **Step 4: Run and commit**

```bash
pnpm supabase test db supabase/tests/012_review_knowledge.test.sql
pnpm vitest run apps/web/src/features/knowledge/server/review-knowledge.test.ts
pnpm --filter @recall/web typecheck
git add supabase/migrations/202608110006_review_knowledge.sql supabase/tests/012_review_knowledge.test.sql apps/web/src/features/knowledge/server/review-knowledge.ts apps/web/src/features/knowledge/server/review-knowledge.test.ts
git commit -m "feat: add protected knowledge review transaction"
```

---

### Task 8: Build the concise human-review UI

**Files:**

- Create: `apps/web/src/features/knowledge/server/list-review-tasks.ts`
- Create: `apps/web/src/features/knowledge/server/list-review-tasks.test.ts`
- Create: `apps/web/src/features/knowledge/server/get-knowledge-review.ts`
- Create: `apps/web/src/features/knowledge/server/get-knowledge-review.test.ts`
- Create: `apps/web/src/features/knowledge/components/review-form.tsx`
- Create: `apps/web/src/features/knowledge/components/review-form.test.tsx`
- Create: `apps/web/src/app/(app)/knowledge/page.tsx`
- Create: `apps/web/src/app/(app)/knowledge/review/[knowledgeItemId]/page.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`
- Modify: `apps/web/src/components/app-sidebar.test.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `apps/web/src/app/(app)/captures/[sourceItemId]/page.tsx`

- [ ] **Step 1: Write failing repository tests**

`listReviewTasks(ownerUserId, cursor, limit)` returns open tasks ordered by priority then created time. `getKnowledgeReview` returns:

- editable knowledge fields;
- confidence, status and current version;
- citations with excerpt, locator, role/message ordinal and source item/version IDs;
- links to the exact capture evidence;
- human locked fields;
- no other owner’s data.

- [ ] **Step 2: Write failing form tests**

Test:

- L0/L1/L2 and conditions/limitations are editable;
- citations start pending and can be approved/rejected individually;
- confirm is disabled until evidence rule passes;
- confirm submits `expectedVersion` and selected locked fields;
- reject requires a reason;
- stale-version response shows `这条知识已被更新，请刷新后再审核` and preserves the user’s typed text locally;
- no API/model key or raw processing payload appears in rendered HTML.

- [ ] **Step 3: Implement pages and navigation**

Update the authenticated layout to load the open review-task count for the current user/space and pass it to `AppSidebar`. Add sidebar link `知识审核 <open count>` between captures and exceptions. `/knowledge` initially means “知识收件箱”, not a graph. Each card shows type, L0, source title, confidence and created time. Detail page uses three sections:

1. 可编辑知识（L0/L1/L2、条件、限制）；
2. 来源证据（引用摘录 + 跳回原文）；
3. 决策（确认并锁定、拒绝）。

Use server components for reads and the smallest client component for interactive form state.

- [ ] **Step 4: Link capture details to derived knowledge**

On each source version display its evidence block count, processing run status and derived draft count. This is read-only provenance; do not duplicate the review form in capture details.

- [ ] **Step 5: Run and commit**

```bash
pnpm vitest run apps/web/src/features/knowledge apps/web/src/components/app-sidebar.test.tsx
pnpm --filter @recall/web lint
pnpm --filter @recall/web typecheck
pnpm --filter @recall/web build
git add apps/web/src/features/knowledge apps/web/src/app/'(app)'/knowledge apps/web/src/components/app-sidebar.tsx apps/web/src/components/app-sidebar.test.tsx apps/web/src/app/'(app)'/layout.tsx apps/web/src/app/'(app)'/captures/'[sourceItemId]'/page.tsx
git commit -m "feat: add cited knowledge review inbox"
```

---

### Task 9: Regenerate types and run one real ChatGPT vertical-slice acceptance

**Files:**

- Modify: `apps/web/src/lib/supabase/database.types.ts`
- Create: `docs/runbooks/knowledge-worker-local.md`
- Modify: `docs/runbooks/milestone-a-local.md`

- [ ] **Step 1: Regenerate Supabase types**

```bash
pnpm supabase gen types typescript --local > apps/web/src/lib/supabase/database.types.ts
```

Verify generated types include queue, persistence and review RPCs. If Worker needs generated types, move the canonical generated file into a new shared package in a separate commit; do not copy divergent generated files into Web and Worker.

- [ ] **Step 2: Write the local worker runbook**

Document:

- setting secrets only in ignored local env;
- starting Supabase, Web and Worker as separate processes;
- rotating/revoking a DeepSeek key;
- pausing Worker without losing jobs;
- identifying queued/processing/failed jobs without exposing source content;
- retrying a failed extraction by enqueueing `reprocess_version`, not editing knowledge rows;
- cost/usage inspection from `processing_runs`;
- backup before schema changes.

- [ ] **Step 3: Run automated gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm supabase test db
git diff --check
```

- [ ] **Step 4: Run the real vertical slice**

Use one already-saved, non-sensitive ChatGPT test conversation and verify:

1. existing `normalize_source` job is claimed once;
2. ordered message evidence blocks match the saved source version;
3. one DeepSeek extraction run records provider/model/prompt/usage but not full original content;
4. 1–12 knowledge drafts appear in `/knowledge`;
5. every draft has a working citation to the exact source message;
6. editing and confirming one draft creates version 2, approves citations, locks selected fields and resolves the task;
7. rejecting another draft retains an audit version and removes it from open inbox;
8. reprocessing the source does not overwrite the confirmed item;
9. stopping/restarting Worker does not duplicate drafts or runs beyond the legitimate retry attempt.

- [ ] **Step 5: Verify multi-user opening without enabling sharing**

In a disposable test account, ensure a second private space receives its own jobs and cannot list or infer the first user’s blocks, drafts, citations, runs or review counts. Confirm there is still no shared-space UI.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/supabase/database.types.ts docs/runbooks/knowledge-worker-local.md docs/runbooks/milestone-a-local.md
git commit -m "docs: verify first knowledge processing vertical slice"
```

---

## Stage 1B Exit Criteria

- A newly finalized ChatGPT source version proceeds through all three job types without manual database edits.
- Queue claim, lease, retry, terminal failure and restart behavior are deterministic and tested.
- DeepSeek uses the current official API/model names, JSON mode and server-only key handling.
- Every persisted AI draft has a valid source-block citation and a visible review task.
- The user can edit, approve citations, confirm/lock or reject; every action creates an immutable version.
- Reprocessing cannot overwrite confirmed or human-locked content.
- Processing errors are visible without leaking full private source content.
- Two private users remain isolated; shared-space code paths are not exposed.
- Existing capture, receipt, Outbox and Milestone A regressions remain green.

After this exit, Stage 2 can add platform adapters and OCR one source at a time. Retrieval, automatic web fallback, knowledge graph and learning map remain later stages so they are built on confirmed knowledge rather than unreviewed model output.
