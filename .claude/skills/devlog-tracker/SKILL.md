---
name: devlog-tracker
description: Record implementation pitfalls, debugging insights, and lessons learned into structured devlog documents. Triggers on completing any implementation task that encountered issues, after debugging sessions, after E2E testing, or when user says "record this", "document this pitfall", "add to devlog", "踩坑记录". MUST be invoked after any implementation phase that involved non-trivial bug fixes or workarounds.
---

# Devlog Tracker

Record implementation problems, root causes, and fixes into `docs/devlog/` as structured documents.

## When to Trigger

- After completing an implementation task that required non-trivial debugging (>15 min)
- After E2E testing that uncovered issues
- After any workaround or design compromise was made
- When switching approaches due to technical limitations
- When user explicitly requests documentation of an issue

## Process

### 1. Determine the next document number

```bash
ls docs/devlog/ | sort -n | tail -1
```

Increment the number prefix: `001-xxx.md` → `002-xxx.md`.

### 2. Create the devlog entry

File: `docs/devlog/{NNN}-{short-description}.md`

Use this structure for each entry:

```markdown
# {Title}

> 日期：{YYYY-MM-DD} | 阶段：{Phase X / feature name}

---

## 背景

{1-2 sentences: what were you trying to do when this happened}

---

## 坑点 N：{Short Title}

**现象**：{What the user/developer observed — error message, unexpected behavior}

**根因**：{Technical root cause — be specific about which code/config/platform caused it}

**修复**：{What was changed to fix it, with code snippets if <10 lines}

**预防**：{How to prevent this in the future — coding pattern, CI check, or design rule}

---

## 总结

| #   | 类别       | 耗时   | 可预防 |
| --- | ---------- | ------ | ------ |
| 1   | {category} | {time} | ✅/⚠️  |

**最大教训**：{One sentence takeaway}
```

### 3. Keep entries atomic

- One devlog file per implementation session / debugging session
- Multiple pitfalls in the same session go in the same file
- Don't mix pitfalls from different features or phases

### 4. Update CHANGELOG if applicable

If the devlog documents changes that were actually applied to the codebase, ensure those changes are also reflected in `docs/planning/CHANGELOG.md` under the appropriate section (Changed / Fixed).

## Naming Conventions

- File: `{NNN}-{kebab-case-description}.md`
- `NNN`: Zero-padded 3-digit sequence number
- Description: Short, searchable — e.g., `container-e2e-debugging`, `sqlite-migration-gotchas`, `telegram-markdown-issues`

## Reference

Existing devlogs: `docs/devlog/`
