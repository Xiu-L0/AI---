# Stage 0–1B Execution Scope Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the referenced Stage 0–1B plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改写已确认设计和原实施计划的前提下，记录 Stage 0–1B 当前执行范围、可简化工作、延期事项、禁止删除事项和后续范围变更历史。

**Architecture:** 原始设计和 Stage 0、1A、1B 实施计划保持为不可改写的基线文档；本文件作为当前执行口径和增量决策日志。这里可以缩小当前交付范围或明确实现方式，但不能降低数据安全、所有权隔离、durable receipt、引用完整性和人工修改保护等既有约束。

**Tech Stack:** 文档治理、Git 提交历史、Recall AI 现有 pnpm TypeScript monorepo。

## Global Constraints

- 不通过修改原设计或原实施计划来掩盖范围变化；后续决策追加到本文件的“决策历史”。
- 不物理删除现有代码、迁移、测试、真实验收记录或历史设计文档，除非另有经过用户确认的专项删除决策。
- 本文件只能缩小或排序当前范围，不能降低已通过验证的可靠采集、安全、恢复和数据隔离约束。
- 当前实现范围是 Stage 0、Stage 1A 和 Stage 1B；Stage 2–5 不进入本轮开发。
- 数据安全优先：在 Stage 0 备份和关键恢复门禁通过前，不向保存真实数据的本地 Supabase 应用 Stage 1A 业务迁移。
- 每个原计划 Task 仍须有聚焦测试、变更审查和独立 Git 提交；已有实现通过对应测试时，不重复改写生产代码。

---

## 1. 基线文档与阅读顺序

执行者必须按以下顺序阅读：

1. `docs/superpowers/specs/2026-08-11-personal-knowledge-system-final-design.md`
2. `docs/superpowers/plans/2026-08-11-stage-0-data-safety-and-capture-closeout.md`
3. `docs/superpowers/plans/2026-08-11-stage-1a-knowledge-schema.md`
4. `docs/superpowers/plans/2026-08-11-stage-1b-knowledge-processing-and-review.md`
5. 本文件：`docs/superpowers/plans/2026-08-12-stage-0-to-1b-execution-scope.md`

现有 Milestone A 文档继续有效：

- `docs/plans/2026-07-29-personal-ai-knowledge-system-design.md`
- `docs/plans/2026-07-29-reliable-capture-milestone-a.md`
- `docs/runbooks/milestone-a-local.md`
- `docs/runbooks/milestone-a-acceptance.md`

若本文件与基线计划在“当前是否实施”上不一致，以本文件的较窄范围为准；若涉及数据安全、权限、可靠性、证据、审计或人工保护，以约束更严格者为准。

## 2. 当前必须完成的范围

### 2.1 Stage 0：数据安全与可靠采集收口

必须完成：

- 本地 PostgreSQL、Storage 和必要元数据的非破坏性备份。
- 备份清单、SHA-256、对象完整性和一次性恢复目标验证。
- 不支持页面不得把历史成功回执显示为当前页面结果。
- 附件上传完成但 finalize 中断的恢复测试。
- 截图采集或本地附件存储失败时保留原 partial 状态和重试能力。
- 现有 lint、typecheck、单元测试、构建、E2E、pgTAP 和 manifest/密钥门禁。
- 真实验收历史 `16/23` 原样保留；新发布候选窗口单独记录。

允许的简化：

- Stage 0 Task 4 和 Task 5 先只增加精确边界测试。
- 如果测试证明现有生产代码已满足要求，只提交测试和证据，不改写生产逻辑。
- 30 次发布候选真实采集继续作为质量窗口记录，不得通过删除旧样本或修改分母制造通过结果。
- 30 次质量窗口不是创建知识表和 Worker 的代码工作；但已知 false-complete、数据丢失或不可恢复缺陷仍是迁移前阻断项。

### 2.2 Stage 1A：知识与证据数据基础

必须完成：

- 每个用户唯一的服务端创建私人空间和 owner membership。
- 现有 `source_items`、`processing_jobs` 的非破坏性 `space_id` 回填。
- `source_blocks`、`source_asset_links`。
- `knowledge_items`、不可变 `knowledge_versions`。
- `citations`、`review_tasks`。
- owner/space/source ancestry 的复合外键、约束和 RLS。
- 正式知识的证据约束和个人推断例外。
- TypeScript/Zod 契约及纯知识生命周期规则。
- capture finalize 公共契约保持兼容，空间由服务端解析。
- 生成数据库类型并记录迁移前后只读计数。

允许的简化：

- 当前只实际创建 `private` 空间和唯一 owner 成员。
- `shared`、`editor`、`viewer` 只保留计划要求的枚举和约束，不开发 UI、邀请或协作 API。
- 不为未来功能建立没有当前写入/读取闭环的空表。
- 默认私人空间创建必须幂等；不得在客户端接受任意 `spaceId`，也不得把某一用户的空间结果全局缓存给其他用户。

### 2.3 Stage 1B：首条 ChatGPT 知识纵向闭环

必须完成：

- 独立 TypeScript Worker。
- PostgreSQL 原子领取、租约、重试、终止失败和运行记录。
- `normalize_source → build_source_blocks → extract_knowledge` 幂等处理链。
- Stage 1B 首版每条 ChatGPT 消息对应一个稳定 evidence block。
- DeepSeek V4 可替换文本模型提供商边界。
- `deepseek-v4-flash` 默认模型和 `deepseek-v4-pro` 环境配置选项。
- JSON 模式、Zod 校验、locator 校验和一次受控结构修复。
- 草稿、版本、引用和审核任务全有或全无的原子写入。
- Web 知识收件箱、编辑、引用审批、确认锁定、拒绝和版本冲突处理。
- 重处理不得覆盖 confirmed 或 human-locked 内容。
- 一条非敏感真实 ChatGPT 会话的端到端纵向验收。

允许的简化：

- 首版只处理 `chatgpt_web` 文本消息。
- fenced code 暂时保留在消息 block 中，不拆独立代码子块。
- 可观测性只实现 `processing_runs`、安全错误摘要、token/费用和队列状态；不建设独立监控平台。
- 普通单元测试全部模拟 DeepSeek，不调用真实付费 API。
- 只在最终纵向验收使用最少的一次真实 DeepSeek 调用。
- 模型名称和地址通过 Worker 环境变量配置，不把密钥或模型提供商写入浏览器、扩展或 Git。

## 3. 从当前工作量中移除，但不删除仓库资产

以下事项不应成为 Kimi 或其他执行者本轮的开发任务：

- 重新初始化 monorepo、Next.js、WXT 或 Supabase。
- 重做登录、手动采集、capture API、扩展配对、Outbox、durable receipt 或 ChatGPT 采集器。
- 把现有 TypeScript 系统重写为 FastAPI、Python 后端或另一套全新系统。
- 重建已通过测试的幂等键、增量会话、版本、附件上传和 RLS 机制。
- 复制 Karakeep、LightRAG、Cognee、OpenViking 等完整产品源码。
- 为 Stage 2–5 创建占位页面、空服务、空接口或无当前消费者的表。
- 在单元测试和普通集成测试中调用真实付费模型或存储真实私人内容。
- 同时接入多个模型、OCR、图数据库、外部索引或队列产品。

这里的“移除”仅指从当前工作清单中去掉；不代表删除已有文件、Git 历史或已验证能力。

## 4. 明确延期到后续阶段

| 延期能力 | 目标阶段/触发条件 | 当前处理 |
| --- | --- | --- |
| 豆包、DeepSeek 网页版对话采集 | Stage 2A | 不创建适配器或占位 UI；Claude 已于 2026-09-08 移出后续范围 |
| 普通网页、微信文章、GitHub 仓库采集 | Stage 2B | 不创建解析服务 |
| PDF、Office 文件内容解析 | Stage 2B 或独立文件解析计划 | 保留现有原文件上传能力 |
| 小红书正文、图片、GLM-OCR API | Stage 2C | 不绕过平台限制，不提前接 OCR |
| `topics`、`topic_memberships` | Stage 4 | Stage 1A 不建空表 |
| `knowledge_edges` 和正式知识图谱 | Stage 4 | Stage 1B 不生成关系图 |
| Embedding、`pgvector`、混合检索和重排 | Stage 3 | Stage 1B 仅保留基础来源/知识浏览 |
| `external_index_records` | Stage 3 引入外部索引时 | 当前不建表 |
| 个人知识库问答和证据不足时自动联网 | Stage 3 | 不做假问答入口 |
| LightRAG 对比和是否接入 | Stage 3 基础检索稳定后评估 | 不作为默认依赖 |
| 知识地图、学习路径、每日/每周回顾 | Stage 4 | 不做占位页面 |
| 共享空间 UI 和多人协作 | 出现真实协作需求后单独设计 | 只保留最低数据约束 |
| 邀请用户、云部署、数据迁云、PWA | Stage 5 | 当前保持本地运行 |
| Redis、Kafka、Temporal、Neo4j | 实际规模证明 PostgreSQL 不足后 | 当前禁止引入 |
| 独立 Python Worker/服务 | 出现 TypeScript 无法满足的专用库需求后 | 当前 Worker 使用 TypeScript |
| 原生手机 App、桌面 App、Safari 扩展 | 独立产品阶段 | 当前不实施 |
| 公开注册、订阅、计费和商业化 | 独立商业化阶段 | 当前不实施 |

## 5. 当前禁止物理删除的内容

- `docs/plans/` 下的原始产品设计和 Milestone A 计划。
- `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 下的基线设计及实施计划。
- `docs/runbooks/milestone-a-acceptance.md` 中的历史真实验收数据。
- 现有 Supabase migrations、pgTAP、Vitest 和 Playwright 测试。
- 已保存的本地数据库、Storage 对象和扩展 Outbox 数据。
- 已通过验证的 Web、扩展、契约和领域模块。

如果未来确认某项代码已经被替代，需要单独记录：替代关系、数据迁移、回滚方式、测试证据和用户批准，然后才能删除。

## 6. 交给 Kimi 或其他执行者的固定入口

执行者开始前必须：

```powershell
cd "C:\Users\user\Documents\Codex\2026-07-29\referenced-chatgpt-conversation-this-is-untrusted"
git status
git pull --ff-only origin master
git log -5 --oneline
```

若 `git status` 非干净状态，停止拉取和修改，先保护并报告现有改动。禁止使用 `git reset --hard`、`git checkout --`、`git clean` 或删除 Docker volume。

开始修改 `apps/web` 前，必须阅读 `apps/web/AGENTS.md` 及其中要求的本地 Next.js 16 文档。

第一次汇报必须包含：

- 当前 commit、分支和工作区状态。
- Stage 0–1B 已完成/未完成映射。
- 第一个尚未完整验证的 Task。
- 预计修改文件和聚焦测试。
- 是否涉及真实密钥、付费 API、迁移或破坏性操作。

## 7. 决策记录规则

后续范围变化不得覆盖或删除旧记录。每次在下表追加一行；旧决定失效时，新增一条 `supersedes` 记录并引用旧编号。

状态值：

- `active`：当前执行口径。
- `superseded`：被后续决策替代，但记录保留。
- `completed`：决定要求的工作已经完成。
- `rejected`：评审后明确不采用。

| 编号 | 日期 | 状态 | 决定 | 原因 | 恢复/重审条件 |
| --- | --- | --- | --- | --- | --- |
| SCOPE-001 | 2026-08-12 | active | 保留四份基线文档，另建本文件记录执行范围变化 | 保持设计历史和每次调整可追溯 | 本文件由新的明确决策记录替代 |
| SCOPE-002 | 2026-08-12 | active | 当前只执行 Stage 0、1A、1B | 先完成 ChatGPT 到可审核知识的纵向闭环 | Stage 1B 退出标准通过 |
| SCOPE-003 | 2026-08-12 | active | Stage 0 Task 4/5 测试优先，测试通过则不改生产逻辑 | 避免重复实现已具备的恢复能力 | 聚焦测试发现真实缺口 |
| SCOPE-004 | 2026-08-12 | active | 不物理删除现有代码、迁移、测试、文档和验收历史 | 保护可靠采集资产和审计证据 | 专项删除方案包含备份、迁移、回滚和用户批准 |
| SCOPE-005 | 2026-08-12 | active | Stage 2–5 能力全部延期，不创建占位实现 | 避免长期停留在大而空的架构 | 上一阶段退出标准通过并形成下一阶段计划 |
| SCOPE-006 | 2026-08-12 | active | DeepSeek 仅作为 Recall AI Worker 的服务端业务 API | 项目级 Codex 配置不能安全直接切换到 DeepSeek；密钥必须服务端隔离 | 未来有经过验证的兼容代理或 Codex 官方支持变化 |
| SCOPE-007 | 2026-09-06 | completed | 本机本地栈与 E2E 使用 API `55321`、DB `55322`、Studio `55323`、Mailpit `55324`、analytics `55327`；Mailpit 可用 `MAILPIT_URL` 覆盖 | 本机 Windows 排除端口段 `54305`–`54404`，文档默认端口无法监听 | 本机排除段变化或换到可监听默认端口的环境时重审 |

## 8. 修改本文件的方式

每次范围复核应创建独立 Git 提交，例如：

```bash
git add docs/superpowers/plans/2026-08-12-stage-0-to-1b-execution-scope.md
git commit -m "docs: record stage scope decision"
```

不要为了让文档看起来整洁而删除旧决策；使用新记录解释变化。若修改了第 2–6 节的当前口径，必须同时在“决策历史”追加对应编号。

## 9. 当前执行检查清单

- [ ] 执行者确认 Git 工作区干净并同步 `origin/master`。
- [x] 执行者按顺序阅读四份基线文档和本文件。
- [x] 执行者完成 Stage 0 当前状态审计。
- [x] 在应用 Stage 1A 迁移前产生并验证新备份。
- [ ] 每个 Task 通过聚焦测试和变更审查后独立提交。
- [ ] Stage 1B 最终只用一条非敏感 ChatGPT 记录执行真实 DeepSeek 纵向验收。
- [x] Stage 2–5 工作没有混入当前提交。
