# 使用固定版本镜像

镜像方式只需要 Docker Compose、Git 和 Unix shell，无需在宿主机安装 Node.js、Yarn、浏览器或运行开发测试。源码构建方式继续见[快速开始](QUICKSTART.md)。

从[版本发行说明](https://github.com/Nuibia/fanqie-mcp/releases/tag/v0.1.0)选择与你的机器架构对应的已验收镜像和固定 digest。发行流程分别构建 `linux/amd64` 和 `linux/arm64`，使用独立版本标签；本页不使用占位地址冒充发行镜像。

## 1. 选择版本

克隆源码并进入目录，使用 Release 对应的源码版本。若只部署镜像，也可从该版本下载 `compose.release.yaml`；后续命令在其所在目录执行。

```sh
git clone --branch v0.1.0 https://github.com/Nuibia/fanqie-mcp.git
cd fanqie-mcp
```

将 **Release 中实际提供的引用**保存到当前终端环境。例如下方变量是占位符，必须替换：

```sh
export FANQIE_IMAGE='<Release提供的镜像仓库>@sha256:<Release提供的digest>'
docker pull "$FANQIE_IMAGE"
```

优先使用与你的 CPU 架构对应的 digest 固定镜像内容。发行流程使用版本与架构标签（如 `0.1.0-amd64`、`0.1.0-arm64`），不提供 `latest`；标签本身仍可能被重新推送。不要把来源不明的镜像或 `latest` 用于保存账号会话。

## 2. 初始化凭据，不需要本机 Node

```sh
(umask 077 && mkdir -p .secrets)
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --entrypoint node --workdir /setup \
  --mount "type=bind,src=$PWD/.secrets,dst=/setup/.secrets" \
  "$FANQIE_IMAGE" /app/scripts/init-secrets.mjs
```

Node 在镜像内运行，仅挂载本机 `.secrets/` 并写入两个凭据文件。目录权限为 0700，文件为 0600；已有凭据保留。命令不需要联网，不打印 Token。不要用 `sudo` 改成 root 所有权。

## 3. 启动并完成第一次查询

```sh
docker compose -f compose.release.yaml up -d --wait --wait-timeout 120
curl --fail http://127.0.0.1:18062/health
```

Compose 必须取得 `FANQIE_IMAGE`；缺少变量时明确报错，不会回退到源码构建。服务保持写关闭，API 和备用浏览器仅绑定本机。连接参数仍是 `http://127.0.0.1:18062/mcp` 和 `.secrets/api-token`，按[客户端接入](CLIENTS.md)配置，再执行[完整演示](DEMO.md)。

拉取失败时先核对引用、架构与公开可见性；不要通过删除数据卷解决镜像权限问题。首次运行空卷的登录状态通常为 `unknown`，公开课堂查询无需登录。

## 停止、重启与升级

所有镜像部署命令均显式使用同一个 Compose 文件：

```sh
docker compose -f compose.release.yaml stop
docker compose -f compose.release.yaml start
docker compose -f compose.release.yaml restart
```

发布配置固定 Compose 项目名为 `fanqie-mcp`，与默认源码克隆目录和现有备份脚本一致，使用相同的数据卷。已有源码部署切换时，先备份并停止旧服务；不要让两种服务同时占用同一卷或端口。若旧部署自定义过项目名，先核对原卷再迁移；`-p` 会覆盖固定名称并选择另一数据卷，看起来像“历史丢失”。

升级前参照[配置与备份](CONFIGURATION.md)完成私有备份和校验；现有备份脚本仍需要维护者本地 Node/Yarn，镜像启动流程不替代备份工具。记录原镜像 digest，切换到新 Release 给出的引用，再执行：

```sh
docker pull "$FANQIE_IMAGE"
docker compose -f compose.release.yaml up -d --wait --wait-timeout 120
curl --fail http://127.0.0.1:18062/health
```

重新打开终端需再次设置 `FANQIE_IMAGE`。普通 `down` 保留命名卷；**`down -v` 删除账号会话、历史和正文**。数据库兼容性以具体 Release 为准，不承诺直接换回旧镜像即可降级。
