## Why

VigilClaw 当前仅支持 Docker 作为容器运行时。在 macOS 上，Docker Desktop 需要启动一个完整的 Linux VM（2-4GB 内存开销，1.5-3 秒容器启动），且是商业软件（企业用户需付费）。Apple 在 WWDC 2025 推出了原生容器技术（Containerization 框架），基于轻量级 VM，启动时间 200-400ms，内存开销 MB 级，且免费。

macOS 26 (Tahoe) 上 Apple Containers 已支持完整功能：OCI 镜像兼容、Dockerfile 构建、端口映射、卷挂载、资源限制。作为安全优先的项目，Apple Container 的 VM 级隔离（每个容器独立 VM）比 Docker 的 namespace 隔离更强。

## What Changes

- 新增 **IRunner 接口** (`src/runner-types.ts`)：抽象 ContainerRunner 和 AppleContainerRunner 的公共接口
- 新增 **AppleContainerRunner** (`src/apple-container-runner.ts`)：通过 `container` CLI 管理容器生命周期
- 修改 **Runner 选择逻辑** (`src/index.ts`)：优先级 AppleContainer > Docker > LocalRunner
- 修改 **Config 系统**：新增 `container.runtime` 配置（`auto | docker | apple`）
- 新增 **apple-container:build 脚本**：用 `container build` 构建镜像
- 修改 **Credential Proxy**：支持 `host.container.internal`（Apple Container 的宿主访问域名）

## Capabilities

### New Capabilities

- `apple-container-runtime`: macOS 原生容器支持，VM 级隔离，亚秒级启动

### Modified Capabilities

- 无已有 capability 受影响

## Impact

- **新增文件**: `src/runner-types.ts`（接口）、`src/apple-container-runner.ts`（实现）
- **修改文件**: `src/index.ts`（runner 选择）、`src/config.ts`（runtime 配置）、`src/credential-proxy.ts`（host 域名）、`package.json`（build 脚本）
- **新增依赖**: 无（通过 `child_process.execFile` 调用 `container` CLI）
- **系统要求**: macOS 26+ 且 Apple Silicon
- **兼容性**: Docker 模式完全不受影响，Apple Container 是可选的替代方案
