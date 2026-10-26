# 云效需求与缺陷进度面板

日期：2026-10-23
状态：待审阅
参考：[dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard)（只借看板交互，不移植其代码）

## 问题

云效项目里的需求和缺陷分散在网页里，看进度要反复切换筛选。需要一个本地进度面板，直接读阿里云云效，按状态看需求和缺陷。

当前仓库为空。不做 Codex 嵌入、Tauri、CLI、本地议题库。云效是数据源，面板不另存一份工作项。

面板是 Harness 插件，不是独立站点。配置写在插件 Config 里，设置页可改。令牌和组织 ID 都走这条路径；插件没填时退回环境变量。

## 连接配置

插件 Config：

| 字段 | 必填 | 空值退回 | 说明 |
| --- | --- | --- | --- |
| `token` | 否 | `YUNXIAO_API_KEY` | 个人访问令牌。schema 标 `writeOnly`，不回显到前端、不进日志 |
| `organizationId` | 否 | `YUNXIAO_ORG_ID` | 仅中心版需要。Region 版留空 |
| `baseUrl` | 否 | `YUNXIAO_API_BASE_URL`，再默认 `https://openapi-rdc.aliyuncs.com` | Region 版填组织域名，如 `https://your-org.devops.aliyuncs.com` |
| `edition` | 否 | 由 `organizationId` 是否为空推断 | `center` 或 `region`。显式值优先于推断 |

解析顺序：插件配置里的非空字符串 > 对应环境变量 > 默认值。空字符串视为未填。

两边都没有令牌：看板显示「未配置云效令牌」，不发请求。中心版两边都没有组织 ID：显示「未配置组织 ID」。Region 版不要求组织 ID。

请求头始终是 `x-yunxiao-token`。令牌只留在 Host 进程。

路径：

| 版本 | 项目列表 | 工作项搜索 | 工作项详情 |
| --- | --- | --- | --- |
| 中心版 | `POST {base}/oapi/v1/projex/organizations/{org}/projects:search` | `POST {base}/oapi/v1/projex/organizations/{org}/workitems:search` | `GET {base}/oapi/v1/projex/organizations/{org}/workitems/{id}` |
| Region 版 | `POST {base}/oapi/v1/projex/projects:search` | `POST {base}/oapi/v1/projex/workitems:search` | `GET {base}/oapi/v1/projex/workitems/{id}` |

`edition=region`，或 `edition` 未填且 `organizationId` 为空，走 Region 路径。否则走中心版路径。

## 已验证的云效接口

以下只在中心版、组织 `6195b7c32873bc436ca4df89` 上验证过。Region 版路径来自[云效文档](https://help.aliyun.com/zh/yunxiao/developer-reference/searchworkitems)，尚未用 Region 实例打过。

实测项目：

| 代号 | 名称 | spaceId |
| --- | --- | --- |
| SRTK | 纷析云进销存 | `99932653315a2af323dccee26f` |
| FWMS | PayGlee支付 | `82836f813c2139fc33037ed1b1` |
| EVXU | 纷析云财务 | `167a4a9022031fec9a3da7044f` |
| HDVL | 收银系统 | `bc429f27189a426e72e53a6b28` |

`workitems:search` 必须带 `spaceId`，不能跨项目。分页在响应头：`X-Total`、`X-Page`、`X-Per-Page`、`X-Total-Pages`。`page * perPage` 不得超过 10000。

分类用 `category`：`Req` 需求，`Bug` 缺陷。财务项目当前需求 724、缺陷 332。

列表项可用字段：`serialNumber`、`subject`、`status.name`、`statusStageId`、`assignedTo`、`workitemType`、`gmtCreate`、`gmtModified`、`id`、`categoryId`。列表不含描述。

筛选条件放在 `conditions`（JSON 字符串），形状：

```json
{"conditionGroups":[[{"fieldIdentifier":"statusStage","operator":"CONTAINS","value":["1"],"className":"statusStage","format":"list"}]]}
```

已验证：

- `statusStage` + `CONTAINS` 按阶段过滤有效。财务需求：阶段 1 待处理 184，阶段 4 已完成 460，阶段 5 已取消 80。缺陷：阶段 1 待确认 6，阶段 3 已修复 5，阶段 4 已关闭 321。
- `subject` + `CONTAINS` 按标题过滤有效。
- 顶层 `orderBy=gmtModified|gmtCreate` + `sort=desc` 有效。
- 负责人过滤的字段名尚未对上，实现时再探；v1 可以先拉当前阶段列表后在本地按负责人筛。

卡片跳转云效用工作项编号，不依赖未验证的 URL 模板。实现时用一次详情响应或组织域名拼出可打开的链接；拼不出就只展示编号。

## 方案

Harness 插件。Host 侧持有配置并请求云效，Client 侧只渲染看板。浏览器不持有令牌，也不直连云效。

```
设置页 Config                看板 Client
token / organizationId       |
baseUrl / edition            |  只拿工作项摘要
        |                    |
        v                    v
     Host 插件  -- 云效 OpenAPI
        |
        +-- config.token 或 YUNXIAO_API_KEY
        +-- config.organizationId 或 YUNXIAO_ORG_ID
        +-- config.baseUrl 或 YUNXIAO_API_BASE_URL
```

不做的事：

- 不复制 dashi-taskboard 的服务、SQLite、Skill、注入脚本。
- 不创建、不改标题、不改描述、不改负责人。v1 唯一写入是状态流转。
- 不缓存成数据库。允许内存缓存 30 秒，避免来回切栏打爆接口。
- 不拉已完成/已取消/已关闭进主看板。这些数量大，只在「含已结束」打开时按需查。

## 界面

顶栏：

- 项目下拉（当前连接下 `projects:search` 的结果，记住上次选中的）
- 类型：需求 | 缺陷 | 全部
- 搜索框：编号或标题，300ms 防抖后交给云效 `subject` 条件；纯编号（如 `EVXU-1095`）走详情接口
- 负责人：从当前结果里收集，本地筛选
- 刷新

主区域是状态栏，横向滚动。栏内卡片按 `gmtModified` 倒序。

需求栏（按 `statusStageId`，不按状态文案，避免各项目文案不同）：

| 栏 | 阶段 | 财务项目里的状态名 |
| --- | --- | --- |
| 待处理 | 1 | 待处理 |
| 进行中 | 2、3 | 当前数据为 0，栏仍保留 |
| 已结束 | 4、5 | 已完成、已取消，默认折叠 |

缺陷栏：

| 栏 | 阶段 | 财务项目里的状态名 |
| --- | --- | --- |
| 待确认 | 1 | 待确认 |
| 处理中 | 2 | 保留空栏 |
| 已修复 | 3 | 已修复、暂不修复 |
| 已结束 | 4、5 | 已关闭，默认折叠 |

「全部」时需求栏和缺陷栏上下两排，不混在同一栏。栏头显示本栏数量（用 `X-Total`，不是已加载条数）。

卡片：编号、标题、类型、负责人、更新时间。点击打开云效原页（新标签）。卡片上有「流转」：先拉该工作项工作流，只列出云效返回的状态，选中后写回。没有本地详情抽屉。

流转失败时卡片保持原状态，错误原文显示在卡片上。令牌没有写权限时同样失败，不在本地假装已流转。

空态：未配置令牌、中心版未配置组织 ID、项目无数据、筛选无结果，各一句人话，并指向插件设置。不堆说明。

视觉：浅底、细边框、等宽编号、状态用栏头色而不是满屏彩条。不仿云效皮肤，也不仿 dashi 的深色 Codex 面板。

## 状态流转

云效按工作项类型限制能去的状态。不在插件里写死「待处理 → 开发中」。

| 动作 | 方法 | 中心版路径 | Region 版路径 |
| --- | --- | --- | --- |
| 可流转状态 | GET | `{base}/oapi/v1/projex/organizations/{org}/workitems/{id}/workflow` | `{base}/oapi/v1/projex/workitems/{id}/workflow` |
| 写入状态 | PUT | `{base}/oapi/v1/projex/organizations/{org}/workitems/{id}` | `{base}/oapi/v1/projex/workitems/{id}` |

写入 body 只有 `{"status":"<statusId>"}`。`id` 是工作项唯一标识，不是 `EVXU-1095` 这种编号。编号先查详情再流转。

已验证：中心版 `GET .../workflow` 对 `EVXU-1095` 返回 6 个状态（待处理、设计中、开发中、测试中、已完成、已取消）。这是该类型的状态列表，不是「当前状态的合法下一跳」。插件只提供这份列表，非法流转交给云效拒绝。

当前个人令牌对 `PUT` 返回 403 `Current token has no permission to api`。实现按文档接写入。使用前令牌需要项目协作读写权限。测试不打真实 `PUT`。

## Host 能力

看板和 AI 工具调用同一套 Host 方法，不各写一套。

| 方法 | 行为 |
| --- | --- |
| `projects()` | 项目列表 |
| `board({ spaceId, category, q, includeClosed })` | 各栏总数 + 每栏第一页卡片 |
| `column({ spaceId, category, stage, page, q })` | 栏内翻页 |
| `transitions(id)` | 该工作项工作流状态。`id` 可以是唯一标识或编号 |
| `transition({ id, status })` | 流转。`status` 可以是状态 id 或状态名；名称在该工作项工作流里必须唯一，否则拒绝并列出候选 |

`category=All` 时 Host 分别查 Req 和 Bug。`includeClosed` 为假时不请求阶段 4 和 5。

错误：云效 4xx/5xx 转成 `{error, message}`，不带令牌。令牌未配置、中心版组织 ID 未配置，在发请求前失败。

## AI 工具

Host `apply` 里 `ctx.tools.register` 两个工具，执行函数就是上面的 Host 方法。

| 工具 | 作用 |
| --- | --- |
| `yunxiao_workitems` | 只读。`action=projects` 列项目；`action=search` 按项目、类型、关键字搜；`action=transitions` 看一个工作项能流转到哪些状态 |
| `yunxiao_transition` | 写入。参数 `id`（编号或唯一标识）和 `status`（状态名或状态 id）。成功返回流转后的编号、原状态、新状态 |

工具描述写明：先 `transitions` 再 `transition`；不要猜状态名；403 表示令牌没有写权限。工具结果不包含令牌。

## 文件

```
package.json          # dsh.bundle.patch + client 导出
cordis.patch.yml
index.js              # Host：Config、令牌回退、云效请求
client.js             # 看板
locale/zh.json
locale/en.json
icon.svg
test/yunxiao.test.js  # 配置回退、中心/Region 路径、栏映射。不打真接口
```

不另起端口，不另起静态站。

## 验证

- `node --test`：插件 token 优先于 `YUNXIAO_API_KEY`；token 为空才读环境变量；organizationId 同理。中心版路径带组织 ID，Region 版路径不带。阶段到栏的映射、默认不含已结束。流转请求体只有 `status`。状态名匹配到 0 个或多个时拒绝，不发 PUT。
- 手工：插件里填写令牌和组织 ID 后，EVXU 需求待处理数量应接近 184。清空插件令牌后，仍可用 `YUNXIAO_API_KEY` 打开。写权限令牌到位后，从看板和从 `yunxiao_transition` 各流转一次同一条测试工作项，结果一致。当前令牌无写权限，这一步做不到，不假装通过。

## 实现顺序

1. 配置解析、路径选择、流转请求体的测试
2. Host：云效客户端、栏映射、查询与流转方法、两个 AI 工具
3. Client 看板与卡片流转
4. 用真实令牌打开 EVXU 核对数量。写权限具备后再核对一次真实流转

## 未决

- 负责人过滤的云效字段名。v1 用本地筛选，数据量上来再改成服务端条件。
- 工作项网页 URL 的稳定拼法。实现时用一条真实详情确认，确认不了就不做外链。
- Region 版只按文档接路径，没有 Region 实例可验证。
- 工作流接口返回的是类型状态列表，不是当前状态的合法下一跳。若后续找到下一跳接口，再用它收窄卡片和工具的候选。
- 当前令牌不能验证真实流转。写入路径以[UpdateWorkitem](https://help.aliyun.com/zh/yunxiao/developer-reference/updateworkitem) 为准。
