# Changelog

本文件记录 VigilClaw 的所有版本变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
