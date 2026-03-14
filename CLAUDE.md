# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

VigilClaw — 安全优先的个人 AI 助手，容器隔离 · 凭证零信任 · 成本可控。通过消息渠道与 LLM 对话，Agent 在 Docker 容器中安全执行。Node.js ≥ 22 + TypeScript 5.7 (strict) + pnpm。

## 常用命令

```bash
pnpm dev                # 开发模式（tsx --watch 热重载，自动加载 .env）
pnpm build              # TypeScript 编译到 dist/（使用 tsconfig.build.json）
pnpm start              # 运行 dist/index.js

pnpm test               # vitest run（单次运行全部测试）
pnpm test:watch         # vitest 监听模式
pnpm test:coverage      # 带覆盖率（阈值：语句 80% / 分支 75% / 函数 80% / 行 80%）

pnpm lint               # ESLint 检查 src/ 和 tests/
pnpm lint:fix           # 自动修复
pnpm format             # Prettier 格式化
pnpm typecheck          # tsc --noEmit

pnpm check              # 完整检查 = lint + typecheck + test（提交前必须通过）

pnpm docker:build       # 构建 container/agent-runner/ 镜像
```

运行单个测试文件：`pnpm test tests/unit/cost-guard.test.ts`

## 架构

### 数据流

```
IChannel (消息渠道) → Router (路由+命令) → CostGuard (预算) → GroupQueue (并发调度)
  → ContainerRunner/LocalRunner → CredentialProxy (凭证注入) → Docker Container (ReAct Loop)
  → IPC 返回 → Channel 回复
```

### 三大扩展点（接口抽象）

| 接口 | 位置 | 职责 | 内置实现 |
|------|------|------|----------|
| `IChannel` | `src/channels/types.ts` | 消息渠道 | Telegram (grammY) |
| `IProvider` | `src/provider/types.ts` | LLM 调用 | Claude (@anthropic-ai/sdk) |
| `ITool` | `src/provider/types.ts` | Agent 工具 | Bash/Read/Write/Edit |

新增渠道/Provider/工具：实现对应接口并在 `src/index.ts` 中注册。

### 宿主进程 (`src/`)

- **index.ts** — 入口，模块编排，优雅关闭（SIGINT/SIGTERM）
- **router.ts** — 消息路由，内置命令处理（/help /cost /model /budget /setkey /clear）
- **config.ts** — Zod Schema 配置，`VIGILCLAW_*` 环境变量 + 配置文件双层加载
- **db.ts** — SQLite DAL，8 张表（users/messages/api_calls/tasks/credentials/security_events/scheduled_tasks/settings），自动迁移
- **container-runner.ts** — Docker 容器全生命周期（创建/启动/监控/清理），安全约束应用
- **local-runner.ts** — 无 Docker 时的本地降级模式
- **credential-proxy.ts** — TCP HTTP 代理，运行时注入 API Key，路径白名单限制
- **cost-guard.ts** — 日/月双级预算检查
- **group-queue.ts** — 群组内串行、跨群组并行的并发队列
- **rate-limiter.ts** — 用户/群组/全局三级滑动窗口限流
- **ipc.ts** — 宿主与容器间的文件系统 IPC 协议
- **crypto.ts** — AES-256-GCM 加解密（凭证存储用）
- **mount-security.ts** — 卷挂载敏感路径拦截

### 容器内 Agent (`container/agent-runner/src/`)

独立的 TypeScript 项目，有自己的 package.json 和 Dockerfile（多阶段构建，Alpine，非 root 运行）。

- **react-loop.ts** — ReAct 循环核心，30 轮安全阀
- **tools/** — bash.ts / read.ts / write.ts / edit.ts 四种工具实现
- 通过文件系统 IPC 与宿主进程通信

### 数据库

SQLite（better-sqlite3），零外部数据库依赖。自动清理：消息 90 天、API 调用/事件 365 天。凭证 AES-256-GCM 加密存储。

## 代码规范

- **TypeScript strict mode** — 禁止 `any`，函数返回类型必须显式注解
- **ESLint** — `@typescript-eslint/strict-type-checked` 基线，`no-console: error`（使用 pino logger）
- **Prettier** — 单引号，尾逗号，100 字符宽，2 空格缩进
- **ESM** — 项目使用 `"type": "module"`，导入路径需要 `.js` 后缀
- **测试** — Vitest，pool: forks，超时 30s，测试文件在 `tests/unit/`

## 关键配置

必填环境变量：
- `VIGILCLAW_MASTER_KEY` — 64 位十六进制（32 字节），不设则自动生成到 `~/.config/vigilclaw/master.key`
- `VIGILCLAW_TELEGRAM_BOT_TOKEN` — Telegram Bot Token
- `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` — LLM API Key

本地开发无 Docker 时设置 `VIGILCLAW_LOCAL_MODE=true`。

## 容器安全约束

只读 rootfs + tmpfs /tmp (noexec, 100MB)，CAP_DROP ALL，no-new-privileges，内存 512MB / CPU 1核 / PID 100，5 分钟超时，网络仅允许出站到 Credential Proxy。

## 依赖策略

生产依赖 9 个（含 sqlite-vec 和 @xenova/transformers），保持精简。`scripts/check-deps.sh` 限制最多 50 个生产依赖。
