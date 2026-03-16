## Purpose

Skill execution enables dynamic loading of third-party tools in the container runtime, allowing the Agent to use skill tools alongside built-in tools in the ReAct loop.

## ADDED Requirements

### Requirement: Container volume mounting for skills

The system SHALL mount the host skills directory (`~/.config/vigilclaw/skills/`) to `/skills/` in the container as a read-only volume.

#### Scenario: Skills directory mounted

- **WHEN** a container is created for a task with enabled skills
- **THEN** the container SHALL have a read-only volume mount from `~/.config/vigilclaw/skills/` to `/skills/`

#### Scenario: No skills installed

- **WHEN** no skills are installed or all skills are disabled
- **THEN** the container SHALL NOT have a skills volume mount

### Requirement: Dynamic tool loading in container

The container SHALL scan `/skills/*/skill.json` and `/skills/*/index.js` at startup, load skill modules using `require()`, and create tool instances.

#### Scenario: Load skill tools

- **WHEN** `/skills/web-search/skill.json` and `/skills/web-search/index.js` exist
- **THEN** the container SHALL load the module, parse the manifest, and create tool instances for each tool declared in `manifest.tools`

#### Scenario: Skill module exports createTool function

- **WHEN** a skill's `index.js` exports `{ createTool: (name, definition) => Tool }`
- **THEN** the container SHALL call `createTool()` for each tool in the manifest

#### Scenario: Skill module exports tool class

- **WHEN** a skill's `index.js` exports `{ default: ToolClass }`
- **THEN** the container SHALL instantiate `new ToolClass(definition)`

### Requirement: Skill tool execution in ReAct loop

Skill tools SHALL be executed in the same manner as built-in tools within the ReAct loop. The tool name, input, and output SHALL follow the same protocol.

#### Scenario: LLM calls a skill tool

- **WHEN** the LLM returns a tool use block with `name: "web_search"` and `input: { query: "TypeScript" }`
- **THEN** the container SHALL invoke the `web_search` tool's `execute()` method with the input and return the result to the LLM

#### Scenario: Skill tool in merged tool list

- **WHEN** built-in tools ["bash", "read", "write", "edit"] and skill tools ["web_search", "summarize"] exist
- **THEN** the LLM SHALL receive all 6 tools in the tools parameter

### Requirement: IPC protocol extension with skills field

The system SHALL extend `TaskInput` to include a `skills` field containing metadata and tool definitions for enabled skills.

#### Scenario: TaskInput with skills

- **WHEN** a task is created with enabled skills
- **THEN** `TaskInput.skills` SHALL contain an array of `SkillInfo` objects with `name`, `version`, and `tools` definitions

#### Scenario: TaskInput without skills

- **WHEN** no skills are enabled or installed
- **THEN** `TaskInput.skills` SHALL be an empty array or undefined

#### Scenario: SkillInfo structure

- **WHEN** a skill "web-search@1.0.0" declares a tool "web_search"
- **THEN** `TaskInput.skills` SHALL include `{ name: "web-search", version: "1.0.0", tools: [{ name: "web_search", description: "...", input_schema: {...} }] }`

### Requirement: Graceful failure handling for skill loading

If a skill fails to load (e.g., syntax error in `index.js`, missing file), the system SHALL log a warning, skip the failed skill, and continue loading other skills and built-in tools.

#### Scenario: Skill load error

- **WHEN** `/skills/broken-skill/index.js` throws an error during `require()`
- **THEN** the container SHALL log "Warning: Failed to load skill broken-skill: <error message>", skip it, and load remaining tools

#### Scenario: All skills fail but built-in tools work

- **WHEN** all skills fail to load but built-in tools are functional
- **THEN** the ReAct loop SHALL proceed with only built-in tools, and the user SHALL see a warning message in the task output

### Requirement: Tool definition passed to LLM

The system SHALL merge built-in tool definitions and skill tool definitions into a single array and pass it to the LLM in the API request.

#### Scenario: Merged tool definitions

- **WHEN** built-in tools are ["bash", "read", "write", "edit"] and skill tools are ["web_search", "summarize"]
- **THEN** the LLM API request SHALL include 6 tool definitions in the `tools` parameter

#### Scenario: Tool description from manifest

- **WHEN** a skill declares tool "web_search" with description "Search the web for information"
- **THEN** the tool definition passed to the LLM SHALL include that exact description

#### Scenario: Input schema from manifest

- **WHEN** a skill declares a tool with `input_schema: { type: "object", properties: { query: { type: "string" } } }`
- **THEN** the tool definition SHALL include the input schema exactly as declared
