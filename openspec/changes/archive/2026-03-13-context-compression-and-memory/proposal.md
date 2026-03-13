## Why

当前 SessionManager 使用固定 20 条消息作为上下文窗口，存在两个核心问题：

1. **上下文溢出** — 长对话中早期关键信息被截断丢失，Claude 的上下文窗口未被充分利用（20 条消息可能远低于模型容量），同时超长消息可能导致 token 超限
2. **跨会话遗忘** — 每次 `/clear` 或会话超时后，所有对话历史彻底丢失，用户需要反复重复偏好和背景信息

这两个功能是 Phase 2 ROADMAP 中的 P1 必做项，且互相协同：压缩器管理当前对话的上下文窗口，记忆系统提供跨会话的长期知识检索。

## What Changes

- 新增 **上下文压缩器** (`src/context-compressor.ts`)：当对话 token 数超过阈值时，自动将旧消息增量摘要为一条 system 消息，保留最近消息完整性
- 新增 **持久化记忆存储** (`src/memory-store.ts`)：基于 sqlite-vec 的向量搜索，每次对话结束提取关键信息存入嵌入向量库，新对话开始时语义检索相关记忆注入上下文
- 新增 **本地嵌入生成** 能力：使用 @xenova/transformers + all-MiniLM-L6-v2 在本地生成文本嵌入向量，零 API 成本
- 修改 `SessionManager` — 集成压缩器和记忆检索，扩展 `getContext()` 返回压缩 + 记忆增强的上下文
- 新增 DB 迁移 v2 — `context_summaries` 表（存储会话摘要）、`memories` 表 + `vec_memories` 虚拟表（存储记忆嵌入）
- 扩展配置系统 — 新增压缩和记忆相关配置项
- 新增 2 个生产依赖：`sqlite-vec`、`@xenova/transformers`

## Capabilities

### New Capabilities

- `context-compression`: 基于 token 预算的智能上下文压缩，使用增量摘要策略，在对话 token 超过阈值时自动触发，用 Haiku 模型生成摘要
- `persistent-memory`: 基于向量相似度的跨会话持久化记忆系统，包含记忆提取、嵌入存储、语义检索、上下文注入全链路

### Modified Capabilities

<!-- 无已有 spec，首次建立 -->

## Impact

- **新增依赖**: `sqlite-vec` (SQLite 向量搜索扩展)、`@xenova/transformers` (本地嵌入模型)
- **数据库**: 新增迁移 v2，3 张新表（`context_summaries`、`memories`、`vec_memories`）
- **修改文件**: `src/session-manager.ts`（核心集成点）、`src/config.ts`（配置扩展）、`src/db.ts`（迁移 + DAL）、`src/index.ts`（初始化链）、`src/router.ts`（摘要成本记录）
- **API 成本**: 压缩摘要使用 Haiku 模型，每次触发约 $0.001-0.005
- **磁盘**: 嵌入模型文件约 80-100MB（首次下载后缓存）
- **启动时间**: 嵌入模型首次加载约 5-10s，后续毫秒级
