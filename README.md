# VigilClaw

> 安全优先的个人 AI 助手 — 容器隔离 · 凭证零信任 · 成本可控

[![Node.js](https://img.shields.io/badge/Node.js-≥22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-≥9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

VigilClaw 是一个面向开发者的开源个人 AI 助手。通过消息渠道与 LLM 对话，Agent 在容器中安全执行，网络受限、凭证隔离、成本实时追踪。架构上支持多渠道、多模型扩展，目标做一个真正可信赖的轻量级 AI 助手。

---

## ✨ 核心特性

### 🔒 安全即默认

- **容器隔离** — Agent 在只读 rootfs Docker 容器中运行，`CAP_DROP ALL` + `no-new-privileges`
- **凭证零信任** — API Key 不进入容器，通过 Credential Proxy 运行时注入
- **网络受限** — 容器仅能访问 Credential Proxy，无法直连外网
- **卷挂载安全** — 自动拦截敏感路径 (`/etc`, `~/.ssh`, `~/.gnupg` 等) + 白名单机制
- **安全审计** — 所有安全事件（容器逃逸尝试、网络违规、凭证访问）持久化记录

### 💰 成本可控

- **多级预算** — 支持日预算、月预算独立设置，超限自动拦截
- **实时追踪** — `/cost` 命令查看费用报告（模型明细 + 高消耗任务排行）
- **用户隔离** — 多用户场景下按人独立计费

### ⚡ 轻量可审计

- **极简依赖** — 仅 7 个生产依赖，零供应链焦虑
- **代码精简** — 目标 5,000~10,000 行代码，开发者可完整理解系统
- **SQLite 本地存储** — 零外部数据库依赖，数据完全可控

### 🤖 功能完整

- **多模型切换** — 通过 `IProvider` 抽象支持多 LLM 后端，内置 Claude (Sonnet / Haiku / Opus)，可扩展 OpenAI、Ollama 等
- **多渠道接入** — 通过 `IChannel` 抽象支持多消息渠道，内置 Telegram，可扩展 Discord、Slack、Web 等
- **Agent 工具** — 容器内提供 Bash、Read、Write、Edit 四种工具
- **ReAct 循环** — 最多 30 轮工具调用，自动截断超长输出
- **定时任务** — Cron 调度 + 延迟队列，不丢失不重复
- **会话管理** — 用户/群组独立上下文，支持清空
- **本地降级** — Docker 不可用时自动切换本地模式

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────┐
│              Message Channel (IChannel)           │
│         Telegram · Discord · Slack · ...         │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│                   Host Process                    │
│                                                   │
│  ┌─────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ Router  │→ │ CostGuard │→ │  GroupQueue    │  │
│  │         │  │ (预算检查) │  │ (并发调度)     │  │
│  └─────────┘  └───────────┘  └───────┬───────┘  │
│                                       │          │
│  ┌──────────────┐  ┌─────────────────┐│          │
│  │RateLimiter   │  │SessionManager   ││          │
│  │(三级限流)     │  │(上下文管理)     ││          │
│  └──────────────┘  └─────────────────┘│          │
│                                       ▼          │
│  ┌────────────────────────────────────────────┐  │
│  │        ContainerRunner / LocalRunner        │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                          │
│  ┌────────────────────▼───────────────────────┐  │
│  │          Credential Proxy (TCP)             │  │
│  │     API Key 运行时注入 · 路径白名单         │  │
│  └────────────────────┬───────────────────────┘  │
└───────────────────────┼──────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │     Docker Container       │
          │  ┌──────────────────────┐  │
          │  │   Agent Runner       │  │
          │  │   (ReAct Loop)       │  │
          │  │                      │  │
          │  │  Tools:              │  │
          │  │  · bash · read       │  │
          │  │  · write · edit      │  │
          │  └──────────────────────┘  │
          │                            │
          │  ReadOnly rootfs           │
          │  CAP_DROP ALL              │
          │  no-new-privileges         │
          │  Memory/CPU/PID limits     │
          └────────────────────────────┘
```

**数据流**: 渠道消息 → Router 路由 → CostGuard 预算检查 → GroupQueue 并发调度 → ContainerRunner 启动容器 → Credential Proxy 注入凭证 → Agent ReAct 循环 → IPC 返回结果 → 渠道回复

---

## 🚀 快速开始

### 前置要求

- Node.js ≥ 22
- pnpm ≥ 9
- Docker (可选，不装则自动使用本地模式)
- 至少一个消息渠道的凭证 (如 [Telegram Bot Token](https://core.telegram.org/bots#how-do-i-create-a-bot))
- 至少一个 LLM Provider 的 API Key (如 [Anthropic API Key](https://console.anthropic.com/))

### 1. 克隆并安装

```bash
git clone https://github.com/your-username/VigilClaw.git
cd VigilClaw
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 必填
VIGILCLAW_MASTER_KEY=your-64-char-hex-key    # 64位十六进制字符 (32字节)

# 渠道配置 (至少启用一个)
VIGILCLAW_TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# LLM Provider (至少配置一个)
ANTHROPIC_API_KEY=sk-ant-your-api-key

# 可选
VIGILCLAW_LOG_LEVEL=info                     # debug | info | warn | error
VIGILCLAW_LOCAL_MODE=true                    # 无 Docker 时设为 true
VIGILCLAW_DB_PATH=./data/vigilclaw.db
VIGILCLAW_MAX_CONCURRENT_CONTAINERS=5
VIGILCLAW_HEALTH_PORT=9100
```

> **提示**: 如果不提供 `VIGILCLAW_MASTER_KEY`，系统会自动在 `~/.config/vigilclaw/master.key` 生成一个。

### 3. 构建 Agent Runner 镜像 (可选)

```bash
pnpm docker:build
```

### 4. 启动

```bash
# 开发模式 (热重载)
pnpm dev

# 生产模式
pnpm build && pnpm start
```

### 5. Docker Compose 部署

```bash
# 设置环境变量
export TELEGRAM_BOT_TOKEN=your-token
export MASTER_KEY=your-64-char-hex-key

docker compose up -d
```

---

## 💬 内置命令

以下命令在所有消息渠道中通用 (当前内置 Telegram 渠道)：

| 命令                     | 说明                                   | 示例                           |
| ------------------------ | -------------------------------------- | ------------------------------ |
| `/help`                  | 显示帮助信息                           | `/help`                        |
| `/cost`                  | 查看费用报告 (今日/本月消耗、模型明细) | `/cost`                        |
| `/model [name]`          | 查看或切换模型                         | `/model sonnet`                |
| `/budget [day] [month]`  | 查看或设置预算                         | `/budget 20 600`               |
| `/setkey <name> <value>` | 设置凭证 (仅管理员)                    | `/setkey anthropic sk-ant-xxx` |
| `/clear`                 | 清空当前对话上下文                     | `/clear`                       |

### 模型别名 (Claude)

当前内置 Claude Provider，支持以下别名快速切换：

| 别名     | 模型                         |
| -------- | ---------------------------- |
| `sonnet` | `claude-sonnet-4-5-20250929` |
| `haiku`  | `claude-haiku-3-5-20250929`  |
| `opus`   | `claude-opus-4-20250929`     |

### 自定义 API 中转

支持使用自定义 API 端点 (如代理服务):

```
/setkey anthropic.base_url https://your-proxy.com
/setkey anthropic.auth_token your-custom-token
```

---

## 🛡️ 安全模型

### 容器隔离

每个任务在独立的 Docker 容器中执行，具有以下安全约束：

| 约束     | 配置                                       |
| -------- | ------------------------------------------ |
| 文件系统 | 只读 rootfs + tmpfs `/tmp` (noexec, 100MB) |
| 权限     | `CAP_DROP ALL` + `no-new-privileges`       |
| 资源     | 内存 512MB / CPU 1核 / PID 100             |
| 超时     | 5 分钟任务超时                             |
| 网络     | 仅允许出站到 Credential Proxy              |

### 凭证安全

- API Key 使用 AES-256-GCM 加密存储在 SQLite 中
- Master Key 为 32 字节 (64 hex chars)，支持环境变量或文件两种加载方式
- 容器通过 Credential Proxy 间接访问 API，Key 不暴露给 Agent
- Proxy 限制请求路径白名单 (`/v1/messages`, `/v1/complete`)

### 卷挂载防护

自动阻止挂载敏感路径：

- 系统路径: `/etc`, `/var`, `/usr`, `/bin`, `/boot`, `/dev`, `/proc`, `/sys`
- 用户敏感目录: `~/.ssh`, `~/.gnupg`, `~/.config`, `~/.aws`
- 可配置挂载白名单: `~/.config/vigilclaw/mount-allowlist.json`

---

## 🗄️ 数据模型

SQLite 数据库包含 8 张核心表：

| 表                | 用途                                                |
| ----------------- | --------------------------------------------------- |
| `users`           | 用户信息、预算设置、模型偏好                        |
| `messages`        | 对话历史 (按 session_key 索引)                      |
| `api_calls`       | API 调用记录 (token 消耗、费用)                     |
| `tasks`           | 任务生命周期 (pending → running → completed/failed) |
| `credentials`     | AES-256-GCM 加密的凭证存储                          |
| `security_events` | 安全审计日志                                        |
| `scheduled_tasks` | Cron 定时任务                                       |
| `settings`        | 全局配置项                                          |

自动清理策略：

- 消息: 90 天
- API 调用/任务/安全事件: 365 天

---

## 🔧 开发

### 常用命令

```bash
pnpm dev              # 开发模式 (tsx --watch 热重载)
pnpm build            # TypeScript 编译到 dist/
pnpm start            # 运行编译后的代码

pnpm test             # 运行测试
pnpm test:watch       # 监听模式
pnpm test:coverage    # 带覆盖率报告

pnpm lint             # ESLint 检查
pnpm lint:fix         # 自动修复
pnpm format           # Prettier 格式化
pnpm typecheck        # TypeScript 类型检查
pnpm check            # lint + typecheck + test 全量检查

pnpm docker:build     # 构建 Agent Runner Docker 镜像
pnpm deps:check       # 检查依赖
pnpm deps:audit       # 安全审计
```

### 项目结构

```
VigilClaw/
├── src/
│   ├── index.ts               # 入口 · 模块编排 · Graceful Shutdown
│   ├── config.ts              # Zod Schema 配置 · 环境变量/配置文件双层加载
│   ├── crypto.ts              # AES-256-GCM 加解密 · Master Key 管理
│   ├── db.ts                  # SQLite DAL · Schema 迁移 · 8张表
│   ├── router.ts              # 消息路由 · 命令处理 · 费用报告
│   ├── container-runner.ts    # Docker 容器全生命周期管理
│   ├── local-runner.ts        # 本地模式 (无容器降级)
│   ├── credential-proxy.ts    # TCP HTTP 代理 · API Key 运行时注入
│   ├── cost-guard.ts          # 日/月双级预算检查
│   ├── session-manager.ts     # 会话上下文管理
│   ├── group-queue.ts         # 并发队列 (群组内串行 · 跨群组并行)
│   ├── task-scheduler.ts      # Cron 定时任务 · 延迟队列
│   ├── rate-limiter.ts        # 三级滑动窗口限流 (用户/群组/全局)
│   ├── security-logger.ts     # 安全审计日志
│   ├── mount-security.ts      # 卷挂载路径校验
│   ├── ipc.ts                 # 文件系统 IPC 协议
│   ├── health.ts              # /health 健康检查端点
│   ├── logger.ts              # pino 结构化日志 · 敏感信息脱敏
│   ├── types.ts               # 共享类型定义
│   ├── channels/
│   │   ├── telegram.ts        # Telegram 渠道实现 (grammY)
│   │   └── types.ts           # IChannel 渠道抽象接口 (扩展点)
│   └── provider/
│       ├── claude.ts          # Claude Provider 实现 (Anthropic SDK)
│       └── types.ts           # IProvider LLM 抽象接口 (扩展点)
├── container/
│   └── agent-runner/          # 容器内 Agent 代码
│       └── src/
│           ├── index.ts       # 容器入口 · IPC 读写
│           ├── react-loop.ts  # ReAct 循环 (30轮安全阀)
│           ├── types.ts       # 容器内类型定义
│           └── tools/         # Agent 工具集
│               ├── bash.ts    # Shell 命令执行
│               ├── read.ts    # 文件读取
│               ├── write.ts   # 文件写入
│               └── edit.ts    # 精确字符串替换
├── config/
│   └── seccomp-profile.json   # Seccomp 安全策略
├── tests/
│   └── unit/                  # 单元测试 (52 tests)
├── docs/                      # 产品文档 · 技术方案 · 调研报告
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 技术栈

| 类别     | 选择                       | 理由                                    |
| -------- | -------------------------- | --------------------------------------- |
| 语言     | TypeScript 5.7 (strict)    | 类型安全                                |
| 运行时   | Node.js ≥ 22               | LTS                                     |
| 包管理   | pnpm                       | 快速、严格依赖管理                      |
| 数据库   | SQLite (better-sqlite3)    | 零外部依赖、事务一致性                  |
| 配置校验 | zod                        | 类型安全 Schema 校验                    |
| 日志     | pino                       | 高性能结构化日志                        |
| 测试     | vitest                     | 快速、TS 原生支持                       |
| 容器     | Docker (dockerode)         | 成熟稳定                                |
| 消息渠道 | grammY (Telegram) + 可扩展 | IChannel 抽象，可接入 Discord/Slack 等  |
| LLM      | @anthropic-ai/sdk + 可扩展 | IProvider 抽象，可接入 OpenAI/Ollama 等 |

---

## 🗺️ Roadmap

| 阶段                | 状态      | 内容                                                         |
| ------------------- | --------- | ------------------------------------------------------------ |
| Phase 0: 架构设计   | ✅ 完成   | PRD + 4篇技术方案 + 4篇调研报告                              |
| Phase 1: MVP 核心   | ✅ 完成   | 消息渠道 → Docker Container → LLM → 回复 全链路              |
| Phase 2: 差异化能力 | ⏳ 规划中 | 多模型 (OpenAI/Ollama) · 更多渠道 · 持久记忆 · Web Dashboard |

详细路线图见 [ROADMAP.md](./docs/planning/ROADMAP.md)。

---

## 📄 文档

| 文档                                                  | 说明                               |
| ----------------------------------------------------- | ---------------------------------- |
| [产品需求文档 (PRD)](./docs/product/VigilClaw-PRD.md) | 产品定位、核心价值、用户画像       |
| [技术方案](./docs/architecture/VigilClaw-技术方案.md) | 4 篇详细设计 (架构·安全·数据·部署) |
| [ROADMAP](./docs/planning/ROADMAP.md)                 | 路线图与当前进度                   |
| [CHANGELOG](./docs/planning/CHANGELOG.md)             | 版本变更记录                       |

---

## 🤝 贡献

欢迎贡献代码！请确保提交前通过全量检查：

```bash
pnpm check  # lint + typecheck + test
```

---

## 📜 License

[MIT](./LICENSE)
