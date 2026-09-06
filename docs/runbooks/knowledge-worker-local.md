# Knowledge Worker 本地运行手册

本文档说明如何在本机启动知识处理 Worker、观察队列，以及在不丢失任务的情况下暂停和重试。密钥只写在已被 Git 忽略的本地环境文件中。

## 1. 范围

Worker 独立进程负责：

- 领取 `normalize_source`、`build_source_blocks`、`extract_knowledge`；
- 把 ChatGPT 文本消息写成稳定 evidence block；
- 调用 DeepSeek 结构化提取，并把通过校验的草稿、引用和审核任务原子写入数据库。

Web 仍负责登录、采集回执和知识审核。不要把 DeepSeek 密钥放进 `NEXT_PUBLIC_*`、`WXT_PUBLIC_*`、浏览器或扩展。

## 2. 密钥只放在忽略的本地环境

Worker 环境文件：`apps/worker/.env`。该文件不得提交。模板见 `apps/worker/.env.example`。

必需名称：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DEEPSEEK_API_KEY
```

可选名称：

```text
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
WORKER_ID
WORKER_POLL_INTERVAL_MS
WORKER_LEASE_SECONDS
WORKER_BATCH_SIZE
WORKER_SHUTDOWN_TIMEOUT_MS
```

配置规则：

- `SUPABASE_URL` 使用本地 API，通常是 `http://127.0.0.1:55321`。
- `SUPABASE_SERVICE_ROLE_KEY` 只给 Worker 和 Web 服务端。用 `pnpm supabase status` 查看本机值，不要把完整输出贴到聊天、Issue 或 Git。
- `DEEPSEEK_API_KEY` 只给 Worker。未配置时不要启动真实提取。
- `DEEPSEEK_MODEL` 只能是 `deepseek-v4-flash` 或 `deepseek-v4-pro`。默认 `deepseek-v4-flash`。
- `DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`。
- 旋转密钥后，删除旧值、写入新值，然后重启 Worker。到 DeepSeek 控制台撤销旧密钥。

复制模板：

```powershell
Copy-Item apps/worker/.env.example apps/worker/.env
```

然后只在编辑器里填写本地密钥，不要用 `echo` 把密钥打进终端历史。

## 3. 分进程启动

先确认 Docker Engine 和本地 Supabase 已按 `docs/runbooks/milestone-a-local.md` 启动。禁止对已有真实数据的 `127.0.0.1:55322` 执行 `db reset` 或 `stop --no-backup`。

三个进程分开启动：

```powershell
pnpm supabase status
pnpm --filter @recall/web dev
pnpm --filter @recall/worker dev
```

- Web：`http://127.0.0.1:3000`
- Worker：读取 `apps/worker/.env`，轮询领取任务
- 停止 Worker：在其终端按 Ctrl+C。进行中的租约会过期后由下一轮 Worker 重新领取，不会删除 `processing_jobs`

## 4. 查看队列但不暴露原文

在 Studio SQL 或 `psql` 中只查元数据：

```sql
select id, job_type, status, attempt_count, next_attempt_at, locked_by
from public.processing_jobs
order by next_attempt_at;

select id, processing_job_id, processor_type, status, provider, model,
       prompt_or_pipeline_version, usage_json, result_summary, error_code
from public.processing_runs
order by started_at desc
limit 20;
```

不要选择 `source_versions.raw_text`、`source_messages.body`、`source_blocks.text_content` 或模型完整响应。`error_detail` 和 `result_summary` 最长 2000 字符，仍应避免把完整对话贴到日志。

费用和用量看 `processing_runs.usage_json`、`estimated_cost`、`provider`、`model`。

## 5. 重试失败的提取

不要手工改 `knowledge_items` 或 `citations`。失败任务会按 30 秒、2 分钟、10 分钟、1 小时退避；达到 `max_attempts` 后标记 `failed`。

同一来源版本再次提取时，enqueue `reprocess_version` 或由现有 `extract_knowledge` 任务在租约过期后重领。Worker 用 `extraction_key` 幂等写入，已确认或人工锁定的条目不会被覆盖。

## 6. 暂停 Worker

1. 在 Worker 终端发送 SIGINT/SIGTERM（Ctrl+C）。
2. 确认没有新的 `processing` 租约被当前 `WORKER_ID` 续约。
3. 已领取但未完成的任务会在 `lease_expires_at` 之后重新变为可领取。
4. 不要删除 `processing_jobs` 行来“清理”。

## 7. 变更 schema 前先备份

对保存真实采集数据的本地库，先按 `docs/runbooks/local-data-backup-and-restore.md` 备份并校验。不要用 reset 当回滚。

## 8. 首条纵向验收清单

使用一条已经保存、非敏感的 ChatGPT 测试会话：

1. `normalize_source` 被领取一次；
2. 每条消息对应一个稳定 evidence block；
3. 一次 DeepSeek 提取写入 provider/model/prompt/usage，不写完整原文；
4. `/knowledge` 出现 1–12 条草稿；
5. 每条草稿能跳回对应消息；
6. 确认一条草稿会生成版本 2、通过引用、锁定字段并关闭审核任务；
7. 拒绝另一条草稿会留下审计版本并离开收件箱；
8. 重处理不覆盖已确认条目；
9. 停止并重启 Worker 不会额外复制草稿。
