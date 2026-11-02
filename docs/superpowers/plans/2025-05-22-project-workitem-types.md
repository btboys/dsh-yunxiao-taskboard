# 实现计划：项目工作项类型

## 文件范围
- `server/config.js`：配置项目级类型查询 URL 与构造器。
- `server/yunxiao.js`：类型查询、显式类型创建验证和创建字段映射。
- `index.js`：Host RPC 与模型工具暴露。
- `client.js`：新建表单加载、选择和提交限制。
- `test/yunxiao.test.js`：接口、过滤、校验和创建请求测试。

## 任务 1：用测试锁定 Yunxiao API 契约
**文件：** `test/yunxiao.test.js`

**步骤：**
1. 将现有自动默认类型创建用例替换为显式类型用例：类型缺失时报错且不发请求；显式 `workitemTypeId: 'chosen'` 时请求体必须包含 `workitemType: 'chosen'`，不得包含 `workitemTypeId`。
2. 添加类型查询用例，模拟 `workitemTypes` 响应，其中含 Req/Bug、启用/禁用类型，断言查询结果只留下当前类别且启用项，输出 `{id: identifier, name}`。
3. 分别验证中心版和 Region 版 URL，包括 `/projects/{projectId}/getWorkitemType?spaceType=Project&category=Req`；类型查询不得使用旧 `/workitemTypes?categories=`。
4. 执行 `node --test test/yunxiao.test.js`，确认新用例因接口/方法不存在或旧行为不符而失败。

**运行命令：** `node --test test/yunxiao.test.js`
**预期：** RED 阶段相关用例失败，原因是项目级类型查询缺失及创建仍然推断默认类型。

## 任务 2：实现 client 端 API 与配置
**文件：** `server/config.js`、`server/yunxiao.js`

**步骤：**
1. 在连接配置中添加 `projectWorkitemTypes(spaceId)`，中心版 URL 为 `{root}/projects/{encodedSpaceId}/getWorkitemType`，Region 版为 `{baseUrl}/oapi/v1/projex/projects/{encodedSpaceId}/getWorkitemType`。
2. 新增 `workitemTypes(spaceId, category)`：要求有效项目与类别 Req/Bug；请求 URL 加 `spaceType=Project`、`category` 查询参数；从 `workitemTypes` 响应映射 identifier/name 并筛除禁用/类别不符项。
3. 从 client 返回的公有对象导出 `workitemTypes`。
4. `createWorkitem` 要求非空类型 ID；去掉默认类型查询；POST body 使用 `workitemType: typeId`。
5. 执行单测，调整到全绿。

**运行命令：** `node --test test/yunxiao.test.js`
**预期：** 所有 Yunxiao client 测试通过，类型查询和创建严格按官方契约。

## 任务 3：接通 Host RPC 与 AI 工具
**文件：** `index.js`

**步骤：**
1. 在 methods 中加入 `workitemTypes({spaceId, category, orgId})`，路由到 `client(orgId).workitemTypes(spaceId, category)`。
2. 注册 `yunxiao_workitem_types` 工具，参数 spaceId/category 必填、orgId 可选，描述说明它按指定项目和 Req/Bug 类别返回可选类型，创建前必须先查询并让用户选。
3. 更新 `yunxiao_create_workitem` 说明与 schema：明确要求查询类型、用户指定后传 `workitemTypeId`；描述不再称其可选。
4. 更新综合工具 `yunxiao_workitems` 的 create 描述/schema 以及其可选类型查询行为；推荐 AI 使用专用查询工具，执行分支调用 methods.workitemTypes。
5. 检查所有创建入口仍调用共享 client 校验。

**运行命令：** `node --check index.js`
**预期：** 语法检查通过，RPC/tool 参数名与 methods 对齐。

## 任务 4：接入创建 UI
**文件：** `client.js`

**步骤：**
1. 创建表单增加 `workitemTypeId` 状态；成员、类型状态拆分加载/错误状态。
2. 打开表单时调用 `projectMembers` 和 `workitemTypes`，类别切换时重置已选类型并重新获取类型；确保异步响应仅在当前项目/类别仍一致时更新状态（可用 effect 清理标记）。
3. 表单加工作项类型 select，展示类型 name、提交 identifier；加载中、加载失败、无可用类型均有明确提示。
4. 提交时带入 `workitemTypeId`，按钮在类型未选、加载中、类型不可用或无成员/标题/负责人时禁用；切换项目时打开中的创建表单保持安全，不使用旧项目的类型。
5. 完成后检查对话框文案和字段布局，不执行真实创建请求。

**运行命令：** `node --check client.js`
**预期：** UI 脚本语法通过；创建接口只会收到当前项目、类别对应的明确类型 ID。

## 任务 5：完整验证与提交
**文件：** 所有上述文件

**步骤：**
1. 运行 `pnpm test`。
2. 运行 `git diff --check` 并审阅 `git diff`，确认不包含未跟踪的 `pnpm-lock.yaml`。
3. 修复任何失败并重跑相关测试及完整测试。
4. 提交实现，提交信息使用 `feat(taskboard): require explicit project workitem type`。

**运行命令：** `pnpm test && git diff --check`
**预期：** 测试全通过、diff 无空白错误、提交仅包含本功能源码与测试。
