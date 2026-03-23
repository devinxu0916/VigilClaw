## Context

VigilClaw 的容器内 Agent 运行在严格隔离的 Docker 沙箱中（只读 rootfs、CAP_DROP ALL、无直接出网权限），仅能访问宿主进程暴露的受控 HTTP 端口。现有的 CredentialProxy 和 CommandBridge 已验证了"宿主代理层"模式的可行性。

本次引入 SearchBridge，作为第三个按 task 生命周期管理的宿主代理，为容器提供联网搜索和页面抓取能力，同时保持安全边界不变。

## Goals / Non-Goals

**Goals:**
- 容器内 Agent 可通过 `web_search` 工具搜索互联网（Brave Search API）
- 容器内 Agent 可通过 `web_fetch` 工具抓取页面内容（宿主抓取 + Haiku 摘要）
- Brave API Key 支持环境变量（`BRAVE_SEARCH_API_KEY`）和 `/setkey brave-search` 凭证存储双渠道
- SearchBridge 与现有 Bridge 生命周期管理保持一致（按 task 启动/销毁）

**Non-Goals:**
- 不支持 JavaScript 渲染（无 Puppeteer/Playwright）
- 不对搜索结果做缓存（无 Redis/内存缓存层）
- 不支持图片/视频搜索
- 不做结果的二次过滤（关键词黑名单等）

## Decisions

### D1：独立 SearchBridge，不扩展 CredentialProxy

**选择：** 新建 `src/search-bridge.ts`，独立类，生命周期与 CommandBridge 平行。

**替代方案：** 在 CredentialProxy 中新增 `/search/*` 路径。

**理由：**
- CredentialProxy 职责是"凭证注入 + LLM API 透传"，混入搜索逻辑破坏单一职责
- Search 响应是复杂 JSON，需要在宿主层做格式转换，不适合透传模式
- 独立 Bridge 便于独立关闭/配置（如未设置 Brave Key 时不启动）

---

### D2：web_fetch 使用两阶段处理（抓取 + Haiku 摘要）

**选择：** 宿主 fetch URL → HTML→Markdown（`node-html-markdown`）→ 截断 15000 字符 → 调 Claude Haiku → 返回摘要文本。

**替代方案 A：** 直接截断 Markdown 返回容器（不调 Haiku）。
**替代方案 B：** 直接推原始 HTML 进容器上下文。

**理由：**
- 替代方案 B 成本极高，一个页面可达 50k+ tokens
- 替代方案 A 简单但摘要质量差，LLM 需处理大量无关噪声
- Haiku 调用成本极低（~$0.001/次），且可通过 `prompt` 参数做定向摘要，大幅提升调研任务效果
- Haiku 复用宿主已有 `ANTHROPIC_API_KEY`，无额外配置

---

### D3：web-search 作为可选 Skill，不作为内置工具

**选择：** 实现为 skill（`/skills/web-search/index.js`），task 声明 `web-search` skill 时才启动 SearchBridge。

**替代方案：** 为所有容器内置 web_search/web_fetch 工具。

**理由：**
- 无需 search 的任务不应承担 SearchBridge 启动开销
- 与现有 skill 系统一致（system-commands 也是 skill）
- 未配置 Brave Key 时，不加载 skill 即可，系统其他功能不受影响

---

### D4：Skill stub 动态生成（类比 system-commands-stub）

**选择：** ContainerRunner 在 `ipcDir` 下动态写入 `web-search-stub/index.js`，注入 `SEARCH_BRIDGE_URL`，然后将 skill 的 `codePath` 重写为 `/ipc/web-search-stub`。

**替代方案：** 将 skill 静态打包进容器镜像。

**理由：**
- 与 system-commands-stub 模式完全一致，避免容器镜像和宿主服务 URL 的耦合
- 只读 rootfs 下通过 `/ipc` 挂载点安全注入
- Bridge URL（端口动态分配）和 task ID 在运行时才确定，必须动态生成

---

### D5：结果格式为格式化 Markdown 文本

**选择：**
- `web_search` 返回编号 Markdown 列表（标题 + URL + 描述 + extra snippets）
- `web_fetch` 返回 `[Source: <url>]\n\n<Haiku摘要>` 格式的纯文本

**理由：**
- LLM 对 Markdown 格式的结构化文本理解优于 JSON
- 无需容器内额外解析，直接纳入上下文
- Source 标注保留可溯源性

## Risks / Trade-offs

**[Haiku 摘要质量不足]** → 如页面结构复杂（SPA、反爬），HTML→Markdown 转换可能丢失关键内容。缓解：选用 `node-html-markdown`（比 turndown 更健壮），保留 15k 字符上限；未来可升级到 Sonnet 做摘要。

**[Brave API 配额耗尽]** → 免费计划 2000 次/月，调研任务可能在短时间内耗尽。缓解：SearchBridge 记录调用次数到日志，后续可集成 CostGuard；用户可自行升级 Brave 付费计划。

**[web_fetch 被滥用抓取内网地址]** → Agent 可能被诱导抓取 `http://169.254.169.254`（云元数据）等敏感地址。缓解：SearchBridge 实现 URL 校验，拦截私有 IP 段（RFC1918）和 link-local 地址，记录安全事件到 DB。

**[Haiku 调用增加延迟]** → 每次 web_fetch 增加约 1-3 秒 Haiku 响应时间。缓解：可接受，调研任务本身是耗时操作；未来可并行化多个 fetch 请求。

**[依赖新增]** → 引入 `node-html-markdown`。缓解：轻量库，无子依赖；若超出 50 依赖限制则考虑用正则替代或内联实现。

## Migration Plan

1. 新增 `src/search-bridge.ts` 和 `src/skills/web-search-stub.ts`（stub 生成器）
2. 修改 `src/container-runner.ts`，`src/local-runner.ts` 接入 SearchBridge
3. 修改 `src/router.ts` 支持 `/setkey brave-search`
4. 修改 `src/config.ts` 读取 `BRAVE_SEARCH_API_KEY`
5. 添加容器内 skill 注册（`container/agent-runner/src/tools/index.ts` 无需改动，web-search 通过 skill 机制加载）
6. 添加 `tests/unit/search-bridge.test.ts`

**回滚：** SearchBridge 完全独立，不影响现有功能。如果未设置 `BRAVE_SEARCH_API_KEY` 且未通过 `/setkey` 配置，web-search skill 的工具调用返回明确错误信息，不崩溃。

## Open Questions

- `node-html-markdown` 是否已在现有依赖树中？若否需确认不超出 50 依赖限制。（待 `scripts/check-deps.sh` 验证）
- LocalRunner 模式下 SearchBridge 是否需要完整 HTTP 服务，还是可以直接函数调用？（当前倾向：直接调用，不启 HTTP，减少本地开发复杂度）
