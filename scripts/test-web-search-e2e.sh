#!/bin/bash
# E2E 测试脚本 - web-search-bridge 功能
# 用法: BRAVE_SEARCH_API_KEY=xxx ANTHROPIC_API_KEY=xxx ./scripts/test-web-search-e2e.sh

set -e

echo "🧪 VigilClaw Web Search E2E 测试"
echo "================================"
echo ""

# 检查必需的环境变量
if [ -z "$BRAVE_SEARCH_API_KEY" ]; then
  echo "❌ 缺少 BRAVE_SEARCH_API_KEY 环境变量"
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ 缺少 ANTHROPIC_API_KEY 环境变量"
  exit 1
fi

echo "✓ 环境变量检查通过"
echo ""

# 设置本地模式
export VIGILCLAW_LOCAL_MODE=true
export VIGILCLAW_DATA_DIR=/tmp/vigilclaw-test-$$

echo "📁 测试数据目录: $VIGILCLAW_DATA_DIR"
mkdir -p "$VIGILCLAW_DATA_DIR"

echo ""
echo "🔨 构建项目..."
pnpm build

echo ""
echo "📝 测试说明："
echo "   由于本地模式下没有消息渠道，需要手动验证："
echo "   1. SearchBridge 能正常启动"
echo "   2. web-search skill 能被正确加载"
echo "   3. 查看日志确认功能正常"
echo ""
echo "💡 完整 E2E 测试需要启动 Telegram Bot（见方案 2）"
echo ""

# 清理
trap "rm -rf $VIGILCLAW_DATA_DIR" EXIT

echo "✅ 准备工作完成"
echo ""
echo "下一步："
echo "  1. 设置 VIGILCLAW_TELEGRAM_BOT_TOKEN"
echo "  2. 运行: pnpm dev"
echo "  3. 在 Telegram 中发送: 帮我搜索一下 TypeScript 最佳实践"
