# 项目工作项类型查询与创建设计

## 目标
新增需求/缺陷时，用户必须根据当前项目和类别选择一个已启用的工作项子类型；提供相同查询能力给 UI 与 AI 工具。创建不能依赖隐式默认类型。

## 官方接口
查询使用 ListProjectWorkitemTypes：`GET /organization/{organizationId}/projects/{projectId}/getWorkitemType?spaceType=Project&category={Req|Bug}`。响应 `workitemTypes` 中类型字段为 `identifier`、`name`、`categoryIdentifier`、`enable`。创建 OpenAPI 字段名为 `workitemType`，值为所选类型 ID。参考：[类型查询](https://help.aliyun.com/zh/yunxiao/developer-reference/api-devops-2021-06-25-listprojectworkitemtypes.md)、[创建工作项](https://help.aliyun.com/zh/yunxiao/developer-reference/api-devops-2021-06-25-createworkitem.md)。

## 设计决策
- 在 Yunxiao client 增加 `workitemTypes(spaceId, category)`，走项目级接口，校验类别并规范化成 `{id, name}`，只返回启用且类别匹配的类型。
- `createWorkitem` 要求显式提供 `workitemTypeId`，缺失/空值立即报错；创建请求映射为 API 字段 `workitemType`。不再查询旧组织级 `/workitemTypes?categories=`，不做默认类型推断。
- Host RPC 暴露 `workitemTypes`；AI 暴露专用 `yunxiao_workitem_types` 查询工具。创建 AI 工具描述要求先查类别类型并让用户选择；`workitemTypeId` 必填。
- UI 打开创建框时并行读取成员和类型；类别/项目变化时重新读取类型。提供类型下拉；无类型、加载失败、未选类型时不能提交。
- 不主动向云效真实创建项目工作项作验证。

## 验证
单测覆盖中心版与 Region 版查询 URL/参数、响应映射/过滤、非法类别、显式类型必填、创建请求字段映射；运行 `pnpm test`。UI 逻辑以静态/人工检查确认 RPC 输入输出和禁用条件，无需真实云效提交。
