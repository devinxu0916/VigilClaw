# OpenClaw 架构设计与实现调研报告

> 调研日期：2026-03-10

## 目录

- [项目概述](#项目概述)
- [架构全景](#架构全景)
- [1. Gateway — 控制平面](#1-gateway--控制平面)
- [2. Channel Adapters — 输入标准化](#2-channel-adapters--输入标准化)
- [3. 多 Agent 路由与会话管理](#3-多-agent-路由与会话管理)
- [4. Agent Runtime — Agentic Loop](#4-agent-runtime--agentic-loop)
- [5. Skills 系统 — 按需指令加载](#5-skills-系统--按需指令加载)
- [6. MCP 集成 — 标准化工具层](#6-mcp-集成--标准化工具层)
- [7. Memory 系统 — 持久化记忆](#7-memory-系统--持久化记忆)
- [8. Heartbeat — 主动行为机制](#8-heartbeat--主动行为机制)
- [9. 安全模型 — 五层信任边界](#9-安全模型--五层信任边界)
- [10. 完整消息流](#10-完整消息流)
- [技术栈总结](#技术栈总结)

---

## 项目概述

OpenClaw 是一个**开源的个人 AI 助手框架**，将领先的 AI 模型（ChatGPT、Claude、Gemini、DeepSeek 等）连接到日常使用的消息应用——Telegram、Discord、Slack、Signal、WhatsApp、iMessage 等，把它们变成始终在线、能实际执行任务的个人助手。

### 基本信息

| 维度 | 详情 |
|------|------|
| 创始人 | Peter Steinberger（PSPDFKit 创始人，奥地利开发者） |
| 发展历程 | Clawdbot → Moltbot → OpenClaw（2026年1月定名） |
| GitHub Stars | 270,000+（2026年3月） |
| 社区 Skills | 5,700+ |
| 活跃用户 | 30-40 万 |
| 贡献者 | 839+（称为 "Clawtributors"） |
| 许可证 | MIT |
| 当前维护 | 独立基金会（Peter Steinberger 于 2026 年 2 月加入 OpenAI） |

### 核心特点

- **本地优先（Local-first）**：运行在你自己的硬件上，数据完全自己掌控
- **多通道接入**：支持 WhatsApp、Telegram、Discord、Slack、iMessage 等
- **多模型支持**：可接入 ChatGPT、Claude、Gemini、DeepSeek、Ollama 等
- **跨平台**：macOS / Windows / Linux 均支持
- **TypeScript 编写**，MIT 开源协议

---

## 架构全景

OpenClaw 的核心理念是 **"多入口、单内核"（Multi-Ingress, Single-Kernel）** 运行时。整体架构分为五层：

```
┌─────────────────────────────────────────────────────────┐
│  入口层 (Ingress)                                        │
│  Channels: WhatsApp / Telegram / Discord / Slack /       │
│  Signal / iMessage / WebChat                            │
│  Automation: Webhooks / Cron / Heartbeat                │
├─────────────────────────────────────────────────────────┤
│  控制平面 (Control Plane)                                │
│  Gateway: WebSocket/HTTP APIs, 认证, 路由, 状态广播       │
├─────────────────────────────────────────────────────────┤
│  执行平面 (Execution Plane)                              │
│  Agent: run/attempt 生命周期, lane/queue 并发, 流式响应    │
├─────────────────────────────────────────────────────────┤
│  能力层 (Capability Layer)                               │
│  Tools: Browser / Exec / Web Fetch / File R/W ...       │
│  Providers: AI 模型 + Failover 策略                      │
├─────────────────────────────────────────────────────────┤
│  数据层 (Data Layer)                                     │
│  Sessions / Media / Config / Logging / Auditing         │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Gateway — 控制平面

Gateway 是一个**长驻进程**，是整个系统的"唯一真理来源"（Single Source of Truth）。

### 核心职责

- **消息路由**：管理所有消息通道的连接（WhatsApp via Baileys、Telegram via grammY、Slack、Discord 等）
- **WebSocket API**：向控制平面客户端（macOS App、CLI、Web UI）和节点（Node）暴露类型化的 WebSocket API
- **会话管理**：维护所有 agent session 的状态
- **认证与安全**：Token/密码/Tailscale 认证、AllowFrom/AllowList 验证
- **事件广播**：发出 `agent`、`chat`、`presence`、`health`、`heartbeat`、`cron` 等事件
- **Canvas Host**：在同一端口下提供 `/__openclaw__/canvas/`（agent 可编辑的 HTML/CSS/JS）和 `/__openclaw__/a2ui/`

### 组件连接

- **Control-Plane Clients**：macOS App、CLI、Web UI 等，通过 WebSocket 连接到 Gateway（默认 `127.0.0.1:18789`）
- **Nodes**：macOS/iOS/Android/headless 设备，也通过 WebSocket 连接，但声明 `role: node` 并提供设备特定的能力和命令

### 关键设计约束

- **每台主机一个 Gateway**，它是唯一打开 WhatsApp 会话的地方
- 所有入站数据帧都经过 **JSON Schema 验证**
- 连接时必须完成强制性**握手流程**
- 事件**不重放**，客户端负责在数据间隙时刷新

---

## 2. Channel Adapters — 输入标准化

每个消息平台（WhatsApp、Telegram、Slack 等）都有自己的协议和数据格式。Channel Adapter 的作用是将所有不同来源的消息统一转换为标准化的消息对象：

```
原始输入 (WhatsApp语音 / Telegram文字 / Slack消息)
        ↓ Channel Adapter
标准化消息对象 { sender, body, attachments, channel_metadata }
```

- 语音消息会先被**转录为文本**再传给模型
- 图片、文件等附件也被统一处理

**设计原则：** 在模型看到输入之前，必须先标准化。上下文的质量决定了输出的质量。

---

## 3. 多 Agent 路由与会话管理

### 多 Agent 路由

可以为不同的通道、联系人或群组配置不同的 Agent：

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "personal",
        "workspace": "~/.openclaw/workspace-personal",
        "sandbox": { "mode": "off" }
        // 完全工具访问
      },
      {
        "id": "family",
        "workspace": "~/.openclaw/workspace-family",
        "sandbox": { "mode": "all", "scope": "agent" },
        "tools": {
          "allow": ["read"],
          "deny": ["exec", "write", "edit"]
        }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "family",
      "match": {
        "provider": "whatsapp",
        "peer": { "kind": "group", "id": "120363424282127706@g.us" }
      }
    }
  ]
}
```

### 会话隔离

- 每个会话由 `agent:channel:peer` 唯一标识
- 策略按 agent 粒度执行
- 所有 transcript 都被记录用于审计

### Command Queue（命令队列）

**同一个 session 内的消息是串行处理的，不是并行。** 这是刻意的设计：

- 防止工具冲突（两个并行操作可能破坏状态）
- 保持会话历史一致性
- 通过 lane/queue 并发模型实现

---

## 4. Agent Runtime — Agentic Loop

这是 OpenClaw 的心脏。官方描述：

> *An agentic loop is the full run of an agent: intake → context assembly → model inference → tool execution → streaming replies → persistence.*

### 4.1 Context Assembly（上下文组装）

在模型看到消息之前，系统从四个来源组装上下文：

1. **OpenClaw 基础提示词** — agent 始终遵循的核心指令
2. **Skills 提示词** — 可用 skill 的紧凑列表（名称、描述、路径）
3. **Bootstrap 上下文文件** — 工作区级别的环境上下文
4. **Per-run 覆盖** — 特定运行时注入的额外指令

### 4.2 模型推理

组装好的上下文发送给配置的 Provider（Anthropic、OpenAI、Google、Ollama 等）。关键细节：

- 强制执行模型特定的上下文长度限制
- 维护 **Compaction Reserve**（为模型回复保留的 token 缓冲区）

### 4.3 Tool Execution（ReAct 循环）

模型返回两种结果之一：

1. **文本回复** → 本轮结束
2. **工具调用请求** → 进入 ReAct 循环

```python
while True:
    response = llm.call(context)

    if response.is_text():
        send_reply(response.text)
        break

    if response.is_tool_call():
        result = execute_tool(response.tool_name, response.tool_params)
        context.add_message("tool_result", result)
        # 循环继续
```

OpenClaw 在此过程中实时**流式传输**部分响应——你能看到工具被调用、结果返回、模型推理的全过程。

---

## 5. Skills 系统 — 按需指令加载

Skills 是 OpenClaw 最优雅的设计之一。

### 什么是 Skill

一个 Skill 就是一个包含 `SKILL.md` 文件的文件夹，用 Markdown 写的自然语言指令：

```markdown
---
name: github-pr-reviewer
description: Review GitHub pull requests and post feedback
---

# GitHub PR Reviewer

When asked to review a pull request:
1. Use the web_fetch tool to retrieve the PR diff
2. Analyze the diff for correctness, security issues, and code style
3. Structure your review as: Summary, Issues Found, Suggestions
4. If asked to post the review, use the GitHub API tool to submit it
```

### 关键设计：惰性加载

OpenClaw **不会**把所有 skill 的全文注入系统提示词。而是：

1. Context Assembly 阶段只注入 skill 的**名称、描述和路径的紧凑列表**
2. 模型自己决定哪个 skill 与当前任务相关
3. 按需**读取**该 skill 的 `SKILL.md`

这样无论安装了多少 skill，基础提示词都保持精简。

### ClawHub

OpenClaw 的社区 skill 注册中心，目前有 5,700+ 社区构建的 skill。安全机制包括：

- Semver 版本控制
- 必须包含 `SKILL.md` 文件
- 模式化审核标记
- VirusTotal 扫描（规划中）
- GitHub 账号年龄验证

---

## 6. MCP 集成 — 标准化工具层

OpenClaw 支持 **MCP（Model Context Protocol）** 作为标准化的外部工具接入层：

```
Agent ←→ MCP Server ←→ Google Calendar / Notion / Home Assistant / ...
```

- Agent 不直接接触底层服务
- MCP Server 暴露带有 Schema 定义的工具集
- Agent 通过标准请求格式调用，获取结构化结果
- 实现**工具可移植性**：为一个 MCP 兼容 agent 构建的工具可在其他系统复用

---

## 7. Memory 系统 — 持久化记忆

这是 OpenClaw 最务实的设计之一：**纯 Markdown 文件 + SQLite**，没有 Redis，没有 Pinecone。

### 文件结构

```
~/.openclaw/workspace/
├── AGENTS.md         ← agent 配置和指令
├── SOUL.md           ← 人格、偏好、语气
├── MEMORY.md         ← 长期事实和摘要
├── HEARTBEAT.md      ← 主动任务检查清单
└── memory/
    ├── 2026-02-15.md ← 每日临时日志
    └── 2026-02-16.md ← 每日临时日志
```

### 各文件职责

| 文件 | 作用 | 加载方式 |
|------|------|----------|
| `SOUL.md` | 定义 agent 的人格、名称、沟通风格 | 始终加载 |
| `MEMORY.md` | 长期事实（"用户偏好简洁回复"、"用户技术栈是 Next.js + Supabase"） | 始终加载 |
| `HEARTBEAT.md` | 主动任务检查清单 | Heartbeat 触发时加载 |
| `memory/YYYY-MM-DD.md` | 每日日志，持久追加 | **按需检索**，不自动注入 |

### 上下文压缩（Compaction）

当历史记录超出上下文窗口时，运行**压缩流程**——将旧的对话轮次总结为压缩条目，保留语义内容同时减少 token 数量。

### 检索方式

- 基于**嵌入向量**的语义搜索（可选用 `sqlite-vec` SQLite 扩展加速）
- 关键词搜索（精确匹配）

---

## 8. Heartbeat — 主动行为机制

OpenClaw 不仅仅被动等待消息，它有一个**心跳机制**：

- 默认每 **30 分钟**触发一次
- 读取 `HEARTBEAT.md` 中的任务清单
- 判断是否有需要立即处理的事项
- 如果有 → 执行操作并发消息给你
- 如果没有 → 返回 `HEARTBEAT_OK`（Gateway 静默处理，不发送给用户）

本质上是一个 **Cron 触发的 Agentic Loop**，让 agent 从被动响应变为主动服务。

---

## 9. 安全模型 — 五层信任边界

| 层 | 边界 | 机制 |
|----|------|------|
| **1. Channel Access** | 谁能跟 agent 对话 | Gateway 设备配对、AllowFrom/AllowList、Token/密码/Tailscale 认证 |
| **2. Session Isolation** | agent 之间的隔离 | 每个 session 由 `agent:channel:peer` 唯一标识，按 agent 执行策略，transcript 审计 |
| **3. Tool Execution** | agent 能做什么 | Docker 沙箱 / 主机级 `exec-approvals`、SSRF 防护（DNS pinning + IP 阻断） |
| **4. External Content** | 外部数据风险 | 外部内容包裹在 XML 标签中，注入安全通知 |
| **5. Supply Chain** | Skill 安全 | ClawHub semver 版本控制、SKILL.md 必须、模式化审核、VirusTotal 扫描、GitHub 账号年龄验证 |

### 工具权限控制

```jsonc
{
  "tools": {
    "allow": ["read", "exec", "process"],     // 白名单
    "deny": ["write", "edit", "gateway"]       // 黑名单
  }
}
```

### 沙箱模式

- `"mode": "off"` — 不使用沙箱
- `"mode": "all"` — 所有工具调用在 Docker 容器中执行
- `"scope": "agent"` — 每个 agent 一个容器
- `"scope": "shared"` — 共享容器

### 插件信任模型

插件在 Gateway 进程内**同进程加载**执行，视为可信代码。拥有与主进程相同的 OS 权限。建议使用 `plugins.allow` 明确钉选信任的插件列表。

---

## 10. 完整消息流

一条消息在 OpenClaw 中的完整旅程：

```
用户发送 WhatsApp 消息
    ↓
[1] Channel Adapter: WhatsApp (Baileys) 接收 → 标准化为统一消息对象
    ↓
[2] Gateway: 路由到正确的 Agent，匹配 Session (agent:channel:peer)
    ↓
[3] Command Queue: 按 session lane 串行排队
    ↓
[4] Context Assembly: 基础提示词 + Skills列表 + Bootstrap文件 + Memory + 历史
    ↓
[5] Model Inference: 发送给 Claude/GPT/Gemini/Ollama → 流式返回
    ↓
[6] Tool Call? ──Yes──→ 执行工具 → 结果注入上下文 → 回到 [5]
    │
    └──No──→ 文本回复
    ↓
[7] 回复通过 Gateway 路由回 WhatsApp
    ↓
[8] Session 持久化, Memory 更新
```

---

## 技术栈总结

| 维度 | 选择 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js 22+ |
| 许可证 | MIT |
| 数据库 | SQLite（+ sqlite-vec 向量扩展） |
| 记忆存储 | 纯 Markdown 文件 |
| WhatsApp 接入 | Baileys |
| Telegram 接入 | grammY |
| 沙箱 | Docker |
| 模型协议 | 多 Provider 支持（Anthropic, OpenAI, Google, Ollama 等） |
| 工具协议 | MCP (Model Context Protocol) |
| 包管理 | npm |

---

## 核心设计哲学

OpenClaw 的设计哲学可总结为四个关键词：

1. **本地优先** — 数据和计算在用户自己的设备上，隐私和控制权归用户
2. **文件即状态** — Memory、Soul、Skills 全部是 Markdown 文件，透明可审计
3. **模型无关** — 不绑定任何特定 AI 模型，Provider 可随时切换
4. **安全分层** — 五层信任边界，从 Channel 访问到 Supply Chain 层层把控

---

## 参考资料

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [Gateway Architecture](https://docs.openclaw.ai/concepts/architecture)
- [Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [Memory](https://docs.openclaw.ai/concepts/memory)
- [How OpenClaw Works - Bibek Poudel](https://bibek-poudel.medium.com/how-openclaw-works-understanding-ai-agents-through-a-real-architecture-5d59cc7a4764)
- [OpenClaw Architecture Deep Dive - Raj](https://rajvijayaraj.substack.com/p/openclaw-architecture-a-deep-dive)
- [OpenClaw Architecture and Rapid Scaling - Micheal Lanham](https://micheallanham.substack.com/p/openclaw-architecture-and-rapid-scaling)
- [System Architecture - OpenClawCN](https://openclawcn.com/en/docs/concepts/system-architecture/)
