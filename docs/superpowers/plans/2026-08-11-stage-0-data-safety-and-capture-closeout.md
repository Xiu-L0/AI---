# Stage 0 Data Safety and Capture Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不清空当前本地 Supabase 真实测试数据的前提下，建立可验证的数据库与附件备份，并收口 Milestone A 剩余三项可靠性问题，使后续知识模型迁移有安全起点。

**Architecture:** 保持现有 Next.js + 本地 Supabase + WXT Outbox 架构。备份由仓库内脚本导出 `public/auth/storage` 数据并下载 `raw-captures` 对象，生成带 SHA-256 的清单；恢复验证只能在一次性临时数据库中执行。扩展只做最小诚实反馈修复和中断恢复验证，不改变 durable receipt、幂等键或原始数据模型。

**Tech Stack:** Node.js 22、pnpm 11、Supabase CLI 2.110、`@supabase/supabase-js`、Vitest 4、WXT、React Testing Library、Playwright、PostgreSQL/pgTAP。

## Global Constraints

- 当前 `NEXT_PUBLIC_SUPABASE_URL` 指向 `127.0.0.1`，已有真实 ChatGPT 测试数据；禁止对当前项目执行 `supabase db reset`、`supabase stop --no-backup` 或删除 Docker volume。
- `backups/` 必须加入 `.gitignore`；SQL、Storage 对象、密钥和真实原文不得提交 Git。
- 备份成功的定义是“清单、数据库导出、对象字节均生成且通过独立验证”，不是“命令退出码为 0”。
- 现有 23 次真实验收历史不可重置或从分母删除；历史累计指标继续按 `16/23` 记录。
- 阶段 0 不增加 Claude、豆包、DeepSeek、小红书等新来源，也不开始知识提取。
- 所有扩展成功文案仍必须晚于 durable receipt；失败时保留 Outbox 原任务和附件 Blob。

---

## Repository Map

### Files to create

- `scripts/local-backup.mjs`：创建数据库、Storage 和元数据备份。
- `scripts/local-backup-lib.mjs`：目录遍历、SHA-256、清单生成等可测试纯函数。
- `scripts/local-backup-lib.test.ts`：清单、路径安全和哈希测试。
- `scripts/verify-local-backup.mjs`：验证清单和文件哈希，并输出恢复核对命令。
- `docs/runbooks/local-data-backup-and-restore.md`：无破坏备份、临时恢复和迁移前门禁。

### Files to modify

- `.gitignore`
- `package.json`
- `pnpm-lock.yaml`
- `apps/extension/entrypoints/popup/App.tsx`
- `apps/extension/entrypoints/popup/App.test.tsx`
- `apps/extension/lib/capture-runner.test.ts`
- `apps/extension/lib/background-controller.test.ts`
- `docs/runbooks/milestone-a-local.md`
- `docs/runbooks/milestone-a-acceptance.md`

### Files deliberately unchanged

- `supabase/migrations/202607290001_capture_schema.sql` 至 `202607290006_report_capture_failure.sql`
- `apps/web/src/features/capture/server/finalize-capture.ts`
- `packages/contracts/src/capture.ts`

阶段 0 不做数据库业务迁移；只有备份通过后，阶段 1A 才能新增迁移。

---

### Task 1: Add a versioned, non-destructive local backup command

**Files:**

- Create: `scripts/local-backup-lib.mjs`
- Create: `scripts/local-backup-lib.test.ts`
- Create: `scripts/local-backup.mjs`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing tests for backup path and manifest invariants**

Add tests that import these exact exports from `scripts/local-backup-lib.mjs`:

```ts
import {
  assertSafeRelativePath,
  buildBackupManifest,
  sha256File,
} from "./local-backup-lib.mjs";
```

Cover:

- `assertSafeRelativePath("storage/raw-captures/user/file.png")` succeeds.
- absolute paths and any `..` segment throw.
- two fixture files produce deterministic SHA-256 values.
- `buildBackupManifest` includes `formatVersion: 1`, `createdAt`, CLI/app versions, table row counts, Storage object metadata and file hashes.
- the manifest never contains `SUPABASE_SERVICE_ROLE_KEY`, signed URLs or bearer tokens.

Run:

```bash
pnpm vitest run scripts/local-backup-lib.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure backup helpers**

Implement the three exports with Node built-ins only (`node:crypto`, `node:fs/promises`, `node:path`). `assertSafeRelativePath` must normalize separators and reject empty, absolute and parent-traversal paths before any write. `sha256File` streams rather than loading a 10 MiB attachment into a second full in-memory copy.

Run the test again. Expected: PASS.

- [ ] **Step 3: Add the orchestrating backup script**

`scripts/local-backup.mjs` must:

1. Refuse to run unless `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` resolves to loopback (`127.0.0.1` or `localhost`).
2. Require `SUPABASE_SERVICE_ROLE_KEY` only in process environment; never read or print it into the manifest.
3. Create `backups/<UTC timestamp>/` with mode `0700`.
4. Execute pinned project CLI commands, always with explicit `--local`:

```bash
pnpm supabase db dump --local --schema public,auth,storage --file <backup>/schema.sql
pnpm supabase db dump --local --schema public,auth,storage --data-only --use-copy --file <backup>/data.sql
```

5. Query exact row counts for all current business tables and `auth.users`.
6. Recursively list and download every object in private bucket `raw-captures` to `storage/raw-captures/<storage path>`.
7. Write `manifest.json` last, after hashing `schema.sql`, `data.sql` and every downloaded object.
8. On failure, leave the incomplete directory but do not write a valid completion marker.

The script must use the Storage API, not copy an undocumented Docker volume path. Supabase CLI’s default dump excludes managed schemas, so this plan explicitly supplies `--schema public,auth,storage`; see the official [CLI reference](https://supabase.com/docs/reference/cli/supabase-orgs-list) and [local workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

- [ ] **Step 4: Add package scripts and ignore backup artifacts**

Add:

```json
{
  "scripts": {
    "backup:local": "node scripts/local-backup.mjs",
    "backup:verify": "node scripts/verify-local-backup.mjs"
  }
}
```

Add `/backups/` to root `.gitignore`. Add `@supabase/supabase-js` as a root dev dependency pinned to the same compatible version used by `apps/web`.

- [ ] **Step 5: Run static and secret checks**

```bash
pnpm vitest run scripts/local-backup-lib.test.ts
pnpm typecheck
git check-ignore backups/example/manifest.json
git diff --check
```

Expected: all pass and the sample backup path is ignored.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json pnpm-lock.yaml scripts/local-backup.mjs scripts/local-backup-lib.mjs scripts/local-backup-lib.test.ts
git commit -m "feat: add non-destructive local backup"
```

---

### Task 2: Verify backup integrity without touching the live local stack

**Files:**

- Create: `scripts/verify-local-backup.mjs`
- Create: `docs/runbooks/local-data-backup-and-restore.md`
- Modify: `docs/runbooks/milestone-a-local.md`

- [ ] **Step 1: Write the verification contract in the runbook**

Document these hard gates:

- `manifest.json` exists and `formatVersion === 1`.
- every listed file exists and SHA-256 matches.
- manifest table counts equal read-only counts from the live local database at backup time.
- every `source_attachments.storage_path` has a corresponding downloaded object.
- schema and data are restored only into a temporary PostgreSQL/Supabase target with a different project ID and ports.
- the current `127.0.0.1:54322` database is never the restore target.

- [ ] **Step 2: Implement the verifier**

`pnpm backup:verify -- backups/<timestamp>` must:

- reject a backup directory outside repository `backups/`;
- validate the complete manifest schema;
- recompute hashes and byte sizes;
- compare attachment paths against the manifest;
- scan SQL/manifest output for service-role JWTs and signed URL query parameters;
- exit non-zero with one actionable line per mismatch;
- print a summary containing table count, Storage object count, total bytes and backup timestamp.

Do not embed or infer database passwords in this script.

- [ ] **Step 3: Add a disposable restore drill**

The runbook must give an exact restore drill using a new temporary directory/project ID. Restore `schema.sql`, then `data.sql`, run read-only count queries, and compare them with `manifest.json`. If a disposable Supabase stack is used, assign non-default ports before startup. Destroying the disposable target after verification is allowed; destroying the live target is not.

The drill must explicitly warn that `supabase db reset` discards current local data, matching Supabase’s official [local development documentation](https://supabase.com/docs/guides/local-development/cli-workflows).

- [ ] **Step 4: Produce and verify the first real backup**

With the current local stack running and env loaded:

```bash
pnpm backup:local
pnpm backup:verify -- backups/<generated timestamp>
```

Record only counts, timestamp and verification result in the runbook. Do not record raw text, object names containing private content, keys or signed URLs.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-local-backup.mjs docs/runbooks/local-data-backup-and-restore.md docs/runbooks/milestone-a-local.md
git commit -m "docs: add verified local restore drill"
```

---

### Task 3: Prevent an unsupported page from displaying a stale success as the current result

**Files:**

- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/App.test.tsx`

- [ ] **Step 1: Add the failing popup regression test**

Create a complete ChatGPT Outbox item, make `getPageContext()` return:

```ts
{
  label: "当前页面暂不支持自动采集",
  scopes: [],
  supported: false,
}
```

Assert:

- the unsupported-page explanation is visible;
- `完整采集成功`, saved message counts and processing status are absent;
- unresolved Outbox tasks remain selectable if present;
- the old complete item is not deleted from storage.

Run:

```bash
pnpm --filter @recall/extension test -- App.test.tsx
```

Expected: FAIL because `receipt` is currently rendered independently of page support.

- [ ] **Step 2: Separate current-page state from historical receipt state**

In `App.tsx`, derive `visibleReceipt` and `visibleState` so completed/partial historical results render only when the active page is supported or when the user explicitly selects an unresolved task. Keep `outboxItems` intact. On unsupported pages show one neutral line: `当前页面未采集；可改用 Web 应用保存。`

Do not solve this by clearing IndexedDB or deleting the previous receipt.

- [ ] **Step 3: Add a supported-page control test**

Verify that the same complete item still renders on ChatGPT and that partial/retry/terminal UI behavior is unchanged.

- [ ] **Step 4: Run extension tests and commit**

```bash
pnpm --filter @recall/extension test -- App.test.tsx
pnpm --filter @recall/extension typecheck
git add apps/extension/entrypoints/popup/App.tsx apps/extension/entrypoints/popup/App.test.tsx
git commit -m "fix: avoid stale capture success on unsupported pages"
```

---

### Task 4: Prove attachment recovery after upload succeeds but finalization is interrupted

**Files:**

- Modify: `apps/extension/lib/capture-runner.test.ts`
- Modify only if the new test exposes a gap: `apps/extension/lib/capture-runner.ts`

- [ ] **Step 1: Add a two-run interruption test**

Model this exact sequence with a persistent fake Outbox and fake Storage:

1. `start` returns `captureId` and one signed target.
2. `upload` succeeds and the fake server records the object.
3. execution is interrupted before `finalize` yields a receipt.
4. a new runner instance starts with the same Outbox item and idempotency key.
5. `start` reopens/renews the same `captureId` and returns a fresh signed token with upsert allowed.
6. upload may safely repeat; `finalize` returns one receipt.

Assert the final state is `complete`, one `source_version` equivalent is created, `captureId` is unchanged, and the signed token itself is never stored in Outbox.

- [ ] **Step 2: Run the focused test**

```bash
pnpm --filter @recall/extension test -- capture-runner.test.ts
```

Expected: either PASS, proving the existing stable-idempotency/re-sign path, or FAIL at the exact interrupted boundary.

- [ ] **Step 3: Apply the minimum fix only if required**

If the test fails, persist only non-secret upload progress (`clientId`, `storagePath`, `etag`) after each completed upload, never the signed token. On retry, call `status` first, then `start` with the same idempotency key to obtain fresh targets. A missing/expired token is never terminal by itself.

Repeat the focused test and existing lost-finalize-response tests.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/lib/capture-runner.ts apps/extension/lib/capture-runner.test.ts
git commit -m "test: cover uploaded attachment finalization recovery"
```

If no production change is needed, stage only the test file and use the same commit message.

---

### Task 5: Prove screenshot-recovery failure remains honest and recoverable

**Files:**

- Modify: `apps/extension/lib/background-controller.test.ts`
- Modify: `apps/extension/entrypoints/popup/App.test.tsx`
- Modify only if required: `apps/extension/lib/background-controller.ts`

- [ ] **Step 1: Add controller tests for both failure boundaries**

Add tests where:

- `captureVisibleTab` rejects before Blob creation;
- `attachmentStore.putAttachment` rejects after screenshot capture.

For both cases assert:

- the original partial item and receipt are unchanged;
- no recovery child is enqueued;
- no ancestor is marked resolved;
- a later retry can create exactly one recovery child;
- concurrent clicks still share one flight.

- [ ] **Step 2: Add popup recovery-copy assertions**

Extend the existing screenshot failure test to assert the UI continues to show `部分内容未采集`, the original missing element and the `补充截图` button after the alert.

- [ ] **Step 3: Run focused tests**

```bash
pnpm --filter @recall/extension test -- background-controller.test.ts App.test.tsx
```

Expected: PASS or a focused failure. If a production fix is required, keep the original partial item immutable and clear the single-flight map in `finally`; do not manufacture a failed server receipt.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/lib/background-controller.ts apps/extension/lib/background-controller.test.ts apps/extension/entrypoints/popup/App.test.tsx
git commit -m "test: close screenshot recovery failure path"
```

---

### Task 6: Complete the Milestone A release-candidate gate without rewriting history

**Files:**

- Modify: `docs/runbooks/milestone-a-acceptance.md`
- Modify: `docs/runbooks/milestone-a-local.md`

- [ ] **Step 1: Add a release-candidate cohort alongside the historical metric**

Keep the historical `N_supported = 23`, `N_auto_complete = 16`, `69.57%` and the note that cumulative 90% would require 47 further all-complete samples. Add a separate, forward-looking release-candidate cohort:

- 30 consecutive supported captures after the Stage 0 fixes;
- at least 27 first-attempt automatic complete receipts;
- zero false-complete and zero early-success events;
- every partial/failure has a classified cause and recovery record;
- Chrome and Edge are both represented.

Label it clearly as a new release-candidate quality window, not a replacement denominator.

- [ ] **Step 2: Record the three closed defects**

Update the unresolved section with evidence for:

- unsupported page no longer displays the old ChatGPT receipt as current;
- uploaded-object/finalize interruption recovers with the same idempotency key and fresh signed target;
- screenshot capture/storage failure leaves the partial item recoverable.

- [ ] **Step 3: Run the complete non-destructive gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm supabase test db
git diff --check
```

Do not run `pnpm supabase db reset`. Database verification is the successful backup plus disposable restore drill and pgTAP against a disposable/resettable test target.

- [ ] **Step 4: Sign Stage 0**

Stage 0 is complete only when:

- one real backup has a passing verification manifest;
- all three reliability paths have automated evidence;
- the current local data is still readable in Web history;
- the acceptance document truthfully remains `CONDITIONAL` until its real-browser cohort passes.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/milestone-a-acceptance.md docs/runbooks/milestone-a-local.md
git commit -m "docs: close stage zero reliability gates"
```

---

## Stage 0 Exit Criteria

- A verified backup of the current local database and every `raw-captures` object exists outside Git.
- The backup can be inspected/restored without targeting the live local stack.
- Unsupported pages never present a historical success as the current page’s result.
- Attachment upload/finalize interruption and screenshot failure have deterministic regression coverage.
- Existing capture, RLS, build and E2E gates pass without destructive reset.
- Historical acceptance metrics remain intact and distinguishable from the new release-candidate cohort.

Only after these conditions pass may Stage 1A migrations be applied to the data-bearing local project.
