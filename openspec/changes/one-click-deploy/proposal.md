## Why

VigilClaw 核心功能已完成（Phase 2 P1/P2 全部就绪），但部署完整度仅约 48%：缺少宿主进程 Dockerfile、CI/CD 工作流、初始化脚本和系统服务配置。当前 `docker compose up` 会直接失败（docker-compose.yml 引用了不存在的 Dockerfile）。没有一键部署能力，项目无法被其他人使用，所有已完成的功能都无法在生产环境中验证。

## What Changes

- 新增宿主进程 Dockerfile（多阶段构建，生产优化）
- 新增 `.dockerignore` 减小镜像体积
- 修复并完善 `docker-compose.yml`（健康检查、Agent Runner 预构建、卷挂载、网络策略）
- 新增 `scripts/setup.sh` 一键初始化脚本（环境检测、依赖安装、.env 生成、Master Key 生成、镜像构建）
- 新增 systemd 服务文件，支持 Linux 服务器原生部署
- 新增 GitHub Actions CI 工作流（lint + typecheck + test + Docker 镜像构建）
- 新增 `scripts/upgrade.sh` 升级脚本（拉取更新、重建镜像、滚动重启）

## Capabilities

### New Capabilities
- `deployment`: 一键部署全流程 — 宿主进程容器化、Docker Compose 编排、初始化脚本、systemd 服务、升级脚本
- `ci-pipeline`: GitHub Actions CI/CD — 代码质量检查、Docker 镜像构建与推送

### Modified Capabilities
_无。部署是新增基础设施，不改变现有功能的规格。_

## Impact

**新增文件：**
- `Dockerfile` — 宿主进程镜像
- `.dockerignore` — 构建排除规则
- `deploy/vigilclaw.service` — systemd 服务文件
- `scripts/setup.sh` — 一键初始化
- `scripts/upgrade.sh` — 升级脚本
- `.github/workflows/ci.yml` — CI 工作流

**修改文件：**
- `docker-compose.yml` — 修复构建配置，添加健康检查、Agent Runner 服务
- `package.json` — 添加 `setup`、`deploy` 相关 scripts

**新增依赖：** 无（全部使用 shell + Docker 原生能力）

**受影响系统：** Docker 构建流程、GitHub Actions、Linux systemd
