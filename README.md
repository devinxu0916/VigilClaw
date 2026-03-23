# VigilClaw

> 安全优先的个人 AI 助手 — 容器隔离 · 凭证零信任 · 成本可控

[![Node.js](https://img.shields.io/badge/Node.js-≥22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-≥9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

VigilClaw 是面向开发者的开源个人 AI 助手。通过消息渠道与 LLM 对话，Agent 在容器中安全执行，网络受限、凭证隔离、成本实时追踪。

---

## ✨ 核心特性

**🔒 安全即默认**

- 容器隔离 — 只读 rootfs，`CAP_DROP ALL`，no-new-privileges，PID/内存/CPU 限制
- 凭证零信任 — API Key 不进入容器，通过 Credential Proxy 运行时注入
- 网络受限 — 容器仅能访问 Credential Proxy，无法直连外网
- 安全审计 — 所有安全事件持久化记录

**💰 成本可控**

- 日/月双级预算，超限自动拦截
- 模型分级路由 — 简单任务自动路由到便宜模型
- `/cost` 命令实时查看费用明细

**🤖 功能完整**

- 多模型 — Claude（Sonnet/Haiku/Opus）+ OpenAI（GPT-4o）+ Ollama（本地模型）
- 多渠道 — Telegram · 飞书 · 钉钉（均支持长连接，无需公网 IP）
- Skill 系统 — 可安装/卸载自定义 Agent 工具，内置 Web Search（Brave API）
- 持久化记忆 — sqlite-vec 向量搜索，跨会话语义召回
- 上下文压缩 — Haiku 模型生成滚动摘要，自动管理长对话
- 自然语言命令 — CommandBridge，用自然语言执行所有系统操作
- 定时任务 — Cron 调度 + 延迟队列，不丢失不重复
- Apple Container — macOS 原生容器，亚秒级启动（200-400ms）

**⚡ 轻量可审计**

- 12 个生产依赖，SQLite 本地存储，零外部数据库
- 代码目标 5,000~10,000 行，开发者可完整理解

---

## 🚀 快速开始

**前置要求**：Node.js ≥ 22，pnpm ≥ 9，Docker（可选），消息渠道凭证，LLM API Key

```bash
git clone https://github.com/your-username/VigilClaw.git
cd VigilClaw
pnpm install

cp .env.example .env
# 编辑 .env，填入必要配置

pnpm dev   # 开发模式（热重载）
```

**最小配置**（`.env`）：

```env
VIGILCLAW_MASTER_KEY=your-64-char-hex-key     # 不填则自动生成
VIGILCLAW_TELEGRAM_BOT_TOKEN=your-bot-token   # 至少一个渠道
ANTHROPIC_API_KEY=sk-ant-your-api-key         # 至少一个 LLM
VIGILCLAW_LOCAL_MODE=true                     # 无 Docker 时设为 true
```

**Docker Compose 部署**：

```bash
docker compose up -d
```

---

## 💬 内置命令

| 命令                     | 说明                                   |
| ------------------------ | -------------------------------------- |
| `/help`                  | 显示帮助信息                           |
| `/cost`                  | 查看费用报告（今日/本月，模型明细）    |
| `/model [name]`          | 查看或切换模型（支持 `provider:model` 格式）|
| `/budget [day] [month]`  | 查看或设置预算                         |
| `/setkey <name> <value>` | 设置凭证（仅管理员）                   |
| `/clear`                 | 清空当前对话上下文                     |
| `/skill`                 | 管理 Skill（list/install/remove/enable/disable）|
| `/schedule`              | 管理定时任务（list/create/remove）     |

**模型示例**：`/model sonnet` · `/model openai:gpt-4o` · `/model ollama:llama3`

**自定义 API 中转**：

```
/setkey anthropic.base_url https://your-proxy.com
/setkey anthropic.auth_token your-custom-token
```

---

## 🏗️ 架构概览

```
IChannel (Telegram · 飞书 · 钉钉)
    │
    ▼
Router → CostGuard → GroupQueue
    │
    ▼
ContainerRunner / AppleContainerRunner / LocalRunner
    │
    ├── CredentialProxy (API Key 运行时注入)
    ├── SearchBridge (Web Search 桥接)
    └── CommandBridge (系统命令桥接)
    │
    ▼
Docker / Apple Container
    └── Agent ReAct Loop（30轮）
        ├── Tools: Bash · Read · Write · Edit
        └── Skills: web_search · web_fetch · 自定义 Skill
```

---

## 🛡️ 安全模型

| 约束     | 配置                                       |
| -------- | ------------------------------------------ |
| 文件系统 | 只读 rootfs + tmpfs `/tmp` (noexec, 100MB) |
| 权限     | `CAP_DROP ALL` + `no-new-privileges`       |
| 资源     | 内存 512MB / CPU 1核 / PID 100             |
| 超时     | 5 分钟任务超时                             |
| 网络     | 仅允许出站到 Credential/Search/Command Proxy |
| 凭证     | AES-256-GCM 加密存储，容器不可见真实 Key   |

---

## 🗄️ 数据模型

SQLite 数据库，10 张核心表：

`users` · `messages` · `api_calls` · `tasks` · `credentials` · `security_events` · `scheduled_tasks` · `settings` · `skills` · `context_summaries` · `memories`（+ `vec_memories` 向量虚拟表）

---

## 🔧 开发

```bash
pnpm dev              # 开发模式（热重载）
pnpm build && pnpm start  # 生产模式

pnpm test             # 运行测试（221 tests）
pnpm test:coverage    # 带覆盖率报告

pnpm check            # lint + typecheck + test（提交前必须通过）

pnpm docker:build     # 构建 Agent Runner 镜像
pnpm apple:build      # 构建 Apple Container 镜像（macOS 26+）
```

### 技术栈

| 类别     | 选择                           |
| -------- | ------------------------------ |
| 语言     | TypeScript 5.7 (strict)        |
| 运行时   | Node.js ≥ 22                   |
| 数据库   | SQLite (better-sqlite3 + sqlite-vec) |
| 容器     | Docker / Apple Container       |
| 消息渠道 | grammY (Telegram) · @larksuiteoapi (飞书) · 原生 WebSocket (钉钉) |
| LLM      | @anthropic-ai/sdk · openai SDK |
| 嵌入模型 | @huggingface/transformers (all-MiniLM-L6-v2，本地) |
| 日志     | pino                           |
| 测试     | vitest                         |

---

## 🗺️ Roadmap

| 阶段                | 状态      | 内容                                                         |
| ------------------- | --------- | ------------------------------------------------------------ |
| Phase 0: 架构设计   | ✅ 完成   | PRD + 4篇技术方案 + 4篇调研报告                              |
| Phase 1: MVP 核心   | ✅ 完成   | Telegram → Docker → LLM → 回复，全链路 E2E 通过             |
| Phase 2: 差异化能力 | 🔧 进行中 | 多模型 ✅ · 多渠道 ✅ · Skill 系统 ✅ · 持久记忆 ✅ · Web Search ✅ · Apple Container ✅ · Web Dashboard ⏳ |

详细路线图见 [ROADMAP.md](./docs/planning/ROADMAP.md)。

---

## 📄 文档

| 文档 | 说明 |
| ---- | ---- |
| [PRD](./docs/product/VigilClaw-PRD.md) | 产品定位、核心价值、用户画像 |
| [技术方案](./docs/architecture/VigilClaw-技术方案.md) | 架构·安全·数据·部署 |
| [ROADMAP](./docs/planning/ROADMAP.md) | 路线图与当前进度 |
| [CHANGELOG](./docs/planning/CHANGELOG.md) | 版本变更记录 |

---

## 🤝 贡献

```bash
pnpm check  # lint + typecheck + test，提交前必须通过
```

---

## 📜 License

[MIT](./LICENSE)
