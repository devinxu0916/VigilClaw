# System Commands Skill Spec

## Purpose

system-commands 是一个内置虚拟 Skill，由 ContainerRunner 在任务启动时动态生成并注入容器。它为容器内 Agent 提供系统管理工具集（定时任务、Skill 管理、模型切换、预算控制、上下文清空），通过 CommandBridge HTTP 接口与宿主进程通信。该 Skill 不经过 SkillRegistry，对用户不可见。

## Requirements

### Requirement: system-commands 作为内置虚拟 Skill 自动注入
ContainerRunner SHALL 在每次任务启动时，动态生成 system-commands skill 的 stub 代码（`skill.json` + `index.js`），写入宿主临时目录，并通过 Docker volume 挂载到容器 `/skills/system-commands/`。该 Skill 不经过 SkillRegistry，不出现在用户的 `/skill list` 结果中。

#### Scenario: 任务启动时 stub 自动生成
- **WHEN** ContainerRunner 调用 `runTask()`
- **THEN** 系统 SHALL 在 `<dataDir>/ipc/<taskId>/system-commands-stub/` 写入 `skill.json` 和 `index.js`，并将该目录挂载到容器 `/skills/system-commands/`

#### Scenario: 任务结束后 stub 目录清理
- **WHEN** 任务完成或失败，ContainerRunner 执行清理
- **THEN** stub 目录 SHALL 随 IPC 目录一起被删除

### Requirement: system-commands Skill 定义完整的系统管理工具集
system-commands skill.json SHALL 声明以下工具，供 Agent 在 ReAct loop 中调用：

- `system_schedule_list`：列出当前用户的所有定时任务
- `system_schedule_create(cron_expression, task_prompt)`：创建定时任务，cron 为标准 5 字段格式
- `system_schedule_remove(schedule_id)`：删除指定定时任务（支持 ID 前缀匹配）
- `system_schedule_enable(schedule_id)` / `system_schedule_disable(schedule_id)`：启用/禁用定时任务
- `system_skill_list`：列出已安装的 Skill
- `system_skill_install(source_path)`：安装 Skill（需管理员权限）
- `system_skill_remove(skill_name)`：卸载 Skill（需管理员权限）
- `system_skill_enable(skill_name)` / `system_skill_disable(skill_name)`：启用/禁用 Skill
- `system_model_switch(model)`：切换当前用户的模型
- `system_budget_check`：查询当前预算及消耗
- `system_budget_set(day_limit, month_limit)`：设置预算
- `system_context_clear`：清空当前会话上下文

#### Scenario: Agent 识别定时任务意图并调用工具
- **WHEN** 用户发送"帮我每天早上9点执行一次早报摘要"
- **THEN** Agent SHALL 调用 `system_schedule_create("0 9 * * *", "执行早报摘要")`

#### Scenario: Agent 识别 Skill 列表意图
- **WHEN** 用户发送"我现在装了哪些 Skill？"
- **THEN** Agent SHALL 调用 `system_skill_list` 并格式化返回结果

#### Scenario: Agent 遇到管理员限制时向用户解释
- **WHEN** 用户（非管理员）请求安装 Skill，CommandBridge 返回 403 `requires_admin`
- **THEN** Agent SHALL 向用户解释"此操作需要管理员权限"，不抛出未处理异常

### Requirement: stub 代码通过 COMMAND_BRIDGE_URL 环境变量定位 CommandBridge
stub 的 `index.js` SHALL 从环境变量 `COMMAND_BRIDGE_URL` 读取 CommandBridge 地址，并在每次工具调用时向对应路由发送 HTTP POST 请求，携带 `taskId`、`userId`、`groupId` 及操作参数。

#### Scenario: 正常工具调用
- **WHEN** Agent 调用 `system_schedule_list`，stub 执行
- **THEN** stub SHALL POST `http://<bridge-host>:<port>/system/schedule/list`，body 含 `{ taskId, userId, groupId }`，将响应 JSON 字符串化后返回给 Agent

#### Scenario: CommandBridge 不可达
- **WHEN** stub 发起 HTTP 请求时连接失败
- **THEN** stub SHALL 返回 `"Error: CommandBridge unavailable"` 字符串（不抛出，让 Agent 处理）

### Requirement: 工具描述引导 Agent 正确使用 cron 格式
`system_schedule_create` 的工具描述 SHALL 包含 cron 格式说明及常见示例，确保 Agent 能正确将自然语言时间转换为 cron 表达式。

#### Scenario: Agent 转换自然语言时间
- **WHEN** 工具描述包含"cron_expression: 标准 5 字段 cron（分 时 日 月 周），例如每天早9点='0 9 * * *'，每周一早9点='0 9 * * 1'"
- **THEN** Agent 对"每周五下午3点"SHALL 生成 `"0 15 * * 5"`

#### Scenario: cron 格式错误时 Agent 自动修正
- **WHEN** Agent 调用 `system_schedule_create` 传入无效 cron，CommandBridge 返回 `{ error: "invalid_cron", message: "..." }`
- **THEN** Agent SHALL 读取错误信息，修正 cron 后重试，而不是直接向用户报错
