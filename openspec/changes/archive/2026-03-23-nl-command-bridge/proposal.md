## Why

当前所有系统管理操作（定时任务、Skill 管理等）只能通过精确的 `/command` 语法触发，用户必须记忆命令格式和参数顺序。随着系统能力增长，命令数量也持续增加，降低了使用体验，也让新用户上手成本变高。引入自然语言命令支持，让用户能用日常语言完成同等操作，同时为后续新增能力提供统一的扩展机制。

## What Changes

- **新增 `CommandBridge`**：宿主侧 TCP HTTP 服务（类比 CredentialProxy），每个 Agent 任务独立实例，处理容器发起的系统命令请求（定时任务 CRUD、Skill 管理、模型切换、预算查询、上下文清空）
- **新增 `system-commands` skill（虚拟/内置）**：ContainerRunner 在每次任务启动时动态生成 stub 代码并挂载到容器 `/skills/system-commands/`，stub 通过 HTTP 调用 CommandBridge 执行宿主操作
- **修改 `ContainerRunner`**：任务启动时同步启动 CommandBridge，生成并挂载 system-commands stub，注入 `COMMAND_BRIDGE_URL` 环境变量；任务结束时销毁 CommandBridge
- **修改 `Router`**：保留 `/cost`、`/budget`、`/help`、`/clear`、`/model`、`/setkey`、`/start` 作为快速路径；`/schedule`、`/skill` 的自然语言等价操作改由 Agent 系统工具承载（原命令保留兼容）
- **Admin 权限**：CommandBridge 复用 `adminUsers` 配置进行鉴权，返回结构化 403 让 Agent 向用户解释

## Capabilities

### New Capabilities

- `command-bridge`：宿主侧特权命令桥接服务，让容器 Agent 能安全调用宿主系统操作，支持按操作路径注册处理器，可扩展
- `system-commands-skill`：内置虚拟 Skill，定义系统管理工具集（schedule/skill/model/budget/context），由 ContainerRunner 动态注入，Agent 通过自然语言触发

### Modified Capabilities

（无已有 spec 层面的需求变更）

## Impact

**新增文件：**
- `src/command-bridge.ts` — CommandBridge 服务实现
- `src/system-commands-stub/` — stub 模板代码（skill.json + index.ts，构建产出为 index.js）

**修改文件：**
- `src/container-runner.ts` — 集成 CommandBridge 生命周期 + stub 注入
- `src/router.ts` — 移除 `/schedule`、`/skill` 的完整 Handler（保留快速路径命令）

**新增依赖：** 无（仅使用 Node.js 内置 `http`、`fs`、`path`）

**不受影响：**
- `CredentialProxy`、`GroupQueue`、`CostGuard`、Channels、Provider 层
- Docker 镜像本身无需重新构建（stub 以宿主卷挂载方式注入）
