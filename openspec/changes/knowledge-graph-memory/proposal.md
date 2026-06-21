## Why

VigilClaw 现有的持久化记忆（`src/memory-store.ts`）把对话提炼成**自由文本事实**，存入 `memories` 表并用 sqlite-vec 做语义召回。这套机制对「点状事实」召回很好，但有两个结构性短板：

1. **缺乏关系结构**——"用户在做 VigilClaw 项目"、"VigilClaw 用 SQLite"、"SQLite 零外部依赖" 三条事实彼此孤立。当用户问"我项目的数据库为什么这么选"时，纯向量召回只能命中字面相近的句子，无法沿着 `用户 → 项目 → 技术栈 → 理由` 的关系链把分散的事实串起来。
2. **实体易碎片化**——同一实体（如"皮皮虾"这个助手昵称）在不同事实里反复出现，向量库里是一堆近似重复的句子，既浪费存储又稀释召回信号，去重只能靠 0.85 相似度阈值的粗粒度判断。

知识图谱记忆层在现有向量记忆之上，增加**结构化的实体-关系三元组**存储（entity–relation–entity），支持沿关系链的图谱遍历召回，与向量召回形成**混合检索**：向量负责"模糊语义命中"，图谱负责"精确关系扩展"。

## What Changes

- 新增 DB 迁移 v4：`kg_entities`（实体）、`kg_relations`（三元组关系）两张表，以及可选的 `vec_kg_entities` 虚拟表（实体名向量，复用 sqlite-vec）
- 新增 `src/knowledge-graph-store.ts`：`KnowledgeGraphStore` 类，复用现有 `Embedder` 和 Haiku 提取模型
  - 从每轮对话提取结构化三元组并 upsert 实体/关系（实体去重、关系去重）
  - 图谱遍历召回：先定位查询相关的种子实体（实体名向量匹配 + 字面匹配），再沿关系做 1–2 跳扩展
- 扩展 `src/session-manager.ts`：`getContext()` 在注入 `[Relevant Memories]` 之外，追加注入 `[Knowledge Graph]` 关系事实
- 扩展 `src/index.ts`：对话结束后异步触发三元组提取（与现有 `extractMemory` 并列）
- 扩展 `src/config.ts`：新增 `knowledgeGraph.*` 配置段 + 环境变量
- 扩展 `src/db.ts`：迁移 v4 + 图谱 DAL 方法 + `vec_kg_entities` 创建（带降级）
- 复用现有 `cleanupOldData()` 夜间清理，扩展清理过期实体/关系

## Capabilities

### New Capabilities
- `knowledge-graph-memory`: 结构化实体-关系图谱记忆 — 三元组提取、实体去重、关系存储、图谱遍历召回、与向量记忆混合检索、用户/群组级隔离、优雅降级

### Modified Capabilities
- `persistent-memory`: 记忆召回从「纯向量」扩展为「向量 + 图谱混合」。`getContext()` 在 `[Relevant Memories]` 之后追加 `[Knowledge Graph]` 系统消息。原有向量召回行为不变。

## Impact

**新增文件：**
- `src/knowledge-graph-store.ts` — `KnowledgeGraphStore` 类（三元组提取 + 图谱召回）
- `tests/unit/knowledge-graph-store.test.ts` — 单元测试

**修改文件：**
- `src/db.ts` — 迁移 v4（`kg_entities` / `kg_relations`）+ 图谱 DAL + `vec_kg_entities` 虚拟表 + 清理扩展
- `src/session-manager.ts` — `setKnowledgeGraphStore()` + `getContext()` 注入图谱事实
- `src/index.ts` — 初始化 `KnowledgeGraphStore` + 对话后异步触发三元组提取
- `src/config.ts` — 新增 `knowledgeGraph` 配置段 + `VIGILCLAW_KG_*` 环境变量
- `.env.example` — 补充 `VIGILCLAW_KG_ENABLED` 等说明

**新增依赖：** 无（纯 SQLite 图存储 + 复用现有 `@huggingface/transformers` Embedder 与 Haiku 模型）

**受影响系统：** SQLite（新增 2 表 + 1 虚拟表）、记忆召回链路（session-manager）、对话后异步提取链路（index.ts）

**成本：** 每轮对话新增 1 次 Haiku 提取调用（约 $0.0001/次，与现有 `extractMemory` 同量级），记录到 `api_calls` 表，`/cost` 可见。可通过 `knowledgeGraph.enabled: false` 完全关闭。
