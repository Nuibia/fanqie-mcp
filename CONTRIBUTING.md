# 贡献指南

欢迎修复问题、补充文档和改进平台适配。提交 Issue 时说明预期行为、实际行为、Node/Docker 版本和经过脱敏的复现步骤。涉及漏洞或凭据泄露时请遵循 [SECURITY.md](SECURITY.md)。

## 开发环境

需要 Node.js 22.13+；CI 使用 Node.js 24。使用 Yarn 1.22.22 和提交到仓库的 `yarn.lock`。

```sh
yarn install --frozen-lockfile --ignore-scripts
yarn hooks:install
yarn playwright install chromium
yarn test:prepare
yarn format
yarn lint
yarn format:check
yarn run check
yarn build
```

项目使用 ESLint 检查代码规则、Prettier 统一格式，两者安装固定版本。`yarn lint:fix` 修复可自动处理的规则，`yarn format` 统一排版；`yarn run check` 串联 lint、格式、类型检查与离线测试。

`test:prepare` 首次联网读取三个固定官方 CDN 资源，按生产 SHA-256 核验后生成开发缓存与固定条款。有效缓存可离线重复使用；缓存损坏或来源漂移明确失败，不会更新生产 hash 或跳过断言。生成文件在 `test/fixtures/`，被 Git、Docker 上下文和发行镜像排除。

缓存包含第三方正文，只供本地验证，不提交或再分发。源码启动 `yarn start` 不需要此缓存。准备脚本不登录账号、不执行下载的代码，也不访问作品数据；完整测试随后继续使用原离线传输替身。

若准备报告 `cache_incomplete` 或 `cache_hash`，仅删除下列三个生成文件后重新准备，不删除整个测试目录：

```sh
rm -f test/fixtures/short-native-submission-public-sources-20261007.json.gz \
  test/fixtures/short-native-submission-public-sources-20261007.manifest.json \
  test/fixtures/short-native-submission-terms-4c89ddd6.txt
yarn test:prepare
```

来源 hash 不符时，重下仍不符就停止并反馈；不要修改 pins 来绕过校验。

所有手写源码、测试和脚本的单文件上限为 500 行，空行和注释计入。超过上限时按职责提取模块和共享夹具，保留公开接口与测试覆盖；不要压缩代码、禁用规则或豁免大文件。

格式化覆盖服务、测试、脚本和文档；依赖、构建产物、运行数据、锁文件和要求逐字节一致的上游夹具不参与格式化。Prettier 不处理 Dockerfile 或 shell 脚本，请保留其现有风格。

## 测试范围

`yarn run check` 使用合成数据、临时存储和测试替身，不需要真实账号凭据。服务的封面像素测试使用真实但离线的 Chromium，需要先安装浏览器；Linux 缺少系统库时使用 `yarn playwright install --with-deps chromium`，也可通过 `FANQIE_COVER_TEST_BROWSER` 指定已安装的浏览器路径。

`scripts/docker-acceptance.mjs`、`scripts/account-acceptance.mjs`、`scripts/read-page-acceptance.mjs` 是真实服务验收入口，可能登录、读取平台、触发刷新或保存私有回执。它们不属于普通离线验证命令，不应在共享 CI 中自动运行。

测试通过只证明相应的离线合同；真实平台读写、登录和部署需要独立验证。请准确记录未验证、跳过、部分完成和未知结果。

CI 将格式、类型、脚本测试和构建放在独立的快速检查任务中，核心测试分成四组并行运行。每组内只运行一个测试进程，避免重型证据验证争抢 CPU、触发合成任务租约超时。四组共同覆盖全部核心用例，不省略失败测试。推送新提交会取消同一分支的旧检查。

## 提交信息

采用 Conventional Commits：`type(scope): subject`，scope 可省略，标题不超过 100 字符。类型使用 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore` 或 `revert`；本仓不使用 emoji。需要解释原因时，在标题后空一行写正文。

```text
fix(auth): handle expired login sessions

Report the login requirement before reading author data.
```

`yarn hooks:install` 在当前 Git 仓库安装 Husky 的 `commit-msg` 检查；因为安装命令使用了 `--ignore-scripts`，需要显式执行这一步。普通 `yarn install` 会自动安装 hook。源码压缩包和生产安装不安装 hook。CI 也会核验此次 push/PR 的提交信息，包括首次初始化和历史覆盖后的根提交。

## 修改要求

- 平台操作必须核验本人身份和稳定目标 ID，不按同名标题猜测目标。
- 写入保留默认关闭开关、前置版本校验、幂等记录、持久证据和保存后回读；结果未知时先对账。
- 新增公开响应使用字段白名单，避免返回 Token、Cookie、内部路径、原始快照或非专用出口的正文。
- 测试使用明确的合成标记和 `example.invalid` 等保留域名，不提交真实账号录制、登录态或正文。
- 不重新格式化或修改固定上游资料来绕过 hash 校验；如确需更新，同时审查来源、授权、固定 hash 和消费测试。
- 提交前检查 `git diff --check`、格式、相关测试及构建。PR 描述应说明问题、行为变化和实际验证范围。

## 许可证

提交原创贡献表示同意按项目 [MIT License](LICENSE) 提供该贡献。引入第三方代码或资料时注明来源与原许可证，并更新 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
