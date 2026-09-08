# Stage 2C Xiaohongshu Capture and GLM-OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重做 Stage 1 的前提下，让用户在 Chrome/Edge 打开一篇小红书网页版笔记后点击一次扩展，可靠保存标题、正文、作者、原链接和可见原图，随后由智谱 GLM-OCR API 生成可追溯到原图区域的 OCR 证据与可审核知识卡片。

**Architecture:** 保留 Stage 1 已完成的 Outbox、两阶段上传、Supabase 主数据、PostgreSQL 任务队列、DeepSeek 知识提取和人工审核闭环。扩展新增通用 `SourceAdapter` 边界和独立 `xiaohongshu` 适配器；服务器把旧的单一 `capture_source` 逐步归一为 `source_platform + source_kind`；Worker 在原图持久化后调用 `glm-ocr`，持久化 Markdown 与区域坐标，再构建 `paragraph`/`ocr_region` 证据块并进入现有知识提取流程。

**Tech Stack:** pnpm 11、Node.js 22.12+、TypeScript 5.9、WXT Manifest V3、React 19、Next.js 16、Supabase Auth/PostgreSQL/Storage/RLS、Vitest 4、Playwright 1.61、智谱 `POST /api/paas/v4/layout_parsing`、GLM-OCR `glm-ocr`、Sharp 0.34.5（仅 Worker 内把 WebP 规范化为 PNG）。

## Global Constraints

- Stage 1 视为已完成的代码基线；本计划只做 Stage 2C 必需的通用化和可靠性修正，不重写 ChatGPT 采集、知识卡片或审核流程。
- Claude 已移出产品范围；它只能出现在“不是受支持平台”的负向契约测试和范围变更记录中，不得出现在支持枚举、适配器注册表、页面入口或验收样本中。
- 本计划不实现豆包、DeepSeek 网页版、普通网页、微信、GitHub、文件解析、语义搜索、有引用问答、知识地图、每日/每周回顾或云端部署。
- 小红书首版只采集用户当前打开且有权查看的单篇图文笔记；不批量爬取、不自动翻页、不采集评论、不绕过登录、验证码、反爬或访问限制。
- 用户操作是“打开笔记 → 点击一次扩展 → 采集当前笔记”；不做浏览即自动采集。
- 采集成功只表示标题/正文/作者/链接/已获取图片已经获得服务器 durable receipt；OCR、知识提取成功不得与采集成功混为一谈。
- 任一图片不可读取时保存其他可用内容并返回 `partial`，列出具体缺失图片；不得把部分结果显示成完整成功。
- GLM-OCR 失败不得删除原图、正文、已有证据或正式知识；最终失败必须进入 Web“异常”页并显示 `ocr_assets` 与安全错误摘要。
- 浏览器扩展、Web 前端、Git 仓库和普通日志均不得包含 `ZHIPU_API_KEY`、DeepSeek Key、Supabase service-role key、图片 Base64 或完整敏感原文。
- 用户已允许普通、敏感和严格敏感资料发送给配置的合规第三方 AI API；Worker 仍必须通过服务端环境开关 `ALLOW_SENSITIVE_EXTERNAL_AI=true` 明确启用，关闭时敏感 OCR 任务进入 `paused` 而不是丢弃。
- GLM-OCR API 输入使用服务器从私有 Storage 下载后生成的 Base64，不向智谱暴露 Supabase signed URL。
- GLM-OCR 官方限制按 2026-09-08 文档固定：模型 `glm-ocr`；JPG/PNG 单图不超过 10 MiB；API 支持 URL/Base64；本计划不发送 PDF。实现前只允许重新核对官方文档，不得从第三方博客推断接口字段。
- GLM-OCR 官方响应中的 `md_results`、`layout_details`、`data_info`、`usage`、`request_id`必须通过 Zod 校验；布局区域坐标保持 `[x1,y1,x2,y2]` 的 0–1 归一化值。
- 原图是证据，OCR 是派生数据；OCR 文本必须通过 `source_attachment_id` 和 locator 回到原图及区域，不能替代原图。
- 单次采集沿用现有上限：最多 50 个附件、单附件不超过 10 MiB、附件总量不超过 100 MiB；超出部分生成明确 `missingElements`。
- 新数据库对象必须同时具备 owner/space/source ancestry 约束、RLS、service-role 写权限和双账号隔离测试。
- 每个任务先写失败测试，再做最小实现，再运行聚焦测试；任务结束时提交一个小 Git commit。
- 不在真实数据环境执行 `supabase db reset`；数据库迁移先在临时 Supabase 或恢复副本通过 pgTAP，再应用到真实环境。

## Official GLM-OCR Contract

- 模型说明：https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr
- API 参考：https://docs.bigmodel.cn/api-reference/模型-api/文档解析
- 请求：`POST https://open.bigmodel.cn/api/paas/v4/layout_parsing`
- Header：`Authorization: Bearer <server-only key>`、`Content-Type: application/json`
- Body：`{ "model": "glm-ocr", "file": "data:image/png;base64,...", "request_id": "<uuid>" }`
- 成功输出至少解析 `model`、`md_results`、`layout_details`、`data_info`、`usage`、`request_id`。

## End-to-End Data Flow

```text
用户打开小红书笔记并点击扩展
  → xiaohongshu SourceAdapter 读取标题/正文/作者/canonical URL/可见图片
  → Outbox 在 IndexedDB/extension storage 保存草稿与图片字节
  → start → signed upload → finalize → durable receipt
  → PostgreSQL enqueue normalize_source
  → normalize_source 判断 social_post/xiaohongshu 并 enqueue ocr_assets
  → Worker 从私有 Storage 下载原图，必要时 WebP→PNG
  → GLM-OCR API
  → asset_ocr_results + processing_runs
  → build_source_blocks 写正文 paragraph、metadata、ocr_region 与 source_asset_links
  → 现有 extract_knowledge → 知识草稿 → 人工编辑/确认
  → 任何终止失败显示在 Web 异常中心，原始资料保持可查看
```

## Planned File Map

### Shared contracts and domain

- Modify: `packages/contracts/src/capture.ts` — 来源双维度、采集元数据和兼容旧载荷。
- Create: `packages/contracts/src/ocr.ts` — GLM-OCR 结构化响应及持久化 DTO。
- Modify: `packages/contracts/src/index.ts` — 导出 OCR 与来源契约。
- Modify: `packages/contracts/src/capture.test.ts` — ChatGPT 兼容、小红书范围和元数据边界。
- Create: `packages/contracts/src/ocr.test.ts` — 坐标、响应体、大小和字段校验。
- Modify: `packages/domain/src/capture/fingerprint.ts` — 指纹包含平台、类型和元数据。
- Modify: `packages/domain/src/capture/fingerprint.test.ts` — 旧映射与小红书去重测试。

### Database

- Create: `supabase/migrations/202609080001_stage_2c_source_identity.sql` — `source_platform`、`source_kind`、旧数据回填、typed-source 去重和 `metadata_json`。
- Create: `supabase/migrations/202609080002_stage_2c_ocr_pipeline.sql` — `asset_ocr_results`、`ocr_assets` 任务、OCR 持久化 RPC 和图片证据关联。
- Create: `supabase/tests/013_stage_2c_source_identity.test.sql` — 兼容迁移、约束、RLS 和幂等。
- Create: `supabase/tests/014_stage_2c_ocr_pipeline.test.sql` — OCR ancestry、租约、幂等、RLS 和后续任务。
- Regenerate: `apps/web/src/lib/supabase/database.types.ts` — 新迁移后的数据库类型。

### Extension

- Create: `apps/extension/lib/adapters/types.ts` — `SourceAdapter`、统一提取结果和页面上下文。
- Create: `apps/extension/lib/adapters/registry.ts` — 仅注册 ChatGPT 与小红书。
- Create: `apps/extension/lib/adapters/chatgpt.ts` — 包装已有 ChatGPT extractor，不改变其语义。
- Create: `apps/extension/lib/xiaohongshu/origins.ts` — 精确 origin 与 note id 解析。
- Create: `apps/extension/lib/xiaohongshu/extract.ts` — DOM/meta/JSON-LD 提取。
- Create: `apps/extension/lib/xiaohongshu/content-message.ts` — content-script 消息边界。
- Create: `apps/extension/lib/xiaohongshu/to-capture-draft.ts` — 完整/部分状态和图片 manifest。
- Create: `apps/extension/entrypoints/xiaohongshu.content.ts` — 只在精确小红书页面运行。
- Modify: `apps/extension/lib/outbox-types.ts` — 通用来源、元数据和通用图片定位。
- Modify: `apps/extension/lib/outbox.ts` — schema v1→v2 非破坏迁移。
- Modify: `apps/extension/lib/capture-runner.ts` — 通用图片错误文案、XHS CDN 下载、可见截图兜底和 typed-source API。
- Modify: `apps/extension/lib/background-controller.ts` — 由注册表选择适配器。
- Modify: `apps/extension/entrypoints/background.ts` — 分发两种 content-script extraction。
- Modify: `apps/extension/entrypoints/popup/App.tsx` — 小红书页面状态、`web_page` scope 和即时回执。
- Modify: `apps/extension/wxt.config.ts` — 小红书页面与图片 CDN host permissions。
- Create: `tests/fixtures/xiaohongshu/complete-note.html` — 合成完整图文笔记。
- Create: `tests/fixtures/xiaohongshu/partial-note.html` — 图片缺失/正文部分场景。
- Create: `tests/e2e/extension/xiaohongshu-capture.spec.ts` — Chrome 扩展纵向采集。

### Worker and Web

- Modify: `apps/worker/src/config.ts`、`.env.example` — GLM-OCR server-only 配置。
- Create: `apps/worker/src/providers/ocr-provider.ts` — 可替换 OCR 接口和安全错误。
- Create: `apps/worker/src/providers/glm-ocr.ts` — 智谱 REST 适配器。
- Create: `apps/worker/src/repositories/ocr-repository.ts` — 私有附件下载、结果读取和 RPC 持久化。
- Create: `apps/worker/src/processors/ocr-assets.ts` — 图片规范化、幂等 OCR 和用量汇总。
- Modify: `apps/worker/src/processors/normalize-source.ts` — 支持 `social_post/xiaohongshu`。
- Modify: `apps/worker/src/processors/build-source-blocks.ts` — 小红书正文和 OCR 区域证据块。
- Modify: `apps/worker/src/processors/extract-knowledge.ts` — 允许经过验证的小红书证据块进入现有 DeepSeek 提取。
- Modify: `apps/worker/src/worker-loop.ts` — 长 OCR 任务自动 heartbeat。
- Modify: `apps/worker/src/main.ts`、`package.json` — 注册 OCR processor 与 `sharp@0.34.5`。
- Modify: `apps/web/src/features/capture/server/start-capture.ts`、`finalize-capture.ts` — typed source 与元数据。
- Modify: `apps/web/src/features/capture/server/get-capture-status.ts` — 确定性聚合多处理任务。
- Modify: `apps/web/src/features/capture/server/list-captures.ts`、`list-exceptions.ts` — typed source、OCR 状态和失败类型。
- Modify: `apps/web/src/app/(app)/captures/[sourceItemId]/page.tsx` — 原图、OCR Markdown 与区域信息。
- Modify: `apps/web/src/app/(app)/exceptions/page.tsx` — 明确显示图片识别失败。

### Operations

- Modify: `scripts/local-backup.mjs`、`scripts/verify-local-backup.mjs` — 纳入 Stage 1 与 Stage 2C 新表，Storage 分页。
- Create: `docs/runbooks/stage-2c-xiaohongshu-glm-ocr.md` — 本地配置、真实验收、失败恢复和供应商检查。

---

### Task 1: Introduce Typed Source Identity and Capture Metadata Contracts

**Files:**
- Modify: `packages/contracts/src/capture.ts`
- Modify: `packages/contracts/src/capture.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/capture/fingerprint.ts`
- Modify: `packages/domain/src/capture/fingerprint.test.ts`

**Interfaces:**
- Produces: `SourceKind`, `SourcePlatform`, `CaptureMetadata`, `resolveSourceIdentity(input)`.
- Consumed by: Web capture API, extension Outbox v2, database repository and Worker.

- [ ] **Step 1: Write failing contract tests for the allowed source matrix**

Add cases proving that Claude is rejected and that Xiaohongshu accepts only `social_post + xiaohongshu + web_page`:

```ts
expect(SourcePlatformSchema.safeParse("claude").success).toBe(false);
expect(StartCaptureInputSchema.parse({
  idempotencyKey: "xhs-note-123456",
  sourceKind: "social_post",
  sourcePlatform: "xiaohongshu",
  scope: "web_page",
  title: "合成笔记",
  sensitivity: "normal",
  externalRef: "note-123",
  attachments: [],
}).sourcePlatform).toBe("xiaohongshu");
expect(() => StartCaptureInputSchema.parse({
  idempotencyKey: "xhs-note-123456",
  sourceKind: "social_post",
  sourcePlatform: "xiaohongshu",
  scope: "full_conversation",
  title: "合成笔记",
  sensitivity: "normal",
  externalRef: "note-123",
  attachments: [],
})).toThrow();
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm test -- packages/contracts/src/capture.test.ts packages/domain/src/capture/fingerprint.test.ts`

Expected: FAIL because `SourcePlatformSchema`, typed identity and metadata do not exist.

- [ ] **Step 3: Add exact source and metadata schemas**

Implement these public contracts in `packages/contracts/src/capture.ts`:

```ts
export const SourceKindSchema = z.enum([
  "ai_conversation",
  "web_article",
  "social_post",
  "code_repository",
  "manual_text",
  "manual_file",
  "screenshot",
]);

export const SourcePlatformSchema = z.enum([
  "chatgpt",
  "doubao",
  "deepseek",
  "wechat",
  "xiaohongshu",
  "github",
  "generic_web",
  "manual",
]);

export const CaptureAssetMetadataSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  ordinal: z.number().int().nonnegative(),
  alt: z.string().max(2000),
}).strict();

export const CaptureMetadataSchema = z.object({
  adapterName: z.enum(["chatgpt", "xiaohongshu", "manual"]),
  adapterVersion: z.string().trim().min(1).max(50),
  canonicalUrl: z.url().max(10_000),
  author: z.string().trim().min(1).max(500).nullable(),
  capturedAt: z.iso.datetime({ offset: true }),
  assets: z.array(CaptureAssetMetadataSchema).max(50),
}).strict();
```

Keep the old `source` field optional for in-flight Stage 1 clients. Add `resolveSourceIdentity` with this exact legacy mapping:

```ts
const LEGACY_SOURCE_IDENTITY = {
  chatgpt_web: { sourceKind: "ai_conversation", sourcePlatform: "chatgpt" },
  manual_text: { sourceKind: "manual_text", sourcePlatform: "manual" },
  manual_file: { sourceKind: "manual_file", sourcePlatform: "manual" },
  manual_screenshot: { sourceKind: "screenshot", sourcePlatform: "manual" },
} as const;
```

Require either both typed fields or a valid legacy `source`; when both are present, require an exact mapping match. Require non-empty `externalRef` for `chatgpt` and `xiaohongshu`. Add `metadata` to the start payload as optional for legacy calls and required for every Outbox v2 draft. Finalize reads the immutable metadata stored on the capture session instead of accepting it a second time.

- [ ] **Step 4: Make content fingerprints source-aware without breaking old captures**

Change `FingerprintInput` to accept resolved `sourceKind`, `sourcePlatform` and `metadata`. Canonicalize asset metadata by `(ordinal, clientId)` and omit volatile `capturedAt` from the fingerprint so retrying the same content does not create a new version:

```ts
const canonicalValue = {
  sourceKind: input.sourceKind,
  sourcePlatform: input.sourcePlatform,
  externalRef: input.externalRef,
  metadata: {
    author: input.metadata?.author ?? null,
    canonicalUrl: input.metadata?.canonicalUrl ?? null,
    assets: [...(input.metadata?.assets ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal || a.clientId.localeCompare(b.clientId)),
  },
  rawText: normalizeText(input.rawText),
  messages: canonicalMessages,
  attachmentHashes: [...input.attachmentHashes].sort(),
};
```

- [ ] **Step 5: Run focused and full contract/domain tests**

Run: `pnpm test -- packages/contracts/src/capture.test.ts packages/domain/src/capture/fingerprint.test.ts`

Expected: PASS, including all legacy ChatGPT/manual cases.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/domain
git commit -m "feat: add typed capture source identity"
```

---

### Task 2: Migrate PostgreSQL Source Identity Without Losing Stage 1 Data

**Files:**
- Create: `supabase/migrations/202609080001_stage_2c_source_identity.sql`
- Create: `supabase/tests/013_stage_2c_source_identity.test.sql`
- Regenerate: `apps/web/src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces database columns `source_platform`, `source_kind`, `metadata_json`.
- Preserves nullable legacy `source` solely for old clients and audit history.

- [ ] **Step 1: Write pgTAP failures for backfill, uniqueness, scope and isolation**

Cover these exact assertions:

```sql
select is(
  (select source_platform::text from public.source_items where source = 'chatgpt_web' limit 1),
  'chatgpt',
  'legacy ChatGPT rows are backfilled'
);

select throws_ok(
  $$ insert into public.source_items
     (owner_user_id, space_id, source_platform, source_kind, external_ref, title, sensitivity)
     values (:owner_id, :space_id, 'xiaohongshu', 'ai_conversation', 'note-1', 'bad', 'normal') $$,
  '23514',
  null,
  'Xiaohongshu must be a social post'
);
```

Also prove two users may save the same note id, one user cannot create two current items for the same typed external ref, and the second account cannot select the first account’s rows.

- [ ] **Step 2: Run pgTAP and verify failure before the migration**

Run: `pnpm supabase test db --local supabase/tests/013_stage_2c_source_identity.test.sql`

Expected: FAIL because the new enums and columns do not exist.

- [ ] **Step 3: Add enums, backfill and compatibility columns**

The migration must execute in one transaction and contain these enum values; do not include Claude:

```sql
create type public.source_kind as enum (
  'ai_conversation', 'web_article', 'social_post', 'code_repository',
  'manual_text', 'manual_file', 'screenshot'
);
create type public.source_platform as enum (
  'chatgpt', 'doubao', 'deepseek', 'wechat', 'xiaohongshu',
  'github', 'generic_web', 'manual'
);

alter table public.source_items
  add column source_kind public.source_kind,
  add column source_platform public.source_platform;
alter table public.capture_sessions
  add column source_kind public.source_kind,
  add column source_platform public.source_platform,
  add column metadata_json jsonb not null default '{}'::jsonb,
  add constraint capture_sessions_metadata_size
    check (octet_length(metadata_json::text) <= 65536);
alter table public.source_versions
  add column metadata_json jsonb not null default '{}'::jsonb,
  add constraint source_versions_metadata_size
    check (octet_length(metadata_json::text) <= 65536);
```

Backfill all four legacy values with the mapping from Task 1, set typed columns `not null`, then drop `not null` from the two legacy `source` columns so new Xiaohongshu records do not need a fake legacy value.

- [ ] **Step 4: Replace source constraints and deduplication**

Drop the old ChatGPT-only ref and source/scope checks. Add explicit allowed pairs and scopes:

```sql
check (
  (source_platform = 'chatgpt' and source_kind = 'ai_conversation') or
  (source_platform = 'xiaohongshu' and source_kind = 'social_post') or
  (source_platform = 'manual' and source_kind in ('manual_text','manual_file','screenshot')) or
  (source_platform in ('doubao','deepseek') and source_kind = 'ai_conversation') or
  (source_platform in ('wechat','generic_web') and source_kind = 'web_article') or
  (source_platform = 'github' and source_kind = 'code_repository')
)
```

Use a partial unique index so null refs for manual uploads do not collapse:

```sql
create unique index source_items_owner_typed_external_ref_key
on public.source_items(owner_user_id, source_platform, source_kind, external_ref)
where external_ref is not null;
```

Require `external_ref` for ChatGPT and Xiaohongshu. Add a legacy-consistency check whenever `source` is non-null.

- [ ] **Step 5: Update `finalize_capture` and capture-session writes atomically**

Keep source identity and metadata immutable on the capture session: the start path writes them once, and `finalize_capture` reads them from the locked session rather than trusting duplicate finalize arguments. The function must dedupe `source_items` on the typed partial index, persist session metadata on `source_versions`, and preserve the existing idempotent receipt behavior. Existing Web code is updated in Task 3 in the same release; do not deploy this migration alone to production.

- [ ] **Step 6: Run migration and database tests on a disposable database**

Run:

```bash
pnpm supabase db reset --local
pnpm supabase test db --local
pnpm supabase gen types typescript --local --schema public > apps/web/src/lib/supabase/database.types.ts
```

Expected: every pgTAP file passes; generated types contain both enums and no `claude` value.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202609080001_stage_2c_source_identity.sql supabase/tests/013_stage_2c_source_identity.test.sql apps/web/src/lib/supabase/database.types.ts
git commit -m "feat: migrate capture sources to platform and kind"
```

---

### Task 3: Upgrade the Capture API and Preserve Legacy Clients

**Files:**
- Modify: `apps/web/src/features/capture/server/start-capture.ts`
- Modify: `apps/web/src/features/capture/server/start-capture.test.ts`
- Modify: `apps/web/src/features/capture/server/finalize-capture.ts`
- Modify: `apps/web/src/features/capture/server/finalize-capture.test.ts`
- Modify: `apps/web/src/app/api/captures/start/route.ts`
- Modify: `apps/web/src/app/api/captures/[captureId]/finalize/route.ts`
- Modify: `apps/web/src/features/capture/client/upload-capture.ts`
- Modify: corresponding tests under `apps/web/src/features/capture/client/`

**Interfaces:**
- Consumes: `resolveSourceIdentity`, `CaptureMetadata` from Task 1 and typed database columns from Task 2.
- Produces: unchanged HTTP start/finalize endpoints accepting both legacy Stage 1 and Outbox v2 payloads.

- [ ] **Step 1: Write failing repository tests for typed Xiaohongshu start/finalize**

Add a typed capture fixture:

```ts
const xhsStart = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  sourceKind: "social_post",
  sourcePlatform: "xiaohongshu",
  scope: "web_page",
  title: "合成小红书笔记",
  sensitivity: "normal",
  externalRef: "65abc123",
  attachments: [],
};
```

Assert that a repeated identical start reuses the session, a mismatched author/asset manifest conflicts, and a legacy `source: "chatgpt_web"` request remains accepted.

- [ ] **Step 2: Run focused Web tests and verify failure**

Run: `pnpm --filter @recall/web test -- src/features/capture/server/start-capture.test.ts src/features/capture/server/finalize-capture.test.ts src/features/capture/client/upload-capture.test.ts`

Expected: FAIL because repositories only read/write `source` and finalization drops metadata.

- [ ] **Step 3: Normalize identity once at the API boundary**

Immediately after Zod parsing, call `resolveSourceIdentity`. Store this normalized object in `CaptureStartSession.input` and include `sourcePlatform`, `sourceKind`, `metadata` in `comparableCaptureInput`. Never compare only the legacy field.

- [ ] **Step 4: Persist metadata and fingerprint it**

Pass this exact normalized shape to `computeContentFingerprint`:

```ts
const identity = resolveSourceIdentity(session);
const contentFingerprint = await computeContentFingerprint({
  ...identity,
  externalRef: session.externalRef,
  metadata: session.metadata,
  rawText: args.input.rawText,
  messages: args.input.messages,
  attachmentHashes: session.expectedAttachments.map((item) => item.sha256),
});
```

Update repository selects/inserts and `finalize_capture` RPC arguments. Preserve all expiry, signed-upload verification and recovery behavior.

- [ ] **Step 5: Run API and full capture regressions**

Run:

```bash
pnpm --filter @recall/web test -- src/features/capture
pnpm test -- tests/e2e/web/capture-api.spec.ts tests/e2e/web/manual-capture.spec.ts
```

Expected: PASS for legacy ChatGPT/manual and typed Xiaohongshu fixtures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/capture apps/web/src/app/api/captures
git commit -m "feat: accept typed social post captures"
```

---

### Task 4: Refactor the Extension Behind a SourceAdapter Boundary

**Files:**
- Create: `apps/extension/lib/adapters/types.ts`
- Create: `apps/extension/lib/adapters/registry.ts`
- Create: `apps/extension/lib/adapters/chatgpt.ts`
- Modify: `apps/extension/lib/background-controller.ts`
- Modify: `apps/extension/lib/background-controller.test.ts`
- Modify: `apps/extension/lib/runtime-messages.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/App.test.tsx`

**Interfaces:**
- Produces: `SourceAdapter`, `AdapterExtraction`, `adapterForUrl(url)`.
- Preserves: all existing ChatGPT scopes, screenshot recovery and Outbox semantics.

- [ ] **Step 1: Write failing registry and ChatGPT regression tests**

Test exact origin matching and ensure look-alikes are rejected:

```ts
expect(adapterForUrl("https://chatgpt.com/c/abc")?.id).toBe("chatgpt");
expect(adapterForUrl("https://www.xiaohongshu.com/explore/abc")?.id).toBe("xiaohongshu");
expect(adapterForUrl("https://xiaohongshu.com.attacker.example/explore/abc")).toBeNull();
expect(adapterForUrl("http://www.xiaohongshu.com/explore/abc")).toBeNull();
```

- [ ] **Step 2: Run extension tests and verify failure**

Run: `pnpm --filter @recall/extension test -- lib/background-controller.test.ts entrypoints/popup/App.test.tsx`

Expected: FAIL because only ChatGPT branching exists.

- [ ] **Step 3: Add the adapter interfaces**

Use a discriminated union so platform-specific extraction cannot be mixed:

```ts
export type AdapterId = "chatgpt" | "xiaohongshu";
export type AdapterPageContext = {
  adapterId: AdapterId;
  label: string;
  scopes: CaptureScope[];
  sourceKind: SourceKind;
  sourcePlatform: SourcePlatform;
};

export interface SourceAdapter<TExtraction> {
  readonly id: AdapterId;
  match(url: URL): AdapterPageContext | null;
  extract(tabId: number): Promise<TExtraction>;
  toDraft(input: AdapterDraftInput<TExtraction>): CaptureDraftV2;
}
```

The registry contains exactly two entries: wrapped existing ChatGPT and new Xiaohongshu. Do not put DOM selectors in the registry.

- [ ] **Step 4: Convert background capture to registry dispatch**

Replace `conversationRef(tab.url)` as the top-level gate with `adapterForUrl(tab.url)`. Keep ChatGPT recovery checks inside the ChatGPT adapter. `CAPTURE_CURRENT_PAGE` accepts the selected scope, and the adapter validates whether that scope is supported.

- [ ] **Step 5: Run every existing extension unit test**

Run: `pnpm --filter @recall/extension test`

Expected: PASS with no changed ChatGPT copy or behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/lib/adapters apps/extension/lib/background-controller* apps/extension/lib/runtime-messages.ts apps/extension/entrypoints
git commit -m "refactor: add extension source adapter boundary"
```

---

### Task 5: Extract a Single Xiaohongshu Note Honestly

**Files:**
- Create: `apps/extension/lib/xiaohongshu/origins.ts`
- Create: `apps/extension/lib/xiaohongshu/origins.test.ts`
- Create: `apps/extension/lib/xiaohongshu/extract.ts`
- Create: `apps/extension/lib/xiaohongshu/extract.test.ts`
- Create: `apps/extension/lib/xiaohongshu/content-message.ts`
- Create: `apps/extension/lib/xiaohongshu/content-message.test.ts`
- Create: `apps/extension/lib/xiaohongshu/to-capture-draft.ts`
- Create: `apps/extension/lib/xiaohongshu/to-capture-draft.test.ts`
- Create: `apps/extension/entrypoints/xiaohongshu.content.ts`
- Create: `tests/fixtures/xiaohongshu/complete-note.html`
- Create: `tests/fixtures/xiaohongshu/partial-note.html`

**Interfaces:**
- Produces: `XiaohongshuExtraction`, `extractCurrentXiaohongshuPage`, `toXiaohongshuCaptureDraft`.
- Consumed by: adapter registry and generic Outbox.

- [ ] **Step 1: Add sanitized fixtures and failing pure extraction tests**

The complete fixture must include canonical link, OpenGraph title/description/image, author metadata, JSON-LD image array and rendered article content. The partial fixture must include one readable image plus one missing source and a visible video marker. Tests assert comments are never included:

```ts
expect(result.title).toBe("合成标题");
expect(result.author).toBe("合成作者");
expect(result.canonicalUrl).toBe("https://www.xiaohongshu.com/explore/65abc123");
expect(result.body).toContain("合成正文");
expect(result.body).not.toContain("这是一条评论");
expect(result.images).toHaveLength(3);
expect(result.externalRef).toBe("65abc123");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @recall/extension test -- lib/xiaohongshu`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict origin and route recognition**

Accept only HTTPS host `www.xiaohongshu.com` and note routes matching `/explore/<id>` or `/discovery/item/<id>`. Strip query and fragment when constructing `canonicalUrl`; never accept a note id only from a query parameter.

- [ ] **Step 4: Implement layered extraction without brittle generated class names**

Use this precedence:

1. canonical URL from `link[rel='canonical']`, validated against the active note id;
2. title from `meta[property='og:title']`, then visible `h1`;
3. body from JSON-LD `description`, then `meta[property='og:description']`, then the visible `article` main text with comment subtrees removed;
4. author from JSON-LD `author.name`, then `meta[name='author']`;
5. images from JSON-LD `image`, OpenGraph image tags and visible `article img`, deduped by normalized URL while preserving first-seen order.

Reject scripts, buttons, navigation, avatars, emoji icons, QR codes and nodes under `[data-testid*='comment']`, `[aria-label*='评论']` or an ancestor whose normalized heading is “评论”. Do not depend on hashed CSS classes.

- [ ] **Step 5: Define completeness rules in `to-capture-draft.ts`**

Return terminal extraction failure when note id or body is absent. Return `partial` when author is missing, a declared image has no readable URL, a video note is detected, or the adapter sees fewer images than JSON-LD/OpenGraph declares. Produce user-readable entries such as `第 2 张图片无法读取` and `当前是视频笔记，首版只保存可见文字和封面`.

The v2 draft must use:

```ts
{
  sourceKind: "social_post",
  sourcePlatform: "xiaohongshu",
  scope: "web_page",
  externalRef: extraction.externalRef,
  rawText: extraction.body,
  messages: [],
  metadata: {
    adapterName: "xiaohongshu",
    adapterVersion: "1",
    canonicalUrl: extraction.canonicalUrl,
    author: extraction.author,
    capturedAt: input.capturedAt,
    assets,
  },
}
```

- [ ] **Step 6: Add the content script and safe message parser**

Define a dedicated `EXTRACT_XIAOHONGSHU` constant and return a discriminated `{ ok: true, extraction } | { ok: false, error }` result. Error responses contain only an error code and a 500-character safe message, never serialized DOM.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @recall/extension test -- lib/xiaohongshu`

Expected: PASS for complete, partial, video, missing-body, spoofed-origin and comment-exclusion cases.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/lib/xiaohongshu apps/extension/entrypoints/xiaohongshu.content.ts tests/fixtures/xiaohongshu
git commit -m "feat: extract opened Xiaohongshu notes"
```

---

### Task 6: Make Outbox v2 and Image Upload Work for Xiaohongshu

**Files:**
- Modify: `apps/extension/lib/outbox-types.ts`
- Modify: `apps/extension/lib/outbox.ts`
- Modify: `apps/extension/lib/outbox.test.ts`
- Modify: `apps/extension/lib/capture-runner.ts`
- Modify: `apps/extension/lib/capture-runner.test.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/App.test.tsx`
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/wxt.config.test.ts`
- Create: `tests/e2e/extension/xiaohongshu-capture.spec.ts`

**Interfaces:**
- Produces: durable `OutboxItem` schema version 2 and backward migration from version 1.
- Sends: typed identity and metadata to the unchanged capture HTTP routes.

- [ ] **Step 1: Write failing Outbox migration and image-failure tests**

Prove a stored unresolved schema-v1 ChatGPT item loads as v2 without losing its idempotency key, attachments, recovery chain or receipt. Prove a Xiaohongshu draft with three images becomes `partial` when image 2 returns HTTP 403 while images 1 and 3 remain uploadable and one visible-tab PNG is added as supplemental screenshot evidence.

- [ ] **Step 2: Run focused extension tests and verify failure**

Run: `pnpm --filter @recall/extension test -- lib/outbox.test.ts lib/capture-runner.test.ts entrypoints/popup/App.test.tsx wxt.config.test.ts`

Expected: FAIL because v1 is ChatGPT-only and image errors use message ordinals.

- [ ] **Step 3: Introduce `CaptureDraftV2` and migrate v1 on read**

Replace `messageOrdinal` in pending images with a generic label and ordinal:

```ts
export type PendingRemoteImage = {
  alt: string;
  clientId: string;
  fileName: string;
  ordinal: number;
  missingLabel: string;
  sourceUrl: string;
};
```

Every newly enqueued item uses `schemaVersion: 2`. `parseItems` first parses a union of v1/v2 and maps v1 as `chatgpt + ai_conversation`; write the migrated array immediately on the next mutation. Corrupt rows still raise `OutboxStorageError`; do not silently discard them.

- [ ] **Step 4: Preserve Xiaohongshu raw text during finalize**

Change `finalizedInput` to send `item.draft.rawText`. Metadata was already sent and frozen during start, so it is not sent again during finalize. Keep ChatGPT behavior covered by fingerprint and 2 MiB aggregate validation; do not duplicate the same conversation into both `rawText` and `messages`.

- [ ] **Step 5: Generalize image preparation and permission boundaries**

Build missing text from `missingLabel`; continue processing non-retryable per-image errors as partial. Keep network/429/5xx failures retryable. Permit only HTTPS image responses and revalidate `response.url` after redirects. Add exact page permission `https://www.xiaohongshu.com/*` and image permission `https://*.xhscdn.com/*`; do not use `<all_urls>`. If a real image uses another origin, return honest `partial` and review that exact origin before changing the manifest.

When at least one Xiaohongshu image has a non-retryable fetch failure, call the existing `captureVisibleTab` dependency once during the same user-triggered capture, store the PNG as `xhs-fallback-<uuid>.png`, mark it as `screenshot`/supplemental evidence in metadata, and keep the overall receipt `partial`. A screenshot never clears the missing-original-image entry and is never presented as the original image.

- [ ] **Step 6: Update popup behavior**

On an eligible note show `当前来源：小红书网页版`, only the `整篇笔记` (`web_page`) option and the existing sensitivity selector. After durable receipt show one of:

- `完整采集成功，图片识别已排队`
- `部分采集成功，已保存可用内容；请查看缺失项`
- `采集失败，原始内容仍保留在扩展待处理列表`

The popup must never show a prior ChatGPT receipt as the current Xiaohongshu result.

- [ ] **Step 7: Add fixture-driven extension E2E**

Test complete note, partial image failure with one visible screenshot fallback, browser restart recovery, duplicate click idempotency and exact-origin rejection. Use generated non-user images only.

- [ ] **Step 8: Run extension suite and build**

Run:

```bash
pnpm --filter @recall/extension test
pnpm --filter @recall/extension build
pnpm exec playwright test tests/e2e/extension/xiaohongshu-capture.spec.ts --config tests/e2e/extension/playwright.config.ts
```

Expected: PASS; built manifest contains only explicit Recall, ChatGPT, Xiaohongshu and verified CDN origins.

- [ ] **Step 9: Commit**

```bash
git add apps/extension tests/e2e/extension/xiaohongshu-capture.spec.ts
git commit -m "feat: capture Xiaohongshu images through durable outbox"
```

---

### Task 7: Add a Safe, Replaceable GLM-OCR Provider

**Files:**
- Create: `packages/contracts/src/ocr.ts`
- Create: `packages/contracts/src/ocr.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/worker/src/providers/ocr-provider.ts`
- Create: `apps/worker/src/providers/glm-ocr.ts`
- Create: `apps/worker/src/providers/glm-ocr.test.ts`
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/worker/src/config.test.ts`
- Modify: `apps/worker/.env.example`

**Interfaces:**
- Produces: `OcrProvider.recognize`, `GlmOcrProvider`, `OcrResult`.
- Consumed by: `ocr_assets` processor in Task 9.

- [ ] **Step 1: Write failing response and provider tests**

Validate success, timeout, 401/403 terminal failure, 408/429/5xx retry, malformed JSON, invalid bbox, empty Markdown and secret redaction. Assert request body uses `model: "glm-ocr"` and Base64 while logs/errors contain neither Base64 nor API key.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @recall/worker test -- src/providers/glm-ocr.test.ts src/config.test.ts && pnpm test -- packages/contracts/src/ocr.test.ts`

Expected: FAIL because the provider and contract do not exist.

- [ ] **Step 3: Define the provider-neutral result**

```ts
export type OcrRequest = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  requestId: string;
};

export type OcrResult = {
  provider: "zhipu";
  model: "glm-ocr";
  markdown: string;
  pages: Array<{ width: number; height: number }>;
  regions: Array<{
    page: number;
    index: number;
    label: "image" | "text" | "formula" | "table";
    bbox: [number, number, number, number];
    content: string;
    width: number;
    height: number;
  }>;
  requestId: string;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
};

export interface OcrProvider {
  recognize(request: OcrRequest): Promise<OcrResult>;
}
```

- [ ] **Step 4: Implement the REST adapter**

Post to `${baseUrl}/layout_parsing` with a 60-second abort timeout and:

```ts
body: JSON.stringify({
  model: "glm-ocr",
  file: `data:${request.mimeType};base64,${Buffer.from(request.bytes).toString("base64")}`,
  request_id: request.requestId,
})
```

Map errors to `OcrProviderError { code, retryable, httpStatus }`. Error messages may contain only provider name, HTTP status and safe code.

- [ ] **Step 5: Add server-only configuration**

Add:

```env
ZHIPU_API_KEY=
GLM_OCR_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_OCR_MODEL=glm-ocr
GLM_OCR_TIMEOUT_MS=60000
ALLOW_SENSITIVE_EXTERNAL_AI=false
```

Validate model is exactly `glm-ocr`, base URL is HTTPS outside loopback, timeout is 5,000–120,000 ms, and the key is non-empty. Reject all `NEXT_PUBLIC_`/`WXT_PUBLIC_` secret aliases as the current config already does.

- [ ] **Step 6: Run provider tests**

Run: `pnpm --filter @recall/worker test -- src/providers/glm-ocr.test.ts src/config.test.ts && pnpm test -- packages/contracts/src/ocr.test.ts`

Expected: PASS without live paid calls.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/ocr* packages/contracts/src/index.ts apps/worker/src/providers apps/worker/src/config* apps/worker/.env.example
git commit -m "feat: add GLM OCR provider boundary"
```

---

### Task 8: Persist OCR Results With Ancestry, Idempotency and RLS

**Files:**
- Create: `supabase/migrations/202609080002_stage_2c_ocr_pipeline.sql`
- Create: `supabase/tests/014_stage_2c_ocr_pipeline.test.sql`
- Regenerate: `apps/web/src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces: table `asset_ocr_results`; RPC `persist_asset_ocr_result`; permits job type `ocr_assets`.
- Consumed by: Worker repository, evidence builder and Web capture details.

- [ ] **Step 1: Write failing pgTAP tests**

Prove all of the following:

- only an active owner/space/version-matched OCR job may write;
- the attachment must belong to that source version and owner;
- repeating the same attachment SHA/provider/model returns the existing result;
- changed SHA creates no overwrite of the previous immutable result;
- account B cannot read account A’s OCR rows;
- completing all image OCR rows enqueues exactly one `build_source_blocks` job;
- `ocr_assets` is allowed by the processing job constraint.

- [ ] **Step 2: Run pgTAP and verify failure**

Run: `pnpm supabase test db --local supabase/tests/014_stage_2c_ocr_pipeline.test.sql`

Expected: FAIL because OCR storage and RPC do not exist.

- [ ] **Step 3: Create immutable OCR result storage**

Create `asset_ocr_results` with these required columns:

```sql
id uuid primary key default gen_random_uuid(),
owner_user_id uuid not null references auth.users(id) on delete cascade,
space_id uuid not null,
source_item_id uuid not null,
source_version_id uuid not null,
source_attachment_id uuid not null,
processing_run_id uuid not null,
input_sha256 text not null,
provider text not null,
model text not null,
provider_request_id text not null,
markdown_text text not null,
layout_details jsonb not null,
data_info jsonb not null,
usage_json jsonb,
created_at timestamptz not null default now()
```

Add composite ancestry foreign keys, 64 KiB layout/data limits, 1 MiB Markdown limit and unique `(source_attachment_id, input_sha256, provider, model)`. Enable RLS; authenticated owners may select, service role may write.

- [ ] **Step 4: Extend queue types and add transactional persistence RPC**

Allow `ocr_assets`. `persist_asset_ocr_result` must call the existing lease/ancestry assertions, insert-or-return the immutable OCR row, and never mark the job complete. `enqueue_followup_processing_job` remains the only path that creates `build_source_blocks` after the processor confirms every eligible image has a result.

- [ ] **Step 5: Extend block persistence to accept attachment links**

Update `replace_source_blocks_and_enqueue_extract` so each block DTO may include nullable `source_attachment_id`. For an `ocr_region`, insert `source_asset_links(relation_type='ocr_source')` in the same transaction. Reject an attachment from another version/owner/space.

- [ ] **Step 6: Run all database tests and regenerate types**

Run:

```bash
pnpm supabase db reset --local
pnpm supabase test db --local
pnpm supabase gen types typescript --local --schema public > apps/web/src/lib/supabase/database.types.ts
```

Expected: every pgTAP file passes.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202609080002_stage_2c_ocr_pipeline.sql supabase/tests/014_stage_2c_ocr_pipeline.test.sql apps/web/src/lib/supabase/database.types.ts
git commit -m "feat: persist OCR evidence with tenant ancestry"
```

---

### Task 9: Run OCR in the Existing Worker and Build Image Evidence

**Files:**
- Create: `apps/worker/src/repositories/ocr-repository.ts`
- Create: `apps/worker/src/repositories/ocr-repository.test.ts`
- Create: `apps/worker/src/processors/ocr-assets.ts`
- Create: `apps/worker/src/processors/ocr-assets.test.ts`
- Modify: `apps/worker/src/processors/normalize-source.ts`
- Modify: `apps/worker/src/processors/normalize-source.test.ts`
- Modify: `apps/worker/src/processors/build-source-blocks.ts`
- Modify: `apps/worker/src/processors/build-source-blocks.test.ts`
- Modify: `apps/worker/src/processors/extract-knowledge.ts`
- Modify: `apps/worker/src/processors/extract-knowledge.test.ts`
- Modify: `apps/worker/src/repositories/source-repository.ts`
- Modify: `apps/worker/src/worker-loop.ts`
- Modify: `apps/worker/src/worker-loop.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `OcrProvider`, `asset_ocr_results`, private Storage.
- Produces: complete `ocr_assets` runs, Xiaohongshu evidence blocks and existing `extract_knowledge` jobs.

- [ ] **Step 1: Write failing worker tests for routing and idempotency**

Cover:

- ChatGPT `normalize_source → build_source_blocks` remains unchanged;
- Xiaohongshu `normalize_source → ocr_assets`;
- no-image Xiaohongshu post skips OCR and goes directly to block build with a partial reason;
- an existing matching OCR result skips the paid API call;
- WebP is converted to PNG before provider call;
- two eligible images produce two persisted results and one follow-up job;
- retry after image 2 fails does not call image 1 again;
- sensitive input pauses when `ALLOW_SENSITIVE_EXTERNAL_AI=false` and runs when true;
- OCR blocks preserve image ordinal, page, bbox, provider and attachment id.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @recall/worker test -- src/processors/ocr-assets.test.ts src/processors/normalize-source.test.ts src/processors/build-source-blocks.test.ts src/worker-loop.test.ts`

Expected: FAIL because the OCR processor and social-post normalization do not exist.

- [ ] **Step 3: Implement storage and OCR repository methods**

Expose:

```ts
interface OcrRepository {
  downloadAttachment(job: ClaimedJob, attachmentId: string): Promise<Uint8Array>;
  findResult(input: { attachmentId: string; inputSha256: string; provider: string; model: string }): Promise<PersistedOcrResult | null>;
  persistResult(job: ClaimedJob, attachment: ClaimedAttachment, result: OcrResult): Promise<PersistedOcrResult>;
}
```

Before Storage download, verify the attachment row belongs to job owner/version. Verify downloaded SHA-256 equals the database SHA. Do not create or log signed URLs.

- [ ] **Step 4: Implement the OCR processor**

Sort images by `metadata.assets[].ordinal`; process at concurrency 2. Accept JPEG/PNG directly and use Sharp to convert WebP to PNG. Reject other MIME types as non-retryable. Before each paid call check `findResult`; after each result call the persistence RPC. Aggregate usage without storing image bytes:

```ts
return {
  resultSummary: `recognized ${completed} of ${eligible} images`,
  usageJson: { images: completed, inputTokens, outputTokens, totalTokens },
};
```

Only after every eligible image has a stored result enqueue `build_source_blocks`.

- [ ] **Step 5: Add automatic heartbeat around every processor**

Add `heartbeatIntervalMs` to `WorkerLoopOptions` and pass `Math.max(5_000, Math.floor(config.leaseSeconds * 1_000 / 3))` from `main.ts`. In `runWorkerLoop`, start one serialized heartbeat loop for the active job, stop it before `complete/fail`, and treat heartbeat ownership loss as a processing failure. Add fake-timer tests proving a 130-second OCR call retains its lease and no timer survives completion.

- [ ] **Step 6: Normalize and build Xiaohongshu blocks**

Define a normalized social post with body, author, canonical URL and ordered OCR results. Create stable locators:

```text
post:body
post:metadata
image:<attachment-client-id>/page:<page>/region:<index>
```

Create one `paragraph` block for body, one `metadata` block for author/canonical URL, and one `ocr_region` block for every non-empty text/formula/table region. Hash normalized content plus bbox. Link each OCR block to its original attachment using `ocr_source`.

Expand `SourceBlockDraft` explicitly instead of forcing social content into message fields:

```ts
export type SourceBlockDraft = {
  sourceMessageId: string | null;
  sourceAttachmentId: string | null;
  blockType: "message" | "paragraph" | "metadata" | "ocr_region";
  ordinal: number;
  locatorKey: string;
  locatorJson: Record<string, unknown>;
  textContent: string;
  contentHash: string;
};
```

Extend `loadClaimedSource` (or add a focused repository method called by the block processor) to read only OCR rows belonging to the claimed owner, space and version. Do not query OCR rows by attachment id alone.

- [ ] **Step 7: Allow existing knowledge extraction to consume verified social-post blocks**

Replace the ChatGPT-only source guard with an allow-list of:

```ts
const EXTRACTABLE_SOURCES = new Set([
  "chatgpt:ai_conversation",
  "xiaohongshu:social_post",
]);
```

Pass block type and a neutral role (`source`) to the prompt instead of assuming every block is a chat message. Keep locator validation and human review unchanged.

- [ ] **Step 8: Register provider and processor**

Instantiate `GlmOcrProvider` only in Worker `main.ts`, register `ocr_assets`, and add direct dependency `sharp: "0.34.5"`. No other package may import the API key.

- [ ] **Step 9: Run Worker and monorepo tests**

Run:

```bash
pnpm --filter @recall/worker test
pnpm --filter @recall/worker typecheck
pnpm test
```

Expected: PASS with all provider calls mocked.

- [ ] **Step 10: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat: process Xiaohongshu images with GLM OCR"
```

---

### Task 10: Make OCR Progress and Failures Visible in Web

**Files:**
- Modify: `apps/web/src/features/capture/server/get-capture-status.ts`
- Create: `apps/web/src/features/capture/server/processing-summary.ts`
- Create: `apps/web/src/features/capture/server/processing-summary.test.ts`
- Modify: `apps/web/src/features/capture/server/list-captures.ts`
- Modify: `apps/web/src/features/capture/server/list-captures.test.ts`
- Modify: `apps/web/src/features/capture/server/list-exceptions.ts`
- Modify: `apps/web/src/features/capture/server/list-exceptions.test.ts`
- Modify: `apps/web/src/app/(app)/captures/[sourceItemId]/page.tsx`
- Modify: `apps/web/src/app/(app)/exceptions/page.tsx`
- Create: `tests/e2e/web/xiaohongshu-ocr.spec.ts`

**Interfaces:**
- Produces: deterministic source-version processing summary and visible OCR evidence/failure states.
- Fixes: a failed OCR/extract job can no longer be masked by another completed job for the same version.

- [ ] **Step 1: Write failing aggregation tests**

Use the exact precedence `failed > processing > queued > paused > complete`. Assert the selected failure includes job type and the most recent failure time:

```ts
expect(summarizeProcessingJobs([
  { jobType: "normalize_source", status: "complete", failureReason: null, updatedAt: "2026-09-08T01:00:00Z" },
  { jobType: "ocr_assets", status: "failed", failureReason: "provider timeout", updatedAt: "2026-09-08T01:01:00Z" },
])).toMatchObject({ status: "failed", failedJobType: "ocr_assets" });
```

- [ ] **Step 2: Run focused Web tests and verify failure**

Run: `pnpm --filter @recall/web test -- src/features/capture/server`

Expected: FAIL because jobs are currently collapsed with an unordered `Map` or queried with `.single()`.

- [ ] **Step 3: Implement one shared processing aggregator**

All capture list/detail/status/exception queries must select `job_type, status, failure_reason, updated_at`. Remove direct `new Map(jobs.map(...))` and `.single()` assumptions. The aggregator returns `complete` only when at least one job exists and every current pipeline job is complete.

- [ ] **Step 4: Display clear OCR state and evidence**

Capture details show:

- original image through a 60-second signed download URL;
- `等待图片识别` / `正在识别第 N 张` / `图片识别完成` / `图片识别失败`;
- OCR Markdown as escaped text, never `dangerouslySetInnerHTML`;
- region page and bbox next to the excerpt;
- provider/model/request id and token counts without secret values.

The exception page labels `ocr_assets` as `图片识别失败`, states `原图和正文已安全保存`, and links to the saved source. No dismiss action is added in this plan.

- [ ] **Step 5: Add Web E2E for success and failure**

Seed synthetic image/OCR rows and prove account A sees its image and OCR failure while account B receives no row and cannot open the source URL. Test the mixed state where normalize is complete but OCR failed.

- [ ] **Step 6: Run Web tests and build**

Run:

```bash
pnpm --filter @recall/web test
pnpm --filter @recall/web typecheck
pnpm --filter @recall/web build
```

Expected: PASS and no React hydration or unsafe HTML warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/capture apps/web/src/app/'(app)'/captures apps/web/src/app/'(app)'/exceptions tests/e2e/web/xiaohongshu-ocr.spec.ts
git commit -m "feat: surface Xiaohongshu OCR progress and failures"
```

---

### Task 11: Extend Backup and Recovery Before Real Images Accumulate

**Files:**
- Modify: `scripts/local-backup.mjs`
- Modify: `scripts/verify-local-backup.mjs`
- Create: `scripts/local-backup.test.ts`
- Modify: `docs/runbooks/local-data-backup-and-restore.md`

**Interfaces:**
- Produces: backup manifest covering all Stage 0–2C facts and every Storage object.

- [ ] **Step 1: Write a failing manifest test**

Require these tables at minimum: `spaces`, `space_members`, `source_items`, `capture_sessions`, `source_versions`, `source_messages`, `source_attachments`, `source_blocks`, `source_asset_links`, `asset_ocr_results`, `processing_jobs`, `processing_runs`, `knowledge_items`, `knowledge_versions`, `citations`, `review_tasks`. Require pagination beyond 1,000 Storage objects.

- [ ] **Step 2: Run the script test and verify failure**

Run: `pnpm test -- scripts/local-backup.test.ts`

Expected: FAIL because the current scripts omit Stage 1/2C tables and only list the first Storage page.

- [ ] **Step 3: Extend export, pagination and verification**

Record row count, SHA-256 and export path per table; iterate Storage list pages until fewer than the page size; record object count, path, bytes and SHA-256. Verification must compare manifest counts and hashes, not only JSON shape.

- [ ] **Step 4: Verify against a disposable populated database**

Run:

```bash
pnpm backup:local
pnpm backup:verify
```

Expected: verifier reports every required table and all synthetic image objects; no secret values appear in the archive manifest.

- [ ] **Step 5: Commit**

```bash
git add scripts docs/runbooks/local-data-backup-and-restore.md
git commit -m "fix: back up knowledge and OCR evidence completely"
```

---

### Task 12: Complete Stage 2C Automated and Real Acceptance

**Files:**
- Create: `docs/runbooks/stage-2c-xiaohongshu-glm-ocr.md`
- Modify: `docs/superpowers/plans/2026-09-08-stage-2c-xiaohongshu-glm-ocr.md` — check completed steps only after evidence exists.
- Modify: `docs/runbooks/milestone-a-acceptance.md` only if a real regression changes an existing recorded result; do not rewrite historical counts.

**Interfaces:**
- Produces: reproducible setup, sanitized evidence and signed Stage 2C exit record.

- [ ] **Step 1: Write the runbook before using a real API key**

Document exact environment variable names, how to create a restricted key, how to set `ALLOW_SENSITIVE_EXTERNAL_AI`, how to install the unpacked extension in Chrome and Edge, how to inspect Outbox, Worker runs, OCR rows and Web exceptions, and how to revoke/rotate the key. Never include an actual credential, full image Base64, signed URL or sensitive note content.

- [ ] **Step 2: Record the supplier-policy gate explicitly**

Link the current智谱隐私政策 and record the user’s account/contract decision about training and retention. The public policy currently allows anonymized information to be used to improve services, including machine-learning/model training, and states retention is for the shortest necessary period rather than zero retention. Do not claim “不用于训练/零留存” unless the user’s actual account agreement or console setting proves it. If the evidence is absent, limit real acceptance to non-sensitive samples even though the code supports the sensitivity switch.

- [ ] **Step 3: Run the full automated gate**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm supabase test db --local
pnpm exec playwright test tests/e2e/extension/chatgpt-capture.spec.ts tests/e2e/extension/xiaohongshu-capture.spec.ts --config tests/e2e/extension/playwright.config.ts
pnpm exec playwright test tests/e2e/web/xiaohongshu-ocr.spec.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Perform one minimal live GLM-OCR smoke test**

Use one generated PNG containing known Chinese text. Confirm the stored `request_id`, model, usage, Markdown and region coordinates; confirm the API key and Base64 are absent from logs. Record only generated text and counts.

- [ ] **Step 5: Perform real browser acceptance in Chrome and Edge**

Use at least 10 supported, user-authorized Xiaohongshu image-note attempts across both browsers:

- at least 6 complete notes;
- at least 2 notes with multiple images;
- at least 1 intentionally blocked image producing honest partial;
- at least 1 network/API failure followed by retry or visible terminal failure.

Record complete/partial/failed/retry-recovered counts separately. Stage 2C passes when at least 90% of supported attempts either complete automatically or produce an accurate partial/failed state with no false-success and no lost saved content. Do not count video notes or access-denied pages as supported complete-image attempts.

- [ ] **Step 6: Verify evidence and knowledge traceability**

For two successful notes, open a generated knowledge draft, follow every citation to either `post:body` or an `image:<client-id>/page:<n>/region:<n>` locator, and confirm the corresponding original image is viewable only by its owner.

- [ ] **Step 7: Verify ChatGPT has no regression**

Capture one complete ChatGPT conversation and one partial missing-image fixture. Confirm durable receipt, Outbox recovery, knowledge extraction and edit/confirm behavior remain unchanged.

- [ ] **Step 8: Commit the runbook and acceptance evidence**

```bash
git add docs/runbooks/stage-2c-xiaohongshu-glm-ocr.md docs/superpowers/plans/2026-09-08-stage-2c-xiaohongshu-glm-ocr.md
git commit -m "docs: record Stage 2C acceptance"
```

---

## Stage 2C Exit Criteria

- Chrome 和 Edge 均能在用户当前打开的小红书图文笔记上点击一次完成采集。
- 服务器 durable receipt 前扩展不显示采集成功。
- 标题、正文、作者、canonical URL 和每张成功获取的原图均保存在用户私人空间。
- 评论内容没有进入正文、OCR 或知识提取输入。
- 图片获取不完整时状态为 `partial`，缺失项具体且 Web 异常页可见。
- 图片原件不可读时，同一次点击最多保存一张当前可见页面截图作为补充证据；截图不冒充原图，也不把 `partial` 改成 `complete`。
- GLM-OCR 只由 Worker 使用 server-only key 调用；请求体使用私有 Storage 字节生成的 Base64。
- OCR Markdown、区域坐标、模型、请求 id 和用量可追溯，且每个 OCR 证据块可回到原图。
- OCR/DeepSeek 最终失败不会被其他已完成 job 掩盖，Web 异常页明确显示失败步骤。
- 重试不重复收费处理已有相同 SHA/provider/model 的 OCR 结果。
- 两账户隔离覆盖原图、OCR、证据块、知识卡片、处理运行和异常。
- 现有 ChatGPT 采集、Outbox、知识审核和全部自动化测试保持通过。
- 真实支持样本达到至少 10 次，诚实完成率不低于 90%，且 false-success 为 0。
- Stage 2C 通过后再编写 Stage 3 语义搜索实施计划；不在本计划中顺手实现 Embedding 或问答。

## Execution Notes

- 从远端最新 `master` 创建 `codex/stage-2c-xiaohongshu-ocr` 工作树执行；不要在保存真实数据的工作目录直接试验迁移。
- 每个任务完成后先进行规格符合性审查，再进行代码质量审查；修复后才进入下一任务。
- 实施期间如果真实小红书页面结构与合成夹具不同，只更新该平台适配器和夹具；不得降低 complete/partial/failed 语义或扩大权限到 `<all_urls>`。
- 若智谱 API 合同发生变化，先更新本计划引用、契约测试和 provider 适配器，再继续实现；不得在调用点散落供应商字段。
- 本计划完成不代表 Stage 3 或个人云端部署完成。Stage 3 语义搜索和个人云端部署各自建立独立计划与验收记录。
