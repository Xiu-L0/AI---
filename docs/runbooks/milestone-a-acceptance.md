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
| `pnpm test` | PASS | 2026-08-02 / 11.9s | 34 个测试文件、260 项测试通过 |
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

- [x] 输入标题和一段合成文本。
- [x] 不添加附件。
- [x] 点击保存后，成功文案只在 finalize receipt 返回后出现。
- [x] 历史页显示来源、标题、完整度、处理状态、数量和时间。
- [x] 详情页显示原文和版本。
- 结果：`PASS`
- 证据/备注：2026-08-02 在真实 Chrome 中完成。标题为“验收测试-01-Chrome-手动文字”；页面收到绿色 durable receipt 后显示“完整采集成功，原始资料已保存”。详情页显示来源为文本、敏感级别普通、共 1 个版本、版本 1 为完整采集、后台状态 queued，并完整展示测试原文；无附件，消息与附件计数均为 0。Web 手动采集使用页面内回执卡，不要求出现扩展弹窗。

### A-02 单文件

- [x] 上传一个受支持且小于 10 MiB 的合成文件。
- [x] 回执中的附件数量与实际提交一致。
- [x] 详情页显示文件名、MIME、大小等元数据。
- [x] 通过服务器生成的短时下载地址可下载附件。
- 结果：`PASS`
- 证据/备注：2026-08-02 在真实 Chrome 中完成。上传合成文件 `recall-acceptance-single-file.txt`；绿色 durable receipt 显示已保存附件 1。历史页显示文件来源、版本 1、0 条消息和 1 个附件；详情页显示 `text/plain`、227 B、SHA-256 摘要、完整采集及 queued。打开服务器签发的 60 秒下载链接后成功显示文件原文。

### A-03 多张截图

- [x] 一次选择至少两张生成的 PNG/JPEG/WebP 图片。
- [x] 所有附件上传完成前不显示完整成功。
- [x] 回执保存数量正确。
- [x] 私有 Storage 对未授权用户不可读。
- 结果：`PASS`
- 证据/备注：2026-08-02 在真实 Chrome 中完成。使用图像生成能力制作两张无隐私 PNG 测试图并一次性选择；页面先显示两项“已选择”，提交成功后两项均变为“已保存”，绿色 durable receipt 显示附件 2。历史页显示来源“截图”、版本 1、0 条消息和 2 个附件；详情页显示两条独立的 `image/png` 文件名、大小及 SHA-256 摘要。随后单独上传其中一张生成 PNG，绿色 durable receipt 显示附件 1；详情显示 `image/png`、1.0 MiB、SHA-256 和服务器签发的 60 秒下载入口。私有 Storage 未授权访问由已通过的 owner-isolation pgTAP/Storage 策略测试提供证据。

### A-04 输入限制与诚实失败

- [x] 验证单附件超过 10 MiB 时被拒绝。
- [x] 验证超过 50 个附件或总计超过 100 MiB 时被拒绝。
- [x] 验证不支持 MIME 类型时被拒绝。
- [x] 验证纯文本超过 2 MiB 时被拒绝。
- [x] 所有拒绝场景均不得显示成功回执。
- 结果：`PASS`
- 证据/备注：2026-08-02 在真实 Chrome Web 入口验证：选择不支持的 `.exe` 合成测试文件后显示“`不支持的文件类型：recall-acceptance-unsupported.exe`”；选择大小为 10 MiB + 1 字节的合成 PDF 后显示“`单个文件不能超过 10 MiB`”。两种真实页面场景均未出现绿色成功回执，也未创建受支持采集记录。为避免在人工验收中生成和上传 51 个或超过 100 MiB 的无意义临时附件，剩余边界使用与生产接口相同的共享契约校验完成：`packages/contracts/src/capture.test.ts` 覆盖 51 个附件、11 × 10 MiB 总量、UTF-8 纯文本超过 2 MiB及正文和消息合计超过 2 MiB。2026-08-02 重新执行该文件，21/21 测试通过；这些拒绝输入均无法生成成功回执。

## 6. ChatGPT 扩展手工验收

只把页面已加载、用户已登录、扩展拥有权限且页面类型明确受支持的尝试计入正式成功率分母。

### B-01 完整会话

- [x] 在 `https://chatgpt.com` 打开一段已完成生成的会话。
- [x] 选择“完整会话”并保存。
- [ ] finalize 延迟期间不显示“完整采集成功”。
- [x] receipt 返回并落入本地 Outbox 后显示完整成功和真实保存数量。
- [x] Web 历史和详情页可看到相同资料。
- 结果：`NOT RUN`
- 证据/备注：2026-08-02 在真实 Chrome、真实已登录 ChatGPT 页面与正式扩展构建中完成一次合成无隐私会话采集。扩展弹窗显示“完整采集成功”、已保存 2 条消息、0 个附件、待处理异常 0；Web 历史显示来源“ChatGPT 会话”、标题“番茄工作法介绍”、版本 1、2 条消息、0 个附件和完整采集；详情页按顺序展示相同的用户问题与助手回答。此次未人为延迟 finalize，故“延迟期间不提前显示成功”仍留待断网/延迟场景单独验证，B-01 暂不整体标记 PASS。

### B-02 同一会话增量采集

- [x] 在同一会话增加至少一组新问答。
- [x] 再次保存完整会话。
- [x] Web 中仍为同一个 SourceItem，并产生新版本。
- [x] 已有消息不重复插入，新消息按 ordinal 追加。
- [x] 相同内容重复提交不会产生重复消息行。
- 结果：`PASS`
- 证据/备注：2026-08-02 在第 4 次使用的同一真实 ChatGPT 会话中追加一组无隐私问答，再次选择“完整会话”保存。扩展 complete receipt 显示 4 条消息、0 个附件、异常 0。Web 详情 URL 与 SourceItem 保持不变，显示共 2 个版本；版本 2 按顺序仅包含 4 条消息，版本 1 保持原 2 条消息，证明已有消息未重复且新增消息按 ordinal 追加。随后在内容完全不变时再次保存完整会话；扩展仍返回 4 条消息的 complete receipt，Web 只更新“最近保存”时间，仍为 2 个版本且版本 2 仍为 4 条消息，没有生成版本 3或重复消息。

### B-03 当前问答

- [x] 在包含多轮消息的会话中选择“当前问答”。
- [x] 只保存目标 user/assistant 对。
- [x] 目标范围外的缺失图片不会把该问答错误标为 partial。
- 结果：`PASS`
- 证据/备注：2026-08-02 在包含两组问答的真实 ChatGPT 会话中选择“当前问答”。扩展 complete receipt 显示 2 条消息、0 个附件、异常 0。Web 新建独立片段 SourceItem，版本 1 只显示原会话中的第 3 条用户消息和第 4 条助手消息，没有包含前一组问答，也未被错误标记为 partial。

### B-04 选中文字

- [x] 在页面中实际选中一段文字。
- [x] 选择“选中文字”并保存。
- [x] 只保存选择范围及必要来源关联。
- [x] 没有选择时显示明确错误，不伪造成功。
- 结果：`PASS`
- 证据/备注：2026-08-02 在真实 ChatGPT 页面实际选中助手消息中的“缩短专注周期：将 25 分钟调整为 10—15 分钟”，扩展选择“选中文字”后返回 complete receipt：1 条消息、0 个附件、异常 0。Web 新建独立片段 SourceItem，版本 1 仅显示原会话第 4 条助手消息的所选文本，没有额外上下文。随后取消选择并再次尝试“选中文字”，扩展未显示成功，明确显示 `Selected text is empty`、“采集无法自动恢复，需要重新采集”，并把待处理异常数更新为 1；该预期负向用例不计入 30 次正式成功率分母。

### B-05 缺失图片导致 partial

- [x] 使用一段正文可读但至少一张图片不可读的受支持页面状态。
- [x] 服务器保存可用原文并返回 partial receipt。
- [x] 弹窗显示“部分内容未采集”和具体缺失项。
- [x] 原文安全状态与后续处理状态分开显示。
- [ ] “补充截图”失败时，原 partial receipt 仍存在。
- [x] 补截图成功时创建同一 SourceItem 的新版本，不把来源改成 `manual_screenshot`。
- 结果：`NOT RUN`
- 证据/备注：2026-08-02 真实 Chrome 含图会话中，扩展识别到第 5 条消息图片，但 ChatGPT 资源下载返回 HTTP 403；服务器将 6 条消息保存为版本 4，返回 partial receipt，弹窗和 Web 均明确列出同一缺失项。补充截图初版暴露完成状态和重复附件缺陷，修复提交 `18295d4` 后再次加载正式构建并只点击一次；扩展在 durable receipt 后显示完整成功、6 条消息、1 个附件、异常 0。Web 同一 SourceItem 新增版本 12，状态完整、仅 1 张 `image/png`、无缺失项，异常页显示“目前没有未恢复异常”。补充截图本身失败的真实浏览器路径尚未执行，故本节暂不整体标记 PASS。

### B-06 页面识别安全边界

- [ ] `https://chatgpt.com` 被识别为支持页面。
- [ ] HTTP ChatGPT、相似域名和其他网站不启用自动 ChatGPT 采集。
- [ ] 远程图片抓取不携带页面 cookie/credentials。
- [ ] 图片重定向到 Recall API、Supabase 或未批准来源时转为诚实 partial，不泄漏 URL。
- 结果：`NOT RUN`
- 证据/备注：

## 7. Outbox、断网与恢复验收

### C-01 finalize 期间断网

- [x] 在原始 draft 已进入 Outbox 后断开 Recall API 网络。
- [x] 弹窗显示“服务器尚未确认保存”，不显示成功。
- [ ] 项目状态、稳定 idempotency key 和附件 Blob 在关闭弹窗后仍存在。
- [x] 浏览器工具栏角标显示未解决数量。
- [x] 重新打开浏览器后项目仍存在。
- 结果：`NOT RUN`
- 证据/备注：2026-08-02 选中文字恢复采集期间，本地 Recall Web 服务停止，等价于扩展无法访问 Recall API。扩展明确显示“服务器尚未确认保存”、`Failed to fetch` 和下次自动重试时间，未显示成功，并在待处理采集列表保留项目。2026-08-09 在 Edge 中停止 Recall Web 后出现待处理异常 2，工具栏角标同步显示 2；关闭所有 Edge 窗口并重新打开后，两项仍存在。服务恢复后项目取得 complete receipt、异常归零。此次仍无附件，尚未覆盖附件 Blob 跨浏览器重启，因此 C-01 暂不整体标记 PASS。

### C-02 自动重试

- [x] 恢复网络后等待浏览器 alarm 唤醒任务。
- [ ] 重试沿用同一 idempotency key，并刷新短期 signed upload token。
- [ ] 如果附件对象已经上传，服务器授权的 retry token 允许安全重试。
- [x] 收到并本地保存真实 receipt 后才清除异常角标。
- 结果：`NOT RUN`
- 证据/备注：Recall Web 服务恢复后，用户尝试“立即重试”时后台状态已变化，扩展诚实拒绝重复重试；关闭并重新打开弹窗后显示 complete receipt：1 条消息、0 个附件，待处理异常从 3 自动清零。Web 中仍是原 selection SourceItem、版本 1、1 条消息，仅更新时间变化，没有重复资料。此次无附件，尚未覆盖 signed upload/retry token，故 C-02 暂不整体标记 PASS。

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

- [x] 普通、敏感、严格敏感三种级别都可以保存原始资料。
- [x] Milestone A 没有调用 AI/OCR API。
- [x] 敏感和严格敏感资料没有被发送给第三方 AI。
- 结果：`PASS`
- 证据/备注：2026-08-02 已在真实 Chrome Web 入口分别完成普通、敏感和严格敏感合成文本保存。敏感与严格敏感场景均只在绿色 durable receipt 后显示成功；Web 详情分别显示对应敏感级别、版本 1、完整原文与 queued。Milestone A 的 processing job 仅排队 `prepare_for_milestone_b`，当前实现没有 AI/OCR 提供商调用，也没有向第三方 AI 发送资料。

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
| 加载 `chrome-mv3` 无清单错误 | PASS | PASS | 2026-08-02 Chrome、2026-08-09 Edge 均成功加载正式 `apps/extension/.output/chrome-mv3`，弹窗可正常打开 |
| 生成一次性配对码并连接 | PASS | PASS | Chrome 与 Edge 均通过 Web 设置页生成的一次性配对码成功连接；真实采集鉴权成功 |
| 完整 ChatGPT 会话采集 | PASS | PASS | Chrome 与 Edge 的正式扩展均取得完整 receipt；Edge 第 21 次为 2 条消息、0 个附件、异常 0 |
| Web 手动文本采集 | PASS | NOT RUN | Chrome 中已完成普通、敏感、严格敏感文本及单文件、单图、多图的服务器回执与详情核对 |
| partial 缺失项显示 | PASS | NOT RUN | 真实含图会话在图片资源 HTTP 403 时显示具体缺失项；修复后补充截图生成版本 12，6 条消息、1 张 PNG、异常归零 |
| 断网后 Outbox 保留 | PASS | PASS | Chrome 与 Edge 在 Recall Web 停止时均未显示成功；Edge 待处理异常 2 在关闭全部窗口并重开后仍存在，服务恢复后完整保存并归零 |
| 手动重试恢复 | NOT RUN | NOT RUN |  |
| 关闭并重开浏览器后 Outbox 仍在 | NOT RUN | PASS | Edge 关闭全部窗口并重开后，工具栏角标与两个待处理项目均保留；此次无附件，附件 Blob 持久性仍需另测 |
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
| 1 | 2026-08-02 | Chrome | Web 手动文本 | 是 | 自动完整 | 是（绿色服务器回执后显示成功） | 无 | 完整保存 | 详情页显示版本 1、完整采集、queued 与完整原文；用户截图确认 |
| 2 | 2026-08-02 | Chrome | Web 单文件 | 是 | 自动完整 | 是（绿色服务器回执后显示成功） | 无 | 完整保存 | 回执附件数 1；详情显示文件名、MIME、大小和 SHA-256；60 秒下载链接成功读取文件 |
| 3 | 2026-08-02 | Chrome | Web 多张截图 | 是 | 自动完整 | 是（两项上传完成并取得绿色服务器回执后） | 无 | 完整保存 | 两张生成 PNG 均保存；回执附件数 2；历史及详情元数据一致 |
| 4 | 2026-08-02 | Chrome | ChatGPT 完整会话 | 是 | 自动完整 | 是（扩展显示真实 complete receipt 后，并由 Web 历史与详情交叉确认） | 无 | 完整保存 | 正式扩展显示 2 条消息、0 个附件、异常 0；Web 为同一标题、版本 1、完整采集且消息顺序一致 |
| 5 | 2026-08-02 | Chrome | ChatGPT 同会话增量完整采集 | 是 | 自动完整 | 是（扩展显示 4 条消息的 complete receipt，并由 Web 版本详情确认） | 无 | 完整保存 | 同一 SourceItem 从版本 1 增为版本 2；版本 2 为 4 条有序消息，版本 1 仍为 2 条，无重复消息 |
| 6 | 2026-08-02 | Chrome | ChatGPT 当前问答 | 是 | 自动完整 | 是（扩展显示 2 条消息的 complete receipt，并由 Web 片段详情确认） | 无 | 完整保存 | 新建独立片段 SourceItem；只保存原会话消息 3 和 4，未混入前一组问答，异常 0 |
| 7 | 2026-08-02 | Chrome | ChatGPT 选中文字 | 是 | 自动完整 | 是（扩展显示 1 条消息的 complete receipt，并由 Web 片段详情确认） | 无 | 完整保存 | 新建独立片段 SourceItem；只保存所选助手文字“缩短专注周期：将 25 分钟调整为 10—15 分钟”，异常 0 |
| 8 | 2026-08-02 | Chrome | ChatGPT 选中文字恢复采集 / Recall API 不可用 | 是 | 初始失败 | 否（明确显示服务器尚未确认保存和 `Failed to fetch`） | 自动重试恢复 | 完整保存 | Web 服务恢复后扩展自动取得 1 条消息的 complete receipt、异常清零；Web 仍为同一 selection SourceItem、版本 1、1 条消息，无重复资料 |
| 9 | 2026-08-02 | Chrome | ChatGPT 完整会话原样重复提交 | 是 | 自动完整 | 是（扩展返回 4 条消息的 complete receipt） | 无 | 完整保存并去重 | Web 仍是同一 SourceItem、共 2 个版本；没有版本 3，版本 2 仍为 4 条消息，仅最近保存时间更新 |
| 10 | 2026-08-02 | Chrome | Web 手动文本 / 敏感级别 | 是 | 自动完整 | 是（绿色服务器回执后显示成功） | 无 | 完整保存 | Web 详情显示敏感、版本 1、完整采集、queued 和完整合成原文；Milestone A 无 AI/OCR 调用 |
| 11 | 2026-08-02 | Chrome | Web 手动文本 / 严格敏感级别 | 是 | 自动完整 | 是（绿色服务器回执后显示成功） | 无 | 完整保存 | Web 详情显示严格敏感、版本 1、完整采集、queued 和完整合成原文；Milestone A 无 AI/OCR 调用 |
| 12 | 2026-08-02 | Chrome | Web 单张截图 | 是 | 自动完整 | 是（图片状态从等待上传变为已保存并取得绿色服务器回执后） | 无 | 完整保存 | 回执附件数 1；历史显示截图来源，详情显示 image/png、1.0 MiB、SHA-256 与 60 秒下载入口 |
| 13 | 2026-08-02 | Chrome | Web 手动普通文本 | 是 | 自动完整 | 是（绿色服务器回执出现后） | 无 | 完整保存 | 回执显示 0 条消息、0 个附件；历史页新增版本 1，详情显示普通、完整采集、queued 与完整无隐私测试原文；异常计数 0 |
| 14 | 2026-08-02 | Chrome | Web Markdown 文件 | 是 | 自动完整 | 是（附件显示“已保存”并取得绿色服务器回执后） | 无 | 完整保存 | 回执附件数 1；历史显示文件来源、版本 1，详情显示 text/markdown、229 B、SHA-256 与 60 秒下载入口；异常计数 0 |
| 15 | 2026-08-02 | Chrome | Web PDF 文件 | 是 | 自动完整 | 是（附件显示“已保存”并取得绿色服务器回执后） | 无 | 完整保存 | 使用已渲染检查的一页无隐私合成 PDF；回执附件数 1，历史显示文件来源、版本 1，详情显示 application/pdf、1.7 KiB、SHA-256 与 60 秒下载入口；异常计数 0 |
| 16 | 2026-08-02 | Chrome | Web 正文 + Markdown 附件 | 是 | 自动完整 | 是（附件显示“已保存”并取得绿色服务器回执后） | 无 | 完整保存 | 回执附件数 1；历史显示版本 1，详情在同一版本中同时显示完整无隐私正文和 text/markdown 附件元数据；后台 queued，异常计数 0 |
| 17 | 2026-08-02 | Chrome | ChatGPT 含一张合成图片的完整会话 | 是 | 错误报告完整（实际缺图） | 否（虽在 durable receipt 后显示，但 receipt 错误声称完整） | 尚无 | 文字已保存，图片遗漏 | 正式扩展显示“完整采集成功”、6 条消息、0 个附件；Web 同一 SourceItem 新增版本 3，完整显示 6 条消息但没有附件区块，异常计数仍为 0。该图片已由 ChatGPT 正确识别并回复，因此不是未发送图片；这是符合支持条件的真实失败样本和不可降低底线违规。 |
| 18 | 2026-08-02 | Chrome | ChatGPT 含图完整会话 / 第一次修复后复测 | 是 | 错误报告完整（实际仍缺图） | 否（receipt 继续错误声称完整） | 尚无 | 未创建新版本，图片仍遗漏 | 重新加载正式扩展并刷新 ChatGPT 页面后再次保存；扩展仍显示完整采集、6 条消息、0 个附件。Web 强制刷新后仍为 3 个版本且无附件区块。真实 DOM 复核发现图片外层存在布局容器 `role="presentation"`，旧筛选通过 `closest()` 把有效图片误判为装饰；需第二次最小修复。 |
| 19 | 2026-08-02 | Chrome | ChatGPT 含图完整会话 / 第二次修复后复测 | 是 | 自动部分 | 是（durable partial receipt 后显示“部分内容未采集”） | 补充当前可见页面截图 | 人工兜底后完整保存 | 正式扩展先显示待处理异常 1，并列出“第 5 条消息中的图片无法保存：HTTP 403”。修复后只点击一次补充截图；扩展在 durable complete receipt 后显示 6 条消息、1 个附件、异常 0。Web 同一 SourceItem 新增版本 12，完整采集、仅一张 image/png、无缺失项；异常页显示目前没有未恢复异常。版本 5–11 作为修复前重复点击缺陷证据保留，不另计正式尝试。 |
| 20 | 2026-08-08 | Chrome | ChatGPT 新建文本会话 / Recall Web 服务停止 | 是 | 初始失败 | 否（明确保留在待处理列表，未显示成功） | Web 服务恢复后点击立即重试 | 完整保存 | 首次提交时数据库正常但 Web 服务不可用，扩展显示待处理异常 1、服务器尚未确认保存；服务恢复后复用原待处理项目重试，取得 complete receipt，显示 2 条消息、0 个附件、异常 0；用户截图确认。 |
| 21 | 2026-08-09 | Edge | ChatGPT 新建文本会话 / 完整会话 | 是 | 自动完整 | 是（扩展取得 complete receipt 后显示成功） | 无 | 完整保存 | Edge 正式扩展正确识别 ChatGPT 网页版；显示完整采集成功、2 条消息、0 个附件、待处理异常 0；用户截图确认。 |
| 22 | 2026-08-09 | Edge | ChatGPT 文本会话 / Recall Web 停止并重启 Edge | 是 | 初始失败 | 否（明确显示待处理异常，未显示成功） | 关闭全部 Edge 窗口并重开；恢复 Web 后重试 | 完整保存 | Web 停止后工具栏与弹窗显示待处理异常 2；重开 Edge 后两项仍在。服务恢复后 complete receipt 显示 2 条消息、0 个附件、异常 0。只读数据库核对为 1 个 SourceItem、1 个 complete 版本、2 个唯一消息 ID；重复待处理没有产生重复版本或消息。本行只计一次正式尝试。 |
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
| 符合支持条件的真实尝试 `N_supported` | 22 |
| 首次自动完整 `N_auto_complete` | 16 |
| 首次自动部分 `N_auto_partial` | 1 |
| 初始失败 `N_initial_failed` | 3 |
| 错误报告完整 `N_false_complete` | 2 |
| 重试恢复 `N_retry_recovered` | 3 |
| 人工兜底完成 `N_manual_fallback` | 1 |
| 验收结束仍未恢复 `N_unresolved_failed` | 0 |
| 成功文案早于 durable receipt 的次数 | 0 |

正式自动采集成功率：

```text
N_auto_complete / N_supported × 100%
16 / 22 × 100% = 72.73%（阶段值，样本不足且尚未达到正式目标）
```

兜底完成率单独报告：

```text
N_manual_fallback / N_supported × 100%
1 / 22 × 100% = 4.55%
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
| B-04 负向检查 | 输入限制 | 未选择文字时显示 `Selected text is empty`，待处理异常 1，未显示成功 | 否 | 用户未提供“选中文字”范围所必需的 DOM selection | 重新选中文字后使用“重新采集当前页面”；服务恢复后完成并清除异常 | 否；符合诚实失败设计 |
| 8 | 服务 | 有效 selection 恢复采集时显示 `Failed to fetch` 和“服务器尚未确认保存” | 否 | 本地 Recall Web 服务停止；Supabase 仍可用 | 非破坏性重启 Web，等待扩展自动重试 | 否；自动恢复后 receipt 为 1 条消息，Web 无重复资料 |
| 17 | 产品缺陷 / ChatGPT 图片遗漏 | 含一张已成功发送并被 ChatGPT 识别的合成图片；扩展与 Web 保存 6 条文字消息、0 个附件，却显示“完整采集成功”，异常数为 0 | 是，但 receipt 的完整性结论错误 | 当前 ChatGPT 提取或完整性判断没有识别该图片为预期附件/缺失元素 | 暂停继续计数；修复后用同一会话复测，应保存附件 1 或诚实返回 partial 并列出缺图 | 是；验收阻断，修复前最终结论为 FAIL |
| 18 | 产品缺陷 / ChatGPT 图片仍被布局容器误排除 | 第一次修复并重新加载正式扩展后，仍显示完整采集、6 条消息、0 个附件；Web 仍为 3 个版本 | receipt 复用了错误的完整结果；没有创建含附件的新版本 | 图片的较高层祖先 `div[role="presentation"]` 被 `image.closest(excludedImages)` 命中，真实附件在进入完整性检查前仍被过滤 | 新增真实祖先结构回归测试；仅把展示用途限制到图片节点本身，同时保留隐藏祖先及明确头像/反馈/图标排除 | 是；第二个验收阻断，修复并真实复测前保持 FAIL |
| 19 | 页面资源权限 / 诚实 partial | 第二次修复后识别到图片，但下载 ChatGPT Estuary 资源返回 HTTP 403；扩展显示部分采集和待处理异常 1 | 是；6 条文字消息已 durable 保存为版本 4 | ChatGPT 图片资源需要当前页面会话权限，扩展后台直接请求未获授权；现有设计要求以 partial 和截图兜底恢复 | 同一次尝试通过扩展“补充截图”保存当前可见页面；版本 12 完整、1 张 PNG、异常归零 | 当前诚实 partial 符合设计；截图兜底已验证，直接附件下载可作为后续兼容性改进 |
| 19 恢复过程 | 产品缺陷 / 截图恢复状态与重复附件 | 修复前补充截图已上传，但弹窗仍显示 partial；用户因无成功反馈重复点击，Web 形成版本 5–11，后续版本继承并累积截图 | 是；每次均有 partial receipt，但缺失项没有被截图兜底清除 | 截图恢复草稿继承原 `completeness`、`missingElements` 和历史附件；本地仅有按钮级防重，没有持久及并发单飞保护 | 采用方案 A：新恢复草稿只含本次 PNG、状态 complete、缺失项清空；Outbox 子项检查与控制器单飞共同防重；正式构建复测形成版本 12 | 是；修复提交 `18295d4`，151 项扩展测试、类型检查、正式构建、Manifest 与 secret 检查通过；真实 Chrome 复测通过 |
| 22 | 服务 / 浏览器重启恢复 | Recall Web 停止时 Edge 显示待处理异常 2；关闭全部 Edge 窗口并重开后项目仍保留，没有显示成功 | 否 | 验收主动暂停本地 Web 服务；数据库仍在线 | 重开 Edge 后恢复 Web，原项目重试取得 complete receipt；数据库只有 1 个 SourceItem、1 个 complete 版本和 2 个唯一消息 ID | 否；浏览器重启持久性与服务恢复去重符合设计，附件 Blob 仍需独立验证 |
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
| 自动化测试与构建 | PASS | 34 个测试文件、260 项测试、12 项 E2E、lint、typecheck、build 全部通过 |
| 数据库迁移与 RLS | PASS | 非破坏性迁移校验为 up to date；6 个 pgTAP 文件、80 项断言通过。为保留本地数据，未执行清空式 `db reset` |
| 客户端 secret 与 Manifest | PASS | secret 扫描、Manifest V3、权限、host、正式构建恢复与临时目录清理均通过 |
| Web 手动采集 | NOT RUN |  |
| ChatGPT 扩展采集 | PASS | 第 17、18 次图片静默遗漏已消除；第 19 次诚实返回 partial，并在同次尝试中通过补充截图获得完整 receipt；Web 版本 12 为 6 条消息、1 张 PNG、异常归零 |
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
| 日期 | 2026-08-09 |
| 用户确认 | Chrome 与 Edge 真实验收进行中；第 17–22 次、第 19 次截图兜底、第 20 次服务恢复和第 22 次 Edge 重启恢复结果由用户截图确认 |
| Codex 验证摘要 | 含图会话的静默遗漏、布局过滤和截图恢复状态缺陷均已保留失败证据并修复。第 21 次 Edge 自动完整保存；第 22 次在 Web 停止后保留两个待处理项目，关闭并重开 Edge 后仍存在，服务恢复后完整保存、异常归零；数据库核对没有重复 SourceItem、版本或消息。此前扩展 151 项测试、类型检查、正式构建、Manifest 与 secret 检查通过 |
| 未解决问题 | 当前 22/30；按现有 `N_auto_complete / N_supported` 口径为 16/22，达到正式 90% 至少需要继续增加 38 次全部自动完整的支持样本（总计 60 次）；Edge 已完成加载、配对、完整 ChatGPT 会话和无附件 Outbox 跨浏览器重启；补截图失败的真实浏览器路径、带附件断网/重启、附件 retry token 和凭据撤销/重新配对尚待验证；为保护本地数据，清空式数据库 reset 未执行 |
| Milestone B 是否允许开始规划 | 否；只有 Review Gate 完成后才能改为是 |
