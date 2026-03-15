## ADDED Requirements

### Requirement: Task complexity classification

The system SHALL classify each incoming task as `simple` or `complex` based on the user's message characteristics.

#### Scenario: Simple task classification

- **WHEN** the user's message is less than 500 characters and no tool usage is anticipated
- **THEN** the system SHALL classify the task as `simple`

#### Scenario: Complex task classification

- **WHEN** the user's message is 500+ characters, or contains code blocks, or requires tool usage
- **THEN** the system SHALL classify the task as `complex`

### Requirement: Model routing by complexity

The system SHALL route tasks to different models based on their complexity classification, using the user's configured model tiers.

#### Scenario: Simple task routing

- **WHEN** a task is classified as `simple` and the user has a `simple` model configured
- **THEN** the system SHALL use the `simple` model (e.g., `claude:claude-haiku-3-5-20250929` or `openai:gpt-4o-mini`)

#### Scenario: Complex task routing

- **WHEN** a task is classified as `complex`
- **THEN** the system SHALL use the user's primary model (e.g., `claude:claude-sonnet-4-5-20250929` or `openai:gpt-4o`)

#### Scenario: User override

- **WHEN** the user has explicitly set a model via `/model` command
- **THEN** the system SHALL always use that model regardless of routing classification

### Requirement: Routing configuration

The system SHALL support configuring model routing tiers through a `routing` config section.

#### Scenario: Default routing config

- **WHEN** no routing config is specified
- **THEN** the system SHALL use the default provider's cheapest model for simple tasks and the default model for complex tasks

#### Scenario: Custom routing config

- **WHEN** config specifies `routing.simple: openai:gpt-4o-mini` and `routing.complex: openai:gpt-4o`
- **THEN** the system SHALL route tasks accordingly

### Requirement: Routing transparency

The system SHALL log the routing decision (original model, routed model, classification) for cost analysis.

#### Scenario: Routing logged

- **WHEN** a task is routed from the user's default model to a simpler model
- **THEN** the system SHALL log the routing decision at info level including the classification reason
