# VigilClaw 技术方案文档

## 文档元信息

| 属性     | 值                   |
| -------- | -------------------- |
| 文档版本 | v1.0.0               |
| 创建日期 | 2026-03-11           |
| 最后更新 | 2026-03-13           |
| 前置文档 | VigilClaw-PRD v1.0.0 |
| 状态     | ✅ 全部完成          |

---

## 文档编写计划

本技术方案分 **4 篇** 产出，每篇聚焦一个领域：

| 篇次       | 主题               | 核心内容                                               | 预计篇幅 |
| ---------- | ------------------ | ------------------------------------------------------ | -------- |
| **第一篇** | 整体架构与模块设计 | 系统分层、模块职责、核心接口定义、进程通信、目录结构   | 大       |
| **第二篇** | 安全模型与容器隔离 | 容器安全、网络策略、凭证管理、供应链安全、威胁模型验证 | 大       |
| **第三篇** | 数据模型与成本控制 | SQLite schema、加密方案、成本追踪、预算系统、模型路由  | 中       |
| **第四篇** | 部署方案与工程规范 | Docker Compose、CI/CD、测试策略、编码规范、依赖管控    | 中       |

---

## 第一篇：整体架构与模块设计

### 1.1 架构总览

#### 1.1.1 设计哲学与约束

- 双进程架构 (Host + Container) 的选择理由
- 与 NanoClaw/OpenClaw 架构的差异点
- 核心约束：代码量 <10,000 行、依赖 <50 个、启动 <3s

#### 1.1.2 系统分层架构图

- 用户接入层 (Channel)
- 控制平面 (Host Process)
- 执行平面 (Container)
- 数据持久层 (SQLite)
- 完整的系统架构图 (ASCII)

#### 1.1.3 进程职责划分

- 宿主机进程：消息路由、存储、凭证、调度、成本守护
- 容器进程：Agent 推理、工具执行
- 职责边界表（什么做、什么不做）

### 1.2 核心模块详细设计

#### 1.2.1 入口与编排器 (`src/index.ts`)

- 初始化流程（启动顺序、依赖注入）
- 主事件循环设计
- 优雅关闭机制 (Graceful Shutdown)

#### 1.2.2 配置系统 (`src/config.ts`)

- Zod Schema 定义（类型安全配置）
- 配置加载优先级：环境变量 > 配置文件 > 默认值
- 完整配置项清单及默认值
- 配置热更新策略

#### 1.2.3 消息路由器 (`src/router.ts`)

- 入站消息标准化流程
- 路由规则（用户/群组到 Agent 的映射）
- 消息触发条件判断
- 速率限制集成点

#### 1.2.4 会话管理器 (`src/session-manager.ts`)

- 会话生命周期（创建、活跃、空闲、过期）
- 上下文加载策略（最近 N 条消息）
- 会话与容器的关系
- 并发会话处理

#### 1.2.5 任务队列 (`src/group-queue.ts`)

- 群组级任务排队机制
- 并发控制（默认 max=5 容器）
- 优先级队列设计
- 背压处理 (Backpressure)

#### 1.2.6 任务调度器 (`src/task-scheduler.ts`)

- Cron 表达式解析与调度
- **延迟队列设计**（解决 NanoClaw #830 定时任务丢弃问题）
  - Session busy 时排队
  - 空闲时自动消费
  - 最大延迟 1 小时超时
  - 失败重试机制（最多 3 次）
- 调度持久化（重启不丢失）

#### 1.2.7 容器编排器 (`src/container-runner.ts`)

- 容器生命周期管理（创建 → 启动 → 监控 → 销毁）
- Dockerode API 使用方案
- 容器参数构建（安全配置、资源限制）
- 超时与异常处理
- 容器池策略（预热 vs 按需创建的权衡）

#### 1.2.8 IPC 通信层 (`src/ipc.ts`)

- 文件系统 IPC 协议设计
  - Task 输入格式 (`/ipc/task-{uuid}.json`)
  - Result 输出格式 (`/ipc/result-{uuid}.json`)
  - 流式输出标记 (START_MARKER / END_MARKER)
- 文件系统监控 (fs.watch / chokidar)
- 消息 Piping（运行中注入新消息）
- IPC 超时与清理

#### 1.2.9 容器内 Agent Runner (`container/agent-runner/`)

- Agent Runner 入口设计
- Claude Agent SDK `query()` 调用
- 工具注册与执行
- IPC 输入轮询（接收新消息）
- 流式输出写入
- 错误处理与退出码

### 1.3 渠道适配层

#### 1.3.1 渠道抽象接口 (`IChannel`)

- 接口定义（`start`, `stop`, `sendMessage`, `sendImage`, `onMessage`）
- 渠道生命周期管理
- 渠道注册工厂模式

#### 1.3.2 Telegram 渠道 (`src/channels/telegram.ts`)

- grammY 集成方案
- Webhook vs Long-Polling 选型（MVP 用 Long-Polling，生产建议 Webhook）
- 消息类型处理（文本、图片、命令）
- Bot 命令注册（`/cost`, `/model`, `/clear`, `/help`）
- 速率限制与错误重试
- 群组消息 vs 私聊消息处理

#### 1.3.3 渠道扩展机制

- 新增渠道的步骤与规范
- Phase 2 渠道预留（WhatsApp Business API, Web）

### 1.4 Provider 抽象层

#### 1.4.1 Provider 接口定义 (`IProvider`)

- `chat()` — 同步完整响应
- `stream()` — 流式响应 (AsyncGenerator)
- `tools()` — 工具定义列表
- `estimateCost()` — 费用估算
- 统一的 `ChatParams` / `ChatResponse` / `ChatChunk` 类型

#### 1.4.2 Claude Provider (`src/provider/claude.ts`)

- @anthropic-ai/sdk 直接使用 vs Claude Agent SDK
  - **决策：MVP 使用 Anthropic SDK 直接调用**，不依赖 Claude Agent SDK
  - 理由：Agent SDK 的 `query()` API 生命周期限制（NanoClaw #684）、黑盒行为
  - 自行实现 ReAct 循环，获得完全控制
- 流式响应处理
- 工具调用解析
- 错误处理（API 限流、网络超时）

#### 1.4.3 多模型路由预留 (Phase 2)

- OpenAI Provider 接口预留
- 路由规则引擎设计思路
- 模型选择策略（简单任务 → Haiku，复杂任务 → Sonnet）

### 1.5 工具系统

#### 1.5.1 工具抽象接口 (`ITool`)

- `name`, `description`, `schema` (JSON Schema)
- `execute(params)` → `ToolResult`

#### 1.5.2 内置工具实现

- **BashTool**: Shell 命令执行，超时控制 (默认 120s)，输出截断
- **ReadTool**: 文件读取，偏移/行数限制
- **WriteTool**: 文件创建/覆盖
- **EditTool**: 精确字符串替换 (oldString/newString)

#### 1.5.3 工具安全约束

- 所有工具在容器内执行（隔离边界）
- 工具白名单机制
- 输出大小限制

### 1.6 模块依赖关系图

- 模块间引用关系 DAG
- 初始化顺序
- 关键依赖路径

---

## 第二篇：安全模型与容器隔离

### 2.1 威胁模型

#### 2.1.1 攻击面分析

- Prompt Injection → Agent 生成恶意代码
- 容器逃逸尝试
- 网络数据外泄
- API Key 窃取
- 供应链攻击 (npm 依赖投毒)
- DDoS / 消息洪水

#### 2.1.2 信任边界定义

- 宿主机进程：可信区域
- 容器进程：**不可信区域**（假设 Agent 可能被 Prompt Injection 控制）
- 外部网络：不可信

#### 2.1.3 安全目标

- 容器内恶意行为无法影响宿主机
- API Key 永远不以明文形式存在于容器内
- 容器网络仅允许出站到白名单域名
- 所有安全事件可审计

### 2.2 容器隔离方案

#### 2.2.1 Docker 安全配置

- `--security-opt=no-new-privileges`
- `--read-only` 文件系统 (除 `/tmp` 和 `/workspace`)
- 禁用特权容器 (`--privileged=false`)
- 用户命名空间映射
- Seccomp Profile 设计
- AppArmor Profile 设计 (可选)
- 资源限制 (`--memory`, `--cpus`, `--pids-limit`)

#### 2.2.2 卷挂载安全

- 挂载白名单校验 (`mount-security.ts`)
- 工作目录挂载 (RW) — 仅用户指定目录
- IPC 目录挂载 — 通信通道
- 禁止挂载宿主机敏感路径 (`/etc`, `/var`, `~/.ssh` 等)

#### 2.2.3 容器镜像安全

- 最小化基础镜像选择 (node:22-alpine vs node:22-slim)
- 多阶段构建减少攻击面
- 非 root 用户运行
- 镜像签名验证 (可选)

### 2.3 网络安全策略

#### 2.3.1 网络隔离方案（重点差异化）

- Docker 自定义 bridge 网络
- **方案对比**：
  - 方案 A：iptables 规则直接控制（宿主机级）
  - 方案 B：DNS 限制 + 透明代理（应用级）
  - 方案 C：Docker network policy + iptables 组合（推荐）
- 推荐方案详细设计

#### 2.3.2 出站白名单

- 默认白名单域名：
  - `api.anthropic.com:443`
  - `api.openai.com:443` (Phase 2)
  - `generativelanguage.googleapis.com:443` (Phase 2)
- 白名单配置文件格式
- DNS 解析限制（防止 IP 直连绕过）

#### 2.3.3 内网访问阻断

- 阻断 RFC 1918 私有地址段 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- 阻断 localhost (`127.0.0.0/8`)
- 阻断 link-local (`169.254.0.0/16`)
- 阻断 IPv6 本地地址

#### 2.3.4 网络策略初始化脚本

- 容器启动时自动配置网络规则
- 规则验证（自动化测试）
- 规则清理（容器销毁时）

### 2.4 凭证安全管理

#### 2.4.1 Credential Proxy 架构

- HTTP 代理服务器设计
- 请求拦截与凭证注入流程
- 容器 → Unix Socket → Credential Proxy → LLM API
- 临时 Token 机制（15 分钟有效期）

#### 2.4.2 凭证存储加密

- AES-256-GCM 加密方案
- Master Key 管理（环境变量 `MASTER_KEY`）
- 首次启动自动生成
- 每个凭证独立 IV
- 加密/解密接口设计

#### 2.4.3 凭证轮换

- 无需重启容器的 Key 轮换方案
- 轮换触发方式（手动命令 / 定期自动）

### 2.5 速率限制

#### 2.5.1 多级限流设计

- 用户级：10 条/分钟
- 群组级：30 条/分钟
- 全局级：100 条/分钟
- 实现方案：滑动窗口算法（内存 + SQLite 持久化）

#### 2.5.2 限流响应

- 429 状态码 + 友好提示
- Retry-After 信息

### 2.6 安全审计日志

#### 2.6.1 安全事件类型

- `container_escape_attempt`
- `network_violation`
- `credential_access`
- `rate_limit_exceeded`
- `mount_violation`

#### 2.6.2 日志存储与查询

- SQLite `security_events` 表
- 事件严重级别
- 日志保留策略

### 2.7 供应链安全

#### 2.7.1 依赖管控

- pnpm strict lockfile
- 依赖准入审查流程
- CI 自动 `pnpm audit`
- 依赖数量监控 (<50 个)

#### 2.7.2 容器镜像供应链

- 基础镜像固定版本
- 定期安全扫描 (trivy / snyk)

---

## 第三篇：数据模型与成本控制

### 3.1 SQLite 设计方案

#### 3.1.1 better-sqlite3 使用规范

- 同步 API 的优势与适用场景
- WAL 模式配置
- 连接池策略（单实例单连接）
- 性能调优参数 (`PRAGMA` 设置)

#### 3.1.2 完整表结构设计

- `users` — 用户与配置
- `messages` — 消息历史
- `api_calls` — API 调用记录
- `tasks` — 任务状态
- `credentials` — 加密凭证
- `security_events` — 安全审计
- `scheduled_tasks` — 定时任务
- `settings` — 全局设置

#### 3.1.3 索引设计

- 高频查询索引
- 复合索引优化
- 索引大小控制

#### 3.1.4 数据库迁移方案

- 版本化迁移脚本
- 自动迁移执行（启动时检查）
- 回滚策略

#### 3.1.5 数据加密

- 字段级加密 (credentials 表)
- AES-256-GCM 实现细节
- Master Key 派生与管理

### 3.2 成本追踪系统

#### 3.2.1 API 调用记录

- 每次调用记录：模型、token、费用、用户、任务关联
- 实时费用计算公式
- 价格表管理（内置 + 可配置覆盖）

#### 3.2.2 成本聚合查询

- 按用户/群组聚合
- 按日/月聚合
- Top N 高消耗任务
- SQL 查询优化

#### 3.2.3 成本可视化命令

- `/cost` 命令格式设计
- 详细分解输出
- 趋势警告

### 3.3 预算控制系统

#### 3.3.1 预算层级

- 单次任务预算 (`max_cost_per_task`)
- 每日预算 (`max_cost_per_day`)
- 每月预算 (`max_cost_per_month`)

#### 3.3.2 预算检查流程

- 任务启动前检查（预估费用 + 已消耗）
- 任务执行中检查（实际消耗超限中断）
- 超限处理（拒绝 + 友好提示）

#### 3.3.3 预算重置

- 自动重置（日/月周期）
- 手动重置（管理员命令 `/reset-budget`）
- 重置时间可配置

### 3.4 模型路由策略 (Phase 2 预留)

#### 3.4.1 路由规则引擎

- 基于任务特征的路由（工具调用数、输入长度）
- YAML 配置格式
- 默认路由规则

#### 3.4.2 成本节省估算

- Haiku vs Sonnet 混合使用
- 预期节省比例

---

## 第四篇：部署方案与工程规范

### 4.1 项目脚手架

#### 4.1.1 目录结构

- 完整目录树（`src/`, `container/`, `docs/`, `tests/`）
- 文件命名规范
- 模块组织原则

#### 4.1.2 TypeScript 配置

- `tsconfig.json` 严格模式
- Path aliases
- 输出格式 (ESM vs CJS)

#### 4.1.3 代码风格

- ESLint 配置（基于 `@typescript-eslint/recommended`）
- Prettier 配置
- 命名规范

### 4.2 依赖管理

#### 4.2.1 生产依赖清单 (MVP)

- 完整的 MVP 依赖列表及选型理由
- 每个依赖的大小和安全性评估
- 依赖数量预算 (<50)

#### 4.2.2 开发依赖清单

- 测试、lint、构建工具

#### 4.2.3 依赖治理

- 新增依赖审批流程
- 定期审计策略
- 替代方案评估标准

### 4.3 测试策略

#### 4.3.1 单元测试

- Vitest 配置
- 模块级覆盖要求 (>80%)
- Mock 策略（Docker API、SQLite、Telegram API）

#### 4.3.2 集成测试

- IPC 通信测试
- 容器生命周期测试
- Credential Proxy 测试

#### 4.3.3 E2E 测试

- Telegram → Container → Claude → 回复 全链路
- 安全测试（网络隔离验证、凭证不泄露）
- 成本追踪准确性

#### 4.3.4 安全测试

- 容器逃逸测试
- 网络隔离验证脚本
- 凭证泄露检测

### 4.4 Docker 部署方案

#### 4.4.1 Docker Compose 设计

- 服务定义（host-process, agent-container-base）
- 网络配置
- 卷挂载配置
- 环境变量管理

#### 4.4.2 容器镜像构建

- 宿主机镜像 Dockerfile
- Agent Runner 镜像 Dockerfile
- 多阶段构建优化
- 镜像大小目标

#### 4.4.3 一键部署脚本

- `docker compose up -d` 流程
- 首次启动初始化（Master Key 生成、数据库创建）
- 环境检查（Docker 版本、端口占用）

### 4.5 CI/CD

#### 4.5.1 GitHub Actions

- Lint + Type Check
- Unit Test + Coverage
- `pnpm audit` 安全检查
- Docker 镜像构建测试
- 依赖数量检查

#### 4.5.2 发布流程

- 语义化版本 (SemVer)
- Changelog 自动生成
- Docker 镜像发布

### 4.6 日志与可观测

#### 4.6.1 日志方案

- pino 结构化 JSON 日志
- 日志级别管理
- 敏感信息自动脱敏（API Key 替换为 `***`）

#### 4.6.2 健康检查

- `/health` 端点设计
- 容器状态监控
- SQLite 连接检查

### 4.7 开发工作流

#### 4.7.1 本地开发环境

- Node.js 22+ (nvm)
- Docker Desktop
- pnpm 安装
- 开发模式启动（ts-node / tsx）

#### 4.7.2 热重载

- 宿主机进程热重载 (tsx --watch)
- Agent Runner 镜像重建

---

## 附录

### A. 技术选型决策记录 (ADR)

#### ADR-001: 为什么用 Anthropic SDK 而非 Claude Agent SDK

- 背景：NanoClaw 使用 Claude Agent SDK 的 `query()` API
- 问题：生命周期限制导致 Agent Swarms 无法工作、行为黑盒
- 决策：使用 `@anthropic-ai/sdk` 直接调用，自行实现 ReAct 循环
- 影响：需要自己管理工具调用循环，但获得完全控制

#### ADR-002: 为什么选 better-sqlite3 而非 drizzle-orm

- 背景：需要 SQLite ORM 或直接驱动
- 决策：MVP 直接使用 better-sqlite3，不引入 ORM
- 理由：减少依赖、直接控制 SQL、性能最优、代码量可控

#### ADR-003: 网络隔离分环境策略

- 背景：Docker 原生 network 不支持域名级白名单；macOS/Windows Docker 不支持 Unix Socket 卷挂载共享
- 决策：分环境策略
  - Linux 生产：方案 E — `NetworkMode: none` + Unix Socket（零网络攻击面）
  - macOS/Windows 开发：方案 F — TCP Credential Proxy + `host.docker.internal`
- 理由：方案 E 安全性最强但仅 Linux 可用（已实测 OrbStack 验证 macOS 下 Socket `ECONNREFUSED`）；方案 F 全平台兼容
- 影响：方案 F 下容器有网络能力，后续需叠加 iptables 限制出站

#### ADR-004: 为什么 MVP 选 Telegram 而非 WhatsApp

- 背景：NanoClaw/OpenClaw 以 WhatsApp 为主但 Baileys 极不稳定
- 决策：MVP 选 Telegram (grammY + 官方 Bot API)
- 理由：官方 API 稳定、无逆向工程风险、零断连

#### ADR-005: 为什么 IPC 用文件系统而非 WebSocket/gRPC

- 背景：宿主机与容器需要通信
- 决策：沿用 NanoClaw 的文件系统 IPC
- 理由：Docker 卷挂载天然支持、无需网络配置、简单可靠

#### ADR-006: Apple Container 支持策略（Phase 3）

- 背景：Apple 于 WWDC 2025 发布 `apple/container` 框架（基于 `Virtualization.framework`），每个容器是独立轻量 VM，安全性优于 Docker 的 namespace 隔离。NanoClaw 通过 Skill 分支合并实现了可选支持。
- 现状分析（基于 NanoClaw 源码实测）：
  - NanoClaw 默认运行时也是 Docker（`CONTAINER_RUNTIME_BIN = 'docker'`）
  - Apple Container 通过 `convert-to-apple-container` Skill 做代码级切换（合并 Git 分支替换 `container-runtime.ts`）
  - NanoClaw 能轻松切换是因为它用 `spawn(CLI)` 管理容器，不依赖编程 API
  - 两个运行时共用 TCP `host.docker.internal` 做 Credential Proxy 通信
- 决策：Phase 3 考虑支持，需要先抽象 `ContainerRuntime` 接口
- 前提条件：
  - 需要 macOS 26 (Tahoe) + Apple Silicon
  - 当前 v0.9.0，仍在快速迭代中（曾有 data integrity 问题）
  - 无 Node.js SDK，需通过 `child_process.spawn('container', [...])` 调用 CLI
- 实现方案：
  ```typescript
  interface ContainerRuntime {
    runTask(task: QueuedTask): Promise<TaskResult>;
    ping(): Promise<boolean>;
    drainAll(timeoutMs: number): Promise<void>;
  }
  class DockerRuntime implements ContainerRuntime { ... }          // 现有的 Dockerode 实现
  class AppleContainerRuntime implements ContainerRuntime { ... }  // 未来：spawn CLI
  ```
- 主要适配差异：
  - 挂载语法：`-v path:path:ro` → `--mount type=bind,source=...,target=...,readonly`
  - 不支持文件级挂载（只支持目录），需容器内 `mount --bind` 阴影 `.env`
  - 启动检查：`docker info` → `container system status`
  - 容器列表：`docker ps` → `container ls --format json`

#### ADR-007: 宿主机侧辅助 LLM 调用策略

- 背景：Phase 2 的上下文压缩和记忆提取需要调用 LLM（Haiku 模型做摘要和事实提取）。技术方案原始设计中宿主机进程"永远不直接调用 LLM API"。
- 决策：允许宿主机进程直接调用 LLM API，但仅限辅助任务（摘要、记忆提取），不涉及 Agent 推理。
- 理由：
  - 上下文压缩必须在宿主机侧进行（容器是临时的、任务结束即毁，无法跨任务维护摘要）
  - 记忆提取是异步后处理，发生在容器任务完成后
  - 宿主机是可信区域，直接调用 LLM 不违反安全模型（安全边界保护的是容器内不可信代码）
  - 辅助调用固定使用 Haiku 模型，成本可控（~$0.001/次），并记录到 api_calls 表
- 影响：宿主机进程职责表需更新，新增"通过辅助 Provider 调用 LLM（仅摘要和记忆提取）"

### B. 与 NanoClaw 的技术差异对照表

| 维度            | NanoClaw                               | VigilClaw                                           | 差异原因                     |
| --------------- | -------------------------------------- | --------------------------------------------------- | ---------------------------- |
| Agent SDK       | Claude Agent SDK `query()`             | Anthropic SDK 直接调用                              | 避免 SDK 生命周期限制        |
| 容器管理        | `spawn(CLI)` 调 Docker/Apple Container | Dockerode 编程 API (Phase 3: ContainerRuntime 抽象) | Dockerode 更精确控制生命周期 |
| 网络策略        | 无（完全敞开）                         | 分环境：Linux 零网络 + macOS TCP Proxy              | 核心安全差异化               |
| Apple Container | 可选 Skill 切换（代码级替换）          | Phase 3 规划（ContainerRuntime 接口）               | 先稳定 Docker                |
| 成本控制        | 无                                     | Cost Guard 模块                                     | 核心功能差异化               |
| 定时任务        | 静默丢弃                               | 延迟队列+重试                                       | 修复 NanoClaw #830           |
| 首选渠道        | WhatsApp (Baileys)                     | Telegram (grammY)                                   | 稳定性优先                   |
| 多模型          | Claude Only                            | Provider 抽象层                                     | 扩展性                       |
| Agent Swarms    | 已损坏                                 | 不做，预留接口                                      | 避免重蹈覆辙                 |

### C. MVP 依赖预算

| 类别     | 依赖                      | 用途         | 大小                 |
| -------- | ------------------------- | ------------ | -------------------- |
| 运行时   | better-sqlite3            | SQLite 驱动  | ~2MB (native)        |
| 运行时   | sqlite-vec                | 向量搜索     | ~1MB (native)        |
| 运行时   | @huggingface/transformers | 本地嵌入     | ~500KB (+80MB model) |
| 运行时   | @anthropic-ai/sdk         | Claude API   | ~200KB               |
| 运行时   | grammy                    | Telegram Bot | ~300KB               |
| 运行时   | dockerode                 | Docker API   | ~150KB               |
| 运行时   | pino                      | 日志         | ~200KB               |
| 运行时   | zod                       | Schema 校验  | ~60KB                |
| 运行时   | cron-parser               | Cron 表达式  | ~30KB                |
| 安全     | 内置 crypto               | AES-256-GCM  | 0 (Node.js 内置)     |
| **总计** | **~9 个生产依赖**         |              |                      |

> **注**：`uuid` 已移除，使用 `crypto.randomUUID()` 替代。

### D. 开发里程碑检查清单

#### Phase 0 (1-2 天)

- [ ] 本文档完成（4 篇全部产出）
- [ ] 项目脚手架初始化
- [ ] CI 配置
- [ ] Docker 镜像基础构建

#### Phase 1 Week 1 (基础设施)

- [ ] SQLite schema + 迁移
- [ ] 配置系统 (zod)
- [ ] Container Runner + Docker 安全配置
- [ ] 网络策略 (iptables)
- [ ] Credential Proxy
- [ ] IPC 通信层

#### Phase 1 Week 2 (功能联调)

- [ ] Agent Runner (容器内)
- [ ] Claude Provider (Anthropic SDK)
- [ ] Telegram Channel (grammY)
- [ ] 编排器 + 任务队列
- [ ] Cost Guard (成本追踪 + 预算)
- [ ] Task Scheduler (延迟队列)
- [ ] E2E 测试
- [ ] 部署文档

#### Phase 3（后续规划）

- [ ] ContainerRuntime 接口抽象（从 ContainerRunner 提取）
- [ ] Apple Container 运行时支持（macOS 26+ / Apple Silicon）
- [ ] Linux 环境 Unix Socket 方案 E 实现
- [ ] 自定义 seccomp profile 调优（需 Linux 环境 strace 验证）
- [ ] iptables 出站限制（方案 F 安全补偿）

---

**✅ 全部 4 篇已完成：**

- `技术方案-第一篇-整体架构与模块设计.md`
- `技术方案-第二篇-安全模型与容器隔离.md`
- `技术方案-第三篇-数据模型与成本控制.md`
- `技术方案-第四篇-部署方案与工程规范.md`

**下一步：启动 Phase 0（项目脚手架）。** → 查看 [ROADMAP](../planning/ROADMAP.md) 了解最新进度。
