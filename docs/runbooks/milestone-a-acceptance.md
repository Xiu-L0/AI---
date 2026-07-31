# Recall AI Milestone A 验收清单与记录模板

本文档用于记录 Milestone A 的自动化验证、Chrome/Edge 手工检查和真实采集质量门禁。它是可重复使用的验收模板，不代表其中任何未填写项目已经执行或通过。

本文档初始状态中的所有结果均保持为 `NOT RUN`。只有在对应命令或手工场景实际执行、证据完成复核后，验收人员才可以把单项状态改为 `PASS`、`FAIL` 或 `BLOCKED`；不能因为代码已经实现、单元测试曾在其他会话运行或本文档已经创建，就推定正式验收通过。

## 1. 验收原则

以下底线不可降低：

1. 服务器未确认原始资料 durable finalization 时，任何界面不得显示“完整采集成功”。
2. 部分采集必须列出缺失项和恢复入口。
3. 采集失败或尚未确认保存的项目必须保留在扩展 Outbox，并可自动或手动重试。
4. 采集状态与后台处理状态必须分开；“原文已保存，后台处理失败”不能被描述为原文丢失。
5. 其他用户不能读取、修改或删除当前用户数据。
6. service-role key、扩展 token、signed upload token 和真实用户内容不得进入 Git 或客户端构建。
7. 未解决失败没有静默忽略或删除入口。

状态记录统一使用：

- `PASS`：步骤已执行且符合预期；
- `FAIL`：步骤已执行但不符合预期，必须记录缺陷；
- `BLOCKED`：被账号、权限、环境或外部平台阻塞；
- `NOT RUN`：尚未执行，不能计为通过。

## 2. 验收会话信息

| 字段 | 记录 |
| --- | --- |
| 验收日期 |  |
| Git commit |  |
| 操作者 |  |
| 操作系统 |  |
| Node 版本 |  |
| pnpm 版本 |  |
| Docker Desktop 版本 |  |
| Supabase CLI 版本 |  |
| Chrome 版本 |  |
| Edge 版本 |  |
| Web origin |  |
| Supabase origin |  |
| 扩展构建目录 | `apps/extension/.output/chrome-mv3` |
| 备注 |  |

不要在此表中记录任何密钥、token、配对码、signed URL、个人原文或附件内容。

## 3. 自动化验证门禁

前置条件：Docker Desktop 与本地 Supabase 已启动，Web 本地环境变量已配置。执行前可运行：

```powershell
pnpm supabase status
```

不要把包含本地密钥的完整状态输出复制到验收报告。

在仓库根目录依次运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm supabase db reset
pnpm supabase test db
pnpm e2e
git diff --check
```

记录结果：

| 检查 | 结果 | 日期/耗时 | 失败摘要或证据位置 |
| --- | --- | --- | --- |
| `pnpm lint` | PASS | 2026-07-30 | 全部工作区通过 |
| `pnpm typecheck` | PASS | 2026-07-30 | 全部工作区通过 |
| `pnpm test` | PASS | 2026-07-30 / 11.06s | 34 个测试文件、255 项测试通过 |
| `pnpm build` | PASS | 2026-07-30 / 40.9s（含 lint、typecheck、test 与 diff check） | Web 与 Manifest V3 扩展生产构建通过 |
| `pnpm supabase db reset` | BLOCKED | 2026-07-30 | 为保留可能存在的本地数据，安全策略禁止清空数据库；未绕过保护，改用非破坏性 `db push --local`，结果为 up to date |
| `pnpm supabase test db` | PASS | 2026-07-30 | 6 个 pgTAP 文件、80 项断言通过；含 sibling 与 cousin recovery 单胜者回归 |
| `pnpm e2e` | PASS | 2026-07-30 / 26.7s | 12 项 Playwright 测试通过，含合成 ChatGPT 完整、重复、partial、离线与重试路径 |
| `git diff --check` | PASS | 2026-07-30 | 无空白错误；仅有 Windows LF/CRLF 提示 |

自动化 E2E 只能使用合成 ChatGPT fixture 和生成图片，不能依赖真实 ChatGPT 账号或把真实内容写入测试夹具。自动化通过不等于后续 30 次真实采集验收已经完成。

扩展 E2E 使用测试专用双门控：

- 必须同时由测试进程设置 `WXT_TEST_BUILD=1` 和 `WXT_TEST_FIXTURE_ORIGIN`；
- fixture origin 只允许精确 loopback origin，主机只能是 `localhost`、`127.0.0.1` 或 `[::1]`，不能包含额外路径、查询参数、凭据或 wildcard；
- 单独设置 `WXT_TEST_FIXTURE_ORIGIN` 会被忽略，不能让普通构建获得测试 host permission；
- 单独设置 `WXT_TEST_BUILD=1` 会因缺少 fixture origin 而构建失败；
- 普通/生产构建不得设置任何 `WXT_TEST_*` 变量。

`pnpm e2e` 会先构建测试扩展、把它复制到操作系统临时目录供 Playwright 使用，再清除测试变量并重建仓库中的正式 `apps/extension/.output/chrome-mv3`。测试结束后临时副本会被删除。验收时需要同时确认：

1. E2E 使用的临时副本可以包含唯一的精确 fixture origin；
2. E2E 结束后仓库中的正式构建仍然存在；
3. 正式构建的 manifest 不包含 fixture origin；
4. 后续 secret、Manifest、Chrome 和 Edge 检查全部针对正式构建，而不是临时副本。

如果 E2E 异常中止，不能假定 `.output/chrome-mv3` 已经恢复。先清除两个 `WXT_TEST_*` 变量，重新执行正式扩展构建并检查 manifest，再记录后续验收结果。

## 4. 客户端密钥与 Manifest 检查

先确保 Web 和扩展已经完成生产模式本地构建。如果刚运行过 E2E，先确认 `.output/chrome-mv3` 是 E2E 恢复后的正式构建；必要时在未设置任何 `WXT_TEST_*` 变量的终端中重新运行扩展 build。然后运行：

```powershell
rg -n "SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|secret-token" apps/extension/.output apps/web/.next/static
```

预期：无匹配。任何匹配都必须先判断是否为实际秘密暴露或不应进入客户端的变量名称；在结论明确前不得通过该项。

打开 `apps/extension/.output/chrome-mv3/manifest.json` 并确认：

- `manifest_version` 为 `3`；
- `permissions` 只有：
  - `storage`
  - `unlimitedStorage`
  - `activeTab`
  - `scripting`
  - `notifications`
  - `alarms`
- `host_permissions` 只有：
  - `https://chatgpt.com/*`
  - 当前构建配置的精确 Recall API origin；
  - 当前构建配置的精确 Supabase base origin；
- 不存在 CDN wildcard、任意 HTTP/HTTPS wildcard 或测试 fixture host；
- 构建中包含非敏感的 `icon-128.png`；
- 扩展中不存在 service-role key、Supabase publishable key 或真实内容。

不要对 E2E 临时目录执行本节检查。临时测试 manifest 按设计会包含一个精确 loopback fixture origin，把它当成正式构建会导致错误验收结论。

记录：

| 检查 | 结果 | 证据/备注 |
| --- | --- | --- |
| 客户端 secret 扫描无匹配 | PASS | `SERVICE_ROLE`、`SUPABASE_SERVICE_ROLE_KEY`、`secret-token` 均无匹配 |
| Manifest V3 | PASS | `manifest_version = 3` |
| permissions 精确匹配六项 | PASS | `activeTab`、`alarms`、`notifications`、`scripting`、`storage`、`unlimitedStorage` |
| host permissions 只有三个精确来源 | PASS | ChatGPT、Recall 本地 API、Supabase 本地 origin |
| 生产构建无测试 fixture origin | PASS | 无 `WXT_TEST_*`、测试端口或 fixture host 标记 |
| E2E 临时测试构建已清理、正式构建已恢复 | PASS | 临时测试目录数量为 0；仓库内正式构建已重新生成 |
| 通知图标存在 | PASS | `apps/extension/.output/chrome-mv3/icon-128.png` 存在 |

## 5. Web 手动采集验收

所有场景都应在服务器真实保存成功后，再检查历史页和详情页。不要只依据浏览器网络请求开始或附件上传完成判断成功。

### A-01 手动文本

- [ ] 输入标题和一段合成文本。
- [ ] 不添加附件。
- [ ] 点击保存后，成功文案只在 finalize receipt 返回后出现。
- [ ] 历史页显示来源、标题、完整度、处理状态、数量和时间。
- [ ] 详情页显示原文和版本。
- 结果：`NOT RUN`
- 证据/备注：

### A-02 单文件

- [ ] 上传一个受支持且小于 10 MiB 的合成文件。
- [ ] 回执中的附件数量与实际提交一致。
- [ ] 详情页显示文件名、MIME、大小等元数据。
- [ ] 通过服务器生成的短时下载地址可下载附件。
- 结果：`NOT RUN`
- 证据/备注：

### A-03 多张截图

- [ ] 一次选择至少两张生成的 PNG/JPEG/WebP 图片。
- [ ] 所有附件上传完成前不显示完整成功。
- [ ] 回执保存数量正确。
- [ ] 私有 Storage 对未授权用户不可读。
- 结果：`NOT RUN`
- 证据/备注：

### A-04 输入限制与诚实失败

- [ ] 验证单附件超过 10 MiB 时被拒绝。
- [ ] 验证超过 50 个附件或总计超过 100 MiB 时被拒绝。
- [ ] 验证不支持 MIME 类型时被拒绝。
- [ ] 验证纯文本超过 2 MiB 时被拒绝。
- [ ] 所有拒绝场景均不得显示成功回执。
- 结果：`NOT RUN`
- 证据/备注：

## 6. ChatGPT 扩展手工验收

只把页面已加载、用户已登录、扩展拥有权限且页面类型明确受支持的尝试计入正式成功率分母。

### B-01 完整会话

- [ ] 在 `https://chatgpt.com` 打开一段已完成生成的会话。
- [ ] 选择“完整会话”并保存。
- [ ] finalize 延迟期间不显示“完整采集成功”。
- [ ] receipt 返回并落入本地 Outbox 后显示完整成功和真实保存数量。
- [ ] Web 历史和详情页可看到相同资料。
- 结果：`NOT RUN`
- 证据/备注：

### B-02 同一会话增量采集

- [ ] 在同一会话增加至少一组新问答。
- [ ] 再次保存完整会话。
- [ ] Web 中仍为同一个 SourceItem，并产生新版本。
- [ ] 已有消息不重复插入，新消息按 ordinal 追加。
- [ ] 相同内容重复提交不会产生重复消息行。
- 结果：`NOT RUN`
- 证据/备注：

### B-03 当前问答

- [ ] 在包含多轮消息的会话中选择“当前问答”。
- [ ] 只保存目标 user/assistant 对。
- [ ] 目标范围外的缺失图片不会把该问答错误标为 partial。
- 结果：`NOT RUN`
- 证据/备注：

### B-04 选中文字

- [ ] 在页面中实际选中一段文字。
- [ ] 选择“选中文字”并保存。
- [ ] 只保存选择范围及必要来源关联。
- [ ] 没有选择时显示明确错误，不伪造成功。
- 结果：`NOT RUN`
- 证据/备注：

### B-05 缺失图片导致 partial

- [ ] 使用一段正文可读但至少一张图片不可读的受支持页面状态。
- [ ] 服务器保存可用原文并返回 partial receipt。
- [ ] 弹窗显示“部分内容未采集”和具体缺失项。
- [ ] 原文安全状态与后续处理状态分开显示。
- [ ] “补充截图”失败时，原 partial receipt 仍存在。
- [ ] 补截图成功时创建同一 SourceItem 的新版本，不把来源改成 `manual_screenshot`。
- 结果：`NOT RUN`
- 证据/备注：

### B-06 页面识别安全边界

- [ ] `https://chatgpt.com` 被识别为支持页面。
- [ ] HTTP ChatGPT、相似域名和其他网站不启用自动 ChatGPT 采集。
- [ ] 远程图片抓取不携带页面 cookie/credentials。
- [ ] 图片重定向到 Recall API、Supabase 或未批准来源时转为诚实 partial，不泄漏 URL。
- 结果：`NOT RUN`
- 证据/备注：

## 7. Outbox、断网与恢复验收

### C-01 finalize 期间断网

- [ ] 在原始 draft 已进入 Outbox 后断开 Recall API 网络。
- [ ] 弹窗显示“服务器尚未确认保存”，不显示成功。
- [ ] 项目状态、稳定 idempotency key 和附件 Blob 在关闭弹窗后仍存在。
- [ ] 浏览器工具栏角标显示未解决数量。
- [ ] 重新打开浏览器后项目仍存在。
- 结果：`NOT RUN`
- 证据/备注：

### C-02 自动重试

- [ ] 恢复网络后等待浏览器 alarm 唤醒任务。
- [ ] 重试沿用同一 idempotency key，并刷新短期 signed upload token。
- [ ] 如果附件对象已经上传，服务器授权的 retry token 允许安全重试。
- [ ] 收到并本地保存真实 receipt 后才清除异常角标。
- 结果：`NOT RUN`
- 证据/备注：

### C-03 手动重试

- [ ] 在 `retry_wait` 项上点击“立即重试”。
- [ ] 重试期间仍不显示成功。
- [ ] 成功后显示服务器真实保存数量。
- [ ] 失败后更新可理解的原因和下一次重试时间，项目不消失。
- 结果：`NOT RUN`
- 证据/备注：

### C-04 服务工作线程中断恢复

- [ ] 在 `uploading` 或 `finalizing` 时使扩展 service worker 暂停/重启。
- [ ] watchdog alarm 后任务恢复，不依赖长时间 `setTimeout`。
- [ ] draft、captureId 和 Blob 引用保持一致。
- 结果：`NOT RUN`
- 证据/备注：

### C-05 扩展凭据撤销

- [ ] 在 Web 设置页撤销当前扩展设备。
- [ ] 下一次网络任务进入 `auth_paused`，未解决数据不被清除。
- [ ] 重新配对后暂停任务重新安排执行。
- [ ] 恢复任务仍使用原稳定 idempotency key。
- 结果：`NOT RUN`
- 证据/备注：

### C-06 多个未解决项目

- [ ] 同时准备 `retry_wait`、`auth_paused`、`terminal` 或未解决 partial 项。
- [ ] 再创建一个更新时间更晚的 complete 项。
- [ ] 弹窗仍优先显示未解决项，并允许在待处理列表中切换。
- [ ] 每类项目均保留对应的立即重试、重新配对、重新采集或补截图入口。
- 结果：`NOT RUN`
- 证据/备注：

## 8. Web 历史与异常恢复验收

### D-01 历史与详情

- [ ] 历史按最近更新时间倒序展示每个 SourceItem 的最新版本。
- [ ] 每行包含来源、标题、采集状态、处理状态、消息数、附件数和保存时间。
- [ ] 详情查询同时按 `sourceItemId` 和 owner 限制。
- [ ] 详情按顺序显示消息、附件元数据、敏感级别、缺失项和全部版本。
- [ ] 附件下载 URL 只在服务端签发，有效期为 60 秒。
- 结果：`NOT RUN`
- 证据/备注：

### D-02 异常列表

- [ ] 显示仍未解决的最新 partial 版本。
- [ ] 同一 SourceItem 后续 complete 后，旧 partial 不再显示为当前异常。
- [ ] 显示真实 failed capture session 和 failed processing job。
- [ ] 纯离线且从未到达 `/captures/start` 的扩展 draft 只出现在扩展 Outbox，不在 Web 伪造服务器异常。
- [ ] 手动 failed session 的“重新填写并恢复”携带精确旧 `captureId`；新会话未取得 durable receipt 前，旧异常仍可见。
- [ ] 显式恢复只允许同一所有者、相同来源和相同采集范围；不能根据标题或时间猜测恢复关系。
- [ ] 关联的新会话成功 finalization 后，旧 failed session 的 `resolved_at` 和 `resolved_by_capture_session_id` 被原子记录，异常计数随之减少。
- [ ] 没有未解决失败的“忽略”或“关闭”按钮。
- 结果：`NOT RUN`
- 证据/备注：

### D-03 首页异常计数

- [ ] 首页与异常页使用同一查询口径。
- [ ] partial 被新 complete 解决后，首页计数同步减少。
- [ ] processing failed 不被描述为原文丢失。
- 结果：`NOT RUN`
- 证据/备注：

## 9. 所有权与隐私验收

### E-01 其他用户 RLS 拒绝

- [ ] 创建两个仅用于本地验收的合成用户 A 和 B。
- [ ] 用户 A 创建文本和附件采集。
- [ ] 用户 B 不能通过页面或直接数据库客户端读取 A 的业务行。
- [ ] 用户 B 不能更新或删除 A 的业务行。
- [ ] 用户 B 不能读取 A 在 `raw-captures` bucket 下的对象。
- [ ] `pnpm supabase test db` 中 owner isolation 测试通过。
- 结果：`NOT RUN`
- 证据/备注：

### E-02 敏感内容边界

- [ ] 普通、敏感、严格敏感三种级别都可以保存原始资料。
- [ ] Milestone A 没有调用 AI/OCR API。
- [ ] 敏感和严格敏感资料没有被发送给第三方 AI。
- 结果：`NOT RUN`
- 证据/备注：

### E-03 凭据与日志

- [ ] 浏览器控制台、service worker 日志和通知不包含完整 token、signed URL 或原文。
- [ ] Git 状态中没有 `.env`、真实附件、真实对话或个人截图。
- [ ] 扩展 `storage.local` 保存 Outbox 元数据，附件 Blob 单独保存在 IndexedDB。
- 结果：`NOT RUN`
- 证据/备注：

## 10. Chrome 与 Edge 冒烟测试

同一个构建分别在两个浏览器中执行，不得只根据 Chrome 结果推断 Edge 通过。

这里的“同一个构建”特指仓库中的正式 `apps/extension/.output/chrome-mv3`：构建环境不得设置 `WXT_TEST_BUILD` 或 `WXT_TEST_FIXTURE_ORIGIN`，manifest 不得包含 fixture host。禁止加载 `pnpm e2e` 创建在操作系统临时目录中的测试扩展副本。

| 场景 | Chrome | Edge | 备注/证据 |
| --- | --- | --- | --- |
| 加载 `chrome-mv3` 无清单错误 | NOT RUN | NOT RUN |  |
| 生成一次性配对码并连接 | NOT RUN | NOT RUN |  |
| 完整 ChatGPT 会话采集 | NOT RUN | NOT RUN |  |
| Web 手动文本采集 | NOT RUN | NOT RUN |  |
| partial 缺失项显示 | NOT RUN | NOT RUN |  |
| 断网后 Outbox 保留 | NOT RUN | NOT RUN |  |
| 手动重试恢复 | NOT RUN | NOT RUN |  |
| 关闭并重开浏览器后 Outbox 仍在 | NOT RUN | NOT RUN |  |
| 撤销凭据后重新配对恢复 | NOT RUN | NOT RUN |  |

## 11. 后续用户协助的 30 次真实采集验收

此部分必须由用户在真实 Chrome/Edge、真实已登录 ChatGPT 页面和真实手动采集入口中协助执行。合成 fixture、单元测试和 Playwright CI 不计入这 30 次真实尝试。

在以下条件全部满足时，一次尝试才进入正式分母：

- 页面或文件已正常加载；
- 用户已登录所需平台；
- 扩展拥有必要权限；
- 页面类型和保存范围属于 Milestone A 明确支持范围；
- 尝试不是为了测试明确超限或不支持输入的负向用例。

分类定义：

- `自动完整`：首次采集自动获得 complete receipt，无需截图或手动上传兜底。
- `自动部分`：首次采集获得 partial receipt，并准确列出缺失项。
- `初始失败`：首次尝试没有 durable receipt，项目保留在 Outbox。
- `重试恢复`：初始失败后通过自动或手动重试获得真实 receipt。
- `人工兜底完成`：通过补截图或 Web 手动上传完成保存；单独报告，不计入自动成功。
- `未恢复失败`：验收结束时仍没有真实 receipt。

### 11.1 尝试记录表

| # | 日期 | 浏览器 | 来源/范围 | 符合支持条件 | 首次结果 | 成功前已确认 durable receipt | 重试/兜底 | 最终结果 | 失败分类/证据 |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |  |  |  |
| 21 |  |  |  |  |  |  |  |  |  |
| 22 |  |  |  |  |  |  |  |  |  |
| 23 |  |  |  |  |  |  |  |  |  |
| 24 |  |  |  |  |  |  |  |  |  |
| 25 |  |  |  |  |  |  |  |  |  |
| 26 |  |  |  |  |  |  |  |  |  |
| 27 |  |  |  |  |  |  |  |  |  |
| 28 |  |  |  |  |  |  |  |  |  |
| 29 |  |  |  |  |  |  |  |  |  |
| 30 |  |  |  |  |  |  |  |  |  |

至少覆盖：

- ChatGPT 完整会话；
- ChatGPT 同会话增量采集；
- ChatGPT 当前问答；
- ChatGPT 选中文字；
- Web 手动文本；
- Web 文件；
- Web 单张和多张截图；
- Chrome 和 Edge；
- 至少一个真实 partial；
- 至少一个断网/服务不可用后恢复场景。

### 11.2 指标汇总

| 指标 | 数量 |
| --- | ---: |
| 符合支持条件的真实尝试 `N_supported` | 0 |
| 首次自动完整 `N_auto_complete` | 0 |
| 首次自动部分 `N_auto_partial` | 0 |
| 初始失败 `N_initial_failed` | 0 |
| 重试恢复 `N_retry_recovered` | 0 |
| 人工兜底完成 `N_manual_fallback` | 0 |
| 验收结束仍未恢复 `N_unresolved_failed` | 0 |
| 成功文案早于 durable receipt 的次数 | 0 |

正式自动采集成功率：

```text
N_auto_complete / N_supported × 100%
```

兜底完成率单独报告：

```text
N_manual_fallback / N_supported × 100%
```

正式判定要求：

- `N_supported >= 30`；
- 自动采集成功率达到或超过 90%；
- 成功文案早于 durable receipt 的次数必须为 0；
- 每个 partial、failed 和 retry-recovered 样本都已复核原因；
- Chrome 与 Edge 冒烟均已执行；
- 自动化门禁全部通过。

如果样本不足 30 次，只能报告阶段数据，不能宣布正式通过 90% 指标。

## 12. 失败样本复核

每个失败或 partial 样本至少记录一行：

| 尝试编号 | 分类 | 现象 | 原始资料是否已有 receipt | 根因 | 恢复动作 | 是否需修复代码/规格 |
| --- | --- | --- | --- | --- | --- | --- |
|  | 页面结构变化 / 权限 / 网络 / 服务 / 输入限制 / 产品缺口 / 其他 |  |  |  |  |  |

根因必须区分：

- 产品缺陷；
- 已声明不支持的页面状态；
- 浏览器权限问题；
- 网络或本地服务问题；
- 外部平台页面变化；
- 用户输入超过明确限制；
- 测试环境问题。

不要为了提高指标而从分母中移除本来符合支持条件的失败尝试。

## 13. 最终签署

| Gate | 结果 | 说明 |
| --- | --- | --- |
| 自动化测试与构建 | PASS | 34 个测试文件、255 项测试、12 项 E2E、lint、typecheck、build 全部通过 |
| 数据库迁移与 RLS | PASS | 非破坏性迁移校验为 up to date；6 个 pgTAP 文件、80 项断言通过。为保留本地数据，未执行清空式 `db reset` |
| 客户端 secret 与 Manifest | PASS | secret 扫描、Manifest V3、权限、host、正式构建恢复与临时目录清理均通过 |
| Web 手动采集 | NOT RUN |  |
| ChatGPT 扩展采集 | NOT RUN |  |
| Outbox 与恢复 | NOT RUN |  |
| Chrome 冒烟 | NOT RUN |  |
| Edge 冒烟 | NOT RUN |  |
| 30 次真实采集 | NOT RUN | 必须后续用户协助；CI/E2E 不计入 |
| 90% 自动采集指标 | NOT RUN | 样本不足时不得通过 |
| 无提前成功报告 | NOT RUN | 自动化延迟 finalize 场景已证明无提前成功；正式结论仍需 30 次真实采集为零次违规 |

最终结论只能选择一个：

- `PASS`：所有不可降低底线、自动化门禁、两个浏览器冒烟和 30 次真实采集指标均通过；
- `CONDITIONAL`：本地自动化和功能搭建完成，但真实样本或外部平台验证尚未完成；
- `FAIL`：存在底线违规、未修复高优先级缺陷或正式指标未达到。

签署记录：

| 字段 | 记录 |
| --- | --- |
| 最终结论 | CONDITIONAL |
| 日期 | 2026-07-30 |
| 用户确认 | 待 Chrome、Edge 与真实采集验收时确认 |
| Codex 验证摘要 | Milestone A 本地功能搭建、单元/集成测试、数据库权限测试、合成浏览器 E2E、生产构建与客户端安全检查已通过；P0=0、P1=0 |
| 未解决问题 | Chrome 与 Edge 真实浏览器手测未执行；真实支持场景采集为 0/30；正式 90% 指标不能宣布通过；为保护本地数据，清空式数据库 reset 未执行 |
| Milestone B 是否允许开始规划 | 否；只有 Review Gate 完成后才能改为是 |
