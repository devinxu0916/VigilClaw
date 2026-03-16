## Purpose

Skill permissions provide a declarative security model where skills declare required capabilities in their manifest, users confirm permissions during installation, and the runtime enforces permissions during execution.

## ADDED Requirements

### Requirement: Permission types

The system SHALL support four permission types: `bash`, `read`, `write`, `network`. Each permission type restricts access to corresponding system capabilities.

#### Scenario: Permission type definitions

- **WHEN** a skill manifest declares `permissions: ["network"]`
- **THEN** the skill SHALL be allowed to make network requests but NOT execute bash, read files, or write files

#### Scenario: Multiple permissions

- **WHEN** a skill manifest declares `permissions: ["read", "write"]`
- **THEN** the skill SHALL be allowed to read and write files but NOT execute bash or make network requests

### Requirement: Permission declaration in manifest

Skills MUST declare required permissions in the `permissions` field of `skill.json`. The permissions field SHALL be an array of strings.

#### Scenario: Valid permission declaration

- **WHEN** a manifest declares `permissions: ["bash", "network"]`
- **THEN** manifest validation SHALL pass

#### Scenario: Invalid permission type

- **WHEN** a manifest declares `permissions: ["execute"]` (not a valid permission)
- **THEN** manifest validation SHALL fail with error "Invalid permission type: execute"

#### Scenario: Empty permissions

- **WHEN** a manifest declares `permissions: []`
- **THEN** the skill SHALL have no special capabilities (only pure computation)

### Requirement: Permission display during installation

During skill installation, the system SHALL display all requested permissions to the user and require explicit confirmation before proceeding.

#### Scenario: User confirms permissions

- **WHEN** `/skill install /path/to/web-search` is invoked and the skill requests ["network"]
- **THEN** the system SHALL display "Skill 'web-search' requests permissions: network. Continue? (yes/no)" and wait for user response

#### Scenario: User rejects permissions

- **WHEN** the user responds "no" to the permission confirmation prompt
- **THEN** the installation SHALL be cancelled and the skill SHALL NOT be installed

#### Scenario: Auto-accept for admin users

- **WHEN** an admin user installs a skill and config `autoAcceptPermissions: true` is set
- **THEN** the system SHALL skip the confirmation prompt and proceed with installation

### Requirement: Runtime permission checking

The system SHALL enforce permissions at runtime in the container. When a skill attempts to use a capability not declared in its permissions, the operation SHALL be blocked.

#### Scenario: Skill uses declared permission

- **WHEN** a skill with `permissions: ["network"]` calls a network API
- **THEN** the operation SHALL succeed

#### Scenario: Skill uses undeclared permission

- **WHEN** a skill with `permissions: []` attempts to execute a bash command
- **THEN** the operation SHALL fail with error "Permission denied: skill does not have 'bash' permission"

#### Scenario: Built-in tools bypass permission check

- **WHEN** the built-in `bash` tool is invoked
- **THEN** permission checking SHALL be skipped (built-in tools are trusted)

### Requirement: Audit logging of skill executions

Every skill tool execution SHALL be logged in the `security_events` table with event type `skill_execution`, including skill name, tool name, permission used, and execution result.

#### Scenario: Successful skill execution logged

- **WHEN** the `web_search` tool from skill "web-search" successfully executes
- **THEN** a `security_events` entry SHALL be created with `event_type: "skill_execution"`, `details: { skill: "web-search", tool: "web_search", permission: "network", status: "success" }`

#### Scenario: Permission denied logged

- **WHEN** a skill attempts to use an undeclared permission and is blocked
- **THEN** a `security_events` entry SHALL be created with `event_type: "skill_permission_denied"`, `details: { skill: "...", permission: "...", attempted_action: "..." }`

#### Scenario: Skill error logged

- **WHEN** a skill tool throws an uncaught exception
- **THEN** a `security_events` entry SHALL be created with `event_type: "skill_error"`, `details: { skill: "...", tool: "...", error: "..." }`
