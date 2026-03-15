# AI Agent Skill/Plugin 系统调研

> 日期：2026-03-15 | 项目：VigilClaw Phase 2 Skill 系统设计参考

---

## 一、概述

### 1.1 什么是 AI Agent Skill 系统

AI Agent Skill 系统是一种让 LLM Agent 在运行时动态获取新能力的架构。与传统插件系统的核心区别：

| 维度     | 传统插件       | AI Agent Skill                  |
| -------- | -------------- | ------------------------------- |
| 调用决策 | 硬编码触发条件 | LLM 自主判断何时调用            |
| 输入构造 | 程序化参数拼装 | LLM 从自然语言生成结构化参数    |
| 结果处理 | 固定流程处理   | LLM 解读输出并决定下一步        |
| 编排     | 预定义流程     | ReAct/Chain-of-Thought 动态编排 |

**核心价值**：用户通过安装 Skill 来扩展 Agent 能力，而不需要修改 Agent 代码。

### 1.2 调研范围

本文覆盖以下 5 个业界方案和 4 种沙箱技术：

- OpenAI GPTs / Custom Actions
- LangChain Tools / Toolkits
- AutoGPT Forge 组件架构
- MCP (Model Context Protocol, Anthropic)
- Claude Code Marketplace
- 沙箱：Docker Container / gVisor / Firecracker MicroVM / WebAssembly

---

## 二、业界方案总览

| 方案          | 工具定义               | 执行模型         | 安全边界   | 扩展方式       | 语言      |
| ------------- | ---------------------- | ---------------- | ---------- | -------------- | --------- |
| OpenAI GPTs   | OpenAPI 3.0            | 代理 HTTP 调用   | 服务端代理 | Custom Actions | 无关      |
| LangChain     | Zod Schema + 函数      | 进程内直接调用   | 无隔离     | Toolkit 组合   | TS/Python |
| AutoGPT Forge | Component Protocol     | 组件化自动发现   | 可选沙箱   | 协议驱动       | Python    |
| MCP           | JSON-RPC + JSON Schema | 独立 Server 进程 | 进程隔离   | Server 注册    | TS/Python |
| Claude Code   | SKILL.md + plugin.json | Agent 内执行     | 工作区隔离 | 市场分发       | 无关      |

---

## 三、各方案详细分析

### 3.1 OpenAI GPTs / Custom Actions

#### 架构模型

```
用户 → ChatGPT → Function Calling 决策
                      ↓
              参数生成（自然语言 → JSON）
                      ↓
              OpenAI 服务器代理执行 HTTP 请求
                      ↓
              API 响应 → 自然语言回复 → 用户
```

#### 工具定义格式

采用 OpenAPI 3.0 Schema 作为标准：

```yaml
openapi: 3.0.0
info:
  title: Weather API
  version: 1.0.0

paths:
  /forecast/{city}:
    get:
      operationId: getForecast
      summary: Get weather forecast for a city
      parameters:
        - name: city
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Forecast data
          content:
            application/json:
              schema:
                type: object
                properties:
                  temperature:
                    type: number
                  condition:
                    type: string
```

#### 认证模型

三级认证体系：

| 级别      | 机制                 | 密钥存储          |
| --------- | -------------------- | ----------------- |
| None      | 无认证               | 无                |
| API Key   | Header 或 Query 参数 | OpenAI 服务端加密 |
| OAuth 2.0 | 完整 OAuth 流程      | OpenAI 托管       |

OAuth 配置示例：

```json
{
  "authorization_url": "https://api.example.com/oauth/authorize",
  "token_url": "https://api.example.com/oauth/token",
  "scope": "read write",
  "client_id": "...",
  "client_secret": "..."
}
```

#### 执行流程

1. LLM 决定调用哪个 Action（基于 description）
2. 自然语言 → JSON 参数（基于 schema）
3. OpenAI 服务器代理发起 HTTP 请求（用户看不到 API Key）
4. API 响应返回给 LLM
5. LLM 生成自然语言回复

#### 优缺点

| 优势                           | 劣势                     |
| ------------------------------ | ------------------------ |
| 标准化（OpenAPI 生态庞大）     | 仅支持 HTTP API 调用     |
| 安全（服务端代理，密钥不暴露） | 无本地执行能力           |
| 零代码（配置即可用）           | 延迟高（多一跳网络请求） |
| 生态大（数万 GPTs）            | 闭源、依赖 OpenAI 平台   |

---

### 3.2 LangChain Tools / Toolkits

#### 架构模型

```
Agent
  ├── ToolRegistry
  │     ├── Tool A (Zod schema + execute fn)
  │     ├── Tool B
  │     └── Toolkit C (多个相关 Tool 的集合)
  │
  └── AgentExecutor
        ├── LLM 决策：选择 Tool + 生成参数
        ├── Tool.invoke(args) → 进程内直接调用
        └── 结果 → LLM → 下一步或回复
```

#### 工具定义格式

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const calculatorTool = tool(
  async ({ expression }) => {
    return String(eval(expression));
  },
  {
    name: 'calculator',
    description: 'Evaluate mathematical expressions',
    schema: z.object({
      expression: z.string().describe('Math expression to evaluate'),
    }),
  },
);
```

#### Toolkit 组合模式

```typescript
class DatabaseToolkit {
  constructor(private db: Database) {}

  getTools(): Tool[] {
    return [new QueryTool(this.db), new InsertTool(this.db), new SchemaTool(this.db)];
  }
}

const agent = createAgent({
  tools: [
    ...new DatabaseToolkit(db).getTools(),
    ...new FileSystemToolkit('/workspace').getTools(),
    calculatorTool,
  ],
});
```

#### 动态注册

```typescript
class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  async invoke(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.invoke(args);
  }
}
```

#### 优缺点

| 优势                      | 劣势                     |
| ------------------------- | ------------------------ |
| TypeScript 原生，类型安全 | 无安全隔离（进程内执行） |
| 灵活组合（Toolkit 模式）  | 恶意工具可访问完整进程   |
| Zod schema 开发体验好     | 无版本管理               |
| 生态丰富（社区 Toolkit）  | 无权限模型               |

---

### 3.3 AutoGPT Forge 组件架构

#### 架构模型

```
Agent
  ├── ComponentManager（自动发现）
  │     ├── Component A (priority: 10)
  │     ├── Component B (priority: 20)
  │     └── Component C (priority: 30)
  │
  └── 执行循环
        ├── 按优先级排序组件
        ├── 每个组件 propose_action()
        └── 选择最高优先级的 action 执行
```

#### 组件定义

```python
from abc import ABC, abstractmethod

class AgentComponent(ABC):
    """组件基类 — 所有 Skill 继承此类"""

    def __init__(self):
        self.enabled = True
        self.priority = 10  # 越小优先级越高

    @abstractmethod
    def propose_action(self, state: AgentState) -> ThoughtProcessOutput:
        """提议下一步行动"""

    @abstractmethod
    def execute(self, action: Action) -> ActionResult:
        """执行行动"""
```

#### 协议驱动设计

组件通过实现协议接口来声明能力：

```python
class CodeExecutionProtocol(Protocol):
    def execute_code(self, code: str, language: str) -> ExecutionResult: ...

class WebSearchProtocol(Protocol):
    def search(self, query: str) -> list[SearchResult]: ...

# 组件实现协议
class PythonExecutor(AgentComponent, CodeExecutionProtocol):
    def execute_code(self, code, language):
        if language != 'python':
            raise UnsupportedLanguage(language)
        return sandbox.run(code)
```

Agent 通过类型检查自动发现哪些组件实现了哪些协议。

#### 优缺点

| 优势                        | 劣势            |
| --------------------------- | --------------- |
| 高度模块化（Protocol 驱动） | 架构复杂        |
| 自动发现（无需显式注册）    | Python 生态限制 |
| 优先级排序（多组件协作）    | 学习曲线陡峭    |
| 可选沙箱（Docker/E2B）      | 配置繁琐        |

---

### 3.4 MCP (Model Context Protocol)

MCP 是 Anthropic 推出的开放协议标准，定义了 LLM 应用与外部数据/工具的通信规范。

#### 架构模型

```
┌────────────────────────────────────────────┐
│              Host Application               │
│                                            │
│  ┌──────────┐  ┌──────────┐               │
│  │ MCP      │  │ MCP      │  ...          │
│  │ Client 1 │  │ Client 2 │               │
│  └────┬─────┘  └────┬─────┘               │
└───────┼──────────────┼─────────────────────┘
        │              │
        │ JSON-RPC 2.0 │ (stdio / HTTP SSE)
        ↓              ↓
┌───────────────┐ ┌───────────────┐
│  MCP Server 1 │ │  MCP Server 2 │
│  (文件系统)    │ │  (数据库)      │
│               │ │               │
│  Tools:       │ │  Tools:       │
│   read_file   │ │   query       │
│   write_file  │ │   insert      │
│               │ │               │
│  Resources:   │ │  Prompts:     │
│   file://...  │ │   sql_helper  │
└───────────────┘ └───────────────┘
```

关键特征：每个 MCP Server 是独立进程，Host 通过 Client 连接多个 Server。

#### 工具定义格式

```typescript
// MCP Server 端声明工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query_database',
      description: 'Execute a read-only SQL query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL SELECT statement',
          },
          database: {
            type: 'string',
            enum: ['users', 'orders', 'products'],
          },
        },
        required: ['sql', 'database'],
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
  ],
}));
```

#### 通信协议

JSON-RPC 2.0 请求/响应：

```json
// 工具调用请求
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "query_database",
    "arguments": {
      "sql": "SELECT * FROM users LIMIT 10",
      "database": "users"
    }
  }
}

// 工具调用响应
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"id\": 1, \"name\": \"Alice\"}, ...]"
      }
    ]
  }
}
```

#### 能力协商

连接建立时，Client 和 Server 协商各自支持的能力：

```typescript
// Client → Server: initialize
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true },
      "sampling": {}  // 允许 Server 请求 LLM 推理
    },
    "clientInfo": {
      "name": "VigilClaw",
      "version": "0.2.0"
    }
  }
}

// Server → Client: initialized
{
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {},
      "resources": { "subscribe": true, "listChanged": true }
    },
    "serverInfo": {
      "name": "database-server",
      "version": "1.0.0"
    }
  }
}
```

#### MCP 的三种原语

| 原语          | 控制方   | 用途       | 类比      |
| ------------- | -------- | ---------- | --------- |
| **Tools**     | LLM 调用 | 执行操作   | POST 请求 |
| **Resources** | 应用读取 | 提供数据   | GET 请求  |
| **Prompts**   | 用户选择 | 模板化交互 | 快捷指令  |

#### 安全原则

1. **用户同意**：所有数据访问需用户明确授权
2. **服务器隔离**：Server 间无法互相通信
3. **工具标注**：`readOnlyHint`/`destructiveHint` 提示行为风险
4. **人类在环**：敏感操作需用户确认
5. **最小权限**：Server 只获取必要能力

#### 优缺点

| 优势                         | 劣势                 |
| ---------------------------- | -------------------- |
| 标准化开放协议               | 启动开销（独立进程） |
| 进程隔离安全                 | 序列化/反序列化成本  |
| 语言无关                     | 调试复杂度           |
| Anthropic 主推，生态增长快   | 相对较新             |
| Resources + Prompts 扩展性强 | 配置较多             |

---

### 3.5 Claude Code Marketplace

#### 架构模型

```
marketplace/                          # 市场仓库
├── .claude-plugin/
│   └── marketplace.json              # 市场清单
└── plugins/
    └── code-formatter/               # 单个插件
        ├── .claude-plugin/
        │   └── plugin.json           # 插件元数据
        └── skills/
            └── format-code/
                └── SKILL.md          # Skill 定义（Markdown）
```

#### Marketplace 清单

```json
{
  "name": "company-tools",
  "description": "Internal development tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@company.com"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": {
        "source": "github",
        "repo": "company/formatter",
        "ref": "v2.0.0",
        "sha": "a1b2c3d4e5f6..."
      },
      "version": "2.1.0",
      "license": "MIT"
    }
  ]
}
```

#### 版本管理策略

| 策略            | 配置                  | 安全等级 | 适用场景         |
| --------------- | --------------------- | -------- | ---------------- |
| Git SHA 锁定    | `"sha": "a1b2c3d..."` | 最高     | 生产环境         |
| Semver 范围     | `"ref": "^2.0.0"`     | 中等     | 自动更新兼容版本 |
| Branch 跟踪     | `"ref": "main"`       | 最低     | 开发/测试        |
| Release Channel | `"channel": "stable"` | 高       | 分阶段发布       |

#### 安装流程

```
用户添加市场源
  → 拉取 marketplace.json
  → 列出可用插件
  → 用户选择安装
  → 根据 source 拉取代码（Git clone/download）
  → 校验 SHA / 签名
  → 复制到本地 skills 目录
  → 注册到 Agent
```

#### 优缺点

| 优势                               | 劣势                            |
| ---------------------------------- | ------------------------------- |
| 简单实用（Markdown 定义 Skill）    | 无运行时隔离                    |
| Git 原生版本管理                   | Skill 能力有限（主要是 prompt） |
| 分布式（任何 Git 仓库可当市场）    | 无权限模型                      |
| 低门槛（写 Markdown 就是写 Skill） | 安全依赖代码审计                |

---

## 四、沙箱安全模型对比

### 4.1 总览

| 技术        | 隔离类型           | 启动延迟 | 主机 syscall 暴露 | 适用场景   |
| ----------- | ------------------ | -------- | ----------------- | ---------- |
| Docker      | 命名空间 + seccomp | ~100ms   | 完整 ABI（数百）  | 可信代码   |
| gVisor      | 用户态内核         | ~200ms   | 68 个 syscall     | 多租户     |
| Firecracker | 硬件虚拟化         | ~125ms   | KVM ioctls        | 不可信代码 |
| WebAssembly | 能力模型           | ~10ms    | 显式 imports      | 工具调用   |

### 4.2 Docker Container

```
┌─────────────────────────────┐
│     Container (Namespace)    │
│  ┌────────────────────────┐ │
│  │  Application Process   │ │
│  └──────────┬─────────────┘ │
│             │ syscall        │
│  ┌──────────┴─────────────┐ │
│  │  seccomp-bpf filter    │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ (数百个 syscall 直通)
    ┌─────────┴──────────┐
    │   Host Kernel      │
    └────────────────────┘
```

安全约束配置：

- `read_only rootfs`：防止篡改
- `CAP_DROP ALL`：移除所有特权
- `no-new-privileges`：禁止提权
- `seccomp` 白名单：过滤危险 syscall
- 资源限制：内存 512MB / CPU 1 核 / PID 100

### 4.3 gVisor

```
┌─────────────────────────────┐
│     Container (gVisor)       │
│  ┌────────────────────────┐ │
│  │  Application Process   │ │
│  └──────────┬─────────────┘ │
│             │ syscall        │
│  ┌──────────┴─────────────┐ │
│  │  Sentry (用户态内核)    │ │
│  │  Go 实现，内存安全      │ │
│  └──────────┬─────────────┘ │
│             │                │
│  ┌──────────┴─────────────┐ │
│  │  Gofer (文件系统代理)   │ │
│  │  9P 协议               │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ (仅 68 个 syscall)
    ┌─────────┴──────────┐
    │   Host Kernel      │
    └────────────────────┘
```

核心优势：应用的 syscall 被 Sentry（Go 实现的用户态内核）拦截和重新实现，主机内核仅暴露 68 个 syscall。

### 4.4 Firecracker MicroVM

```
┌─────────────────────────────┐
│     MicroVM (Firecracker)    │
│  ┌────────────────────────┐ │
│  │  Guest OS (mini Linux) │ │
│  │  ┌──────────────────┐  │ │
│  │  │  Application     │  │ │
│  │  └──────────────────┘  │ │
│  └──────────┬─────────────┘ │
│             │ virtio-mmio    │
│  ┌──────────┴─────────────┐ │
│  │  VMM (Rust, 最小化)    │ │
│  │  仅 24 个 syscall      │ │
│  │  无 PCI，纯 virtio     │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ (KVM ioctls)
    ┌─────────┴──────────┐
    │   Host Kernel      │
    └────────────────────┘
```

Firecracker 是 AWS Lambda 和 Fargate 底层的 MicroVM。启动时间 ~125ms，内存开销 ~5MB。最强隔离但配置复杂。

### 4.5 WebAssembly

```
┌─────────────────────────────┐
│     WASM Runtime (Wasmtime)  │
│  ┌────────────────────────┐ │
│  │  WASM Module           │ │
│  │  线性内存（越界 trap）  │ │
│  │  无隐式 syscall        │ │
│  └──────────┬─────────────┘ │
│             │ 显式 imports   │
│  ┌──────────┴─────────────┐ │
│  │  WASI 能力层           │ │
│  │  显式授权：            │ │
│  │   preopen_dir("./work")│ │
│  │   allow_net("*.com")   │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ (极少 syscall)
    ┌─────────┴──────────┐
    │   Host Process     │
    └────────────────────┘
```

WASM 的能力模型：所有系统能力必须显式导入（`imports`），不导入则不可用。最小攻击面，但生态还不成熟。

---

## 五、Skill Manifest 设计模式

综合各方案，Manifest 最佳实践：

```json
{
  "$schema": "https://vigilclaw.dev/schemas/skill-v1.json",

  "name": "web-search",
  "version": "1.0.0",
  "description": "Search the web using DuckDuckGo API",
  "author": "vigilclaw-community",
  "license": "MIT",
  "homepage": "https://github.com/example/web-search-skill",

  "permissions": ["network"],

  "tools": [
    {
      "name": "web_search",
      "description": "Search the web for information on any topic",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Search query"
          },
          "maxResults": {
            "type": "number",
            "description": "Maximum number of results to return"
          }
        },
        "required": ["query"]
      }
    }
  ],

  "entrypoint": "index.js",

  "security": {
    "sandbox": "docker",
    "signature": {
      "algorithm": "ed25519",
      "publicKey": "base64..."
    }
  }
}
```

### 权限类型设计

| 权限      | 含义            | 风险等级 |
| --------- | --------------- | -------- |
| `read`    | 读取文件系统    | 低       |
| `write`   | 写入文件系统    | 中       |
| `bash`    | 执行 shell 命令 | 高       |
| `network` | 发起网络请求    | 中       |

安装时展示权限并要求用户确认：

```
安装 Skill: web-search v1.0.0
作者: vigilclaw-community

请求权限:
  - network: 发起网络请求

确认安装？(y/n)
```

---

## 六、关键设计决策矩阵

| 决策维度     | 选项 A     | 选项 B        | 选项 C       | VigilClaw 推荐 | 理由                      |
| ------------ | ---------- | ------------- | ------------ | -------------- | ------------------------- |
| 工具定义格式 | OpenAPI    | JSON Schema   | Zod          | JSON Schema    | 与现有 ITool.schema 一致  |
| 执行模型     | 进程内     | 独立进程(MCP) | 容器内       | 容器内         | 复用已有容器安全模型      |
| 通信协议     | 函数调用   | JSON-RPC      | IPC 文件     | IPC 文件       | 与现有 IPC 协议一致       |
| 安全隔离     | 无         | 进程隔离      | 容器隔离     | 容器隔离       | 已有完善的容器安全约束    |
| 权限模型     | 无         | 声明式        | 能力式(WASM) | 声明式         | 简单直观，安装时审核      |
| 版本管理     | 无         | Semver        | Git SHA      | Semver         | 标准化，用户友好          |
| 分发方式     | npm        | Git           | 市场         | Git → 市场     | 分阶段，先 Git 后市场     |
| 代码格式     | TypeScript | JavaScript    | WASM         | JavaScript     | 容器内 require() 直接加载 |

---

## 七、对 VigilClaw Skill 系统的启示

### 7.1 为什么选择容器内执行

MCP 的进程隔离模型更通用（语言无关、标准协议），但 VigilClaw 已有完善的 Docker 容器安全模型（read-only rootfs, CAP_DROP ALL, 5 分钟超时, 512MB 内存限制）。在容器内执行 Skill 可以：

1. **零额外基础设施**：不需要启动独立 MCP Server 进程
2. **复用安全模型**：Skill 代码享受与内置工具相同的沙箱保护
3. **性能无损**：无 IPC 序列化开销（直接函数调用）
4. **简化开发**：Skill 开发者写一个 JS 文件即可，不需要实现 RPC 服务器

**未来演进**：容器内执行 → 容器内 MCP Server（增强隔离）→ 独立 MCP Server（跨语言支持）

### 7.2 为什么选择 JSON Schema

OpenAPI 太重（为 REST API 设计），Zod 是 TypeScript 专属。JSON Schema 是 LLM 工具定义的事实标准（OpenAI 和 Anthropic 都用），且与 VigilClaw 现有的 `ITool.schema: ToolSchema` 完全兼容。

### 7.3 为什么选择声明式权限

WASM 的能力模型（显式 imports）最安全但生态不成熟。声明式权限（manifest 中列出 `permissions: ["network"]`）简单直观：

1. 用户安装时清楚知道 Skill 需要什么能力
2. 运行时可校验 Skill 是否越权
3. 审计日志可追踪权限使用
4. 后续可细化（如 `network` → `network:api.github.com`）

### 7.4 未来演进路线

```
Phase 1 (当前): 本地安装 + 容器内执行 + 声明式权限
    ↓
Phase 2: MCP 支持（Skill 可选以 MCP Server 模式运行）
    ↓
Phase 3: Skill 市场（Git 仓库 + 发现/搜索/评分）
    ↓
Phase 4: 签名验证 + 自动更新 + 依赖管理
```

---

## 附录：参考链接

- [OpenAI GPT Actions 文档](https://platform.openai.com/docs/actions/introduction)
- [LangChain Tools 文档](https://js.langchain.com/docs/concepts/tools/)
- [AutoGPT Forge 架构](https://github.com/Significant-Gravitas/AutoGPT)
- [MCP 规范 (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18)
- [Claude Code 插件市场](https://docs.anthropic.com/en/docs/claude-code/extensions)
- [gVisor 安全模型](https://gvisor.dev/docs/architecture_guide/security/)
- [Firecracker 设计文档](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)
- [WASI 能力模型](https://wasi.dev/)
