## Purpose

在自由文本向量记忆之上，增加结构化的实体-关系图谱记忆：从对话提取 `(subject, predicate, object)` 三元组，去重存入 SQLite 实体/关系表，召回时定位查询相关的种子实体并沿关系链做有界遍历，与向量记忆混合注入上下文。用户/群组级隔离，零新增生产依赖，优雅降级。

## Requirements

### Requirement: Triple extraction from conversations

After each successful assistant response, the system SHALL asynchronously extract structured `(subject, predicate, object)` triples from the latest user+assistant message pair using the Haiku LLM model, when `knowledgeGraph.enabled` is true.

#### Scenario: Extracting a relation triple

- **WHEN** the user says "我在做 VigilClaw 这个项目，它用 SQLite 存数据" and the assistant acknowledges
- **THEN** the system SHALL extract triples such as `(用户, works_on, VigilClaw)` and `(VigilClaw, uses, SQLite)`

#### Scenario: No extractable relations

- **WHEN** the user says "你好" and the assistant says "你好，有什么可以帮你？"
- **THEN** the system SHALL extract an empty triple set and store nothing

#### Scenario: Extraction is asynchronous

- **WHEN** triple extraction is triggered after a response
- **THEN** the extraction SHALL NOT block the reply to the user; it SHALL run after `replyFn()` completes

#### Scenario: Malformed LLM output is tolerated

- **WHEN** the Haiku model returns output that is not a valid JSON array of triples
- **THEN** the system SHALL treat it as an empty result, log a warning, and SHALL NOT throw or interrupt the main flow

### Requirement: Triple extraction cost tracking

Each triple-extraction LLM call SHALL be recorded in the `api_calls` table with the Haiku model, counted toward the user's cost, using a task id of the form `kg-extract:<scopeKey>`.

#### Scenario: Extraction cost recorded

- **WHEN** a triple-extraction call consumes 400 input tokens and 120 output tokens
- **THEN** an `api_calls` record SHALL be inserted with the correct token counts, computed cost, and task id `kg-extract:<scopeKey>`

### Requirement: Entity and relation storage in SQLite

The system SHALL store entities in a `kg_entities` table and relations in a `kg_relations` table within the existing SQLite database, created by migration v4. Relations SHALL reference entities by foreign key with `ON DELETE CASCADE`.

#### Scenario: Database migration v4

- **WHEN** the application starts with an existing v3 database
- **THEN** migration v4 SHALL create the `kg_entities` and `kg_relations` tables (and indexes) without affecting existing data, and set `user_version` to 4

#### Scenario: Triple persisted as entities plus relation

- **WHEN** the triple `(用户, uses, pnpm)` is extracted for scope `tg:123`
- **THEN** the system SHALL upsert a `用户` entity and a `pnpm` entity under scope `tg:123`, and insert one `kg_relations` row linking them with predicate `uses`

#### Scenario: vec_kg_entities created when sqlite-vec available

- **WHEN** the application starts, sqlite-vec is loaded, and `user_version` is at least 4
- **THEN** the system SHALL create the `vec_kg_entities` virtual table (`vec0`, `embedding float[384]`) for entity-name vectors

### Requirement: Entity deduplication

When upserting an entity, the system SHALL deduplicate by normalized name within the same `scope_key` (case- and whitespace-insensitive comparison, preserving the original display name on first insert). When sqlite-vec is available, the system MAY additionally merge an entity into an existing one whose name embedding has cosine similarity >= 0.9 within the same scope.

#### Scenario: Exact normalized match reuses entity

- **WHEN** an entity `TypeScript` already exists for scope `tg:123` and a new triple references `typescript ` (different case and trailing space) in the same scope
- **THEN** the system SHALL reuse the existing entity rather than creating a duplicate, and SHALL increment its `mentions` count

#### Scenario: Distinct entities not merged

- **WHEN** entities `pnpm` and `npm` exist in the same scope and their name embeddings are below the 0.9 merge threshold
- **THEN** the system SHALL keep them as separate entities

### Requirement: Triple deduplication

The system SHALL NOT store duplicate relations: a `(scope_key, subject_id, predicate, object_id)` tuple SHALL be unique. Re-extracting an identical triple SHALL be a no-op (or update only mention/confidence metadata).

#### Scenario: Re-extracting the same triple

- **WHEN** the triple `(用户, prefers, TypeScript)` already exists in scope `tg:123` and is extracted again
- **THEN** the system SHALL NOT create a second `kg_relations` row for the same tuple

### Requirement: Graph traversal recall

Given a query text, the system SHALL (1) locate seed entities relevant to the query via entity-name vector nearest-neighbor (similarity >= `entitySimilarityThreshold`, default 0.5) combined with literal name matching, then (2) traverse `kg_relations` outward from those seeds up to `maxHops` hops (default 1), in both relation directions, returning up to `maxFacts` relations (default 10) ordered by confidence then recency, rendered as `subject predicate object` facts.

#### Scenario: Relation chain recalled

- **WHEN** the graph holds `(用户, works_on, VigilClaw)` and `(VigilClaw, uses, SQLite)` and the user asks "我项目用的什么数据库？"
- **THEN** the system SHALL locate `VigilClaw` (and/or `用户`) as a seed entity and recall the `VigilClaw uses SQLite` relation

#### Scenario: No relevant entities

- **WHEN** the user asks about a topic with no matching entities in their scope
- **THEN** the system SHALL return an empty fact list

#### Scenario: Fact limit enforced

- **WHEN** traversal from the seed entities yields 30 relations
- **THEN** the system SHALL return only the top `maxFacts` (default 10), ordered by confidence then recency

#### Scenario: Literal fallback when sqlite-vec unavailable

- **WHEN** sqlite-vec is not available and the query text contains an entity name present in the graph
- **THEN** the system SHALL still locate that entity via literal matching and traverse its relations

### Requirement: Graph memory injection into context

Recalled graph facts SHALL be injected as a `system`-role message in the context array returned by `getContext()`, placed after any `[Relevant Memories]` message and before the conversation messages, with content prefixed by `[Knowledge Graph]\n`. When no graph facts are recalled, no such message SHALL be added.

#### Scenario: Graph facts injected alongside vector memories

- **WHEN** both vector memories and graph facts are recalled
- **THEN** `getContext()` SHALL return `[...optional summary, relevant_memories_msg, knowledge_graph_msg, ...recent_messages]`

#### Scenario: Graph message format

- **WHEN** 2 graph facts are recalled
- **THEN** the graph system message SHALL have role `system` and content prefixed with `[Knowledge Graph]\n` followed by each fact as a `- subject predicate object` bullet

#### Scenario: No graph facts

- **WHEN** graph recall returns no facts
- **THEN** `getContext()` SHALL NOT add a `[Knowledge Graph]` message

### Requirement: Per-scope graph isolation

Entities and relations SHALL be isolated by `scope_key` — one scope's graph SHALL NOT be traversed or recalled for another scope. Group conversations SHALL use the group id as the scope; direct conversations SHALL use the user id.

#### Scenario: Scope isolation on recall

- **WHEN** scope A holds relations and a query is made under scope B
- **THEN** scope A's entities and relations SHALL NOT appear in scope B's recall results

#### Scenario: Group scope

- **WHEN** a triple is extracted from a group conversation
- **THEN** the entities and relation SHALL be scoped to that group's id and recalled for queries within that group

### Requirement: Knowledge graph configuration

The system SHALL support a `knowledgeGraph` config section with: `enabled` (boolean, default true), `maxHops` (number, default 1), `maxFacts` (number, default 10), `entitySimilarityThreshold` (number, default 0.5), and `retentionDays` (number, default 365), overridable via `VIGILCLAW_KG_ENABLED`, `VIGILCLAW_KG_MAX_HOPS`, and `VIGILCLAW_KG_MAX_FACTS` environment variables.

#### Scenario: Knowledge graph disabled

- **WHEN** config specifies `knowledgeGraph.enabled: false`
- **THEN** the system SHALL skip triple extraction and graph recall entirely, and chat plus vector memory SHALL continue normally

#### Scenario: Custom hop depth

- **WHEN** config specifies `knowledgeGraph.maxHops: 2`
- **THEN** graph recall SHALL traverse up to 2 hops from seed entities

### Requirement: Graceful degradation

If sqlite-vec or the embedding model is unavailable, the system SHALL still perform relation storage and literal-match traversal, disabling only the entity-name vector matching, and SHALL log a warning. Failures during extraction or recall SHALL be caught and SHALL NOT affect core chat or vector memory.

#### Scenario: sqlite-vec unavailable

- **WHEN** the sqlite-vec extension cannot be loaded
- **THEN** the system SHALL skip `vec_kg_entities` and entity-vector seeding, continue with literal-match traversal, and chat SHALL proceed normally

#### Scenario: Recall failure isolated

- **WHEN** an error is thrown during graph recall
- **THEN** the error SHALL be caught and logged, `getContext()` SHALL return without a graph message, and the reply SHALL proceed

### Requirement: Knowledge graph cleanup

Relations older than `retentionDays` (default 365) SHALL be deleted during the existing nightly cleanup cycle, and entities left with no relations after cleanup SHALL be removed (along with their vectors).

#### Scenario: Old relations purged

- **WHEN** the nightly cleanup runs and a relation is 400 days old
- **THEN** that relation SHALL be deleted from `kg_relations`

#### Scenario: Orphaned entities removed

- **WHEN** after relation cleanup an entity has no remaining relations
- **THEN** that entity SHALL be deleted from `kg_entities` and its vector (if any) from `vec_kg_entities`
