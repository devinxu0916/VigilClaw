## 1. 基础设施

- [x] 1.1 安装依赖：`pnpm add openai`
- [x] 1.2 扩展 Config：`provider.default` 支持 `claude | openai | ollama`；新增 `provider.openai`（model, maxTokens）和 `provider.ollama`（baseUrl, model）配置段；新增 `routing.simple` / `routing.complex` 配置
- [x] 1.3 DB 迁移 v3：确保 users.current_model 支持 `provider:model` 格式；新增 `db.updateUserModel(userId, model)` 方法
- [x] 1.4 创建 `src/provider/factory.ts`：实现 `parseProviderModel(identifier)` 解析 `provider:model` 格式（无前缀默认 claude）；实现 `createProvider(type, config)` 工厂函数；实现 `getCheapModel(providerType)` 返回各 Provider 最便宜模型

## 2. OpenAI Provider

- [x] 2.1 创建 `src/provider/openai.ts`：实现 `OpenAIProvider implements IProvider`，使用 `openai` SDK
- [x] 2.2 实现 `chat()` 方法：Anthropic ContentBlock → OpenAI format 转换（入口），OpenAI response → Anthropic ContentBlock 转换（出口）
- [x] 2.3 实现工具格式双向转换：`input_schema` ↔ `parameters`、`tool_use` content block ↔ `tool_calls`、`tool_result` ↔ `tool` role msg
- [x] 2.4 实现 `stream()` 方法：OpenAI 流式响应 → ChatChunk 转换
- [x] 2.5 实现 `estimateCost()`：GPT-4o / GPT-4o-mini / o4-mini 定价表
- [x] 2.6 编写 OpenAI Provider 单元测试：格式转换、成本计算、工具调用

## 3. Ollama Provider

- [x] 3.1 创建 `src/provider/ollama.ts`：继承或复用 OpenAIProvider，`baseURL` 改为 `config.ollama.baseUrl + '/v1'`，`apiKey` 设为 `'ollama'`
- [x] 3.2 实现 `estimateCost()`：所有模型返回 $0
- [x] 3.3 实现连接检测：启动时 ping Ollama，不可用时记录 warning
- [x] 3.4 编写 Ollama Provider 单元测试

## 4. 模型路由器

- [x] 4.1 创建 `src/model-router.ts`：实现 `classifyTask(messages)` 返回 `simple | complex`
- [x] 4.2 实现 `routeModel(userId, messages, config)`：根据分类和用户配置选择模型；用户通过 `/model` 强制设置时跳过路由
- [x] 4.3 编写模型路由器单元测试

## 5. 集成改造

- [x] 5.1 修改 `src/router.ts`：`/model` 命令支持 `provider:model` 格式和新别名（gpt4o, gpt4o-mini, llama3 等）；新增 `/model list` 子命令；调用 `db.updateUserModel()` 持久化
- [x] 5.2 修改 `src/router.ts`：handleMessage 中集成 ModelRouter，传入 provider 类型到 QueuedTask
- [x] 5.3 修改 `src/types.ts`：QueuedTask 新增 `provider` 字段
- [x] 5.4 修改 `src/index.ts`：executor 中通过 `parseProviderModel(task.model)` 获取 provider 类型；`recordApiCall` 使用实际 provider 而非硬编码 `'anthropic'`；辅助 Provider 根据用户当前 provider 动态创建
- [x] 5.5 修改 `src/local-runner.ts`：通过 Provider 工厂实例化，不再硬编码 Anthropic SDK
- [x] 5.6 修改 `src/credential-proxy.ts`：根据请求路径路由到 Anthropic 或 OpenAI API 端点；支持 OpenAI API Key 注入
- [x] 5.7 修改 `container/agent-runner/src/react-loop.ts`：从 taskInput 读取 provider 字段；根据 provider 实例化 Anthropic 或 OpenAI SDK；工具格式按 provider 转换
- [x] 5.8 修改 `src/context-compressor.ts` 和 `src/memory-store.ts`：摘要/提取模型跟随用户 Provider 的最便宜模型

## 6. 验证与收尾

- [x] 6.1 全量测试通过：`pnpm test`
- [x] 6.2 类型检查通过：`pnpm typecheck`
- [x] 6.3 构建通过：`pnpm build`
- [x] 6.4 容器镜像重建：`pnpm docker:build`
- [x] 6.5 E2E 验证：Claude / OpenAI / Ollama 三种 Provider 分别测试基础对话和工具调用
- [x] 6.6 更新 ROADMAP.md 和 CHANGELOG.md
