# 安全策略

项目处于早期开发阶段，安全修复优先面向当前主分支。维护者尚未建立稳定版本的长期支持承诺。

## 报告漏洞

如公开仓库启用了 GitHub Private Vulnerability Reporting，请通过 Security → Advisories → Report a vulnerability 私密报告。若入口不可用，请先通过维护者的私密联系渠道协商；公共 Issue 只用于请求报告渠道，不包含漏洞细节、Token、Cookie、正文、账号身份或原始日志。

请提供经过脱敏的复现步骤、影响范围和环境版本。凭据已泄露时立即撤销或轮换，删除当前文件不能使已泄露凭据失效。

## 私有数据边界

- API Token 与备用浏览器密码保存在 `.secrets/`，初始化目录权限为 0700、文件为 0600；优先使用 `FANQIE_TOKEN_FILE`。
- `.runtime/`、Docker 数据卷、SQLite、浏览器 profile、Cookie、截图、二维码、正文、封面素材、备份和运行回执均为私有数据。
- 服务默认绑定 loopback，Compose 的 API 和备用浏览器端口也仅绑定 loopback。云端接入需要 HTTPS 和经过验证的访问控制。
- 服务客户端保护 Bearer Token，不将其写入前端资源、URL 或版本化配置。未来外部工作台由后端持有该凭据；直接传入的客户端身份 header 不是可信认证。
- 写入默认关闭；未知结果使用对账流程，禁止盲目重复保存或提交。

`.gitignore` 和 `.dockerignore` 是预防措施，不能移除已经跟踪或历史提交中的资料。不要使用 `git add -f` 将本地凭据、登录态、截图或备份加入仓库。

## 发布前检查

安装 Gitleaks 8.24.3 或兼容版本后，在仓库根目录运行：

```sh
gitleaks dir . --config .gitleaks.toml --redact --max-decode-depth 2
gitleaks git . --config .gitleaks.toml --redact --log-opts=--all
```

配置仅豁免三个测试文件中明确列出的源码 SHA-256 清单行，不整体排除测试目录。密钥扫描还需要人工检查个人地址、作品名、账号/任务标识、私有路径和压缩夹具。

历史中存在敏感资料时，优先从脱敏后的源码建立全新的公开仓库；需要保留历史时，在协调现有克隆与引用后清理全部相关历史，再重新扫描。不要直接将私有仓库改为公开并假设最新提交已经解决历史问题。
