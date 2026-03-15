## Implementation Tasks

### Group 1: 基础设施

- [x] **1.1** DB migration v3: Create `skills` table with schema (name, version, manifest, code_path, enabled, installed_by, installed_at)
- [x] **1.2** Create skill manifest type definitions in `src/skill-types.ts` (SkillManifest, SkillInfo, SkillPermission, SkillTool)
- [x] **1.3** Implement skill registry module `src/skill-registry.ts`:
  - [x] validateManifest(manifest): Validate JSON schema and semver version
  - [x] installSkill(source, userId): Install from local path or Git URL
  - [x] removeSkill(name): Delete files and DB entry
  - [x] enableSkill(name): Set enabled=1
  - [x] disableSkill(name): Set enabled=0
  - [x] listSkills(): Return all installed skills
  - [x] getSkillInfo(name): Return skill details
  - [x] checkToolConflicts(tools): Detect name conflicts with built-in tools and existing skills
  - [x] upgradeSkill(name, newVersion): Replace existing installation

### Group 2: 容器集成

- [x] **2.1** Extend IPC protocol in `src/types.ts`:
  - [x] Add `skills?: SkillInfo[]` field to `TaskInput` interface
- [x] **2.2** Modify container runner in `src/container-runner.ts`:
  - [x] Add skills volume mount logic: host `~/.config/vigilclaw/skills/` → container `/skills/:ro`
  - [x] Only mount when enabled skills exist
- [x] **2.3** Implement dynamic skill loading in `container/agent-runner/src/tools/index.ts`:
  - [x] Add `loadSkillTools(skillInfos: SkillInfo[]): Tool[]` function
  - [x] Scan `/skills/*/index.js`, require modules, create tool instances
  - [x] Handle module exports: `createTool(name, definition)` or `default: ToolClass`
  - [x] Catch and log load errors, skip failed skills
  - [x] Merge skill tools with built-in tools in `createTools()`
- [x] **2.4** Modify router in `src/router.ts`:
  - [x] Query enabled skills from DB when creating QueuedTask
  - [x] Pass enabled skills to `TaskInput.skills` field

### Group 3: Telegram 命令

- [x] **3.1** Implement `/skill list` command in `src/router.ts`:
  - [x] Call `skillRegistry.listSkills()`
  - [x] Format output with name, version, status, description, permissions
  - [x] Handle empty list case
- [x] **3.2** Implement `/skill install <path>` command for local paths:
  - [x] Parse path argument
  - [x] Validate manifest and entry point
  - [x] Display permissions and prompt for confirmation
  - [x] Call `skillRegistry.installSkill(path, userId)`
  - [x] Handle install errors and conflicts
- [ ] **3.3** Implement `/skill install <url>` command for Git URLs:
  - [ ] Parse Git URL and optional version tag
  - [ ] Clone to temp directory
  - [ ] Validate and install using `skillRegistry.installSkill()`
  - [ ] Clean up temp directory
- [x] **3.4** Implement `/skill remove <name>` command:
  - [x] Call `skillRegistry.removeSkill(name)`
  - [x] Handle skill not found case
- [x] **3.5** Implement `/skill enable <name>` and `/skill disable <name>` commands:
  - [x] Call `skillRegistry.enableSkill(name)` or `disableSkill(name)`
  - [x] Handle already enabled/disabled cases
- [x] **3.6** Implement `/skill info <name>` command:
  - [x] Call `skillRegistry.getSkillInfo(name)`
  - [x] Format output with full skill details, tools, and metadata
  - [x] Handle skill not found case
- [x] **3.7** Add admin-only permission check for install/remove/enable/disable commands

### Group 4: 权限引擎

- [x] **4.1** Implement permission checker in `src/skill-permissions.ts`:
  - [x] validatePermissions(requested): Validate permission types
  - [x] checkPermission(skill, permission): Runtime permission check
  - [x] Stub enforcement (detailed enforcement deferred to later iteration)
- [x] **4.2** Add permission context to container environment:
  - [x] Pass skill permissions in TaskInput
  - [x] Container tracks which skill is currently executing
- [x] **4.3** Implement audit logging in `src/security-logger.ts`:
  - [x] logSkillExecution(skill, tool, permission, status)
  - [x] logPermissionDenied(skill, permission, action)
  - [x] logSkillError(skill, tool, error)

### Group 5: 示例 Skill

- [x] **5.1** Create example web-search skill:
  - [x] Create directory structure: `examples/skills/web-search/`
  - [x] Write `skill.json` manifest with name, version, description, permissions: ["network"], tools: [web_search]
  - [x] Write `index.js` with stub implementation (returns mock search results)
  - [ ] Add README.md with usage instructions

### Group 6: 测试与验证

- [x] **6.1** Write unit tests for skill registry (`tests/unit/skill-registry.test.ts`):
  - [x] Test manifest validation (valid, missing fields, invalid version)
  - [x] Test install from local path (success, path not found, missing index.js)
  - [x] Test remove (success, skill not found)
  - [x] Test enable/disable toggle
  - [x] Test tool conflict detection
  - [x] Test version upgrade/downgrade
- [x] **6.2** Write unit tests for skill loader (`tests/unit/skill-loader.test.ts`):
  - [x] Test dynamic loading of skill modules
  - [x] Test graceful failure on load error
  - [x] Test tool definition merging
- [x] **6.3** Write unit tests for permission checker (`tests/unit/skill-permissions.test.ts`):
  - [x] Test permission validation
  - [x] Test runtime permission check
  - [x] Test audit logging
- [x] **6.4** Run `pnpm typecheck` and fix all TypeScript errors
- [x] **6.5** Run `pnpm test` and ensure all tests pass
- [x] **6.6** Run `pnpm build` and verify successful compilation
- [x] **6.7** Run `pnpm docker:build` and verify container image builds successfully
- [ ] **6.8** E2E test: Install web-search skill and use it in a conversation
  - [ ] Start VigilClaw in dev mode
  - [ ] Install example web-search skill via `/skill install`
  - [ ] Send a message that triggers web_search tool usage
  - [ ] Verify tool is called and result returned
  - [ ] Check security_events table for skill execution log
- [x] **6.9** Update ROADMAP.md and CHANGELOG.md to reflect skill system completion
