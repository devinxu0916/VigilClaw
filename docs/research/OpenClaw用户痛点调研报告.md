# OpenClaw 用户痛点问题调研报告

> 调研日期：2026-03-10
> 数据来源：GitHub Issues (3,400+)、Reddit (r/AI_Agents, r/LocalLLaMA, r/vibecoding)、Medium、安全研究报告、社区讨论

## 目录

- [概述](#概述)
- [痛点一：Token 消耗与 API 成本失控](#痛点一token-消耗与-api-成本失控)
- [痛点二：消息通道连接不稳定](#痛点二消息通道连接不稳定)
- [痛点三：安装与配置门槛过高](#痛点三安装与配置门槛过高)
- [痛点四：上下文窗口与记忆系统缺陷](#痛点四上下文窗口与记忆系统缺陷)
- [痛点五：严重的安全问题](#痛点五严重的安全问题)
- [痛点六：Agent 执行不可靠](#痛点六agent-执行不可靠)
- [痛点七：性能缓慢](#痛点七性能缓慢)
- [痛点八：平台与生态不完善](#痛点八平台与生态不完善)
- [社区自救方案](#社区自救方案)
- [总结：痛点优先级矩阵](#总结痛点优先级矩阵)
- [参考资料](#参考资料)

---

## 概述

OpenClaw 在 2026 年初以惊人速度增长至 270K+ GitHub Stars，但在实际使用中暴露出大量痛点。社区总结者 @getmilodev 从 3,400+ GitHub Issues 和 Reddit 帖子中梳理出 Top 20 问题。核心痛点可归为八大类：**成本失控、连接不稳定、配置门槛高、记忆缺陷、安全隐患、执行不可靠、性能缓慢、生态不完善**。

---

## 痛点一：Token 消耗与 API 成本失控

### 严重程度：🔴 致命

这是用户反馈最密集、影响最广的问题。OpenClaw 被社区称为 "API Budget Burner"。

### 真实用户成本数据

| 用户类型 | 月成本 | 场景 |
|---------|--------|------|
| 重度用户 (Federico Viticci) | **$3,600/月** | 多通道密集自动化 |
| 过夜循环 Bug | **$200/24小时** | 爬虫陷入无限重试 |
| 日常工作助手 | **$180-240/月** | 正常每日使用 |
| 配置不当的简单自动化 | **$40/12条消息** | 默认配置未优化 |
| Linux VM 试用 | **$5/13小时** | 基本任务消耗 570 万 token |
| "随便玩玩"一个月 | **$187** | 自以为是轻度使用 |
| 开箱即用的默认配置 | **$50-100/天** | 未做任何优化 |

### 根因分析

#### 1. 工作区文件重复注入（93.5% token 浪费）

OpenClaw 将静态文件（`AGENTS.md`、`SOUL.md`、`USER.md`）注入到**每条消息**的系统提示词中。这些文件包含 agent 身份和规则——在对话过程中不会变化的内容。

- 典型配置中这些文件占 **35,600 tokens**
- 100 条消息的会话 = **340 万浪费 token**
- 约 $1.51/会话的纯浪费

> GitHub Issue [#9157](https://github.com/openclaw/openclaw/issues/9157)：Workspace files waste 93.5% of token budget（9 reactions）

#### 2. 工具输出无限存储

当 agent 执行 `find` 或 `config.schema` 等命令时，输出（往往数万 token）被完整写入 session 文件。每次后续请求都必须重新发送这些数据，无论是否相关。

#### 3. Cron 任务跨运行累积上下文

Cron 任务在多次运行间累积上下文，而非每次清零。

> GitHub Issue [#20092](https://github.com/openclaw/openclaw/issues/20092)：Cron jobs accumulate context across runs（7 reactions）

#### 4. 缓存未命中

Anthropic 提供 90% 折扣的提示词缓存，但缓存仅持续 5 分钟。如果 OpenClaw Heartbeat 每 10 分钟运行一次，或用户聊天间隔较大，每次请求都按全价计费。

---

## 痛点二：消息通道连接不稳定

### 严重程度：🔴 致命

连接稳定性是 AI 助手的生命线。这方面问题最多、最集中。

### WhatsApp — 重灾区

| 问题 | Issue | 详情 |
|------|-------|------|
| 链接卡在 "logging in" | [#4686](https://github.com/openclaw/openclaw/issues/4686) (16 reactions) | 初始链接成功后无法重新链接任何号码 |
| 每 ~35 分钟 stale-socket | [#34155](https://github.com/openclaw/openclaw/issues/34155) | 空闲连接准时断开，触发 health-monitor 重启循环 |
| Gateway 频繁断连，无自动恢复 | [#22511](https://github.com/openclaw/openclaw/issues/22511) | 每天多次崩溃，状态码 428/503/408/499，需手动重启 |
| 断连期间消息静默丢失 | [#30806](https://github.com/openclaw/openclaw/issues/30806) | 5-10 秒断连窗口内 agent 生成的回复永远无法送达，无错误提示 |
| 重连阻塞 Gateway 事件循环 | [#21474](https://github.com/openclaw/openclaw/issues/21474) | WhatsApp 重连逻辑阻塞 Node.js 事件循环，冻结所有其他通道 |
| 无自动重连机制 | [#11871](https://github.com/openclaw/openclaw/issues/11871) | WebSocket 会话掉线后不自动重连，需手动干预 |

### 其他通道

| 问题 | 详情 |
|------|------|
| Slack DM 回复不投递 | [#7663](https://github.com/openclaw/openclaw/issues/7663)：嵌入式/主 agent 的 Slack DM 回复无法送回 Slack（8 reactions） |
| Teams/Mattermost 静默失败 | 通道回复静默失败，无错误日志 |
| Discord 重启风暴 | [#36404](https://github.com/openclaw/openclaw/issues/36404)：一次 WebSocket 1006 断开事件导致 90+ 次 health-monitor 重启 |

### 核心问题

底层使用的 **Baileys**（WhatsApp 非官方逆向库）本身不稳定，加上 OpenClaw Gateway 的 health-monitor 策略设计缺陷（将 "disconnected" 错误分类为 "stuck"），导致级联重启风暴。

---

## 痛点三：安装与配置门槛过高

### 严重程度：🟠 严重

### 用户反馈

> "Even with my background (full-stack SDE), getting it running locally was a pain." — Reddit 用户 Kevin

> "It feels like an AI assistant built for engineers, but it's still very much a work in progress."

> "OpenClaw is worth it for tech-savvy users who are comfortable with the command line and willing to invest **10-20 hours** in setup and configuration. It is **not worth it** for non-technical users." — CAIO Review

### 具体问题

| 问题 | Issue | 影响 |
|------|-------|------|
| Docker 开箱即用失败 | [#5559](https://github.com/openclaw/openclaw/issues/5559) (9 reactions) | 新用户第一道门槛 |
| Gateway 启动失败：allowedOrigins 错误 | [#25009](https://github.com/openclaw/openclaw/issues/25009) (8 reactions) | 配置项不直观 |
| EC2/headless 服务器上 Gateway 失败 | [#11805](https://github.com/openclaw/openclaw/issues/11805) (7 reactions) | 无 GUI 环境部署困难 |
| Raspberry Pi 上 CLI 极慢 | [#5871](https://github.com/openclaw/openclaw/issues/5871) (12 reactions) | 低端硬件体验差 |
| 无 Linux/Windows 桌面应用 | [#75](https://github.com/openclaw/openclaw/issues/75) (**53 reactions**) | 非 macOS 用户无 GUI |
| 插件安装在多平台失败 | 社区反馈 | 跨平台兼容性差 |

### 安装时间

- 有经验的开发者：**4+ 小时**
- 非技术用户：**基本无法完成**
- 第三方托管服务（ClawTank, xCloud）因此应运而生：$24-50/月一键部署

---

## 痛点四：上下文窗口与记忆系统缺陷

### 严重程度：🟠 严重

### Compaction 死锁（最严重的 Bug）

> GitHub Issue [#40295](https://github.com/openclaw/openclaw/issues/40295)：Compaction deadlock blocks session recovery

当 Compaction（上下文压缩）超时（300s 或 600s），恢复命令（`/new`、`/reset`、`--reset-session`）排在 Compaction 后面的同一 session lane 中，无法执行。**唯一恢复方式是 `kill -9` + 手动重命名 session 文件**，用户报告花费约 1 小时才恢复。

### Compaction 悖论

> GitHub Issue [#20760](https://github.com/openclaw/openclaw/issues/20760)：Compaction fails due to token length longer than context window

悖论：为了防止 session 超过最大上下文窗口，需要执行 Compaction 来减小内容大小。但如果内容已经超过上下文窗口，Compaction 本身也会失败。Session 陷入死局。

### 其他记忆问题

| 问题 | 详情 |
|------|------|
| Compaction 破坏进行中的工作 | 社区 Top 20 问题之一 |
| 默认记忆功能损坏 | [#25633](https://github.com/openclaw/openclaw/discussions/25633) |
| 人格漂移（Persona Drift） | 长会话中系统提示词规则被挤出，agent 行为改变 |
| 工具幻觉（Tool Hallucination） | 工具 schema 细节在长会话中丢失 |
| 记忆碎片化 | 早期对话内容被丢弃 |
| Pre-compaction memoryFlush 默认阈值过小 | [#31435](https://github.com/openclaw/openclaw/issues/31435)：4000 token 不够做完整的 flush |

---

## 痛点五：严重的安全问题

### 严重程度：🔴 致命

安全问题被 CrowdStrike、Palo Alto Networks、Cisco 等多家安全公司定性为 "privacy nightmare" 和 "security dumpster fire"。

### 5.1 大规模实例暴露

- **135,000+** OpenClaw 实例暴露在公网（SecurityScorecard STRIKE 团队发现）
- 默认配置监听**所有网络接口**，大量用户从未修改
- ZeroLeaks 安全测试评分：**2/100**

> The Register: "More than 135,000 OpenClaw instances exposed to internet in latest vibe-coded disaster"

### 5.2 ClawHub 供应链攻击（ClawHavoc）

这是 2026 年最严重的 AI Agent 供应链安全事件。

| 数据点 | 数值 |
|--------|------|
| ClawHub 恶意 Skill 总数 | **820-1,467**（不同研究机构统计口径不同） |
| 占注册中心总量 | **~15-20%** |
| 单一攻击者账号（hightower6eu） | 314 个恶意 skill |
| 包含提示词注入的 Skill | **36%**（Snyk ToxicSkills 研究） |
| 恶意载荷数 | 1,467 个（Snyk 统计） |

#### 攻击手法

- 伪装成加密货币交易和生产力工具的 skill
- 安装后静默窃取 SSH 密钥、API 密钥、`.env` 文件
- 植入 macOS 信息窃取器（AMOS — Atomic macOS Stealer）
- 利用 Skill 名称 "What Would Elon Do?" 诱导下载
- 直接提示词注入绕过安全准则

> Snyk 报告：*"The first comprehensive security audit of the Agent Skills ecosystem reveals malware, credential theft, and prompt injection attacks targeting OpenClaw, Claude Code, and Cursor users"*

### 5.3 高危漏洞

| CVE | CVSS | 描述 |
|-----|------|------|
| CVE-2026-25253 | **8.8** | Control UI WebSocket 验证远程代码执行。攻击者一键即可窃取 gateway auth token，获得完整远程访问 |

### 5.4 其他安全缺陷

| 问题 | Issue |
|------|-------|
| API 密钥无加密存储 | [#7916](https://github.com/openclaw/openclaw/issues/7916) (7 reactions) |
| 无多用户访问控制 | [#8081](https://github.com/openclaw/openclaw/issues/8081) (11 reactions) |
| 默认配置暴露实例到公网 | 社区 Top 20 问题 |
| 提示词注入无真正安全边界 | Penligent AI 研究：*"The Security Boundary That Doesn't Exist"* |

### 5.5 Prompt Injection 的本质问题

> "In the era of autonomous agents like OpenClaw, prompt injection is no longer just a content moderation issue — it is an **authorization problem** disguised as a language problem."

当 agent 拥有文件、shell、API 密钥的访问权限时，成功的提示词注入等同于获得系统完整权限。

---

## 痛点六：Agent 执行不可靠

### 严重程度：🟠 严重

### 接受任务但不执行

> GitHub Issue [#40082](https://github.com/openclaw/openclaw/issues/40082)：OpenClaw accepts tasks but agents often do not execute them

- 系统表面接受了请求，但 agent 实际未完成任务
- UI 显示占位符回复
- 活动/日志可见性不一致
- 标记为 **regression**（之前正常，现在失败）

### 工具丢失

> GitHub Issue [#39062](https://github.com/openclaw/openclaw/issues/39062)：OpenClaw lost filesystem tools (exec/read/write)

- 更新到 2026.3.2 后，agent 停止执行文件系统相关命令
- 重启后工具短暂可用，几分钟后全部变为 "Tool not found"

### 循环失败

> GitHub Issue [#28576](https://github.com/openclaw/openclaw/issues/28576)：OpenClaw keeps hanging

Agent 自己的说明：
> *"My sincerest apologies. I got stuck in a loop of failures trying to update that Confluence page. My attempts to fix it got tangled in command-line complexity, leading to a cascade of errors."*

用户报告有人等了**三天**让 agent 构建一个简单的速度测试工具，持续收到 "almost done" 消息，同时 API 信用不断消耗。

### 浏览器控制不可靠

社区 Top 20 问题之一，浏览器自动化经常失败。

---

## 痛点七：性能缓慢

### 严重程度：🟡 中等

### 多因素叠加

1. **模型延迟**：
   - Claude Opus (Thinking)：5-15 秒
   - Claude Sonnet：2-8 秒
   - GPT-5 Nano / Haiku：<2 秒

2. **上下文膨胀**（真正杀手）：
   - 对话历史以纯文本 JSONL 存储在 `~/.openclaw/`
   - 默认尝试给 LLM 完整对话历史
   - 文件增长到 500KB-1MB+ 时系统处理大量数据仅回答简单问题
   - 用户称之为 "ghosting"——agent 沉默数分钟

3. **串行处理瓶颈**（Stop-and-Wait）：
   - Lane Queue 系统逐个处理任务
   - 每个任务经历多阶段，每步需要 LLM 往返
   - 需要 5 次工具调用的任务可能超过 1 分钟

### 典型性能表现

即使在高端硬件（Mac Studio M4, 64GB RAM）上，用户仍感到响应迟缓。

---

## 痛点八：平台与生态不完善

### 严重程度：🟡 中等

### 模型兼容性问题

| 问题 | Issue |
|------|-------|
| Gemini 输出虚假工具调用为文本 | [#3344](https://github.com/openclaw/openclaw/issues/3344) |
| 自定义 OpenAI 兼容 Provider 挂起 | 社区反馈 |
| Gemini 3.0 在 3.1 发布后被停用 | [#22559](https://github.com/openclaw/openclaw/issues/22559) (16 reactions) |

### 平台支持

- **无 Linux/Windows 桌面应用**：[#75](https://github.com/openclaw/openclaw/issues/75)（53 reactions，项目最高投票 issue 之一）
- macOS 优先策略导致非 Apple 用户体验差
- Raspberry Pi 等低端设备支持不佳

### 用户期望管理

> "It's clearly powerful if you know what you're doing... It feels like an AI assistant built for engineers." — Reddit 用户

> "This project is mainly all hype and only useful for a handful of people." — Reddit 用户

> "Honest advice: I don't think this project is for you right now." — Reddit 用户对新手建议

---

## 社区自救方案

### Clawdbot-Next（社区 Fork）

最重要的社区分支，正面解决 Token 成本问题：

| 技术 | 描述 | 效果 |
|------|------|------|
| **TGAA（Tiered Global Anchor Architecture）** | 将 agent 长期身份与短期对话上下文分离，最大化提示词缓存命中 | 成本降低 70-90% |
| **动态工具注入** | 使用 Intent Index Layer 扫描请求，仅注入所需工具定义 | 减少无关 token |
| **上下文三角定位** | 精确定位相关代码片段，而非发送整个代码库 | 大幅减少输入 token |

### 模型分级路由

| 层级 | 模型 | 价格/1M tokens | 用途 |
|------|------|---------------|------|
| Tier 1 | DeepSeek / GPT-5 Nano | $0.27 | 简单查询 |
| Tier 2 | GPT-4o-mini | $0.60 | 中等任务 |
| Tier 3 | Claude Sonnet 4.5 | $15.00 | 复杂执行 |
| Tier 4 | Claude Opus / o3 | $10-25 | 深度推理 |

### 实用优化建议

1. **定期重置会话**：完成项目后用 `/new` 清空膨胀的上下文
2. **使用压缩命令**：`/compact` 触发会话摘要
3. **设置上下文限制**：在 `openclaw.json` 中设 `contextTokens` 为 50,000-80,000（默认 400,000）
4. **隔离高风险操作**：在专用 `--session debug` 线程中执行大输出命令
5. **审计所有 Skill**：运行 `openclaw security audit --fix`
6. **调整超时**：主 agent 设为 600 秒，子 agent 按任务类型差异化
7. **轮换 Heartbeat 模式**：单一心跳轮换执行不同任务，避免冗余 API 调用

---

## 总结：痛点优先级矩阵

| 优先级 | 痛点 | 影响范围 | 严重程度 | 用户感知 |
|--------|------|---------|---------|---------|
| **P0** | Token 成本失控 | 所有 BYOK 用户 | 🔴 致命 | 直接经济损失，最高 $3,600/月 |
| **P0** | 安全问题（供应链+暴露） | 所有用户 | 🔴 致命 | 系统被攻破、数据泄露 |
| **P0** | WhatsApp 连接不稳定 | WhatsApp 用户（主力群体） | 🔴 致命 | 消息丢失、信任崩塌 |
| **P1** | Compaction 死锁 | 长会话用户 | 🟠 严重 | 需 kill -9 恢复，丢失 1 小时 |
| **P1** | Agent 执行不可靠 | 所有用户 | 🟠 严重 | 接受但不执行，工具丢失 |
| **P1** | 安装配置门槛 | 新用户 | 🟠 严重 | 10-20 小时配置时间，非技术用户无法使用 |
| **P2** | 性能缓慢 | 所有用户 | 🟡 中等 | Ghosting、分钟级等待 |
| **P2** | 平台支持不全 | 非 macOS 用户 | 🟡 中等 | 无 Linux/Windows GUI |
| **P2** | 模型兼容性 | 非 Claude 用户 | 🟡 中等 | Gemini 虚假工具调用等 |

### 一句话总结

> OpenClaw 代表了 AI Agent 的范式转变，但在 2026 年 3 月的当下，它仍然是一个 **"有强大功能但粗糙的工程师工具"** —— 成本不可控、安全千疮百孔、稳定性堪忧，距离大众可用还有很长的路要走。

---

## 参考资料

### GitHub Issues & Discussions
- [The 20 Biggest OpenClaw Problems in 2026](https://github.com/openclaw/openclaw/discussions/26472)
- [WhatsApp linking stuck](https://github.com/openclaw/openclaw/issues/4686)
- [Compaction deadlock](https://github.com/openclaw/openclaw/issues/40295)
- [Compaction fails due to token length](https://github.com/openclaw/openclaw/issues/20760)
- [Agent accepts but doesn't execute](https://github.com/openclaw/openclaw/issues/40082)
- [Lost filesystem tools](https://github.com/openclaw/openclaw/issues/39062)
- [WhatsApp Gateway disconnects](https://github.com/openclaw/openclaw/issues/22511)
- [WhatsApp stale-socket regression](https://github.com/openclaw/openclaw/issues/34155)
- [Context Budget Awareness](https://github.com/openclaw/openclaw/issues/35838)

### 安全研究
- [Snyk ToxicSkills Report](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
- [ClawHavoc Supply Chain Attack](https://openclawconsult.com/lab/openclaw-clawhavoc-supply-chain)
- [OpenClaw Security Crisis Analysis](https://openclaw.nasseroumer.com/blog/openclaw-security-crisis-2026/)
- [Dark Reading: Critical OpenClaw Vulnerability](https://www.darkreading.com/application-security/critical-openclaw-vulnerability-ai-agent-risks)
- [The Register: 135,000 exposed instances](https://www.theregister.com/2026/02/09/openclaw_instances_exposed_vibe_code/)
- [Penligent: Prompt Injection Problem](https://www.penligent.ai/hackinglabs/ja/the-openclaw-prompt-injection-problem-persistence-tool-hijack-and-the-security-boundary-that-doesnt-exist/)

### 用户体验与评测
- [API Budget Burnthrough](https://medium.com/@reza.ra/openclaw-the-ai-agent-that-burns-through-your-api-budget-and-how-to-fix-it-050fc57552c9)
- [OpenClaw Review: Is It Worth It?](https://www.thecaio.ai/blog/openclaw-review-worth-it)
- [Don't Use OpenClaw](https://medium.com/data-science-in-your-pocket/dont-use-openclaw-a6ea8645cfd4)
- [The Hype and Hurdles of OpenClaw](https://essayboard.com/2026/02/24/the-hype-and-hurdles-of-openclaw-insights-from-users-and-a-path-forward/)
- [First Impressions and Frustrations (Reddit)](https://www.reddit.com/r/AskClaw/comments/1rkmo0n/i_spent_a_day_with_openclaw_my_first_impressions/)
- [What held up, what didn't](https://aimightbewrong.substack.com/p/openclaw-clawdbot-turned-it-off)

### 优化指南
- [Cut Token Costs by 77%](https://clawhosters.com/blog/posts/openclaw-token-costs-optimization)
- [Setup Guide: Six Weeks of Lessons](https://claudius.blog/blog/openclaw-setup-guide-6-weeks/)
- [Troubleshooting Guide](https://www.gauraw.com/openclaw-troubleshooting-guide-2026/)
