## MODIFIED Requirements

### Requirement: Summary stored as system message (UPDATED)

The compressed summary SHALL be returned as a system-role message in the context array from `getContext()`, prefixed with `[Conversation Summary]`. The provider layer SHALL then extract all system-role messages and merge them into the LLM's `system` parameter (not pass them as message objects in the messages array).

> Added: 明确 system 消息不是直接传给 LLM 的 messages 数组，而是由 provider 层提取后合并到 system prompt 参数。这避免了 Claude API 不支持 messages 数组中 system role 的问题。

#### Scenario: Context output with summary (UPDATED)

- **WHEN** compression has produced a summary and there are 6 recent messages
- **THEN** `getContext()` SHALL return an array where index 0 is `{ role: 'system', content: '[Conversation Summary]\n...' }` followed by the 6 recent messages. The provider layer SHALL extract this system message and merge it into the `system` parameter when calling the LLM.

> Added: 补充 provider 层处理说明
