# 工作项创建能力实施计划

> 按顺序执行。关键前置：云效接口路径及所需字段必须先核实；不得在未确认 API 的情况下实现写入或真实创建。

设计规格：`docs/superpowers/specs/2026-11-02-workitem-create-design.md`。

## 目标

在当前 Harness 云效看板支持创建 Req/Bug，UI 与 Agent 工具共用 Host 创建逻辑，可带附件；成功后 UI 留在当前看板并刷新。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `server/config.js` | 只添加已确认的创建、类型、附件 API URL 构造 |
| `server/yunxiao.js` | 创建、附件签名元数据、OSS 上传、关联附件；返回部分成功信息 |
| `index.js` | Host RPC 和 Agent 工具注册；本地路径边界校验 |
| `client.js` | 创建表单、文件选择、上传进度与成功刷新 |
| `test/yunxiao.test.js` | 纯 mock 测试 API 构造、请求形状、部分成功和异常边界 |
| `README.md` | 说明创建方式、附件限制和权限要求 |

## Task 1：核实写入 API 合约

**Files:** 无代码修改；依据：官方云效 API 文档、当前 `server/config.js` 与既有接口响应。

1. 已核实中心版和 Region 版 Projex 创建路径：`POST /oapi/v1/projex/organizations/{organizationId}/workitems` 或 `/oapi/v1/projex/workitems`。body 使用 `spaceId`、`category`、`workitemTypeId`、`subject`、`description`、`assignedTo`；返回 `id`。官方文档称创建权限需项目协作工作项读写权限。
2. 官方创建文档确认 `assignedTo` 必填；通过项目成员 API 提供可选列表，工具侧提供成员查询能力，禁止自动推断负责人。成员路径中心版 `/organizations/{organizationId}/projects/{id}/members`、Region `/projects/{id}/members`，返回 `userId`、`userName`。
3. 类型查询：中心版 `GET /oapi/v1/projex/organizations/{organizationId}/workitemTypes?categories={Req|Bug}`，Region `GET /oapi/v1/projex/workitemTypes?categories={Req|Bug}`；根据 `categoryId` 筛选启用类型；默认类型优先，但类型须由 UI/工具选择并校验。
4. 附件暂不进入首版：目前仅证实 DevOps API 家族的三步附件接口，Projex 创建的互操作及传输约束未核实。首版只做创建与成员选择，附件能力另行确认后实现。
5. 不得在未授权测试环境真实创建工作项；仅使用 mock 测试。

**Run/check:** `node --test`（基线应通过；本任务不改代码）。

## Task 2：先写云效创建/附件失败测试

**Files:** `test/yunxiao.test.js`。

在现有 `fakeFetch` 上扩展按 method/URL 匹配的 mock，测试调用顺序和 payload；先运行观察失败，再实现。

测试最少覆盖：

```js
test('create sends project, category, type, subject and description', async () => {
  // mock the confirmed type lookup and create endpoints
  // assert POST request body contains only the verified API fields
  // assert returned workitem id/serial is normalized
})

test('attachments upload and link after create', async () => {
  // assert: create -> attachment metadata -> OSS form POST -> attachment link
})

test('attachment failure reports created work item without inviting duplicate creation', async () => {
  // create succeeds; one attachment link fails
  // assert result explicitly says item created and identifies failed filename
})

test('reject unsupported category, blank title and excessive attachment list', async () => {
  // assert validation happens before any network request
})
```

1. `node --test test/yunxiao.test.js`，确认新增测试因能力缺失失败，而非测试语法错误。
2. 将 mock 字段与 Task 1 已核实的真实接口契约逐项比对。

## Task 3：Host API 实现

**Files:** `server/config.js`, `server/yunxiao.js`, `test/yunxiao.test.js`。

1. 在 `server/config.js` 只添加 Task 1 核实过的 URL 构造；不得把 DevOps v2021 路径直接拼进 `/oapi/v1/projex` 根路径。
2. 在 `server/yunxiao.js` 添加 `createWorkitem`，执行顺序：校验输入 → 读取默认类型 → 创建 → 附件元数据 → OSS 表单上传 → 关联。
3. 创建的类别限定 `Req` / `Bug`；标题 trim 后不得为空；描述可选；不要将未确认的负责人、自定义字段、状态写入 payload。
4. 文件读取与上传限制由 Host 执行，配置硬上限为每次最多 5 个文件、单文件不超过 10 MiB（若 Task 1 确认的服务限制更小，则采用更小值）。使用 `node:fs/promises`、`node:path` 等内置模块；拒绝目录、不可读文件和超限文件。
5. OSS 上传使用签名元数据给出的 host/表单字段；此上传请求不携带云效令牌。令牌和签名信息不进入返回值、错误和日志。
6. 若创建成功而附件任一步失败，返回清晰的“工作项已创建”结果与逐附件错误，不重新发送创建请求。
7. `node --test test/yunxiao.test.js` 与 `node --test` 必须通过。

## Task 4：Host RPC 和 Agent 工具

**Files:** `index.js`, `test/yunxiao.test.js`。

1. 按现有 `/api/yunxiao-taskboard` 路由/RPC 约定增加 `createWorkitem` dispatch；禁止暴露连接 token。
2. 注册 `yunxiao_create_workitem`，参数：`spaceId`、`category`、`subject`、可选 `description`、可选 `attachments` 本地路径数组。工具说明明确这是云效真实写操作，附件参数是本机路径，限制和部分成功行为可见。
3. 工具 handler 调用与 UI 共用的 Host 方法，不复制云效流程。
4. 对路径数组检查类型/数量/字符串空值，在调用工作项创建之前完成；Host 内部仍做文件存在、普通文件和大小校验，不把安全约束只放在工具 schema。
5. 测试：合法参数 dispatch 到共用方法；非法类别/空标题/过多路径零网络调用；返回不含 token 与签名字段。
6. Run: `node --check index.js && node --test`，预期语法与测试全部通过。

## Task 5：看板创建界面

**Files:** `client.js`。

1. 顶栏新增“创建”按钮，表单字段为当前项目（默认当前选中项目）、Req/Bug、标题、描述、文件选择器。
2. UI 文件用现有 Host RPC 送达 Host；实现前用 Harness 已有请求体能力确认上传格式及大小限制。不要让 Client 使用云效 token，也不要让浏览器把签名或文件发往非签发的 OSS host。
3. 提交期间禁用提交按钮，防止重复创建；展示创建/上传进度。失败保留表单和选中文件并显示错误。
4. 创建成功后关闭表单，保持项目和类别选择不变，触发现有看板加载函数刷新，不自动跳详情。
5. 手工核对交互：成功关闭并刷新；创建失败保留输入；多次点击不会并发重复创建；附件局部失败明确提示已创建及失败文件。
6. Run: `node --check client.js`。

## Task 6：文档与全量验证

**Files:** `README.md`, 可能更新设计文档。

1. README 增加界面/AI 创建说明、支持类别、附件路径语义、附件数量/大小上限、云效写权限前提、部分成功的含义。
2. Run: `node --test`，预期所有测试通过。
3. Run: `node --check index.js && node --check client.js && node --check server/yunxiao.js`。
4. 可用授权测试环境时验证 Req/Bug 与附件成功路径；未获授权或无写权限时只报告 mock 测试，绝不宣称真实创建已验证。
5. 最后检查 `git diff --check`、`git status --short`，确认没有 token、签名、测试上传文件或不相关改动。

## 明确不做

- 不猜测创建/附件接口路径或签名表单结构。
- 不把会话附件自动注入 Agent 工具参数。
- 不允许任意路径绕过普通文件、数量、大小校验。
- 不新增 npm 依赖。
- 不在附件失败后自动重试创建工作项。
