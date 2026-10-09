# 快速开始

目标：先让 Agent 查到一份公开课程目录，再登录读取自己的作品。所有终端命令都在项目根目录执行；终端和 Agent 对话框是两个不同入口。

需要逐步对照预期结果时，打开[完整演示](DEMO.md)；日常场景用[五份提示词](PROMPTS.md)。以下是当前可用的源码构建路径；[固定版本镜像安装](IMAGE.md)已准备，待公开镜像发行后只需 Docker，无需本机 Node/Yarn。

## 1. 准备环境并启动服务

准备 Git、Node.js 22.13+、Yarn 1.22.22 和 Docker Compose。先检查：

```sh
node --version
yarn --version
docker compose version
git clone https://github.com/Nuibia/fanqie-mcp.git
cd fanqie-mcp
node scripts/init-secrets.mjs
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:18062/health
```

初始化会在 `.secrets/` 生成随机服务 Token 和备用浏览器密码，保留已有值。首次构建包含完整检查，需要联网下载依赖、镜像和固定测试资源；等待构建完成。容器应为 `running`，健康检查 JSON 中 `status` 应为 `ok`。

本项目固定使用 Yarn 1.22.22。若尚未安装 Yarn，Node.js 22/24 的 Corepack 可执行 `corepack enable`，再执行 `corepack prepare yarn@1.22.22 --activate`；之后确认 `yarn --version` 为 `1.22.22`。

如果已有项目目录，先进入该目录，不要重复克隆。首次构建失败时看[排障说明](TROUBLESHOOTING.md)，不要直接删除数据卷重试。

## 2. 连接 Agent Host

服务地址是 `http://127.0.0.1:18062/mcp`，传输为 Streamable HTTP。使用 `.secrets/api-token` 中的值配置 Bearer 鉴权，按[客户端接入](CLIENTS.md)完成设置。Token 不要发到聊天里。

连接成功后，让 Agent：

> 使用 fanqie MCP 查看服务状态和能力。不要执行写操作。

应能调用 `fanqie_get_service_status` 和 `fanqie_get_capabilities`。`writesEnabled` 应为 `false`。此时番茄登录状态可能是 `unknown`，可以先查公开资料。

## 3. 完成第一次查询，不需要登录

对 Agent 说：

> 查询番茄作家课堂的新手专区，列出课程标题。从结果选一篇，用文章 ID 读取正文。

实际工具参数：

```json
{ "category": "1" }
```

对应 `fanqie_get_writer_class_catalog`。第二步把目录返回的 `articleId` 原样传给 `fanqie_get_writer_article`，不要用标题代替 ID。

成功时，目录任务的 `job.status` 为 `succeeded`、`sourceMode` 为 `live`，数据集的 `coverage.complete` 和 `coverage.paginationComplete` 均为 `true`。课程数量会变化，不要求固定条数。文章正文是文字；图片链接可以返回，图片或视频内容没有自动转写。

## 4. 本人扫码登录番茄

对 Agent 说：

> 获取番茄登录二维码，显示给我。我扫码后，请检查登录状态并告诉我当前账号昵称。

Agent 先调用 `fanqie_get_login_qrcode`，本人按官方提示扫码，再调用 `fanqie_check_login_status`。成功时返回 `authenticated`，`identity.displayName` 为账号昵称，`identity.accountId` 或 `authorId` 为稳定账号标识。

二维码过期就重新获取。若平台要求风险验证或客户端不能显示二维码，可以在终端执行：

```sh
yarn install --frozen-lockfile --ignore-scripts
node scripts/docker-acceptance.mjs qrcode
```

二维码图片位于 `.runtime/login-qrcode.png`，仅本人查看。需要备用浏览器时执行 `node scripts/docker-acceptance.mjs login`，确认备用运行态可用后打开 `http://127.0.0.1:18063/vnc.html`；连接密码在 `.secrets/vnc-password`。遇到挑战时在官方页面人工处理，再检查登录，不要让 Agent 猜验证码。

## 5. 查询自己的作品和数据

```text
确认当前登录账号后，列出我的短故事作品。
查看我的长篇作品经营数据，保留平台原始统计口径和截止时间。
```

参数示例：

```json
{ "kind": "short" }
```

用于 `fanqie_list_works`；`fanqie_get_metrics` 使用相同的 `kind`，长篇用 `"long"`。针对某部作品时，使用平台读取结果里的 ID；指标 ID 的语义见[工具参考](TOOLS.md)。

如要一次刷新短故事作品、短故事指标、长篇作品、长篇指标，使用 `fanqie_refresh_account`：

```json
{ "datasets": ["short_works", "short_metrics", "long_works", "long_metrics"] }
```

四项全部完整才推进完整账号快照。调用可能较慢，让客户端等待任务；不要把 HTTP 200 或收到部分记录当成完整成功。

## 6. 查看历史与重启后的状态

对 Agent 说：“查看上一次保存的账号快照，不刷新平台。”对应：

```json
{ "scope": "account" }
```

用于 `fanqie_get_saved_snapshot`，结果应标为 `sourceMode: "saved"`。若还没有完整账号刷新，账号快照可以为空；单独读取作品不会自动生成完整四数据集账号快照。

浏览器登录会话和数据库保存在 Compose 数据卷中，普通重启不会主动删除它们：

```sh
docker compose restart
```

重启后状态摘要可能显示 `unknown` 和空检查时间。调用 `fanqie_check_login_status` 重新核验；已保存会话可能仍有效，也可能因平台过期而要求重新扫码。

## 本机源码启动

没有 Docker 时，可以使用本机 Chromium；Linux 需要相应浏览器系统库。

```sh
yarn install --frozen-lockfile --ignore-scripts
yarn playwright install chromium
node scripts/init-secrets.mjs
yarn build
FANQIE_TOKEN_FILE=.secrets/api-token yarn start
```

保持该终端运行，另开终端或客户端连接同一个 MCP 地址。本机默认无头运行。`yarn start` 不运行测试，不需要准备开发测试缓存；贡献者运行完整测试时按[贡献指南](../CONTRIBUTING.md)准备资料。
