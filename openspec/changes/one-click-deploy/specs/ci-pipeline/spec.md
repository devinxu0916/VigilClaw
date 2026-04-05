## ADDED Requirements

### Requirement: CI 工作流
`.github/workflows/ci.yml` SHALL 在每次 push 和 PR 时自动运行代码质量检查。

#### Scenario: 触发条件
- **WHEN** 代码 push 到 `master` 分支或创建/更新 PR 到 `master`
- **THEN** CI 工作流自动触发

#### Scenario: 代码质量检查
- **WHEN** CI 触发
- **THEN** 依次执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`，任一步骤失败则整个工作流失败

#### Scenario: Docker 镜像构建验证
- **WHEN** 代码质量检查通过
- **THEN** 构建宿主进程和 Agent Runner 的 Docker 镜像，验证构建成功（不推送到 registry）

#### Scenario: Node.js 版本
- **WHEN** CI 运行
- **THEN** 使用 Node.js 22 运行所有检查

### Requirement: 依赖缓存
CI 工作流 SHALL 缓存 pnpm store 以加速构建。

#### Scenario: 缓存命中
- **WHEN** `pnpm-lock.yaml` 未变更
- **THEN** 从缓存恢复依赖，跳过下载

#### Scenario: 缓存失效
- **WHEN** `pnpm-lock.yaml` 有变更
- **THEN** 重新安装依赖并更新缓存
