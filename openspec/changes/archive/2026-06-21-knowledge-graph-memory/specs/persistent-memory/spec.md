## MODIFIED Requirements

### Requirement: Memory injection into context

Recalled memories SHALL be injected as a system-role message in the context array returned by `getContext()`, after any compression summary and before the conversation messages. When the knowledge graph capability is enabled and returns facts, a separate `[Knowledge Graph]` system-role message SHALL be injected immediately after the `[Relevant Memories]` message and before the conversation messages. The provider layer SHALL then extract all system-role messages and merge them into the LLM's `system` parameter (not pass them as message objects in the messages array, as Claude API does not support system role in the messages array).

> Changed: 注入序列在 `[Relevant Memories]` 之后、对话消息之前，新增可选的 `[Knowledge Graph]` 系统消息（由 knowledge-graph-memory 能力提供）。向量记忆注入行为本身不变。

#### Scenario: Memories injected with summary

- **WHEN** both a compression summary and relevant memories exist (and no graph facts)
- **THEN** `getContext()` SHALL return: `[summary_system_msg, memories_system_msg, ...recent_messages]`

#### Scenario: Memories injected without summary

- **WHEN** relevant memories exist but no compression summary (and no graph facts)
- **THEN** `getContext()` SHALL return: `[memories_system_msg, ...recent_messages]`

#### Scenario: Memories and graph facts injected together

- **WHEN** both relevant memories and knowledge-graph facts are recalled
- **THEN** `getContext()` SHALL return: `[...optional summary_system_msg, memories_system_msg, knowledge_graph_system_msg, ...recent_messages]`

#### Scenario: Memory message format

- **WHEN** 3 memories are recalled
- **THEN** the memory system message SHALL have role `system` and content prefixed with `[Relevant Memories]\n` followed by each memory as a bullet point
