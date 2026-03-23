## 1. 依赖与配置

- [x] 1.1 安装 `node-html-markdown` 依赖（`pnpm add node-html-markdown`），运行 `scripts/check-deps.sh` 确认不超 50 个生产依赖
- [x] 1.2 在 `src/config.ts` 中添加 `BRAVE_SEARCH_API_KEY` 环境变量读取（可选，Zod schema）
- [x] 1.3 确认 `src/router.ts` 的 `/setkey` 命令已支持通用 key name，无需修改；若不支持则添加 `brave-search` 的 key name 处理

## 2. SearchBridge 核心实现

- [x] 2.1 新建 `src/search-bridge.ts`，实现 `SearchBridge` 类，包含 `createBridgeForTask(taskId)` 和 `destroyBridgeForTask(taskId)` 方法（与 CommandBridge 生命周期接口对齐）
- [x] 2.2 实现 API Key 双渠道读取逻辑：优先 `BRAVE_SEARCH_API_KEY` env，回退到 DB credentials（key name: `brave-search`）
- [x] 2.3 实现 `GET /search` 端点：调用 Brave Search API，返回格式化 Markdown 列表（含 extra_snippets）
- [x] 2.4 实现 `POST /fetch` 端点：fetch URL → HTML → `node-html-markdown` 转 Markdown → 截断 15000 字符 → 调 Claude Haiku → 返回 `[Source: <url>]\n\n<摘要>`
- [x] 2.5 在 `/fetch` 端点中实现私有 IP 拦截：校验 RFC1918 + link-local 地址，拒绝并写入 `security_events` 表
- [x] 2.6 为 `SearchBridge` 添加 LocalRunner 模式下的直接函数调用接口（不启 HTTP 服务器）

## 3. ContainerRunner 集成

- [x] 3.1 在 `src/container-runner.ts` 中实例化并持有 `SearchBridge`（类比 `commandBridge` 字段）
- [x] 3.2 在 `runTask` 方法中，检测到 `web-search` skill 时启动 SearchBridge，动态写入 `<ipcDir>/web-search-stub/index.js`
- [x] 3.3 在 `writeTaskInput` 前将 `web-search` skill 的 `codePath` 重写为 `/ipc/web-search-stub`（类比 system-commands-stub 重写逻辑）
- [x] 3.4 在 task 结束的 `finally` 块中调用 `destroyBridgeForTask`，确保端口释放

## 4. LocalRunner 集成

- [x] 4.1 在 `src/local-runner.ts` 中集成 `SearchBridge`，检测到 `web-search` skill 时直接以函数调用方式执行（不经 HTTP）
- [x] 4.2 确保 LocalRunner 模式下工具返回值格式与容器模式一致

## 5. Skill Stub 实现

- [x] 5.1 新建 `src/skills/web-search-stub.ts`，实现 `generateWebSearchStubJs(bridgeUrl: string): string` 函数，生成包含 `web_search` 和 `web_fetch` 工具定义的 CommonJS stub 代码
- [x] 5.2 `web_search` 工具 schema：`{ query: string, count?: number }` → GET `/search?q=<query>&count=<n>`
- [x] 5.3 `web_fetch` 工具 schema：`{ url: string, prompt?: string }` → POST `/fetch` body `{ url, prompt }`
- [x] 5.4 stub 中处理 SearchBridge 不可达和非 2xx 响应，返回错误字符串而非抛出异常

## 6. 测试

- [x] 6.1 新建 `tests/unit/search-bridge.test.ts`，测试 API Key 双渠道读取逻辑（mock DB + env var）
- [x] 6.2 测试 `/search` 端点格式化逻辑（mock Brave API 响应，验证输出格式）
- [x] 6.3 测试 `/fetch` 端点的私有 IP 拦截（RFC1918 各段均测试）
- [x] 6.4 测试 stub 生成函数（`generateWebSearchStubJs` 返回可执行的 JS）
- [x] 6.5 测试 Brave Key 未配置时的错误响应（503 + 提示文案）

## 7. 验证

- [x] 7.1 运行 `pnpm typecheck`，确认无 TypeScript 错误
- [x] 7.2 运行 `pnpm test`，确认所有测试通过（含覆盖率阈值）
- [x] 7.3 运行 `pnpm lint`，确认无 ESLint 错误（新增文件无 errors，预存 57 errors 在已有代码中）
- [x] 7.4 本地模式（`VIGILCLAW_LOCAL_MODE=true`）手动测试：给 Agent 布置一个搜索任务，验证 `web_search` 和 `web_fetch` 均可正常返回结果
- [x] 7.5 运行 `scripts/check-deps.sh`，确认生产依赖数量未超限
