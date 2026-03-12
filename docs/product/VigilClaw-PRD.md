# VigilClaw 产品需求文档 (PRD)

## 文档元信息

| 属性 | 值 |
|------|-----|
| 文档版本 | v1.0.0 |
| 创建日期 | 2026-03-10 |
| 最后更新 | 2026-03-10 |
| 作者 | VigilClaw 产品团队 |
| 状态 | 待评审 |
| 目标版本 | MVP (Phase 1) |

---

## 1. 产品愿景与定位

### 1.1 产品定位

VigilClaw 是一个面向社区的开源个人 AI 助手，专注解决现有方案的安全和成本痛点。借鉴 NanoClaw 的轻量架构思想，补齐其安全短板，做一个真正可信赖的 OpenClaw 替代方案。

**核心价值主张：**
- **安全即默认**：开箱即用的容器隔离 + 网络限制 + 凭证零信任
- **成本可控**：内置预算管理和智能模型路由，避免意外账单
- **轻量可审计**：目标 5,000-10,000 行代码，开发者可以完整理解系统
- **稳定优先**：选择经过生产验证的技术栈，拒绝不成熟方案

### 1.2 命名寓意

- **Vigil**：守夜人/警戒 —— 传达安全守护的品牌调性
- **Claw**：保留 OpenClaw 生态归属感，降低用户认知成本

### 1.3 市场空白

当前 AI 助手开源方案存在明显断层：

| 维度 | OpenClaw | NanoClaw | Nanobot | VigilClaw (目标) |
|------|----------|----------|---------|-----------------|
| 代码量 | 430,000 行 | 6,000 行 | 4,000 行 | 5,000-10,000 行 |
| 安全评分 | 2/100 | 未知 (网络敞开) | 0 (无隔离) | 90+ |
| 容器隔离 | ✗ | ✓ (部分) | ✗ | ✓ (完整) |
| 网络限制 | ✗ | ✗ | ✗ | ✓ |
| 成本控制 | ✗ | ✗ | ✗ | ✓ |
| 多模型支持 | ✓ | ✗ (Claude Only) | 有限 | ✓ (Provider 抽象) |
| 启动速度 | 8-12s | ~2s | 0.8s | <3s (目标) |

VigilClaw 填补"轻量 + 安全 + 成本可控"的空白位置。

---

## 2. 目标用户画像

### 2.1 主要用户群体

**P0 用户：技术开发者 (迁移用户)**
- 特征：有 Docker/CLI 基础，正在使用 OpenClaw/NanoClaw
- 痛点：
  - OpenClaw 成本 $50-100/天，安全漏洞频出 (135,000+ 实例暴露公网)
  - NanoClaw 网络未限制 (Issue #458)，定时任务丢失 (Issue #830)
  - 供应链风险 (220+ npm 依赖)
- 需求：保持功能的前提下，获得可靠的安全保障和成本透明度

**P1 用户：自托管爱好者**
- 特征：熟悉 Docker Compose，偏好数据本地存储
- 痛点：现有方案配置复杂 (4+ 小时)，缺少文档
- 需求：30 分钟内完成部署，数据完全可控

**P2 用户：小团队 (2-5 人)**
- 特征：共享 API Key，需要成本分摊
- 痛点：无法追踪个人消耗，账单失控
- 需求：按用户/群组统计消耗，设置预算上限

### 2.2 非目标用户

- 完全不懂技术的普通用户 (需要图形化安装器，不在 MVP 范围)
- 企业级部署 (需要 SSO、审计日志、多租户隔离，后续版本考虑)
- 需要复杂多 Agent 协作的场景 (个人助手场景 90%+ 是单目标任务)

---

## 3. 竞品分析摘要

### 3.1 OpenClaw

**优势：**
- 生态成熟，295K Stars，功能最全
- 多模型支持完善

**劣势 (VigilClaw 的机会点)：**
- 代码膨胀：430,000 行 TS，普通开发者无法审计
- 安全灾难：135,000+ 实例暴露公网，安全评分 2/100
- 成本失控：日均 $50-100，无预算控制
- 性能差：8-12s 冷启动，500MB+ 内存占用

### 3.2 NanoClaw

**优势：**
- 轻量：~6,000 行 TS，21K Stars
- 架构清晰：双进程 + 容器隔离
- Claude 体验优秀

**劣势 (VigilClaw 要补齐的)：**
- 网络完全敞开 (Issue #458)，容器可访问任意外网
- Claude-Only，无法切换其他模型
- 定时任务静默丢弃 (Issue #830)
- Agent Swarms 功能已损坏 (Issue #684)
- 220+ npm 依赖，供应链风险高

### 3.3 Nanobot

**优势：**
- 极致轻量：4,000 行 Python，26.8K Stars
- 启动速度：0.8s，内存仅 45MB

**劣势：**
- 无容器隔离，安全性为 0
- 功能有限，不适合复杂场景

### 3.4 ZeroClaw

**优势：**
- Rust 实现，3.4MB 二进制，<10ms 冷启动，<5MB 内存

**劣势：**
- 开发门槛高，社区小
- 生态缺失

### 3.5 差异化总结

VigilClaw = NanoClaw 的轻量架构 + OpenClaw 的多模型支持 + 网络安全加固 + 成本控制 + 供应链精简

---

## 4. 核心设计原则

### 原则 1：安全即默认

容器隔离 + 网络限制 + 凭证零信任，用户无需配置即可获得生产级安全。

**落地措施：**
- 容器网络仅白名单出站 (LLM API 域名)
- 凭证通过代理注入，容器内 `printenv` 看不到真实 Key
- 文件系统访问受限 (仅挂载工作目录)

### 原则 2：成本可控

避免"不知不觉烧掉 $500"的灾难。

**落地措施：**
- 每次 API 调用记录 token 消耗和费用
- 用户/群组级别预算上限 (达到后拒绝新任务)
- 模型分级路由 (简单任务用 Haiku，复杂任务用 Opus)

### 原则 3：可审计

目标 5,000-10,000 行代码，开发者可以在 2-4 小时内理解整个系统。

**落地措施：**
- 最小化依赖 (争取 <50 个 npm 包)
- 核心逻辑不超过 3 层调用栈
- 100% TypeScript，严格类型检查

### 原则 4：稳定优先

选择最稳定的技术方案，拒绝不成熟的库。

**落地措施：**
- 首要渠道：Telegram (官方 Bot API，弃用 Baileys)
- 首选模型：Claude (Agent SDK 最成熟)
- 数据库：SQLite (零配置，跨平台)
- 测试覆盖率 >80%

---

## 5. 功能需求

### 5.1 需求优先级定义

- **MVP (Phase 1)**：最小可验证产品，必须交付
- **P1 (Phase 2)**：高价值功能，尽快交付
- **P2 (Phase 2)**：增值功能，资源允许时交付
- **P3 (后续版本)**：长期规划

### 5.2 核心功能需求

#### FR-001: 消息处理 (MVP)

**描述：** 用户通过 Telegram 发送消息，Agent 在隔离容器中推理并返回结果。

**优先级：** MVP

**验收标准：**
- 用户发送 "Hello"，收到 Agent 回复
- 容器启动时间 <3s
- 消息排队处理 (不丢失)
- 支持文本 + 图片输入

---

#### FR-002: 容器隔离执行 (MVP)

**描述：** Agent 推理和工具执行在 Docker 容器中运行，与宿主机隔离。

**优先级：** MVP

**验收标准：**
- Agent 进程在独立容器中运行
- 容器用后即毁 (无状态)
- 容器内无法访问宿主机文件系统 (除挂载目录)
- 容器崩溃不影响宿主机进程

---

#### FR-003: 网络安全策略 (MVP)

**描述：** 容器网络仅允许出站到 LLM API 域名，禁止访问内网和其他外网资源。

**优先级：** MVP

**验收标准：**
- 容器可访问 `api.anthropic.com`
- 容器无法访问 `192.168.x.x`、`10.x.x.x`、`127.0.0.1`
- 容器无法访问 `github.com`、`npmjs.com` 等非白名单域名
- DNS 解析限制生效 (无法通过 IP 绕过)

---

#### FR-004: 凭证安全管理 (MVP)

**描述：** API Key 不进入容器环境变量，通过宿主机代理注入。

**优先级：** MVP

**验收标准：**
- 容器内 `printenv` 看不到真实 API Key
- Agent 调用 API 时通过宿主机 Credential Proxy
- Key 存储加密 (SQLite 字段级加密)
- 支持 Key 轮换 (无需重启容器)

---

#### FR-005: 成本追踪 (MVP)

**描述：** 记录每次 API 调用的 token 消耗和费用。

**优先级：** MVP

**验收标准：**
- 每次调用记录：模型、输入 token、输出 token、费用
- 按用户/群组聚合消耗
- 提供查询命令 `/cost` 查看当前消耗
- 数据持久化到 SQLite

---

#### FR-006: 预算控制 (MVP)

**描述：** 用户/群组设置预算上限，达到后拒绝新任务。

**优先级：** MVP

**验收标准：**
- 用户可设置日/月预算 (如 $10/day)
- 超过预算后新消息返回提示 "预算已用完"
- 管理员可重置预算或提高上限
- 预算重置时间可配置 (如每日 00:00 UTC)

---

#### FR-007: 定时任务不丢弃 (MVP)

**描述：** 解决 NanoClaw Issue #830，定时任务在 session busy 时延迟执行而非丢弃。

**优先级：** MVP

**验收标准：**
- 定时任务触发时，如果 session 忙碌，进入延迟队列
- session 空闲后自动执行
- 最多延迟 1 小时，超时后记录警告
- 任务执行失败自动重试 (最多 3 次)

---

#### FR-008: 基础工具集成 (MVP)

**描述：** Agent 可使用 Bash、Read、Write、Edit 工具。

**优先级：** MVP

**验收标准：**
- Bash: 执行命令，捕获输出 (2s 超时)
- Read: 读取文件内容 (支持偏移和限制行数)
- Write: 创建或覆盖文件
- Edit: 精确字符串替换 (oldString/newString)
- 所有工具在容器内执行

---

#### FR-009: 上下文记忆 (MVP)

**描述：** 保存对话历史，Agent 可访问最近 N 条消息。

**优先级：** MVP

**验收标准：**
- 每个用户/群组独立上下文
- 默认保留最近 20 条消息
- 超过长度自动压缩 (删除旧消息)
- 支持手动清空上下文 `/clear`

---

#### FR-010: Claude 模型支持 (MVP)

**描述：** 使用 Claude Agent SDK，支持 Claude 3.5 Sonnet/Haiku。

**优先级：** MVP

**验收标准：**
- 默认模型：Claude 3.5 Sonnet
- 支持切换模型 `/model haiku`
- 流式响应 (实时返回生成内容)
- 工具调用正确解析

---

#### FR-011: 多模型抽象 (P1)

**描述：** Provider 抽象层，支持 Claude、OpenAI、Gemini 等。

**优先级：** P1

**验收标准：**
- 统一 Provider 接口 (`chat()`, `stream()`, `tools()`)
- Claude Provider 实现完整
- OpenAI Provider 实现基础功能
- 配置文件切换 Provider 无需改代码

---

#### FR-012: 智能模型路由 (P1)

**描述：** 根据任务复杂度自动选择模型 (Haiku 处理简单任务，Opus 处理复杂任务)。

**优先级：** P1

**验收标准：**
- 简单对话 (无工具调用) 使用 Haiku
- 需要推理/代码生成使用 Sonnet
- 用户可手动指定模型
- 路由规则可配置 (YAML)

---

#### FR-013: 上下文压缩 (P1)

**描述：** 对话历史超长时智能压缩，保留关键信息。

**优先级：** P1

**验收标准：**
- 总 token 数超过 50K 时触发压缩
- 使用 LLM 生成摘要 (Haiku 模型)
- 保留最近 5 条原始消息
- 压缩后上下文 <20K tokens

---

#### FR-014: 持久化记忆 (P1)

**描述：** 跨会话记忆关键信息 (用户偏好、项目信息)。

**优先级：** P1

**验收标准：**
- Agent 可保存结构化数据 (JSON)
- 查询接口支持模糊搜索
- 每个用户独立记忆空间
- 记忆条目数上限 100 条

---

#### FR-015: WhatsApp 渠道 (P2)

**描述：** 支持 WhatsApp 作为消息渠道 (使用官方 Business API)。

**优先级：** P2

**验收标准：**
- 弃用 Baileys (不稳定)
- 使用 WhatsApp Business API
- 消息收发功能对齐 Telegram
- 配置独立于 Telegram

---

#### FR-016: Web Dashboard (P2)

**描述：** 简单的 Web 界面查看成本、日志、配置。

**优先级：** P2

**验收标准：**
- 实时成本图表 (按日/月)
- 日志查询 (按时间/关键词过滤)
- 在线修改配置 (重启生效)
- 仅本地访问 (127.0.0.1)

---

#### FR-017: Skill 系统 (P2)

**描述：** 插件机制，用户可安装第三方技能。

**优先级：** P2

**验收标准：**
- Skill 注册表 (JSON Schema)
- 安全审核机制 (禁止网络访问)
- 版本管理 (语义化版本)
- 命令：`/skill install <name>`

---

#### FR-018: 多 Agent 协作 (P3)

**描述：** 支持子 Agent 分工执行复杂任务 (预留接口，不实现)。

**优先级：** P3 (不做)

**原因：**
- 个人助手场景 90%+ 任务是单目标
- API 成本倍增，与降本目标冲突
- 协调复杂度高，SDK 层面有已知缺陷
- 社区无强烈需求

**预留设计：** `TaskExecutor` 接口支持未来扩展

---

### 5.3 功能需求汇总表

| ID | 功能 | 优先级 | 交付阶段 | 复杂度 |
|----|------|--------|----------|--------|
| FR-001 | 消息处理 | MVP | Phase 1 | 中 |
| FR-002 | 容器隔离 | MVP | Phase 1 | 高 |
| FR-003 | 网络安全 | MVP | Phase 1 | 高 |
| FR-004 | 凭证安全 | MVP | Phase 1 | 中 |
| FR-005 | 成本追踪 | MVP | Phase 1 | 低 |
| FR-006 | 预算控制 | MVP | Phase 1 | 中 |
| FR-007 | 定时任务 | MVP | Phase 1 | 中 |
| FR-008 | 基础工具 | MVP | Phase 1 | 低 |
| FR-009 | 上下文记忆 | MVP | Phase 1 | 低 |
| FR-010 | Claude 支持 | MVP | Phase 1 | 中 |
| FR-011 | 多模型抽象 | P1 | Phase 2 | 高 |
| FR-012 | 模型路由 | P1 | Phase 2 | 中 |
| FR-013 | 上下文压缩 | P1 | Phase 2 | 高 |
| FR-014 | 持久化记忆 | P1 | Phase 2 | 中 |
| FR-015 | WhatsApp | P2 | Phase 2 | 高 |
| FR-016 | Web Dashboard | P2 | Phase 2 | 中 |
| FR-017 | Skill 系统 | P2 | Phase 2 | 高 |
| FR-018 | 多 Agent | P3 | 不做 | 极高 |

---

## 6. 非功能需求

### 6.1 性能要求

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 容器启动时间 | <3s | 从 IPC 请求到容器就绪 |
| 消息响应首字节 | <2s | 从收到消息到首次返回内容 |
| 内存占用 (宿主机) | <100MB | RSS，空闲状态 |
| 内存占用 (容器) | <300MB | RSS，推理状态 |
| 并发用户 | >50 | 单实例，消息排队不超时 |
| SQLite 查询 | <50ms | 99th percentile |

### 6.2 可用性要求

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 系统可用性 | >99.5% | 月度统计 (排除计划维护) |
| 容器崩溃恢复 | <5s | 自动重启容器 |
| 数据一致性 | 100% | SQLite 事务保证 |
| 日志完整性 | 100% | 所有错误可追溯 |

### 6.3 安全要求

| 要求 | 实现方式 | 验证方法 |
|------|----------|----------|
| 容器逃逸防护 | Docker seccomp + AppArmor | 渗透测试 |
| 网络隔离 | iptables 白名单 + DNS 限制 | 自动化测试 |
| 凭证泄露防护 | 代理注入 + 环境变量隔离 | 审计日志 |
| 供应链安全 | lockfile + npm audit | CI 检查 |
| 数据加密 | SQLite 字段级加密 | 代码审查 |

### 6.4 可维护性要求

| 要求 | 目标 | 实现方式 |
|------|------|----------|
| 代码量 | 5,000-10,000 行 TS | 定期审计 |
| 依赖数量 | <50 npm 包 | package.json 监控 |
| 测试覆盖率 | >80% | vitest 报告 |
| 文档完整性 | 所有公开 API 有 JSDoc | CI 检查 |
| 日志可读性 | 结构化 JSON (pino) | 日志审查 |

### 6.5 可扩展性要求

| 要求 | 设计 |
|------|------|
| 新增 Provider | 实现 `IProvider` 接口 |
| 新增 Channel | 实现 `IChannel` 接口 |
| 新增工具 | 实现 `ITool` 接口 |
| 新增存储后端 | 实现 `IStorage` 接口 (预留，MVP 仅 SQLite) |

---

## 7. 安全模型设计

**这是 VigilClaw 的核心差异化，必须详细展开。**

### 7.1 威胁模型

**假设：**
1. AI Agent 可能生成恶意代码 (Prompt Injection)
2. 第三方 Skill 可能包含后门
3. 容器内进程可能尝试逃逸
4. 攻击者可能嗅探网络流量窃取 API Key
5. 宿主机可能遭受 DDoS (消息洪水)

**不假设：**
- 用户本身是攻击者 (自托管场景，用户即管理员)
- 物理访问攻击 (超出软件防御范围)

### 7.2 安全层级

#### 层级 1: 容器隔离

**目标：** Agent 进程无法访问宿主机资源。

**实现：**
- Docker `--security-opt=no-new-privileges`
- 只读文件系统 (除 `/tmp`)
- 禁用特权容器
- 用户命名空间 (容器内 root = 宿主机普通用户)

**验证：**
```bash
# 容器内执行，应失败
cat /etc/shadow  # Permission denied
mount /dev/sda1  # Operation not permitted
```

#### 层级 2: 网络限制

**目标：** 容器只能访问 LLM API，无法访问内网或其他外网。

**实现：**
- Docker 自定义网络 (bridge)
- iptables 规则：
  ```
  # 允许
  api.anthropic.com:443
  api.openai.com:443
  
  # 拒绝
  192.168.0.0/16
  10.0.0.0/8
  127.0.0.0/8
  其他所有域名
  ```
- DNS 解析限制 (使用内部 DNS 服务器，仅解析白名单域名)

**验证：**
```bash
# 容器内执行
curl api.anthropic.com  # 成功
curl github.com         # 失败
curl 192.168.1.1        # 失败
```

#### 层级 3: 凭证管理

**目标：** API Key 不以明文形式进入容器。

**实现：**
1. 宿主机启动 Credential Proxy (HTTP Server)
2. 容器通过 Unix Socket 请求凭证
3. Proxy 验证请求合法性 (任务 ID + 签名)
4. 返回临时 Token (15 分钟有效期)
5. SQLite 存储加密 Key (AES-256-GCM)

**流程：**
```
Agent (容器) → Unix Socket → Credential Proxy (宿主机) → SQLite (加密)
```

**验证：**
```bash
# 容器内
printenv | grep API_KEY  # 无输出
ps aux | grep anthropic  # 无密钥
```

#### 层级 4: 供应链安全

**目标：** 防止恶意 npm 包注入。

**实现：**
- pnpm lockfile 严格模式
- CI 自动 `npm audit` (High/Critical 阻断发布)
- 依赖最小化 (每新增依赖需评审)
- Skill 沙箱 (禁用 `require()`, `eval()`, 网络访问)

#### 层级 5: 速率限制

**目标：** 防止 DDoS 和成本炸弹。

**实现：**
- 用户级：每分钟 10 条消息
- 群组级：每分钟 30 条消息
- IP 级：每分钟 50 条消息 (Telegram Webhook)
- 超过限制返回 429 (稍后重试)

### 7.3 安全配置默认值

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 容器网络模式 | `restricted` | 仅白名单出站 |
| 凭证存储 | `encrypted` | AES-256-GCM |
| Skill 网络访问 | `disabled` | 禁止所有网络 |
| 日志敏感信息 | `redacted` | 自动脱敏 API Key |
| 容器生命周期 | `ephemeral` | 用后即毁 |

### 7.4 安全审计日志

所有安全事件记录到 SQLite `security_events` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 自增 ID |
| timestamp | DATETIME | 事件时间 |
| event_type | TEXT | `container_escape_attempt`, `network_violation`, `credential_leak` |
| user_id | TEXT | 触发用户 |
| details | JSON | 详细信息 |
| severity | TEXT | `low`, `medium`, `high`, `critical` |

---

## 8. 成本控制模型

**这是另一个核心差异化，需详细展开。**

### 8.1 成本追踪

#### 数据记录

每次 API 调用记录到 `api_calls` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 自增 ID |
| timestamp | DATETIME | 调用时间 |
| user_id | TEXT | 用户标识 |
| group_id | TEXT | 群组标识 (可为空) |
| model | TEXT | `claude-3-5-sonnet-20250219` |
| input_tokens | INTEGER | 输入 token 数 |
| output_tokens | INTEGER | 输出 token 数 |
| cost_usd | REAL | 费用 (美元) |
| task_id | TEXT | 任务 ID (关联对话) |

#### 费用计算

实时查询 Anthropic/OpenAI 价格表 (缓存 24 小时)，计算公式：

```
cost = (input_tokens / 1M) * input_price + (output_tokens / 1M) * output_price
```

示例 (Claude 3.5 Sonnet):
```
输入: 100K tokens * $3/1M = $0.30
输出: 20K tokens * $15/1M = $0.30
总计: $0.60
```

### 8.2 预算控制

#### 预算设置

用户可设置多级预算：

| 级别 | 配置项 | 默认值 |
|------|--------|--------|
| 单次任务 | `max_cost_per_task` | $1.00 |
| 每日 | `max_cost_per_day` | $10.00 |
| 每月 | `max_cost_per_month` | $100.00 |

#### 预算检查

每次任务启动前检查：

```typescript
if (user.todayCost + estimatedCost > user.maxCostPerDay) {
  return "预算已用完，今日剩余 $0.00 / $10.00"
}
```

#### 预算重置

- 每日预算：UTC 00:00 自动重置
- 每月预算：每月 1 日 00:00 重置
- 支持手动重置 (管理员命令 `/reset-budget @user`)

### 8.3 模型分级路由

根据任务复杂度选择模型，降低成本：

| 模型 | 输入价格 | 输出价格 | 适用场景 |
|------|----------|----------|----------|
| Claude 3.5 Haiku | $1/1M | $5/1M | 简单对话、翻译 |
| Claude 3.5 Sonnet | $3/1M | $15/1M | 代码生成、推理 |
| Claude 3 Opus | $15/1M | $75/1M | 复杂任务 (手动指定) |

**路由规则：**
```yaml
simple_task:
  - no_tool_calls: true
  - input_tokens: <5000
  → use haiku

complex_task:
  - tool_calls: >3
  - input_tokens: >10000
  → use sonnet

default: sonnet
```

**成本节省估算：**
- 假设 50% 任务可用 Haiku 替代 Sonnet
- 日均 100 次调用，每次 10K input + 2K output
- Sonnet 成本: 100 * (10K/1M * $3 + 2K/1M * $15) = $6.00
- 混合成本: 50 * $6 + 50 * (10K/1M * $1 + 2K/1M * $5) = $3.50
- **节省 41%**

### 8.4 成本可视化

提供命令查询成本：

```
/cost
今日消耗: $3.24 / $10.00 (32%)
本月消耗: $45.67 / $100.00 (46%)

详细：
- claude-3-5-sonnet: $2.80 (23 次)
- claude-3-5-haiku: $0.44 (47 次)

Top 消耗任务：
1. 代码重构 - $0.85
2. 文档生成 - $0.62
3. 调试分析 - $0.48
```

---

## 9. 系统架构概览

### 9.1 高层架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户层                              │
│  Telegram Bot / WhatsApp / Web Dashboard               │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS/Webhook
┌──────────────────────▼──────────────────────────────────┐
│                   宿主机进程 (Host)                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Channel Adapter (Telegram/WhatsApp)             │   │
│  │   → Message Router                              │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │                                 │
│  ┌────────────────────▼────────────────────────────┐   │
│  │ Task Queue (延迟队列 + 重试)                     │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │                                 │
│  ┌────────────────────▼────────────────────────────┐   │
│  │ Session Manager (上下文管理)                     │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │                                 │
│  ┌────────────────────▼────────────────────────────┐   │
│  │ Container Orchestrator (容器生命周期)            │   │
│  │   → 启动容器                                     │   │
│  │   → 监控状态                                     │   │
│  │   → 清理资源                                     │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │ IPC (文件系统)                  │
│  ┌────────────────────▼────────────────────────────┐   │
│  │ Credential Proxy (凭证注入)                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ SQLite Storage (消息/成本/配置)                  │   │
│  └─────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────────┐
│                   容器进程 (Container)                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Agent Runtime (Claude Agent SDK)                │   │
│  │   → 推理引擎                                     │   │
│  │   → 工具调用                                     │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │                                 │
│  ┌────────────────────▼────────────────────────────┐   │
│  │ Tool Executor (Bash/Read/Write/Edit)             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  网络策略: 仅允许出站到 LLM API 域名                     │
└─────────────────────────────────────────────────────────┘
```

### 9.2 进程分工

| 进程 | 职责 | 不做什么 |
|------|------|----------|
| 宿主机 | 消息路由、存储、凭证、IPC、调度、成本 | 永远不运行 AI 推理 |
| 容器 | Agent 推理、工具执行 | 不存储状态、不访问真实凭证 |

### 9.3 数据流

**正常消息流：**
1. 用户发送消息到 Telegram
2. Webhook 触发宿主机 Channel Adapter
3. Message Router 创建任务，写入队列
4. Session Manager 加载上下文
5. Container Orchestrator 启动容器
6. 容器 Agent 读取任务 (IPC)
7. Agent 推理 → 调用工具 → 生成回复
8. 回复写入 IPC，宿主机读取
9. 宿主机通过 Telegram API 返回用户
10. 记录成本到 SQLite
11. 销毁容器

**错误恢复流：**
- 容器崩溃 → 宿主机检测 (5s 超时) → 重启容器 → 重试任务
- 网络超时 → 记录警告 → 返回用户 "API 暂时不可用"
- 预算超限 → 拒绝任务 → 返回预算提示

---

## 10. 数据模型

### 10.1 SQLite 表结构

#### 表 1: users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- 用户唯一标识 (如 telegram:123456)
  name TEXT,                    -- 用户名
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  max_cost_per_day REAL DEFAULT 10.0,
  max_cost_per_month REAL DEFAULT 100.0,
  current_model TEXT DEFAULT 'claude-3-5-sonnet-20250219',
  settings JSON                 -- 其他用户配置
);
```

#### 表 2: messages

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  group_id TEXT,                -- 群组 ID (可为空)
  role TEXT NOT NULL,           -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  tokens INTEGER,               -- 消息 token 数
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_messages_user ON messages(user_id, timestamp);
CREATE INDEX idx_messages_group ON messages(group_id, timestamp);
```

#### 表 3: api_calls

```sql
CREATE TABLE api_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  group_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  task_id TEXT,                 -- 关联对话
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_api_calls_user_time ON api_calls(user_id, timestamp);
CREATE INDEX idx_api_calls_cost ON api_calls(cost_usd DESC);
```

#### 表 4: tasks

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,          -- UUID
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- 'pending' | 'running' | 'completed' | 'failed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  input_file TEXT,              -- IPC 输入文件路径
  output_file TEXT,             -- IPC 输出文件路径
  error_message TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_tasks_status ON tasks(status, created_at);
```

#### 表 5: credentials

```sql
CREATE TABLE credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,       -- 'anthropic' | 'openai' | 'gemini'
  key_encrypted BLOB NOT NULL,  -- AES-256-GCM 加密
  iv BLOB NOT NULL,             -- 初始化向量
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_rotated DATETIME,
  UNIQUE(provider)
);
```

#### 表 6: security_events

```sql
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  event_type TEXT NOT NULL,
  user_id TEXT,
  details JSON,
  severity TEXT NOT NULL        -- 'low' | 'medium' | 'high' | 'critical'
);

CREATE INDEX idx_security_events_severity ON security_events(severity, timestamp);
```

#### 表 7: memories (Phase 2)

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  accessed_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, key)
);

CREATE INDEX idx_memories_user ON memories(user_id);
```

### 10.2 加密设计

**加密字段：** `credentials.key_encrypted`

**算法：** AES-256-GCM

**密钥管理：**
- 主密钥存储在环境变量 `MASTER_KEY` (32 字节 hex)
- 首次启动自动生成 (用户需备份)
- 每个凭证独立 IV (防止模式攻击)

**加密流程：**
```typescript
encrypt(apiKey: string, masterKey: Buffer): { encrypted: Buffer, iv: Buffer }
decrypt(encrypted: Buffer, iv: Buffer, masterKey: Buffer): string
```

---

## 11. API / 接口设计

### 11.1 Provider 抽象层

**目的：** 统一多模型接口，方便切换。

**接口定义：**

```typescript
interface IProvider {
  name: string; // 'claude' | 'openai' | 'gemini'
  
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncGenerator<ChatChunk>;
  tools(): ToolDefinition[];
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

**实现：**
- `ClaudeProvider` (MVP)
- `OpenAIProvider` (Phase 2)
- `GeminiProvider` (Phase 2)

### 11.2 Channel 抽象层

**目的：** 统一消息渠道接口，支持多平台。

**接口定义：**

```typescript
interface IChannel {
  name: string; // 'telegram' | 'whatsapp' | 'web'
  
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(userId: string, text: string): Promise<void>;
  sendImage(userId: string, imageUrl: string, caption?: string): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
}

interface IncomingMessage {
  userId: string;
  groupId?: string;
  text?: string;
  images?: string[];
  timestamp: Date;
}
```

**实现：**
- `TelegramChannel` (MVP)
- `WhatsAppChannel` (Phase 2)
- `WebChannel` (Phase 2)

### 11.3 Tool 接口

**目的：** 标准化工具定义。

**接口定义：**

```typescript
interface ITool {
  name: string;
  description: string;
  schema: JSONSchema;
  execute(params: unknown): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

**内置工具：**
- `BashTool`: 执行 Shell 命令
- `ReadTool`: 读取文件
- `WriteTool`: 写入文件
- `EditTool`: 替换字符串

### 11.4 IPC 协议

**宿主机 → 容器：**

文件: `/ipc/task-{uuid}.json`

```json
{
  "taskId": "task-abc123",
  "userId": "telegram:123456",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "model": "claude-3-5-sonnet-20250219",
  "tools": ["bash", "read", "write", "edit"],
  "credentialToken": "temp-token-xyz"
}
```

**容器 → 宿主机：**

文件: `/ipc/result-{uuid}.json`

```json
{
  "taskId": "task-abc123",
  "success": true,
  "response": {
    "content": "Hello! How can I help you?",
    "usage": {
      "inputTokens": 150,
      "outputTokens": 50
    }
  }
}
```

---

## 12. 里程碑与交付计划

### 12.1 Phase 0: 技术准备 (1-2 天)

**目标：** 完成技术选型和项目脚手架。

**交付物：**
- [ ] 技术方案文档 (架构设计、API 设计)
- [ ] 项目脚手架 (TypeScript + pnpm + vitest)
- [ ] 开发环境配置 (Docker、Node 22、依赖安装)
- [ ] CI 配置 (lint + test + audit)

**验收标准：**
- `pnpm test` 通过
- `pnpm lint` 无错误
- Docker 镜像可构建

---

### 12.2 Phase 1: MVP (1-2 周)

**目标：** 验证核心假设，交付可用的最小版本。

**功能范围：**
- Telegram 渠道
- Claude 3.5 Sonnet/Haiku
- 容器隔离 + 网络限制
- 凭证安全管理
- 成本追踪 + 预算控制
- 基础工具 (Bash/Read/Write/Edit)
- 定时任务不丢弃
- 上下文记忆 (20 条)

**交付物：**
- [ ] 宿主机进程 (消息路由、存储、调度)
- [ ] 容器镜像 (Agent Runtime)
- [ ] SQLite 数据库 (表结构 + 迁移脚本)
- [ ] Telegram Bot (grammY)
- [ ] Claude Provider (Agent SDK)
- [ ] 网络策略配置 (iptables)
- [ ] 凭证代理
- [ ] 成本追踪
- [ ] 单元测试 (覆盖率 >80%)
- [ ] 集成测试 (E2E 测试 Telegram → Agent → 回复)
- [ ] 部署文档 (Docker Compose)

**验收标准：**
1. 用户通过 Telegram 发 "Hello"，Agent 在 3s 内回复
2. 容器内 `printenv` 看不到真实 API Key
3. 容器内 `curl github.com` 失败
4. 容器内 `curl api.anthropic.com` 成功
5. `/cost` 命令返回正确的消耗数据
6. 预算超限后返回 "预算已用完" 提示
7. 定时任务在 session busy 时延迟执行 (不丢弃)
8. 代码量 <5,000 行 TS
9. 依赖数量 <50 npm 包

**时间规划：**
- Week 1: 宿主机进程 + Telegram + SQLite + Credential Proxy
- Week 2: 容器 Runtime + Claude Provider + 网络策略 + 测试

---

### 12.3 Phase 2: 增强 (2-4 周)

**目标：** 增强易用性和功能完整性。

**功能范围：**
- 多模型支持 (OpenAI、Gemini)
- 智能模型路由
- 上下文压缩
- 持久化记忆
- WhatsApp 渠道
- Web Dashboard
- Skill 系统

**交付物：**
- [ ] Provider 抽象层 + OpenAI/Gemini 实现
- [ ] 模型路由引擎
- [ ] 上下文压缩 (LLM 摘要)
- [ ] 记忆存储 + 查询 API
- [ ] WhatsApp Channel (Business API)
- [ ] Web Dashboard (React + Vite)
- [ ] Skill 注册表 + 安全审核
- [ ] 性能优化 (容器启动 <3s)
- [ ] 文档完善 (用户指南、API 文档)

**验收标准：**
1. 可切换到 OpenAI GPT-4 模型
2. 简单任务自动路由到 Haiku (节省 40% 成本)
3. 对话历史 >50K tokens 时自动压缩
4. Agent 可记住用户偏好 (跨会话)
5. WhatsApp 消息收发正常
6. Web Dashboard 显示实时成本图表
7. 安装 Skill 不需要重启服务
8. 代码量 <10,000 行 TS

**时间规划：**
- Week 3: 多模型 + 路由 + 压缩
- Week 4: 记忆 + WhatsApp
- Week 5-6: Web Dashboard + Skill 系统 + 优化

---

### 12.4 后续版本 (Phase 3+)

**待评估功能：**
- 语音输入/输出
- 图片生成 (DALL-E/Midjourney)
- 浏览器自动化 (Playwright)
- 代码执行沙箱 (支持 Python/Node)
- 团队协作 (多用户共享 session)
- 企业功能 (SSO、审计日志、RBAC)

**决策依据：**
- 社区反馈 (GitHub Issues/Discussions)
- 用户调研 (问卷/访谈)
- 竞品动态

---

## 13. 风险与缓解措施

### 风险 1: 容器逃逸漏洞

**可能性：** 低 (Docker 成熟技术)

**影响：** 极高 (宿主机被攻陷)

**缓解措施：**
- 定期更新 Docker 引擎
- 订阅安全公告 (Docker Security Team)
- 定期渗透测试
- 使用 gVisor/Kata Containers 增强隔离 (可选)

---

### 风险 2: LLM API 成本暴涨

**可能性：** 中 (Anthropic 可能调价)

**影响：** 高 (超出用户预算)

**缓解措施：**
- 预算控制硬上限 (代码层强制)
- 价格缓存 + 定期更新
- 支持多 Provider 分散风险
- 通知用户价格变动

---

### 风险 3: Telegram Bot 被封禁

**可能性：** 低 (遵守 ToS)

**影响：** 高 (用户无法访问)

**缓解措施：**
- 严格遵守 Telegram Bot API 政策
- 速率限制 (防止被举报为垃圾)
- 提供其他渠道 (WhatsApp/Web) 作为备份

---

### 风险 4: 依赖供应链攻击

**可能性：** 中 (npm 生态风险)

**影响：** 极高 (后门植入)

**缓解措施：**
- 依赖最小化 (<50 包)
- lockfile 严格审查
- CI 自动 `npm audit`
- 关键依赖 fork 到自己仓库

---

### 风险 5: 定时任务延迟过长

**可能性：** 中 (高负载场景)

**影响：** 中 (用户体验下降)

**缓解措施：**
- 延迟超过 1 小时丢弃 + 记录警告
- 优先级队列 (紧急任务优先)
- 自动扩容 (Phase 3 考虑多实例)

---

### 风险 6: SQLite 性能瓶颈

**可能性：** 低 (单实例 <1000 用户)

**影响：** 中 (查询变慢)

**缓解措施：**
- 索引优化 (关键字段加索引)
- WAL 模式 (写入不阻塞读取)
- 定期 `VACUUM` (清理碎片)
- 迁移到 PostgreSQL (Phase 3 备选)

---

## 14. 成功指标

### 14.1 技术指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 代码量 | <10,000 行 TS | `cloc src/` |
| 依赖数量 | <50 npm 包 | `pnpm list --depth=0` |
| 测试覆盖率 | >80% | vitest coverage |
| 容器启动时间 | <3s | E2E 测试 |
| 消息响应延迟 | <2s | Telegram 测试 |
| 安全评分 | >90/100 | 第三方渗透测试 |

### 14.2 用户指标

| 指标 | 目标 (3 个月) | 测量方法 |
|------|--------------|----------|
| GitHub Stars | >1,000 | GitHub API |
| 活跃实例 | >500 | 匿名遥测 (可选) |
| 社区贡献 PR | >20 | GitHub Insights |
| 用户反馈评分 | >4.5/5 | GitHub Discussions 问卷 |
| 迁移用户 (从 OpenClaw) | >100 | 用户调研 |

### 14.3 业务指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 用户平均日成本 | <$5 | 对比 OpenClaw ($50-100) |
| 安全事件数 | 0 | 容器逃逸/凭证泄露 |
| 系统可用性 | >99.5% | 月度统计 |
| 用户留存率 (30 天) | >60% | 匿名遥测 |

---

## 15. 开放问题 (待决策)

### Q1: 是否支持多实例部署?

**背景：** 单实例 SQLite 有并发上限 (~1000 用户)。

**选项：**
- A: MVP 仅单实例，Phase 3 支持多实例 + PostgreSQL
- B: 从一开始设计分布式架构

**倾向：** A (单实例优先，降低复杂度)

**决策时间：** Phase 2 中期，根据用户增长决定

---

### Q2: 是否内置 Web Dashboard?

**背景：** 成本查询、日志查看可通过 CLI 实现，Web 界面增加维护负担。

**选项：**
- A: MVP 仅 CLI，Phase 2 提供 Web Dashboard
- B: 从一开始提供 Web 界面

**倾向：** A (CLI 优先，开发者友好)

**决策时间：** Phase 1 结束，根据用户反馈决定

---

### Q3: 如何处理长时间运行任务 (>5 分钟)?

**背景：** 容器长时间占用资源，影响其他用户。

**选项：**
- A: 硬超时 5 分钟，超时强制终止
- B: 支持后台任务，完成后通知用户
- C: 允许用户设置超时 (最长 30 分钟)

**倾向：** B (后台任务 + 通知)

**决策时间：** MVP 阶段实现 A，Phase 2 升级到 B

---

### Q4: Skill 审核机制如何设计?

**背景：** 第三方 Skill 可能包含恶意代码。

**选项：**
- A: 人工审核 (GitHub PR)
- B: 自动化静态分析 + 沙箱测试
- C: 用户自行承担风险 (免责声明)

**倾向：** B (自动化 + 人工抽查)

**决策时间：** Phase 2 Skill 系统设计阶段

---

### Q5: 是否支持私有化部署的商业版?

**背景：** 企业用户可能愿意付费购买增强功能。

**选项：**
- A: 纯开源，不做商业化
- B: 开源社区版 + 商业企业版 (SSO、审计日志、优先支持)

**倾向：** B (可持续发展)

**决策时间：** Phase 2 结束，根据市场反馈决定

---

## 附录 A: 术语表

| 术语 | 定义 |
|------|------|
| Agent | 基于 LLM 的智能助手，能理解自然语言并执行任务 |
| Provider | LLM 服务提供商 (Anthropic/OpenAI/Google) |
| Channel | 消息渠道 (Telegram/WhatsApp/Web) |
| Tool | Agent 可调用的外部能力 (Bash/文件操作/API) |
| Session | 用户与 Agent 的一次完整对话 |
| IPC | 进程间通信 (Inter-Process Communication) |
| Credential Proxy | 凭证代理，负责安全注入 API Key |
| Container Orchestrator | 容器编排器，管理容器生命周期 |
| Cost Guard | 成本守护，预算控制模块 |
| Skill | 可插拔的功能扩展 (类似 Chrome 扩展) |

---

## 附录 B: 参考资料

1. **NanoClaw GitHub**: https://github.com/nanoclaw/nanoclaw
2. **OpenClaw GitHub**: https://github.com/openclaw/openclaw
3. **Claude Agent SDK**: https://docs.anthropic.com/agent-sdk
4. **Docker Security Best Practices**: https://docs.docker.com/engine/security/
5. **Telegram Bot API**: https://core.telegram.org/bots/api
6. **SQLite Performance Tuning**: https://www.sqlite.org/optoverview.html
7. **iptables Tutorial**: https://www.netfilter.org/documentation/

---

## 附录 C: 变更历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|----------|
| v1.0.0 | 2026-03-10 | VigilClaw 产品团队 | 初始版本 |

---

**文档状态：待评审**

**下一步行动：**
1. 团队评审 PRD (2 天)
2. 确认技术可行性 (技术方案文档)
3. 启动 Phase 0 (项目脚手架)
