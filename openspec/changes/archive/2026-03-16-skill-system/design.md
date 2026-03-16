## Context

VigilClaw 当前工具系统：4 个内置工具（bash/read/write/edit），硬编码在 `router.ts`（tool 名字符串数组）和 `container/agent-runner/src/tools/index.ts`（ALL_TOOLS 工厂字典）。工具在容器内执行，通过 IPC 传入 `TaskInput.tools: string[]`，容器内 `createTools(names)` 实例化。

Skill 系统要在此基础上扩展，核心约束：

- 容器内执行（复用现有安全模型：read-only rootfs, CAP_DROP ALL, no-new-privileges）
- Skill 代码通过卷挂载注入（不重建镜像）
- 声明式权限模型
- 无新生产依赖

## Goals / Non-Goals

**Goals:**

- 用户可通过 `/skill install` 安装 Skill（本地路径或 Git URL）
- Skill 自动加入 Agent 的可用工具列表，LLM 可在 ReAct 循环中调用
- Skill manifest 声明权限，安装时用户确认
- Skill 版本管理（安装特定版本，更新，回滚）
- 内置工具（bash/read/write/edit）保持不变，Skill 是额外扩展

**Non-Goals:**

- Skill 市场/注册中心（后续阶段）
- MCP Server 模式（后续阶段，当前复用容器内直接执行）
- Skill 间依赖管理
- Skill 运行时动态加载/卸载（安装后需重启生效）
- 本地模式下的 Skill 支持（仅容器模式）

## Decisions

### D1: Skill 代码格式 — 单 JS 文件 + manifest

**选择**: 每个 Skill 是一个目录，包含 `skill.json`（manifest）和 `index.js`（入口）

```
~/.config/vigilclaw/skills/
├── web-search/
│   ├── skill.json        # Manifest
│   └── index.js          # 入口（编译后的 JS，容器内直接 require）
└── code-review/
    ├── skill.json
    └── index.js
```

**替代方案**:

- npm 包格式：过重，需要 node_modules
- TypeScript 源码：容器内需要编译，增加复杂度
- WASM 模块：最安全但生态不成熟

**理由**: 单 JS 文件最简单，容器内 `require()` 直接加载。Skill 开发者用 TypeScript 写、本地编译后发布 JS。

### D2: Manifest 规范

```json
{
  "name": "web-search",
  "version": "1.0.0",
  "description": "Search the web using DuckDuckGo",
  "author": "vigilclaw-community",
  "permissions": ["network"],
  "tools": [
    {
      "name": "web_search",
      "description": "Search the web for information",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

**权限类型**:
| 权限 | 说明 |
|------|------|
| `bash` | 可执行 shell 命令 |
| `read` | 可读取文件 |
| `write` | 可写入文件 |
| `network` | 可发起网络请求 |

### D3: 容器内加载机制

**选择**: Skill 目录以只读卷挂载到容器 `/skills/`，容器内 `createTools()` 扫描 `/skills/*/index.js` 动态加载

```
容器卷挂载:
  host: ~/.config/vigilclaw/skills/ → container: /skills/:ro
```

容器内加载逻辑:

```typescript
const ALL_TOOLS = { bash: () => new BashTool(), ... };

function loadSkillTools(skillNames: string[]): Tool[] {
  for (const name of skillNames) {
    const manifest = JSON.parse(fs.readFileSync(`/skills/${name}/skill.json`));
    const module = require(`/skills/${name}/index.js`);
    // module.default 或 module.createTool() 返回 Tool 实例
  }
}
```

**理由**: 只读挂载保持容器安全模型不变。不需要重建镜像。

### D4: IPC 协议扩展

**选择**: TaskInput 新增 `skills: SkillInfo[]` 字段

```typescript
interface SkillInfo {
  name: string;
  version: string;
  tools: Array<{ name: string; description: string; input_schema: object }>;
}

interface TaskInput {
  // 现有字段...
  tools: string[]; // 内置工具（不变）
  skills: SkillInfo[]; // Skill 工具定义
}
```

**理由**: 向后兼容（skills 字段可选），Skill 的工具定义在 IPC 中传递（容器内不需要读 manifest，直接用传入的定义）。

### D5: /skill 命令设计

```
/skill list                        — 列出已安装 Skill
/skill install <path-or-git-url>   — 安装 Skill
/skill remove <name>               — 卸载 Skill
/skill enable <name>               — 启用
/skill disable <name>              — 禁用
/skill info <name>                 — 查看 Skill 详情和权限
```

### D6: Skill 存储 — SQLite skills 表

```sql
CREATE TABLE skills (
  name        TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  manifest    TEXT NOT NULL,      -- JSON
  code_path   TEXT NOT NULL,      -- 文件路径
  enabled     INTEGER DEFAULT 1,
  installed_by TEXT NOT NULL,
  installed_at TEXT DEFAULT (datetime('now'))
);
```

### D7: Skill 与内置工具的关系

**选择**: Skill 工具和内置工具在 ReAct 循环中平等对待。都作为 `Tool[]` 传给 LLM。

Skill 工具名必须不与内置工具冲突（安装时校验）。

## Risks / Trade-offs

**[恶意 Skill 代码]** → 容器沙箱隔离（read-only rootfs, 无 root, 5 分钟超时）；权限声明让用户知道 Skill 需要什么能力；后续可加代码签名

**[Skill 加载失败阻塞 Agent]** → 加载错误被 catch，跳过失败的 Skill，只记录 warning，其余工具正常使用

**[Skill 工具名冲突]** → 安装时校验不与内置工具和已安装 Skill 冲突

**[容器卷挂载增加攻击面]** → 只读挂载 + 路径校验（mount-security.ts 已有敏感路径拦截）
