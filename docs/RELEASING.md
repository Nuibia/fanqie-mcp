# 维护者镜像发行

本页描述维护者流程。普通用户使用[镜像安装](IMAGE.md)；公开镜像、源码 tag / Release、仓库可见性和安全报告入口分别确认，不把构建成功当作已经公开发行。

## 构建演练

`.github/workflows/image.yml` 仅手动触发，默认 `publish=false`，不会因 push / PR / tag 自动上传镜像。选定候选源码运行 **Versioned container**：

1. 校验 `package.json` 版本与当前 tag（若有），生成 `ghcr.io/<owner>/<repo>:<version>-<architecture>`。
2. 选择 `amd64` 或 `arm64`，分别在对应原生 Linux runner 构建；Dockerfile 保留完整 lint、格式、类型、离线测试和编译检查。
3. 从新镜像初始化临时凭据，以独立 Compose 项目和空数据卷启动。
4. 验证 health、未授权 401、未允许 Origin 403、40 个 MCP 工具、状态/能力调用与 REST 一致，且写关闭。
5. 清理临时容器和数据卷。本步骤不连接番茄账号，也不调用真实平台读取。

失败时阻断后续步骤，不跳过质量检查。真正的首次公开课堂查询和 Host 端到端调用在受控安装验收中另行执行；自动协议检查不能代替 Host 模型调用。

原生 runner 使用 `ubuntu-24.04` / `ubuntu-24.04-arm`，可用范围见 [GitHub 官方说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。每次只验证并发行所选架构，两个架构使用独立标签，不把单架构镜像称为多架构镜像。

## 发布版本镜像

只有获得发行授权后，才创建与包版本匹配的源码 tag（如 `v0.1.0`），并在该 tag 手动运行 workflow，选择 `publish=true`。从 main 或版本不符的 tag 推送会在构建前被拒绝。

workflow 使用仓库 `GITHUB_TOKEN` 推送 GHCR，记录完整 digest。不生成 `latest`，不自动创建 GitHub Release，也不改变仓库或 Package 的公开可见性。镜像 package 应确认允许匿名拉取；私有仓库构建成功不能证明镜像公开可用。

标签可以被覆盖；Release 安装说明以 `ghcr.io/<owner>/<repo>@sha256:<实际digest>` 固定内容。版本与源码 tag、镜像 revision label 必须对应，不把旧候选镜像当作新源码构建。

## 发布前复核

- 拟公开 Git 引用和源码包通过[安全检查](../SECURITY.md)，原创/依赖许可证与第三方通知正确。
- 新镜像全部层不携带上游开发测试缓存、运行数据、Token、账号、正文或浏览器会话。
- 匿名拉取 **Release 中的实际 digest**，按 `compose.release.yaml` 在干净环境启动，完成公开课堂与 saved 查询。
- 列出实际验证的平台。分别记录 AMD64 / ARM64 的构建与运行结果，不因基础镜像支持多架构或某个平台通过就声明另一个也通过。
- 私密漏洞报告入口实际可用；公共 Issue 不收集漏洞细节。入口未启用时继续按安全策略请求私密渠道。

## Release 正文要点

写明查询服务定位、默认写关闭、精确源码版本、镜像 digest、支持平台、安装与演示链接、Host 实测矩阵、MIT 与第三方边界。投稿/发布、桌面 Host 或新架构没有实测就明确待验证。

备份与升级指向[配置文档](CONFIGURATION.md)，不承诺无条件数据库降级。演练与验收的内部日志、工程记录和真实账号截图不随公开发行附件上传。
