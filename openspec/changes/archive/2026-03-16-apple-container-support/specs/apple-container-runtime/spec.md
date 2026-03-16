# Specification: Apple Container Runtime

## ADDED Requirements

### R1: Apple Container Detection

System SHALL detect Apple Container availability via `container system info` command.

**WHEN** system initializes on macOS  
**THEN** system SHALL execute `container system info` and parse JSON output  
**AND** detection succeeds if command exits with code 0 and contains valid JSON with `version` field

**WHEN** `container` CLI is not installed  
**THEN** detection SHALL fail gracefully without throwing exceptions  
**AND** system SHALL proceed with Docker or Local fallback

**WHEN** macOS version is less than 26  
**THEN** `container system info` SHALL fail  
**AND** system SHALL fall back to Docker detection

---

### R2: Runtime Configuration

System SHALL support `container.runtime` configuration field with values `auto | docker | apple | local`.

**WHEN** `container.runtime` is set to `docker`  
**THEN** system SHALL only attempt Docker runtime  
**AND** system SHALL skip Apple Container detection

**WHEN** `container.runtime` is set to `apple`  
**THEN** system SHALL only attempt Apple Container runtime  
**AND** system SHALL fail if Apple Container is unavailable

**WHEN** `container.runtime` is set to `local`  
**THEN** system SHALL use LocalRunner without attempting container runtimes

**WHEN** `container.runtime` is set to `auto`  
**THEN** system SHALL follow auto-detection priority (see R3)

**WHEN** `container.runtime` is invalid or missing  
**THEN** system SHALL default to `auto`

---

### R3: Auto-Detection Priority

In `auto` mode, system SHALL try runtimes in priority order: Apple Container → Docker → Local.

**WHEN** runtime selection starts in `auto` mode on macOS 26+  
**THEN** system SHALL first check Apple Container availability via ping  
**AND** if available, use AppleContainerRunner  
**AND** if unavailable, proceed to Docker check

**WHEN** Apple Container is unavailable  
**THEN** system SHALL check Docker availability via ping  
**AND** if available, use DockerContainerRunner  
**AND** if unavailable, use LocalRunner

**WHEN** runtime selection occurs on non-macOS platform  
**THEN** system SHALL skip Apple Container detection  
**AND** proceed directly to Docker check

---

### R4: Container Lifecycle Management

AppleContainerRunner SHALL manage container lifecycle: run → wait → logs → stop → remove.

**WHEN** task is submitted to AppleContainerRunner  
**THEN** system SHALL execute `container run --detach` with all required flags  
**AND** capture container ID from stdout

**WHEN** container starts successfully  
**THEN** system SHALL monitor both `container wait <id>` and IPC result file  
**AND** return result from whichever completes first

**WHEN** container exits with code 0  
**THEN** system SHALL read result from IPC directory  
**AND** return TaskResult to caller

**WHEN** container exits with non-zero code  
**THEN** system SHALL fetch logs via `container logs <id>`  
**AND** throw error with exit code and last 500 characters of logs

**WHEN** task completes or fails  
**THEN** system SHALL execute `container stop <id>` with timeout  
**AND** execute `container rm <id>` for cleanup

---

### R5: OCI Image Compatibility

System SHALL use identical Dockerfile for both Docker and Apple Container builds.

**WHEN** developer runs `pnpm docker:build`  
**THEN** system SHALL build image using `docker build`  
**AND** tag as `vigilclaw-agent:latest`

**WHEN** developer runs `pnpm apple:build`  
**THEN** system SHALL build image using `container build`  
**AND** tag as `vigilclaw-agent:latest`  
**AND** use same `container/agent-runner/Dockerfile`

**WHEN** container runner creates container  
**THEN** both runtimes SHALL reference identical image name  
**AND** container SHALL execute with same entry point (`node /app/index.js`)

---

### R6: Volume Mounting

System SHALL mount IPC directory (rw), workspace (rw), and skills directory (ro) in Apple Container.

**WHEN** AppleContainerRunner prepares volumes for task  
**THEN** IPC directory SHALL be mounted as `/ipc:rw`  
**AND** workspace directory (if provided) SHALL be mounted as `/workspace:rw` after path validation  
**AND** skills directory (if exists) SHALL be mounted as `/skills:ro`

**WHEN** workspace mount path fails validation  
**THEN** system SHALL throw error before container creation

**WHEN** skills directory does not exist  
**THEN** system SHALL skip skills mount without error

---

### R7: Resource Limits

System SHALL enforce memory and CPU limits on Apple Container.

**WHEN** AppleContainerRunner creates container  
**THEN** system SHALL pass `--memory 512m` flag  
**AND** system SHALL pass `--cpus 1.0` flag

**WHEN** container exceeds memory limit  
**THEN** Apple Container SHALL terminate container  
**AND** exit code SHALL be non-zero  
**AND** system SHALL capture termination in logs

**WHEN** resource limit configuration changes  
**THEN** system SHALL apply new limits to new containers  
**AND** existing containers remain unaffected

---

### R8: Credential Proxy Integration

System SHALL pass correct host access hostname to container environment.

**WHEN** AppleContainerRunner creates container  
**THEN** system SHALL set `CREDENTIAL_PROXY_URL` environment variable to `http://host.container.internal:<port>`

**WHEN** DockerContainerRunner creates container  
**THEN** system SHALL set `CREDENTIAL_PROXY_URL` environment variable to `http://host.docker.internal:<port>`

**WHEN** agent inside container makes HTTP request to credential proxy URL  
**THEN** request SHALL successfully reach host process  
**AND** credential proxy SHALL serve API requests

---

### R9: Timeout Enforcement

System SHALL enforce task timeout with container stop and cleanup.

**WHEN** task execution exceeds configured timeout (default 5 minutes)  
**THEN** system SHALL execute `container stop <id>` with 3-second grace period  
**AND** system SHALL execute `container rm <id>` for cleanup  
**AND** throw timeout error to caller

**WHEN** task completes before timeout  
**THEN** timeout SHALL be cancelled  
**AND** normal cleanup flow executes

**WHEN** container stop command fails  
**THEN** system SHALL attempt `container rm --force <id>`  
**AND** log error but not throw exception

---

### R10: Graceful Degradation

If Apple Container is unavailable, system SHALL fall back to Docker or Local.

**WHEN** Apple Container ping fails in `auto` mode  
**THEN** system SHALL log warning with detection failure reason  
**AND** proceed to Docker detection without error

**WHEN** both Apple Container and Docker are unavailable in `auto` mode  
**THEN** system SHALL log info message  
**AND** use LocalRunner

**WHEN** explicit runtime (docker/apple) is unavailable  
**THEN** system SHALL throw configuration error  
**AND** NOT fall back to other runtimes

**WHEN** system is running on non-macOS platform  
**THEN** Apple Container detection SHALL be skipped  
**AND** auto mode SHALL only check Docker → Local
