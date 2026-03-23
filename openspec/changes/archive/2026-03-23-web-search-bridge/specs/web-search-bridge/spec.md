## ADDED Requirements

### Requirement: SearchBridge 按 task 生命周期启动和销毁
SearchBridge SHALL 在 ContainerRunner/LocalRunner 为每个 task 启动时按需创建，在 task 结束时（无论成功或失败）销毁。

#### Scenario: 含 web-search skill 的 task 启动
- **WHEN** ContainerRunner 检测到 task.skills 包含名为 `web-search` 的 skill
- **THEN** 系统 SHALL 在容器启动前创建 SearchBridge 实例，绑定随机可用端口，并将 `SEARCH_BRIDGE_URL=http://host.docker.internal:<port>` 注入容器环境变量

#### Scenario: 不含 web-search skill 的 task 启动
- **WHEN** ContainerRunner 检测到 task.skills 不包含 `web-search` skill
- **THEN** 系统 SHALL 不创建 SearchBridge，不占用额外端口

#### Scenario: task 结束时清理
- **WHEN** task 执行完毕（成功、失败或超时）
- **THEN** 系统 SHALL 关闭对应的 SearchBridge HTTP 服务器，释放端口

---

### Requirement: SearchBridge 提供 /search 端点（Brave Search）
SearchBridge SHALL 暴露 GET `/search` HTTP 端点，代理调用 Brave Search API 并返回格式化结果。

#### Scenario: 正常搜索请求
- **WHEN** 容器内 skill 发送 `GET /search?q=<query>&count=<n>`
- **THEN** SearchBridge SHALL 调用 `https://api.search.brave.com/res/v1/web/search`，携带 `X-Subscription-Token` 请求头，并将结果格式化为编号 Markdown 列表返回（每条含标题、URL、描述、extra snippets）

#### Scenario: count 参数缺省
- **WHEN** 请求未包含 count 参数
- **THEN** SearchBridge SHALL 默认使用 count=5

#### Scenario: Brave API 返回错误
- **WHEN** Brave Search API 返回非 2xx 状态码
- **THEN** SearchBridge SHALL 返回 HTTP 502，响应体包含错误描述字符串

#### Scenario: Brave API Key 未配置
- **WHEN** 环境变量 `BRAVE_SEARCH_API_KEY` 未设置且凭证存储中不存在 `brave-search` key
- **THEN** SearchBridge SHALL 返回 HTTP 503，响应体为 `"Brave Search API key not configured. Use /setkey brave-search <key> or set BRAVE_SEARCH_API_KEY env var."`

---

### Requirement: SearchBridge 提供 /fetch 端点（页面抓取 + Haiku 摘要）
SearchBridge SHALL 暴露 POST `/fetch` HTTP 端点，抓取指定 URL 的页面内容，转换为 Markdown 后经 Claude Haiku 摘要，返回精炼文本。

#### Scenario: 正常抓取请求
- **WHEN** 容器内 skill 发送 `POST /fetch`，body 为 `{ "url": "<url>", "prompt": "<optional hint>" }`
- **THEN** SearchBridge SHALL 抓取 URL、将 HTML 转换为 Markdown（截断至 15000 字符）、调用 Claude Haiku 生成摘要，返回 `[Source: <url>]\n\n<摘要>` 格式的纯文本

#### Scenario: prompt 参数缺省
- **WHEN** 请求 body 中未包含 prompt 字段
- **THEN** SearchBridge SHALL 使用默认 prompt `"Summarize the key information from this page content."` 调用 Haiku

#### Scenario: 目标 URL 返回非 HTML 内容
- **WHEN** 抓取的 URL 响应 Content-Type 不包含 `text/html`
- **THEN** SearchBridge SHALL 直接截断原始文本内容（最多 8000 字符）作为 Haiku 输入

#### Scenario: 私有 IP 地址被拦截
- **WHEN** 请求的 URL 解析后指向私有 IP 段（RFC1918：10.x, 172.16-31.x, 192.168.x）或 link-local 地址（169.254.x.x）
- **THEN** SearchBridge SHALL 拒绝请求，返回 HTTP 403，并向 DB 写入 `security_events` 记录（severity: high）

#### Scenario: URL 抓取超时
- **WHEN** 目标 URL 在 10 秒内未响应
- **THEN** SearchBridge SHALL 返回 HTTP 504，响应体包含超时错误描述

---

### Requirement: Brave API Key 双渠道管理
SearchBridge SHALL 支持通过环境变量和凭证存储两种方式获取 Brave Search API Key。

#### Scenario: 环境变量优先
- **WHEN** `BRAVE_SEARCH_API_KEY` 环境变量已设置
- **THEN** SearchBridge SHALL 使用该值，不查询凭证存储

#### Scenario: 回退到凭证存储
- **WHEN** `BRAVE_SEARCH_API_KEY` 环境变量未设置，但凭证存储中存在 key name 为 `brave-search` 的记录
- **THEN** SearchBridge SHALL 从 DB 解密读取该凭证并使用

#### Scenario: /setkey 命令写入凭证
- **WHEN** 用户发送 `/setkey brave-search <api-key>` 命令
- **THEN** Router SHALL 将 api-key 加密存储到 credentials 表（key name: `brave-search`），并回复确认消息
