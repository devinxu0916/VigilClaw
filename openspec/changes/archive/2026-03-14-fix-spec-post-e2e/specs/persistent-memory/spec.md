## MODIFIED Requirements

### Requirement: Local embedding generation (UPDATED)

The system SHALL generate text embeddings locally using `@huggingface/transformers` with the `Xenova/all-MiniLM-L6-v2` model (384 dimensions), without any external API calls.

> Changed: `@xenova/transformers` → `@huggingface/transformers`（迁移原因：xenova 间接依赖 sharp native addon，在 macOS ARM64 上缺少 prebuild，导致加载失败）

### Requirement: Semantic memory recall (UPDATED)

The system SHALL recall relevant memories by computing cosine similarity between the user's latest message embedding and stored memory embeddings, returning memories above a similarity threshold.

The cosine similarity SHALL be computed from the L2 (Euclidean) distance returned by sqlite-vec using the formula: `similarity = 1 - (distance² / 2)`, where distance is the L2 distance between normalized embedding vectors.

> Added: 明确 similarity 计算公式（sqlite-vec 返回 L2 距离，非余弦距离）

#### Scenario: Relevant memories found (UPDATED)

- **WHEN** user asks "How should I set up my TypeScript project?" and a stored memory says "User prefers strict TypeScript with Vitest"
- **THEN** the system SHALL return that memory if similarity exceeds the threshold (default 0.3)

> Changed: default threshold 0.7 → 0.3（all-MiniLM-L6-v2 对中英文混合内容的语义匹配精度有限，0.7 过高导致所有记忆被拦截）

### Requirement: Memory injection into context (UPDATED)

Recalled memories SHALL be formatted as a system-role message in the context array returned by `getContext()`. The provider layer SHALL then extract all system-role messages from the context and merge them into the LLM's `system` parameter (not pass them as message objects in the messages array).

> Added: 明确 system 消息的处理方式 — getContext() 返回 system role 消息，provider 层负责提取合并到 system prompt 参数

### Requirement: Memory configuration (UPDATED)

The system SHALL support the following configuration fields under a new `memory` config section:

- `enabled` (boolean, default true): enable/disable persistent memory
- `similarityThreshold` (number, default 0.3): minimum similarity for recall
- `maxRecallCount` (number, default 5): maximum memories to inject
- `embeddingModel` (string, default 'Xenova/all-MiniLM-L6-v2'): local embedding model

> Changed: similarityThreshold default 0.7 → 0.3
