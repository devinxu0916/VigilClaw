## 1. 基础设施准备

- [x] 1.1 安装新依赖：`pnpm add sqlite-vec @xenova/transformers`
- [x] 1.2 扩展配置系统：在 `src/config.ts` 的 `SessionConfigSchema` 中新增 `maxContextTokens`(default 6000)、`recentMessagesKeep`(default 6)；新增 `MemoryConfigSchema` 含 `enabled`/`similarityThreshold`/`maxRecallCount`/`embeddingModel`
- [x] 1.3 数据库迁移 v2：在 `src/db.ts` 新增 `context_summaries` 表（session_key, summary, updated_at）、`memories` 表（id, user_id, group_id, scope_key, content, metadata, created_at）、`vec_memories` 虚拟表（vec0, embedding float[384]）
- [x] 1.4 扩展 DAL：在 `VigilClawDB` 中新增 prepared statements 和方法 — `upsertContextSummary`/`getContextSummary`/`deleteContextSummary`/`insertMemory`/`searchMemories`/`deleteOldMemories`

## 2. 上下文压缩器

- [x] 2.1 创建 `src/context-compressor.ts`：实现 `estimateTokens(text)` 字符估算函数（`Math.ceil(text.length / 4)`）
- [x] 2.2 实现 `ContextCompressor` 类：构造函数接收 `ClaudeProvider`、`VigilClawDB`、config 参数；实现 `compress(sessionKey, messages): Promise<Message[]>` 方法
- [x] 2.3 实现压缩核心逻辑：计算 token 总量 → 超限则分离 recent/old 消息 → 加载已有 summary → 调用 Haiku 做增量摘要 → 存储新 summary → 返回 [summary_msg, ...recent_msgs]
- [x] 2.4 实现摘要 prompt：设计增量摘要的 system prompt，强调保留代码片段、文件路径、技术决策等关键细节
- [x] 2.5 实现降级逻辑：摘要 API 调用失败时回退到简单截断（保留 recentMessagesKeep 条消息），记录 warning 日志
- [x] 2.6 编写 context-compressor 单元测试：测试 token 估算、压缩触发判断、summary 生成和持久化、降级逻辑

## 3. 持久化记忆系统

- [x] 3.1 创建 `src/embedder.ts`：封装 `@xenova/transformers` 的 pipeline 初始化和 `embed(text): Promise<Float32Array>` 方法，支持懒加载
- [x] 3.2 实现 sqlite-vec 扩展加载：在 `src/db.ts` 的 `initRawDatabase` 中加载 sqlite-vec，加载失败时记录 warning 并设置 `vecAvailable` 标志
- [x] 3.3 创建 `src/memory-store.ts`：实现 `MemoryStore` 类，构造函数接收 `VigilClawDB`、`Embedder`、`ClaudeProvider`、config
- [x] 3.4 实现记忆提取：`extractMemory(userId, groupId, userMessage, assistantMessage): Promise<void>` — 用 Haiku 从对话中提取值得记忆的事实，判断无价值则跳过
- [x] 3.5 实现记忆存储：将提取的记忆文本 embed 后存入 `memories` + `vec_memories` 表
- [x] 3.6 实现记忆召回：`recall(userId, groupId, queryText, limit, threshold): Promise<string[]>` — embed query → vec_memories KNN → 过滤阈值 → 返回 content 列表
- [x] 3.7 实现降级逻辑：sqlite-vec 或 embedder 不可用时，所有方法静默返回空结果
- [x] 3.8 编写 memory-store 单元测试：测试记忆提取、嵌入存储、KNN 检索、用户隔离、降级逻辑

## 4. 集成与编排

- [x] 4.1 修改 `src/session-manager.ts`：注入 `ContextCompressor` 和 `MemoryStore`；修改 `getContext()` 为异步方法，增加压缩 + 记忆召回逻辑；增大 contextLength 到 50（给压缩器更多原始消息）
- [x] 4.2 修改 `src/router.ts`：将 `getContext()` 调用改为 `await getContext()`；确保摘要成本被记录到 api_calls
- [x] 4.3 修改 `src/index.ts`：初始化链中创建 Embedder、ContextCompressor、MemoryStore 实例并注入 SessionManager；在 executor 成功路径中异步触发 `memoryStore.extractMemory()`
- [x] 4.4 修改 `SessionManager.clearContext()`：同时清除 context_summaries 中对应 session 的摘要
- [x] 4.5 扩展 `cleanupOldData()`：新增清理 365 天以上的 memories 和 vec_memories 数据

## 5. 验证与收尾

- [x] 5.1 全量测试通过：`pnpm test` 所有新增 + 已有测试通过
- [x] 5.2 类型检查通过：`pnpm typecheck` 零错误
- [x] 5.3 构建通过：`pnpm build` 成功编译到 dist/
- [x] 5.4 更新 ROADMAP.md：标记上下文压缩和持久化记忆为 ✅ 完成
- [x] 5.5 更新 CHANGELOG.md：记录新增功能和变更
