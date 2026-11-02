# 云效工作项创建工具与界面

日期：2026-11-02  
状态：待用户审阅

## 目标

在现有云效看板增加创建入口，并注册可供 Agent 调用的创建工具。两种入口共用 Host 侧应用方法和云效 API，实现行为一致。创建支持需求（`Req`）和缺陷（`Bug`）、附件；成功后界面留在当前看板并刷新。

## 已确认范围

- 创建入口：看板界面 + Agent 工具。
- 类别：需求或缺陷。
- 基础内容：项目、标题、描述。
- 工作项类型：从该项目/类别可用类型中自动选择默认类型；如 API 有多个类型，首版使用接口返回的第一个，不增加额外选择字段。
- 负责人列表：通过官方项目成员只读接口获取，显示 `userName`，提交 `userId`；中心版与 Region 版路径不同但接口一致。
- 负责人：必须从当前项目成员中选择；UI 提供成员选择控件，Agent 工具可使用成员查询工具获取 ID 后传入。云效 CreateWorkitemV2 的 `assignedTo` 必填。
- 附件：界面文件选择上传；Agent 工具使用调用方明确提供的本地文件路径，不假定可读取会话附件。
- 成功后：关闭创建界面、留在当前看板、刷新数据。
- 不扩展优先级、状态、自定义字段编辑，不做模板字段动态表单。

## 接口依据与约束

官方 [CreateWorkitemV2 文档](https://help.aliyun.com/zh/yunxiao/developer-reference/api-devops-2021-06-25-createworkitemv2.md)说明，创建需要 `subject`、`assignedTo`、`spaceIdentifier`、`category`、`workitemTypeIdentifier`；`description` 可选，字段值走 `fieldValueList`。因此 UI 必须提供成员选择器；Agent 需要一个按项目列成员的只读能力，避免调用方猜测或手工查找 ID。

当前采用中心版/Region 版均适用的 Projex 创建接口：中心版 `POST /oapi/v1/projex/organizations/{organizationId}/workitems`，Region 版 `POST /oapi/v1/projex/workitems`。DevOps 2021-06-25 的 `CreateWorkitemV2` 文档虽提供必填字段依据，但其 `/organization/{organizationId}/workitem` 路径不拼入当前 Projex 根路径。负责人列表来自 [ListProjectMembers](https://help.aliyun.com/zh/yunxiao/developer-reference/listprojectmembers.md)，路径中心版 `/oapi/v1/projex/organizations/{organizationId}/projects/{id}/members`，Region 版 `/oapi/v1/projex/projects/{id}/members`，返回 `userId`、`userName`。

附件 API 官方流程为：获取附件上传元数据 → 按 OSS 表单策略上传 → 关联工作项附件。文档：[GetWorkitemAttachmentCreatemeta](https://help.aliyun.com/zh/yunxiao/developer-reference/api-devops-2021-06-25-getworkitemattachmentcreatemeta.md)、[WorkitemAttachmentCreate](https://error-center.alibabacloud.com/document/devops/2021-06-25/WorkitemAttachmentCreate)。是否可用于 Region 版及当前 `/oapi/v1/projex` 连接仍需核对。OSS 上传所需 host、policy、signature 仅 Host 使用；不返回工具结果、不写日志。

## 设计

### 共用 Host 应用能力

新增 `createWorkitem({ spaceId, category, subject, assignedTo, description, attachments })` 与按项目查询成员的只读方法：校验项目、类别、非空标题及附件数/大小；选择项目/类别的默认工作项类型；按当前连接解析版本调用创建接口；逐个上传附件并关联；返回工作项 ID、编号（若创建响应未给编号，再读取详情）及附件处理结果。API 错误不包含令牌。

Agent 工具拟命名 `yunxiao_create_workitem`，参数为 `spaceId`、`category`、`subject`、必填 `assignedTo`（项目成员 ID）、可选 `description`、可选 `attachments` 路径数组；另提供只读 `yunxiao_project_members` 工具列出项目成员，供调用方选择有效 `userId`。工具描述注明这会在云效创建真实工作项；创建及附件上传具有外部写入副作用；限制路径数量和单文件大小，路径只接受本地普通文件，拒绝目录和超限文件。上传部分失败时明确报告已创建但附件失败，避免误报整体失败或重试造成重复创建。

界面不把文件内容转发到浏览器以外的任意域名：前端通过现有 Host RPC 提交创建请求；若使用浏览器 File，需以受控方式把内容送到 Host，Host 再按云效签发的 OSS 参数上传。设计实现前需选择并验证 RPC 传输格式/体积限制；不让浏览器直接拿云效令牌。

### 界面流程

看板顶部新增“创建”入口，打开轻量表单：项目（默认当前项目）、类别（需求/缺陷）、负责人（异步加载当前项目成员，可搜索并选择）、标题、描述、附件。提交期间禁用重复提交并显示进度；创建/上传失败时保留表单与用户输入，显示可读错误。成功时关闭表单、刷新看板，在当前看板停留；不自动切换类别或项目。

### 附件上限

创建 V1 设定最多 5 个附件、单文件最大 10 MiB；拒绝空路径、目录和无法读取的文件。具体上限需依据云效签发策略及现有 Harness RPC 限额在实现前验证；若云效更严格，以较小值为准。整个描述区图片仍按官方 CreateWorkitemV2 的 data URI 说明处理，但 V1 不自动把普通附件内嵌到描述。

## 文件范围（预计）

- `server/config.js`：添加已确认创建/类型/附件接口的版本化 URL 构造，不猜路径。
- `server/yunxiao.js`：添加创建、附件元数据、上传和关联流程；保持令牌仅在 Host。
- `index.js`：新增 Host RPC 方法和 `yunxiao_create_workitem` 工具注册；对参数和本地路径做边界校验。
- `client.js`：新增创建表单、附件选择/传输、成功后刷新。
- `test/yunxiao.test.js`：mock 创建与附件流程、路径/参数校验、失败与部分成功、中心/Region 路径行为。
- `README.md`：说明 UI/Agent 创建能力与附件限制。

## 失败与一致性

- 创建请求失败：报告云效错误，不上传附件。
- 创建成功、某附件失败：返回“工作项已创建”及其编号，逐附件报告失败；UI 不自动重试创建，保留错误信息并提供重新上传方案（若接口支持已创建项补传）。
- OSS 上传成功但关联失败：报告关联失败和文件名；不声称附件已添加。
- 所有错误路径均不泄露令牌或签名参数。

## 验证

1. `node --test` 覆盖创建请求字段、类型选择、附件三阶段次序、失败边界与工具参数。
2. 使用模拟响应验证 UI 表单的成功刷新、重复提交防护和失败保留输入。
3. 有权限的真实云效测试项目上验证创建 Req/Bug、单附件与多附件；无写入权限时仅报告模拟验证，不宣称真实接口验证通过。
4. 手工核对中心版和 Region 版路径，以及工作项类型查询接口的真实响应形状。

## 待核实事项

- 当前中心版/Region 版 projex API 的创建、类型查询、附件上传元数据及附件关联准确路径/请求体。
- 项目成员 API 的响应形状与创建 `assignedTo` 是否等于成员 `userId`，以官方文档为依据并在 mock 测试中锁定。
- 当前插件 RPC 是否适合传输最多 5 个、单个 10 MiB 的文件；必要时下调上限。
- 文件路径读取的运行权限边界；实现必须限制数量、大小、普通文件并避免泄露文件内容/路径。
