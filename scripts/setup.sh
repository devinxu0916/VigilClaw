#!/usr/bin/env bash
set -euo pipefail

# VigilClaw 一键初始化脚本
# 用法: bash scripts/setup.sh [--local]
#   --local   跳过 Docker 步骤，使用本地模式

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_MODE=false

for arg in "$@"; do
  case $arg in
    --local) LOCAL_MODE=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR ]${NC} $*"; }

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║      VigilClaw Setup Wizard          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

cd "${PROJECT_DIR}"

# ── 1. 环境检测 ───────────────────────────────────────────────────────────────
info "检测环境..."

check_node() {
  if ! command -v node &>/dev/null; then
    error "未找到 Node.js。请安装 Node.js ≥ 22：https://nodejs.org/"
    exit 1
  fi
  local version
  version=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
  if [ "${version}" -lt 22 ]; then
    error "Node.js 版本过低（当前 v${version}），需要 ≥ 22"
    error "可用 nvm 切换：nvm use 22"
    exit 1
  fi
  ok "Node.js $(node --version)"
}

check_pnpm() {
  if ! command -v pnpm &>/dev/null; then
    error "未找到 pnpm。请安装：npm install -g pnpm"
    exit 1
  fi
  ok "pnpm $(pnpm --version)"
}

check_docker() {
  if [ "${LOCAL_MODE}" = "true" ]; then
    warn "跳过 Docker 检测（--local 模式）"
    return
  fi
  if ! command -v docker &>/dev/null; then
    warn "未找到 Docker。如需容器模式，请安装 Docker：https://docs.docker.com/get-docker/"
    echo ""
    read -r -p "  是否切换到本地模式继续？[y/N] " choice
    if [[ "${choice}" =~ ^[Yy]$ ]]; then
      LOCAL_MODE=true
      warn "已切换到本地模式"
    else
      exit 1
    fi
    return
  fi
  if ! docker info &>/dev/null 2>&1; then
    error "Docker 守护进程未运行，请先启动 Docker"
    exit 1
  fi
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

check_node
check_pnpm
check_docker

# ── 2. 配置文件 ───────────────────────────────────────────────────────────────
info "配置环境变量..."

ENV_FILE="${PROJECT_DIR}/.env"
ENV_EXAMPLE="${PROJECT_DIR}/.env.example"

if [ ! -f "${ENV_FILE}" ]; then
  if [ ! -f "${ENV_EXAMPLE}" ]; then
    error ".env.example 不存在，无法初始化配置"
    exit 1
  fi
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  info "已从 .env.example 创建 .env"

  echo ""
  echo "  请填入必要配置（直接回车保留默认值）："
  echo ""

  # Telegram Bot Token
  read -r -p "  VIGILCLAW_TELEGRAM_BOT_TOKEN: " bot_token
  if [ -n "${bot_token}" ]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^VIGILCLAW_TELEGRAM_BOT_TOKEN=.*|VIGILCLAW_TELEGRAM_BOT_TOKEN=${bot_token}|" "${ENV_FILE}"
    else
      sed -i "s|^VIGILCLAW_TELEGRAM_BOT_TOKEN=.*|VIGILCLAW_TELEGRAM_BOT_TOKEN=${bot_token}|" "${ENV_FILE}"
    fi
  fi

  # Anthropic API Key
  read -r -p "  ANTHROPIC_API_KEY: " api_key
  if [ -n "${api_key}" ]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${api_key}|" "${ENV_FILE}"
    else
      sed -i "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${api_key}|" "${ENV_FILE}"
    fi
  fi

  ok ".env 配置完成"
else
  ok ".env 已存在，跳过配置生成"
fi

# ── 3. 生成 Master Key ────────────────────────────────────────────────────────
if grep -qE "^VIGILCLAW_MASTER_KEY=\s*$" "${ENV_FILE}" 2>/dev/null || \
   grep -qE "^VIGILCLAW_MASTER_KEY=your-64-char-hex-key" "${ENV_FILE}" 2>/dev/null; then
  info "生成 Master Key..."
  master_key=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^VIGILCLAW_MASTER_KEY=.*|VIGILCLAW_MASTER_KEY=${master_key}|" "${ENV_FILE}"
  else
    sed -i "s|^VIGILCLAW_MASTER_KEY=.*|VIGILCLAW_MASTER_KEY=${master_key}|" "${ENV_FILE}"
  fi
  ok "Master Key 已生成"
else
  ok "Master Key 已设置，跳过生成"
fi

# ── 4. 本地模式标志 ───────────────────────────────────────────────────────────
if [ "${LOCAL_MODE}" = "true" ]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^VIGILCLAW_LOCAL_MODE=.*|VIGILCLAW_LOCAL_MODE=true|" "${ENV_FILE}"
  else
    sed -i "s|^VIGILCLAW_LOCAL_MODE=.*|VIGILCLAW_LOCAL_MODE=true|" "${ENV_FILE}"
  fi
  ok "已设置 VIGILCLAW_LOCAL_MODE=true"
fi

# ── 5. 安装依赖 & 编译 ────────────────────────────────────────────────────────
info "安装依赖..."
pnpm install --frozen-lockfile
ok "依赖安装完成"

info "编译 TypeScript..."
pnpm build
ok "编译完成"

# ── 6. 构建 Docker 镜像 ───────────────────────────────────────────────────────
if [ "${LOCAL_MODE}" = "false" ]; then
  info "构建 Agent Runner 镜像..."
  docker build -t vigilclaw/agent-runner:latest container/agent-runner/
  ok "Agent Runner 镜像构建完成"

  info "构建宿主进程镜像..."
  docker build -t vigilclaw/host:latest .
  ok "宿主进程镜像构建完成"
fi

# ── 7. 完成 ───────────────────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        Setup 完成！                  ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

if [ "${LOCAL_MODE}" = "true" ]; then
  echo "  本地模式启动："
  echo "    pnpm dev"
else
  echo "  Docker 模式启动："
  echo "    docker compose up -d"
  echo ""
  echo "  查看状态："
  echo "    docker compose ps"
  echo "    docker compose logs -f"
fi
echo ""
