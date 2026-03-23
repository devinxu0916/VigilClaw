## Why

容器内 Agent 目前没有联网能力，无法完成调研类任务（搜索最新资讯、抓取网页内容）。容器的网络隔离是安全设计，但可以通过宿主代理层安全地引入受控的出网通道。

## What Changes

- **新增 SearchBridge**：宿主进程中的 HTTP 代理服务，按 task 按需启动/销毁，转发 Brave Search API 调用和 URL 抓取请求
- **新增 web-search skill**：容器内可加载的 skill，暴露 `web_search` 和 `web_fetch` 两个工具
  - `web_search(query, count?)` — 调 Brave Search API，返回格式化 Markdown 结果列表
  - `web_fetch(url, prompt?)` — 抓取页面 HTML，转 Markdown 后经 Claude Haiku 摘要，返回精炼文本
- **修改 ContainerRunner**：检测到 `web-search` skill 时启动 SearchBridge，注入 `SEARCH_BRIDGE_URL` 环境变量
- **修改 LocalRunner**：本地模式下同样支持 SearchBridge（直接在进程内调用，无需 HTTP）
- **修改 Router/Config**：支持 `BRAVE_SEARCH_API_KEY` 环境变量；`/setkey brave-search <key>` 命令写入凭证存储

## Capabilities

### New Capabilities

- `web-search-bridge`: 宿主层 SearchBridge 服务，代理 Brave Search API 调用和 URL 抓取，含 API Key 管理（env + credentials store 双渠道）
- `web-search-skill`: 容器内 web-search skill，实现 `web_search` 和 `web_fetch` 两个 Agent 工具

### Modified Capabilities

- `system-commands-skill`: ContainerRunner 的 Bridge 生命周期管理模式被 SearchBridge 复用，但 spec 层需求不变，无需 delta spec

## Impact

**新增依赖：**
- `node-html-markdown`（或 `turndown`）— HTML 转 Markdown
- `@anthropic-ai/sdk`（已有，宿主层 Haiku 调用复用）

**受影响文件：**
- `src/search-bridge.ts` — 新增
- `src/container-runner.ts` — 启动/销毁 SearchBridge
- `src/local-runner.ts` — 本地模式适配
- `src/router.ts` — `/setkey brave-search` 命令支持
- `src/config.ts` — `BRAVE_SEARCH_API_KEY` 环境变量
- `src/db.ts` — 凭证存储 key name `brave-search`（已支持通用凭证，无需修改）
- `container/agent-runner/src/tools/index.ts` — 注册 web-search skill 工具
- `skills/web-search/index.js` — 新增（在宿主 skills 目录，动态生成 stub 或静态打包）
