# dsh-yunxiao-taskboard

DeepSeek Harness（DSH）插件：把阿里云云效的**需求和缺陷**按状态看板展示，点开即看详情，可一键派到工作区处理。

数据实时读云效 OpenAPI，本地不另存工作项。

## ✨ 功能

- 📋 **按状态看板** - 需求 / 缺陷分栏，按状态列展示，支持关键词与编号检索
- 🔍 **详情抽屉** - 状态、负责人、创建人、类型、项目、时间、描述（富文本排版保留）、附件
- 🖼️ **图片预览** - 描述内图片经 Host 换取 OSS 直链，点开弹层等比预览，不跳转不下载
- 🚀 **一键派发** - 「处理」按钮选择工作区，直接起会话并预填 prompt
- 📝 **改动留档** - `yunxiao_comment` 把每次改动写成需求评论，推送后把 Codeup 提交关联到需求
- 🛠️ **原生工具** - `yunxiao_workitems`（查项目 / 工作项 / 状态）、`yunxiao_transition`（流转状态）、`yunxiao_comment`（评论留档 / 关联提交）
- 🔐 **令牌只在 Host** - 令牌不出 Host 进程，前端不回显、不进日志
- 🔄 **版本更新提醒** - 右上角显示当前版本；npm 有新版本时显示最新版号并可一键升级（重启 DSH 生效）

## 📸 截图

**看板**：需求 / 缺陷分栏按状态展示，卡片可拖拽流转，支持编号检索与优先级、负责人筛选。

![云效进度看板](docs/images/board.png)

**详情**：状态、负责人、类型、时间等字段，描述按原富文本排版展示（图片、附件同源）。

![工作项详情](docs/images/detail.png)

## 📦 安装

以 npm 组合包分发：[`dsh-yunxiao-taskboard`](https://www.npmjs.com/package/dsh-yunxiao-taskboard)，按组合包安装，无需本地目录。要求 DSH `>= 0.2.1-rc.3`（声明在 `engines.dsh`）。

**Web**：侧边栏「插件」→「添加插件」→ 搜索框填 `dsh-yunxiao-taskboard` → 安装。

**交给 Agent**：`plugin_manager` → `install_bundle`，`target` 填 `dsh-yunxiao-taskboard`。

**CLI**：

```bash
dsh plugin --profile <profile> add dsh-yunxiao-taskboard
```

CLI 只装依赖，还要在「插件」页启用 `dsh-yunxiao-taskboard` 组合包（等价于在 profile 的 `dsh.profile.bundles` 里追加）。

安装后刷新 DSH Web，在插件设置里填令牌（配置见下）。

## ⚙️ 配置

插件 Config（设置页可改），非空值优先，空值退回环境变量：

| 字段 | 必填 | 空值退回 | 说明 |
| --- | --- | --- | --- |
| `token` | 是 | `YUNXIAO_API_KEY` | 云效个人访问令牌，`writeOnly` |
| `organizationId` | 中心版必填 | `YUNXIAO_ORG_ID` | Region 版留空 |
| `baseUrl` | 否 | `YUNXIAO_API_BASE_URL` → `https://openapi-rdc.aliyuncs.com` | Region 版填组织域名 |
| `edition` | 否 | 由 `organizationId` 是否为空推断 | `center` / `region` |

请求头固定 `x-yunxiao-token`。

## 📝 需求改动留档

开发需求/缺陷时用 `yunxiao_comment` 把改动写进工作项评论列表，推送后把 Codeup 提交关联到工作项：

```js
yunxiao_comment({
  id: 'EVXU-1095',
  content: '## 改动\n- 科目余额表打印支持边距调整\n- 已验证 A4/A5 打印',
  commits: [{ sha: 'abc1234', title: 'feat(print): 打印边距可调', url: 'https://codeup.aliyun.com/<组>/<库>/commit/abc1234' }],
})
```

- `content` 以 Markdown 写到评论列表；提交列表会自动补在正文末尾（正文已提到的提交不重复）。
- `commits[].url` 是 Codeup 提交页地址，插件用代码库列表反查关联接口要的代码库 id；反查不到时改传 `projectId`。
- 提交关联失败不回滚评论：返回值里 `commits` 逐个给出 `linked` 和失败原因。
- 提交信息里带 `#EVXU-1095` 时云效本身也会自动关联，双保险。

## 🧪 开发

```bash
node --test        # 37 个用例，覆盖连接解析、检索条件、组织列表、流转校验、评论留档、提交关联与版本比较
```

发布（`files` 白名单已限定包内容，`prepublishOnly` 先跑测试）：

```bash
npm pack --dry-run   # 核对 tarball 内容
npm publish          # publishConfig.access = public
```

代码结构：

```
index.js          Host 侧插件入口（工具注册、/yunxiao 路由）
client.js         Client 侧看板与详情 UI
server/           云效 API 封装、连接配置、看板逻辑
test/             node:test 单测
docs/superpowers/ 设计规格与实施计划
```

## 📄 License

MIT
