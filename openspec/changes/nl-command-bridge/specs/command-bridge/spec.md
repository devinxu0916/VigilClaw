## ADDED Requirements

### Requirement: CommandBridge 提供宿主侧特权命令执行服务
CommandBridge SHALL 是一个宿主进程内的 TCP HTTP 服务，每个 Agent 任务独立实例，监听随机端口，处理来自容器的系统命令请求，并将操作委托给宿主进程对象（DB、SkillRegistry、TaskScheduler、SessionManager）。

#### Scenario: 启动任务时创建 CommandBridge 实例
- **WHEN** ContainerRunner 调用 `commandBridge.createBridgeForTask(taskId, userId, groupId)`
- **THEN** 系统 SHALL 在随机空闲端口启动 HTTP 服务并返回端口号

#### Scenario: 任务结束时销毁实例
- **WHEN** ContainerRunner 任务完成或超时
- **THEN** 系统 SHALL 调用 `commandBridge.destroyBridgeForTask(taskId)`，关闭对应 HTTP 服务，释放端口

### Requirement: CommandBridge 处理定时任务管理请求
CommandBridge SHALL 支持以下定时任务操作路由，路径格式为 `POST /system/schedule/<action>`。

#### Scenario: 列出定时任务
- **WHEN** 容器 POST `/system/schedule/list`，body 含 `{ taskId, userId }`
- **THEN** 返回该用户的所有定时任务列表（JSON 数组）

#### Scenario: 创建定时任务
- **WHEN** 容器 POST `/system/schedule/create`，body 含 `{ taskId, userId, groupId, cronExpression, taskPrompt }`
- **THEN** 调用 TaskScheduler 创建任务，返回 `{ success: true, taskId: "<new-id>" }` 或 `{ success: false, error: "invalid_cron" }`

#### Scenario: 删除定时任务
- **WHEN** 容器 POST `/system/schedule/remove`，body 含 `{ taskId, userId, scheduleId }`
- **THEN** 删除该用户的指定定时任务，返回 `{ success: true }` 或 `{ success: false, error: "not_found" }`

#### Scenario: 启用/禁用定时任务
- **WHEN** 容器 POST `/system/schedule/enable` 或 `/system/schedule/disable`，body 含 `{ taskId, userId, scheduleId }`
- **THEN** 更新任务启用状态，返回 `{ success: true }` 或错误

### Requirement: CommandBridge 处理 Skill 管理请求
CommandBridge SHALL 支持 Skill 查询及管理员操作，管理员操作需要权限校验。

#### Scenario: 列出 Skill（无需管理员）
- **WHEN** 容器 POST `/system/skill/list`，body 含 `{ taskId, userId }`
- **THEN** 返回已安装 Skill 列表（含名称、版本、启用状态）

#### Scenario: 管理员安装 Skill
- **WHEN** 容器 POST `/system/skill/install`，body 含 `{ taskId, userId, sourcePath }`，userId 在 adminUsers 中
- **THEN** 调用 SkillRegistry.installSkill()，返回结果

#### Scenario: 非管理员尝试安装 Skill
- **WHEN** 容器 POST `/system/skill/install`，userId 不在 adminUsers 中
- **THEN** 返回 HTTP 403，body `{ error: "requires_admin" }`

#### Scenario: 启用/禁用 Skill（管理员）
- **WHEN** 容器 POST `/system/skill/enable` 或 `/system/skill/disable`，body 含 `{ taskId, userId, skillName }`，userId 在 adminUsers 中
- **THEN** 更新 Skill 启用状态，返回 `{ success: true }` 或错误

### Requirement: CommandBridge 处理其他系统操作
CommandBridge SHALL 支持模型切换、预算查询/设置、上下文清空。

#### Scenario: 切换模型
- **WHEN** 容器 POST `/system/model/switch`，body 含 `{ taskId, userId, model }`
- **THEN** 更新用户当前模型，返回 `{ success: true, model: "<resolved-model>" }`

#### Scenario: 查询预算
- **WHEN** 容器 POST `/system/budget/check`，body 含 `{ taskId, userId }`
- **THEN** 返回当前预算及消耗情况（JSON）

#### Scenario: 设置预算（管理员或用户自己）
- **WHEN** 容器 POST `/system/budget/set`，body 含 `{ taskId, userId, dayLimit, monthLimit }`
- **THEN** 更新用户预算，返回 `{ success: true }`

#### Scenario: 清空上下文
- **WHEN** 容器 POST `/system/context/clear`，body 含 `{ taskId, userId, groupId }`
- **THEN** 调用 SessionManager.clearContext()，返回 `{ success: true }`

### Requirement: CommandBridge 请求鉴权
CommandBridge SHALL 校验请求中的 taskId，确保只有持有正确 taskId 的调用者（即对应容器）才能操作该用户数据。

#### Scenario: 有效 taskId 请求放行
- **WHEN** 请求 body 中的 taskId 与当前 Bridge 实例的 taskId 匹配
- **THEN** 继续处理请求

#### Scenario: 无效 taskId 拒绝
- **WHEN** 请求 body 中的 taskId 不匹配当前实例
- **THEN** 返回 HTTP 403，body `{ error: "invalid_task_id" }`

### Requirement: CommandBridge 错误响应标准化
CommandBridge 的所有错误响应 SHALL 使用 JSON 格式 `{ error: "<error_code>", message?: "<human-readable>" }`，HTTP 状态码语义正确（400 参数错误、403 权限不足、404 资源未找到、500 内部错误）。

#### Scenario: 参数缺失
- **WHEN** 请求 body 缺少必填字段（如 cronExpression）
- **THEN** 返回 HTTP 400，`{ error: "missing_field", message: "cronExpression is required" }`

#### Scenario: 资源不存在
- **WHEN** 操作的 scheduleId 或 skillName 不存在
- **THEN** 返回 HTTP 404，`{ error: "not_found" }`
