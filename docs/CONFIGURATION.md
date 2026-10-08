# 配置说明

服务通过环境变量配置。Docker 镜像已有容器路径、虚拟显示和非无头模式的默认值；本机源码启动使用下表中的默认值。

| 变量                           | 本机默认值                             | 说明                                                 |
| ------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `FANQIE_HOST`                  | `127.0.0.1`                            | 监听地址；容器内为 `0.0.0.0`，Compose 仍只向本机绑定 |
| `FANQIE_PORT`                  | `18062`                                | 服务端口                                             |
| `FANQIE_TOKEN_FILE`            | 无                                     | 私有 Token 文件路径，设置后优先于环境 Token          |
| `FANQIE_TOKEN`                 | 无                                     | 无文件时使用；至少 24 字符，不写入源码或日志         |
| `FANQIE_ACCOUNT_ID`            | `owner`                                | 本地服务的逻辑账号标识，不等于平台本人身份验证       |
| `FANQIE_DATA_DIR`              | `.runtime/data`                        | SQLite、证据及受控上传；容器为 `/data`               |
| `FANQIE_PROFILE_DIR`           | `.runtime/profile`                     | 私有 Chromium profile；容器为 `/data/profile`        |
| `FANQIE_RUNTIME_DIR`           | `.runtime/state`                       | 运行态目录；容器为 `/data/runtime`                   |
| `FANQIE_HEADLESS`              | `true`                                 | 仅值为 `false` 时关闭无头；容器为 `false`            |
| `FANQIE_ENABLE_WRITES`         | `false`                                | 仅值为 `true` 时启用写入；能力仍需独立核验           |
| `FANQIE_ALLOWED_HOSTS`         | `localhost,127.0.0.1,[::1],fanqie-mcp` | 允许的服务请求 Host，逗号分隔；不是平台出网域名列表  |
| `FANQIE_ALLOWED_ORIGINS`       | 空                                     | 允许的请求 Origin，逗号分隔                          |
| `FANQIE_TIMEOUT_MS`            | `120000`                               | 服务平台操作超时，最小 1000ms；不是客户端等待预算    |
| `FANQIE_READ_PROFILE`          | 无                                     | 私有、已核验的读取适配配置路径                       |
| `FANQIE_WRITE_PROFILE`         | 无                                     | 私有、已核验的写入适配配置路径                       |
| `FANQIE_RECOVER_PROFILE_LOCKS` | `false`                                | 仅容器明确启用、持有独占租约时恢复失效进程锁         |

`FANQIE_LOGIN_FALLBACK_INSTANCE` 是容器入口产生的备用浏览器实例 UUID，运行态文件固定在 `/run/fanqie/login-fallback.json`，不作为普通客户端身份配置。

## 最小本机配置

```sh
node scripts/init-secrets.mjs
yarn build
FANQIE_TOKEN_FILE=.secrets/api-token yarn start
```

配置由 `process.env` 读取，不自动加载 `.env`。表中默认目录由服务以 0700 创建；调用者需保护已有目录及外部 Token 文件的权限。

Compose 使用 `.secrets/api-token` 和 `.secrets/vnc-password` 作为 Docker secrets；容器入口复制到私有 `/run/fanqie/`，API 使用文件读取。凭据初始化保留已有值，轮换需要另行替换私有文件并重建使用该凭据的容器。

## 本机验收客户端

验收脚本默认访问 `http://127.0.0.1:18062` 并从 `.secrets/api-token` 读取凭据，可通过 `FANQIE_TEST_URL` 和 `FANQIE_TEST_TOKEN_FILE` 指定目标与私有文件。执行真实账号脚本前核对目标和操作范围，输出文件也按私有资料保护。

REST 客户端使用同一服务地址和 Bearer Token。未来 xiaoshuo 工作台的连接配置由该项目后端管理，本仓不提供工作台启动或配置入口。

## 数据、停止与升级

Compose 把数据库、证据、正文和浏览器会话保存在 `fanqie-data` 命名卷；本机源码启动使用配置表中的目录。不要让多个实例同时使用同一数据库或 profile。

```sh
docker compose stop       # 停止，保留容器与卷
docker compose start      # 再次启动
docker compose down       # 移除容器，保留命名卷
```

`docker compose down -v` 会删除卷，包含登录会话、历史与正文。不要把它当作常规排障命令。已有数据库格式与历史证据由服务恢复校验；升级前先备份，不覆盖原数据。

升级时先记录当前版本和本地修改，完成备份，再检出已经确认的发行版本重新构建：

```sh
node scripts/backup.mjs
node scripts/verify-backup.mjs
docker compose up -d --build
curl --fail http://127.0.0.1:18062/health
```

备份和校验脚本依赖本地模块，首次使用前执行 `yarn install --frozen-lockfile --ignore-scripts`。备份暂停本项目服务、导出私有卷到 `.runtime/backups/`，然后恢复原运行状态。校验恢复到临时隔离卷，不覆盖当前卷；它不证明平台会话仍有效。

重启后先让 Agent 调用 `fanqie_check_login_status`；状态摘要里的 unknown 可能只是尚未核验。完整备份恢复和旧版本回退须按具体版本兼容性处理，本项目不提供无条件数据库降级承诺。

## 首次开发测试资料

普通源码启动只需依赖、浏览器和编译。贡献者执行完整测试、CI 或 Docker 构建时，还要下载固定上游资源到本地缓存，见[贡献指南](../CONTRIBUTING.md)。缓存不随公开 Git 或发行镜像分发；准备失败不能跳过测试。
