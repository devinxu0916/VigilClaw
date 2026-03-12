# NanoClaw 深度架构分析报告

> 调研日期：2026-03-10
> 数据来源：GitHub 源码分析、社区评测、安全研究报告、技术博客、Reddit/HN 讨论

## 目录

- [一、项目概览](#一项目概览)
- [二、架构设计](#二架构设计)
  - [2.1 整体架构：双进程 + 容器隔离](#21-整体架构双进程--容器隔离)
  - [2.2 核心模块拆解](#22-核心模块拆解)
  - [2.3 数据流全程](#23-数据流全程)
- [三、核心设计哲学](#三核心设计哲学)
- [四、技术亮点](#四技术亮点)
- [五、存在的问题](#五存在的问题)
- [六、与 OpenClaw 的架构对比](#六与-openclaw-的架构对比)
- [七、总结评估](#七总结评估)
- [参考资料](#参考资料)

---

## 一、项目概览

| 维度 | 详情 |
|------|------|
| **创建者** | Gavriel Cohen（前 Wix 开发者，现创立 Qwibit AI） |
| **GitHub** | `qwibitai/nanoclaw`（原 `gavrielc/nanoclaw`） |
| **Stars** | **21,000+**（2026.3.10，增长极快） |
| **语言** | TypeScript（98.2%）+ Shell（1.2%）+ Dockerfile（0.6%） |
| **核心代码量** | ~3,000 行（宿主机），对外宣称"~500 行"指最初版本 |
| **许可证** | MIT |
| **版本** | v1.1.2+ |
| **定位** | "Security-first personal Claude assistant" |
| **创建时间** | 2026-01-31 |
| **贡献者** | 40+（核心：gavrielc, gabi-simons, glifocat, TomGranot） |

### 诞生背景

创始人 Gavriel Cohen 的原话揭示了动机：

> *"I was staring at OpenClaw — 52+ modules, 45+ dependencies, 8 config files — and thought: I don't trust software I can't read in an afternoon."*

OpenClaw 的 43 万行 TypeScript 代码意味着**没有人能完整审计它**，而它拥有文件系统、Shell、API 密钥的完整访问权限。NanoClaw 的核心哲学是：**如果你不能读完它，你不应该信任它。**

---

## 二、架构设计

### 2.1 整体架构：双进程 + 容器隔离

NanoClaw 采用了一个清晰的 **"Host + Container" 双进程架构**，与 OpenClaw 的单体微服务架构形成鲜明对比：

```
┌──────────────────────────────────────────────────────────┐
│  宿主机进程 (Node.js)                                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐           │
│  │ Channel  │  │ SQLite   │  │  Credential  │           │
│  │ Registry │  │ Database │  │    Proxy     │           │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘           │
│       │              │               │                   │
│  ┌────▼──────────────▼───────────────▼──────┐            │
│  │         Orchestrator (index.ts)           │            │
│  │    消息路由 → Group Queue → 容器调度       │            │
│  └────────────────┬──────────────────────────┘            │
│                   │                                      │
│  ┌────────────────▼─────────────────┐                    │
│  │     IPC Watcher (文件系统监控)     │                    │
│  │     Task Scheduler (Cron)        │                    │
│  └──────────────────────────────────┘                    │
├──────────────────── 容器边界 ──────────────────────────────┤
│  容器沙箱 (Docker / Apple Container)                       │
│                                                          │
│  ┌──────────────────────────────────┐                    │
│  │  Agent Runner                    │                    │
│  │  ┌───────────────────────────┐   │                    │
│  │  │ Claude Agent SDK (query) │   │                    │
│  │  │  ┌─────┐ ┌─────┐ ┌────┐ │   │                    │
│  │  │  │Bash │ │Read │ │Edit│ │   │                    │
│  │  │  └─────┘ └─────┘ └────┘ │   │                    │
│  │  └───────────────────────────┘   │                    │
│  │                                  │                    │
│  │  /workspace/  ← 群组工作目录(RW)  │                    │
│  │  /workspace/global/ ← 全局记忆(RO)│                    │
│  │  /workspace/ipc/ ← IPC 通道      │                    │
│  └──────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────┘
```

**关键设计决策**：宿主机**永远不运行 AI 推理**。所有与 Claude 的交互都发生在容器内部。宿主机只负责消息路由、存储和容器生命周期管理。

### 2.2 核心模块拆解

#### （1）`src/index.ts` — 入口与编排器

整个系统的"大脑"。负责：
- 初始化 SQLite 数据库
- 启动 Credential Proxy（凭证代理）
- 连接所有消息渠道（WhatsApp / Telegram / Discord 等）
- 运行消息轮询循环：持续检查 SQLite 中的新消息
- 将消息推入 Group Queue 进行容器调度

#### （2）`src/db.ts` — 存储层

使用 `better-sqlite3` 定义了 **7 张核心表**：

| 表 | 用途 |
|---|---|
| `messages` | 所有渠道消息的统一存储 |
| `groups` | 群组/频道配置 |
| `sessions` | Agent 会话状态 |
| `scheduled_tasks` | 定时任务配置 |
| `agent_runs` | Agent 执行历史 |
| `settings` | 全局配置 |
| `migrations` | 数据库版本迁移 |

**设计亮点**：所有数据都在 SQLite 中，**没有 Redis、没有 PostgreSQL、没有外部状态服务**。这与 OpenClaw 的"纯 Markdown 文件"方案不同——SQLite 提供了事务一致性和并发安全。

#### （3）`src/container-runner.ts` + `src/mount-security.ts` — 安全核心

这是 NanoClaw 最核心的差异化模块。负责：

- **构建 Docker/Apple Container 启动参数**
- **精确控制卷挂载**：
  - `groups/{group-folder}/` → `/workspace/`（读写，群组工作目录）
  - `groups/global/` → `/workspace/global/`（**只读**，全局记忆）
  - `data/sessions/{group-folder}/.claude/` → `/home/node/.claude/`（会话隔离）
  - `data/ipc/{group-folder}/` → `/workspace/ipc/`（IPC 通道）
- **挂载安全校验**（`mount-security.ts`）：根据宿主机外部的白名单 `~/.config/nanoclaw/mount-allowlist.json` 校验额外挂载请求，**防止 Agent 通过修改项目代码绕过沙箱**

#### （4）`src/credential-proxy.ts` — 凭证零信任

这是一个非常精巧的设计：

```
容器内 Agent → API 请求 → Credential Proxy → 注入真实 ANTHROPIC_API_KEY → Anthropic API
```

容器内的环境变量中**看不到真实的 API Key**，只有 placeholder。所有到 Anthropic 的请求都必须经过宿主机的代理层，由代理层在运行时注入真实凭证。这意味着：
- 即使 Agent 执行 `env` 或 `printenv`，也拿不到密钥
- 即使容器被攻破，攻击者也无法直接窃取 API Key

#### （5）`src/ipc.ts` — 文件系统即 IPC

NanoClaw 选择了一种**非常传统但非常稳健**的 IPC 方案：文件系统监控。

- 容器内的 Agent Runner 将输出写入 `/workspace/ipc/output/`
- 宿主机的 IPC Watcher 监控 `data/ipc/{group}/output/` 目录
- 支持的 IPC 消息类型：`schedule_task`（调度任务）、`send_message`（发送消息）
- 使用 `OUTPUT_START_MARKER` / `OUTPUT_END_MARKER` 标记输出边界

**为什么不用 WebSocket / gRPC？** 因为文件系统是容器挂载的天然通道，不需要额外的网络配置，在容器隔离场景下最简单可靠。

#### （6）`src/channels/registry.ts` — 插件化渠道

渠道系统采用"自注册"工厂模式：

```typescript
export type ChannelFactory = (opts: ChannelOpts) => Channel | null;
const registry = new Map<string, ChannelFactory>();
export function registerChannel(name: string, factory: ChannelFactory) {
  registry.set(name, factory);
}
```

每个渠道（WhatsApp、Telegram、Discord）是一个独立的 Skill，在导入时自动注册。这让 NanoClaw 可以通过 `/add-whatsapp`、`/add-telegram` 等 Skill 命令动态添加渠道。

#### （7）`container/agent-runner/src/index.ts` — 容器内 Agent

使用 `@anthropic-ai/claude-agent-sdk`（v0.2.29），核心逻辑：
- 调用 `query()` API 启动 Claude Agent 循环
- 通过 `allowedTools` 配置可用工具（Bash, Read, Write, Edit, WebSearch 等）
- 运行期间持续轮询 `/workspace/ipc/input/`，接收宿主机"塞入"的新消息（Piping 机制）
- 通过 Marker 标记将流式输出传回宿主机

#### 核心文件清单

| 文件路径 | 核心职责 |
|---------|---------|
| `src/index.ts` | **入口点**。初始化 DB、启动 Proxy、连接渠道、启动消息循环 |
| `src/db.ts` | **存储层**。定义了 7 张核心表，处理 JSON 到 SQLite 的迁移 |
| `src/container-runner.ts` | **沙箱管理**。构建 Docker 启动参数，处理复杂的卷挂载逻辑 |
| `src/mount-security.ts` | **挂载安全**。校验额外挂载请求，防止沙箱逃逸 |
| `src/ipc.ts` | **通信桥梁**。监控文件系统，处理来自容器的 `schedule_task` 或 `send_message` 请求 |
| `src/task-scheduler.ts` | **调度器**。计算下次运行时间，将到期任务推入 `GroupQueue` |
| `src/credential-proxy.ts` | **安全代理**。拦截容器 API 请求，注入真实的 Anthropic Key |
| `src/group-queue.ts` | **并发控制**。管理容器并发数（默认最大 5 个） |
| `src/router.ts` | **消息路由**。判断目标群组，检查触发条件 |
| `src/channels/registry.ts` | **渠道注册**。自注册工厂模式管理所有消息渠道 |
| `container/agent-runner/src/index.ts` | **Agent 运行器**。容器内执行 Claude Agent SDK |

#### 依赖项分析

| 依赖 | 版本 | 用途 |
|------|------|------|
| `better-sqlite3` | `^11.8.1` | 高性能 SQLite 绑定，存储所有持久化状态 |
| `cron-parser` | `^5.5.0` | 解析任务调度的 Cron 表达式 |
| `pino` | `^9.6.0` | 结构化日志记录 |
| `zod` | `^4.3.6` | 配置和 IPC 消息的 Schema 校验 |
| `@anthropic-ai/claude-agent-sdk` | `0.2.29` | 核心 Agent 引擎（运行在容器内） |

### 2.3 数据流全程

一条 WhatsApp 消息在 NanoClaw 中的完整旅程：

```
[1] WhatsApp (Baileys) 收到消息
     ↓
[2] Channel Adapter 标准化 → 写入 SQLite messages 表
     ↓
[3] Orchestrator 轮询检测到新消息
     ↓
[4] Router 判断目标群组，检查触发条件（@Andy 或 Main 频道）
     ↓
[5] Group Queue 入队（最大并发 5 个容器）
     ↓
[6] Container Runner 启动新容器：
     - 挂载群组目录（RW）
     - 挂载全局记忆（RO）
     - 挂载 IPC 通道
     - 不挂载 .env / 凭证
     ↓
[7] 容器内 Agent Runner 启动 Claude Agent SDK
     ↓
[8] SDK query() → Claude API（经 Credential Proxy 注入 Key）
     ↓
[9] Claude 执行 ReAct 循环（推理 → 工具调用 → 观察 → 推理...）
     ↓
[10] Agent Runner 将结果写入 IPC output 目录
     ↓
[11] IPC Watcher 检测到输出文件
     ↓
[12] Orchestrator 读取结果 → 通过 Channel 发回 WhatsApp
     ↓
[13] 容器销毁（临时容器，用后即毁）
```

---

## 三、核心设计哲学

### 3.1 "不信任 Agent"原则

NanoClaw 官方博客标题就是 **"Don't trust AI agents"**。核心论点：

> *"The right approach isn't better permission checks or smarter allowlists. It's architecture that assumes agents will misbehave and contains the damage when they do."*

与 OpenClaw 的"应用层权限检查"（allowlist/denylist）不同，NanoClaw 将信任边界从**应用层**下移到**操作系统内核层**。容器是内核强制执行的隔离，不是 Agent 可以绕过的。

### 3.2 "可审计的极简主义"

社区对此的评价精辟：

> *"I don't trust software I can't read in an afternoon."*

整个核心代码约 3,000 行（宿主机侧），一个有经验的开发者**一天内可以完整审计**。对比 OpenClaw 的 43 万行，这是两个数量级的差距。

### 3.3 "Skill 即功能扩展"

NanoClaw 的功能扩展不是通过插件系统，而是通过 **Claude Code 的 Skill 机制**。想添加 Telegram 支持？运行 `/add-telegram`，Claude Code 会**直接修改你的 NanoClaw 源码**。

这是一个非常 AI-native 的设计：
- 没有插件注册表、没有插件 API、没有运行时钩子
- 扩展就是代码修改，完全透明
- 你可以 `git diff` 看到每一处变更

### 3.4 "Body + Brain 分离"

宿主机 = Body（身体），容器内 Claude = Brain（大脑）。Body 负责感知（接收消息）和行动（发送消息），Brain 负责思考（推理和工具调用），两者通过 IPC 通信。Brain 被锁在笼子里，只能通过受控的 IPC 通道与外界交互。

---

## 四、技术亮点

### 4.1 Credential Proxy（凭证零信任）

这是目前所有 OpenClaw 替代方案中**独一无二的设计**。解决了一个被忽视的安全问题：如果 Agent 能执行 `printenv`，它就能窃取你的 API Key。NanoClaw 的 Credential Proxy 确保 API Key 永远不进入容器。

### 4.2 Apple Container 原生支持

在 macOS 上，NanoClaw 使用 Apple 官方的 `apple/container` 框架（基于 `Virtualization.framework`），而不是 Docker Desktop。

| 维度 | Docker Desktop (macOS) | Apple Container |
|------|----------------------|-----------------|
| 隔离级别 | 所有容器共享一个 Linux VM | **每个容器独立微型 VM** |
| 启动速度 | 数秒 | **亚秒级** |
| 内存开销 | 数 GB（VM 固定开销） | **极低**（按需分配） |
| 硬件集成 | 通用 | **Apple Silicon 深度优化** |

这意味着在 Mac 上，NanoClaw 的容器隔离实际上是**硬件级虚拟化隔离**，比 Docker 的 namespace 隔离更强。

### 4.3 群组级记忆隔离

每个 WhatsApp 群组获得完全独立的：
- 工作目录（`groups/{group-folder}/`）
- 会话状态（`data/sessions/{group-folder}/`）
- IPC 命名空间（`data/ipc/{group-folder}/`）

Agent 在"家庭群"中看不到"工作群"的任何数据。这是自然的多租户隔离。

### 4.4 消息 Piping

当 Agent 正在容器中运行时，用户又发了新消息怎么办？NanoClaw 的 IPC 支持"消息注入"——宿主机将新消息写入 `/workspace/ipc/input/`，Agent Runner 轮询检测并将其追加到当前对话上下文。不需要等 Agent 完成再处理。

---

## 五、存在的问题

### 5.1 🔴 Agent Swarms 根本性缺陷（Critical）

**GitHub Issue #684**（Priority: Critical）揭示了一个严重问题：

> *"Agent Swarms (Agent Teams) is a headline feature of NanoClaw, but it is fundamentally broken when running via the Claude Agent SDK `query()` API in containers."*

具体表现：
- 子 Agent 启动并开始执行，但在 2-7 次工具调用后**被静默终止**
- 原因：主 Agent 完成当前回合时，SDK 会终止其进程树下的所有子 Agent
- **没有文件产出**，feature 看起来在工作但实际没有完成任何任务

这是一个**架构级问题**——Claude Agent SDK 的 `query()` API 的生命周期模型与多 Agent 并行执行存在根本冲突。NanoClaw 无法在应用层修复 SDK 的行为。

### 5.2 🔴 网络隔离缺失（High）

**GitHub Issue #458**（Priority: High）指出：

> *"Agent containers currently run with unrestricted network access."*

容器虽然隔离了文件系统，但**网络完全敞开**。这意味着被 Prompt Injection 攻击的 Agent 可以：
1. 将挂载的文件数据外泄到攻击者服务器
2. 将 API 凭证（通过 Credential Proxy 传递的请求中可能包含 Token）外泄
3. 下载并执行任意恶意载荷
4. 扫描宿主机所在的内网

NanoClaw 官方 `SECURITY.md` 自己也承认："Network access: Unrestricted"。这是目前安全模型中**最大的漏洞**。

### 5.3 🟠 定时任务静默丢弃（High）

**GitHub Issue #830**（Priority: High）：

> *"When a scheduled task fires but the target session already has an active agent run, the fire event is silently dropped."*

如果定时任务触发时群组正在处理其他请求，该任务**直接丢弃，不重试、不延迟、不通知**。对于依赖定时任务的用户来说，这意味着任务会神秘地"不执行"。

### 5.4 🟠 Claude-Only 绑定

NanoClaw **完全依赖 Anthropic Claude Agent SDK**，不支持：
- OpenAI GPT 系列
- Google Gemini
- 本地模型（Ollama / vLLM）
- DeepSeek

这不是简单的"没适配"——整个架构（Agent Runner、Skill 系统、`CLAUDE.md`）都深度耦合到 Claude 生态。切换到其他模型意味着重写容器内的全部 Agent 逻辑。

社区的 **Issue #925** 尝试了 OpenRouter 兼容，但发现 SDK 返回的 `result` 字段为空，需要 fallback 逻辑处理。

### 5.5 🟠 "500 行"的营销与现实

NanoClaw 对外宣称"~500 行核心代码"，但实际上：

| 组件 | 代码量 |
|------|-------|
| 宿主机核心 (`src/`) | ~3,000 行 |
| Agent Runner (`container/`) | ~500 行 |
| Skills / 渠道代码 | ~2,000+ 行 |
| 配置、脚本、Dockerfile | ~500 行 |
| **实际总量** | **~6,000+ 行** |

"500 行"只是最初版本或 Agent Runner 单独的代码量。这本身不是问题（6,000 行仍然远小于 OpenClaw 的 43 万行），但**营销与现实的差距**可能误导用户的审计预期。

### 5.6 🟠 npm 供应链攻击面

社区安全文章（Medium / Vamshidhar）指出：

> *"NanoClaw has 220+ npm dependencies with supply chain attack surface. Runs as a Node.js process on your host with full user permissions."*

容器隔离了 Agent，但**宿主机进程本身**是一个拥有完整用户权限的 Node.js 进程，带有 220+ npm 依赖。如果任何依赖被投毒（类似 `event-stream` 事件），攻击者可以在宿主机上执行任意代码——绕过了所有容器隔离。

### 5.7 🟡 WhatsApp 底层 Baileys 不稳定

与 OpenClaw 一样，NanoClaw 使用 **Baileys**（WhatsApp 非官方逆向库）。GitHub Issue #923 涉及配对问题。这是整个 Claw 生态的共病——Baileys 本身不稳定，所有基于它的项目都面临断连、session 失效等问题。

### 5.8 🟡 Skill 生态不成熟

相比 OpenClaw 的 5,700+ 社区 Skill（ClawHub），NanoClaw 的 Skill 系统仍处于早期。GitHub Issue #384 讨论了 Skill 分发问题：

> *"The repo will drown in add-X-skill PRs, and the quality of implementations won't be optimal."*

目前 Skill 通过 PR 提交到主仓库，没有独立的注册中心、版本管理或安全审核流程。随着项目增长，这会成为瓶颈。

---

## 六、与 OpenClaw 的架构对比

| 维度 | OpenClaw | NanoClaw |
|------|---------|----------|
| **代码量** | 430,000+ 行 | ~6,000 行 |
| **架构** | 单体微服务，Gateway 长驻进程 | 双进程（Host + Container） |
| **安全边界** | 应用层（allowlist/denylist） | **OS 内核层（容器/VM）** |
| **凭证管理** | 环境变量直接注入 | **Credential Proxy 零信任** |
| **隔离粒度** | 无（默认）/ Docker（可选） | **每群组独立容器（默认）** |
| **模型支持** | 多模型（Claude/GPT/Gemini/Ollama） | Claude Only |
| **记忆存储** | Markdown 文件 + SQLite | **SQLite（事务一致性）** |
| **渠道支持** | 50+ | 主要 WhatsApp，Skill 扩展其他 |
| **Skill 生态** | 5,700+ (ClawHub) | 早期，PR-based |
| **安装复杂度** | 4+ 小时 | 3 步 / 15 分钟 |
| **可审计性** | 极低（43 万行） | **极高（一天可审计完）** |
| **Token 成本** | 失控（$50-100/天） | 未专门优化 |

---

## 七、总结评估

### 做对了什么

1. **安全架构降维打击**：将信任边界从应用层推到 OS 内核层，这是正确的方向。Andrej Karpathy 称 OpenClaw 为 "security nightmare"，NanoClaw 是目前最有说服力的回应。
2. **Credential Proxy**：独创设计，解决了所有其他方案忽视的 API Key 泄露问题。
3. **可审计性**：6,000 行可读代码 vs 43 万行不可审计代码，这不是量变是质变。
4. **AI-Native 扩展模型**：用 Claude Code 直接修改源码来扩展功能，比传统插件系统更透明。
5. **Apple Container 原生支持**：在 macOS 上实现了比 Docker 更强的硬件级虚拟化隔离。
6. **群组级记忆隔离**：自然的多租户隔离，不同群组的数据完全独立。

### 做错了什么

1. **网络隔离缺失**：文件系统隔离了，网络却完全敞开——这让整个安全故事有了一个巨大的缺口。
2. **Agent Swarms 名存实亡**：作为 headline feature 宣传，但实际上因为 SDK 生命周期问题根本无法正常工作。
3. **Claude-Only 锁定**：在 2026 年多模型竞争白热化的时代，绑死单一模型是一个高风险赌注。
4. **宿主机自身安全被忽视**：所有注意力都在容器隔离上，但宿主机 Node.js 进程本身的 220+ npm 依赖是一个未被讨论的攻击面。
5. **定时任务静默丢弃**：缺乏队列/重试机制，可靠性不足。

### 最终评价

NanoClaw 是目前 OpenClaw 生态中**安全理念最先进、架构最清晰**的替代方案。它的 Credential Proxy + 容器隔离组合在概念上领先其他所有竞品。但它也是一个**"安全至上"取向极强的项目**——为了安全和极简，牺牲了模型多样性、功能丰富度和生态成熟度。

### 对 light-claw 项目的启示

| 维度 | 启示 |
|------|------|
| **值得借鉴** | 容器隔离默认开启、Credential Proxy 凭证零信任、文件系统 IPC、群组级隔离 |
| **需要补上的短板** | 网络隔离策略、多模型支持、Token 成本控制、定时任务可靠性 |
| **可以做得更好** | Skill 分发机制（安全审核 + 版本管理）、宿主机供应链安全、Agent Swarms 正确实现 |

---

## 参考资料

### 官方资源
- [NanoClaw GitHub](https://github.com/qwibitai/nanoclaw) — 21,000+ Stars
- [NanoClaw 官网](https://nanoclaw.dev)
- [NanoClaw Security Model Blog](https://nanoclaw.dev/blog/nanoclaw-security-model/)

### 技术评测
- [500 Lines vs. 50 Modules: What NanoClaw Gets Right](https://fumics.in/posts/2026-02-02-nanoclaw-agent-architecture.html) — Sudheer Singh
- [NanoClaw Containerized AI Agents](https://thenewstack.io/nanoclaw-containerized-ai-agents/) — The New Stack
- [NanoClaw Deploy Guide](https://www.bitdoze.com/nanoclaw-deploy-guide/) — Bitdoze
- [Running NanoClaw Securely: A VM Isolation Approach](https://medium.com/@vamshidhar.pandrapagada/running-nanoclaw-securely-a-vm-isolation-approach-97175a6bd897) — Medium

### 媒体报道
- [NanoClaw solves OpenClaw's biggest security issue](https://novalogiq.com/2026/02/11/nanoclaw-solves-one-of-openclaws-biggest-security-issues-and-its-already-powering-the-creators-biz/) — NOVALOGIQ
- [NanoClaw Emerges as Safer OpenClaw Alternative](https://www.findarticles.com/nanoclaw-emerges-as-safer-openclaw-alternative/) — FindArticles
- [Want to try OpenClaw? NanoClaw is a simpler, safer AI agent](https://www.zdnet.com/article/nanoclaw-security-guide/) — ZDNET
- [OpenClaw, NanoClaw, and Skill Economy](https://jagans.substack.com/p/openclaw-nanoclaw-personal-ai-assistants) — Substack

### 安全分析
- [Securing Autonomous Agents: OpenClaw, IronClaw, NanoClaw](https://ibl.ai/blog/securing-autonomous-agents-what-openclaw-ironclaw-and-nanoclaw-teach-us-about-agent-security) — ibl.ai
- [OpenClaw Security Nightmare: Migrating to NanoClaw](https://medium.com/@anilkalm/openclaw-security-nightmare-nanoclaw-53d6ea843384) — Medium

### GitHub Issues（关键问题）
- [#684 Agent Swarms: subagents silently terminate](https://github.com/qwibitai/nanoclaw/issues/684) — Priority: Critical
- [#458 Network restrictions for containers](https://github.com/qwibitai/nanoclaw/issues/458) — Priority: High
- [#830 Scheduled tasks silently dropped](https://github.com/qwibitai/nanoclaw/issues/830) — Priority: High
- [#384 Skill marketplace/registry needed](https://github.com/qwibitai/nanoclaw/issues/384) — Priority: Medium
- [#925 OpenRouter compatibility](https://github.com/qwibitai/nanoclaw/issues/925)
- [#923 WhatsApp pairing issues](https://github.com/qwibitai/nanoclaw/issues/923)

### 社区讨论
- [Reddit r/ClaudeCode: NanoClaw discussion](https://www.reddit.com/r/ClaudeCode/comments/1r3qlht/nanoclaw_runs_on_claude_agent_sdk_each_agent_in/)
- [Reddit r/AI_Agents: OpenClaw security concerns](https://www.reddit.com/r/AI_Agents/comments/1r3u98p/openclaw_security_is_worse_than_i_expected_and_im/)
