# OpenSpec 工作流约定

> 适用于 VigilClaw 项目的 OpenSpec 使用规范

---

## 1. Change 分级策略

已归档 change 发现问题需要修复时，按修复规模选择不同路径：

### Level 1：Trivial 纠错

**适用场景**：typo、默认值同步、措辞调整

**判断标准**：改完后不需要任何代码变更

**做法**：直接修改 main spec + git commit

```bash
# 直接改 main spec
edit openspec/specs/<capability>/spec.md
git commit -m "fix(spec): <简述修正内容>"
```

**示例**：修正一个错误的默认值数字、修正一个拼写错误

---

### Level 2：实现偏差补正

**适用场景**：E2E 验证后发现多处 spec 与实现不符，需要批量修正

**判断标准**：涉及 2+ 个需求/场景的修改，或跨 spec 文件联动修改

**做法**：新建轻量 change，proposal + tasks 为主，design 极简

```bash
openspec new change "fix-<描述>"
# proposal.md — 解释为什么改（关联哪次验证/哪个 bug）
# design.md  — 极简，可以只写 Context + Goals
# specs/     — delta specs 描述具体变更
# tasks.md   — 实施步骤
# apply → sync → archive
```

**示例**：E2E 验证后 5 处 spec 偏差修正（库名、阈值、公式、消息处理）

---

### Level 3：设计缺陷修正

**适用场景**：spec 本身的需求定义有逻辑缺陷，需要重新定义行为

**判断标准**：spec 修改会导致代码需要变更

**做法**：完整 change 工作流

```bash
openspec new change "redesign-<描述>"
# 完整走：proposal → design → specs → tasks → apply → archive
# design 中必须解释：原始设计的问题、新设计如何解决、影响范围
```

**示例**：发现某个需求的交互模型有根本性问题，需要重新设计数据流

---

### 分级决策流程图

```
已归档 change 发现问题
  │
  ├── 需要改代码吗？
  │     └── 是 → Level 3（完整 change）
  │
  ├── 涉及 2+ 个需求/跨文件？
  │     └── 是 → Level 2（轻量 change）
  │
  └── 其他 → Level 1（直接改 + commit）
```

---

## 2. 归档不可变原则

已归档的 change（`openspec/changes/archive/`）是历史快照，**永不修改**。

- 不要将已归档的 change 移回 `openspec/changes/`
- 不要编辑归档目录中的任何文件
- 修复问题时始终创建新的 change 或直接修改 main spec
- 归档中的"过时内容"（如旧库名）是正常的，它反映的是当时的决策

---

## 3. Delta Spec vs 直接修改 Main Spec

| 场景          | 做法                                                  |
| ------------- | ----------------------------------------------------- |
| 新功能开发    | 通过 change 的 delta spec，apply 后 sync 到 main spec |
| Level 2+ 修正 | 通过 change 的 delta spec，apply 后 sync 到 main spec |
| Level 1 修正  | 直接修改 main spec，不走 delta                        |

---

## 4. Commit Message 规范

Spec 相关的 commit 使用以下前缀：

```
fix(spec): <修正内容>           # Level 1 直接修正
docs: sync specs with ...       # Level 2 change 归档后的 commit
feat: add <capability> spec     # 新功能 spec（随功能 change 一起）
```
