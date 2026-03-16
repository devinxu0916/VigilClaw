# Tasks: Apple Container Runtime Support

## Group 1: 基础设施

- [ ] 1.1 Create IRunner interface in `src/runner-types.ts`
  - Define interface with `runTask()`, `drainAll()`, `ping()` methods
  - Export type definitions for QueuedTask and TaskResult

- [ ] 1.2 Refactor ContainerRunner to implement IRunner
  - Rename ContainerRunner to DockerContainerRunner
  - Implement IRunner interface
  - No functionality changes, pure refactor

- [ ] 1.3 Extend Config schema for `container.runtime` field
  - Add `runtime?: 'auto' | 'docker' | 'apple' | 'local'` to DockerConfig
  - Update config.ts Zod schema
  - Default value: `'auto'`

- [ ] 1.4 Add `apple:build` script to package.json
  - Script: `container build -t vigilclaw-agent:latest container/agent-runner/`
  - Keep existing `docker:build` script unchanged

## Group 2: AppleContainerRunner

- [ ] 2.1 Create `src/apple-container-runner.ts` skeleton
  - Class AppleContainerRunner implements IRunner
  - Constructor accepts config, credentialProxy, dataDir
  - Import child_process, promisify execFile

- [ ] 2.2 Implement `ping(): Promise<boolean>`
  - Execute `container system info --output json`
  - Parse JSON output, check for `version` field
  - Return true on success, false on error (catch all exceptions)

- [ ] 2.3 Implement `runTask(task: QueuedTask): Promise<TaskResult>`
  - Prepare IPC directory via prepareIpcDir()
  - Create proxy via credentialProxy.createProxyForTask()
  - Write task input via writeTaskInput()
  - Build container name: `vigilclaw-${task.id.slice(0, 12)}`
  - Build volume binds: IPC (rw), workspace (rw if provided), skills (ro if exists)
  - Set environment: TASK_ID, CREDENTIAL_PROXY_URL with host.container.internal

- [ ] 2.4 Implement container run command construction
  - Base: `container run --detach --name <name>`
  - Add: `--read-only --memory 512m --cpus 1.0`
  - Add: `--tmpfs /tmp:rw,noexec,nosuid,size=100m`
  - Add: `--env TASK_ID=<id> --env CREDENTIAL_PROXY_URL=<url>`
  - Add: volume mounts via `--volume` flags
  - Image: `vigilclaw-agent:latest`
  - Cmd: `node /app/index.js`

- [ ] 2.5 Implement IPC result waiting
  - Use Promise.race between container wait and waitForResult()
  - On container exit: fetch logs, check exit code, read IPC result
  - On IPC result: return TaskResult immediately

- [ ] 2.6 Implement timeout enforcement
  - Wrap Promise.race with timeout promise (config.taskTimeout)
  - On timeout: execute `container stop <id> -t 3`
  - Then execute `container rm <id>`
  - Throw timeout error

- [ ] 2.7 Implement error handling and cleanup
  - try/catch around container run
  - On error: fetch logs via `container logs <id>`, log last 1000 chars
  - finally block: stop container, remove container, destroy proxy, cleanup IPC dir
  - Handle cleanup failures gracefully (catch and log, don't re-throw)

- [ ] 2.8 Implement `drainAll(timeoutMs: number): Promise<void>`
  - Execute `container ps --all --filter name=vigilclaw- --format json`
  - Parse JSON array of containers
  - Stop each via `container stop <id> -t <timeout_seconds>`
  - Use Promise.allSettled to avoid partial failures

## Group 3: 集成

- [ ] 3.1 Update `src/index.ts` runtime auto-detection logic
  - Detect platform via `process.platform`
  - Implement detection priority: Apple Container → Docker → Local
  - On auto mode + macOS: try AppleContainerRunner.ping()
  - If Apple fails: try DockerContainerRunner.ping()
  - If Docker fails: use LocalRunner
  - On explicit runtime: only try specified runner, throw if unavailable
  - Log runtime selection with reason

- [ ] 3.2 Update `src/credential-proxy.ts` for host access hostname
  - No code changes needed (hostname passed from runner)
  - Verify that proxy listens on 0.0.0.0 (all interfaces)
  - Add comment documenting host.container.internal usage

- [ ] 3.3 Update health endpoint to report runtime type
  - Add `runtime: 'docker' | 'apple' | 'local'` to health response
  - Determine from selected runner instance type

## Group 4: 测试与验证

- [ ] 4.1 Unit tests for AppleContainerRunner
  - Mock child_process.execFile via vi.mock()
  - Test ping() success and failure cases
  - Test runTask() command construction (verify flags, env, volumes)
  - Test timeout enforcement
  - Test error handling and cleanup
  - Test drainAll() with multiple containers

- [ ] 4.2 Run `pnpm typecheck`
  - Fix any TypeScript errors
  - Ensure strict mode compliance

- [ ] 4.3 Run `pnpm test`
  - All unit tests pass
  - Coverage thresholds met (80%+ statements/functions/lines, 75%+ branches)

- [ ] 4.4 Run `pnpm build`
  - Successful compilation to dist/
  - No build warnings

- [ ] 4.5 Build Apple Container image (manual on macOS 26)
  - Run `pnpm apple:build`
  - Verify image tagged as vigilclaw-agent:latest
  - Inspect image: `container image inspect vigilclaw-agent:latest`

- [ ] 4.6 E2E test: Run task in Apple Container
  - Start VigilClaw with `container.runtime=apple`
  - Send message to bot
  - Verify container created, task executed, response returned
  - Check logs for runtime selection

- [ ] 4.7 E2E test: Auto-detection fallback chain
  - Test on macOS 26: verify Apple Container selected
  - Rename container CLI temporarily: verify Docker fallback
  - Stop Docker: verify Local fallback
  - Restore environment

- [ ] 4.8 Update documentation
  - Update ROADMAP.md: mark apple-container-support as completed
  - Update CHANGELOG.md: add entry for new runtime support
  - Update README.md: document container.runtime config option
  - Add section on Apple Container requirements and benefits
