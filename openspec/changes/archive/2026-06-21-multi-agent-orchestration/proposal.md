## Why

VigilClaw 目前每条用户消息都映射为**单个 Agent 任务**：`Router` 构造一个 `QueuedTask` → `GroupQueue` 串行调度 → `IRunner.runTask()` 在一个容器里跑一轮 ReAct 循环 → 回复。对「一个动作就能完成」的请求这很合适，但对**需要拆解的复合请求**（例如"调研 A、B、C 三个库的优劣，分别给出代码示例，最后汇总成对比表"）就力不从心：

- 单个 ReAct 循环要在一轮里串行完成所有子目标，容易超出 30 轮安全阀或 5 分钟容器超时
- 上下文里塞满所有子目标，互相干扰，质量下降
- 无法并行——三个相互独立的调研只能一个接一个做

多 Agent 编排引入一个 **Orchestrator**：自动识别复合请求，用便宜的 Haiku 把目标拆解为有界的子任务，通过统一的 `TaskExecutor` 抽象把相互独立的子任务**有界并发**地派发给隔离的子 Agent（复用现有 `IRunner`），最后由用户模型把各子任务结果**综合**成一个回复。采用「枢纽辐射」结构：Orchestrator 在宿主进程充当唯一枢纽，子 Agent 之间互相隔离、不直接通信，结果统一回流到 Orchestrator。

## What Changes

- 新增 `src/orchestrator.ts`：`Orchestrator` 类 — 复杂度分类 → 任务拆解 → 子任务调度 → 结果综合
- 新增 `src/orchestration-types.ts`：`TaskExecutor` 接口 + `SubTask` / `OrchestrationPlan` / `SubAgentInput` / `SubAgentResult` 类型
- 新增 `src/sub-agent-executor.ts`：`RunnerTaskExecutor` — 用现有 `IRunner` 实现 `TaskExecutor`（为子任务构造 `QueuedTask` 并执行）
- 扩展 `src/index.ts`：在 `GroupQueue` 执行器中分支 — 命中编排则走 `Orchestrator`，否则保持现有单 Agent 路径；抽出公共收尾（任务完成/记忆提取/回复）供两条路径共用
- 扩展 `src/config.ts`：新增 `orchestration.*` 配置段 + `VIGILCLAW_ORCHESTRATION_*` 环境变量
- 复用现有 `CostGuard`（编排前预算检查）、`api_calls`（每次 LLM 调用计费）、容器超时与隔离约束

## Capabilities

### New Capabilities
- `multi-agent-orchestration`: 多 Agent 编排 — 自动复杂度检测、Haiku 任务拆解、`TaskExecutor` 抽象、枢纽辐射式有界并发子 Agent 执行、用户模型结果综合、成本/预算管控、优雅降级

### Modified Capabilities
_无。编排是任务执行链路的新分支；未命中编排时现有单 Agent 行为规格完全不变。_

## Impact

**新增文件：**
- `src/orchestrator.ts` — `Orchestrator`（分类 / 拆解 / 调度 / 综合）
- `src/orchestration-types.ts` — `TaskExecutor` 接口 + 编排类型
- `src/sub-agent-executor.ts` — `RunnerTaskExecutor`（`IRunner` 适配）
- `tests/unit/orchestrator.test.ts` — 单元测试

**修改文件：**
- `src/index.ts` — `GroupQueue` 执行器分支 + 抽出公共收尾逻辑
- `src/config.ts` — 新增 `orchestration` 配置段 + `VIGILCLAW_ORCHESTRATION_*` 环境变量
- `.env.example` — 补充编排配置说明

**新增依赖：** 无（复用 Anthropic SDK / Haiku、现有 `IRunner` 与容器隔离、`CostGuard`）

**受影响系统：** 任务执行链路（`GroupQueue` 执行器分支）、成本计费（多条 `api_calls`）、容器并发预算（子任务共享 `maxConcurrentContainers`）

**成本：** 命中编排时新增「分类(Haiku) + 拆解(Haiku) + N×子任务(用户模型) + 综合(用户模型)」多次调用，全部记入 `api_calls`，`/cost` 可见；编排前过 `CostGuard` 预算检查。未命中编排（绝大多数消息）仅在通过启发式闸门后多一次 Haiku 分类调用，可通过 `orchestration.enabled: false` 关闭。
