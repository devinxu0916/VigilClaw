## Context

VigilClaw 当前只支持 Anthropic Claude。所有 LLM 调用路径（LocalRunner、ContainerRunner 的 react-loop、ContextCompressor、MemoryStore）都硬编码使用 Anthropic SDK。IProvider 接口已存在但只有一个实现。`/model` 命令可切换 Claude 子型号但未持久化。

需要新增 OpenAI 和 Ollama 两个 Provider，并实现基于任务复杂度的模型路由。

技术约束：

- 生产依赖目标保持精简（当前 9 个，新增 1 个 `openai` SDK）
- Ollama 走 OpenAI 兼容 API（`baseURL: http://localhost:11434/v1`），共用 `openai` SDK，不引入 `ollama` 独立 SDK
- 容器内 Agent 需要通过 Credential Proxy 访问 API，Proxy 需要知道目标 Provider 以路由到正确端点
- 工具调用格式 OpenAI 和 Anthropic 差异大（`parameters` vs `input_schema`、`tool_calls` vs `tool_use` content block）

## Goals / Non-Goals

**Goals:**

- 用户可通过 `/model openai:gpt-4o` 或 `/model ollama:llama3` 切换 Provider 和模型
- 模型路由器根据消息复杂度自动选择模型（可覆盖）
- 所有 Provider 的成本统一追踪（Ollama 成本为 $0）
- Provider 切换对用户透明，相同的交互方式

**Non-Goals:**

- 不支持同一次对话中混合多个 Provider（一次任务 = 一个 Provider）
- 不实现 Provider 间的自动 fallback（Provider A 挂了切 Provider B）
- 不支持自定义 Provider 插件系统（后续可扩展）
- 不实现 streaming 响应到 Telegram（当前架构是全量回复）

## Decisions

### D1: Ollama 复用 openai SDK（不引入 ollama 包）

**选择**: 通过 `new OpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })` 调用 Ollama

**替代方案**:

- `ollama` 官方 SDK：独立 API 形状，需要额外适配层
- 直接 fetch Ollama REST API：无类型安全

**理由**: Ollama 的 OpenAI 兼容 API 已经稳定，复用 openai SDK 零额外依赖，OllamaProvider 只是 OpenAIProvider 的 baseURL 变体。

### D2: Provider:Model 统一标识格式

**选择**: `provider:model` 格式字符串，如 `openai:gpt-4o`、`ollama:llama3`、`claude:claude-sonnet-4-5-20250929`

**替代方案**:

- 分开存 provider 和 model 两个字段
- 只存 model 名，通过前缀推断 provider

**理由**: 单字符串格式简洁，兼容现有 `currentModel` 列（无需改列名），解析简单（`split(':')`）。不带 provider 前缀的 model 默认为 claude（向后兼容）。

### D3: OpenAI Provider 工具格式适配

**选择**: 在 OpenAIProvider 内部做双向格式转换

| 方向     | Anthropic 格式           | OpenAI 格式               |
| -------- | ------------------------ | ------------------------- |
| 工具定义 | `input_schema`           | `parameters`              |
| 工具调用 | content block `tool_use` | `message.tool_calls`      |
| 工具结果 | user msg `tool_result`   | `tool` role msg           |
| 参数     | parsed object (`input`)  | JSON string (`arguments`) |

**理由**: IProvider 接口使用 Anthropic 的 ContentBlock 格式作为内部表示。OpenAI Provider 在 chat() 入口做 Anthropic→OpenAI 转换，出口做 OpenAI→Anthropic 转换。这样上层代码不感知差异。

### D4: 模型路由策略 — 基于 token 预算的简单分级

**选择**: 根据用户消息长度 + 是否需要工具调用，将任务分为 simple/complex 两级

| 条件                          | 分类    | 默认路由                                         |
| ----------------------------- | ------- | ------------------------------------------------ |
| 消息 < 500 chars 且无工具需求 | simple  | 用户配置的 simple 模型（默认 haiku/gpt-4o-mini） |
| 其他                          | complex | 用户配置的 complex 模型（默认 sonnet/gpt-4o）    |

**替代方案**:

- LLM-based 复杂度评估：需要额外 API 调用，增加延迟和成本
- 基于历史对话的自适应路由：过度工程

**理由**: 简单规则足够覆盖 80% 场景（短问答 vs 长任务）。用户可通过 `/model` 强制指定覆盖路由。后续可迭代增加更复杂的路由策略。

### D5: Credential Proxy 多 Provider 路由

**选择**: 通过请求路径区分 Provider

| 请求路径               | 转发目标                |
| ---------------------- | ----------------------- |
| `/v1/messages`         | Anthropic API           |
| `/v1/chat/completions` | OpenAI API 或 Ollama    |
| `/api/*`               | Ollama 原生 API（预留） |

**理由**: 容器内的 SDK 使用不同的 API 路径，Proxy 只需按路径路由即可。API Key 从 DB 凭证中根据 provider 读取。

### D6: 容器内多 Provider 支持

**选择**: 通过 IPC 传入 `provider` 字段，容器内 react-loop 根据 provider 类型实例化对应 SDK

**理由**: 容器镜像需要同时包含 `@anthropic-ai/sdk` 和 `openai` 两个 SDK。通过 IPC 的 taskInput.provider 字段决定使用哪个。Ollama 复用 openai SDK。

### D7: 辅助 LLM 调用（摘要/记忆提取）的 Provider

**选择**: 辅助调用始终使用用户当前配置的 Provider 的最便宜模型

| 用户 Provider | 辅助模型                   |
| ------------- | -------------------------- |
| claude        | claude-haiku-3-5-20250929  |
| openai        | gpt-4o-mini                |
| ollama        | 用户配置的模型（本地免费） |

**理由**: 辅助调用走用户的 Provider 可以复用同一个凭证和 Proxy 配置。每个 Provider 都有便宜模型可用。

## Risks / Trade-offs

**[Ollama 工具调用不完整]** → 部分 Ollama 模型不支持 function calling；降级方案：将工具定义注入 system prompt，手动解析 JSON 输出

**[OpenAI 和 Anthropic 工具格式转换丢失精度]** → Anthropic 的 `input` 是 parsed object，OpenAI 的 `arguments` 是 JSON string；转换时可能有边界情况；用集成测试覆盖

**[容器镜像体积增加]** → 新增 openai SDK 约 200KB，可接受

**[/model 命令复杂度增加]** → 用户需要记住 `provider:model` 格式；提供 `/model list` 命令展示可用模型

**[模型路由误判]** → 简单规则可能将复杂任务路由到便宜模型；用户可通过 `/model` 强制覆盖
