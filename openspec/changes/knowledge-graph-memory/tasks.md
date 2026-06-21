## 1. 数据库迁移与 DAL

- [ ] 1.1 在 `src/db.ts` `MIGRATIONS` 数组新增 v4：创建 `kg_entities`、`kg_relations` 表 + 全部索引（含 `idx_kg_entities_scope_name` 唯一索引、`idx_kg_relations_triple` 唯一索引、subject/object 外键索引）
- [ ] 1.2 在 `initRawDatabase()` 中，sqlite-vec 可用且 `user_version >= 4` 时创建 `vec_kg_entities` 虚拟表（`vec0`，`embedding float[384]`），失败降级（与 `vec_memories` 同模式）
- [ ] 1.3 在 `src/db.ts` 新增图谱 DAL 预编译语句/方法：
  - `upsertEntity({ scopeKey, name, type })` → 返回实体 id（规范化名精确匹配复用，`mentions` 自增）
  - `insertEntityVector(rowid, embedding)` / `searchEntityVectors(embedding, k)`（sqlite-vec 可用时）
  - `insertRelation({ scopeKey, subjectId, predicate, objectId, confidence, sourceUserId })`（`INSERT OR IGNORE` 走三元组唯一约束）
  - `getEntitiesByNames(scopeKey, names[])`（字面匹配种子定位）
  - `traverseRelations(scopeKey, seedEntityIds[], maxHops, limit)` → 返回 `{ subject, predicate, object, confidence, created_at }[]`（JOIN 实体表，双向扩展）
- [ ] 1.4 扩展 `cleanupOldData()`：删除超 `retentionDays` 的 `kg_relations`，再删除清理后无任何关系的孤立 `kg_entities`（及其 `vec_kg_entities` 向量）
- [ ] 1.5 验证：`pnpm typecheck` 通过

## 2. KnowledgeGraphStore 核心

- [ ] 2.1 创建 `src/knowledge-graph-store.ts`：`KnowledgeGraphStore` 类，构造函数接收 `db`、`embedder`、`provider`、配置；持 `operational` 标志（`enabled && embedder` 决定提取/召回总开关，sqlite-vec 决定实体向量软匹配子能力）
- [ ] 2.2 实现 `extractTriples(userId, groupId, userMessage, assistantMessage)`：组装 prompt → Haiku 调用（`taskId: kg-extract:<scope>`）→ 解析 JSON 三元组数组（解析失败按空降级）→ 逐条 upsert 实体（含向量）+ insert 关系；记录成本到 `api_calls`
- [ ] 2.3 实现实体提取 prompt 常量（`KG_EXTRACTION_SYSTEM`）：明确输出 JSON 契约 `[{subject,predicate,object}]`、谓词用 snake_case 英文、实体名保留用户语言、无内容返回 `[]`、附 1–2 个 few-shot 示例
- [ ] 2.4 实现 `recall(userId, groupId, queryText)`：种子定位（实体名向量近邻 ≥ `entitySimilarityThreshold` + 查询对实体名字面匹配，合并去重）→ `traverseRelations` 有界遍历（`maxHops` / `maxFacts`）→ 返回 `subject predicate object` 文本数组；全程 try/catch 降级返回 `[]`
- [ ] 2.5 实现 `formatGraphMessage(facts)` → `'[Knowledge Graph]\n' + facts.map(f => '- ' + f).join('\n')`
- [ ] 2.6 实体去重逻辑：规范化名（trim + casefold 比较，保留原始展示名）精确匹配优先；sqlite-vec 可用时对新实体名向量做近邻（≥0.9）软合并
- [ ] 2.7 验证：`pnpm typecheck` 通过

## 3. 配置

- [ ] 3.1 在 `src/config.ts` 新增 `KnowledgeGraphConfigSchema`（`enabled` 默认 true、`maxHops` 默认 1、`maxFacts` 默认 10、`entitySimilarityThreshold` 默认 0.5、`retentionDays` 默认 365），挂到主配置 `knowledgeGraph` 段
- [ ] 3.2 映射环境变量 `VIGILCLAW_KG_ENABLED` / `VIGILCLAW_KG_MAX_HOPS` / `VIGILCLAW_KG_MAX_FACTS`
- [ ] 3.3 在 `.env.example` 补充 `VIGILCLAW_KG_ENABLED` 等说明
- [ ] 3.4 验证：`pnpm typecheck` 通过

## 4. 集成到会话与编排链路

- [ ] 4.1 在 `src/session-manager.ts` 新增 `private kgStore` 字段 + `setKnowledgeGraphStore()`；在 `getContext()` 向量记忆注入之后追加图谱召回与 `[Knowledge Graph]` 系统消息注入（空召回不注入；插入位置在 `[Relevant Memories]` 之后）
- [ ] 4.2 在 `src/index.ts` 初始化 `KnowledgeGraphStore`（复用已建的 `embedder` 与 `summaryProvider`），`config.knowledgeGraph.enabled` 时 `sessionManager.setKnowledgeGraphStore(...)`
- [ ] 4.3 在 `src/index.ts` 对话回复后（与 `extractMemory` 并列）`void kgStore.extractTriples(...)` 异步触发
- [ ] 4.4 验证：`pnpm typecheck` + `pnpm build` 通过

## 5. 测试

- [ ] 5.1 `tests/unit/knowledge-graph-store.test.ts`：三元组提取（mock provider 返回 JSON）、实体去重（规范化匹配）、三元组去重、图谱遍历召回（1 跳/2 跳）、`maxFacts` 上界、scope 隔离、`[Knowledge Graph]` 消息格式
- [ ] 5.2 降级用例：JSON 解析失败按空处理不抛错；sqlite-vec 不可用时字面匹配仍可遍历；`enabled: false` 完全跳过
- [ ] 5.3 `tests/unit/db.test.ts` 扩展：迁移 v4 建表、`upsertEntity` 去重 + `mentions` 自增、`insertRelation` 三元组唯一、`traverseRelations` 双向、清理孤立实体
- [ ] 5.4 全量检查：`pnpm check`（lint + typecheck + test）通过

## 6. 文档同步

- [ ] 6.1 更新 `docs/planning/ROADMAP.md`：P3「知识图谱记忆」状态 ⏳ → ✅，更新顶部状态行与「最后更新」日期
- [ ] 6.2 更新 `docs/planning/CHANGELOG.md`：记录 Knowledge Graph Memory 变更（新增文件/修改文件/迁移 v4/配置/测试数）
- [ ] 6.3 同步主 specs：将本 change 的 `knowledge-graph-memory` 能力与 `persistent-memory` 的 MODIFIED 合并到 `openspec/specs/`（归档时执行）
