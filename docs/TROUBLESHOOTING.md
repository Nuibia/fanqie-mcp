# 排障说明

先确认问题发生在哪一步：服务启动、Host 连接、番茄登录，还是平台读取。健康检查通过只说明服务进程能响应，不证明平台登录或数据采集有效。

## 服务无法启动

```sh
docker compose ps
docker compose logs --tail=100 fanqie-mcp
curl --fail http://127.0.0.1:18062/health
```

日志可能包含私有运行信息，提交 Issue 前只保留脱敏的错误摘要。

| 现象                           | 检查与处理                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- |
| 缺少 secret 文件               | 在项目根目录运行 `node scripts/init-secrets.mjs`，再启动                     |
| 端口被占用                     | 检查本机 18062/18063 的占用；调整 Compose 的宿主端口后同步 Host URL          |
| 拉取镜像或 Yarn 依赖失败       | 检查 Docker / Yarn 网络；首次构建需要联网                                    |
| 固定测试资源不可用或 hash 不符 | 保存脱敏错误并反馈；不要跳过检查或随意更换生产 hash                          |
| 本机 Chromium 未安装           | `yarn playwright install chromium`；Linux 按需用 `--with-deps chromium`      |
| 浏览器 profile 锁冲突          | 确认没有第二个服务实例使用同一数据/profile；不要在未知进程仍运行时手动删除锁 |

## Host 没有工具或提示 401/403

- URL 应为 `/mcp`，传输应为 Streamable HTTP。
- **401**：核对服务 `.secrets/api-token` 和 Host 使用的 Token。确认 `Bearer ` 前缀及变量已经传给 Host 进程。服务 Token 更新后重建容器并同步 Host 凭据。
- **403**：检查 `FANQIE_ALLOWED_HOSTS` / `FANQIE_ALLOWED_ORIGINS` 与实际请求是否一致；不要为了方便允许任意来源。
- **发现工具失败**：等服务健康后重新连接 Host。`mcp get` 的配置输出不能证明实际连接。
- **桌面客户端取不到环境变量**：图形程序不一定继承终端 export。检查桌面 Host 的私有凭据设置或实际启动环境。

## 已登录，却显示 unknown

`fanqie_get_service_status` 只看进程内已知登录记录，不主动检查平台。服务重启后记录为空，可能显示：

```json
{ "platform": { "status": "unknown", "checkedAt": null } }
```

这表示尚未检查，不能据此判断 Cookie 丢失。让 Agent 调用 `fanqie_check_login_status`，再看：

| 结果                  | 含义                       | 下一步                                                |
| --------------------- | -------------------------- | ----------------------------------------------------- |
| `authenticated`       | 本次访问验证了账号身份     | 查看 `identity.displayName` 和稳定 ID，再查作品       |
| `login_required`      | 官方登录页或登录提示可见   | 重新获取二维码，本人扫码                              |
| `unknown`，有检查时间 | 本次检查仍无法可靠确认账号 | 查看返回的 `reason`；确认平台挑战、页面变化或接口异常 |

昵称和账号 ID 由专用登录检查工具返回，普通状态摘要目前不包含它们。服务的逻辑账号 `owner` 不是番茄昵称。备份或 profile 存在也不证明登录仍有效。

## 二维码不显示、过期或有风险验证

MCP 的二维码工具返回 PNG。Host 不支持图片时，用[快速开始](QUICKSTART.md)里的 `qrcode` CLI 生成本地图片。二维码过期重新获取，人工挑战在官方页面处理。备用浏览器只在运行态可用时提供；状态过期不等于 API 服务故障。

## 查询超时或返回 partial

平台访问、分页和本地证据核验可能耗时。Host 单次等待至少设为 135 秒；有任务 ID 时查询 `fanqie_get_job`，不要因客户端超时连续重发刷新。

`job.status` 是业务状态：

- `succeeded`：查看数据集完整性、来源与限制，再判断数据是否满足需求。
- `partial`：只得到部分数据，不能称全量；旧完整快照会保留。
- `waiting_for_login`：先核验或完成番茄登录。
- `failed` / `cancelled`：查看错误码和任务结果；不要把有记录等同于成功。
- `uncertain`：写操作结果未知，应先 `fanqie_reconcile_write`；不要重发保存或投稿。

`available: null`、`conditional-unobserved` 表示依赖当前页面/API 状态，尚未证明这一刻可用；`verified-live` 表示有合格的历史真实验证，不能保证平台永远不变。

## 为什么数据不是最新的，或账号快照为空

`sourceMode: "saved"` 是历史读取，不访问平台。要新采集用作品/指标读取或账号刷新；采集时间、文章发布日期和统计截止时间是不同字段。

完整账号快照要求四数据集在同一个刷新任务全部完整。只查短故事清单，或刷新有一项失败，都不会制造完整账号快照。平台无法证明的窗口、单位和时区保持 unknown，不补零或推算成昨天。

## 正文、草稿列表与工具限制

正文工具读作者当前编辑版本，不证明为已发布版本。短故事草稿目录目前主要证明 ID 成员关系，标题与投稿/签约状态可能未知；不要按同名标题猜目标。

写工具存在不代表默认可用。本期查询使用无需打开 `FANQIE_ENABLE_WRITES`。签约、财务和真实投稿完整闭环不在本期公开使用承诺中。
