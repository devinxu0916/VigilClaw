## Context

VigilClaw 当前的上下文管理是硬编码的 20 条消息滑动窗口（`SessionManager.getContext()`），无 token 感知、无摘要、无跨会话记忆。Claude Sonnet 的上下文窗口为 200K tokens，但系统从不利用这个容量——短对话浪费窗口，长对话丢失早期信息。

技术约束：

- 7 个生产依赖，本次新增 2 个（sqlite-vec、@xenova/transformers），保持轻量
- SQLite 为唯一数据库，迁移系统已就位（当前 v1）
- 消息流: Router → SessionManager.getContext() → GroupQueue → Runner → Claude API
- `messages` 表已有 `tokens` 列但未使用
- 项目运行在 macOS（开发）和 Linux（生产），需兼容两个平台

## Goals / Non-Goals

**Goals:**

- 对话超过 token 预算时自动压缩旧消息为摘要，避免信息丢失
- 跨会话持久记忆：对话结束后提取关键信息，新对话开始时语义检索注入
- 压缩和记忆对用户透明，不改变交互方式
- 压缩成本可控（固定使用 Haiku 模型）
- 记忆嵌入完全本地化，零 API 成本

**Non-Goals:**

- 多模型 Provider 支持（属于 Phase 2 另一个独立功能）
- 知识图谱 / 结构化记忆（P3 功能）
- 用户手动管理记忆的 UI 或命令（后续迭代）
- 嵌入模型的在线更新或热切换

## Decisions

### D1: 压缩策略 — 增量摘要 + 滑动窗口

**选择**: LangChain `ConversationSummaryBufferMemory` 模式

当 token 总量超过阈值（默认 6000 tokens）时：

1. 保留最近 N 条消息不动（默认最近 6 条）
2. 将被移出的旧消息增量合并到现有摘要
3. 摘要作为第一条 system 消息注入上下文

**替代方案**:

- 简单截断（当前方案）：丢失信息，已排除
- 全量摘要每次重算：成本高，O(n) API 调用
- 锚定迭代摘要（Factory 模式）：更结构化但实现复杂，过度设计

**理由**: 增量摘要每次只处理新移出的消息，O(1) API 调用，成本线性增长。

### D2: Token 计数 — 字符估算

**选择**: `1 token ≈ 4 chars`，即 `Math.ceil(text.length / 4)`

**替代方案**:

- Anthropic countTokens API：精确但每次需要网络调用，增加延迟
- js-tiktoken：精确、本地，但新增依赖且 Claude tokenizer 可能不完全匹配

**理由**: 误差 ~10-15% 在上下文压缩场景可接受（预算本身留有余量）。零成本零延迟。后续如需精确可平滑切换。

### D3: 摘要模型 — 固定 Haiku

**选择**: 始终使用 `claude-haiku-3-5-20250929` 做摘要

**理由**: 摘要是辅助任务，Haiku 成本仅 Sonnet 的 1/3，质量足够。不随用户模型变化，成本可预测。

### D4: 嵌入模型 — 本地 all-MiniLM-L6-v2

**选择**: `@xenova/transformers` + `Xenova/all-MiniLM-L6-v2` (384 维)

**替代方案**:

- `gte-base` (768 维)：质量略高但模型体积翻倍（~200MB vs ~80MB）
- Anthropic Voyager API：更轻量但增加 API 依赖和成本
- OpenAI text-embedding-3-small：同上

**理由**: 384 维足够做对话级语义检索，模型小（~80MB），符合项目"安全优先"理念（完全离线）。

### D5: 向量存储 — sqlite-vec

**选择**: `sqlite-vec` 扩展加载到现有 better-sqlite3 实例

**理由**: 复用现有 SQLite 基础设施，零额外服务进程。vec0 虚拟表原生支持 KNN 查询。与 better-sqlite3 兼容（通过 `sqliteVec.load(db)` 加载）。

### D6: 记忆提取时机 — 对话结束时异步提取

**选择**: 在 assistant 回复后（`index.ts` executor 成功路径），异步提取本轮对话的关键信息

提取方式：用 Haiku 模型从最新一轮 user+assistant 消息中提取值得记忆的事实/偏好。只在内容足够有价值时存储（由 LLM 判断）。

**替代方案**:

- 每条消息都存嵌入：噪声太多，检索质量差
- 只在 /clear 时批量提取：太晚，可能丢失中间信息

### D7: 记忆注入方式 — system 消息前置

**选择**: 在 `getContext()` 中，将检索到的相关记忆拼接为一条 system 消息，置于上下文最前面（在摘要之后）

格式:

```
[Relevant memories from previous conversations]
- User prefers TypeScript over JavaScript
- User's project uses pnpm and Vitest
```

### D8: 集成架构 — 扩展 SessionManager

**选择**: 在 SessionManager 中组合 ContextCompressor 和 MemoryStore，扩展 `getContext()` 方法

```
getContext() 新流程:
1. 从 DB 读取最近消息（增大到 50 条以容纳压缩前的原始消息）
2. ContextCompressor.compress(messages) → [summary?, ...recentMessages]
3. MemoryStore.recall(userId, latestUserMessage) → relevantMemories[]
4. 拼装: [summary] + [memories] + [recentMessages]
```

**理由**: 保持 Router 层不变，SessionManager 作为唯一集成点，最小侵入。

## Risks / Trade-offs

**[摘要丢失关键细节]** → 保留最近 6 条消息完整不压缩；摘要 prompt 强调保留代码片段、文件路径等技术细节

**[sqlite-vec macOS ARM 兼容性]** → sqlite-vec 官方提供 prebuilt binaries for darwin-arm64；若加载失败则降级为纯文本搜索（关键词匹配）

**[@xenova/transformers 首次加载慢]** → 模型在启动时预加载，不阻塞消息处理；首次下载后缓存到 `~/.cache/huggingface`

**[摘要 API 调用增加成本]** → Haiku 模型成本极低（~$0.001/次）；仅在 token 超限时触发，短对话不触发

**[嵌入模型磁盘占用 ~80MB]** → 对于开发者工具可接受；可配置禁用记忆功能

**[记忆检索注入无关信息]** → 设置相似度阈值（默认 0.7），低于阈值的记忆不注入；限制最多注入 5 条记忆
