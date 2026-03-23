## ADDED Requirements

### Requirement: web_search 工具可被容器内 Agent 调用
Agent ReAct Loop 中 SHALL 可使用 `web_search` 工具，通过 SearchBridge 执行 Brave 网页搜索。

#### Scenario: Agent 调用 web_search
- **WHEN** Agent 在 ReAct Loop 中调用 `web_search` 工具，参数为 `{ "query": "<搜索词>", "count": <可选数量> }`
- **THEN** skill SHALL 向 `SEARCH_BRIDGE_URL/search` 发送 GET 请求，并将格式化 Markdown 结果返回给 Agent 作为工具执行结果

#### Scenario: SearchBridge 不可达
- **WHEN** `SEARCH_BRIDGE_URL` 环境变量未设置或 Bridge 服务无响应
- **THEN** skill SHALL 返回错误字符串 `"Error: Search service unavailable"`，不抛出异常

#### Scenario: 搜索结果为空
- **WHEN** Brave API 返回 0 条结果
- **THEN** skill SHALL 返回 `"No results found for: <query>"`

---

### Requirement: web_fetch 工具可被容器内 Agent 调用
Agent ReAct Loop 中 SHALL 可使用 `web_fetch` 工具，通过 SearchBridge 抓取页面内容并获取 Haiku 摘要。

#### Scenario: Agent 调用 web_fetch
- **WHEN** Agent 在 ReAct Loop 中调用 `web_fetch` 工具，参数为 `{ "url": "<URL>", "prompt": "<可选摘要方向>" }`
- **THEN** skill SHALL 向 `SEARCH_BRIDGE_URL/fetch` 发送 POST 请求，并将摘要文本（`[Source: <url>]\n\n<内容>`）返回给 Agent

#### Scenario: 抓取失败
- **WHEN** SearchBridge 返回非 2xx 状态码（如超时、私有 IP 拦截）
- **THEN** skill SHALL 返回包含错误描述的字符串，不抛出异常，不中断 ReAct Loop

---

### Requirement: web-search skill 通过 stub 动态注入 Bridge URL
ContainerRunner SHALL 为含 `web-search` skill 的 task 在 `/ipc/web-search-stub/` 目录下动态生成 skill stub，并将 skill 的 `codePath` 重写为该路径。

#### Scenario: Stub 动态生成
- **WHEN** ContainerRunner 检测到 task.skills 包含 `web-search` 且已启动 SearchBridge
- **THEN** ContainerRunner SHALL 在 `<ipcDir>/web-search-stub/index.js` 写入包含硬编码 `SEARCH_BRIDGE_URL` 的 stub 文件，并将该 skill 的 `codePath` 替换为 `/ipc/web-search-stub`

#### Scenario: 容器内 skill 加载 stub
- **WHEN** 容器内 Agent 加载 skill 列表
- **THEN** skill loader SHALL 从 `/ipc/web-search-stub/index.js` 加载工具，工具内部 URL 指向宿主 SearchBridge 端口

---

### Requirement: web-search skill 在 LocalRunner 模式下可用
LocalRunner 模式（无 Docker）下，`web_search` 和 `web_fetch` 工具 SHALL 通过直接函数调用（不经 HTTP）访问 SearchBridge 逻辑。

#### Scenario: 本地模式 web_search
- **WHEN** LocalRunner 执行含 web-search skill 的 task
- **THEN** 系统 SHALL 不启动 HTTP 服务器，直接在进程内调用 SearchBridge 的 search 方法，将结果作为工具返回值

#### Scenario: 本地模式 web_fetch
- **WHEN** LocalRunner 执行含 web-search skill 的 task
- **THEN** 系统 SHALL 直接在进程内调用 SearchBridge 的 fetch 方法，不经过 HTTP 层
