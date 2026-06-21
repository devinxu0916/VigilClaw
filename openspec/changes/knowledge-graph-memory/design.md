## Context

VigilClaw 的持久化记忆已落地（Phase 2 P1），当前实现要点：

- `memories` 表（迁移 v2）：自由文本事实 + `scope_key`（用户/群组隔离）+ `metadata`
- `vec_memories` 虚拟表（sqlite-vec `vec0`，`embedding float[384]`）：事实向量
- `src/embedder.ts`：`@huggingface/transformers` + `Xenova/all-MiniLM-L6-v2`，本地嵌入，零 API 成本
- `src/memory-store.ts`：Haiku 提取自由文本事实 → 嵌入 → 去重（相似度 ≥ 0.85）→ 入库；召回时按 `1 - distance²/2` 算余弦相似度，阈值 0.3，取 top `maxRecallCount`
- `src/session-manager.ts` `getContext()`：异步召回 → 注入 `system` 角色消息 `[Relevant Memories]`
- `src/index.ts`：对话回复后 `void memoryStore.extractMemory(...)` 异步触发
- 迁移系统：`MIGRATIONS` 数组（当前到 v3 skills），`user_version` pragma 驱动，事务包裹
- 约束：9 个生产依赖（上限 50），SQLite 单文件，TypeScript strict（禁 `any`、显式返回类型），优雅降级是既有惯例（sqlite-vec / embedder 不可用时静默禁用）

知识图谱层要在不破坏上述任何行为的前提下，**并列**增加一套结构化关系记忆。

## Goals / Non-Goals

**Goals:**
- 从对话提取结构化三元组 `(subject, predicate, object)`，实体跨对话去重合并
- 图谱遍历召回：定位种子实体 → 沿关系 1–2 跳扩展 → 召回关系链上的事实
- 与现有向量记忆**混合检索**：两者并列注入，互补而非替换
- 用户/群组级隔离（复用 `scope_key`）
- 零新增生产依赖；纯 SQLite 实现图存储
- 优雅降级：图谱不可用时不影响 chat 和现有向量记忆
- 成本可控：复用 Haiku，提取调用记入 `api_calls`

**Non-Goals:**
- 图数据库引擎（Neo4j / 不引入）——用 SQLite 自连接表达图
- 多跳推理 / 路径排序算法（PageRank、最短路径）——Phase B 再议，本期最多 2 跳广度扩展
- 实体消歧的 LLM 二次校验——本期用「规范化名称 + 向量近邻」做轻量去重
- 跨 `scope_key` 的全局知识共享——严格隔离
- 把现有 `memories` 表迁移/重构进图谱——两套并存，互不影响
- 图谱可视化（Dashboard 展示放到后续）

## Decisions

### D1: 存储模型 — SQLite 两表自连接（实体表 + 关系表）

**选择：`kg_entities`（实体）+ `kg_relations`（三元组）两张普通表，关系表外键自连接实体表表达有向图。**

| 方案 | 新增依赖 | 隔离/事务 | 复杂度 |
|------|---------|----------|--------|
| SQLite 两表自连接 | 0 | 复用同库事务、`scope_key` 隔离 | 低 |
| 单表存三元组字符串 | 0 | 实体无法去重/合并 | 低但召回弱 |
| 嵌入式图库（如 graphology，内存） | +1 | 需持久化序列化、进程重启重建 | 中 |
| 外部图数据库（Neo4j） | 重 | 违背"零外部数据库依赖" | 高 |

**理由**：项目的核心约束是「SQLite 单文件 + 零外部数据库依赖 + 依赖精简」。两表自连接能表达任意有向图，1–2 跳遍历用 `JOIN` 即可，事务和 `scope_key` 隔离与现有表一致。实体独立成表是关键——它让同一实体的多条关系自然聚合，并支持实体级去重与向量索引。

**Schema（迁移 v4）：**

```sql
CREATE TABLE kg_entities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key   TEXT NOT NULL,
  name        TEXT NOT NULL,          -- 规范化实体名，如 "用户" / "VigilClaw" / "TypeScript"
  type        TEXT,                   -- 可选类型：person/project/tech/preference/other
  mentions    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_kg_entities_scope_name ON kg_entities(scope_key, name);

CREATE TABLE kg_relations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key   TEXT NOT NULL,
  subject_id  INTEGER NOT NULL,
  predicate   TEXT NOT NULL,          -- 关系谓词，如 "prefers" / "uses" / "works_on"
  object_id   INTEGER NOT NULL,
  confidence  REAL NOT NULL DEFAULT 1.0,
  source_user_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subject_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (object_id)  REFERENCES kg_entities(id) ON DELETE CASCADE
);
CREATE INDEX idx_kg_relations_scope   ON kg_relations(scope_key, created_at DESC);
CREATE INDEX idx_kg_relations_subject ON kg_relations(subject_id);
CREATE INDEX idx_kg_relations_object  ON kg_relations(object_id);
CREATE UNIQUE INDEX idx_kg_relations_triple ON kg_relations(scope_key, subject_id, predicate, object_id);
```

`ON DELETE CASCADE` + 既有 `foreign_keys = ON` pragma 保证删实体时关系自动清理。`UNIQUE(scope_key, subject_id, predicate, object_id)` 保证三元组去重（重复提取走 `INSERT OR IGNORE`）。

### D2: 实体去重 — 规范化名称精确匹配 + 向量近邻软匹配

**选择：先按 `(scope_key, name)` 规范化精确匹配；可选用 `vec_kg_entities` 实体名向量做近邻合并（同 `memories` 复用 sqlite-vec）。**

| 方案 | 效果 | 成本 |
|------|------|------|
| 规范化名精确匹配 | 解决大小写/空白差异 | 0 |
| + 实体名向量近邻（≥0.9） | 合并"TS"/"TypeScript"等近义实体 | 复用本地嵌入，0 API |
| LLM 二次消歧 | 最准 | 每实体一次 LLM 调用，成本高 |

**理由**：规范化（trim + 小写化比较，保留原始展示名）零成本解决绝大多数重复。向量近邻作为**可选增强**，复用已有 `Embedder` 和 sqlite-vec，零新依赖、零 API 成本；当 sqlite-vec 不可用时自动退化为纯精确匹配。LLM 消歧成本不划算，排除。

`vec_kg_entities`（虚拟表，`embedding float[384]`）只索引实体名，规模远小于事实级向量，存储开销可忽略。

### D3: 三元组提取 — 独立 Haiku 调用，输出 JSON

**选择：新增独立的 Haiku 提取调用，要求模型输出 JSON 三元组数组；与现有 `extractMemory` 并列、独立降级。**

| 方案 | 耦合 | 成本 | 鲁棒性 |
|------|------|------|--------|
| 独立提取调用（本方案） | 低，可独立开关 | +1 次 Haiku/轮 | 高，互不影响 |
| 复用 extractMemory 单次调用同时出事实+三元组 | 高，两套逻辑纠缠 | 省 1 次调用 | 一处 prompt 故障两边受损 |

**理由**：独立调用让图谱可通过 `knowledgeGraph.enabled` 单独关闭，与向量记忆解耦，符合既有「优雅降级」惯例。每轮多一次 Haiku 调用约 $0.0001，可接受，且记入 `api_calls`（`taskId: kg-extract:<scope>`）。合并调用省的钱微不足道却显著增加耦合与故障面，排除。复用调用作为「Open Question」记录，留待成本敏感场景优化。

**提取 prompt 输出契约**：模型返回 JSON 数组，每项 `{ "subject": string, "predicate": string, "object": string }`；无可提取内容返回 `[]`。解析失败/非数组时按空处理（降级），不抛错。谓词用 snake_case 英文动词短语（跨语言稳定），主/宾实体名保持用户语言。

### D4: 召回算法 — 种子实体定位 + 有界图遍历

**选择：两段式召回。**

1. **种子定位**：对查询文本嵌入，在 `vec_kg_entities` 找 top-K 近邻实体（相似度 ≥ `entitySimilarityThreshold`，默认 0.5）；并辅以查询对实体名的子串/分词字面匹配，合并去重得到种子实体集。sqlite-vec 不可用时只走字面匹配。
2. **有界遍历**：从种子实体出发，沿 `kg_relations` 做 `maxHops`（默认 1）跳的双向扩展（subject→object 与 object→subject），收集关系；按 `confidence` 与 `created_at` 排序，取前 `maxFacts`（默认 10）条，渲染成 `主语 谓词 宾语` 文本。

**理由**：种子定位用向量解决"查询↔实体"模糊匹配，遍历用 SQL JOIN 解决"关系扩展"——正是图谱相对纯向量的增量价值。`maxHops`/`maxFacts` 上界防止图谱膨胀后召回爆炸、控制注入 token。1 跳默认值在个人助手场景足够（用户—偏好/项目—技术栈这类星型关系），需要更深可调到 2。

### D5: 注入策略 — 与向量记忆并列注入，独立段落

**选择：`getContext()` 在 `[Relevant Memories]` 系统消息之后，追加独立的 `[Knowledge Graph]` 系统消息。**

**理由**：两套记忆语义不同——向量是"自由事实"，图谱是"结构关系"，分段注入让 LLM 能区分来源，也便于各自调试与开关。复用现有 system 消息注入位置（在压缩摘要之后、对话消息之前），下游 provider 层已有「合并所有 system 消息到 `system` 参数」的逻辑，无需改 provider。空召回时不注入该段。

**注入顺序**：`[summary?] → [Relevant Memories?] → [Knowledge Graph?] → ...recent_messages`。

### D6: 配置与降级 — 复用 MemoryStore 的 operational 模式

**选择：`KnowledgeGraphStore` 持 `operational` 标志 = `config.enabled && db.vecAvailable-or-fallback && embedder`，与 `MemoryStore` 同构。**

图谱的关系存储本身**不依赖** sqlite-vec（纯表），只有「实体名向量软匹配」依赖 vec。因此分两级降级：

- sqlite-vec 不可用：关闭 `vec_kg_entities`，种子定位退化为纯字面匹配，关系存储/遍历照常工作
- `knowledgeGraph.enabled: false`：完全跳过提取与召回

新增配置段 `knowledgeGraph`：

```
enabled                   boolean  默认 true
maxHops                   number   默认 1
maxFacts                  number   默认 10
entitySimilarityThreshold number  默认 0.5
retentionDays             number   默认 365
```

环境变量：`VIGILCLAW_KG_ENABLED`、`VIGILCLAW_KG_MAX_HOPS`、`VIGILCLAW_KG_MAX_FACTS`。

## Risks / Trade-offs

- **[每轮多一次 Haiku 调用增加成本/延迟]** → 缓解：提取异步触发（`void`，不阻塞 `replyFn`），与 `extractMemory` 同模式；成本记入 `api_calls`，`/cost` 可见；可一键关闭。
- **[LLM 输出 JSON 不稳定]** → 缓解：解析失败按空数组降级，绝不抛错中断主流程；prompt 明确输出契约 + few-shot 示例；谓词约束为 snake_case 英文降低歧义。
- **[实体碎片化（同义实体未合并）导致图谱稀疏]** → 缓解：规范化精确匹配 + 向量近邻软合并（≥0.9）；`mentions` 计数可用于后续清理低频孤立实体。
- **[图谱无限增长]** → 缓解：复用夜间 `cleanupOldData()` 清理超 `retentionDays` 的关系，并删除清理后无任何关系的孤立实体；遍历有 `maxHops`/`maxFacts` 上界。
- **[与向量记忆召回内容重复]** → 缓解：两段独立标题（`[Relevant Memories]` vs `[Knowledge Graph]`），即使语义重叠，结构化表述对 LLM 仍有增量；token 上界由 `maxFacts` 控制。
- **[代码量增加]** → 预估新增约 400–600 行（store + DAL + 测试）。当前约 8,000 行，仍在可审计范围。图谱是独立模块，不增加核心链路复杂度。

## Migration Plan

**对现有用户的影响：**
- 启动时自动执行迁移 v4，创建 `kg_entities` / `kg_relations`（+ `vec_kg_entities` 若 sqlite-vec 可用），不触碰任何现有表与数据
- `knowledgeGraph.enabled` 默认 `true`，新对话开始积累图谱；历史对话不回填（无副作用）
- 向量记忆行为完全不变；图谱召回为"附加"系统消息，无图谱数据时不注入

**回滚：**
- 设 `VIGILCLAW_KG_ENABLED=false` 即停用提取与召回，退回纯向量记忆
- 迁移 v4 仅新增表，不改既有结构；即使停用，已建表惰性闲置，无副作用

## Open Questions

1. 是否将三元组提取与现有 `extractMemory` 合并为单次 Haiku 调用以省成本？ — 本期保持独立（解耦优先）；若后续 token 成本敏感，可在 prompt 层合并输出 `{facts, triples}`，作为优化项。
2. 是否在 Web Dashboard 增加图谱浏览/可视化？ — 不在本 change scope，后续单独提案。
3. 默认 `maxHops` 是否需要按 scope 规模自适应？ — 本期固定 1，可配置；自适应留待有真实数据后评估。
