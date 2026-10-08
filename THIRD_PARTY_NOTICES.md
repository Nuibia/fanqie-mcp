# 第三方资料与许可证

根目录 [LICENSE](LICENSE) 适用于本项目原创代码与文档，不授予第三方平台资料、品牌、用户内容或依赖的额外权利。

## npm 依赖与容器

依赖版本固定在 `package-lock.json`，来源与许可证由各依赖包维护。MCP SDK、Playwright、Zod、jsQR、pngjs、TypeScript、ESLint、Prettier 等保留各自许可证和通知；分发包含依赖的镜像时保留其要求的文件。

基础镜像来自 Microsoft Playwright，系统包和浏览器保留各自许可。项目 MIT 声明不替代这些许可证。

## 本地开发测试缓存

贡献者运行 `npm run test:prepare`，从生产合同指定的三个官方 CDN URL 下载 JavaScript，校验固定 SHA-256，再生成测试缓存。writer HTML 为本项目原创的最小合成页面，引用固定 main 资源；其余 JS 与提取的发布条款属于上游资料，不是本项目原创。

生成文件为 `test/fixtures/short-native-submission-public-sources-20261007.json.gz`、同名 manifest 和 `short-native-submission-terms-4c89ddd6.txt`。它们不进入公开 Git、Docker 构建上下文或最终发行镜像。生成 manifest 区分合成页面和上游资料；测试拦截传输不意味着资料正文属于原创。

本项目未记录这些上游正文的再分发授权，不将它们重新许可为 MIT。开发者自行获取的缓存只供本地验证，不上传或打包分享。固定 URL、hash、提取逻辑和测试消费者为原创适配代码，不包含上述完整资源正文。

如果官方资源失效或内容变化，准备失败，需独立复核合同；不随意更换 hash 或跳过测试。资源公开可下载不等于项目已经取得再分发许可。

## 历史与发行边界

旧私有 Git 历史曾包含上游缓存正文；移出当前源码不清除旧提交。公开候选须使用经过检查的独立历史，或完成明确范围的历史清理。镜像构建也须排除所有层中的缓存，不能只在后续层删除文件。
