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

- [ ] **2.1** Extend IPC protocol in `src/types.ts`:
  - [ ] Add `skills?: SkillInfo[]` field to `TaskInput` interface
- [ ] **2.2** Modify container runner in `src/container-runner.ts`:
  - [ ] Add skills volume mount logic: host `~/.config/vigilclaw/skills/` → container `/skills/:ro`
  - [ ] Only mount when enabled skills exist
- [ ] **2.3** Implement dynamic skill loading in `container/agent-runner/src/tools/index.ts`:
  - [ ] Add `loadSkillTools(skillInfos: SkillInfo[]): Tool[]` function
  - [ ] Scan `/skills/*/index.js`, require modules, create tool instances
  - [ ] Handle module exports: `createTool(name, definition)` or `default: ToolClass`
  - [ ] Catch and log load errors, skip failed skills
  - [ ] Merge skill tools with built-in tools in `createTools()`
- [ ] **2.4** Modify router in `src/router.ts`:
  - [ ] Query enabled skills from DB when creating QueuedTask
  - [ ] Pass enabled skills to `TaskInput.skills` field

### Group 3: Telegram 命令

- [ ] **3.1** Implement `/skill list` command in `src/router.ts`:
  - [ ] Call `skillRegistry.listSkills()`
  - [ ] Format output with name, version, status, description, permissions
  - [ ] Handle empty list case
- [ ] **3.2** Implement `/skill install <path>` command for local paths:
  - [ ] Parse path argument
  - [ ] Validate manifest and entry point
  - [ ] Display permissions and prompt for confirmation
  - [ ] Call `skillRegistry.installSkill(path, userId)`
  - [ ] Handle install errors and conflicts
- [ ] **3.3** Implement `/skill install <url>` command for Git URLs:
  - [ ] Parse Git URL and optional version tag
  - [ ] Clone to temp directory
  - [ ] Validate and install using `skillRegistry.installSkill()`
  - [ ] Clean up temp directory
- [ ] **3.4** Implement `/skill remove <name>` command:
  - [ ] Call `skillRegistry.removeSkill(name)`
  - [ ] Handle skill not found case
- [ ] **3.5** Implement `/skill enable <name>` and `/skill disable <name>` commands:
  - [ ] Call `skillRegistry.enableSkill(name)` or `disableSkill(name)`
  - [ ] Handle already enabled/disabled cases
- [ ] **3.6** Implement `/skill info <name>` command:
  - [ ] Call `skillRegistry.getSkillInfo(name)`
  - [ ] Format output with full skill details, tools, and metadata
  - [ ] Handle skill not found case
- [ ] **3.7** Add admin-only permission check for install/remove/enable/disable commands

### Group 4: 权限引擎

- [ ] **4.1** Implement permission checker in `src/skill-permissions.ts`:
  - [ ] validatePermissions(requested): Validate permission types
  - [ ] checkPermission(skill, permission): Runtime permission check
  - [ ] Stub enforcement (detailed enforcement deferred to later iteration)
- [ ] **4.2** Add permission context to container environment:
  - [ ] Pass skill permissions in TaskInput
  - [ ] Container tracks which skill is currently executing
- [ ] **4.3** Implement audit logging in `src/security-logger.ts`:
  - [ ] logSkillExecution(skill, tool, permission, status)
  - [ ] logPermissionDenied(skill, permission, action)
  - [ ] logSkillError(skill, tool, error)

### Group 5: 示例 Skill

- [ ] **5.1** Create example web-search skill:
  - [ ] Create directory structure: `examples/skills/web-search/`
  - [ ] Write `skill.json` manifest with name, version, description, permissions: ["network"], tools: [web_search]
  - [ ] Write `index.js` with stub implementation (returns mock search results)
  - [ ] Add README.md with usage instructions

### Group 6: 测试与验证

- [ ] **6.1** Write unit tests for skill registry (`tests/unit/skill-registry.test.ts`):
  - [ ] Test manifest validation (valid, missing fields, invalid version)
  - [ ] Test install from local path (success, path not found, missing index.js)
  - [ ] Test remove (success, skill not found)
  - [ ] Test enable/disable toggle
  - [ ] Test tool conflict detection
  - [ ] Test version upgrade/downgrade
- [ ] **6.2** Write unit tests for skill loader (`tests/unit/skill-loader.test.ts`):
  - [ ] Test dynamic loading of skill modules
  - [ ] Test graceful failure on load error
  - [ ] Test tool definition merging
- [ ] **6.3** Write unit tests for permission checker (`tests/unit/skill-permissions.test.ts`):
  - [ ] Test permission validation
  - [ ] Test runtime permission check
  - [ ] Test audit logging
- [ ] **6.4** Run `pnpm typecheck` and fix all TypeScript errors
- [ ] **6.5** Run `pnpm test` and ensure all tests pass
- [ ] **6.6** Run `pnpm build` and verify successful compilation
- [ ] **6.7** Run `pnpm docker:build` and verify container image builds successfully
- [ ] **6.8** E2E test: Install web-search skill and use it in a conversation
  - [ ] Start VigilClaw in dev mode
  - [ ] Install example web-search skill via `/skill install`
  - [ ] Send a message that triggers web_search tool usage
  - [ ] Verify tool is called and result returned
  - [ ] Check security_events table for skill execution log
- [ ] **6.9** Update ROADMAP.md and CHANGELOG.md to reflect skill system completion
