## ADDED Requirements

### Requirement: Host Dockerfile
宿主进程 SHALL 提供多阶段 Dockerfile（deps → build → runtime），基于 `node:22-alpine`，生产镜像不包含编译工具链。

#### Scenario: 构建宿主镜像成功
- **WHEN** 执行 `docker build -t vigilclaw/host:latest .`
- **THEN** 镜像构建成功，runtime 阶段不包含 `build-base`、`python3` 等编译工具

#### Scenario: 镜像以非 root 用户运行
- **WHEN** 容器启动
- **THEN** 进程运行用户为 `vigilclaw`（非 root），UID > 0

#### Scenario: 原生模块正确编译
- **WHEN** 镜像构建完成
- **THEN** `better-sqlite3`、`sqlite-vec`、`sharp` 的原生绑定均可正常加载

### Requirement: Docker Compose 编排
`docker-compose.yml` SHALL 定义完整的宿主进程服务，包含健康检查、安全约束、卷挂载和环境变量映射。

#### Scenario: 一键启动
- **WHEN** 用户执行 `docker compose up -d`（且 `.env` 已正确配置）
- **THEN** 宿主进程容器启动，状态变为 healthy

#### Scenario: 健康检查集成
- **WHEN** 宿主容器运行
- **THEN** Docker 每 30 秒通过 `curl http://localhost:9100/health` 执行健康检查，连续 3 次失败标记为 unhealthy

#### Scenario: Agent Runner 镜像预构建
- **WHEN** 执行 `docker compose up -d` 之前
- **THEN** `setup.sh` 或文档中须明确要求先执行 `pnpm docker:build` 构建 Agent Runner 镜像

#### Scenario: 数据持久化
- **WHEN** 容器重启或重建
- **THEN** SQLite 数据库（`vigilclaw.db`）和 HuggingFace 模型缓存通过 Docker volume 持久化，数据不丢失

#### Scenario: 安全约束应用
- **WHEN** 容器运行
- **THEN** 应用 `cap_drop: ALL`、`no-new-privileges:true`、`read_only: true`（tmpfs 挂载 /tmp）

### Requirement: .dockerignore
项目根目录 SHALL 提供 `.dockerignore` 文件，排除非构建必要文件。

#### Scenario: 排除规则生效
- **WHEN** 构建 Docker 镜像
- **THEN** `node_modules/`、`data/`、`.env`、`tests/`、`docs/`、`.git/` 不包含在构建上下文中

### Requirement: 初始化脚本
`scripts/setup.sh` SHALL 提供交互式初始化向导，幂等运行不覆盖已有配置。

#### Scenario: 全新环境初始化
- **WHEN** 用户 clone 项目后执行 `bash scripts/setup.sh`
- **THEN** 脚本依次检测 Node.js ≥ 22、pnpm、Docker，缺失时给出安装提示并退出

#### Scenario: 生成 .env 配置
- **WHEN** `.env` 文件不存在
- **THEN** 从 `.env.example` 复制，交互式提示填入 `VIGILCLAW_TELEGRAM_BOT_TOKEN` 和 `ANTHROPIC_API_KEY`

#### Scenario: 幂等运行
- **WHEN** `.env` 已存在且配置完整
- **THEN** 脚本跳过配置生成步骤，仅执行构建和验证

#### Scenario: Master Key 自动生成
- **WHEN** `.env` 中 `VIGILCLAW_MASTER_KEY` 为空
- **THEN** 自动生成 64 位十六进制随机密钥并写入

#### Scenario: 本地模式支持
- **WHEN** 用户选择无 Docker 模式（或系统未安装 Docker）
- **THEN** 设置 `VIGILCLAW_LOCAL_MODE=true`，跳过 Docker 镜像构建，直接执行 `pnpm install` + `pnpm build`

### Requirement: 升级脚本
`scripts/upgrade.sh` SHALL 提供安全的升级流程。

#### Scenario: 正常升级
- **WHEN** 执行 `bash scripts/upgrade.sh`
- **THEN** 依次执行：`git pull` → `pnpm install` → `pnpm build` → 重建 Docker 镜像 → `docker compose up -d`（滚动重启）

#### Scenario: 升级前确认
- **WHEN** 执行升级脚本
- **THEN** 显示当前版本和远程最新版本的 diff 摘要，要求用户确认后再执行

#### Scenario: 数据库备份
- **WHEN** 执行升级
- **THEN** 在升级前自动备份 `data/vigilclaw.db` 到 `data/backups/vigilclaw-<timestamp>.db`

### Requirement: systemd 服务
`deploy/vigilclaw.service` SHALL 提供 systemd unit 文件，通过 `docker compose` 管理服务。

#### Scenario: 服务安装与启动
- **WHEN** 管理员执行 `sudo cp deploy/vigilclaw.service /etc/systemd/system/ && sudo systemctl enable --now vigilclaw`
- **THEN** 服务启动，`docker compose up -d` 在项目目录执行

#### Scenario: 开机自启
- **WHEN** 系统重启
- **THEN** vigilclaw 服务自动启动

#### Scenario: 日志集成
- **WHEN** 执行 `journalctl -u vigilclaw`
- **THEN** 显示 Docker Compose 的标准输出日志
