## Why

Phase 2 E2E 验证过程中发现并修复了 5 个 bug，这些修复导致实际实现与原始 spec 产生偏差。spec 文档需要同步更新以反映最终实现状态，确保 spec 作为 single source of truth 的准确性。

## What Changes

更新 `openspec/specs/` 下两个 spec 文件中与实际实现不符的内容：

1. **persistent-memory/spec.md**：
   - 嵌入库名 `@xenova/transformers` → `@huggingface/transformers`
   - 默认 similarity 阈值 `0.7` → `0.3`
   - 补充 similarity 计算公式说明（L2 距离转余弦相似度）
   - 补充 system 消息合并到 system prompt 的行为说明

2. **context-compression/spec.md**：
   - 补充 system 消息合并到 system prompt 的行为说明（不是作为 message 传递，而是提取后合并到 system 参数）

## Capabilities

### Modified Capabilities

- `persistent-memory`: 更新嵌入库引用、阈值默认值、相似度公式、system 消息处理
- `context-compression`: 更新 system 消息注入方式描述

## Impact

- 纯文档变更，不涉及代码改动
- 所有代码已在前序 commit 中完成修复
