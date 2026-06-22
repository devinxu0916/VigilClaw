## Context

VigilClaw 的任务执行链路（已落地）：

- `Router` 把用户消息构造成 `QueuedTask`（`{ id, userId, groupId, messages, provider, model, tools, skills?, replyFn }`）并 `groupQueue.enqueue()`
- `GroupQueue`（`src/group-queue.ts`）：群组内串行、跨群组并行，全局并发上限 `maxConcurrentContainers`；通过 `setExecutor(fn)` 注入执行器
- `index.ts` 的执行器：`runner.runTask(task)` → `TaskResult` → 记账(`db.recordApiCall`)→ `updateTaskCompleted` → `saveAssistantMessage` → `replyFn` → 异步记忆/图谱提取
- `IRunner`（`src/runner-types.ts`）：`runTask(task): Promise<TaskResult>`，由 ContainerRunner / AppleContainerRunner / LocalRunner 实现，含容器隔离、5 分钟超时、30 轮安全阀
- `CostGuard`（日/月预算）、`api_calls` 表（每次 LLM 调用计费）

编排要作为执行器内的**新分支**接入，未命中时现有路径零改动。约束：9 个生产依赖、TypeScript strict、优雅降级是既有惯例。

## Goals / Non-Goals

**Goals:**
- 自动识别需要拆解的复合请求（无需用户显式命令）
- 用便宜模型把目标拆成有界子任务，相互独立的子任务有界并发执行
- 子 Agent 复用现有容器隔离，彼此隔离、经 Orchestrator 枢纽汇聚结果
- 用户模型综合出单一回复
- 成本可控、可计费、过预算检查；失败优雅降级回单 Agent
- 引入可测试的 `TaskExecutor` 抽象（ROADMAP 指定）

**Non-Goals:**
- 嵌套/递归编排（子 Agent 不得再触发编排）——v1 严格单层
- 子 Agent 之间直接通信 / 共享黑板文件——统一走枢纽
- 持久化编排过程到新表 / Dashboard 可视化——v1 仅用 `api_calls` 记费，留待后续
- 长时运行 / 跨消息的 Agent 团队——一次编排在一个父任务生命周期内完成
- 子 Agent 自定义工具集与 Skill 继承——v1 子 Agent 仅基础工具（见 D5）

## Decisions

### D1: 触发方式 — 自动复杂度检测（启发式闸门 + Haiku 分类器）

**选择：在执行器内，先用零成本启发式闸门过滤，疑似复合的请求再用 Haiku 分类器判定是否编排。**

| 方案 | 每条消息成本 | 体验 |
|------|------------|------|
| 纯启发式（关键词/长度） | 0 | 易误判，规则脆弱 |
| 启发式闸门 + Haiku 分类（本方案） | 多数消息 0，少数 1 次 Haiku | 准确且低成本 |
| 每条消息都 Haiku 分类 | 每条 1 次 Haiku | 简单但成本/延迟高 |
| 显式 `/agent` 命令 | 0 | 需用户学习，漏掉自然表达 |

**理由**：用户选择「自动检测」。为控制成本，先用启发式闸门（消息长度阈值、是否包含多个子句/枚举/连接词如"并"、"分别"、"and then"）排除明显简单的消息（问候、短问答），仅对疑似复合的消息发一次 Haiku 分类调用。分类调用记入 `api_calls`（`taskId: orchestrate-classify:<taskId>`）。可经 `orchestration.enabled: false` 整体关闭。

分类器返回 `{ orchestrate: boolean }`；解析失败按 `false` 处理（降级到单 Agent）。

### D2: 任务拆解 — Haiku 规划器输出结构化 JSON

**选择：用 Haiku 把目标拆成 `SubTask[]`（`{ id, description, dependsOn[] }`），输出 JSON；子任务本身由用户当前模型执行。**

**理由**：用户选择「Haiku 规划 + 用户模型执行」。拆解是结构化的轻推理任务，Haiku 足够且便宜；子任务的实际执行需要质量，用用户模型。规划调用记入 `api_calls`（`taskId: orchestrate-plan:<taskId>`）。

**约束（v1 严格边界）**：
- 子任务数上限 `maxSubtasks`（默认 5）；超出截断
- 单层拆解：`dependsOn` 只能引用同批其它子任务 id，构成 DAG；子任务不得再触发编排（见 D5）
- 规划输出非法 / 子任务数 ≤ 1：降级为单 Agent 直接执行原请求

JSON 契约：`[{ "id": "t1", "description": "...", "dependsOn": [] }]`，无法拆解返回 `[]`。

### D3: 执行结构 — 枢纽辐射 + 依赖波次 + 有界并发

**选择：Orchestrator 在宿主进程充当枢纽；按 `dependsOn` 拓扑分波，波内相互独立的子任务通过 `TaskExecutor` 有界并发执行（信号量 `maxParallel`），结果回流枢纽。**

| 方案 | 并行度 | 复杂度 |
|------|--------|--------|
| 枢纽辐射 + 依赖波次（本方案） | 波内并行 | 中 |
| 纯串行链 | 无 | 低，慢 |
| 共享黑板文件 | 高 | 引入跨容器共享状态 + 安全面 |

**理由**：用户选择「枢纽辐射（有界并发）」。子 Agent 彼此隔离（各自独立容器），不直接通信；依赖通过枢纽传递（被依赖子任务的输出拼入依赖方的 prompt）。波次调度：计算入度，无依赖者入首波；每完成一波更新入度，解锁下一波。

**并发预算**：子任务经 `TaskExecutor` 直接调用 `IRunner.runTask`，**不**经 `GroupQueue`（否则同一 `groupId` 会被串行化而自相阻塞）。并发由 Orchestrator 自己的信号量 `maxParallel`（默认 3）限制。父编排任务本身仍占用一个 `GroupQueue` 槽位——即「该用户当前有一个逻辑活动在进行」，语义正确。

> 注意：子任务与其它用户的普通任务共享全局容器容量 `maxConcurrentContainers`，故 `maxParallel` 默认取较小值（3），避免单次编排饿死其它用户。

### D4: TaskExecutor 抽象

**选择：定义 `TaskExecutor` 接口，Orchestrator 依赖它执行单个子 Agent；默认实现 `RunnerTaskExecutor` 包装 `IRunner`。**

```ts
export interface TaskExecutor {
  execute(input: SubAgentInput): Promise<SubAgentResult>;
}
```

**理由**：ROADMAP 明确「TaskExecutor 接口 + Orchestrator」。该接口把 Orchestrator 与容器细节解耦——测试时注入 mock executor，无需真实容器即可验证分波/并发/综合逻辑。`RunnerTaskExecutor` 负责把 `SubAgentInput` 构造成 `QueuedTask`（用户模型、基础工具、no-op `replyFn`），调用 `runner.runTask`，把 `TaskResult` 映射为 `SubAgentResult`，并记账（`taskId: orchestrate-sub:<taskId>:<subId>`）。

### D5: 子 Agent 隔离与安全边界

**选择：子 Agent 是普通单 Agent 任务，仅授予基础工具，禁止递归编排与系统命令。**

- 子任务 `QueuedTask` 由 `RunnerTaskExecutor` 直接构造，**绕过 Router**，因此不会被注入 `system-commands` skill（admin 级系统操作），也不会带 orchestration——天然禁止递归与子 Agent 篡改系统配置
- v1 子 Agent **不继承** task.skills（避免放大攻击面与不确定性）；仅给基础工具（Bash/Read/Write/Edit）。Web Search 等 skill 继承留待后续
- 子任务 `replyFn` 为 no-op：子 Agent 输出回流 Orchestrator，不直接发给用户
- 复用容器既有约束：只读 rootfs、CAP_DROP ALL、5 分钟超时、30 轮安全阀

### D6: 结果综合 — 用户模型

**选择：所有子任务完成后，用用户当前模型把「原始目标 + 各子任务输出」综合成最终回复。**

**理由**：最终答案质量直接面向用户，用用户模型（非 Haiku）。综合调用记入 `api_calls`（`taskId: orchestrate-synth:<taskId>`）。综合失败时降级为「拼接各子任务输出 + 简短说明」，保证有输出。

### D7: 执行器集成与公共收尾

**选择：在 `index.ts` 的 `GroupQueue` 执行器内分支，抽出公共收尾逻辑供两条路径共用。**

```ts
groupQueue.setExecutor(async (task) => {
  db.updateTaskRunning(task.id, ...);
  try {
    let finalContent: string;
    let totalCost: number;
    if (orchestrator && (await orchestrator.shouldOrchestrate(task))) {
      const r = await orchestrator.run(task);   // 内部记账每次调用 + 可发进度消息
      finalContent = r.content;
      totalCost = r.totalCost;
    } else {
      const result = await runner.runTask(task); // 现有路径
      totalCost = recordSingleAgentCost(task, result);
      finalContent = result.response.content;
    }
    finalizeTask(task, finalContent, totalCost);  // updateTaskCompleted + saveAssistantMessage + replyFn + 记忆/图谱提取
  } catch (err) { /* 现有失败处理不变 */ }
});
```

**理由**：编排路径自己记录每次 LLM 调用的 `api_calls`（粒度计费），返回 `{ content, totalCost }`；单 Agent 路径记录一条 `api_calls`。两者汇合到 `finalizeTask` 做相同收尾，避免重复。`shouldOrchestrate` 封装 D1 的启发式闸门 + 分类。

### D8: 配置

```
orchestration:
  enabled       boolean  默认 true
  maxSubtasks   number   默认 5
  maxParallel   number   默认 3
```

环境变量：`VIGILCLAW_ORCHESTRATION_ENABLED`、`VIGILCLAW_ORCHESTRATION_MAX_SUBTASKS`、`VIGILCLAW_ORCHESTRATION_MAX_PARALLEL`。分类/规划模型固定 `claude-haiku-4-5-20251001`（与记忆/图谱一致）。

## Risks / Trade-offs

- **[每条疑似复杂消息多一次 Haiku 分类，增加成本/延迟]** → 缓解：零成本启发式闸门先过滤，绝大多数消息不触发分类；分类记账可见；`enabled: false` 一键关闭。
- **[误判：把简单请求当复合 → 不必要的多次调用]** → 缓解：分类器 prompt 偏保守（倾向不编排）；规划输出 ≤1 子任务即降级单 Agent；启发式闸门设较高门槛。
- **[子任务并发耗尽全局容器预算，饿死其它用户]** → 缓解：`maxParallel` 默认 3 且远小于 `maxConcurrentContainers`；子任务走独立信号量而非占满 GroupQueue。
- **[编排放大成本（N 个子任务 × 用户模型）]** → 缓解：编排前过 `CostGuard` 预算检查；`maxSubtasks` 上限；每次调用记账，`/cost` 可见。
- **[规划/综合 LLM 输出不稳定]** → 缓解：JSON 解析失败降级（规划失败→单 Agent，综合失败→拼接输出）；全程 try/catch 不中断主流程。
- **[递归编排导致指数爆炸]** → 缓解：子任务绕过 Router 构造，天然不含 orchestration/system-commands；架构上禁止递归（D5）。
- **[代码量增加]** → 预估新增约 500–700 行（orchestrator + executor + 类型 + 测试）。编排是独立模块，不增加单 Agent 路径复杂度。

## Migration Plan

**对现有用户的影响：**
- `orchestration.enabled` 默认 `true`；仅复合请求会被编排，简单请求行为不变
- 命中编排时用户会看到一条可选进度提示（"🧩 已拆解为 N 个子任务…"）+ 最终综合回复
- 无 DB 迁移、无新依赖、无部署变更

**回滚：**
- 设 `VIGILCLAW_ORCHESTRATION_ENABLED=false` 即彻底关闭，所有消息回到单 Agent 路径

## Open Questions

1. 是否把编排过程（plan + subtasks）持久化到新表以供 Dashboard 可视化？ — v1 不做，仅 `api_calls` 记费；后续单独提案。
2. 子 Agent 是否继承 Web Search 等 skill？ — v1 仅基础工具；按需在后续放开特定安全 skill。
3. 是否提供 `/agent` 显式命令作为自动检测的补充入口？ — 本期聚焦自动检测；显式命令可作为低成本增量后续添加。
