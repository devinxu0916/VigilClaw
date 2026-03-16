## Purpose

Skill registry manages installation, versioning, and lifecycle of third-party tools. Skills are stored in SQLite, validated on install, and can be enabled/disabled without uninstallation.

## ADDED Requirements

### Requirement: Skill manifest validation

The system SHALL validate skill manifests against a JSON schema before installation. Required fields: `name`, `version`, `description`, `author`, `permissions`, `tools`. Version MUST follow semver format.

#### Scenario: Valid manifest

- **WHEN** a manifest has all required fields and version is "1.0.0"
- **THEN** validation SHALL pass

#### Scenario: Missing required field

- **WHEN** a manifest lacks the `name` field
- **THEN** validation SHALL fail with error "Missing required field: name"

#### Scenario: Invalid version format

- **WHEN** a manifest has version "1.0" (not semver)
- **THEN** validation SHALL fail with error "Invalid version format, must be semver"

### Requirement: Skill installation from local path

The system SHALL support installing a skill from a local directory path. The installation SHALL copy the skill directory to `~/.config/vigilclaw/skills/<name>/`, validate the manifest, and register the skill in the database.

#### Scenario: Install from valid local path

- **WHEN** `/skill install /path/to/web-search` is invoked and the path contains valid `skill.json` and `index.js`
- **THEN** the system SHALL copy files to `~/.config/vigilclaw/skills/web-search/` and insert a row in the `skills` table

#### Scenario: Path does not exist

- **WHEN** `/skill install /nonexistent/path` is invoked
- **THEN** the system SHALL fail with error "Path does not exist"

#### Scenario: Missing index.js

- **WHEN** the skill directory contains `skill.json` but no `index.js`
- **THEN** the system SHALL fail with error "Missing index.js entry point"

### Requirement: Skill installation from Git URL

The system SHALL support installing a skill from a Git repository URL. The installation SHALL clone the repository to a temporary directory, validate the manifest, copy to the skills directory, and register in the database.

#### Scenario: Install from Git URL

- **WHEN** `/skill install https://github.com/user/web-search.git` is invoked and the repo contains valid manifest and entry point
- **THEN** the system SHALL clone, validate, copy to `~/.config/vigilclaw/skills/web-search/`, and register in DB

#### Scenario: Clone failure

- **WHEN** the Git URL is invalid or inaccessible
- **THEN** the system SHALL fail with error "Failed to clone repository"

#### Scenario: Install specific version tag

- **WHEN** `/skill install https://github.com/user/web-search.git@v1.2.0` is invoked
- **THEN** the system SHALL check out the `v1.2.0` tag before copying

### Requirement: Skill removal

The system SHALL support uninstalling a skill, which deletes the skill directory from the filesystem and removes the corresponding row from the `skills` table.

#### Scenario: Remove installed skill

- **WHEN** `/skill remove web-search` is invoked and the skill exists
- **THEN** the system SHALL delete `~/.config/vigilclaw/skills/web-search/` and remove the DB entry

#### Scenario: Remove nonexistent skill

- **WHEN** `/skill remove nonexistent` is invoked
- **THEN** the system SHALL fail with error "Skill not found: nonexistent"

### Requirement: Skill versioning

The system SHALL support installing multiple versions of the same skill by appending version suffix to the directory name. Upgrade and downgrade SHALL replace the existing installation.

#### Scenario: Upgrade to newer version

- **WHEN** skill `web-search@1.0.0` is installed and `/skill install /path/to/web-search@2.0.0` is invoked
- **THEN** the system SHALL prompt "Upgrade web-search from 1.0.0 to 2.0.0?" and replace the installation on confirmation

#### Scenario: Downgrade to older version

- **WHEN** skill `web-search@2.0.0` is installed and `/skill install /path/to/web-search@1.5.0` is invoked
- **THEN** the system SHALL prompt "Downgrade web-search from 2.0.0 to 1.5.0?" and replace on confirmation

#### Scenario: Same version reinstall

- **WHEN** skill `web-search@1.0.0` is already installed and the same version is installed again
- **THEN** the system SHALL prompt "web-search@1.0.0 is already installed. Reinstall?" and replace on confirmation

### Requirement: Skill enable/disable toggle

The system SHALL support enabling and disabling skills without uninstalling them. Disabled skills remain in the database and filesystem but are not loaded into containers.

#### Scenario: Disable a skill

- **WHEN** `/skill disable web-search` is invoked and the skill is enabled
- **THEN** the system SHALL set `enabled=0` in the `skills` table and confirm "Skill web-search disabled"

#### Scenario: Enable a skill

- **WHEN** `/skill enable web-search` is invoked and the skill is disabled
- **THEN** the system SHALL set `enabled=1` in the `skills` table and confirm "Skill web-search enabled"

#### Scenario: Disabled skill not loaded

- **WHEN** a task is created and a skill is disabled
- **THEN** the disabled skill SHALL NOT be included in `TaskInput.skills`

### Requirement: Name conflict detection

The system SHALL detect naming conflicts between skill tool names and built-in tools (bash, read, write, edit), as well as conflicts with already-installed skills.

#### Scenario: Conflict with built-in tool

- **WHEN** a skill manifest declares a tool named "bash"
- **THEN** installation SHALL fail with error "Tool name 'bash' conflicts with built-in tool"

#### Scenario: Conflict with existing skill

- **WHEN** skill A is installed with tool "search" and skill B declares a tool named "search"
- **THEN** installation of skill B SHALL fail with error "Tool name 'search' conflicts with skill A"

#### Scenario: No conflict

- **WHEN** a skill declares tools "web_search" and "summarize" and no conflicts exist
- **THEN** installation SHALL proceed

### Requirement: Database schema for skills table

The system SHALL create a `skills` table in SQLite with the following schema during database migration v3:

```sql
CREATE TABLE skills (
  name        TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  manifest    TEXT NOT NULL,
  code_path   TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  installed_by TEXT NOT NULL,
  installed_at TEXT DEFAULT (datetime('now'))
);
```

#### Scenario: Migration v3 creates skills table

- **WHEN** the database schema version is less than 3 and the application starts
- **THEN** migration v3 SHALL execute and create the `skills` table

#### Scenario: Existing v3 database

- **WHEN** the database schema version is already 3 or higher
- **THEN** migration v3 SHALL be skipped
