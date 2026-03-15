## Why

当前 VigilClaw 硬编码使用 Anthropic Claude 作为唯一 LLM Provider。用户无法选择更便宜的模型处理简单任务（如 GPT-4o-mini），也无法使用本地模型（Ollama）避免 API 成本。`/model` 命令虽然可以切换 Claude 子型号，但不支持跨 Provider 切换，且切换结果未持久化到数据库。

此外，所有任务使用同一个模型，没有"简单任务用便宜模型、复杂任务用贵模型"的分级路由能力，导致成本不可控。

## What Changes

- 新增 **OpenAI Provider** (`src/provider/openai.ts`)：支持 GPT-4o / GPT-4o-mini / o4-mini 等模型，通过 `openai` SDK 调用
- 新增 **Ollama Provider** (`src/provider/ollama.ts`)：支持本地模型（llama3、qwen2.5、deepseek 等），复用 `openai` SDK 的 OpenAI 兼容 API（`baseURL: http://localhost:11434/v1`）
- 新增 **Provider 工厂** (`src/provider/factory.ts`)：根据 `provider:model` 格式字符串实例化对应 Provider
- 新增 **模型路由器** (`src/model-router.ts`)：基于任务复杂度评估（消息长度 / 工具需求 / 用户偏好）自动选择合适的模型
- 修改 **ClaudeProvider**：工具格式转换提取为公共方法，system 消息合并逻辑已就绪
- 修改 **Config 系统**：新增 `provider.openai` 和 `provider.ollama` 配置段；`provider.default` 扩展为支持三种 Provider
- 修改 **DB 迁移 v3**：users 表新增 `provider` 列；api_calls 的 `provider` 列动态记录实际使用的 Provider
- 修改 **Router**：`/model` 命令支持 `openai:gpt-4o`、`ollama:llama3` 格式，持久化到 DB
- 修改 **LocalRunner**：从硬编码 Anthropic SDK 改为通过 Provider 工厂实例化
- 修改 **Container Agent Runner**：通过 IPC 传入 provider 类型，容器内根据 provider 实例化对应 SDK
- 修改 **Credential Proxy**：根据 provider 路由到不同的 API 端点（Anthropic `/v1/messages`、OpenAI `/v1/chat/completions`）
- 新增 **1 个生产依赖**：`openai`（同时用于 OpenAI 和 Ollama 的 OpenAI 兼容 API）

## Capabilities

### New Capabilities

- `multi-provider`: 多 Provider 支持（OpenAI + Ollama + 现有 Claude），统一接口抽象
- `model-routing`: 基于任务复杂度的模型分级路由

### Modified Capabilities

- `context-compression`: 摘要 Provider 可配置（不再硬编码 Claude Haiku）
- `persistent-memory`: 记忆提取 Provider 可配置

## Impact

- **新增依赖**: `openai`（~200KB，覆盖 OpenAI + Ollama 两个 Provider）
- **数据库**: 迁移 v3，users 表新增 provider 列
- **修改文件**: `src/provider/claude.ts`（重构工具转换）、`src/config.ts`（扩展）、`src/router.ts`（/model 命令扩展）、`src/local-runner.ts`（Provider 工厂化）、`src/index.ts`（初始化链）、`src/credential-proxy.ts`（多端点路由）、`container/agent-runner/src/react-loop.ts`（多 SDK 分支）
- **API 成本**: 新增 OpenAI 模型定价表；Ollama 成本为 $0
- **容器镜像**: 需要重建（react-loop 变更）
