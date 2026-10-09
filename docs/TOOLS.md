# 工具参考

当前版本注册 40 个 `fanqie_` 工具。参数以 Host 实际发现的 schema 为准；下面按使用场景组织，所有 ID 均保留为字符串，不能转成可能失真的数字。

## 先看这些常用调用

| 想做什么         | 工具                              | 最小参数                           |
| ---------------- | --------------------------------- | ---------------------------------- |
| 查看服务         | `fanqie_get_service_status`       | `{}`                               |
| 查询现在能做什么 | `fanqie_get_capabilities`         | `{}`                               |
| 核验当前登录人   | `fanqie_check_login_status`       | `{}`                               |
| 获取扫码图片     | `fanqie_get_login_qrcode`         | `{}`                               |
| 查新手课程       | `fanqie_get_writer_class_catalog` | `{"category":"1"}`                 |
| 查课程文章       | `fanqie_get_writer_article`       | `{"articleId":"目录返回的文章ID"}` |
| 查短故事         | `fanqie_list_works`               | `{"kind":"short"}`                 |
| 查长篇指标       | `fanqie_get_metrics`              | `{"kind":"long"}`                  |
| 查账号历史快照   | `fanqie_get_saved_snapshot`       | `{"scope":"account"}`              |
| 查任务           | `fanqie_get_job`                  | `{"jobId":"任务返回的UUID"}`       |

课堂分类字符串：`1` 新手专区、`2` 大神专访、`3` 写作技巧、`4` 品类指南、`5` 平台宝典。不传 category 时查询全部分类。articleId 为 15–30 位数字字符串，必须来自实际目录。

账号刷新使用 `{"datasets":["short_works","short_metrics","long_works","long_metrics"]}`。四项同任务全部完整才推进 account 快照；单独查询数据不会自动形成完整账号快照。

章节和正文：先从作品清单取得 workId，再从目录取得 chapterId。长篇正文调用 `fanqie_get_chapter`，例如 `{"workId":"7000000001","chapterId":"7000000002"}`；短故事正文调用 `fanqie_get_short_body_snapshot`，例如 `{"workId":"7000000001"}`。这些示例 ID 是合成值，请替换为自己的实际读取结果。

`get_metrics` 的 workId 用于筛选指标记录，实际按 statisticsBookId 匹配；不要假定所有作品/指标 ID 都能互换。短故事草稿目录主要返回 ID，标题和投稿/签约状态可能未知。`get_work_detail` 基于该种类作品清单筛选，不是任意作品后台查询。

## 怎么判断结果

MCP 在文本和 `structuredContent.result` 中提供结果；登录二维码还可以包含原生 PNG。REST 返回同一业务结果，无 MCP 内容外壳。

下面是合成的字段片段，不是完整响应，也不是当前真实账号：

```json
{
  "job": { "status": "succeeded" },
  "sourceMode": "live",
  "data": [
    {
      "dataset": "writer_classes",
      "status": "success",
      "coverage": { "complete": true, "paginationComplete": true },
      "records": [{ "articleId": "7000000000000001", "title": "合成示例课程" }]
    }
  ]
}
```

- `job.status`：本次任务结果；HTTP 200 不代表任务成功。
- `sourceMode=live`：本次访问平台；`saved`：本地历史；`incomplete`：本次未完成完整采集。
- `coverage.complete` / `paginationComplete`：完整性和分页覆盖；有记录不等于全量。
- `checkedAt` / 采集时间：核验或读取的时间；不等于文章发布日期或指标截止日期。
- `evidence` / manifest / hash：版本和来源引用，用于回读与核验。查询用户无需自己生成它们。
- `limitations`：这份数据的解释边界；窗口、时区或字段含义无法证明时保持 unknown。

登录检查返回 `data[0].status`、`identity.displayName`、`identity.accountId` / `authorId`、`checkedAt`，无法确认时还可包含 `reason`。服务状态摘要只看已知记录，重启后可能是 unknown；它不主动核验登录，也不返回昵称。

## 完整工具清单

参数列的 `?` 表示可选或有默认值；复杂维护工具的跨字段条件仍须读取实际 schema 与当前快照。平台写默认关闭，以下清单不承诺每种写能力已完成真实平台验收。

### 状态与登录

| 工具                        | 参数 | 用途与边界                                                                                                                                          |
| --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fanqie_get_service_status` | 无   | 读取服务状态与已知登录检查记录；不把profile存在当登录有效。                                                                                         |
| `fanqie_get_capabilities`   | 无   | 区分已实现、已真实验证与当前可用的平台能力。                                                                                                        |
| `fanqie_check_login_status` | 无   | 实际访问番茄检查服务持有的账号登录状态并保存本次证据。                                                                                              |
| `fanqie_get_login_qrcode`   | 无   | 读取番茄当前扫码登录二维码，返回原生图片供本人使用平台提示的App扫码；检查状态不会刷新扫码页面。二维码仅本次响应，不保存或历史回放；过期后重新请求。 |
| `fanqie_start_login`        | 无   | 打开服务持有的番茄登录浏览器；人工完成扫码或验证后再次检查登录。                                                                                    |

### 公开资料

| 工具                              | 参数        | 用途与边界                                                                        |
| --------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `fanqie_get_writer_class_catalog` | `category?` | 实时读取番茄作家课堂目录并持久化本次证据；分类1新手、2专访、3技巧、4品类、5宝典。 |
| `fanqie_get_writer_article`       | `articleId` | 实时读取官方课堂文章，返回原文与发布日期；不会修改创作护栏。                      |
| `fanqie_list_activities`          | 无          | 实时读取番茄官方活动，保留原始起止时间和原文URL；详情可用get_writer_article读取。 |

### 本人作品、指标与正文

| 工具                                 | 参数                       | 用途与边界                                                                                                                                        |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fanqie_list_works`                  | `kind?`                    | 本次真实读取短故事或长篇全分页作品清单并保存；不重读旧文件冒充最新。                                                                              |
| `fanqie_get_work_detail`             | `kind?`, `workId`          | 从本次真实作品清单查询稳定ID；不按同名作品合并。                                                                                                  |
| `fanqie_get_metrics`                 | `kind?`, `workId?`         | 本次真实读取经营数据；保留页面截止日期、窗口与未知字段，不推算昨天。                                                                              |
| `fanqie_refresh_account`             | `datasets?`                | 请求后真实读取所选全部数据集，默认短/长作品及指标；子集使用独立scope，部分失败不推进完整账号current。                                             |
| `fanqie_list_short_drafts`           | 无                         | 本次只读本人短故事私人草稿目录，最多100个ID；title不可用、发布和签约状态unknown，不读取正文。                                                     |
| `fanqie_get_short_metadata_snapshot` | `workId`, `snapshotScope?` | API-only读取本人短故事草稿的原生标题、分类与版本；可选short-native-trial/v1返回无正文试读边界摘要；不导航、不写入，完整私有原件仅供后续维护校验。 |
| `fanqie_get_short_body_snapshot`     | `workId`                   | 显式只读本次本人短故事草稿当前作者编辑正文；只返回段落原文与版本，已发布版本未验证。通用任务和历史出口不返回正文。                                |
| `fanqie_list_chapters`               | `workId`                   | 本次按固定顺序读取全部管理卷页与草稿箱页，两个命名空间完整才推进目录快照；分别保留采集截止，不声称平台原子版本。                                  |
| `fanqie_list_chapter_drafts`         | `workId`                   | 本次只读既有长篇草稿箱目录，完整分页仅推进该作品草稿目录范围；不读取正文或编辑控件。                                                              |
| `fanqie_get_chapter`                 | `workId`, `chapterId`      | 只读本轮管理目录中唯一既有章节的当前作者编辑版本原文；不打开编辑页、不保存，不声称已发布版本正文。                                                |
| `fanqie_get_editable_snapshot`       | `target`                   | 回读既有短篇/章节编辑器，或已核验长篇作品信息页的独立metadataHash；页面可能自动保存，仅启用写开关时可用，长篇快照不含正文。                       |

### 历史、任务与只读对账

| 工具                        | 参数                              | 用途与边界                                                                                                                                                  |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fanqie_get_saved_snapshot` | `scope?`                          | 只读取历史保存的数据，明确sourceMode=saved，不联网也不刷新采集时间。                                                                                        |
| `fanqie_list_saved_history` | `scope?`, `manifestId?`, `limit?` | 只读完整历史manifest，不访问平台；可按scope及manifestId检索不可变证据。                                                                                     |
| `fanqie_get_job`            | `jobId`                           | 读取本服务账号的持久任务与本轮证据。                                                                                                                        |
| `fanqie_cancel_job`         | `jobId`                           | 请求持久取消任务；底层清理完成前保持账号锁，已开始写入的任务保留结果不确定。                                                                                |
| `fanqie_reconcile_write`    | `jobId`                           | 按原目标与持久版本回查未知写结果；原生短故事仅独立API读取、0 POST且默认关闭写开关时仍可对账，legacy编辑器可能自动保存并仍需写开关。不重放新建、保存或提交。 |

### 诊断

| 工具                                        | 参数                                                                                                   | 用途与边界                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fanqie_diagnose_current_login`             | 无                                                                                                     | 只读检查服务当前登录页/扫码后的首页结构，不导航、不返回账号值、正文、二维码或凭据；供排查登录身份识别。                                                                                                                                                                       |
| `fanqie_diagnose_short_metadata_schema`     | `target`                                                                                               | 在同一服务浏览器的cookie-only隔离上下文中，只读观察既有短故事的固定元数据字段类型；阻止非GET、未知资源与重定向，输出不含账号、目标ID或字段值，不证明元数据写能力。                                                                                                            |
| `fanqie_diagnose_short_metadata_api_schema` | `target`                                                                                               | 用cookie-only独立API会话和固定GET，完整校验最多100条本人草稿的唯一既有短故事目标，观察5项元数据字段类型；不导航、不跟随重定向、不输出账号、目标ID或字段值，不证明元数据写能力。                                                                                               |
| `fanqie_diagnose_read_page`                 | `sourceUrl`, `openChaptersForWorkId?`, `chapterTab?`, `chapterVolumeContext?`, `chapterVolumeOptions?` | 只读检查实际管理/数据页结构与已加载GET路径；可从已核验可见作品的章节管理按钮进入目录，不访问新建/编辑/提交路由；chapterVolumeOptions仅展开已核验管理页的唯一既有卷选择控件，不选择卷或翻页；chapterVolumeContext是已登记目录上的独立context GET字段类型实验，不证明目录覆盖。 |
| `fanqie_diagnose_editor`                    | `target`, `editorUrl?`, `routeEvidenceRef?`                                                            | 检查既有草稿/章节编辑器的字段结构、正文长度与hash；加载编辑器可能通过HTTP/WebSocket自动保存，仅启用写开关时可用。                                                                                                                                                             |

### 维护与投稿：默认关闭

| 工具                          | 参数                                                                                                                                                                                        | 用途与边界                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fanqie_upload_cover`         | `mimeType`, `data`                                                                                                                                                                          | 接收PNG/JPEG/WebP封面文件到本机受控目录，返回uploadPath、sha256和size；不访问平台、不创建任务，图片签名不代表平台封面有效性。                                                                            |
| `fanqie_create_draft`         | `idempotencyKey`, `clientReference`, `content`                                                                                                                                              | 创建短故事草稿并回读核对；同幂等键不重复新建，0字自动草稿也记账。                                                                                                                                        |
| `fanqie_resume_create_draft`  | `idempotencyKey`, `originalJobId`, `clientReference`, `content`                                                                                                                             | 恢复已分配稳定ID但尚未填入内容的短故事创建；只继续同一空白原生草稿，原请求/恢复幂等键严格绑定，不再次新建，未知保存先对账。                                                                              |
| `fanqie_repair_created_draft` | `idempotencyKey`, `originalJobId`, `recoveryJobId`, `clientReference`, `content`, `expectedContentHash`, `expectedState`, `previousRepairJobId?`                                            | 按实时完整版本修复已分配草稿的未知保存；只更新同一目标，旧键不回放，成功证据保留早期失败。                                                                                                               |
| `fanqie_update_draft`         | `idempotencyKey`, `target`, `expectedContentHash`, `expectedState`, `content`                                                                                                               | 按稳定草稿ID和前置内容hash保存并回读，冲突拒绝覆盖。                                                                                                                                                     |
| `fanqie_update_work_metadata` | `idempotencyKey`, `expectedState`, `expectedContentHash?`, `target`, `metadata?`, `title?`, `snapshotScope?`, `hashBasis?`, `expectedSnapshotVersionHash?`                                  | 维护平台可编辑字段并回读；原生试读只允许独立set/clear段落边界补丁，封面须受控上传；long-book仅作品信息，expectedContentHash对应独立metadataHash，不创建长篇、读写正文或提交。                            |
| `fanqie_update_short_body`    | `idempotencyKey`, `target`, `snapshotScope`, `comparisonPolicy?`, `expectedSnapshotVersionHash`, `hashBasis`, `expectedState`, `representation`, `paragraphs`, `trial`                      | 按本次完整草稿版本保存原生纯文本段落向量及试读策略；保存时显式传 comparisonPolicy=native-short-body-derived-word-number/v2，核验平台派生字数。持久去重、一次POST并回读。未知结果只读对账，不能重发保存。 |
| `fanqie_save_chapter_draft`   | `idempotencyKey`, `workId`, `chapterId?`, `clientReference?`, `expectedContentHash?`, `expectedState?`, `content`                                                                           | 新建或保存长篇章节草稿，持久去重并重新打开核对正文。                                                                                                                                                     |
| `fanqie_prepare_submission`   | `target`, `expectedContentHash?`, `expectedState`, `snapshotScope?`, `hashBasis?`, `expectedSnapshotVersionHash?`, `useAi?`                                                                 | 原生短故事只读重读当前版本、固定入口源码与发布条款并保存准备记录，写开关关闭仍可用；legacy编辑器准备可能触发自动保存，仍需写开关。                                                                       |
| `fanqie_submit_short_story`   | `idempotencyKey`, `target`, `expectedContentHash?`, `expectedState`, `snapshotScope?`, `hashBasis?`, `expectedSnapshotVersionHash?`, `useAi?`, `preparationJobId`, `acceptPublicationTerms` | 执行指定已准备版本的提交并回读；审核中不称发布成功，响应丢失先对账。                                                                                                                                     |
| `fanqie_publish_chapter`      | `idempotencyKey`, `target`, `expectedContentHash?`, `expectedState`, `snapshotScope?`, `hashBasis?`, `expectedSnapshotVersionHash?`, `useAi?`, `preparationJobId`, `acceptPublicationTerms` | 执行指定已准备版本的提交并回读；审核中不称发布成功，响应丢失先对账。                                                                                                                                     |

## 历史 scope 示例

课堂目录带 `category` 时按分类保存：`category="1"` 对应 `writer_classes.tab1`，`category="3"` 对应 `writer_classes.tab3`；省略分类读取全部目录时对应 `writer_classes`。单独读取短故事作品对应 `short_works`；完整四数据集账号刷新才对应 `account`。使用错误 scope 可以返回 `sourceMode="saved"` 且 `manifest=null`，这表示没有该范围的完整快照，不能称为历史读取成功。

## REST 最小调用

程序可使用 `POST /api/v1/tools/<完整工具名>`，请求体就是工具参数。例如：

```sh
curl --fail --config - \
  http://127.0.0.1:18062/api/v1/tools/fanqie_get_writer_class_catalog <<EOF
header = "Authorization: Bearer $(cat .secrets/api-token)"
header = "Content-Type: application/json"
data = "{\"category\":\"1\"}"
EOF
```

此命令在项目根目录执行，通过标准输入传凭据，不把 Token 写到 URL 或命令参数。不要启用 shell trace 或粘贴未脱敏输出。

`POST /api/v1/refresh` 只派发任务，返回任务 ID；使用 `GET /api/v1/jobs/<id>` 查看。直接工具调用可能等待本次读取完成，Host 超时后优先查任务，不连续重发刷新。

## 维护工具的共同要求

查询版保持默认写关闭。写入另需实际能力、稳定目标、前置快照/hash、expectedState 和幂等键；传参合格不等于有写权限。保存后还需独立回读；uncertain 时先对账，不能重发。原生短故事投稿准备只读，legacy 编辑器准备可能自动保存、仍需写开关；准备成功不能视为已经提交或已发布。

`fanqie_cancel_job` 改变本地任务状态；取消已跨平台副作用边界的写任务，结果仍可能未知。`fanqie_upload_cover` 保存受控本地素材，不能视为平台封面已经更新。签约和财务操作不由本服务执行。
