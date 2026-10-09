# Agent Host 接入

fanqie-mcp 是 Streamable HTTP 服务：先启动服务，再配置 Host。它不提供 stdio 启动命令，也不使用 `codex mcp login` 做番茄登录；番茄扫码由服务工具处理。

## 接入参数

| 参数         | 默认值                               |
| ------------ | ------------------------------------ |
| MCP URL      | `http://127.0.0.1:18062/mcp`         |
| 鉴权 header  | `Authorization: Bearer <服务 Token>` |
| Token 来源   | 项目目录 `.secrets/api-token`        |
| 工具等待预算 | 至少 135 秒；完整刷新可能更久        |

服务位于另一台机器时，`127.0.0.1` 指向 Host 所在机器。远程连接需自行配置 HTTPS、访问控制和服务允许的 Host/Origin；本教程优先使用本机连接。

## Codex CLI

在服务项目目录打开终端。把 Token 读入进程环境，命令不会打印它：

```sh
export FANQIE_MCP_TOKEN="$(cat .secrets/api-token)"
codex mcp add fanqie --url http://127.0.0.1:18062/mcp \
  --bearer-token-env-var FANQIE_MCP_TOKEN
```

在本机私有 `~/.codex/config.toml` 的对应条目设置等待时间：

```toml
[mcp_servers.fanqie]
url = "http://127.0.0.1:18062/mcp"
bearer_token_env_var = "FANQIE_MCP_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 150
```

从刚才设置环境变量的终端启动 `codex`。在 `/mcp` 中查看连接，然后说：“使用 fanqie 查询作家课堂新手专区，不执行写操作。”

环境变量只在该终端及子进程中有效。重开终端后重新 export。`codex mcp get fanqie` 可以检查配置，但它不证明实际工具调用成功。配置语法已按 Codex CLI `0.162.0-alpha.2` 帮助和[官方 MCP 文档](https://developers.openai.com/codex/mcp/)核对。

### Codex 桌面端

桌面进程不一定继承终端的环境变量。使用应用 MCP 设置或本机私有配置提供 URL 和 Bearer header，确认桌面进程能取得凭据；不要把 Token 写进项目里的公开配置。若采用上述环境变量方案，需在当前宿主的启动环境中设置它，再重新启动客户端。

桌面端的具体设置入口和凭据管理随版本变化。本教程不将 CLI 的环境继承方式等同于桌面行为；以应用中实际工具发现和调用成功为准。

## Claude Code

推荐把以下模板存到**本机私有配置文件**，例如项目目录内被忽略的 `.secrets/claude-mcp.json`。它不是需要提交的 `.mcp.json`：

```json
{
  "mcpServers": {
    "fanqie": {
      "type": "http",
      "url": "http://127.0.0.1:18062/mcp",
      "headers": { "Authorization": "Bearer ${FANQIE_MCP_TOKEN}" }
    }
  }
}
```

然后在服务目录的终端执行：

```sh
export FANQIE_MCP_TOKEN="$(cat .secrets/api-token)"
MCP_TIMEOUT=30000 MCP_TOOL_TIMEOUT=150000 \
  claude --mcp-config .secrets/claude-mcp.json --strict-mcp-config
```

`/mcp` 查看连接，同样先查询公开课程。`${FANQIE_MCP_TOKEN}` 留在 JSON 文件里，由 Host 在运行时展开；不要手动替换成实际 Token 后提交。

HTTP 类型、header 和环境变量展开方式来自[Claude Code 官方 MCP 文档](https://code.claude.com/docs/en/mcp)。本机 Claude Code `2.1.285` 的 CLI 已核对。

## 已验证范围

下表按**实际达到的层级**记录，连接成功、工具发现、模型实际调用和本人查询分别判断。历史实测日期不代表每个后续版本都已重验。

| Host / 客户端                           | 环境与日期                                | 连接 / 工具发现    | 模型实际调用                                            | 本人流程                               | 当前结论                           |
| --------------------------------------- | ----------------------------------------- | ------------------ | ------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Codex CLI 0.162.0-alpha.2               | macOS / Node 22.17.1，2026-10-08          | 已通过             | 状态、课堂目录与文章已通过                              | 本人扫码、身份与作品，重启后会话已通过 | 有端到端历史实测                   |
| Codex CLI 0.162.0-alpha.2               | macOS → 独立 Linux/ARM64 服务，2026-10-09 | 已通过             | 本轮状态/能力、55条完整课程、文章及分类历史调用已通过   | 本轮未读取本人数据                     | 新安装入口公开查询与历史通过       |
| Claude Code 2.1.285                     | macOS，2026-10-08/09                      | 10-08 已连接       | 10-08 模型认证失败；10-09 请求180秒超时，无实际调用结果 | 未验证                                 | 端到端仍未验证；本轮超时根因未证明 |
| Codex 桌面端                            | 当前未独立验收                            | 未验证             | 未验证                                                  | 未验证                                 | CLI 结论不迁移到桌面端             |
| Claude Desktop / Cursor / Cherry Studio | 未独立验收                                | 未验证             | 未验证                                                  | 未验证                                 | 仅按 HTTP 能力选型，未承诺兼容     |
| 官方 MCP SDK 客户端                     | 独立 Linux/ARM64 空卷，2026-10-09         | 40工具及鉴权已通过 | 不包含模型；状态/能力与REST一致                         | 不包含本人流程                         | 属于协议检查，不等于某个 Host 验收 |

2026-10-08，在 macOS、Node.js 22.17.1 的独立源码实例上，Codex CLI `0.162.0-alpha.2` 已实际发现工具并完成状态、新手课程目录和文章调用，返回完整的实时结果。公开资料查询使用独立服务 Token，不依赖番茄登录。随后本人扫码，在明确授权下完成账号身份核验和本人短故事查询；服务重启后会话仍有效。

同日 Claude Code `2.1.285` 已连接此 HTTP MCP 服务，但本机模型服务认证失败，未完成模型驱动的工具调用；因此只确认连接，端到端查询仍待验证。Codex 桌面端和其他 Host 尚未完成独立验收。

## 其他客户端

支持 Streamable HTTP、自定义 Bearer header 和足够等待预算的客户端，可以使用上述接入参数。Cursor、Claude Desktop 等未在本教程承诺实测兼容，不把 HTTP 配置直接改写为 stdio 配置。

## 验证连接和登录

按顺序让 Agent 执行：

1. `fanqie_get_service_status`：确认服务能响应。
2. `fanqie_get_capabilities`：确认默认写关闭和当前能力。
3. `fanqie_get_writer_class_catalog`，参数 `{"category":"1"}`：验证真实工具调用。
4. 要读取私人作品时，获取登录二维码、本人扫码，再调用 `fanqie_check_login_status` 核对昵称。

没有工具通常是接入或发现失败；401 是服务 Token 问题；`login_required` 是番茄登录问题。两层凭据分别处理，详见[排障](TROUBLESHOOTING.md)。

验证完整路径与成功字段时可直接使用[演示](DEMO.md)。仅 `/mcp` 显示连接或列出 40 个工具，仍需要执行一次真实课堂查询；任务必须 succeeded 且覆盖完整。提交兼容性反馈时，说明 Host 版本、系统、实际调用工具及脱敏状态，避免上传真实账号结果。
