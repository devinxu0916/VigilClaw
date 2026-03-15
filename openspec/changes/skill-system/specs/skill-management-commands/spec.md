## Purpose

Skill management commands provide Telegram interface for installing, listing, removing, and configuring skills.

## ADDED Requirements

### Requirement: /skill list command

The system SHALL provide a `/skill list` command that displays all installed skills with their status (enabled/disabled), version, and description.

#### Scenario: List installed skills

- **WHEN** `/skill list` is invoked and two skills are installed (one enabled, one disabled)
- **THEN** the system SHALL reply with a formatted list showing skill name, version, status, and description

#### Scenario: No skills installed

- **WHEN** `/skill list` is invoked and no skills are installed
- **THEN** the system SHALL reply "No skills installed. Use /skill install <path-or-url> to add skills."

#### Scenario: List output format

- **WHEN** skill "web-search@1.0.0" (enabled) and "code-review@2.1.0" (disabled) are installed
- **THEN** the output SHALL include:

  ```
  Installed Skills:

  • web-search (v1.0.0) — ENABLED
    Search the web using DuckDuckGo
    Permissions: network

  • code-review (v2.1.0) — DISABLED
    Review code and suggest improvements
    Permissions: read
  ```

### Requirement: /skill install command

The system SHALL provide a `/skill install <path-or-url>` command to install a skill from a local path or Git URL, validate the manifest, confirm permissions, and register in the database.

#### Scenario: Install from local path

- **WHEN** `/skill install /path/to/web-search` is invoked
- **THEN** the system SHALL validate, prompt for permission confirmation, install, and reply "Skill 'web-search' v1.0.0 installed successfully."

#### Scenario: Install from Git URL

- **WHEN** `/skill install https://github.com/user/web-search.git` is invoked
- **THEN** the system SHALL clone, validate, prompt for permissions, install, and reply "Skill 'web-search' v1.0.0 installed successfully."

#### Scenario: Install with version tag

- **WHEN** `/skill install https://github.com/user/web-search.git@v1.2.0` is invoked
- **THEN** the system SHALL check out tag `v1.2.0` before installing

#### Scenario: Install fails validation

- **WHEN** `/skill install /invalid/path` is invoked and validation fails
- **THEN** the system SHALL reply with the validation error message

### Requirement: /skill remove command

The system SHALL provide a `/skill remove <name>` command to uninstall a skill by deleting its files and removing the database entry.

#### Scenario: Remove installed skill

- **WHEN** `/skill remove web-search` is invoked and the skill exists
- **THEN** the system SHALL delete the skill directory, remove the DB entry, and reply "Skill 'web-search' removed successfully."

#### Scenario: Remove nonexistent skill

- **WHEN** `/skill remove nonexistent` is invoked
- **THEN** the system SHALL reply "Skill 'nonexistent' not found."

### Requirement: /skill enable and /skill disable commands

The system SHALL provide `/skill enable <name>` and `/skill disable <name>` commands to toggle skill activation without uninstalling.

#### Scenario: Enable a disabled skill

- **WHEN** `/skill enable web-search` is invoked and the skill is disabled
- **THEN** the system SHALL set `enabled=1` in the DB and reply "Skill 'web-search' enabled."

#### Scenario: Disable an enabled skill

- **WHEN** `/skill disable web-search` is invoked and the skill is enabled
- **THEN** the system SHALL set `enabled=0` in the DB and reply "Skill 'web-search' disabled."

#### Scenario: Enable already enabled skill

- **WHEN** `/skill enable web-search` is invoked and the skill is already enabled
- **THEN** the system SHALL reply "Skill 'web-search' is already enabled."

### Requirement: /skill info command

The system SHALL provide a `/skill info <name>` command to display detailed information about a skill, including version, description, author, permissions, and declared tools.

#### Scenario: Display skill info

- **WHEN** `/skill info web-search` is invoked
- **THEN** the system SHALL reply with:

  ```
  Skill: web-search
  Version: 1.0.0
  Author: vigilclaw-community
  Status: ENABLED
  Description: Search the web using DuckDuckGo

  Permissions: network

  Tools:
    • web_search — Search the web for information
      Input: { query: string }

  Installed: 2026-03-15 10:30:00
  Installed by: user123
  ```

#### Scenario: Info for nonexistent skill

- **WHEN** `/skill info nonexistent` is invoked
- **THEN** the system SHALL reply "Skill 'nonexistent' not found."

### Requirement: Admin-only restriction for skill management

All skill management commands (`/skill install`, `/skill remove`, `/skill enable`, `/skill disable`) SHALL be restricted to admin users only. Non-admin users SHALL receive an error message.

#### Scenario: Admin installs skill

- **WHEN** an admin user invokes `/skill install /path/to/skill`
- **THEN** the installation SHALL proceed

#### Scenario: Non-admin attempts install

- **WHEN** a non-admin user invokes `/skill install /path/to/skill`
- **THEN** the system SHALL reply "Permission denied. Only admins can manage skills."

#### Scenario: Non-admin can list and view info

- **WHEN** a non-admin user invokes `/skill list` or `/skill info web-search`
- **THEN** the commands SHALL execute normally (read-only operations allowed)
