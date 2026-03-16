# Design: Apple Container Runtime Support

## Context

VigilClaw runs agents in Docker containers using the `dockerode` SDK. Docker Desktop on macOS requires a full Linux VM (2-4GB memory overhead, 1.5-3s container startup) and is commercial software (paid for enterprise users).

Apple introduced native containerization at WWDC 2025 (macOS 26 "Tahoe"), offering lightweight VM-based containers with 200-400ms startup time, MB-level memory overhead, and free licensing. The `container` CLI provides OCI image compatibility, Dockerfile builds, and full feature parity with Docker on macOS 26+.

This change adds Apple Container as a runtime alternative, with stronger VM-level isolation than Docker's namespace isolation.

## Goals

- Apple Container runner as drop-in alternative to Docker runner
- Auto-detection: prefer Apple Container on macOS 26+, fall back to Docker, then LocalRunner
- Same security constraints as Docker (read-only rootfs, resource limits, IPC protocol)
- Use same OCI image for both runtimes (Dockerfile compatibility)

## Non-Goals

- Replace Docker entirely (both remain available as options)
- Support macOS 15 (limited Apple Container features)
- Support Linux or Windows hosts (Apple Container is macOS-only)

## Architecture Decisions

### D1: CLI invocation vs Swift API

**Choice**: `container` CLI via `child_process.execFile`

**Alternatives**:

1. Swift Containerization framework (requires Swift bridge, native module compilation, FFI complexity)
2. Subprocess shell execution (unsafe, harder to control)

**Reasoning**:

- CLI is stable public interface with semantic versioning guarantees
- JSON output format for structured parsing
- Zero native dependencies (no build toolchain required)
- Simple error handling via exit codes + stderr
- Alternative (Swift API) would require Swift/Objective-C bridge, significantly increasing complexity and introducing native build dependencies

### D2: IRunner interface abstraction

**Choice**: Extract common interface from ContainerRunner, implement in both runners

```typescript
interface IRunner {
  runTask(task: QueuedTask): Promise<TaskResult>;
  drainAll(timeoutMs: number): Promise<void>;
  ping(): Promise<boolean>;
}
```

- `DockerContainerRunner` (refactored from current ContainerRunner)
- `AppleContainerRunner` (new implementation)
- Selection logic in `src/index.ts` based on runtime config and availability

**Alternatives**:

1. Inheritance (DockerRunner extends BaseRunner) — rejected due to tight coupling
2. No abstraction (if/else branching) — rejected for maintainability

**Reasoning**:

- Clean separation of concerns
- Each runner owns its lifecycle management
- Easy to add future runtimes (Podman, etc.)
- Type-safe polymorphism

### D3: Runtime selection and auto-detection

**Choice**: Add `container.runtime` config with values: `auto | docker | apple | local`

Auto-detection priority:

1. Apple Container: `container system info` succeeds (macOS 26+, CLI installed)
2. Docker: `docker ping` succeeds
3. Local: fallback (no isolation)

**Alternatives**:

1. Only auto-detect (no explicit choice) — rejected for flexibility
2. Binary docker/local toggle — rejected for future extensibility

**Reasoning**:

- On macOS 26+ with Apple Container available, prefer it for lower overhead
- Developers can force Docker if needed (cross-platform testing)
- Graceful degradation for compatibility

### D4: Image building

**Choice**: `container build` with same Dockerfile (OCI compatible)

- Add `pnpm apple:build` script: `container build -t vigilclaw-agent:latest container/agent-runner/`
- Keep existing `pnpm docker:build`
- Both use identical `container/agent-runner/Dockerfile`

**Alternatives**:

1. Separate Dockerfiles — rejected (unnecessary duplication, OCI standard guarantees compatibility)
2. Build-time auto-detection — rejected (explicit commands clearer)

**Reasoning**:

- Apple Container supports standard Dockerfile syntax
- OCI image format is portable
- Users choose runtime at build time based on their environment

### D5: Network and host access

**Difference**:

- Docker: `host.docker.internal` resolves to host machine
- Apple Container: `host.container.internal` resolves to host machine

**Choice**: Pass correct hostname based on runtime type to CredentialProxy

```typescript
// In AppleContainerRunner
const proxyUrl = `http://host.container.internal:${proxyPort}`;

// In ContainerRunner (Docker)
const proxyUrl = `http://host.docker.internal:${proxyPort}`;
```

**Reasoning**:

- Both provide host network access, just different DNS names
- No credential-proxy code changes needed (hostname passed from runner)

### D6: Security constraints parity

| Feature           | Docker                                          | Apple Container                           | Parity                           |
| ----------------- | ----------------------------------------------- | ----------------------------------------- | -------------------------------- |
| Read-only rootfs  | `HostConfig.ReadonlyRootfs: true`               | `--read-only`                             | ✅ Yes                           |
| tmpfs /tmp        | `Tmpfs: {'/tmp': 'rw,noexec,nosuid,size=100m'}` | `--tmpfs /tmp:rw,noexec,nosuid,size=100m` | ✅ Yes                           |
| Memory limit      | `Memory: 512 * 1024 * 1024`                     | `--memory 512m`                           | ✅ Yes                           |
| CPU limit         | `CpuQuota/CpuPeriod`                            | `--cpus 1.0`                              | ✅ Yes                           |
| PID limit         | `PidsLimit: 100`                                | N/A                                       | ⚠️ No (VM isolation compensates) |
| CAP_DROP ALL      | `CapDrop: ['ALL']`                              | N/A                                       | ⚠️ No (VM isolation compensates) |
| no-new-privileges | `SecurityOpt: ['no-new-privileges:true']`       | N/A                                       | ⚠️ No (VM isolation compensates) |
| Seccomp           | `SecurityOpt: ['seccomp=...']`                  | N/A                                       | ⚠️ No (VM isolation compensates) |

**Reasoning**:

- Apple Container uses VM-level isolation (each container = independent lightweight VM)
- VM boundary stronger than Linux namespaces + capabilities
- Missing Linux-specific security features (capabilities, seccomp) acceptable trade-off
- Memory/CPU/filesystem restrictions still enforced

### D7: Container lifecycle management

**Choice**: Mirror Docker's create → start → wait pattern using CLI commands

```bash
# Create (not supported, use single-step run)
container run --name vigilclaw-xxx --detach [flags] vigilclaw-agent:latest

# Wait
container wait vigilclaw-xxx

# Logs
container logs vigilclaw-xxx

# Stop
container stop vigilclaw-xxx

# Remove
container rm vigilclaw-xxx
```

**Alternatives**:

1. Use `container run` without `--detach` (blocking) — rejected for control flow consistency
2. Skip explicit removal (rely on auto-removal) — rejected for cleanup guarantees

**Reasoning**:

- Detached mode allows parallel wait + IPC result monitoring
- Explicit lifecycle steps match Docker implementation for maintainability
- Cleanup guarantees (even on errors) via try/finally

## Risks and Mitigations

| Risk                          | Impact | Mitigation                                                              |
| ----------------------------- | ------ | ----------------------------------------------------------------------- |
| `container` CLI not installed | High   | Ping check fails, fall back to Docker or Local                          |
| CLI output format changes     | Medium | Version-check on startup, defensive JSON parsing with schema validation |
| macOS 26 not adopted widely   | Low    | Docker remains default, Apple Container is opt-in optimization          |
| Volume mounting quirks        | Medium | Test thoroughly, document differences if found                          |
| Anonymous volume cleanup      | Low    | Explicit removal in finally block                                       |

## Testing Strategy

1. Unit tests with mocked `child_process.execFile` (verify CLI command construction)
2. Integration tests on macOS 26 (actual container lifecycle)
3. Auto-detection flow: AppleContainer → Docker → Local
4. Security constraint enforcement (read-only rootfs, memory limits)
5. IPC protocol compatibility (task input/output)
6. Error handling (container crashes, timeouts, CLI errors)

## Rollout Plan

1. Phase 1: IRunner interface extraction (non-breaking refactor)
2. Phase 2: AppleContainerRunner implementation (feature flag: `container.runtime=apple`)
3. Phase 3: Auto-detection logic (default remains Docker for stability)
4. Phase 4: Documentation + macOS 26 testing
5. Phase 5: Switch default to `auto` after validation period

## Alternatives Considered

### Alternative A: Podman support instead

- Rejected: Podman on macOS also requires VM (via podman-machine), no clear advantage over Docker
- Apple Container has native integration and lower overhead

### Alternative B: Firecracker microVMs

- Rejected: Firecracker is Linux-only, requires KVM, not suitable for macOS

### Alternative C: Wait for Docker improvement

- Rejected: Docker Desktop architecture inherently requires VM, unlikely to match native solution

## Dependencies

- macOS 26+ with Apple Container CLI installed
- Same container/agent-runner image (OCI compatible)
- No new Node.js dependencies (uses built-in `child_process`)

## Metrics

- Container startup time: expect 3-5x improvement on macOS (1.5s → 300ms)
- Memory overhead: expect 10-20x improvement (2GB → 100-200MB)
- Runtime selection: track which runtime is used (Docker vs Apple vs Local)
