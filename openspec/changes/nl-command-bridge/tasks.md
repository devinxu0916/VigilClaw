## 1. CommandBridge 核心实现

- [x] 1.1 创建 `src/command-bridge.ts`：定义 `CommandBridge` 类，实现 `createBridgeForTask(taskId, userId, groupId)` 和 `destroyBridgeForTask(taskId)` / `destroyAll()`，使用 Node.js 内置 `http` 模块，per-task 随机端口
- [x] 1.2 实现请求解析与 taskId 鉴权：解析 POST body JSON，校验 `taskId` 与当前实例匹配，不匹配返回 403 `{ error: "invalid_task_id" }`
- [x] 1.3 实现 Admin 权限检查：`CommandBridge` 构造函数接收 `adminUsers: Set<string>`，对需要管理员权限的路由做前置校验，不通过返回 403 `{ error: "requires_admin" }`
- [x] 1.4 实现定时任务路由：`POST /system/schedule/list|create|remove|enable|disable`，委托 `TaskScheduler` / `VigilClawDB` 执行，返回标准化 JSON 响应
- [x] 1.5 实现 Skill 管理路由：`POST /system/skill/list|install|remove|enable|disable`，委托 `SkillRegistry` 执行
- [x] 1.6 实现其他系统路由：`POST /system/model/switch`、`/system/budget/check`、`/system/budget/set`、`/system/context/clear`
- [x] 1.7 标准化错误响应：所有错误返回 `{ error: "<code>", message?: "<text>" }`，状态码语义正确（400/403/404/500）

## 2. system-commands Stub 模板

- [x] 2.1 创建 `src/system-commands-stub/skill.json`：声明所有 12 个系统工具（`system_schedule_list/create/remove/enable/disable`、`system_skill_list/install/remove/enable/disable`、`system_model_switch`、`system_budget_check/set`、`system_context_clear`），含完整 `input_schema` 和工具描述（包含 cron 格式示例）
- [x] 2.2 创建 `src/system-commands-stub/index.ts`（或直接写 `index.js`）：stub 实现，从 `COMMAND_BRIDGE_URL` env 读取地址，每个工具调用 HTTP POST 对应路由，携带 `taskId`/`userId`/`groupId` + 参数，返回字符串化 JSON；连接失败时返回 `"Error: CommandBridge unavailable"` 而非抛出
- [x] 2.3 确认 stub 导出格式符合 `loadSkillTools()` 的 `createTool` 约定（即 `export function createTool(def): Tool`）

## 3. ContainerRunner 集成

- [x] 3.1 在 `ContainerRunner` 构造函数中接收 `CommandBridge` 实例（或在 `runTask` 内部创建）
- [x] 3.2 在 `runTask()` 启动流程中：调用 `commandBridge.createBridgeForTask()`，获取端口；生成 stub 目录（`<dataDir>/ipc/<taskId>/system-commands-stub/`），复制 `skill.json` 和 `index.js`，并将端口/taskId/userId/groupId 注入 `index.js`（字符串替换占位符）
- [x] 3.3 更新 Docker `Binds` / `HostConfig`：将 stub 目录挂载到容器 `/skills/system-commands`（只读）
- [x] 3.4 更新 Docker `Env`：注入 `COMMAND_BRIDGE_URL=http://172.17.0.1:<port>`（或宿主网关 IP）
- [x] 3.5 在任务清理流程（正常结束/超时/错误）中调用 `commandBridge.destroyBridgeForTask(taskId)`
- [x] 3.6 更新 `QueuedTask` 的 skills 注入逻辑：`system-commands` skill 的工具定义自动合并进 `enabledSkills`（不经过 SkillRegistry），让 Agent 在 ReAct loop 中可见这些工具

## 4. 验证与测试

- [x] 4.1 为 `CommandBridge` 编写单元测试（`tests/unit/command-bridge.test.ts`）：覆盖 taskId 鉴权、admin 权限校验、各路由正常/错误响应
- [x] 4.2 为 stub 生成逻辑编写单元测试：验证占位符替换正确，skill.json 工具数量和 schema 完整
- [x] 4.3 运行 `pnpm typecheck` 确认无 TypeScript 错误
- [x] 4.4 运行 `pnpm lint` 确认无 lint 错误
- [x] 4.5 运行 `pnpm test` 确认所有测试通过（覆盖率阈值：语句 80% / 分支 75% / 函数 80% / 行 80%）
- [ ] 4.6 本地 `pnpm dev` + Docker 环境集成验证：发送"帮我列一下定时任务"，确认 Agent 调用 `system_schedule_list` 并正确返回结果
