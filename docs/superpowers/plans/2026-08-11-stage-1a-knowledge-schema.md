# Stage 1A Knowledge Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有可靠采集数据之后增加私人空间、稳定证据块、知识草稿/版本/引用和审核任务模型，并把既有真实数据无损回填到当前用户的默认私人空间。

**Architecture:** PostgreSQL 继续是唯一业务事实来源。`source_items` 是原始资料入口，`source_versions` 是不可变证据快照，`source_blocks` 是可稳定引用的细粒度证据，`knowledge_items` 是可审核知识，`knowledge_versions` 保存每次 AI/人工变化，`citations` 连接知识字段与证据块。所有空间 ID 均由服务端从用户身份解析，客户端不能提交任意 `space_id`。

**Tech Stack:** Supabase PostgreSQL、RLS、pgTAP、Next.js 16 Server Components、TypeScript 5.9、Zod 4、Vitest 4、现有 `@recall/contracts` 和 `@recall/domain` workspace。

## Global Constraints

- 必须先完成 Stage 0 备份并记录通过结果；迁移不得以 `db reset` 作为当前真实数据环境的验证方式。
- 所有新增业务表必须有 `owner_user_id`；空间所属表同时有 `space_id`，并用复合外键约束二者一致。
- 当前只创建 `private` 空间和唯一 owner 成员；`shared/editor/viewer` 仅保留数据库枚举与约束，不提供 UI 或 API。
- 现有客户端载荷、扩展配对、幂等键、ChatGPT 会话增量合并和 durable receipt 契约保持兼容。
- 扩展和 Web 采集 API 不接受 `spaceId`。默认私人空间由服务端/数据库根据 `owner_user_id` 解析。
- AI 草稿不能直接成为 `confirmed`；正式知识至少有一个有效引用，个人无证据观点必须显式标记。
- Stage 1A 不调用 DeepSeek、不运行 Worker、不生成真实知识草稿；这些属于 Stage 1B。
- `topics`、`topic_memberships`、`knowledge_edges`、`embeddings`、`external_index_records` 在阶段 3–4 按使用闭环增加，本阶段不建空表；这是明确延期，不是遗漏。

---

## Repository Map

### Files to create

- `supabase/migrations/202608110001_private_spaces.sql`
- `supabase/migrations/202608110002_evidence_and_knowledge.sql`
- `supabase/migrations/202608110003_finalize_into_private_space.sql`
- `supabase/tests/007_private_spaces.test.sql`
- `supabase/tests/008_evidence_knowledge_rls.test.sql`
- `supabase/tests/009_knowledge_invariants.test.sql`
- `packages/contracts/src/knowledge.ts`
- `packages/contracts/src/knowledge.test.ts`
- `packages/domain/src/knowledge/state.ts`
- `packages/domain/src/knowledge/state.test.ts`
- `packages/domain/src/knowledge/index.ts`
- `packages/domain/src/index.ts`
- `apps/web/src/features/spaces/server/default-space.ts`
- `apps/web/src/features/spaces/server/default-space.test.ts`

### Files to modify

- `packages/contracts/src/index.ts`
- `packages/domain/package.json`
- `packages/domain/src/capture/index.ts` or package export map, as described in Task 4
- `apps/web/src/lib/supabase/database.types.ts`
- `apps/web/src/features/capture/server/finalize-capture.ts`
- `apps/web/src/features/capture/server/finalize-capture.test.ts`
- `apps/web/src/app/(app)/layout.tsx`
- `docs/runbooks/milestone-a-local.md`

### Data ownership map

| Object | Owner column | Space column | Write authority |
| --- | --- | --- | --- |
| `spaces` | `owner_user_id` | self (`id`) | service role only in Stage 1 |
| `space_members` | through space + `user_id` | `space_id` | service role only |
| `source_items` | existing | new `space_id` | existing finalize RPC |
| `processing_jobs` | existing | new `space_id` | finalize RPC / Worker RPC |
| `source_blocks` | required | required | service-role Worker |
| `source_asset_links` | required | required | service-role Worker |
| `knowledge_items` | required | required | knowledge service / Worker draft writer |
| `knowledge_versions` | required | required | knowledge service only |
| `citations` | required | required | knowledge service / Worker draft writer |
| `review_tasks` | required | required | knowledge service / Worker |

---

### Task 1: Create private spaces and backfill existing source data

**Files:**

- Create: `supabase/migrations/202608110001_private_spaces.sql`
- Create: `supabase/tests/007_private_spaces.test.sql`

- [ ] **Step 1: Write failing pgTAP tests for the migration contract**

The test must create two `auth.users`, source data for both, and assert:

- exactly one `private` space per owner;
- exactly one owner membership for each private space;
- existing `source_items.space_id` is non-null and belongs to the same `owner_user_id`;
- existing `processing_jobs.space_id` is non-null and matches its source version’s item;
- owner A cannot select owner B’s space, membership, item or job under authenticated RLS;
- inserting a mismatched owner/space pair fails at the foreign key, even as service role;
- authenticated users cannot create a `shared` space in Stage 1.

Run against a disposable test database:

```bash
pnpm supabase test db supabase/tests/007_private_spaces.test.sql
```

Expected: FAIL because the tables/columns do not exist.

- [ ] **Step 2: Add exact enums and space tables**

Create:

```sql
create type public.space_type as enum ('private', 'shared');
create type public.space_member_role as enum ('owner', 'editor', 'viewer');
```

`spaces` columns:

- `id uuid primary key default gen_random_uuid()`
- `type public.space_type not null default 'private'`
- `name text not null`
- `owner_user_id uuid not null references auth.users(id) on delete cascade`
- `created_by_user_id uuid not null references auth.users(id)`
- `created_at timestamptz not null default now()`
- unique `(id, owner_user_id)`
- partial unique index on `(owner_user_id) where type = 'private'`

`space_members` columns:

- `space_id uuid not null`
- `space_owner_user_id uuid not null`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `role public.space_member_role not null`
- `created_at timestamptz not null default now()`
- primary key `(space_id, user_id)`
- composite FK `(space_id, space_owner_user_id) -> spaces(id, owner_user_id)`

The denormalized `space_owner_user_id` is intentional: it makes cross-owner mismatch a database error, not an application convention.

- [ ] **Step 3: Implement an idempotent default-space function**

Add `public.ensure_private_space(p_owner_user_id uuid) returns uuid` as `security definer`, fixed `search_path = ''`, service-role execute only. It must:

1. validate that `auth.users.id` exists;
2. insert one private space with name `我的知识库`, `on conflict` against the partial uniqueness rule;
3. insert owner membership idempotently;
4. return the private space ID;
5. never accept a space ID from a caller.

- [ ] **Step 4: Backfill in one migration transaction**

Gather distinct owners from all current owner-bearing tables, call `ensure_private_space`, add nullable `space_id` to `source_items` and `processing_jobs`, backfill by owner and source-version ancestry, then set both columns `not null`.

Add composite FKs:

```text
source_items(space_id, owner_user_id) -> spaces(id, owner_user_id)
processing_jobs(space_id, owner_user_id) -> spaces(id, owner_user_id)
```

Replace the existing processing job constraint by migrating `prepare_for_milestone_b` to `normalize_source` and accepting exactly: `normalize_source`, `parse_documents`, `ocr_assets`, `build_source_blocks`, `extract_knowledge`, `suggest_topics`, `suggest_relations`, `generate_embeddings`, `update_search_index`, `remove_from_indexes`, `reprocess_version`. Add indexes:

- `source_items_space_updated_idx (space_id, updated_at desc)`
- `processing_jobs_space_status_next_idx (space_id, status, next_attempt_at, created_at)`

- [ ] **Step 5: Add RLS and grants**

Authenticated select on a space must require a membership row for `auth.uid()`. For private spaces in this phase, only the owner membership exists. Revoke direct authenticated insert/update/delete on spaces and memberships. Preserve service-role access for server setup.

- [ ] **Step 6: Run pgTAP and schema checks**

```bash
pnpm supabase test db supabase/tests/007_private_spaces.test.sql
pnpm supabase db lint --local --level warning
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202608110001_private_spaces.sql supabase/tests/007_private_spaces.test.sql
git commit -m "feat: add isolated private knowledge spaces"
```

---

### Task 2: Add stable evidence blocks and asset links

**Files:**

- Create: `supabase/migrations/202608110002_evidence_and_knowledge.sql`
- Create: `supabase/tests/008_evidence_knowledge_rls.test.sql`

- [ ] **Step 1: Write failing ownership and citation-address tests**

The test fixture must include two users, two spaces, one source version, one source message and one attachment per user. Assert:

- owner can read only their evidence blocks and asset links;
- service role can insert a block only when owner, space, source version and optional message all share ancestry;
- `ordinal` is unique per source version;
- `(source_version_id, locator_key, content_hash)` is unique, making rebuild idempotent;
- attachment links cannot connect an owner-A attachment to owner-B message/block;
- `text_content` and locator limits are enforced.

Expected initial result: FAIL.

- [ ] **Step 2: Add evidence enums and tables**

Create `source_block_type` with:

```text
heading, paragraph, list_item, table, code, message, ocr_region,
repository_file, repository_excerpt, metadata
```

Create `source_asset_relation` with:

```text
inline_image, screenshot, attachment, ocr_source, supplemental_evidence
```

`source_blocks` exact columns:

- IDs/ownership: `id`, `owner_user_id`, `space_id`, `source_item_id`, `source_version_id`, nullable `source_message_id`
- identity: `block_type`, `ordinal`, `locator_key`, `locator_json jsonb`, `content_hash char(64)`
- content: `text_content text`, nullable `language`, nullable `metadata_json jsonb`
- timestamps: `created_at`, `updated_at`

First add unique ancestry keys `source_items(id, owner_user_id, space_id)`, `source_messages(id, source_version_id, source_item_id, owner_user_id)` and `source_attachments(id, source_version_id, owner_user_id)`. Then add composite foreign keys from a block to its item `(source_item_id, owner_user_id, space_id)`, version `(source_version_id, source_item_id, owner_user_id)` and optional message `(source_message_id, source_version_id, source_item_id, owner_user_id)`. Set `text_content` maximum to 1 MiB and `locator_json`/`metadata_json` to 64 KiB each. `locator_key` is a deterministic string produced by the normalizer, for example `message:4/body` or `attachment:<id>/ocr:2`.

`source_asset_links` exact columns:

- `id`, `owner_user_id`, `space_id`, `source_attachment_id`
- nullable `source_message_id`, nullable `source_block_id`
- `relation_type`, `created_at`

Require at least one of message/block, and prevent duplicate relation tuples with `nulls not distinct` uniqueness.

- [ ] **Step 3: Add service-write and owner-read RLS**

Authenticated users receive select-only policies constrained by both `owner_user_id = auth.uid()` and current membership. Direct authenticated insert/update/delete is revoked. Worker uses service role, but FKs still enforce ancestry.

- [ ] **Step 4: Run focused database tests**

```bash
pnpm supabase test db supabase/tests/008_evidence_knowledge_rls.test.sql
```

Expected: PASS.

---

### Task 3: Add knowledge, version, citation and review-task invariants

**Files:**

- Modify: `supabase/migrations/202608110002_evidence_and_knowledge.sql`
- Create: `supabase/tests/009_knowledge_invariants.test.sql`

- [ ] **Step 1: Write failing lifecycle tests**

Cover:

- valid AI draft + version + citation + review task inserts atomically;
- `confirmed` knowledge without an approved citation fails;
- an evidence-free personal viewpoint can be confirmed only when `knowledge_type = 'opinion'` and `evidence_mode = 'personal_inference'`;
- `human_locked_fields` contains only editable field names and has no duplicates;
- confidence is within `[0,1]`;
- knowledge versions are strictly numbered and immutable;
- cross-space citations fail;
- an owner cannot view another owner’s knowledge/review task;
- rejected knowledge cannot have an open review task;
- direct AI update cannot overwrite a locked field through the service RPC added later.

- [ ] **Step 2: Create exact enums**

Use stable English database values while the UI displays Chinese:

```text
knowledge_type: concept, principle, method, scenario, case, fact, opinion, question, conclusion
knowledge_status: ai_draft, pending_review, confirmed, rejected, archived, needs_review
knowledge_evidence_mode: cited, personal_inference
knowledge_change_origin: ai, user, system
citation_origin: ai, user
citation_review_status: pending, approved, rejected
review_task_type: knowledge_draft, low_confidence, sensitive_content, conflict, stale_knowledge
review_task_status: open, completed, dismissed
```

- [ ] **Step 3: Create `knowledge_items` and immutable `knowledge_versions`**

`knowledge_items` columns:

- ownership: `id`, `owner_user_id`, `space_id`, `created_by_user_id`
- identity/content: `knowledge_type`, `title`, `l0_summary`, `l1_content`, `l2_content`
- arrays: `conditions text[]`, `limitations text[]`, `human_locked_fields text[]`
- governance: `confidence numeric(4,3)`, `status`, `evidence_mode`, `freshness_status text`, nullable `review_after`
- revision: `current_version integer not null default 1`
- timestamps: `created_at`, `updated_at`

`knowledge_versions` columns:

- `id`, `owner_user_id`, `space_id`, `knowledge_item_id`, `version`
- `snapshot_json jsonb`
- `change_origin`, nullable `changed_by_user_id`
- `processor_run_id` nullable until Stage 1B adds the FK
- `created_at`

Use a trigger or revoke to prevent update/delete of `knowledge_versions`. Limit title to 500 chars, L0 to 1,000 chars, L1/L2 to 1 MiB each, and each conditions/limitations entry to 1,000 chars.

- [ ] **Step 4: Create citations and review tasks**

`citations` columns:

- `id`, `owner_user_id`, `space_id`, `knowledge_item_id`, `source_block_id`
- `claim_path` using allowed values `l0_summary`, `l1_content`, `l2_content`, `conditions`, `limitations`
- `quote_excerpt` max 2,000 chars
- `origin_type`, `review_status`, `created_at`, `updated_at`

`review_tasks` columns:

- `id`, `owner_user_id`, `space_id`, nullable `knowledge_item_id`
- `task_type`, `status`, `priority` integer 0–100
- `reason`, `created_at`, `updated_at`, nullable `resolved_at`, nullable `resolved_by_user_id`

Create at most one open review task per `(knowledge_item_id, task_type)` using a partial unique index.

- [ ] **Step 5: Add a database constraint trigger for confirmation**

Use a deferred constraint trigger so a transaction may update the item and its citation together. At transaction end, `confirmed` requires either:

- at least one `citations.review_status = 'approved'` in the same owner/space; or
- `knowledge_type = 'opinion'` and `evidence_mode = 'personal_inference'`.

No application-only check is sufficient.

- [ ] **Step 6: Add RLS and indexes**

Add owner/member select policies and indexes:

- `knowledge_items_space_status_updated_idx`
- `knowledge_items_space_type_updated_idx`
- `knowledge_versions_item_version_idx`
- `citations_knowledge_item_idx`
- `citations_source_block_idx`
- `review_tasks_space_status_priority_idx`

- [ ] **Step 7: Run database tests and commit Tasks 2–3**

```bash
pnpm supabase test db supabase/tests/008_evidence_knowledge_rls.test.sql
pnpm supabase test db supabase/tests/009_knowledge_invariants.test.sql
pnpm supabase db lint --local --level warning
git add supabase/migrations/202608110002_evidence_and_knowledge.sql supabase/tests/008_evidence_knowledge_rls.test.sql supabase/tests/009_knowledge_invariants.test.sql
git commit -m "feat: add evidence and governed knowledge schema"
```

---

### Task 4: Define shared TypeScript contracts and pure lifecycle rules

**Files:**

- Create: `packages/contracts/src/knowledge.ts`
- Create: `packages/contracts/src/knowledge.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/knowledge/state.ts`
- Create: `packages/domain/src/knowledge/state.test.ts`
- Create: `packages/domain/src/knowledge/index.ts`
- Create: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`

- [ ] **Step 1: Write failing contract tests**

Define and test Zod schemas:

- `KnowledgeTypeSchema`
- `KnowledgeStatusSchema`
- `KnowledgeDraftSchema`
- `KnowledgeCitationDraftSchema`
- `KnowledgeExtractionResultSchema`
- `KnowledgeReviewDecisionSchema`

`KnowledgeExtractionResultSchema` must require `schemaVersion: "knowledge-extraction.v1"`, `promptVersion`, source-version ID, knowledge drafts and citations addressed by deterministic block locator. Unknown keys are rejected.

- [ ] **Step 2: Implement contracts without database types leaking into clients**

Use camelCase API names and explicit enum mappings. Do not export Supabase generated row types as public contracts. Limit array lengths and text sizes consistently with SQL.

- [ ] **Step 3: Write failing domain state tests**

Test pure functions:

```ts
canTransitionKnowledge(from, to, actor)
applyKnowledgePatch(current, patch, lockedFields, origin)
nextKnowledgeVersion(currentVersion)
```

Required behavior:

- AI can create/update `ai_draft` and propose `pending_review` only.
- only a user action can confirm/reject.
- AI patches silently drop no fields; attempting to change a locked field returns a typed conflict.
- archived can be restored only to `needs_review`, not directly to confirmed.

- [ ] **Step 4: Implement and export the domain module**

Create `packages/domain/src/index.ts` that exports both `./capture/index` and `./knowledge/index`, then change the package `"."` export from `./src/capture/index.ts` to `./src/index.ts`. Existing `@recall/domain` imports remain valid, and there is one canonical public path.

- [ ] **Step 5: Run package tests and commit**

```bash
pnpm vitest run packages/contracts/src/knowledge.test.ts packages/domain/src/knowledge/state.test.ts
pnpm --filter @recall/contracts typecheck
pnpm --filter @recall/domain typecheck
git add packages/contracts packages/domain
git commit -m "feat: define knowledge lifecycle contracts"
```

---

### Task 5: Route every new capture into the server-resolved private space

**Files:**

- Create: `supabase/migrations/202608110003_finalize_into_private_space.sql`
- Modify: `supabase/tests/003_finalize_capture.test.sql`
- Create: `apps/web/src/features/spaces/server/default-space.ts`
- Create: `apps/web/src/features/spaces/server/default-space.test.ts`
- Modify: `apps/web/src/features/capture/server/finalize-capture.ts`
- Modify: `apps/web/src/features/capture/server/finalize-capture.test.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`

- [ ] **Step 1: Add failing finalize/backfill tests**

Assert that an unchanged existing capture request:

- causes `ensure_private_space(ownerUserId)` to resolve a space;
- creates/updates `source_items.space_id` without accepting a client `spaceId`;
- creates `processing_jobs(space_id, job_type = 'normalize_source')`;
- returns the unchanged `CaptureReceipt` shape;
- repeated idempotent finalization reuses the same source version and job;
- owner A cannot force the capture into owner B’s space.

- [ ] **Step 2: Replace `finalize_capture` without changing its public signature**

In migration `202608110003`, `create or replace` the existing RPC with the same nine arguments. Resolve `v_space_id := public.ensure_private_space(p_owner_user_id)` inside the function. Include `space_id` in every `source_items`/`processing_jobs` insert and owner/space predicate. Change the job type lookup and insert from `prepare_for_milestone_b` to `normalize_source`.

Keeping the RPC signature unchanged avoids an extension/Web contract migration in Stage 1A.

- [ ] **Step 3: Add the server helper**

`default-space.ts` exposes:

```ts
export async function ensureDefaultPrivateSpace(
  ownerUserId: string,
): Promise<{ id: string; name: string }>;
```

It uses the admin client/RPC, validates the returned UUID with Zod and never caches one user’s result globally. Call it from authenticated app layout so every invited account receives its private space before rendering.

- [ ] **Step 4: Run server and database regressions**

```bash
pnpm vitest run apps/web/src/features/spaces/server/default-space.test.ts apps/web/src/features/capture/server/finalize-capture.test.ts
pnpm supabase test db supabase/tests/003_finalize_capture.test.sql
pnpm --filter @recall/web typecheck
```

Expected: PASS and existing receipt snapshots unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608110003_finalize_into_private_space.sql supabase/tests/003_finalize_capture.test.sql apps/web/src/features/spaces apps/web/src/features/capture/server/finalize-capture.ts apps/web/src/features/capture/server/finalize-capture.test.ts apps/web/src/app/'(app)'/layout.tsx
git commit -m "feat: assign captures to default private spaces"
```

---

### Task 6: Regenerate database types and document the migration gate

**Files:**

- Modify: `apps/web/src/lib/supabase/database.types.ts`
- Modify: `docs/runbooks/milestone-a-local.md`

- [ ] **Step 1: Generate types from the migrated disposable/local schema**

```bash
pnpm supabase gen types typescript --local > apps/web/src/lib/supabase/database.types.ts
```

Do not manually append table types. Confirm generated RPC types include `ensure_private_space` and the unchanged `finalize_capture` signature.

- [ ] **Step 2: Run full consistency gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm supabase test db
git diff --check
```

- [ ] **Step 3: Apply migration to the data-bearing local project only after a fresh backup**

Run a new `pnpm backup:local` and `pnpm backup:verify` immediately before applying migrations. Apply pending migrations non-destructively. Verify read-only counts for users, source items, versions, messages, attachments and jobs are unchanged except:

- one private space and one owner membership per existing owner;
- every source item/job now has a valid `space_id`;
- 原占位任务被重命名为 `normalize_source`，且不产生重复任务。

- [ ] **Step 4: Document rollback boundary**

Database rollback is restore-from-verified-backup into a clean target, not hand-dropping newly referenced columns from the live database. Record backup timestamp, migration versions and post-migration counts without including private content.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/database.types.ts docs/runbooks/milestone-a-local.md
git commit -m "chore: regenerate knowledge schema types"
```

---

## Stage 1A Exit Criteria

- Every existing and new user has exactly one server-created private space and owner membership.
- Every source item and processing job belongs to the same owner/space pair.
- Stable source blocks, asset links, governed knowledge, immutable versions, citations and review tasks exist with cross-space protection.
- Current capture clients remain wire-compatible and produce the same durable receipt.
- SQL constraints enforce confirmation evidence and human-field protection prerequisites.
- Generated TypeScript types match the database; contracts and domain rules pass.
- Existing real source data remains present after a verified, non-destructive migration.

Stage 1A deliberately ends before any external model call. Stage 1B consumes this schema to produce the first reviewable ChatGPT knowledge cards.
