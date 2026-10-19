# 本地数据备份与一次性恢复演练

本文说明如何在不清空当前本地 Supabase 的前提下备份 PostgreSQL 与 `raw-captures` 附件，以及如何在一次性临时目标上验证恢复。备份产物不得提交 Git。

## 1. 硬门禁

一次备份只有同时满足以下条件才算成功。命令退出码为 0 本身不够。

- `backups/<timestamp>/manifest.json` 存在，且 `formatVersion === 1`。
- 清单中的每个文件都存在，字节数与 SHA-256 均匹配。
- 清单记录 Stage 0 到 Stage 2C 的全部业务表行数：`spaces`、`space_members`、`source_items`、`capture_sessions`、`source_versions`、`source_messages`、`source_attachments`、`source_blocks`、`source_asset_links`、`asset_ocr_results`、`processing_jobs`、`processing_runs`、`knowledge_items`、`knowledge_versions`、`citations`、`review_tasks`。
- 每张表都有独立 `tableExports` 条目，包含行数、SHA-256 与 `tables/<table>.copy` 导出路径，且与 `data.sql` 中对应 COPY 正文一致。
- Storage 列表会按页继续拉取，直到某一页对象数小于页大小；每个对象记录路径、字节数与 SHA-256。
- 清单中的表行数等于备份当时对本地库的只读计数，并与 dump COPY 行数一致。
- 每个 `source_attachments.storage_path` 都有对应的已下载对象。
- schema/data SQL 与清单中不得出现 service-role JWT、signed URL 查询参数或 bearer token。
- schema 与 data 只允许恢复到**另一个**临时 PostgreSQL/Supabase 目标；其 project ID 与端口必须不同于当前数据环境。
- 当前 `127.0.0.1:55322` 数据库永远不是恢复目标。

`pnpm supabase db reset` 会丢弃当前本地数据。对保存真实测试数据的项目禁止执行 reset、`supabase stop --no-backup` 或删除 Docker volume。官方本地工作流也提醒 reset 会重建数据库，见 [CLI local workflows](https://supabase.com/docs/guides/local-development/cli-workflows)。

## 2. 创建备份

在仓库根目录加载 Web 服务端环境变量后执行：

```powershell
pnpm backup:local
```

脚本要求：

- `NEXT_PUBLIC_SUPABASE_URL` 或 `SUPABASE_URL` 指向 loopback。
- `SUPABASE_SERVICE_ROLE_KEY` 只存在于进程环境，不会写入清单。
- 使用 `supabase db dump --local --schema public,auth,storage` 导出 schema 与 data。
- 从 data dump 抽出每张业务表的 COPY 正文写入 `tables/<table>.copy`，并登记行数与 SHA-256。
- 通过 Storage API 分页下载私有 bucket `raw-captures`，不复制未文档化的 Docker volume 路径。
- 最后才写 `manifest.json`。失败时保留不完整目录，但不写有效完成标记。

产物位于被 Git 忽略的 `backups/<UTC timestamp>/`。

## 3. 校验备份

```powershell
pnpm backup:verify -- backups/<timestamp>
```

校验器会拒绝仓库 `backups/` 以外的目录。通过时应打印备份时间、记录的表数量、必含表数量、Storage 对象数、总字节数和 `Verification: pass`。校验比较的是行数与 SHA-256，而不是只检查 JSON 形状。任一不匹配都会以一行可操作错误退出非零。

不要在校验脚本、手册或提交中嵌入或推断数据库密码。

## 4. 一次性临时恢复演练

只在一次性临时目录/项目中恢复，验证后销毁临时目标。不要对当前 `recall-ai` 本地栈执行 restore 或 reset。

1. 另选一个空目录作为临时项目，例如 `%TEMP%\recall-backup-restore-drill`。
2. 在该目录初始化一个**不同** `project_id` 的本地 Supabase，并在启动前分配非默认端口，避免占用 `55320`–`55324`、`55327`。
3. 先恢复 `schema.sql`，再恢复 `data.sql`。
4. 对 `auth.users` 与全部现有业务表执行只读 `count(*)`，与 `manifest.json` 的 `tableRowCounts` 逐表比较。
5. 抽查清单中的 Storage 对象字节数与 SHA-256，确认附件可从临时目标重新上传或按对象文件核验。
6. 记录通过/失败后销毁该临时项目。允许删除一次性目标；不允许删除当前数据环境的 volume。

示例对照查询（在临时库执行，不要针对 `127.0.0.1:55322`）：

```sql
select 'auth.users' as name, count(*) from auth.users
union all
select 'public.spaces', count(*) from public.spaces
union all
select 'public.space_members', count(*) from public.space_members
union all
select 'public.source_items', count(*) from public.source_items
union all
select 'public.capture_sessions', count(*) from public.capture_sessions
union all
select 'public.source_versions', count(*) from public.source_versions
union all
select 'public.source_messages', count(*) from public.source_messages
union all
select 'public.source_attachments', count(*) from public.source_attachments
union all
select 'public.source_blocks', count(*) from public.source_blocks
union all
select 'public.source_asset_links', count(*) from public.source_asset_links
union all
select 'public.asset_ocr_results', count(*) from public.asset_ocr_results
union all
select 'public.processing_jobs', count(*) from public.processing_jobs
union all
select 'public.processing_runs', count(*) from public.processing_runs
union all
select 'public.knowledge_items', count(*) from public.knowledge_items
union all
select 'public.knowledge_versions', count(*) from public.knowledge_versions
union all
select 'public.citations', count(*) from public.citations
union all
select 'public.review_tasks', count(*) from public.review_tasks
union all
select 'public.extension_tokens', count(*) from public.extension_tokens;
```

## 5. 迁移前门禁

在对保存真实数据的本地项目应用 Stage 1A 及之后的业务迁移前，必须：

1. 重新运行 `pnpm backup:local`。
2. 对刚生成的目录运行 `pnpm backup:verify`。
3. 按第 4 节完成一次非破坏性恢复对照。
4. 只记录时间戳、表计数、对象计数和校验结果，不记录原文、对象名、密钥或 signed URL。

## 6. 首次真实备份记录

| 项目 | 值 |
| --- | --- |
| 备份时间戳 | 2026-09-06T04:51:43.921Z |
| 校验结果 | pass |
| 记录表数量 | 8 |
| 表行数 | auth.users 1；source_items 15；capture_sessions 39；source_versions 28；source_messages 85；source_attachments 38；processing_jobs 28；extension_tokens 3 |
| Storage 对象数 | 48 |
| 总字节数 | 14103449 |

本表只记录计数与校验结果，不写入原文、对象名、密钥或 signed URL。当前数据环境未作为恢复目标。

## 7. Stage 2C 覆盖备份记录

Stage 2C 将知识块、OCR 结果与审核表纳入必含清单，并按页拉取全部 Storage 对象。下表只记录一次通过校验的覆盖备份，不改写第 6 节的历史计数。

| 项目 | 值 |
| --- | --- |
| 备份时间戳 | 2026-10-19T15:51:34.636Z |
| 校验结果 | pass |
| 记录表数量 | 18（其中必含业务表 16） |
| Storage 对象数 | 78 |
| 总字节数 | 14965902 |

本表只记录计数与校验结果。备份目录仍被 Git 忽略，不得提交 SQL、`.copy` 导出、对象文件或密钥。
