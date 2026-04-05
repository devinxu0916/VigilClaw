#!/usr/bin/env bash
set -euo pipefail

# VigilClaw 升级脚本
# 用法: bash scripts/upgrade.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR ]${NC} $*"; }

cd "${PROJECT_DIR}"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║      VigilClaw Upgrade               ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── 1. 检查 git 状态 ──────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  error "未找到 git 命令"
  exit 1
fi

info "获取远程更新..."
git fetch origin --quiet

CURRENT=$(git rev-parse --short HEAD)
REMOTE=$(git rev-parse --short origin/master 2>/dev/null || git rev-parse --short origin/main 2>/dev/null)

if [ "${CURRENT}" = "${REMOTE}" ]; then
  ok "已是最新版本（${CURRENT}），无需升级"
  exit 0
fi

echo ""
echo "  当前版本：${CURRENT}"
echo "  最新版本：${REMOTE}"
echo ""
echo "  变更内容："
git log --oneline "${CURRENT}..${REMOTE}" | sed 's/^/    /'
echo ""

read -r -p "  确认升级？[y/N] " choice
if [[ ! "${choice}" =~ ^[Yy]$ ]]; then
  warn "已取消升级"
  exit 0
fi

# ── 2. 备份数据库 ─────────────────────────────────────────────────────────────
DB_PATH="${PROJECT_DIR}/data/vigilclaw.db"
BACKUP_DIR="${PROJECT_DIR}/data/backups"

if [ -f "${DB_PATH}" ]; then
  mkdir -p "${BACKUP_DIR}"
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="${BACKUP_DIR}/vigilclaw-${TIMESTAMP}.db"
  cp "${DB_PATH}" "${BACKUP_FILE}"
  ok "数据库已备份至 ${BACKUP_FILE}"
else
  warn "未找到数据库文件，跳过备份"
fi

# ── 3. 拉取代码 ───────────────────────────────────────────────────────────────
info "拉取最新代码..."
git pull origin master 2>/dev/null || git pull origin main 2>/dev/null
ok "代码更新完成"

# ── 4. 安装依赖 & 编译 ────────────────────────────────────────────────────────
info "安装依赖..."
pnpm install --frozen-lockfile
ok "依赖更新完成"

info "编译 TypeScript..."
pnpm build
ok "编译完成"

# ── 5. 重建 Docker 镜像（如果使用 Docker 模式）───────────────────────────────
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  if docker image inspect vigilclaw/agent-runner:latest &>/dev/null 2>&1; then
    info "重建 Agent Runner 镜像..."
    docker build -t vigilclaw/agent-runner:latest container/agent-runner/
    ok "Agent Runner 镜像重建完成"
  fi

  if docker image inspect vigilclaw/host:latest &>/dev/null 2>&1; then
    info "重建宿主进程镜像..."
    docker build -t vigilclaw/host:latest .
    ok "宿主进程镜像重建完成"
  fi

  if [ -f "${PROJECT_DIR}/docker-compose.yml" ] && docker compose ps --quiet 2>/dev/null | grep -q .; then
    info "重启服务..."
    docker compose up -d
    ok "服务重启完成"
  fi
fi

# ── 6. 完成 ───────────────────────────────────────────────────────────────────
echo ""
ok "升级完成：${CURRENT} → ${REMOTE}"
echo ""
