## Why

当前 VigilClaw 的工具系统是硬编码的 4 个内置工具（bash/read/write/edit），用户无法扩展 Agent 能力。所有工具定义在容器镜像内，新增工具需要重新编译镜像。ROADMAP P2 将 Skill 系统列为核心功能：**注册表 + 版本管理 + 安全审核**。

Skill 系统让用户可以安装第三方工具（如 web-search、code-review、image-gen），Agent 在 ReAct 循环中像使用内置工具一样使用它们，同时保持容器隔离的安全模型。

## What Changes

- 新增 **Skill Manifest 规范** (`skill.json`)：元数据、权限声明、入口定义、schema 版本
- 新增 **Skill Registry** (`src/skill-registry.ts`)：SQLite 存储已安装 Skill，CRUD 操作，版本管理
- 新增 **Skill Loader** (`src/skill-loader.ts`)：从文件系统加载 Skill 代码，校验 manifest，注入容器
- 新增 **Skill 权限引擎** (`src/skill-permissions.ts`)：基于 manifest 的声明式权限检查
- 修改 **容器工具注册**：`container/agent-runner/src/tools/index.ts` 支持动态加载 Skill 工具
- 修改 **容器镜像构建**：Skill 代码通过卷挂载注入容器（不重建镜像）
- 修改 **IPC 协议**：TaskInput 扩展 `skills` 字段，携带 Skill 定义和代码路径
- 修改 **Router**：新增 `/skill install`、`/skill list`、`/skill remove` 命令
- 新增 **DB 迁移 v3**：`skills` 表（id, name, version, manifest, code_path, installed_at, enabled）
- 新增 **内置 Skill 示例**：`web-search`（演示 Skill 开发模式）

## Capabilities

### New Capabilities

- `skill-registry`: Skill 安装/卸载/版本管理/启用禁用
- `skill-execution`: 容器内动态加载和执行 Skill 工具
- `skill-permissions`: 声明式权限模型（安装时审核，运行时检查）
- `skill-management-commands`: Telegram 命令管理 Skill（/skill install/list/remove/enable/disable）

### Modified Capabilities

- `context-compression`: 无变化
- `persistent-memory`: 无变化
- `multi-provider`: 无变化

## Impact

- **新增文件**: 4 个宿主机模块 + 容器内 Skill 加载器 + 1 个示例 Skill
- **修改文件**: `container/agent-runner/src/tools/index.ts`（动态加载）、`src/types.ts`（TaskInput.skills）、`src/router.ts`（/skill 命令）、`src/container-runner.ts`（Skill 卷挂载）、`src/db.ts`（迁移 v3 + DAL）
- **新增依赖**: 无（纯 TypeScript 实现）
- **数据库**: 迁移 v3，新增 `skills` 表
- **容器安全**: Skill 代码以只读卷挂载，沙箱约束不变（CAP_DROP ALL, read-only rootfs, no-new-privileges）
