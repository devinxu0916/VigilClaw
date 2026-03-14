## Purpose

智能上下文压缩：当对话 token 数超过预算时，自动将旧消息增量摘要为 system prompt，保留最近消息完整性，避免上下文溢出和信息丢失。

## Requirements

### Requirement: Token-aware context budgeting

The system SHALL estimate the token count of each message using the formula `Math.ceil(text.length / 4)` and track the total token count of the current context window.

#### Scenario: Token counting for a normal message

- **WHEN** a message with 400 characters is processed
- **THEN** the system SHALL estimate it as 100 tokens

#### Scenario: Token counting for an empty message

- **WHEN** a message with empty content is processed
- **THEN** the system SHALL estimate it as 0 tokens

### Requirement: Automatic context compression trigger

The system SHALL trigger context compression when the total token count of all context messages exceeds the configured `maxContextTokens` threshold (default: 6000).

#### Scenario: Context under budget

- **WHEN** a conversation has 10 messages totaling 3000 estimated tokens
- **THEN** the system SHALL NOT trigger compression and SHALL return all messages as-is

#### Scenario: Context over budget triggers compression

- **WHEN** a conversation has 25 messages totaling 8000 estimated tokens and `maxContextTokens` is 6000
- **THEN** the system SHALL trigger compression to bring the total under budget

### Requirement: Incremental summarization of old messages

When compression is triggered, the system SHALL preserve the most recent `recentMessagesKeep` messages (default: 6) intact and summarize older messages into a rolling summary using an LLM call.

#### Scenario: First compression with no prior summary

- **WHEN** compression triggers for the first time in a session (no existing summary)
- **THEN** the system SHALL summarize the old messages into a new summary and store it in the `context_summaries` table

#### Scenario: Incremental compression with existing summary

- **WHEN** compression triggers and a previous summary exists for this session
- **THEN** the system SHALL pass the previous summary plus new old messages to the LLM to produce an updated summary (incremental, not full re-summarization)

#### Scenario: Recent messages are never compressed

- **WHEN** compression triggers and `recentMessagesKeep` is 6
- **THEN** the most recent 6 messages SHALL remain fully intact and unmodified in the output

### Requirement: Summary stored as system message

The compressed summary SHALL be injected as the first message in the context array returned by `getContext()` with role `system`, prefixed with `[Conversation Summary]`. The provider layer SHALL then extract all system-role messages and merge them into the LLM's `system` parameter (not pass them as message objects in the messages array, as Claude API does not support system role in the messages array).

#### Scenario: Context output with summary

- **WHEN** compression has produced a summary and there are 6 recent messages
- **THEN** `getContext()` SHALL return an array where index 0 is `{ role: 'system', content: '[Conversation Summary]\n...' }` followed by the 6 recent messages. The provider layer SHALL extract this system message and merge it into the `system` parameter when calling the LLM.

#### Scenario: Context output without summary

- **WHEN** no compression has been triggered for this session
- **THEN** `getContext()` SHALL return the raw messages without any summary prefix

### Requirement: Summarization uses Haiku model

The system SHALL always use `claude-haiku-3-5-20250929` for generating summaries, regardless of the user's current model selection.

#### Scenario: Summary model independence

- **WHEN** user is using `claude-opus-4-20250929` and compression triggers
- **THEN** the summary SHALL be generated using `claude-haiku-3-5-20250929`

### Requirement: Summarization cost tracking

Each summary generation API call SHALL be recorded in the `api_calls` table with provider `anthropic` and the Haiku model, so it appears in the user's cost report.

#### Scenario: Summary cost recorded

- **WHEN** a summary is generated consuming 500 input tokens and 200 output tokens
- **THEN** an `api_calls` record SHALL be inserted with the correct token counts and calculated cost

### Requirement: Summary persistence across context retrievals

The latest summary for each session SHALL be persisted in a `context_summaries` table so it survives process restarts and is available on next `getContext()` call.

#### Scenario: Summary survives restart

- **WHEN** a summary has been generated, the process restarts, and `getContext()` is called for the same session
- **THEN** the stored summary SHALL be loaded and used as the context prefix

#### Scenario: Summary cleared on /clear command

- **WHEN** user executes `/clear`
- **THEN** the stored summary for that session SHALL be deleted along with the messages

### Requirement: Compression configuration

The system SHALL support the following configuration fields under `session` config:

- `maxContextTokens` (number, default 6000): trigger threshold
- `recentMessagesKeep` (number, default 6): messages to preserve

#### Scenario: Custom compression configuration

- **WHEN** config specifies `session.maxContextTokens: 10000` and `session.recentMessagesKeep: 10`
- **THEN** compression SHALL trigger at 10000 tokens and preserve the 10 most recent messages

### Requirement: Graceful degradation on summarization failure

If the summarization LLM call fails (network error, API error, budget exceeded), the system SHALL fall back to simple truncation (keep most recent `recentMessagesKeep` messages, discard older ones) and log a warning.

#### Scenario: LLM call fails

- **WHEN** the Haiku API call for summarization fails with a network error
- **THEN** the system SHALL return the most recent `recentMessagesKeep` messages without a summary, and log a warning
