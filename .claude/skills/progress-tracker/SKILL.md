---
name: progress-tracker
description: >
  Automatically sync project progress to ROADMAP.md and CHANGELOG.md after implementation work.
  Triggers: after completing any implementation task, code change, bug fix, or feature addition
  that maps to a ROADMAP item. Also triggers on: "update progress", "sync roadmap",
  "mark X as done", phase transitions, or milestone completions.
  MUST be loaded as a skill for any implementation task in this project.
---

# Progress Tracker

Automatically detect and record project progress in `docs/planning/ROADMAP.md` and `docs/planning/CHANGELOG.md` after implementation work.

## When to Run

Execute progress sync at the **end of every implementation session** — after code changes are verified and before reporting completion to the user. This is a post-implementation step, not a standalone task.

## Sync Procedure

### Step 1: Identify Completed Work

Determine what was accomplished in the current session:
- What files were created/modified?
- What functionality was implemented?
- Does it map to a ROADMAP task or acceptance criterion?

### Step 2: Update ROADMAP

Read `docs/planning/ROADMAP.md` and apply matching updates:

**Task status update** — change the status emoji in the matching row:
```markdown
# Before
| 项目脚手架 | Day 1-2 | ⏳ | pnpm + TS + ESLint + Vitest + 目录结构 |

# After
| 项目脚手架 | Day 1-2 | ✅ | pnpm + TS + ESLint + Vitest + 目录结构 |
```

**Acceptance criteria** — check completed items:
```markdown
# Before
- [ ] 通过 Telegram 发消息，Agent 在 Docker 容器中用 Claude 回复

# After
- [x] 通过 Telegram 发消息，Agent 在 Docker 容器中用 Claude 回复
```

**Phase transition** — when ALL tasks in a phase are ✅:
1. Update the status table at the top of ROADMAP:
   ```markdown
   | Phase 0：架构设计 | ✅ 已完成 | 2026-03-10 ~ 03-11 |
   | Phase 1：MVP 核心 | 🔄 进行中 | 2026-03-12 ~ |
   ```
2. Archive completed phase to `docs/planning/milestones/`:
   - Create file: `docs/planning/milestones/phase-N-<slug>.md`
   - Move the completed phase's detail section into it
   - Replace in ROADMAP with a link:
     ```markdown
     ## 已完成里程碑
     - [Phase 0：架构设计](./milestones/phase-0-architecture.md) — 2026-03-10 ~ 03-11
     ```
3. Update the "最后更新" date at top of ROADMAP

### Step 3: Update README Roadmap

Read `README.md` and update the `## 🗺️ Roadmap` table to match the current phase status.
Reference the structure spec in `references/readme-roadmap.md`.

**Sub-item completed** — append to the matching Phase row's content column:
```markdown
# Before
| Phase 2: 差异化能力 | 🔧 进行中 | 多模型 ✅ · Web Dashboard ⏳ |

# After (new sub-item done)
| Phase 2: 差异化能力 | 🔧 进行中 | 多模型 ✅ · Web Dashboard ✅ |
```

**Phase fully completed** — change the status column:
```markdown
| Phase 2: 差异化能力 | ✅ 完成 | 多模型 ✅ · 多渠道 ✅ · ... |
```

Only update README when ROADMAP was also updated in Step 2. Keep changes minimal — only the status column and content column of affected rows.

### Step 4: Update CHANGELOG

Append completed work under `## [Unreleased]` in `docs/planning/CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- 项目脚手架：pnpm + TypeScript + ESLint + Vitest 配置
- SQLite schema 定义及迁移系统
```

Use standard categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

Deduplication rule: if the same item already exists under `[Unreleased]`, skip it.

### Step 5: Confirm

After updating, briefly report to the user:
```
📊 进度已同步:
- ROADMAP: [what was updated]
- README: [what was updated]
- CHANGELOG: [what was added]
```

## Rules

- **Only update items that match actual completed work** — never speculatively mark future tasks
- **Preserve existing formatting** — match the exact table/list style in ROADMAP
- **Idempotent** — running twice on the same work produces the same result
- **Partial completion** — if a task is partially done, leave it as ⏳ and add a note
- **Date tracking** — always update "最后更新" at the top of ROADMAP when making changes
