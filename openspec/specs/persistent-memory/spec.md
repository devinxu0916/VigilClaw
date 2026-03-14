## ADDED Requirements

### Requirement: Local embedding generation

The system SHALL generate text embeddings locally using `@huggingface/transformers` with the `Xenova/all-MiniLM-L6-v2` model (384 dimensions), without any external API calls.

#### Scenario: Generate embedding for a text

- **WHEN** the system needs to embed the text "User prefers TypeScript"
- **THEN** the system SHALL produce a Float32Array of length 384 using the local model

#### Scenario: Embedding model lazy initialization

- **WHEN** the embedding model has not been loaded yet and an embedding is requested
- **THEN** the system SHALL load the model on first use and cache it for subsequent calls

### Requirement: Memory extraction from conversations

After each successful assistant response, the system SHALL asynchronously extract memorable facts from the latest user+assistant message pair using the Haiku LLM model.

#### Scenario: Extracting a user preference

- **WHEN** the user says "I always use pnpm for my projects" and the assistant acknowledges
- **THEN** the system SHALL extract "User always uses pnpm for projects" as a memory item

#### Scenario: No memorable content

- **WHEN** the user says "Hello" and the assistant says "Hi! How can I help?"
- **THEN** the system SHALL determine there is nothing worth memorizing and skip storage

#### Scenario: Extraction is asynchronous

- **WHEN** memory extraction is triggered after a response
- **THEN** the extraction SHALL NOT block the reply to the user; it SHALL run after `replyFn()` completes

### Requirement: Memory extraction cost tracking

Each memory extraction LLM call SHALL be recorded in the `api_calls` table with the Haiku model, counted toward the user's cost.

#### Scenario: Extraction cost recorded

- **WHEN** a memory extraction call consumes 300 input tokens and 100 output tokens
- **THEN** an `api_calls` record SHALL be inserted with the correct token counts and cost

### Requirement: Vector storage in SQLite

The system SHALL store memory embeddings in a `vec_memories` virtual table (sqlite-vec `vec0`) and metadata in a `memories` table, both within the existing SQLite database.

#### Scenario: Memory stored with embedding

- **WHEN** a memory "User prefers TypeScript" is extracted
- **THEN** the system SHALL insert a row in `memories` (with content, userId, metadata) and a corresponding vector in `vec_memories`

#### Scenario: Database migration

- **WHEN** the application starts with an existing v1 database
- **THEN** migration v2 SHALL create the `memories` table, `context_summaries` table, and `vec_memories` virtual table without affecting existing data

### Requirement: Semantic memory recall

The system SHALL recall relevant memories by computing cosine similarity between the user's latest message embedding and stored memory embeddings, returning memories above a similarity threshold. The cosine similarity SHALL be computed from the L2 (Euclidean) distance returned by sqlite-vec using the formula: `similarity = 1 - (distance² / 2)`, where distance is the L2 distance between normalized embedding vectors.

#### Scenario: Relevant memories found

- **WHEN** user asks "How should I set up my TypeScript project?" and a stored memory says "User prefers strict TypeScript with Vitest"
- **THEN** the system SHALL return that memory if similarity exceeds the threshold (default 0.3)

#### Scenario: No relevant memories

- **WHEN** user asks about cooking recipes and all stored memories are about programming
- **THEN** the system SHALL return an empty list (no memories above threshold)

#### Scenario: Result limit

- **WHEN** 20 memories exceed the similarity threshold
- **THEN** the system SHALL return only the top `maxRecallCount` (default 5) memories, ordered by similarity descending

### Requirement: Memory injection into context

Recalled memories SHALL be injected as a system-role message in the context array returned by `getContext()`, after any compression summary and before the conversation messages. The provider layer SHALL then extract all system-role messages and merge them into the LLM's `system` parameter (not pass them as message objects in the messages array, as Claude API does not support system role in the messages array).

#### Scenario: Memories injected with summary

- **WHEN** both a compression summary and relevant memories exist
- **THEN** `getContext()` SHALL return: `[summary_system_msg, memories_system_msg, ...recent_messages]`

#### Scenario: Memories injected without summary

- **WHEN** relevant memories exist but no compression summary
- **THEN** `getContext()` SHALL return: `[memories_system_msg, ...recent_messages]`

#### Scenario: Memory message format

- **WHEN** 3 memories are recalled
- **THEN** the memory system message SHALL have role `system` and content prefixed with `[Relevant Memories]\n` followed by each memory as a bullet point

### Requirement: Per-user memory isolation

Each user's memories SHALL be isolated — a user's memories SHALL NOT appear in another user's recall results. Group conversations SHALL use the group ID as the memory scope.

#### Scenario: User isolation

- **WHEN** user A has stored a memory and user B makes a query
- **THEN** user A's memories SHALL NOT appear in user B's recall results

#### Scenario: Group memory scope

- **WHEN** a memory is extracted from a group conversation
- **THEN** the memory SHALL be scoped to that group and recalled for all users in that group

### Requirement: Memory configuration

The system SHALL support the following configuration fields under a new `memory` config section:

- `enabled` (boolean, default true): enable/disable persistent memory
- `similarityThreshold` (number, default 0.3): minimum similarity for recall
- `maxRecallCount` (number, default 5): maximum memories to inject
- `embeddingModel` (string, default 'Xenova/all-MiniLM-L6-v2'): local embedding model

#### Scenario: Memory disabled

- **WHEN** config specifies `memory.enabled: false`
- **THEN** the system SHALL skip memory extraction and recall entirely

#### Scenario: Custom threshold

- **WHEN** config specifies `memory.similarityThreshold: 0.8`
- **THEN** only memories with similarity >= 0.8 SHALL be recalled

### Requirement: Graceful degradation on embedding failure

If the embedding model fails to load or sqlite-vec extension fails to load, the system SHALL disable memory features and log a warning, without affecting core chat functionality.

#### Scenario: sqlite-vec load failure

- **WHEN** sqlite-vec extension cannot be loaded (e.g., platform incompatible)
- **THEN** the system SHALL log a warning and disable all memory features; chat SHALL continue normally

#### Scenario: Embedding model download failure

- **WHEN** the embedding model cannot be downloaded (e.g., no internet on first run)
- **THEN** the system SHALL log a warning and disable memory recall; chat SHALL continue normally

### Requirement: Memory cleanup

Memories older than the configured retention period (default: 365 days) SHALL be automatically cleaned up during the existing nightly cleanup cycle.

#### Scenario: Old memories purged

- **WHEN** the nightly cleanup runs and a memory is 400 days old
- **THEN** that memory SHALL be deleted from both `memories` and `vec_memories` tables
