## 1. 更新 persistent-memory main spec

- [x] 1.1 `openspec/specs/persistent-memory/spec.md`：将 `@xenova/transformers` 改为 `@huggingface/transformers`
- [x] 1.2 补充 similarity 计算公式说明：`similarity = 1 - (distance² / 2)`
- [x] 1.3 将 default similarity threshold 从 `0.7` 改为 `0.3`（两处：scenario + config）
- [x] 1.4 补充 memory injection 的 system 消息处理方式说明（provider 层提取合并到 system prompt）

## 2. 更新 context-compression main spec

- [x] 2.1 `openspec/specs/context-compression/spec.md`：补充 system 消息由 provider 层提取合并到 system prompt 参数的说明
