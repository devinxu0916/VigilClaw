## Context

VigilClaw 的 Router 当前以 `/command` 前缀区分系统命令与普通对话，命令处理器（`handleSkillCommand`、`handleScheduleCommand` 等）直接操作宿主进程对象（`SkillRegistry`、`TaskScheduler`、`VigilClawDB`）。Agent 在 Docker 容器内运行，与宿主进程完全隔离，只能通过 CredentialProxy（TCP HTTP）和文件系统 IPC 与宿主通信。

要支持自然语言命令，需要让容器内的 Agent 能安全地触发宿主特权操作。CredentialProxy 已经证明了"容器 → 宿主 HTTP 服务"这一模式在 VigilClaw 中是可行且安全的。

## Goals / Non-Goals

**Goals:**
- 用户能用自然语言完成定时任务 CRUD、Skill 管理、模型切换、预算查询/设置、上下文清空
- 新增系统命令时只需注册 CommandBridge 处理器 + 更新工具定义，无需修改 Router switch/case
- Admin 权限在宿主侧校验，容器无法绕过
- 不重建 Docker 镜像即可生效

**Non-Goals:**
- 不支持 LocalRunner 的系统工具调用（仅开发调试用途）
- 不替换现有 `/cost`、`/budget`、`/help`、`/clear`、`/model`、`/setkey` 快速路径
- 不实现群组级管理员权限（沿用全局 adminUsers）
- 不引入新的生产依赖

## Decisions

### D1：CommandBridge 独立于 CredentialProxy

**选择**：新建独立的 `CommandBridge` 类，不扩展 CredentialProxy。

**替代方案**：在 CredentialProxy 中增加 `/system/*` 路由。

**理由**：两者职责根本不同——CredentialProxy 是透明转发器（容器 → 外部 LLM API），CommandBridge 是特权执行器（容器 → 宿主状态变更）。合并后 ALLOWED_PATHS 白名单需要同时处理外部路径和内部路径，安全边界模糊，审计困难。独立实现各自生命周期清晰，出错定位明确。

---

### D2：per-task CommandBridge 实例（与 CredentialProxy 对齐）

**选择**：每个任务启动一个 CommandBridge HTTP 实例，端口随机，taskId 作为隐式 auth token（包含在 stub 的硬编码 URL 路径中）。

**替代方案**：共享单个 CommandBridge 实例，通过 Authorization header 或 body 字段传 taskId/userId。

**理由**：per-task 模式与 CredentialProxy 保持一致，stub 代码在生成时已硬编码 taskId + userId，CommandBridge 无需额外解析验证，生命周期绑定任务，任务结束即自动销毁，无资源泄漏风险。

---

### D3：system-commands stub 由 ContainerRunner 动态生成并挂载

**选择**：ContainerRunner 在每次 `runTask()` 时，将 stub 的 `skill.json` + `index.js` 写入宿主临时目录，通过 Docker volume 挂载到容器 `/skills/system-commands/`。

**替代方案 A**：将 stub 打包进 Docker 镜像。
**替代方案 B**：将 stub 作为固定文件存放在宿主 skills 目录，与用户 Skill 平行。

**理由**：
- 镜像打包（A）：每次修改工具定义需重建镜像，违反"无需重建即可生效"目标
- 固定文件（B）：stub 中的 CommandBridge 端口是 per-task 动态分配的，无法静态写死
- 动态生成（选择）：stub 在生成时写入当前任务的 `COMMAND_BRIDGE_URL`，完全匹配 per-task 模式

stub 代码模板存放在 `src/system-commands-stub/`，ContainerRunner 读取模板、替换端口/taskId/userId 占位符后写入临时目录。

---

### D4：Admin 权限在 CommandBridge 层校验，复用 adminUsers 配置

**选择**：CommandBridge 初始化时接收 `adminUsers: Set<string>`，对每个需要管理员权限的路由做前置检查，返回结构化 `{ error: "requires_admin" }`。

**替代方案**：在 stub 代码中屏蔽 admin-only 工具（不暴露给 Agent）。

**理由**：安全边界必须在宿主侧，不能依赖容器内的逻辑。stub 层过滤无法阻止恶意或修改后的容器绕过，宿主侧校验是唯一可信点。Agent 收到 403 后可自然向用户解释"此操作需要管理员权限"。

---

### D5：cron 表达式由 Agent LLM 生成，CommandBridge 做格式校验

**选择**：工具描述中明确 cron 格式（"标准 5 字段 cron，如每天早9点 = `0 9 * * *`"），Agent 负责自然语言 → cron 转换，CommandBridge 使用 TaskScheduler 现有的 cron 解析逻辑校验，失败时返回结构化错误。

**替代方案**：在工具层增加自然语言时间解析（如 chrono-node）。

**理由**：LLM 的时间语义理解能力已足够（"每周一早上" → "0 9 * * 1"），额外引入解析库增加依赖复杂度，且边界情况反而需要更多维护。结构化错误返回让 Agent 能自我纠正，无需用户介入。

## Risks / Trade-offs

**[容器网络访问 CommandBridge]** → 容器网络策略目前仅允许出站到 CredentialProxy，需同步更新 ContainerRunner 的网络规则以允许访问 CommandBridge 端口（两者均在宿主 IP，可共享同一网络白名单策略）。

**[stub 生成目录残留]** → 若 ContainerRunner 崩溃，临时 stub 目录可能残留。缓解：在 `cleanupIpcDir` 逻辑中同步清理 stub 目录，并在启动时扫描清理孤儿目录。

**[系统工具消耗额外 token]** → system-commands skill 的工具定义会增加每次 Agent 调用的 prompt token（约 300-500 token）。这是自然语言能力的必要成本，与 skills 现有机制一致，用户可通过 `/cost` 观察。

**[自然语言命令误触发]** → 用户说"帮我查一下定时任务"可能触发 `system_schedule_list`，这是预期行为。边界：`/setkey` 等安全敏感命令不通过系统工具暴露，继续保留为仅 `/command` 快速路径。

## Migration Plan

1. 实现 CommandBridge + stub 注入，本地测试
2. 更新 ContainerRunner 集成（新增启动/销毁步骤）
3. Router 中 `/schedule` 和 `/skill` 命令保留，不删除（向后兼容）
4. 无数据库 schema 变更，无停机迁移步骤
5. 回滚：删除 CommandBridge 集成代码，容器降级为不带系统工具（恢复原有行为）
