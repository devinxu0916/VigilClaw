## MODIFIED Requirements

### Requirement: Summarization uses Haiku model

The system SHALL use the cheapest model from the user's current provider for generating summaries. For Claude: `claude-haiku-3-5-20250929`, for OpenAI: `gpt-4o-mini`, for Ollama: the user's configured model.

#### Scenario: Summary model follows provider

- **WHEN** user is using `openai:gpt-4o` and compression triggers
- **THEN** the summary SHALL be generated using `gpt-4o-mini`
