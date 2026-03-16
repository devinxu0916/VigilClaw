# Changelog

本文件记录 VigilClaw 的所有版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

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
