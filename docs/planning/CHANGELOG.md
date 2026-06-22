# Changelog

本文件记录 VigilClaw 的所有版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **Phase 2 P3: 多 Agent 编排（Multi-Agent Orchestration）** — 自动识别复合请求并拆解为子任务并行执行，零新增生产依赖
  - `src/orchestrator.ts`：`Orchestrator` 类
    - `shouldOrchestrate()`：零成本启发式闸门（长度 + 枚举/连接词探测）→ 通过才用 Haiku 分类器判定是否编排（`taskId: orchestrate-classify:<id>`），保守倾向不编排
    - `maybeRun()`：编排入口，返回 outcome 或 null（null 时调用方走单 Agent 路径）
    - `plan()`：Haiku 把目标拆为结构化子任务 `{id, description, dependsOn}`（`taskId: orchestrate-plan:<id>`），截断到 `maxSubtasks`，≤1 或解析失败则降级
    - `scheduleWaves()`：按 `dependsOn` 拓扑分波，波内有界并发（`maxParallel`）调用 `TaskExecutor`，依赖输出拼入依赖方 prompt
    - `synthesize()`：用户模型综合各子任务结果为最终回复（`taskId: orchestrate-synth:<id>`），失败降级为拼接输出
    - 编排前过 `CostGuard` 预算检查；每次 LLM 调用记入 `api_calls`，`/cost` 可见
  - `src/orchestration-types.ts`：`TaskExecutor` 接口 + `SubTask` / `SubAgentInput` / `SubAgentResult` 类型
  - `src/sub-agent-executor.ts`：`RunnerTaskExecutor` — 用现有 `IRunner` 执行子 Agent（基础工具、无 skills、no-op replyFn，天然禁止递归与系统命令）
  - `src/index.ts`：`GroupQueue` 执行器分支 — 命中编排走 `Orchestrator`，否则保持单 Agent 路径；抽出公共收尾（任务完成 / 回复 / 记忆/图谱提取）共用
  - `src/config.ts`：新增 `orchestration` 配置段（`enabled` 默认 true、`maxSubtasks` 默认 5、`maxParallel` 默认 3）+ `VIGILCLAW_ORCHESTRATION_*` 环境变量
  - `.env.example`：补充多 Agent 编排配置说明
  - 单元测试：`tests/unit/orchestrator.test.ts`（19 个 — 分类/拆解/波次并发/依赖注入/截断/降级/预算/计费），总计 293 tests 通过
  - OpenSpec 规范：新增 `multi-agent-orchestration` capability spec
  - **Phase 2 P1/P2/P3 全部交付 — Phase 2 功能完成**

- **Phase 2 P3: 知识图谱记忆（Knowledge Graph Memory）** — 在自由文本向量记忆之上增加结构化实体-关系图谱层，零新增生产依赖
  - `src/knowledge-graph-store.ts`：`KnowledgeGraphStore` 类
    - `extractTriples()`：Haiku 从对话提取 `(subject, predicate, object)` 三元组（JSON 输出，解析失败按空降级），实体去重后写入图谱；成本记入 `api_calls`（`taskId: kg-extract:<scope>`）
    - `recall()`：两段式召回 — 种子实体定位（实体名向量近邻 + 查询字面匹配）→ 有界图谱遍历（`maxHops` 跳、双向扩展、`maxFacts` 上界）→ 返回 `subject predicate object` 事实
    - 实体去重：规范化名精确匹配 + sqlite-vec 实体名向量软合并（相似度 ≥ 0.9）
    - 优雅降级：sqlite-vec 不可用时退化为纯字面匹配，关系存储/遍历照常；`enabled: false` 完全跳过
  - `src/db.ts`：迁移 v4 — `kg_entities`（实体，`scope_key` 隔离 + 规范化名唯一索引 + `mentions` 计数）、`kg_relations`（三元组，`ON DELETE CASCADE` + 三元组唯一约束）；sqlite-vec 可用时创建 `vec_kg_entities` 虚拟表（实体名向量）
    - 新增 DAL：`upsertEntity()` / `touchEntity()` / `getEntityById()` / `listEntitiesByScope()` / `insertEntityVector()` / `searchEntityVectors()` / `insertRelation()`（`INSERT OR IGNORE` 去重）/ `getRelationsForEntities()`（JOIN 实体名，双向）
    - 导出 `normalizeEntityName()` 工具函数
    - `cleanupOldData()` 扩展：清理超 365 天的关系 + 删除清理后无任何关系的孤立实体（及其向量）
  - `src/session-manager.ts`：`setKnowledgeGraphStore()` + `getContext()` 在 `[Relevant Memories]` 之后追加注入 `[Knowledge Graph]` 系统消息（空召回不注入）
  - `src/index.ts`：初始化 `KnowledgeGraphStore`（复用 `embedder` + `summaryProvider`），对话回复后与 `extractMemory` 并列异步触发 `extractTriples`
  - `src/config.ts`：新增 `knowledgeGraph` 配置段（`enabled` 默认 true、`maxHops` 默认 1、`maxFacts` 默认 10、`entitySimilarityThreshold` 默认 0.5、`retentionDays` 默认 365）+ `VIGILCLAW_KG_ENABLED` / `VIGILCLAW_KG_MAX_HOPS` / `VIGILCLAW_KG_MAX_FACTS` 环境变量
  - `.env.example`：补充知识图谱记忆配置说明
  - 单元测试：`tests/unit/knowledge-graph-store.test.ts`（16 个）+ `tests/unit/db.test.ts` 图谱用例（6 个），总计 274 tests 通过
  - OpenSpec 规范：新增 `knowledge-graph-memory` capability spec + `persistent-memory` MODIFIED delta（注入序列）

- **Phase 2 P2: Web Dashboard** — 内嵌式管理界面，htmx + Pico CSS（CDN），零新依赖
  - `src/dashboard-auth.ts`：Token 生成（SHA-256 from masterKey）+ 认证检查（Bearer header / query param）
  - `src/dashboard-server.ts`：Dashboard 路由处理器，支持全页渲染和 htmx 片段交换
    - `GET /`：完整 Dashboard 页面（含 Overview 数据 + 30 秒自动刷新）
    - `GET /api/overview`：概览片段（今日/本月费用、调用次数、任务数 + 模型消耗明细 + 健康状态）
    - `GET /api/tasks`：任务列表（分页）+ 定时任务管理
    - `GET /api/system`：Skill 列表 + 安全事件（分页）+ 凭证状态
    - `POST /api/schedules/:id/toggle`：定时任务启停切换
    - `DELETE /api/schedules/:id`：删除定时任务
    - `POST /api/skills/:name/toggle`：Skill 启停切换
    - `GET /api/schedules` / `GET /api/skills` / `GET /api/credentials`：独立片段端点
  - `src/dashboard-views.ts`：HTML 模板函数（renderPage / renderOverview / renderTasks / renderSystem + 行级片段）
  - `src/db.ts`：新增 7 个 Dashboard 查询方法 + 3 个管理员级操作方法
    - `getOverviewStats()` / `getDailyCosts()` / `getTasksPaginated()` / `getSecurityEventsPaginated()`
    - `listCredentialStatus()` / `getAllScheduledTasks()` / `getModelBreakdownToday()`
    - `adminToggleScheduledTask()` / `adminDeleteScheduledTask()` / `getScheduledTaskById()`
  - `src/config.ts`：新增 `dashboardEnabled` 配置（默认 true）+ `VIGILCLAW_DASHBOARD_ENABLED` 环境变量
  - `src/health.ts`：扩展支持可选 dashboardHandler 参数、Docker 可选（null）、导出 HealthChecks / checkSqlite / checkDocker
  - `src/index.ts`：初始化 Dashboard handler + local 模式也启动 Health server（Docker 检查跳过）
  - `tests/unit/dashboard-auth.test.ts`：认证模块测试（9 个用例）
  - `tests/unit/dashboard-server.test.ts`：路由+API 集成测试（17 个用例）
  - `tests/unit/db.test.ts`：扩展 Dashboard 查询方法测试（16 个用例）

- **Phase 2 P3: 一键部署基础设施** — Docker Compose 生产部署 + CI/CD + 运维脚本
  - `Dockerfile`：宿主进程多阶段构建（deps → build → runtime），Alpine 基础镜像，非 root 用户运行
  - `.dockerignore`：优化镜像体积，排除测试/文档/开发工具
  - `docker-compose.yml` 增强：env_file 加载、healthcheck（curl /health）、安全加固（read_only + tmpfs noexec）、模型缓存卷（HF_HOME 持久化）
  - `.github/workflows/ci.yml`：GitHub Actions CI 工作流 — lint + typecheck + test + Docker 镜像构建（Buildx + GHA cache）
  - `deploy/vigilclaw.service`：systemd 服务文件（docker compose 管理）
  - `scripts/setup.sh`：一键初始化向导（环境检测 + 配置生成 + Master Key 自动生成 + 依赖安装 + Docker 镜像构建）
  - `scripts/upgrade.sh`：升级脚本（数据库备份 + 代码拉取 + 依赖更新 + 镜像重建 + 服务重启）
  - `package.json`：新增 `docker:build:host` 和 `docker:build:all` scripts
  - `src/health.ts`：Health server 支持配置绑定地址（`healthHost`，默认 `0.0.0.0`，容器内需要）
  - `src/config.ts`：新增 `VIGILCLAW_HEALTH_HOST` 环境变量映射

- **文档: 技术方案第五篇 — 持久化记忆系统** (`docs/architecture/技术方案-第五篇-持久化记忆系统.md`)
  - 三层记忆架构设计（短期/中期/长期）、向量语义检索、上下文压缩、成本控制、优雅降级

### Fixed

- **Telegram Bot 代理支持** — 修复在需要代理的网络环境下 Bot 无法 polling、消息无响应的问题
  - `src/channels/telegram.ts`：检测 `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` 环境变量，通过 `https-proxy-agent` 为 grammY（node-fetch）注入代理 agent（`baseFetchConfig.agent`）
  - `src/channels/telegram.ts`：`bot.start()` 改为显式 `.catch()` 捕获启动错误，防止 polling 失败被静默丢弃
  - 新增依赖：`https-proxy-agent`

### Changed

- `docs/planning/ROADMAP.md`：MVP 验收标准更新 — 凭证零信任确认、代码量标准从 5K 调整为 10K 行

- **Phase 2 P2: Web Search Bridge** — 为容器内 Agent 提供安全的互联网搜索和页面抓取能力
  - `src/search-bridge.ts`：SearchBridge 类 — per-task HTTP 桥接服务，按需启动/销毁
    - `GET /search` 端点：代理 Brave Search API，返回格式化 Markdown 列表（标题 + URL + 描述 + extra snippets）
    - `POST /fetch` 端点：抓取 URL → HTML→Markdown（`node-html-markdown`）→ Claude Haiku 摘要 → `[Source: <url>]\n\n<摘要>` 格式
    - 私有 IP 拦截：RFC1918 + link-local 地址校验，拒绝并写入 `security_events` 表
    - Brave API Key 双渠道管理：环境变量 `BRAVE_SEARCH_API_KEY` 优先，回退到 DB credentials（`/setkey brave-search`）
    - LocalRunner 模式：直接函数调用接口（不启 HTTP 服务器）
  - `src/skills/web-search-stub.ts`：动态生成 skill stub，注入 `SEARCH_BRIDGE_URL`
    - `web_search` 工具：`{ query: string, count?: number }` → GET `/search`
    - `web_fetch` 工具：`{ url: string, prompt?: string }` → POST `/fetch`
  - `src/container-runner.ts` + `src/apple-container-runner.ts`：集成 SearchBridge
    - 检测到 `web-search` skill 时启动 SearchBridge，动态写入 stub 到 `<ipcDir>/web-search-stub/`
    - codePath 重写为 `/ipc/web-search-stub`，通过 `/ipc:rw` 挂载读取
    - 任务结束后销毁 SearchBridge，释放端口
  - `src/local-runner.ts`：LocalRunner 模式集成，直接函数调用
  - `src/config.ts`：新增 `BRAVE_SEARCH_API_KEY` 环境变量读取
  - `src/router.ts`：`/setkey` 命令支持 `brave-search` key name
  - 新增依赖：`node-html-markdown`（生产依赖 11 → 12）
  - 单元测试：`tests/unit/search-bridge.test.ts`（25 个新增测试），总计 221 tests
  - OpenSpec 规范：新增 2 个 capability specs（`web-search-bridge` + `web-search-skill`）
  - E2E 测试文档：`docs/E2E_TEST_WEB_SEARCH.md`

- **Phase 2 P2: 自然语言命令（NL Command Bridge）**
  - `src/command-bridge.ts`：CommandBridge 类 — per-task HTTP 桥接服务，类比 CredentialProxy
    - 14 条系统路由：`/system/schedule/{list,create,remove,enable,disable}`、`/system/skill/{list,install,remove,enable,disable}`、`/system/model/switch`、`/system/budget/{check,set}`、`/system/context/clear`
    - 基于绑定 userId 的 Admin 权限校验（复用 adminUsers 配置）
    - `generateStubJs()`：生成 CJS stub 文件，占位符替换 TASK_ID/USER_ID/GROUP_ID
    - `getSystemCommandsSkillInfo()`：返回 14 个系统工具定义，由 Router 自动注入每个任务
  - `src/system-commands-stub/`：skill 参考文件（skill.json + index.js 模板）
  - `src/router.ts`：自动将 system-commands skill 注入所有非命令任务（无需用户显式启用）
  - `src/container-runner.ts` + `src/apple-container-runner.ts`：
    - `setCommandBridge()` 方法接收桥接实例
    - 任务启动时创建 per-task bridge 端口，stub 写入 `<ipcDir>/system-commands-stub/`，codePath 重写为 `/ipc/system-commands-stub`（通过 `/ipc:rw` 挂载，无需额外 bind mount）
    - 注入 `COMMAND_BRIDGE_URL` 环境变量，任务结束后清理桥接
  - `src/index.ts`：初始化 CommandBridge 并关联到容器运行时
  - `container/agent-runner/src/tools/index.ts`：`loadSkillTools()` 扩展支持 `codePath` 字段
  - `container/agent-runner/Dockerfile`：新增 `/skills` 目录（确保 bind mount 路径存在）
  - 单元测试：`tests/unit/command-bridge.test.ts`（25 个新增测试），总计 196 tests
  - 踩坑记录：`docs/devlog/004-CommandBridge集成踩坑记录.md`

- **Phase 2 P2: 飞书 & 钉钉渠道接入**
  - `src/channels/message-utils.ts`：公共 `splitMessage()` 函数，供所有渠道共用
  - `src/channels/feishu.ts`：飞书渠道（`@larksuiteoapi/node-sdk` WSClient 长连接，无需公网 IP）
    - Post 富文本发送 + 自动降级纯文本、图片上传（`im.image.create`）+ 降级
    - `markdownToPost()`：简易 Markdown → 飞书 Post 富文本转换（粗体/代码/链接）
    - 消息去重（Set）、群聊 @mention 自动剥离、用户/群组白名单
    - 用户 ID 格式：`feishu:{open_id}`，群组：`feishu:group:{chat_id}`
  - `src/channels/dingtalk.ts`：钉钉渠道（零第三方 SDK，Node.js 22 内建 WebSocket + fetch）
    - Stream 长连接：`getAccessToken()` → `registerStream()` → WebSocket
    - Access Token 缓存 + 过期前 60s 自动刷新
    - WebSocket 断线自动重连（5s 延迟）、心跳 SYSTEM 消息 ACK
    - Markdown 消息 → 降级纯文本，群聊 `groupMessages/send`，单聊 `oToMessages/batchSend`
    - `cooldownMs` 参数防限流（默认 100ms）
    - 用户 ID 格式：`dingtalk:{staffId}`，群组：`dingtalk:group:{conversationId}`
  - `src/config.ts`：新增 `FeishuConfigSchema` + `DingTalkConfigSchema` + 7 个环境变量映射
  - `src/index.ts`：多渠道管理员统一收集 + 飞书/钉钉条件注册 + 启动日志扩展
  - `src/logger.ts`：redact 新增 `appSecret`、`encryptKey`、`verificationToken` 等敏感字段
  - 新增依赖：`@larksuiteoapi/node-sdk@1.59.0`（生产依赖 10 → 11，远低于 50 上限）
  - 单元测试：35 个新增测试（feishu-channel 20 + dingtalk-channel 15），总计 158 tests

### Changed

- `src/channels/telegram.ts`：提取 `splitMessage` 到 `message-utils.ts`，改为导入

- **Phase 2: Apple Container 支持** — macOS 原生容器运行时
  - `src/runner-types.ts`：IRunner 接口（ContainerRunner/AppleContainerRunner/LocalRunner 共用）
  - `src/apple-container-runner.ts`：通过 `container` CLI 管理容器生命周期，VM 级隔离
  - 运行时自动选择：Apple Container → Docker → Local（优先级链）
  - 配置 `container.runtime`：auto/docker/apple/local
  - `host.container.internal` 宿主访问（vs Docker 的 `host.docker.internal`）
  - `pnpm apple:build` 构建脚本（OCI 镜像兼容，同一 Dockerfile）
  - 亚秒级容器启动（200-400ms vs Docker 1.5-3s），MB 级内存开销
  - 需要 macOS 26+ Apple Silicon

### Added

- **Phase 2: Skill 系统** — 用户可扩展 Agent 工具能力
  - `src/skill-types.ts`：SkillManifest/SkillInfo/SkillPermission 类型定义
  - `src/skill-registry.ts`：Skill 注册表（安装/卸载/启用/禁用/版本管理/冲突检测）
  - `src/skill-permissions.ts`：声明式权限校验 + 审计日志
  - 容器集成：Skill 代码通过只读卷挂载到 `/skills/`，容器内 `loadSkillTools()` 动态加载
  - Telegram /skill 命令：list/install/remove/enable/disable/info（admin 限制）
  - IPC 扩展：TaskInput.skills 字段携带 Skill 定义和代码路径
  - DB 迁移 v3：`skills` 表
  - 示例 Skill：`examples/skills/web-search/`（stub 实现）
  - 调研文档：`docs/research/AI-Agent-Skill系统调研.md`（803 行，5 个方案 + 4 种沙箱）
  - `src/provider/openai.ts`：OpenAIProvider（GPT-4o / GPT-4o-mini / o4-mini），完整工具格式双向转换（Anthropic ↔ OpenAI）
  - `src/provider/ollama.ts`：OllamaProvider，复用 openai SDK 的 OpenAI 兼容 API（`baseURL: localhost:11434/v1`），成本 $0
  - `src/provider/factory.ts`：Provider 工厂 + `provider:model` 标识格式解析 + `getCheapModel()` 辅助
  - `src/model-router.ts`：基于消息长度/代码块的 simple/complex 任务分级路由
  - `/model` 命令支持 `provider:model` 格式（如 `openai:gpt-4o`、`ollama:llama3`），新增别名和 `/model list`
  - 模型选择持久化到数据库（`db.updateUserModel()`）
  - 容器内 react-loop 支持 Anthropic + OpenAI 双 SDK 分支
  - 新增依赖：`openai` SDK（同时覆盖 OpenAI 和 Ollama）
  - 新增配置段：`provider.openai`、`provider.ollama`、`routing.*`
  - 94 tests passing（新增 19 个测试：openai-provider 6 + ollama-provider 5 + model-router 8）

### Changed

- `src/local-runner.ts`：从硬编码 Anthropic SDK 重构为通过 Provider 工厂动态实例化
- `src/index.ts`：cost recording 使用实际 provider 而非硬编码 `'anthropic'`
- `src/context-compressor.ts`：接收 `IProvider` 而非 `ClaudeProvider`，使用 `provider.estimateCost()`
- `src/memory-store.ts`：同上，provider 抽象化
- `src/types.ts`：`QueuedTask` 和 `TaskInput` 新增 `provider` 字段
- `src/router.ts`：集成 ModelRouter，`/model` 命令扩展
- `container/agent-runner/src/react-loop.ts`：支持 OpenAI + Anthropic 双 SDK

- **Phase 2: 上下文压缩** (`src/context-compressor.ts`)
  - 基于 token 预算的智能上下文压缩（默认 6000 tokens 触发）
  - 增量摘要策略：旧消息用 Haiku 模型生成滚动摘要，保留最近 6 条完整消息
  - 字符估算 token 计数（`Math.ceil(text.length / 4)`），零 API 成本
  - 摘要持久化到 `context_summaries` 表，进程重启后恢复
  - 降级逻辑：摘要 API 失败时回退到简单截断
- **Phase 2: 持久化记忆** (`src/memory-store.ts` + `src/embedder.ts`)
  - 基于 sqlite-vec 的向量相似度搜索，跨会话记忆召回
  - 本地嵌入生成：`@huggingface/transformers` + `all-MiniLM-L6-v2` (384 维)，零 API 成本
  - 对话结束后用 Haiku 模型异步提取值得记忆的事实
  - 新对话开始时按语义相似度召回相关记忆注入上下文
  - 用户/群组级别记忆隔离
  - 降级逻辑：sqlite-vec 或嵌入模型不可用时静默禁用
- 数据库迁移 v2：新增 `context_summaries`、`memories` 表 + `vec_memories` 虚拟表
- 配置扩展：`session.maxContextTokens`、`session.recentMessagesKeep`、`memory.*` 配置项
- 环境变量：`VIGILCLAW_MAX_CONTEXT_TOKENS`、`VIGILCLAW_RECENT_MESSAGES_KEEP`、`VIGILCLAW_MEMORY_ENABLED`
- 新增依赖：`sqlite-vec` (向量搜索扩展)、`@huggingface/transformers` (本地嵌入)
- 单元测试：23 个新增测试（context-compressor 11 + memory-store 12），总计 75 tests

### Changed

- `src/session-manager.ts`：`getContext()` 改为异步方法，集成压缩器和记忆召回
- `src/session-manager.ts`：`clearContext()` 同时清除 context_summaries
- `src/session-manager.ts`：默认 contextLength 从 20 改为 50（给压缩器更多原始消息）
- `src/db.ts`：加载 sqlite-vec 扩展（带降级），新增 `vecAvailable` 标志
- `src/db.ts`：`cleanupOldData()` 新增清理过期记忆数据
- `src/db.ts`：使用 `createRequire` 加载 sqlite-vec（兼容 ESM 运行环境）
- `src/index.ts`：初始化链新增 Embedder、ContextCompressor、MemoryStore 模块
- `src/index.ts`：任务完成后异步触发记忆提取
- `src/provider/claude.ts`：`buildSystemPrompt()` 自动提取 messages 中的 system 消息合并到 system prompt（支持摘要/记忆注入）
- `src/local-runner.ts`：同上，从 task.messages 中提取 system 消息合并到 system prompt
- `container/agent-runner/src/react-loop.ts`：同上，从 taskInput.messages 中提取 system 消息合并到 system prompt

### Fixed

- **SearchBridge：Brave Search API 超时问题** — 在某些网络环境下（特别是 Apple Container 运行时），Brave Search API 调用在 10 秒超时限制内无法完成。将 `FETCH_TIMEOUT_MS` 从 10 秒增加到 30 秒，解决超时问题。E2E 测试通过。
- **Memory/Context 模块：Haiku 模型版本不兼容** — `memory-store.ts` 和 `context-compressor.ts` 使用旧版本 `claude-haiku-3-5-20250929`，DeepSeek Anthropic API 代理不支持该模型，导致 500 错误。统一更新为 `claude-haiku-4-5-20251001`，与 `search-bridge.ts` 保持一致。
- **CommandBridge / Apple Container：system-commands stub 挂载方案切换** — 原方案将 stub 挂载到 `/skills/system-commands:ro`，在 Apple Container（VM 型运行时）上与 `/skills:ro` 父挂载冲突，报错 "The volume is read only"（NSCocoaErrorDomain Code=642）。新方案：stub 写入 `<ipcDir>/system-commands-stub/`，TaskInput 中 codePath 重写为 `/ipc/system-commands-stub`，通过已有的 `/ipc:rw` 挂载读取，无需额外 bind mount，消除冲突。E2E 验证通过：Agent 收到自然语言请求后正确调用 `system_schedule_create` 等系统工具。

- 摘要和记忆提取的 Haiku API 调用成本未被追踪 — 现在记录到 `api_calls` 表，`/cost` 命令可见
- system role 消息（摘要/记忆）被 Claude provider 和 runner 过滤掉，LLM 完全看不到注入的上下文 — 现在自动合并到 system prompt
- sqlite-vec 在 ESM（tsx）运行环境下 `require` 不可用 — 改用 `createRequire(import.meta.url)`
- `@xenova/transformers` 间接依赖 sharp 导致本地嵌入模型加载失败 — 迁移到 `@huggingface/transformers`（无 sharp 依赖）
- 记忆召回 similarity 计算公式错误（L2 距离误用为余弦距离）— 修正为 `1 - (distance² / 2)`
- 默认 similarity 阈值 0.7 对 all-MiniLM-L6-v2 模型过高 — 调整为 0.3

### Added

- 产品需求文档 (PRD) v1.0.0
- 技术方案文档 4 篇（架构设计、安全模型、数据模型、部署方案）
- 竞品调研报告 4 篇（OpenClaw 架构、用户痛点、轻量平替、NanoClaw 深度分析）
- 项目 ROADMAP 和文档结构规范
- **项目脚手架初始化 (Phase 0)**
  - `package.json`：7 个生产依赖 + 11 个开发依赖
  - TypeScript 配置：strict 模式 + Node16 模块
  - Vitest 配置：80% 覆盖率阈值 + 4 个占位测试
  - ESLint flat config + Prettier
  - 核心类型定义骨架：`IChannel`、`IProvider`、`ITool`、共享类型
  - Agent Runner 容器骨架 + Dockerfile（node:22-alpine 多阶段构建）
  - seccomp 安全配置文件
  - docker-compose.yml
  - CI 依赖检查脚本
  - 验证通过：`pnpm typecheck` ✅ / `pnpm test` ✅ (4/4) / `pnpm build` ✅
- **Phase 1 Week 1 基础设施模块**
  - `src/config.ts`：Zod 配置 Schema + 环境变量/配置文件双层加载器
  - `src/crypto.ts`：AES-256-GCM 加解密 + Master Key 自动生成
  - `src/db.ts`：SQLite 初始化 + Schema V1 (8张表/7索引) + 迁移系统 + 完整 DAL
  - `src/credential-proxy.ts`：Unix Socket HTTP 代理 + API Key 运行时注入
  - `src/container-runner.ts`：Dockerode 容器全生命周期（seccomp + CapDrop ALL + 只读rootfs）
  - `src/mount-security.ts`：卷挂载白名单校验（禁止路径 + 允许列表）
  - `src/ipc.ts`：文件系统 IPC 协议（任务输入/输出/消息注入/流式输出）
  - `src/rate-limiter.ts`：三级滑动窗口限流（用户/群组/全局）
  - `src/security-logger.ts`：安全审计日志
  - 单元测试：36 tests passed（config 4 + crypto 6 + db 15 + rate-limiter 7 + scaffold 4）
  - 验证通过：`pnpm typecheck` ✅ / `pnpm test` ✅ (36/36) / `pnpm build` ✅
- **Phase 1 Week 1 Day5-7: Agent Runtime + 编排 + 成本**
  - `src/provider/claude.ts`：Anthropic SDK 实现（chat + stream + estimateCost + 价格表）
  - `src/cost-guard.ts`：预算检查（日/月双级）+ 超限消息格式化
  - `src/session-manager.ts`：会话上下文管理（用户/群组独立）
  - `src/group-queue.ts`：并发任务队列（群组内串行、跨群组并行）
  - `src/task-scheduler.ts`：定时任务调度 + 延迟队列（解决 NanoClaw #830）
  - `container/agent-runner/`：完整 ReAct 循环实现
    - `react-loop.ts`：30 轮安全阀 + 工具调用循环 + 输出截断
    - `tools/bash.ts`：Shell 命令执行（120s 超时）
    - `tools/read.ts`：文件读取（行号 + 偏移/限制）
    - `tools/write.ts`：文件创建/覆盖
    - `tools/edit.ts`：精确字符串替换
  - 新增测试：cost-guard 6 + session-manager 5 + group-queue 5
  - 验证通过：`pnpm typecheck` ✅ / `pnpm test` ✅ (52/52) / `pnpm build` ✅
- **Phase 1 Week 2: 渠道 + 路由 + 编排器**
  - `src/channels/telegram.ts`：grammY Telegram Bot（polling/webhook 双模式 + 消息拆分）
  - `src/router.ts`：消息路由 + 命令处理（/cost /model /clear /budget /help）+ 费用报告格式化
  - `src/logger.ts`：pino 结构化日志 + 敏感信息自动脱敏
  - `src/health.ts`：/health 健康检查端点（SQLite + Docker 状态）
  - `src/index.ts`：入口编排器 — 全模块初始化链 + Graceful Shutdown + 定时清理
  - **Phase 1 全部模块代码完成（18 个宿主机模块 + 8 个容器模块）**
  - 验证通过：`pnpm typecheck` ✅ / `pnpm test` ✅ (52/52) / `pnpm build` ✅
- **Phase 1 E2E 联调（2026-03-12）**
  - 端到端测试通过：Telegram → Docker Container → Claude API → 回复
  - 本地模式测试通过：Telegram → LocalRunner → Claude API → 回复
  - `/setkey` 命令：支持 `anthropic`、`anthropic.base_url`、`anthropic.auth_token` 三种配置
  - 环境变量自动注入凭证：启动时从 `ANTHROPIC_*` 环境变量加密写入 SQLite

### Changed

- `src/credential-proxy.ts`：Unix Socket → TCP 随机端口（macOS Docker VM 不支持 Socket 共享）
  - Proxy 监听 `127.0.0.1:0`（随机端口），容器通过 `host.docker.internal:<port>` 访问
  - URL 拼接修复：`new URL(path, base)` → 字符串拼接（避免丢失路径前缀）
  - 支持自定义 base_url 和 auth_token（从 SQLite credentials 表动态解密）
- `src/container-runner.ts`：AutoRemove → 手动 remove + 容器退出日志捕获
  - seccomp profile 临时禁用（Node.js libuv 段错误，待 Linux 环境调优）
  - 容器退出后通过 `container.logs()` 获取日志再清理
- `src/channels/telegram.ts`：Markdown 发送失败自动降级纯文本
- `src/config.ts`：环境变量映射改为显式直接映射（修复下划线分隔歧义）
- `src/ipc.ts`：`path.join` → `path.resolve`（Docker 挂载要求绝对路径）
- `src/index.ts`：新增 LocalRunner 降级 + `VIGILCLAW_LOCAL_MODE` 开关 + 凭证自动 seed
- `container/agent-runner/src/react-loop.ts`：`CREDENTIAL_PROXY_URL` baseURL 直接使用
- 技术方案第二篇更新：网络隔离改为分环境策略（Linux 方案E / macOS 方案F）
- 技术方案总纲更新：新增 ADR-006 Apple Container 支持策略（Phase 3）

### Added (文档)

- `docs/devlog/001-容器模式联调踩坑记录.md`：7 个坑点 + 修复方案详细记录

<!--
## [0.1.0] - YYYY-MM-DD

### Added
- 新增的功能

### Changed
- 变更的功能

### Deprecated
- 即将移除的功能

### Removed
- 已移除的功能

### Fixed
- Bug 修复

### Security
- 安全相关修复
-->
