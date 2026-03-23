#!/bin/bash
# 诊断 web-search 功能问题

echo "🔍 诊断 Web Search 功能"
echo "========================"
echo ""

# 1. 检查环境变量
echo "1️⃣ 检查环境变量"
if [ -n "$BRAVE_SEARCH_API_KEY" ]; then
  echo "✅ BRAVE_SEARCH_API_KEY 已设置（长度: ${#BRAVE_SEARCH_API_KEY}）"
else
  echo "❌ BRAVE_SEARCH_API_KEY 未设置"
fi
echo ""

# 2. 测试 Brave Search API 连接
echo "2️⃣ 测试 Brave Search API 连接"
if [ -n "$BRAVE_SEARCH_API_KEY" ]; then
  echo "正在测试 API..."
  response=$(curl -s -w "\n%{http_code}" --max-time 10 \
    -H "Accept: application/json" \
    -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" \
    "https://api.search.brave.com/res/v1/web/search?q=test&count=1" 2>&1)

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)

  if [ "$http_code" = "200" ]; then
    echo "✅ API 连接成功（HTTP $http_code）"
    echo "响应预览: $(echo "$body" | head -c 100)..."
  else
    echo "❌ API 连接失败（HTTP $http_code）"
    echo "错误信息: $body"
  fi
else
  echo "⏭️  跳过（未设置 API Key）"
fi
echo ""

# 3. 检查数据库中的凭证
echo "3️⃣ 检查数据库凭证"
if [ -f "$HOME/.local/share/vigilclaw/vigilclaw.db" ]; then
  echo "数据库路径: $HOME/.local/share/vigilclaw/vigilclaw.db"
  cred_count=$(sqlite3 "$HOME/.local/share/vigilclaw/vigilclaw.db" \
    "SELECT COUNT(*) FROM credentials WHERE key_name='brave-search'" 2>/dev/null || echo "0")
  if [ "$cred_count" -gt 0 ]; then
    echo "✅ 数据库中存在 brave-search 凭证"
  else
    echo "❌ 数据库中不存在 brave-search 凭证"
  fi
else
  echo "⚠️  数据库文件不存在"
fi
echo ""

# 4. 检查 web-search skill 注册
echo "4️⃣ 检查 web-search skill 注册"
if [ -f "$HOME/.local/share/vigilclaw/vigilclaw.db" ]; then
  skill_count=$(sqlite3 "$HOME/.local/share/vigilclaw/vigilclaw.db" \
    "SELECT COUNT(*) FROM skills WHERE name='web-search'" 2>/dev/null || echo "0")
  if [ "$skill_count" -gt 0 ]; then
    echo "✅ web-search skill 已注册"
    sqlite3 "$HOME/.local/share/vigilclaw/vigilclaw.db" \
      "SELECT name, version, enabled FROM skills WHERE name='web-search'" 2>/dev/null
  else
    echo "❌ web-search skill 未注册"
  fi
else
  echo "⚠️  数据库文件不存在"
fi
echo ""

# 5. 建议
echo "💡 建议"
echo "-------"
if [ -z "$BRAVE_SEARCH_API_KEY" ]; then
  echo "1. 设置环境变量："
  echo "   export BRAVE_SEARCH_API_KEY=your_api_key_here"
  echo ""
  echo "2. 或使用 /setkey 命令："
  echo "   /setkey brave-search your_api_key_here"
fi
echo ""
echo "3. 重启 VigilClaw："
echo "   pnpm build && pnpm start"
