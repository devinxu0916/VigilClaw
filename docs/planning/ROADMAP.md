# VigilClaw Roadmap

> 最后更新：2026-03-13
> 状态：Phase 2 进行中 — 上下文压缩 ✅ + 持久化记忆 ✅

---

## 当前状态

| 阶段                | 状态        | 时间               |
| ------------------- | ----------- | ------------------ |
| Phase 0：架构设计   | ✅ 完成     | 2026-03-10 ~ 03-11 |
| Phase 1：MVP 核心   | ✅ E2E 通过 | 2026-03-11 ~ 03-12 |
| Phase 2：差异化能力 | 🔧 进行中   | 预计 2-4 周        |

---

## Phase 0：架构设计（1-2 天）

### 产出物

- [x] 产品需求文档 (PRD) → [VigilClaw-PRD.md](../product/VigilClaw-PRD.md)
- [x] 技术方案文档（4 篇全部产出） → [技术方案索引](../architecture/VigilClaw-技术方案.md)
- [x] 调研报告（4 篇） → [research/](../research/)
- [x] 项目脚手架（pnpm + TypeScript + ESLint + Vitest）
- [ ] Git 仓库初始化 + CI 配置
- [x] Docker Agent Runner 镜像 Dockerfile

### 验收标准

- [x] `pnpm typecheck` 通过（零错误）
- [x] `pnpm test` 通过（4/4 测试）
- [x] `pnpm build` 通过（编译到 dist/）
- [ ] `pnpm lint` 无错误（ESLint flat config 待调通）
- [x] Agent Runner Dockerfile 已创建

---

## Phase 1：MVP 核心（1-2 周）

> **MVP 定义**：能通过 Telegram 与 Claude 对话，Agent 在容器中执行，网络受限，凭证安全，成本可追踪。

### Week 1：基础设施 + 安全核心

| 任务            | 天数    | 状态 | 说明                                                |
| --------------- | ------- | ---- | --------------------------------------------------- |
| 项目脚手架      | Day 1-2 | ✅   | pnpm + TS + ESLint + Vitest + 目录结构              |
| SQLite schema   | Day 1-2 | ✅   | better-sqlite3 + 8张表 + 迁移系统 + DAL             |
| 配置系统        | Day 1-2 | ✅   | zod schema validation + 环境变量加载器              |
| 容器隔离核心    | Day 3-4 | ✅   | container-runner + mount-security                   |
| 网络策略 ★      | Day 3-4 | ✅   | TCP Credential Proxy + host.docker.internal (方案F) |
| 凭证代理        | Day 3-4 | ✅   | credential-proxy (API Key 运行时注入)               |
| Agent Runtime   | Day 5-7 | ✅   | 容器内 ReAct 循环 + 4工具 (Bash/Read/Write/Edit)    |
| Claude Provider | Day 5-7 | ✅   | Anthropic SDK 适配 + Provider 抽象接口              |
| IPC 通信        | Day 5-7 | ✅   | 文件系统 IPC                                        |

### Week 2：渠道 + 编排 + 成本控制

| 任务          | 天数    | 状态 | 说明                                              |
| ------------- | ------- | ---- | ------------------------------------------------- |
| Telegram 渠道 | Day 1-2 | ✅   | grammY 集成 + 渠道注册工厂                        |
| 编排与调度    | Day 3-4 | ✅   | group-queue + task-scheduler + 延迟队列           |
| 成本控制 ★    | Day 5-7 | ✅   | cost-guard 预算检查 + session-manager             |
| 端到端联调    | Day 5-7 | ✅   | index.ts 编排器 + router + 全链路串联 + 7个坑修复 |
| 部署文件      | Day 5-7 | ✅   | Dockerfile + docker-compose.yml                   |

### MVP 验收标准

- [x] 通过 Telegram 发消息，Agent 在 Docker 容器中用 Claude 回复
- [ ] 容器网络仅允许出站到 Credential Proxy（方案 F，macOS 限制 — 见 devlog/001）
- [x] `printenv` 在容器内看不到真实 API Key（Credential Proxy 运行时注入）
- [x] 成本数据可追踪（`/cost` 命令返回费用报告）
- [x] 定时任务在 session busy 时不丢弃，延迟执行（TaskScheduler 延迟队列实现）
- [x] 支持本地模式降级（`VIGILCLAW_LOCAL_MODE=true` 跳过容器直接调 LLM）
- [x] 支持自定义 API 中转服务（`/setkey anthropic.base_url` + `/setkey anthropic.auth_token`）
- [x] Telegram 命令：`/cost` `/model` `/clear` `/budget` `/setkey` `/help`
- [ ] 整个代码库 < 5,000 行（待统计）

### E2E 联调踩坑记录

共遇到 7 个坑点 + 1 个 .env 格式陷阱，已沉淀为文档：[001-容器模式联调踩坑记录](../devlog/001-容器模式联调踩坑记录.md)

关键修复：

- Credential Proxy 从 Unix Socket 改为 TCP 端口（macOS Docker VM 不支持 Socket 跨 VM 共享）
- URL 拼接 `new URL(path, base)` 丢弃路径前缀 → 改为字符串拼接
- 禁用自定义 seccomp（Node.js libuv 段错误 → 待 Linux 环境调优）
- Telegram Markdown 发送失败自动降级纯文本
- 容器 AutoRemove → 手动 remove（保留日志用于调试）

---

## Phase 2：差异化能力（2-4 周）

MVP 跑通后，按优先级迭代。

### P1 能力（必做）

| 功能           | 说明                                      | 预估   | 状态 |
| -------------- | ----------------------------------------- | ------ | ---- |
| 多模型支持     | OpenAI + Ollama Provider                  | 3-5 天 | ⏳   |
| 上下文压缩     | 智能压缩（避免 OpenClaw Compaction 死锁） | 3-5 天 | ✅   |
| Token 预算管理 | 模型分级路由（简单任务用便宜模型）        | 3-5 天 | ⏳   |
| 持久化记忆     | SQLite 向量搜索 (sqlite-vec)              | 3-5 天 | ✅   |

### P2 能力（应做）

| 功能            | 说明                           | 预估        | 状态 |
| --------------- | ------------------------------ | ----------- | ---- |
| 更多渠道        | Discord / Slack / WhatsApp     | 每个 2-3 天 | ⏳   |
| Web Dashboard   | 配置管理 / 成本监控 / 健康检查 | 1-2 周      | ⏳   |
| Skill 系统      | 注册表 + 版本管理 + 安全审核   | 1-2 周      | ⏳   |
| Apple Container | macOS 原生容器支持             | 3-5 天      | ⏳   |

### P3 能力（可做）

| 功能          | 说明                                | 预估   | 状态 |
| ------------- | ----------------------------------- | ------ | ---- |
| 多 Agent 编排 | TaskExecutor 接口 + Orchestrator    | 1-2 周 | ⏳   |
| 知识图谱记忆  | 结构化记忆存储                      | 1-2 周 | ⏳   |
| 一键部署脚本  | Docker Compose + Systemd + 自动更新 | 3-5 天 | ⏳   |

---

## 技术选型

| 维度     | 选择                     | 理由                          |
| -------- | ------------------------ | ----------------------------- |
| 语言     | TypeScript               | 与 OpenClaw/NanoClaw 同生态   |
| 运行时   | Node.js 22+              | LTS                           |
| 包管理   | pnpm                     | 更快、严格依赖管理            |
| 数据库   | SQLite (better-sqlite3)  | 零外部依赖，事务一致性        |
| 配置校验 | zod                      | 类型安全 schema 校验          |
| 日志     | pino                     | 高性能结构化日志              |
| 测试     | vitest                   | 快速，TS 原生支持             |
| 容器     | Docker / Apple Container | 成熟稳定                      |
| Telegram | grammY                   | TypeScript 原生，官方 Bot API |
| LLM SDK  | @anthropic-ai/sdk        | 首选 Provider                 |

---

## 核心设计原则

1. **安全即默认** — 容器隔离 + 网络限制 + 凭证零信任，开箱即用
2. **成本可控** — 内置预算控制和模型路由
3. **可审计** — 目标 5,000-10,000 行代码
4. **稳定优先** — 选择最稳定的技术方案

---

## 已完成里程碑

归档目录：[milestones/](./milestones/)

_(暂无已归档里程碑)_

---

## 参考文档

- [产品需求文档 (PRD)](../product/VigilClaw-PRD.md)
- [技术方案](../architecture/VigilClaw-技术方案.md)
- [NanoClaw 深度架构分析](../research/NanoClaw深度架构分析报告.md)
- [OpenClaw 架构调研](../research/OpenClaw架构调研报告.md)
- [OpenClaw 用户痛点调研](../research/OpenClaw用户痛点调研报告.md)
- [竞品调研](../research/OpenClaw轻量平替项目调研报告.md)
- [容器模式联调踩坑记录](../devlog/001-容器模式联调踩坑记录.md)
