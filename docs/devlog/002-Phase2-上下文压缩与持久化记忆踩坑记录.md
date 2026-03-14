# Phase 2 上下文压缩 + 持久化记忆 E2E 踩坑记录

> 日期：2026-03-14 | 阶段：Phase 2 E2E 验证

---

## 背景

Phase 2 实现了上下文压缩和持久化记忆两个功能。单元测试 75/75 全部通过，但 E2E 验证时遇到了 5 个问题，涉及 ESM 兼容性、native 依赖、数学公式和架构盲点。

---

## 坑点 1：sqlite-vec 在 ESM 下加载失败

**现象**：启动时报 `sqlite-vec extension not available — memory features disabled`，但 `node -e "require('sqlite-vec')"` 正常。

**根因**：项目使用 `"type": "module"`（ESM），`tsx --watch` 以 ESM 模式运行。`db.ts` 中直接用 `require('sqlite-vec')` 在 ESM 环境下不可用。单元测试不受影响是因为 Vitest 内部有 CJS 兼容层。

**修复**：

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// 然后正常 require('sqlite-vec')
```

**教训**：ESM 项目中使用 native CJS 模块时，`createRequire` 是标准做法。不能假设 `require` 在所有运行环境下可用。

---

## 坑点 2：@xenova/transformers 间接依赖 sharp 导致崩溃

**现象**：首次触发嵌入时报 `Cannot find module '../build/Release/sharp-darwin-arm64v8.node'`，嵌入模型加载失败，`loadFailed` 标志被锁死，后续所有记忆操作永久降级。

**根因**：`@xenova/transformers@2.x` 顶层 import `sharp`（图像处理库），即使文本嵌入模型不需要 sharp。sharp 是 native addon，需要编译或 prebuild，`@xenova/transformers` 依赖的 sharp@0.32.6 在 macOS ARM64 上没有预编译。

**尝试**：

1. `pnpm add sharp` — 安装了 0.34.5 版本，和 xenova 依赖的 0.32.6 不兼容
2. `TRANSFORMERS_JS_DISABLE_SHARP=1` 环境变量 — xenova@2.x 不检查这个变量，无效
3. 覆盖 `mod.env.backends.sharp = false` — 无效，sharp import 发生在 pipeline 之前

**最终修复**：迁移到 `@huggingface/transformers`（xenova 的官方继任者），该包不再强制依赖 sharp。

```bash
pnpm remove @xenova/transformers && pnpm add @huggingface/transformers
```

**教训**：

- 选择 npm 包时要检查其 native 依赖链，特别是跨平台兼容性
- `@xenova/transformers` 已废弃，`@huggingface/transformers` 是正统继任者
- 懒加载 + `loadFailed` 标志设计是正确的（避免重复尝试），但首次失败的错误信息要足够清晰

---

## 坑点 3：辅助 LLM 调用成本未被追踪

**现象**：`/cost` 命令的费用报告偏低，缺少摘要和记忆提取的 Haiku 调用成本。

**根因**：`ContextCompressor.compress()` 和 `MemoryStore.extractMemory()` 调用 Haiku API 后没有写入 `api_calls` 表。这些调用发生在宿主机侧，不走容器的成本记录路径。

**修复**：两个模块在 API 调用后各自调用 `db.recordApiCall()` 记录成本。`compress()` 新增 `userId`/`groupId` 参数用于关联。使用合成 taskId：`summary:{sessionKey}` / `memory-extract:{scopeKey}`。

**教训**：所有 LLM 调用都必须有成本追踪，包括辅助/后台调用。设计 API 调用路径时应提前考虑成本记录。

---

## 坑点 4：system 消息被 Claude Provider 静默过滤

**现象**：记忆成功召回（日志显示 `memoriesFound: 1`），但 LLM 回复完全不知道记忆内容，表现为"我不记得"。

**根因**：Claude API 的 messages 数组不支持 `role: 'system'`，system 内容必须通过单独的 `system` 参数传递。代码中三处（`ClaudeProvider.toAnthropicMessages()`、`LocalRunner.runTask()`、容器内 `reactLoop()`）都有 `.filter((m) => m.role !== 'system')`，将注入的摘要和记忆 system 消息直接丢弃。

**修复**：三处都新增逻辑 — 提取 messages 中的 system role 消息，拼接到 system prompt 参数中。

```typescript
const injected = messages.filter((m) => m.role === 'system').map((m) => m.content);
const systemPrompt =
  injected.length > 0 ? SYSTEM_PROMPT + '\n\n' + injected.join('\n\n') : SYSTEM_PROMPT;
```

**教训**：这是最隐蔽的 bug — 数据被静默丢弃，没有任何报错。单元测试 mock 了 provider，无法检测到 system 消息被过滤。需要集成测试或端到端测试来覆盖"system 消息能否被 LLM 实际看到"。

---

## 坑点 5：向量相似度计算公式错误

**现象**：记忆已存储、嵌入已生成、KNN 查询返回了结果，但所有记忆的 similarity 只有 0.4，低于阈值 0.7，全部被过滤。

**根因**：sqlite-vec 的 `distance` 返回的是 **L2（欧氏）距离**，不是余弦距离。代码中用 `1 - distance / 2` 转换，这个公式假设 distance 是余弦距离（范围 [0, 2]），对 L2 距离不适用。

对于归一化向量，正确的转换是：`cosine_similarity = 1 - (L2_distance² / 2)`

同时，all-MiniLM-L6-v2 对中英文混合内容的语义匹配精度有限，默认阈值 0.7 过高。

**修复**：

1. 公式改为 `1 - (distance * distance) / 2`
2. 默认阈值从 0.7 降到 0.3

**教训**：

- 向量数据库的 distance metric 必须和 similarity 计算公式匹配。sqlite-vec 默认用 L2，不是 cosine
- 嵌入模型的 similarity 分布和阈值需要通过实际数据标定，不能凭直觉设定
- 小型嵌入模型（384 维）对跨语言语义匹配能力有限，阈值需要相应降低

---

## 总结

| 坑点                | 类型       | 发现方式 | 影响               |
| ------------------- | ---------- | -------- | ------------------ |
| sqlite-vec ESM 加载 | 运行时兼容 | 启动日志 | 记忆功能完全降级   |
| sharp 依赖崩溃      | 依赖链问题 | 启动日志 | 嵌入永久不可用     |
| 成本未追踪          | 架构遗漏   | 代码审查 | 费用报告偏低       |
| system 消息被过滤   | 架构盲点   | E2E 验证 | 记忆注入完全无效   |
| 相似度公式错误      | 数学错误   | E2E 验证 | 记忆召回全部被拦截 |

最关键的教训：**单元测试 mock 太深会掩盖集成问题**。坑点 4 和 5 在单元测试中完全无法发现，只有端到端验证才能暴露。Phase 2 后续功能应增加集成测试覆盖。
