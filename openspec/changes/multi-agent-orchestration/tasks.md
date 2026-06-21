## 1. 类型与 TaskExecutor 抽象

- [x] 1.1 创建 `src/orchestration-types.ts`：定义 `SubTask`（`{ id, description, dependsOn: string[] }`）、`OrchestrationPlan`、`SubAgentInput`（`{ taskId, subId, userId, groupId?, provider, model, prompt, tools }`）、`SubAgentResult`（`{ subId, content, usage, model, success, error? }`）、`TaskExecutor` 接口（`execute(input): Promise<SubAgentResult>`）
- [x] 1.2 创建 `src/sub-agent-executor.ts`：`RunnerTaskExecutor implements TaskExecutor` — 把 `SubAgentInput` 构造为 `QueuedTask`（基础工具、no-op `replyFn`、无 skills），调用 `IRunner.runTask`，映射为 `SubAgentResult`；失败返回 `{ success:false, error }` 不抛出
- [x] 1.3 验证：`pnpm typecheck` 通过

## 2. Orchestrator 核心

- [x] 2.1 创建 `src/orchestrator.ts`：`Orchestrator` 类，构造接收 `db`、`provider 工厂/summaryProvider`、`taskExecutor`、`costGuard`、配置（`enabled`/`maxSubtasks`/`maxParallel`）
- [x] 2.2 实现 `shouldOrchestrate(task)`：启发式闸门（长度阈值 + 多子句/枚举/连接词探测）→ 通过则 Haiku 分类（`taskId: orchestrate-classify:<id>`，JSON `{orchestrate:boolean}`，解析失败→false）；`enabled:false` 直接 false
- [x] 2.3 实现 `plan(task)`：Haiku 拆解（`taskId: orchestrate-plan:<id>`）→ 解析 `SubTask[]`，截断到 `maxSubtasks`；≤1 或解析失败返回 null（触发单 Agent 降级）
- [x] 2.4 实现 `scheduleWaves(plan)`：按 `dependsOn` 计算入度分波；波内用信号量 `maxParallel` 并发调用 `taskExecutor.execute`；被依赖子任务输出拼入依赖方 prompt；收集 `SubAgentResult[]`；每个子任务记账（`orchestrate-sub:<id>:<subId>`）
- [x] 2.5 实现 `synthesize(task, results)`：用户模型综合（`taskId: orchestrate-synth:<id>`）→ 最终回复文本；失败降级为拼接子任务输出 + 简短说明
- [x] 2.6 实现 `run(task): Promise<{ content: string; totalCost: number }>`：编排前 `costGuard` 预算检查（超限抛/返回标准超限消息）→ plan（null 则降级单 Agent 执行原请求）→ 可选发一条进度消息 → scheduleWaves → synthesize；聚合 totalCost
- [x] 2.7 全程 try/catch 降级：分类/规划/综合任一失败回退单 Agent 或拼接结果，绝不让用户无回复
- [x] 2.8 验证：`pnpm typecheck` 通过

## 3. 配置

- [x] 3.1 在 `src/config.ts` 新增 `OrchestrationConfigSchema`（`enabled` 默认 true、`maxSubtasks` 默认 5、`maxParallel` 默认 3）+ 挂到主配置 `orchestration` 段 + 类型导出
- [x] 3.2 映射环境变量 `VIGILCLAW_ORCHESTRATION_ENABLED` / `VIGILCLAW_ORCHESTRATION_MAX_SUBTASKS` / `VIGILCLAW_ORCHESTRATION_MAX_PARALLEL`
- [x] 3.3 在 `.env.example` 补充编排配置说明
- [x] 3.4 验证：`pnpm typecheck` 通过

## 4. 集成到执行器

- [x] 4.1 在 `src/index.ts` 初始化 `RunnerTaskExecutor`（包装 `runner`）+ `Orchestrator`（注入 db / summaryProvider / costGuard / 配置）
- [x] 4.2 重构 `GroupQueue` 执行器：抽出 `finalizeTask(task, finalContent, totalCost)` 公共收尾（`updateTaskCompleted` + `saveAssistantMessage` + `replyFn` + 记忆/图谱提取）
- [x] 4.3 执行器分支：`orchestration.enabled && await orchestrator.shouldOrchestrate(task)` → `orchestrator.run(task)`；否则现有单 Agent 路径（记一条 `api_calls`）；两路汇合到 `finalizeTask`
- [x] 4.4 验证：`pnpm typecheck` + `pnpm build` 通过

## 5. 测试

- [x] 5.1 `tests/unit/orchestrator.test.ts`（注入 mock `TaskExecutor` + mock provider）：
  - `shouldOrchestrate`：简单消息不调分类器；复合消息走分类；分类失败→false
  - `plan`：正常拆解；超 `maxSubtasks` 截断；≤1/解析失败→null 降级
  - `scheduleWaves`：独立子任务并发；`maxParallel` 上界（用计数器断言峰值并发）；`dependsOn` 波次顺序 + 依赖输出注入
  - `synthesize`：综合成功；失败降级拼接
  - 预算：超预算不启动编排
  - 计费：classify+plan+N+synth 条 `api_calls`
- [x] 5.2 `enabled:false` 全程跳过编排
- [x] 5.3 全量检查：`pnpm check`（lint + typecheck + test）通过

## 6. 文档同步

- [x] 6.1 更新 `docs/planning/ROADMAP.md`：P3「多 Agent 编排」状态 ⏳ → ✅，更新顶部状态行与「最后更新」日期；P3 全部完成时同步说明
- [x] 6.2 更新 `docs/planning/CHANGELOG.md`：记录多 Agent 编排变更（新增文件/修改文件/配置/测试数）
- [x] 6.3 更新 `README.md` Roadmap 表：追加「多 Agent 编排 ✅」
- [ ] 6.4 同步主 specs：将 `multi-agent-orchestration` 能力合并到 `openspec/specs/`（归档时执行）
