# Stage 2C 小红书采集与 GLM-OCR 运行手册

本文说明如何在本机配置 Stage 2C、检查 Outbox / Worker / OCR / Web 异常，以及如何做自动化门禁与后续真实验收。本文档不包含任何真实凭据、图片 Base64、signed URL 或敏感笔记原文。

真实验收（真实 `ZHIPU_API_KEY`、付费调用、恢复暂停任务、真实小红书账号、重新加载扩展、Chrome/Edge 十次页面验收）必须单独授权后才能执行。自动化测试通过不能写成真实验收通过。

## 1. 范围

Stage 2C 只覆盖：

- 用户当前打开且有权查看的单篇小红书图文笔记；
- 标题、正文、作者、canonical URL 与可见原图的 durable 保存；
- Worker 使用 server-only 智谱 GLM-OCR 识别原图文字与区域；
- Web 展示 OCR 进度、结果和失败，且不得掩盖 `ocr_assets` 失败。

不覆盖：DeepSeek 网页版、豆包、微信、普通网页、GitHub、文件解析、语义搜索、知识问答、知识地图、批量爬取、评论采集或绕过登录/验证码。

相关手册：

- 本地栈与扩展安装：`docs/runbooks/milestone-a-local.md`
- Worker 启停与队列观察：`docs/runbooks/knowledge-worker-local.md`
- 备份与临时恢复：`docs/runbooks/local-data-backup-and-restore.md`

## 2. 环境变量名称

Worker 环境文件：`apps/worker/.env`（已被 Git 忽略）。模板：`apps/worker/.env.example`。只在编辑器中填写，不要用 `echo` 把密钥打进终端历史或聊天。

Stage 2C 新增/相关名称：

```text
ZHIPU_API_KEY
GLM_OCR_BASE_URL
GLM_OCR_MODEL
GLM_OCR_TIMEOUT_MS
ALLOW_SENSITIVE_EXTERNAL_AI
```

规则：

- `ZHIPU_API_KEY` 只允许出现在 Worker 进程环境。禁止 `NEXT_PUBLIC_ZHIPU_API_KEY`、`WXT_PUBLIC_ZHIPU_API_KEY`、浏览器、扩展构建和 Git。
- `GLM_OCR_BASE_URL` 默认 `https://open.bigmodel.cn/api/paas/v4`，必须是公网 HTTPS。
- `GLM_OCR_MODEL` 只能是 `glm-ocr`。
- `GLM_OCR_TIMEOUT_MS` 默认 `60000`，允许范围 5000–120000。
- `ALLOW_SENSITIVE_EXTERNAL_AI` 只接受 `true` 或 `false`；缺省为 `false`。为 `false` 时，敏感/严格敏感资料的 `ocr_assets` 进入 `paused`，不得丢弃原文或原图。
- 未获用户明确授权前，不要把该开关改成 `true`，也不要写入真实 `ZHIPU_API_KEY` 后启动会领取已暂停任务的 Worker。

Web 与扩展变量仍按 Milestone A 手册配置。扩展不得包含智谱密钥。

## 3. 创建受限密钥并轮换

1. 在智谱开放平台控制台单独创建一把只给本机 Worker 使用的 API Key，不要复用浏览器、CI 或其他产品的密钥。
2. 若控制台支持按模型或接口限制，只开通 GLM-OCR / `layout_parsing` 所需权限；不要开通无关模型。
3. 把密钥写入 `apps/worker/.env` 的 `ZHIPU_API_KEY=`，保存后不要把文件加入 Git。
4. 启动 Worker 前确认进程环境没有 `NEXT_PUBLIC_*` / `WXT_PUBLIC_*` 形式的智谱变量。
5. 轮换：在控制台创建新密钥 → 写入 `.env` → 停止旧 Worker → 启动新 Worker → 在控制台立即禁用/删除旧密钥。
6. 日志、Playwright 输出、备份 `manifest.json` 和 Git 中都不得出现该密钥、Bearer token 或图片 Base64。

未授权前不要执行第 3–6 步中会触发真实调用的部分。

## 4. 敏感资料外发开关

代码支持把普通、敏感和严格敏感图片发给已配置的合规第三方 OCR API，但必须同时满足：

1. 用户已明确允许该类资料外发；
2. `ALLOW_SENSITIVE_EXTERNAL_AI=true`。

否则 Worker 将敏感 OCR 标记为 `paused`，原文、原图和已有证据保持可查看。不要为了“跑通验收”而自行打开该开关或恢复已暂停任务。

## 5. 安装未打包扩展（需用户授权后才执行）

构建正式 Manifest V3 目录：

```powershell
pnpm --filter @recall/extension build
```

输出：`apps/extension/.output/chrome-mv3`。不要设置 `WXT_TEST_BUILD` 或 `WXT_TEST_FIXTURE_ORIGIN`。

Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择上述目录。

Edge：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → 同一目录。

代码或 `WXT_PUBLIC_*` 变化后需要重新构建并在扩展页点击“重新加载”。本阶段自动化门禁不得代替这一步；未经授权不要安装或重新加载扩展。

配对步骤见 `docs/runbooks/milestone-a-local.md` 第 9 节。

## 6. 检查 Outbox、Worker、OCR 与 Web 异常

只读检查。不要在开发者工具里修改 Outbox，不要 `UPDATE`/`DELETE` 现有 `processing_jobs`，不要对 `127.0.0.1:55322` 执行 restore 或 reset。

### 6.1 扩展 Outbox

- 工具栏角标为未解决数量。
- 弹窗“待处理异常”列出尚未取得 durable receipt 的项。
- Outbox 键：`recall.captureOutbox`；未解决计数：`recall.outbox.unresolvedCount`。
- 附件 Blob 在 IndexedDB `recall.capture-attachments.v1`。
- 采集成功只表示服务器已确认标题/正文/作者/链接/已获取图片；OCR 失败不得显示成采集失败或采集成功被撤销。

### 6.2 Worker 与 OCR 行

```sql
select id, job_type, status, attempt_count, next_attempt_at, locked_by
from public.processing_jobs
where job_type in ('normalize_source', 'ocr_assets', 'build_source_blocks', 'extract_knowledge')
order by next_attempt_at;

select id, processor_type, status, provider, model, usage_json, error_code
from public.processing_runs
where processor_type = 'ocr_assets'
order by started_at desc
limit 20;

select id, provider, model, request_id, token_input, token_output
from public.asset_ocr_results
order by created_at desc
limit 20;
```

不要选择 `raw_text`、消息正文、OCR Markdown 全文、`error_detail` 长文本或 Storage 对象名。`usage_json` 只记录 token 计数。

### 6.3 Web

- 采集详情：原图通过 60 秒 signed URL 查看；状态文案为 `等待图片识别` / `正在识别第 N 张` / `图片识别完成` / `图片识别失败`。
- OCR Markdown 必须作为转义文本渲染，禁止 `dangerouslySetInnerHTML`。
- 异常页将 `ocr_assets` 标为 `图片识别失败`，并说明原图和正文已保存。
- 聚合优先级：`failed > processing > queued > paused > complete`。同版本存在失败的 `ocr_assets` 时，不得因为其他任务已完成而显示成功。

## 7. 供应商政策门禁

查阅日期：2026-10-19。

公开文档：

- 隐私政策：https://docs.bigmodel.cn/cn/terms/privacy-policy （标注最新版本生效日期 2025-05-20）
- 用户协议：https://docs.bigmodel.cn/cn/terms/user-agreement
- 服务协议：https://docs.bigmodel.cn/cn/terms/service-agreement
- 模型说明：https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr
- API：`POST https://open.bigmodel.cn/api/paas/v4/layout_parsing`

公开政策要点（不是本仓库账号合同）：

- 对已匿名化、无法重新识别特定个人的数据，政策允许用于改善产品和服务，包括机器学习或模型算法训练。
- 个人信息存储期限为达成本政策所述目的所需的最短必要期限，法律法规另有强制留存要求的除外。这不是“零留存”。
- 用户协议允许平台利用使用过程中产生的数据定位、维护和优化产品与服务，除非双方另有约定。
- 控制台“数据内容不留存”若存在，需要用户在智谱 MaaS 控制台申请开通，且 Batch/File API 与合规核查场景仍可能留存。本仓库没有该账号已开通的证据。

本仓库账号/合同决定：

| 项目 | 状态 |
| --- | --- |
| 已核验的控制台“不留存”开关 | 未提供证据 |
| 已签署的零留存/禁止训练合同条款 | 未提供证据 |
| 因此可宣称“不用于训练/零留存” | 否 |
| 未授权前的真实验收样本范围 | 仅限用户另行授权的非敏感样本 |

在用户出示控制台设置或合同证据之前，即使代码支持 `ALLOW_SENSITIVE_EXTERNAL_AI`，真实验收也必须限制为非敏感样本。

## 8. 自动化门禁记录

以下命令在仓库根目录执行。供应商请求测试默认使用 mock，不读取真实 `ZHIPU_API_KEY` 发网。`pnpm supabase test db --local` 在事务中跑 pgTAP，不是 `db reset`。

| 检查 | 结果 | 日期 | 摘要 |
| --- | --- | --- | --- |
| `pnpm test` | PASS | 2026-10-19 | 61 个测试文件、413 项测试通过；供应商请求均为 mock |
| `pnpm typecheck` | PASS | 2026-10-19 | 5 个工作区 `tsc --noEmit` 通过 |
| `pnpm lint` | PASS | 2026-10-19 | 工作区通过；Web 有 1 条 `@next/next/no-img-element` 警告（私有 signed URL 原图使用 `<img>`），0 error |
| `pnpm build` | PASS | 2026-10-19 | contracts/domain/extension/worker/web 生产构建通过 |
| `pnpm supabase test db --local` | PASS | 2026-10-19 | 15 个 pgTAP 文件、198 项断言通过；未执行 `db reset` |
| Playwright 扩展 E2E（合成夹具） | PASS | 2026-10-19 | `chatgpt-capture.spec.ts` 与 `xiaohongshu-capture.spec.ts` 共 2 项通过。这是 Playwright 加载的临时测试扩展 + 合成页面，不是 Chrome/Edge 真实验收 |
| `tests/e2e/web/xiaohongshu-ocr.spec.ts` | PASS | 2026-10-19 | 2 项通过：账号隔离与 mixed OCR 失败可见。OCR 行由本地 postgres 写入合成账号，无智谱付费调用 |
| `git diff --check` | PASS | 2026-10-19 | 无空白错误 |

状态含义与 Milestone A 验收模板相同：`PASS` / `FAIL` / `BLOCKED` / `NOT RUN`。`PENDING` 表示本轮正在填写。不得把上表 PASS 抄进第 9 节当作真实验收通过。

## 9. 真实验收（未执行）

下列步骤全部为 `NOT RUN`，需用户明确授权后才执行：

1. 写入真实 `ZHIPU_API_KEY` 并启动会领取 `ocr_assets` 的 Worker。
2. 对一张含已知中文的生成 PNG 做一次最小付费 GLM-OCR 冒烟；只记录 `request_id`、model、usage 计数和生成文字是否出现，不记录 Base64 或密钥。
3. 恢复当前为避免费用而暂停的处理任务。
4. 在真实小红书账号上打开真实笔记（含敏感笔记则额外需要敏感外发授权）。
5. 安装或重新加载 Chrome/Edge 未打包扩展。
6. Chrome 与 Edge 合计至少 10 次受支持图文笔记：至少 6 次完整、2 次多图、1 次诚实 partial、1 次网络/API 失败后的重试或可见终态；视频笔记和无权访问页不计为受支持完整图文尝试。
7. 对两篇成功笔记核验知识草稿引用可回到 `post:body` 或 `image:<client-id>/page:<n>/region:<n>`，且原图仅所有者可看。
8. 回归一篇完整 ChatGPT 会话和一篇缺图 partial。
9. 对真实数据库应用高风险迁移，或任何可能修改/删除现有用户数据的操作。

Stage 2C 退出标准在上述步骤完成且受支持尝试至少 90% 自动完整或准确 partial/failed、无假成功、无丢失已保存内容之前，不得标记为已满足。

## 10. 授权后的最小操作清单

用户授权时应明确列出允许项。建议最小集合：

1. 是否允许把一把受限 `ZHIPU_API_KEY` 写入 `apps/worker/.env`。
2. 是否允许一次非敏感生成 PNG 的付费 GLM-OCR 冒烟。
3. 是否允许恢复哪些 `paused`/`failed` 任务（按 job id，而不是“全部恢复”）。
4. 是否允许安装/重新加载正式 `chrome-mv3` 扩展。
5. 是否允许在用户当前已登录、已授权的小红书图文笔记上做 Chrome/Edge 十次采集。
6. 样本是否全部为非敏感；若包含敏感/严格敏感，是否同时把 `ALLOW_SENSITIVE_EXTERNAL_AI` 设为 `true`。

未列出的项视为未授权。
