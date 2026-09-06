# Recall AI Milestone A 本地运行手册

本文档用于在本机启动 Recall AI Milestone A、安装未打包的 Chrome/Edge 扩展、完成个人账号登录与扩展配对，并检查可靠采集 Outbox。本文档不包含任何真实凭据值。

## 1. 当前范围

Milestone A 只验证可靠采集闭环：

- Web 端粘贴文本、上传文件、上传单张或多张截图；
- ChatGPT 网页版完整会话、当前问答和选中文字采集；
- 服务器确认原文与附件持久保存后才显示成功；
- 部分采集列出缺失项；
- 断网、服务失败和身份失效时保留扩展 Outbox，并支持自动或手动恢复；
- 采集状态与后台处理状态分开显示。

OCR、知识卡片、混合搜索、知识库问答、研究专题和周期回顾不属于 Milestone A，不应把这些尚未实现的能力当作本地启动故障。

## 2. 前置软件

开始前确认以下软件可用：

- Windows 10/11；
- Docker Desktop，且 Docker Engine 已启动；
- Node.js 22.12.0 或更高版本；
- pnpm 11.9.0；
- 当前稳定版 Chrome 和 Edge；
- Git。

在仓库根目录检查版本：

```powershell
docker version
node --version
pnpm --version
git --version
```

如果 `docker version` 只能显示客户端信息，或报告无法连接 daemon，请先打开 Docker Desktop，等待界面显示 Engine 正常运行。

本地 Supabase 会使用多个端口，至少确保 `3000`、`54320`、`54321`、`54322`、`54323`、`54324`、`54327` 和 `8083` 未被其他程序占用。

## 3. 安装依赖并启动 Supabase

在仓库根目录运行：

```powershell
pnpm install
pnpm supabase start
pnpm supabase db reset
```

以上命令分别安装锁定依赖、启动本地 Supabase 容器，并从仓库迁移重新建立数据库、私有 `raw-captures` Storage bucket 和所有权隔离策略。

`pnpm supabase db reset` 会丢弃当前本地数据库和 Storage 中的真实测试数据。只允许在确认本地栈为空、或已按 `docs/runbooks/local-data-backup-and-restore.md` 完成可验证备份之后的一次性空环境中使用。对已有 ChatGPT 测试数据的 `127.0.0.1:54322` 项目禁止 reset、禁止 `supabase stop --no-backup`，也禁止删除 Docker volume。后续知识模型迁移前必须先通过该备份手册的校验与临时恢复演练。

检查本地服务状态：

```powershell
pnpm supabase status
```

该命令会在本机终端显示本地 URL 和开发凭据。不要把完整输出粘贴到聊天、Issue、测试报告或 Git；尤其不要提交 service-role key。

常用本地入口：

- Web 应用：`http://127.0.0.1:3000`
- Supabase API：`http://127.0.0.1:54321`
- Supabase Studio：`http://127.0.0.1:54323`
- 本地测试邮箱：`http://127.0.0.1:54324`

## 4. 配置本地环境变量

Web 环境变量放在 `apps/web/.env.local`，扩展环境变量放在 `apps/extension/.env.local`。这些文件已被 Git 忽略，不得强制加入版本控制。

Web 必需变量名称：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

扩展必需变量名称：

```text
WXT_PUBLIC_API_ORIGIN
WXT_PUBLIC_SUPABASE_URL
```

自动化扩展 E2E 还会在测试进程内临时设置以下两个测试专用变量；普通本地开发、手工验收和生产构建不得设置它们：

```text
WXT_TEST_BUILD
WXT_TEST_FIXTURE_ORIGIN
```

配置规则：

- `NEXT_PUBLIC_SUPABASE_URL` 使用本地 Supabase API URL。
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 使用本地 publishable/anon 开发密钥。
- `SUPABASE_SERVICE_ROLE_KEY` 只允许出现在 Web 服务端本地环境中，不得进入扩展环境或浏览器构建。
- `WXT_PUBLIC_API_ORIGIN` 使用 Recall Web API 的纯 origin，本地通常为 `http://localhost:3000`。
- `WXT_PUBLIC_SUPABASE_URL` 使用 Supabase 项目的纯 base origin，本地通常为 `http://127.0.0.1:54321`；不能追加 `/storage/v1`、查询参数、用户名、密码或其他路径。
- 非本地部署时，上述两个扩展来源必须使用 HTTPS。
- 不要给扩展增加 Supabase publishable key 或 service-role key。扩展附件上传只使用服务端签发的短期 signed upload token。
- 测试 fixture 来源采用双门控：只有同时满足 `WXT_TEST_BUILD=1` 且提供 `WXT_TEST_FIXTURE_ORIGIN` 时，测试来源才会进入扩展 host permissions、内容脚本匹配和 ChatGPT 页面识别。
- `WXT_TEST_FIXTURE_ORIGIN` 必须是一个精确的 loopback base origin，只允许主机 `localhost`、`127.0.0.1` 或 `[::1]`；不得包含额外路径、查询参数、fragment、用户名或密码，也不得使用局域网地址、公网域名或 wildcard。
- 只设置 `WXT_TEST_FIXTURE_ORIGIN` 而不设置 `WXT_TEST_BUILD=1` 时，该来源会被忽略，不会进入普通扩展构建。
- 只设置 `WXT_TEST_BUILD=1` 而没有 fixture origin 时，测试扩展构建会直接失败，避免生成边界不明确的测试包。
- 普通本地、手工 Chrome/Edge 验收和生产构建必须同时取消 `WXT_TEST_BUILD` 与 `WXT_TEST_FIXTURE_ORIGIN`，不能依赖“fixture 单独设置时会被忽略”来代替干净环境。

修改任何 `WXT_PUBLIC_*` 变量后都必须重新构建扩展并在浏览器扩展页面点击“重新加载”，因为 Manifest V3 host permissions 在构建时确定。

## 5. 创建本地个人用户并登录

本项目关闭公开注册，且 `supabase/seed.sql` 不提交个人用户。因此第一次本地使用需要手工创建一个仅用于本机的个人用户：

1. 打开 Supabase Studio：`http://127.0.0.1:54323`。
2. 进入 Authentication/Users。
3. 使用界面中的“添加用户”或同等入口创建一个测试邮箱用户，并将邮箱标记为已确认。
4. 打开 `http://127.0.0.1:3000/sign-in`。
5. 输入刚创建的邮箱，点击“发送登录链接”。
6. 打开本地测试邮箱 `http://127.0.0.1:54324`。
7. 打开最新邮件中的登录链接；完成后应返回 `http://127.0.0.1:3000/`。

执行 `pnpm supabase db reset` 会重建本地数据库，因此先前手工创建的本地用户也会被清除，需要重新创建。不要在迁移或 seed 中加入真实个人邮箱。

## 6. 启动 Web 与扩展开发环境

在第一个终端启动 Web：

```powershell
pnpm --filter @recall/web dev
```

在第二个终端启动扩展开发进程：

```powershell
pnpm --filter @recall/extension dev
```

以上是计划要求的日常开发启动命令。需要一个稳定、可手工加载并执行验收的扩展目录时，在另一终端构建 Manifest V3 版本：

```powershell
pnpm --filter @recall/extension build
```

稳定构建输出位于：

```text
apps/extension/.output/chrome-mv3
```

如果 WXT 开发进程生成 `apps/extension/.output/chrome-mv3-dev`，可在开发调试时加载该目录；正式的本地验收和清单检查使用 `chrome-mv3` 构建目录。

### 6.1 E2E 的临时测试扩展构建

运行 `pnpm e2e` 时，扩展 Playwright fixture 会执行以下隔离流程：

1. 在子进程中同时设置 `WXT_TEST_BUILD=1` 与精确 loopback `WXT_TEST_FIXTURE_ORIGIN`，生成测试专用扩展。
2. 立即把该测试构建复制到操作系统临时目录；Playwright 只加载这个临时副本。
3. 清除两个测试专用变量，重新生成普通正式构建到 `apps/extension/.output/chrome-mv3`。
4. 检查正式 manifest 不包含测试 fixture host。
5. E2E 结束后删除操作系统临时目录中的测试构建副本。

因此，`pnpm e2e` 运行期间曾短暂使用测试专用 host permission，但运行结束后仓库中的 `.output/chrome-mv3` 应当仍是没有 fixture origin 的正式构建。不要把测试临时目录用于手工安装、secret 扫描、Manifest 验收或 Chrome/Edge 冒烟。

如果 E2E 在恢复正式构建前异常终止，应在不设置两个 `WXT_TEST_*` 变量的干净终端中重新运行：

```powershell
pnpm --filter @recall/extension build
```

然后检查正式 `manifest.json`，确认测试 fixture origin 已消失，再继续后续验收。

## 7. 在 Chrome 中加载扩展

1. 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库中的 `apps/extension/.output/chrome-mv3`，不要选择仓库根目录或 `.output` 上级目录。
5. 确认扩展名称为 `Recall AI Capture`，且没有清单错误。
6. 将扩展固定到工具栏，便于查看角标和打开弹窗。

该目录必须是未设置 `WXT_TEST_BUILD` 和 `WXT_TEST_FIXTURE_ORIGIN` 的正式构建。不要从 `%TEMP%` 或其他操作系统临时目录加载 E2E 测试副本。

代码或扩展环境变量变化后，重新运行构建命令，再回到 `chrome://extensions` 点击该扩展的“重新加载”。

## 8. 在 Edge 中加载扩展

1. 打开 `edge://extensions`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择 `apps/extension/.output/chrome-mv3`。
5. 确认扩展名称、权限和服务工作线程均正常。
6. 将扩展固定到工具栏。

Edge 冒烟同样只允许使用仓库中的正式 `chrome-mv3` 构建，不使用 E2E 临时测试副本。

Chrome 与 Edge 可以加载同一个 Chromium Manifest V3 构建，但配对凭据分别保存在各浏览器的扩展本地存储中，因此两个浏览器需要分别配对。

## 9. 配对浏览器扩展

1. 确认 Web 已登录。
2. 打开 `http://127.0.0.1:3000/settings`。
3. 在“配对浏览器扩展”卡片中点击“生成配对码”。
4. 在十分钟内打开浏览器工具栏中的 Recall AI 扩展。
5. 输入 8 位一次性配对码和便于识别的设备名称。
6. 点击“连接扩展”。
7. 回到 Web 设置页，确认“已配对设备”出现该设备。

配对码只能交换一次。配对码过期、已经使用或复制错误时，重新生成新码。设备丢失或不再使用时，在设置页撤销对应设备；扩展下次请求会进入“扩展连接已失效，请重新配对”，本地未解决 Outbox 不会因此被删除。

## 10. 执行一次基础采集

### 10.1 Web 手动采集

1. 打开 `http://127.0.0.1:3000/captures/new`。
2. 输入标题和文本，或添加受支持的文件/截图。
3. 点击保存。
4. 只有看到服务器回执后才应出现“完整采集成功”或“部分内容未采集”。
5. 在“采集记录”中确认记录、消息/附件数量和状态。

支持的单个附件上限为 10 MiB；每次最多 50 个附件、总计最多 100 MiB。支持 MIME 类型：

- `image/png`
- `image/jpeg`
- `image/webp`
- `text/plain`
- `text/markdown`
- `application/pdf`

### 10.2 ChatGPT 扩展采集

1. 在已登录的 `https://chatgpt.com` 打开一段已加载完成的会话。
2. 打开 Recall AI 扩展。
3. 选择“完整会话”“当前问答”或“选中文字”。使用选中文字模式前，先在页面中实际选中文字。
4. 选择敏感级别。
5. 点击“保存到 Recall AI”。
6. 在服务器完成 durable finalization 前，弹窗只能显示“服务器尚未确认保存”等未完成状态，不能显示成功。
7. 收到真实回执后，弹窗显示“完整采集成功”或“部分内容未采集”，并显示保存数量或缺失项。

当前扩展只把精确 origin `https://chatgpt.com` 视为受支持页面。相似域名、HTTP 页面或其他站点不会启用自动采集。

## 11. 检查 Outbox 与异常

普通检查优先使用弹窗，不需要打开开发者工具：

- 工具栏角标表示尚未解决的 Outbox 数量。
- 弹窗顶部显示“待处理异常 N”。
- “待处理采集”列表允许在多个未解决项目之间切换；较新的成功项目不会遮住较早异常。
- `服务器尚未确认保存`：服务器尚未返回 durable receipt；可等待自动重试或点击“立即重试”。
- `部分内容未采集`：可用原文已经保存，但仍有明确缺失项；按提示补充截图或重新采集。
- `扩展连接已失效，请重新配对`：重新配对后恢复暂停任务。
- `采集无法自动恢复，需要重新采集`：使用当前页面重新发起关联恢复采集。
- `原文已保存，后台处理失败`：采集数据没有丢失，只是后续处理失败；不要使用“采集失败”语言描述它。

Web 异常页中的手动采集失败可使用“重新填写并恢复”。该入口会携带精确的旧 `captureId`；服务器只接受同一所有者、相同来源和相同采集范围的恢复。旧失败不会因为打开页面、开始上传或新建一条无关联资料而消失，只有关联的新会话完成 durable finalization 后才会原子标记为已解决。ChatGPT 的终止恢复由扩展 Outbox 携带同样的显式会话关联。

Milestone A 没有静默丢弃或忽略未解决失败的操作。关闭弹窗、关闭标签页或重启浏览器后，未解决项目仍应存在。

需要深入诊断时：

1. 在 `chrome://extensions` 或 `edge://extensions` 找到扩展。
2. 点击服务工作线程的“检查视图”或同等入口。
3. 在开发者工具 Application/Storage 中检查扩展存储。
4. `browser.storage.local` 的 Outbox 键是 `recall.captureOutbox`，未解决计数键是 `recall.outbox.unresolvedCount`。
5. 附件 Blob 保存在 IndexedDB 数据库 `recall.capture-attachments.v1`，而不是塞入 `storage.local`。

只做只读检查，不要在开发者工具中手工修改或删除 Outbox、credential 或 IndexedDB 数据。截图或日志中不要暴露扩展 token、signed upload URL、配对码、个人原文或附件内容。

## 12. 常见故障排查

### Docker 或 Supabase 无法启动

- 确认 Docker Desktop Engine 已运行。
- 运行 `docker version` 和 `pnpm supabase status`。
- 检查本手册列出的本地端口是否被占用。
- 如果容器处于异常状态，先保存需要的诊断信息；不要随意删除 Docker volume，因为这会清除本地数据。

### Web 提示本地配置不可用

- 确认 `apps/web/.env.local` 包含三个必需变量名称。
- 确认 URL 与当前 `pnpm supabase status` 一致。
- 修改 `.env.local` 后重启 Web 开发进程。
- 不要把 service-role key 放入 `NEXT_PUBLIC_*` 变量。

### 登录链接没有收到

- 确认用户已先在本地 Studio 创建且邮箱已确认。
- 确认登录邮箱与 Studio 中完全一致。
- 打开 `http://127.0.0.1:54324` 检查本地邮箱，而不是等待真实互联网邮箱。
- 确认 Web 使用 `http://127.0.0.1:3000`，与本地 Supabase redirect 配置一致。

### 扩展无法连接 Web 或 Supabase

- 核对 `apps/extension/.env.local` 中两个 origin。
- `WXT_PUBLIC_SUPABASE_URL` 不能以 `/storage/v1` 结尾。
- 修改环境变量后重新构建并在扩展页面重新加载。
- 打开构建后的 `manifest.json`，确认只存在精确的 Web API 和 Supabase host permission。
- 如果 Web 使用了不同端口或域名，必须在重新构建前更新 `WXT_PUBLIC_API_ORIGIN`。
- 检查普通终端没有遗留 `WXT_TEST_BUILD` 或 `WXT_TEST_FIXTURE_ORIGIN`；正式 manifest 不应出现 fixture 测试端口。
- 如果只设置了 `WXT_TEST_FIXTURE_ORIGIN`，普通构建会忽略它；这不是启用测试页面的正确方式。自动化测试必须由 E2E fixture 同时设置双门控变量。

### 采集一直显示“服务器尚未确认保存”

- 查看弹窗中的下一次自动重试时间，并尝试“立即重试”。
- 确认 Web 和 Supabase 仍在运行。
- 确认扩展角标与 Outbox 项没有因关闭页面而消失。
- 如果凭据已撤销或过期，先重新配对；恢复后扩展会重新安排任务。
- 不要因为附件已经出现在 Storage 就手工判定成功；必须以 finalize/status 返回并落入本地的真实 receipt 为准。

### 部分采集无法补截图

- 确认当前活动标签仍是原始 ChatGPT 会话。
- 确认是在用户点击扩展后执行，浏览器仍授予 `activeTab`。
- 浏览器拒绝截图时，原 partial receipt 必须保留；可重新打开原会话后再试，或使用 Web 手动上传截图。

### 显示“原文已保存，后台处理失败”

这是处理状态错误，不是采集丢失。原始资料已经有服务器回执。Milestone A 不执行实际 AI/OCR 处理，仅保留后续里程碑使用的处理任务状态。

## 13. 停止本地服务

停止 Web 和扩展开发进程可在各自终端按 `Ctrl+C`。不再需要本地 Supabase 时运行：

```powershell
pnpm supabase stop
```

停止服务不会自动删除仓库文件。需要保留本地数据库以便下次继续时，不要使用会删除 volume 的额外参数。

## 14. 数据备份

当前本地项目已包含真实测试数据时，使用 `docs/runbooks/local-data-backup-and-restore.md` 创建并校验备份。恢复只能针对一次性临时项目，不能以当前 `127.0.0.1:54322` 为恢复目标。

## 15. 下一步

本地运行成功后，按照 `docs/runbooks/milestone-a-acceptance.md` 执行自动化门禁、Chrome/Edge 手工冒烟和后续用户协助的 30 次真实采集验收。历史累计指标继续按 16/23 记录；Stage 0 后的 30 次发布候选窗口单独计数。在发布候选窗口和失败样本复核完成前，不得宣布 Milestone A 的正式 90% 指标已经通过。Stage 0 不支持页面回执、finalize 中断恢复和补截图失败路径已有自动化证据，见验收文档第 11.3 节与失败样本复核。
