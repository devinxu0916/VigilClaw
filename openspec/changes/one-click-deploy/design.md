## Context

VigilClaw 核心功能已完成，但部署基础设施不完整：

- `docker-compose.yml` 引用了不存在的 `Dockerfile`（宿主进程）
- Agent Runner Dockerfile 使用 `npm install` 而非 pnpm，与项目规范不一致
- `health.ts` 监听 `127.0.0.1`，容器内无法被外部探测
- `better-sqlite3`、`sqlite-vec`、`sharp` 需要原生编译，Alpine 镜像需特殊处理
- `@huggingface/transformers` 首次运行下载模型（~80MB），需考虑镜像大小或卷缓存
- 没有 CI/CD、systemd 服务文件、初始化脚本

## Goals / Non-Goals

**Goals:**
- 用户 clone 后 `bash scripts/setup.sh && docker compose up -d` 即可运行
- Docker Compose 一键启动宿主进程（含健康检查和自动重启）
- GitHub Actions CI 在每次 push/PR 时运行 lint + typecheck + test
- Linux 服务器可通过 systemd 管理服务生命周期
- 提供 `scripts/upgrade.sh` 支持安全升级

**Non-Goals:**
- Kubernetes / Helm Chart（过度工程，目标用户是个人开发者）
- 多节点集群部署
- 自建 Docker Registry（使用 GitHub Container Registry）
- Terraform / IaC 云基础设施编排
- Nginx/Caddy 反向代理配置（项目不暴露 HTTP API 给外部，仅有内部健康检查端口）

## Decisions

### D1: 宿主进程 Dockerfile 基础镜像

**选择：`node:22-alpine`**

| 方案 | 优点 | 缺点 |
|------|------|------|
| node:22-alpine | 镜像小（~180MB），安全攻击面小 | 原生模块需 `apk add build-base python3` |
| node:22-slim | 原生模块兼容好 | 镜像偏大（~250MB） |
| node:22 | 开箱即用 | 镜像过大（~1GB），不适合生产 |

**理由**：与 Agent Runner 保持一致（已用 Alpine）。`better-sqlite3` 和 `sqlite-vec` 在 builder 阶段编译，runtime 阶段无需编译工具链。`sharp` 提供预编译的 Alpine 二进制。

### D2: 镜像构建策略 — 多阶段构建

**选择：三阶段构建（deps → build → runtime）**

```
Stage 1 (deps):    安装 + 编译原生依赖
Stage 2 (build):   TypeScript 编译
Stage 3 (runtime): 仅复制产物 + 生产 node_modules
```

**替代方案**：两阶段（build + runtime）— 不够精细，build 阶段会包含 devDependencies 的编译开销。

**理由**：分离依赖安装和 TS 编译，利用 Docker 层缓存。依赖不变时只重新编译 TS，显著加速迭代构建。

### D3: Hugging Face 模型处理

**选择：运行时首次下载 + 卷持久化缓存**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 预烘焙进镜像 | 启动即用 | 镜像增加 ~80MB，模型更新需重建镜像 |
| 运行时下载 + 卷缓存 | 镜像精简，模型可独立更新 | 首次启动需下载 |
| 关闭嵌入功能 | 最简 | 丧失语义记忆能力 |

**理由**：模型文件通过 Docker volume `vigilclaw-models` 持久化。首次启动多等 30-60 秒，后续启动秒级。镜像保持精简，模型更新不需要重建镜像。

### D4: Docker Compose 服务编排

**选择：单服务（宿主进程）+ Agent Runner 预构建**

Agent Runner 不作为 Compose 服务运行，而是由宿主进程的 `container-runner.ts` 按需创建和销毁。Compose 仅编排宿主进程。

**替代方案**：把 Agent Runner 也放进 Compose — 不符合当前架构，Agent 是按任务动态创建的短生命周期容器。

### D5: setup.sh 初始化脚本设计

**选择：交互式向导 + 幂等设计**

脚本流程：
1. 检测环境（Node.js ≥ 22、pnpm、Docker）
2. 缺失组件给出安装提示（不自动安装，尊重用户环境）
3. 若 `.env` 不存在，从 `.env.example` 复制并交互式填入关键配置
4. 生成 `VIGILCLAW_MASTER_KEY`（如未设置）
5. 构建 Agent Runner 镜像
6. 运行 `pnpm install` + `pnpm build`
7. 验证健康检查

**幂等保证**：重复运行不会覆盖已有配置，仅补齐缺失项。

### D6: CI 工作流设计

**选择：GitHub Actions，单工作流文件，矩阵策略**

```yaml
triggers: push (master), pull_request (master)
jobs:
  check:    lint + typecheck + test（Node 22）
  docker:   构建宿主 + Agent Runner 镜像（仅验证构建，不推送）
```

**替代方案**：分多个 workflow 文件 — 过度拆分，当前规模不需要。

**理由**：项目处于早期，单文件易维护。`docker` job 仅验证镜像可构建，不推送到 registry（推送时机留给 release 工作流，scope 在 Non-Goals 中）。

### D7: systemd 服务配置

**选择：`docker compose up -d` 托管模式**

systemd unit 不直接管理 Node.js 进程，而是调用 `docker compose up -d` / `docker compose down`。

**替代方案**：直接运行 `node dist/index.js` — 不适合，因为进程还需要访问 Docker daemon 来管理 Agent 容器，容器化运行更干净。

## Risks / Trade-offs

- **[Alpine 原生模块兼容性]** → `better-sqlite3` 和 `sqlite-vec` 在 Alpine 上需 `build-base`。builder 阶段安装编译工具链，runtime 不带入。已有 Agent Runner 验证 Alpine 可行。

- **[Docker Socket 挂载安全风险]** → 宿主容器挂载 `/var/run/docker.sock` 获得 Docker 控制权。缓解：`cap_drop: ALL` + `no-new-privileges` + `read_only: true` + 非 root 用户运行。这是容器管理器的固有需求。

- **[首次启动慢]** → HuggingFace 模型下载 30-60 秒。缓解：卷缓存 + 日志提示下载进度 + setup.sh 中预热选项。

- **[健康检查端口暴露]** → `health.ts` 当前绑定 `127.0.0.1`，容器内需改为 `0.0.0.0`。缓解：通过环境变量 `VIGILCLAW_HEALTH_HOST` 控制，默认 `0.0.0.0`（容器内）。docker-compose 中不映射到宿主机，仅用于容器内健康探测。

## Migration Plan

**部署步骤（面向新用户）：**
1. `git clone` + `bash scripts/setup.sh`（交互式配置）
2. `docker compose up -d`
3. 验证：`docker compose ps`（healthy）+ 消息渠道测试

**从已有裸机部署迁移：**
1. 备份 `data/vigilclaw.db`
2. `bash scripts/setup.sh`（检测并保留已有 .env）
3. `docker compose up -d` — 数据库文件通过卷挂载自动迁移

**回滚策略：**
- `docker compose down` + 回到 `pnpm dev` 裸机模式
- 数据库文件不受影响（SQLite 单文件，卷挂载在 `data/`）

## Open Questions

1. ~~是否需要 Nginx 反向代理？~~ 不需要。项目不对外暴露 HTTP API，健康检查仅内部使用。
2. 是否需要在 setup.sh 中支持 `VIGILCLAW_LOCAL_MODE=true`（无 Docker 模式）？— 建议支持，作为轻量开发路径。
