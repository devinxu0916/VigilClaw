## 1. Docker 镜像基础

- [x] 1.1 创建 `.dockerignore`，排除 `node_modules/`、`data/`、`.env`、`tests/`、`docs/`、`.git/`、`openspec/` 等非构建文件
- [x] 1.2 创建宿主进程 `Dockerfile`（三阶段：deps → build → runtime），基于 `node:22-alpine`，非 root 用户运行，原生模块（better-sqlite3、sqlite-vec、sharp）正确编译
- [x] 1.3 验证：`docker build -t vigilclaw/host:latest .` 构建成功，`docker run --rm vigilclaw/host:latest whoami` 输出非 root 用户

## 2. Docker Compose 完善

- [x] 2.1 修复 `docker-compose.yml`：补全健康检查（curl /health，间隔 30s，重试 3 次）、安全约束（read_only + tmpfs /tmp）、卷挂载（data + models 缓存）、环境变量映射（从 .env 读取）
- [x] 2.2 修复 `src/health.ts`：健康检查绑定地址从 `127.0.0.1` 改为可配置（环境变量 `VIGILCLAW_HEALTH_HOST`，默认 `0.0.0.0`），同步更新 `src/config.ts` 的 Zod schema
- [x] 2.3 验证：`docker compose up -d` 启动成功，`docker compose ps` 显示 healthy，`docker compose down` 正常停止

## 3. 初始化与升级脚本

- [x] 3.1 创建 `scripts/setup.sh`：环境检测（Node.js ≥ 22、pnpm、Docker）→ .env 生成（交互式填入 Bot Token + API Key）→ Master Key 自动生成 → `pnpm install` + `pnpm build` → Docker 镜像构建 → 健康检查验证。支持 `--local` 标志跳过 Docker 步骤
- [x] 3.2 创建 `scripts/upgrade.sh`：显示版本 diff → 用户确认 → 备份数据库到 `data/backups/` → `git pull` → `pnpm install` → `pnpm build` → 重建镜像 → `docker compose up -d`
- [x] 3.3 验证：在干净目录 clone 后执行 `bash scripts/setup.sh` 完整流程通过；重复执行幂等不覆盖已有配置

## 4. systemd 服务

- [x] 4.1 创建 `deploy/vigilclaw.service`：通过 `docker compose up -d` / `docker compose down` 管理，`After=docker.service`，`Restart=on-failure`，`WorkingDirectory` 指向项目目录
- [x] 4.2 验证：`systemd-analyze verify deploy/vigilclaw.service` 无错误（如有 Linux 环境）

## 5. GitHub Actions CI

- [x] 5.1 创建 `.github/workflows/ci.yml`：触发条件（push master / PR master）→ job 1: `pnpm lint` + `pnpm typecheck` + `pnpm test`（Node 22，pnpm store 缓存）→ job 2: 构建宿主 + Agent Runner Docker 镜像（仅验证，不推送）
- [x] 5.2 验证：推送到分支后 CI 正常触发并通过

## 6. 收尾

- [x] 6.1 更新 `package.json` scripts：添加 `docker:build:host` 构建宿主镜像命令
- [x] 6.2 全量检查：`pnpm check`（lint + typecheck + test）通过
