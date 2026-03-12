# OpenClaw 轻量级平替项目深度调研报告

> 调研日期：2026-03-10
> 数据来源：GitHub、KDnuggets、Turing Post、Zack AI、Till Freitag、ScriptByAI、社区评测

## 目录

- [概述](#概述)
- [全景对比表](#全景对比表)
- [Top 1：Nanobot — 极简主义之王](#top-1nanobot--极简主义之王)
- [Top 2：NanoClaw — 安全隔离冠军](#top-2nanoclaw--安全隔离冠军)
- [Top 3：ZeroClaw — 性能极限挑战者](#top-3zeroclaw--性能极限挑战者)
- [Top 4：GoClaw — Go 语言多 Agent 网关](#top-4goclaw--go-语言多-agent-网关)
- [Top 5：NullClaw — 极致最小化](#top-5nullclaw--极致最小化)
- [Top 6：PicoClaw — 超低资源硬件方案](#top-6picoclaw--超低资源硬件方案)
- [Top 7：IronClaw — WASM 沙箱安全标杆](#top-7ironclaw--wasm-沙箱安全标杆)
- [其他值得关注的项目](#其他值得关注的项目)
- [非 Agent 类但相关的补充方案](#非-agent-类但相关的补充方案)
- [痛点解决矩阵](#痛点解决矩阵)
- [选型决策指南](#选型决策指南)
- [对 light-claw 项目的启示](#对-light-claw-项目的启示)
- [参考资料](#参考资料)

---

## 概述

OpenClaw 的 430,000+ 行 TypeScript 代码既是它的优势（功能全面），也是它最大的负债（攻击面、复杂度、资源消耗）。社区在 2026 年初涌现出大量轻量替代方案，核心思路可归为三个流派：

| 流派 | 代表项目 | 核心理念 |
|------|---------|---------|
| **极简主义** | Nanobot, NullClaw | 用最少代码实现 Agent 核心功能 |
| **安全优先** | NanoClaw, IronClaw | 通过隔离机制（容器/WASM）解决安全问题 |
| **性能优先** | ZeroClaw, PicoClaw | 编译型语言 + 极小二进制，跑在边缘硬件 |

---

## 全景对比表

| 项目 | Stars | 语言 | 代码量 | 二进制/包大小 | 冷启动 | 内存占用 | LLM 支持 | 消息通道 | 安全模型 | 最佳场景 |
|------|-------|------|--------|-------------|--------|---------|---------|---------|---------|---------|
| **OpenClaw** | 295K | TypeScript | 430K 行 | ~200MB+ | 8-12s | 500MB+ | 多模型 | 50+ | 弱（多CVE） | 全能型，高风险 |
| **Nanobot** | 26.8K | Python | 4K 行 | ~45MB | 0.8s | 45MB | 11+ Provider | Telegram/WhatsApp/Discord/Slack/Email | 白名单 | 学习/研究/轻量部署 |
| **NanoClaw** | 7K | TypeScript | ~500 行 | - | ~2-3s | ~150MB | Claude 专用 | WhatsApp | 容器隔离 | 安全至上团队 |
| **ZeroClaw** | 5.2K-15.7K | Rust | - | 3.4MB | <10ms | <5MB | 20+ Provider | Telegram/Discord/WhatsApp/Slack/Email | 最小攻击面 | 边缘/IoT 设备 |
| **GoClaw** | 608 | Go | - | 单一二进制 | 快速 | 低 | 11+ Provider | 5 通道 | 团队隔离 | 多 Agent 编排 |
| **NullClaw** | 2.6K | Zig | - | **678KB** | 极快 | 极低 | 22+ Provider | 17 通道 | 零依赖 | 极端资源受限环境 |
| **PicoClaw** | 21.6K | Go | - | - | 1s | <10MB | - | Discord/WeCom | - | $10 硬件 |
| **IronClaw** | 3.1K | Rust | - | - | - | - | 多模型 | - | WASM 沙箱 | 最高安全需求 |

---

## Top 1：Nanobot — 极简主义之王

### 基本信息

| 维度 | 详情 |
|------|------|
| 开发者 | 香港大学数据智能实验室（HKU Data Intelligence Lab） |
| GitHub | [HKUDS/nanobot](https://github.com/HKUDS/nanobot) |
| Stars | **26,800+** |
| 语言 | Python（~4,000 行） |
| 许可证 | MIT |
| 定位 | "Ultra-lightweight Clawdbot alternative" |

### 为什么是 Top 1

Nanobot 是目前最成功的 OpenClaw 轻量替代——**26,800+ Stars**，来自顶级学术机构，仅 4,000 行可审计的 Python 代码，比 OpenClaw 小 **99%**。

### 核心特性

- **极致精简**：4,000 行 vs OpenClaw 的 430,000 行。整个代码库一个下午可以读完
- **多 LLM 支持**：OpenRouter、Anthropic Claude、OpenAI GPT、Groq、Google Gemini、DeepSeek、本地 vLLM
- **MCP 支持**：v0.1.4 起支持 Model Context Protocol
- **多通道**：Telegram、WhatsApp、Discord、Slack、Email
- **持久记忆**：跨会话保持对话上下文和用户偏好
- **语音转写**：Groq Whisper 集成，自动转写 Telegram 语音消息
- **Cron 任务调度**：标准 cron 语法或间隔调度
- **Web 搜索**：可选 Brave Search API 集成
- **本地模型**：支持 vLLM 或任何 OpenAI 兼容推理服务器，数据完全不出机器

### 安装（30 秒）

```bash
# 方式一：uv 安装
uv tool install nanobot-ai

# 方式二：pip 安装
pip install nanobot-ai

# 方式三：源码安装
git clone https://github.com/HKUDS/nanobot.git && cd nanobot && pip install -e .

# 初始化配置
nanobot onboard

# 启动网关
nanobot gateway
```

### 与 OpenClaw 关键差异

| 维度 | Nanobot | OpenClaw |
|------|---------|---------|
| 代码量 | ~4,000 行 | 430,000+ 行 |
| 启动时间 | 0.8 秒 | 8-12 秒 |
| 内存占用 | 45MB | 500MB+ |
| 可审计性 | 高（1小时读完） | 低（复杂抽象） |
| 插件系统 | 手动/极简 | 大型（ClawHub） |
| 安装 | 单命令 | 多步骤（Docker/VPS/Nix） |

### 局限性

- 生态系统年轻，预置 Skill 较少
- 没有 GUI，完全依赖 CLI 和 JSON 配置
- 没有插件市场
- 对非技术用户仍有门槛

### 评分：⭐⭐⭐⭐ (4.0/5)

---

## Top 2：NanoClaw — 安全隔离冠军

### 基本信息

| 维度 | 详情 |
|------|------|
| 开发者 | Gavriel Cohen（前 Wix 开发者） |
| GitHub | [gavrielc/nanoclaw](https://github.com/gavrielc/nanoclaw) |
| Stars | **7,000+** |
| 语言 | TypeScript（~500 行，~15 源文件） |
| 许可证 | MIT |
| 版本 | v0.4.2（生产就绪） |
| 定位 | "Security-first personal Claude assistant" |

### 为什么是 Top 2

NanoClaw 从根本上解决了 OpenClaw 最致命的安全问题——**容器隔离**。VentureBeat 评价它解决了"OpenClaw 最大的安全缺陷之一"。

### 核心架构

```
OpenClaw: 430,000 行，微服务架构，无隔离
    ↓ 彻底简化
NanoClaw: 500 行，单进程，5个核心文件，容器隔离
```

### 核心特性

- **容器隔离**：Agent 运行在 Linux 容器内（macOS: Apple Container, Linux: Docker），即使 agent 失控也只影响沙箱
- **原生 WhatsApp**：每个 WhatsApp 群组获得独立的上下文和记忆文件
- **Agent Swarms**：首个支持"agent 群"的个人 AI，多个 Claude 实例协同工作
- **每组记忆隔离**：SQLite 消息存储，按组排队和并发控制
- **内置任务调度器**：无需外部依赖
- **Claude Agent SDK**：直接集成 Anthropic 的 Agent SDK

### 安装（3 步）

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
claude   # → /setup
```

Claude Code 自动处理依赖、认证、容器设置和服务配置。

### 硬件要求

- Raspberry Pi 4（4GB+ RAM）即可运行
- Mac mini Apple Silicon
- 任何 16GB+ RAM 的现代 PC

### 局限性

- **仅支持 Claude**——没有多 LLM 支持
- 需要容器运行时（Docker 或 Apple Container）
- 插件生态极小
- 不支持企业级集成（Jira、Salesforce 等）
- 社区较小

### 评分：⭐⭐⭐⭐ (4.0/5)

---

## Top 3：ZeroClaw — 性能极限挑战者

### 基本信息

| 维度 | 详情 |
|------|------|
| 开发者 | 来自 Harvard、MIT、Sundai.Club 的贡献者 |
| GitHub | [zeroclaw](https://zeroclaw.dev) |
| Stars | **5,200-15,700**（统计口径不一） |
| 语言 | Rust |
| 二进制大小 | **3.4MB** |
| 许可证 | MIT |
| 定位 | "Runs on $10 hardware" |

### 为什么是 Top 3

ZeroClaw 用 Rust 将 AI Agent 推到了性能极限：**3.4MB 二进制**、**<10ms 冷启动**（比替代品快 400 倍）、**<5MB 内存**，可在 **$10 边缘设备**上运行。

### 核心特性

- **极致性能**：3.4MB 编译二进制，<10ms 冷启动，<5MB 内存
- **20+ LLM Provider**：OpenAI、Anthropic、Ollama、Mistral 等
- **5 消息通道**：Telegram、Discord、WhatsApp、Slack、Email
- **Trait-based 架构**：通过配置切换 LLM Provider、通道和记忆后端，无需修改代码
- **最小攻击面**：代码量小 = 潜在漏洞少

### 与 NanoClaw 对比

| 维度 | ZeroClaw | NanoClaw |
|------|----------|----------|
| 语言 | Rust | TypeScript |
| 二进制大小 | 3.4MB | ~15 源文件 |
| 隔离方式 | 进程 + 内存安全 | Linux 容器 |
| 冷启动 | <10ms | ~2-3s（容器启动） |
| 内存占用 | <5MB | ~150MB（容器开销） |
| LLM 支持 | 20+ Provider | Claude 专用 |
| 最佳场景 | 边缘设备/IoT/RPi | 开发机/安全优先团队 |

### 局限性

- 自定义修改需要 Rust 知识
- 社区较小，文档较少
- 注意假冒域名：zeroclaw.org 非官方（官方是 zeroclaw.dev）

### 评分：⭐⭐⭐⭐✨ (4.5/5)

---

## Top 4：GoClaw — Go 语言多 Agent 网关

### 基本信息

| 维度 | 详情 |
|------|------|
| GitHub | [nextlevelbuilder/goclaw](https://github.com/nextlevelbuilder/goclaw) |
| Stars | **608** |
| 语言 | Go (69.7%) + TypeScript (29.4%) |
| 数据库 | PostgreSQL |
| 许可证 | - |
| 版本 | v1.1.0（2026-03-09） |
| 定位 | "Multi-agent AI gateway with teams, delegation & orchestration" |

### 为什么值得关注

GoClaw 是少有的原生支持**多 Agent 编排**的轻量方案——团队、委托、编排，单一 Go 二进制。

### 核心特性

- **多 Agent 编排**：团队、委托、任务分配
- **11+ LLM Provider**
- **5 消息通道**
- **Go 单二进制**：部署简单
- **PostgreSQL 后端**：比 SQLite 更适合团队场景
- **活跃开发**：20 贡献者，9 个 release，最新推送仅 1 天前

### 局限性

- Stars 较少（608），社区早期
- 需要 PostgreSQL 依赖
- 文档尚不完善

### 评分：⭐⭐⭐ (3.0/5) — 潜力项目

---

## Top 5：NullClaw — 极致最小化

### 基本信息

| 维度 | 详情 |
|------|------|
| Stars | **2,600+** |
| 语言 | **Zig** |
| 二进制大小 | **678KB** |
| 许可证 | MIT |
| 定位 | "The minimalist among agents" |

### 为什么值得关注

NullClaw 将最小化推到极致：一个 **678KB** 的单一静态编译二进制。没有 Node.js，没有 Python，没有任何运行时依赖。

### 核心特性

- **最小体积**：678KB 单一二进制——全场最小
- **零依赖**：静态编译，几乎可在任何硬件上运行
- **22+ LLM Provider**：OpenAI、Anthropic、Mistral、Ollama 等
- **17 消息通道**：从 Slack 到 Telegram 到 Discord
- **Edge-ready**：IoT、Raspberry Pi、嵌入式系统

### 安装

```bash
curl -sSL https://nullclaw.dev/install.sh | bash
nullclaw --llm ollama --model llama3
```

### 局限性

- Zig 语言非常小众——自定义插件需要 Zig 专业知识
- 社区年轻（2,600 stars），文档不足
- 生态尚不成熟

### 评分：⭐⭐⭐✨ (3.5/5)

---

## Top 6：PicoClaw — 超低资源硬件方案

### 基本信息

| 维度 | 详情 |
|------|------|
| 开发者 | Sipeed（硬件公司） |
| GitHub | [sipeed/picoclaw](https://github.com/sipeed/picoclaw) |
| Stars | **21,600+** |
| 语言 | Go |
| 许可证 | - |
| 定位 | "Personal AI assistants on $10 hardware with under 10MB RAM" |

### 为什么值得关注

PicoClaw 由硬件公司开发，专为**超低资源环境**设计：10MB RAM、1 秒启动。**21,600+ Stars** 说明社区认可度很高。

### 核心特性

- 纯 Go 实现，超低资源占用
- $10 硬件即可运行
- <10MB RAM
- 1 秒启动
- Discord/WeCom 集成
- 从 Nanobot 用 Go 重构而来，由 AI 自引导迁移

### 评分：⭐⭐⭐✨ (3.5/5)

---

## Top 7：IronClaw — WASM 沙箱安全标杆

### 基本信息

| 维度 | 详情 |
|------|------|
| 开发者 | NEAR AI |
| GitHub | [nearai/ironclaw](https://github.com/nearai/ironclaw) |
| Stars | **3,100+** |
| 语言 | Rust |
| 许可证 | - |
| 定位 | "WASM-sandboxed AI agent with capability-based permissions" |

### 为什么值得关注

IronClaw 拥有**全场最强的安全模型**：WebAssembly 沙箱 + 基于能力的权限系统。

### 核心特性

- **WASM 沙箱**：不可信工具在 WebAssembly 沙箱中执行
- **能力型权限**：细粒度权限控制（端点白名单、凭证注入、泄露检测、速率限制）
- **动态工具构建**：描述需求，自动构建 WASM 工具
- **资源限制**：内存、CPU、执行时间受控

### 局限性

- 社区最小（3,100 stars）
- WASM 增加复杂度
- 与 NEAR 生态有一定绑定
- 适合最高安全需求，非通用场景

### 评分：⭐⭐⭐✨ (3.5/5)

---

## 其他值得关注的项目

### Clawlet — 2 分钟启动的 Agent 框架

| 维度 | 详情 |
|------|------|
| GitHub | [Kxrbx/Clawlet](https://github.com/Kxrbx/Clawlet) |
| Stars | 10 |
| 语言 | Python (90.5%) |
| 定位 | "Lightweight AI agent framework with identity awareness, get up and running in 2 minutes" |

极早期项目，但理念清晰：身份感知的轻量 Agent 框架。

### BunClaw — Bun 原生运行时

| 维度 | 详情 |
|------|------|
| GitHub | [tobalo/bunclaw](https://github.com/tobalo/bunclaw)（NanoClaw fork） |
| Stars | 15 |
| 语言 | TypeScript (98.2%) |
| 定位 | Bun 原生运行时，集成 Anthropic Agents SDK |

NanoClaw 的 Bun 运行时变体。

### OpenClaw Zero Token — 零 API 成本方案

| 维度 | 详情 |
|------|------|
| GitHub | [linuxhsj/openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) |
| Stars | **1,231** |
| 定位 | 通过浏览器认证免费使用 AI 模型（ChatGPT、Claude、Gemini、DeepSeek 等） |

注意：通过浏览器 session 调用模型，存在合规和稳定性风险。

### Moltworker — 无服务器方案

Cloudflare 官方将 OpenClaw 适配到 **Cloudflare Workers**。Agent 运行在无服务器沙箱中，无本地系统访问权限。

---

## 非 Agent 类但相关的补充方案

### memU — 记忆层框架

| 维度 | 详情 |
|------|------|
| Stars | 6,900+ |
| 定位 | 不是 Agent，而是**记忆框架**——将平面对话历史转为层次化知识图谱 |
| 核心 | 记忆化、检索、自演化三大流程 |
| 意义 | 解决 OpenClaw 最大的记忆痛点——Token 浪费和上下文遗忘 |

### qmd — 本地语义搜索引擎

| 维度 | 详情 |
|------|------|
| 开发者 | Shopify 创始人 Tobi |
| 语言 | Rust |
| 定位 | 完全本地的语义搜索引擎，95%+ 准确率，零持续成本 |
| 意义 | 替代 OpenClaw 的嵌入向量检索，消除外部依赖 |

### n8n — 企业级工作流平台

| 维度 | 详情 |
|------|------|
| Stars | 50,000+ |
| 估值 | $2.5B |
| 定位 | 可视化工作流自动化平台，400+ 集成，SOC 2 审计 |
| 对比 | 不是个人 AI 助手，是工作流引擎——不同品类 |

### Jan.ai — 完全离线方案

| 维度 | 详情 |
|------|------|
| Stars | 40,500+ |
| 引擎 | Cortex.cpp（支持 llama.cpp、ONNX、TensorRT-LLM） |
| 下载量 | 470 万+ |
| 定位 | 100% 离线 ChatGPT 替代品，零数据泄露 |

---

## 痛点解决矩阵

OpenClaw 八大痛点 vs 各替代方案的解决程度：

| 痛点 | Nanobot | NanoClaw | ZeroClaw | GoClaw | NullClaw | PicoClaw | IronClaw |
|------|---------|----------|----------|--------|----------|----------|----------|
| Token 成本失控 | ✅ 精简上下文 | ⚠️ 未专门优化 | ✅ 极低开销 | ⚠️ 未知 | ✅ 极低开销 | ✅ 极低开销 | ⚠️ 未专门优化 |
| 安全问题 | ⚠️ 白名单仅 | ✅ **容器隔离** | ✅ 最小攻击面 | ⚠️ 基本 | ⚠️ 基本 | ⚠️ 基本 | ✅ **WASM沙箱** |
| 连接不稳定 | ⚠️ 同样用Baileys | ⚠️ 同样问题 | ⚠️ 自实现 | ⚠️ 自实现 | ⚠️ 自实现 | ⚠️ 仅Discord/WeCom | ❌ 无消息通道 |
| Compaction 死锁 | ✅ 简单设计避免 | ✅ 简单设计避免 | ✅ 简单设计避免 | ⚠️ 未知 | ✅ 简单设计避免 | ✅ 简单设计避免 | ✅ 简单设计避免 |
| Agent 执行不可靠 | ⚠️ 取决于模型 | ⚠️ 取决于模型 | ⚠️ 取决于模型 | ⚠️ 取决于模型 | ⚠️ 取决于模型 | ⚠️ 取决于模型 | ⚠️ 取决于模型 |
| 安装门槛高 | ✅ **单命令安装** | ✅ 3步安装 | ✅ 单命令 | ⚠️ 需 PostgreSQL | ✅ 单命令 | ✅ 简单 | ⚠️ 复杂 |
| 性能缓慢 | ✅ 0.8s 启动 | ⚠️ 2-3s | ✅ **<10ms** | ✅ Go 性能好 | ✅ 极快 | ✅ 1s 启动 | ⚠️ WASM 开销 |
| 平台支持不全 | ⚠️ 无GUI | ⚠️ 无GUI | ⚠️ 无GUI | ⚠️ 无GUI | ⚠️ 无GUI | ⚠️ 无GUI | ⚠️ 无GUI |

**图例：** ✅ 解决 | ⚠️ 部分解决/未知 | ❌ 未解决

---

## 选型决策指南

### 按需求选择

| 你的需求 | 推荐方案 | 理由 |
|---------|---------|------|
| 想理解 Agent 怎么工作 | **Nanobot** | 4,000 行可读代码，学术背景 |
| 安全第一，团队使用 | **NanoClaw** | 容器隔离，VentureBeat 背书 |
| $10 边缘设备部署 | **ZeroClaw** | 3.4MB，<10ms，<5MB 内存 |
| 极端资源受限环境 | **NullClaw** | 678KB，零依赖 |
| $10 超低端硬件 | **PicoClaw** | 10MB RAM 即可 |
| 多 Agent 团队编排 | **GoClaw** | 原生团队/委托/编排 |
| 最高安全等级 | **IronClaw** | WASM 沙箱 + 能力型权限 |
| 完全离线/隐私 | **Jan.ai** | 100% 离线，零数据泄露 |
| 企业工作流 | **n8n** | $2.5B 估值，SOC 2 审计 |
| 解决记忆问题 | **memU** + 任何Agent | 知识图谱记忆层 |

### 按技术栈选择

| 你熟悉的语言 | 推荐方案 |
|-------------|---------|
| Python | Nanobot |
| TypeScript | NanoClaw, GoClaw（前端部分） |
| Go | GoClaw, PicoClaw |
| Rust | ZeroClaw, IronClaw |
| Zig | NullClaw |

### 组合推荐

社区共识是**没有单一方案能解决所有问题**，最佳实践是组合使用：

1. **日常 Agent**：NanoClaw（安全）或 Nanobot（轻量）
2. **记忆层**：memU（知识图谱）或 qmd（本地语义搜索）
3. **工作流编排**：n8n（企业级）
4. **代码辅助**：Claude Code 或 OpenCode

---

## 对 light-claw 项目的启示

基于本次调研，如果你要构建一个更好的轻量级 AI Agent 平台，以下是市场空白和设计启示：

### 1. 尚未解决的核心问题

- **WhatsApp/消息通道稳定性**：所有替代方案都面临同样的 Baileys 不稳定问题，没有人真正解决
- **Token 成本智能管理**：没有替代方案内置模型分级路由（Tier 1-4）和预算控制
- **非技术用户友好性**：所有方案仍然是 CLI + JSON 配置，无 GUI
- **记忆系统 + Agent 的深度整合**：memU 和 Agent 是分离的，没有内置知识图谱的 Agent

### 2. 可参考的最佳实践

| 实践 | 来源 |
|------|------|
| 容器隔离作为默认安全模型 | NanoClaw |
| 编译型语言 + 最小二进制 | ZeroClaw / NullClaw |
| 4,000 行可审计代码哲学 | Nanobot |
| 多 Agent 团队编排 | GoClaw |
| WASM 沙箱精细权限 | IronClaw |
| 知识图谱记忆 | memU |
| 模型分级路由降成本 | Clawdbot-Next（社区 Fork） |

### 3. 差异化机会

一个理想的 "light-claw" 可以在以下维度形成差异化：

1. **内置成本控制**：模型分级路由 + 预算上限 + 缓存优化
2. **默认安全**：容器隔离开箱即用，不是可选项
3. **消息通道稳定性**：解决 WhatsApp Baileys 断连问题（消息队列 + 重连策略）
4. **精简但完整**：目标 5,000-10,000 行代码，但覆盖核心功能
5. **内置记忆系统**：知识图谱式记忆，而非平面 Markdown 文件
6. **可视化管理界面**：Web UI 降低配置门槛

---

## 参考资料

### 综合对比
- [KDnuggets: 5 Lightweight OpenClaw Alternatives](https://www.kdnuggets.com/5-lightweight-and-secure-openclaw-alternatives-to-try-right-now)
- [Till Freitag: Best OpenClaw Alternatives 2026](https://till-freitag.com/blog/openclaw-alternatives-en)
- [Zack AI: Every AI Agent Tested & Compared](https://zackbot.ai/blog/the-2026-ai-agent-landscape-openclaw-its-alternatives-and-what-actually-works/)
- [Turing Post: OpenClaw Explained + Alternatives](https://www.turingpost.com/p/openclaw)
- [Adopt AI: 5 Enterprise OpenClaw Alternatives](https://www.adopt.ai/blog/open-source-enterprise-openclaw-alternatives)
- [OpenClaw Guide: Honest Comparison](https://openclawguide.io/guides/alternatives)
- [FlyPix: 9 Safer AI Agent Tools](https://flypix.ai/best-openclaw-alternatives/)
- [o-mega: Top 10 Alternatives](https://o-mega.ai/articles/top-10-openclaw-alternatives-2026)

### 项目特写
- [NanoClaw Deep Dive](https://till-freitag.com/en/blog/nanoclaw-openclaw-successor-en)
- [Nanobot Analysis](https://www.scriptbyai.com/nanobot-ai-assistant/)
- [PicoClaw on ToolHunter](https://www.toolhunter.cc/tools/picoclaw)
- [KiloClaw vs OpenClaw](https://apidog.com/blog/kiloclaw-vs-openclaw/)

### GitHub 仓库
- [Nanobot](https://github.com/HKUDS/nanobot) — 26,800+ Stars
- [NanoClaw](https://github.com/gavrielc/nanoclaw) — 7,000+ Stars
- [GoClaw](https://github.com/nextlevelbuilder/goclaw) — 608 Stars
- [PicoClaw](https://github.com/sipeed/picoclaw) — 21,600+ Stars
- [IronClaw](https://github.com/nearai/ironclaw) — 3,100+ Stars
- [Clawlet](https://github.com/Kxrbx/Clawlet) — 10 Stars
- [BunClaw](https://github.com/tobalo/bunclaw) — 15 Stars
- [awesome-openclaw](https://github.com/rohitg00/awesome-openclaw) — 380 Stars
