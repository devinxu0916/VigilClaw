## ADDED Requirements

### Requirement: Provider factory instantiation

The system SHALL support instantiating LLM providers by type using a factory function `createProvider(type, config)` that returns an `IProvider` implementation for `claude`, `openai`, or `ollama`.

#### Scenario: Create Claude provider

- **WHEN** `createProvider('claude', { apiKey })` is called
- **THEN** the system SHALL return a `ClaudeProvider` instance using `@anthropic-ai/sdk`

#### Scenario: Create OpenAI provider

- **WHEN** `createProvider('openai', { apiKey })` is called
- **THEN** the system SHALL return an `OpenAIProvider` instance using the `openai` SDK

#### Scenario: Create Ollama provider

- **WHEN** `createProvider('ollama', { baseUrl: 'http://localhost:11434' })` is called
- **THEN** the system SHALL return an `OllamaProvider` instance using the `openai` SDK with `baseURL` set to `{baseUrl}/v1`

#### Scenario: Unknown provider type

- **WHEN** `createProvider('unknown', {})` is called
- **THEN** the system SHALL throw an error with a descriptive message

### Requirement: Provider:model identifier format

The system SHALL use `provider:model` format strings (e.g., `openai:gpt-4o`, `ollama:llama3`, `claude:claude-sonnet-4-5-20250929`) as the canonical model identifier. Model strings without a provider prefix SHALL default to `claude` for backward compatibility.

#### Scenario: Parse provider:model string

- **WHEN** the model identifier is `openai:gpt-4o`
- **THEN** the system SHALL parse provider as `openai` and model as `gpt-4o`

#### Scenario: Parse legacy model string

- **WHEN** the model identifier is `claude-sonnet-4-5-20250929` (no prefix)
- **THEN** the system SHALL parse provider as `claude` and model as `claude-sonnet-4-5-20250929`

### Requirement: OpenAI tool format conversion

The `OpenAIProvider` SHALL convert between the internal Anthropic-style tool format and the OpenAI tool format transparently.

#### Scenario: Tool definition conversion

- **WHEN** tools with `input_schema` field are passed to `OpenAIProvider.chat()`
- **THEN** the provider SHALL convert them to OpenAI format with `parameters` field

#### Scenario: Tool call response conversion

- **WHEN** OpenAI returns `message.tool_calls` with `arguments` as JSON string
- **THEN** the provider SHALL convert them to Anthropic-style `tool_use` content blocks with parsed `input` object

#### Scenario: Tool result format conversion

- **WHEN** a `tool_result` content block is in the messages
- **THEN** the provider SHALL convert it to an OpenAI `tool` role message with `tool_call_id`

### Requirement: Per-provider cost tracking

Each provider SHALL implement `estimateCost(inputTokens, outputTokens, model)` with its own pricing table. Ollama models SHALL return cost $0.

#### Scenario: OpenAI cost calculation

- **WHEN** a request to `gpt-4o` consumes 1000 input tokens and 500 output tokens
- **THEN** `estimateCost` SHALL return the cost based on OpenAI's pricing ($2.50/M input, $10.00/M output)

#### Scenario: Ollama cost is zero

- **WHEN** a request to any Ollama model completes
- **THEN** `estimateCost` SHALL return $0

### Requirement: Model switching via /model command

The `/model` command SHALL support `provider:model` format and persist the selection to the database.

#### Scenario: Switch to OpenAI model

- **WHEN** user sends `/model openai:gpt-4o`
- **THEN** the system SHALL update the user's `current_model` in the database to `openai:gpt-4o` and confirm the switch

#### Scenario: Switch with alias

- **WHEN** user sends `/model gpt4o`
- **THEN** the system SHALL resolve the alias to `openai:gpt-4o` and persist

#### Scenario: List available models

- **WHEN** user sends `/model list`
- **THEN** the system SHALL display all available models grouped by provider with current selection highlighted

### Requirement: Credential proxy multi-provider routing

The credential proxy SHALL route API requests to the correct provider endpoint based on the request path.

#### Scenario: Anthropic API routing

- **WHEN** the proxy receives a request to `/v1/messages`
- **THEN** it SHALL forward to the Anthropic API with the Anthropic API key injected

#### Scenario: OpenAI API routing

- **WHEN** the proxy receives a request to `/v1/chat/completions`
- **THEN** it SHALL forward to the OpenAI API (or Ollama endpoint) with the appropriate API key injected

### Requirement: Container agent multi-provider support

The container agent react-loop SHALL accept a `provider` field in the task input and instantiate the corresponding SDK.

#### Scenario: Container with OpenAI provider

- **WHEN** taskInput specifies `provider: 'openai'`
- **THEN** the react-loop SHALL use the `openai` SDK to make LLM calls through the credential proxy

#### Scenario: Container with Claude provider

- **WHEN** taskInput specifies `provider: 'claude'`
- **THEN** the react-loop SHALL use the `@anthropic-ai/sdk` as before

### Requirement: Graceful degradation for unavailable providers

If a configured provider is unavailable (e.g., Ollama not running, missing API key), the system SHALL log a warning and fall back to the default provider.

#### Scenario: Ollama not running

- **WHEN** user has set model to `ollama:llama3` but Ollama is not reachable
- **THEN** the system SHALL return an error message to the user suggesting to check Ollama status or switch models
