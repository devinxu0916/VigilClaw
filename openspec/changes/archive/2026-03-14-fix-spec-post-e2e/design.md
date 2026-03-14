## Context

Phase 2 E2E 验证后修复了 5 个 bug，specs 需要同步更新。所有代码变更已完成，本 change 仅更新 spec 文档。

## Goals / Non-Goals

**Goals:**

- 让 openspec/specs/ 下的 spec 文件与当前实现完全一致

**Non-Goals:**

- 不涉及任何代码变更
- 不涉及新功能

## Decisions

### D1: 直接原地修改 main specs

修改 `openspec/specs/persistent-memory/spec.md` 和 `openspec/specs/context-compression/spec.md`。因为是纠正性更新，不需要 delta spec。

## Risks / Trade-offs

无风险 — 纯文档对齐。
