# 从启动到第一次本人查询

这是一份可以按顺序照做的演示。先按[快速开始](QUICKSTART.md)启动源码 Compose；公开镜像发行后，也可按[镜像教程](IMAGE.md)启动。下列账号和结果均为**合成示意**，不代表真实平台回执。完整工具字段见[工具参考](TOOLS.md)。

## 第一步：确认连接成功

在终端检查：

```sh
curl --fail http://127.0.0.1:18062/health
```

返回 JSON 中 `status` 应为 `ok`。按[Host 接入](CLIENTS.md)配置 MCP 后，在 **Agent 对话框**粘贴：

```text
使用 fanqie MCP 查看服务状态和能力，不执行写操作。
报告服务是否 ready、writesEnabled 是否为 false，以及番茄登录的 status 和 checkedAt。
```

合成状态示意：

```json
{
  "service": "fanqie-mcp",
  "status": "ready",
  "writesEnabled": false,
  "platform": { "status": "unknown", "checkedAt": null }
}
```

这是尚未检查番茄登录，可以进入第二步。401 表示服务 Token 不对；服务健康不等于 Host 已成功调用工具。

## 第二步：公开课堂目录 → 一篇文章

```text
查询番茄作家课堂的新手专区（category="1"），列出前5篇课程标题。
确认本次任务是否 succeeded、sourceMode 是否为 live，以及分页和完整性。
从本次结果选择一篇，用返回的 articleId 原样读取文章。
概括三个要点，保留来源链接、发布日期和采集时间；不要转写视频或图片。
```

工具顺序是 `fanqie_get_writer_class_catalog` → `fanqie_get_writer_article`。以下只是目录中的字段片段，实际数量和 ID 由平台返回：

```json
{
  "job": { "status": "succeeded" },
  "sourceMode": "live",
  "data": [
    {
      "dataset": "writer_classes",
      "coverage": { "complete": true, "paginationComplete": true },
      "records": [{ "articleId": "7000000000000001", "title": "合成示例：开始写第一篇故事" }]
    }
  ]
}
```

两个完整性字段都为 `true` 才能称目录完整；无登录也可查询。文章只返回文字和图片链接，不能把图片/视频里的内容写成已经读到。

## 第三步：本人扫码 → 核对当前账号

```text
获取 fanqie 登录二维码并显示给我。本步骤只获取二维码，等待我扫码后再检查登录；不执行写操作。
```

本人按官方提示扫码后，发送：

```text
我已扫码。调用 fanqie_check_login_status，告诉我当前账号昵称、稳定账号标识和 checkedAt。
如果无法确认，明确说 unknown；不要根据浏览器profile存在猜测已登录。
```

合成成功片段：

```json
{
  "status": "authenticated",
  "identity": { "displayName": "示例作者", "accountId": "synthetic-account" },
  "checkedAt": "2026-10-09T02:00:00.000Z"
}
```

昵称应与本人扫码账号相符。二维码过期就重新请求；遇到挑战按[排障](TROUBLESHOOTING.md)在官方页面人工处理。示意时间是 UTC；客户端展示本地时间时应标明时区。

## 第四步：本人作品 → 指标

```text
先核对当前番茄登录身份，确认是我的账号，再列出我的短故事作品（kind="short"）。
保留作品稳定ID、sourceMode和完整性；如果 partial 或 unavailable，说明缺口，不当作全量作品。
```

从本轮作品列表选择 ID 后，发送：

```text
读取刚才选定短故事的经营数据，kind="short"，workId 使用本轮返回的稳定ID。
保留平台原始统计窗口、截止时间、时区与 limitations。没有证明的字段保持 unknown，不推算昨天。
```

成功不要求账号有作品；完整空列表也可以是合法结果。本人作品、指标和正文会进入所用 Host 的对话，不要公开复制真实结果作为演示。

## 第五步：看历史，不重新访问平台

第二步查询完成后，可以直接验证公开课堂历史：

```text
只调用 fanqie_get_saved_snapshot，scope="writer_classes.tab1"。
显示上次保存的课堂目录，明确 sourceMode="saved"，保留原采集时间，不重新查询平台。
```

若需要完整账号历史，先明确让 Agent 调用 `fanqie_refresh_account` 读取短/长作品及指标四项；四项完整后再调用 `fanqie_get_saved_snapshot`，`scope="account"`。仅列过短故事作品时，完整账号历史可以为空。

合成历史片段：

```json
{ "sourceMode": "saved", "manifest": { "scope": "writer_classes.tab1" } }
```

历史时间应仍是上次采集时间，不能把当前查看时间改成“最新”。重启后再看 saved 应保持历史；登录摘要可能回到 `unknown`，用登录检查重新核验。

课堂分类分别保存：第二步查新手专区，历史 scope 就是 `writer_classes.tab1`；技巧分类为 `writer_classes.tab3`。只有目录查询省略 `category`、读取所有分类时才用 `writer_classes`，否则可能查到空快照。

## 完成判据

- Host 实际调用状态、能力和公开课堂目录/文章，而非仅显示已连接。
- 扫码后确认为本人账号，再读取本人作品；失败和空列表如实区分。
- 实时目录有来源与完整性，历史明确标为 saved 并保留采集时间。

其他日常场景可直接使用[五份提示词](PROMPTS.md)。
