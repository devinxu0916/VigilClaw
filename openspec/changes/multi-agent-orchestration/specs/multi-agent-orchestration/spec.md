## ADDED Requirements

### Requirement: Automatic complexity classification

When orchestration is enabled, the system SHALL decide whether to orchestrate a request using a zero-cost heuristic gate followed, only for candidates that pass the gate, by a Haiku classifier call. Simple messages SHALL bypass the classifier entirely.

#### Scenario: Simple message bypasses classifier

- **WHEN** a short single-intent message like "现在几点？" arrives
- **THEN** the heuristic gate SHALL reject it and the system SHALL run the normal single-agent path without any classifier call

#### Scenario: Compound message is classified

- **WHEN** a long multi-part message like "分别调研 A、B、C 三个库并汇总对比" arrives
- **THEN** the heuristic gate SHALL pass it to the Haiku classifier, which SHALL decide whether to orchestrate

#### Scenario: Classifier cost recorded

- **WHEN** the Haiku classifier is invoked for a task
- **THEN** an `api_calls` record SHALL be inserted with task id `orchestrate-classify:<taskId>`

#### Scenario: Classifier failure degrades to single agent

- **WHEN** the classifier call fails or returns unparseable output
- **THEN** the system SHALL treat the request as non-orchestrated and run the single-agent path

### Requirement: Task decomposition

When a request is classified for orchestration, the system SHALL decompose it into a bounded list of subtasks using the Haiku model, producing structured subtasks `{ id, description, dependsOn[] }`. The number of subtasks SHALL NOT exceed `maxSubtasks` (default 5).

#### Scenario: Decomposition into subtasks

- **WHEN** the goal "调研 A、B、C 三个库的优劣并汇总" is decomposed
- **THEN** the planner SHALL return subtasks such as `t1: 调研 A`, `t2: 调研 B`, `t3: 调研 C` with empty `dependsOn`

#### Scenario: Subtask count capped

- **WHEN** the planner returns more than `maxSubtasks` subtasks
- **THEN** the system SHALL keep only the first `maxSubtasks` subtasks

#### Scenario: Plan cost recorded

- **WHEN** the planner is invoked for a task
- **THEN** an `api_calls` record SHALL be inserted with task id `orchestrate-plan:<taskId>`

#### Scenario: Trivial or invalid plan degrades to single agent

- **WHEN** the planner returns an empty list, a single subtask, or unparseable output
- **THEN** the system SHALL fall back to running the original request as a single-agent task

### Requirement: TaskExecutor abstraction

The Orchestrator SHALL depend on a `TaskExecutor` interface (`execute(input: SubAgentInput): Promise<SubAgentResult>`) to run a single sub-agent, with a default implementation backed by the existing `IRunner`.

#### Scenario: Default executor uses the runner

- **WHEN** a subtask is executed by the default `RunnerTaskExecutor`
- **THEN** it SHALL construct a `QueuedTask` for the subtask and execute it via `IRunner.runTask`, returning the result as a `SubAgentResult`

#### Scenario: Orchestrator is testable with a mock executor

- **WHEN** a mock `TaskExecutor` is injected
- **THEN** the Orchestrator SHALL drive planning, scheduling, and synthesis without requiring a real container runtime

### Requirement: Bounded parallel sub-agent execution

The system SHALL execute subtasks in dependency waves: subtasks whose `dependsOn` are all satisfied run concurrently, bounded by `maxParallel` (default 3). Subtasks SHALL be executed via the `TaskExecutor` directly and SHALL NOT be routed through `GroupQueue`.

#### Scenario: Independent subtasks run in parallel

- **WHEN** three subtasks have empty `dependsOn` and `maxParallel` is 3
- **THEN** the system SHALL execute all three concurrently

#### Scenario: Concurrency bound respected

- **WHEN** five subtasks are independent and `maxParallel` is 3
- **THEN** at most 3 subtasks SHALL run at any moment; the remaining SHALL start as slots free up

#### Scenario: Dependent subtask waits for its dependencies

- **WHEN** subtask `t3` declares `dependsOn: ["t1", "t2"]`
- **THEN** `t3` SHALL NOT start until both `t1` and `t2` have completed, and `t3`'s prompt SHALL include their outputs

#### Scenario: Subtask cost recorded

- **WHEN** a subtask is executed
- **THEN** an `api_calls` record SHALL be inserted with task id `orchestrate-sub:<taskId>:<subId>`

### Requirement: Sub-agent isolation and recursion guard

Each sub-agent SHALL run as an isolated single-agent task with only the base tools (Bash/Read/Write/Edit), without the `system-commands` skill and without the ability to trigger orchestration. A sub-agent's `replyFn` SHALL be a no-op.

#### Scenario: Sub-agent has no system-commands skill

- **WHEN** a subtask `QueuedTask` is constructed
- **THEN** it SHALL NOT include the `system-commands` skill or any orchestration capability

#### Scenario: No recursive orchestration

- **WHEN** a sub-agent runs
- **THEN** it SHALL NOT itself enter the Orchestrator (single-level decomposition only)

#### Scenario: Sub-agent does not reply directly to the user

- **WHEN** a sub-agent produces output
- **THEN** the output SHALL return to the Orchestrator and SHALL NOT be sent to the user via the channel

### Requirement: Result synthesis

After all subtasks complete, the system SHALL synthesize the original goal and all subtask outputs into a single final reply using the user's current model.

#### Scenario: Synthesis combines subtask outputs

- **WHEN** all subtasks for "调研 A、B、C 并汇总对比" have completed
- **THEN** the system SHALL produce one final reply combining their outputs, using the user's model

#### Scenario: Synthesis cost recorded

- **WHEN** synthesis is invoked
- **THEN** an `api_calls` record SHALL be inserted with task id `orchestrate-synth:<taskId>`

#### Scenario: Synthesis failure falls back to concatenation

- **WHEN** the synthesis call fails
- **THEN** the system SHALL return a concatenation of the subtask outputs with a short note, rather than failing the whole task

### Requirement: Cost tracking and budget enforcement

Before starting orchestration, the system SHALL check the user's budget via `CostGuard`. Every LLM call in an orchestration (classify, plan, each subtask, synthesis) SHALL be recorded in `api_calls` and counted toward the user's cost.

#### Scenario: Budget checked before orchestrating

- **WHEN** the user is already over their daily budget
- **THEN** the system SHALL NOT start orchestration and SHALL return the standard budget-exceeded message

#### Scenario: All orchestration calls are billed

- **WHEN** an orchestration runs classify + plan + 3 subtasks + synthesis
- **THEN** 6 `api_calls` records SHALL exist for that task, visible via `/cost`

### Requirement: Orchestration configuration

The system SHALL support an `orchestration` config section with `enabled` (boolean, default true), `maxSubtasks` (number, default 5), and `maxParallel` (number, default 3), overridable via `VIGILCLAW_ORCHESTRATION_ENABLED`, `VIGILCLAW_ORCHESTRATION_MAX_SUBTASKS`, and `VIGILCLAW_ORCHESTRATION_MAX_PARALLEL`.

#### Scenario: Orchestration disabled

- **WHEN** config specifies `orchestration.enabled: false`
- **THEN** every message SHALL run the single-agent path with no classifier call

#### Scenario: Custom parallelism

- **WHEN** config specifies `orchestration.maxParallel: 1`
- **THEN** subtasks within a wave SHALL run one at a time

### Requirement: Graceful degradation

Any failure in the orchestration pipeline (classification, planning, scheduling) SHALL degrade safely: the system SHALL fall back to single-agent execution or a concatenated result, and SHALL NOT crash or leave the user without a reply.

#### Scenario: Single-agent path unchanged when not orchestrating

- **WHEN** a request is not orchestrated
- **THEN** the existing single-agent execution, cost recording, reply, and memory/graph extraction SHALL behave exactly as before

#### Scenario: Progress feedback is optional

- **WHEN** orchestration begins
- **THEN** the system MAY send one interim progress message, but the final synthesized reply SHALL always be sent
