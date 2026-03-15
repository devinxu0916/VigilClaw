## MODIFIED Requirements

### Requirement: Memory extraction from conversations

After each successful assistant response, the system SHALL asynchronously extract memorable facts using the cheapest model from the user's current provider (Claude: haiku, OpenAI: gpt-4o-mini, Ollama: user's model).

#### Scenario: Extraction follows user provider

- **WHEN** user is using `openai:gpt-4o` and memory extraction is triggered
- **THEN** the extraction SHALL use `gpt-4o-mini` via the OpenAI provider
