## Context

VigilClaw 个人 AI 助手需要一个 Web Dashboard 用于系统监控和管理。当前状态：

- `health.ts` 已有 HTTP server 监听 :8080，只服务 `GET /health`
- `db.ts` 已有 `getCostReport()` 等查询，但缺少按日汇总、分页等 Dashboard 所需查询
- 12 个生产依赖，项目风格克制（上限 50）
- 个人自用场景，单用户
- SQLite 单文件数据库，不适合多进程并发写
- 部署为 docker-compose 单容器

## Goals / Non-Goals

**Goals:**
- 浏览器访问 `http://<host>:8080/` 即可查看 Dashboard
- 一眼掌握系统状态：费用、任务、运行时健康
- 管理定时任务（启停/删除）和 Skill（启停）
- 查看安全事件日志和凭证状态
- 30 秒自动刷新关键指标
- 零新 npm 依赖

**Non-Goals:**
- 多用户管理 / RBAC（个人自用，单一 admin）
- OAuth / SSO 认证（Bearer Token 足够）
- 实时 WebSocket 推送（htmx 轮询足够）
- 消息/对话内容浏览（隐私考虑，不在 Dashboard 展示）
- 独立前端构建链（不引入 Vite/Webpack）
- 移动端响应式优化（Phase B 考虑）
- 费用趋势图表（Phase B 考虑，需引入 Chart.js）

## Decisions

### D1: 架构 — 内嵌式（扩展 health.ts 同进程）

**选择：扩展现有 HTTP server，不新开进程/端口**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 内嵌式：扩展 health.ts | 零额外进程、无 SQLite 并发写问题、部署不变 | health server 职责变大 |
| 独立服务：新进程 + 新端口 | 解耦 | SQLite 并发写风险、docker-compose 多一个 service |
| 纯 CLI（TUI Dashboard） | 极简 | 不适合持续监控、交互性差 |

**理由**：SQLite 不支持多进程并发写是硬约束。内嵌式天然避免这个问题，且复用已有的 :8080 端口和 docker-compose 健康检查配置，零部署变更。health.ts 的 HTTP server 本身就是为扩展预留的。

### D2: 前端方案 — htmx + Pico CSS（CDN）

**选择：服务端渲染 HTML + htmx 动态交换 + Pico CSS 样式**

| 方案 | 新增依赖 | 构建步骤 | 维护成本 |
|------|---------|---------|---------|
| htmx + Pico CSS (CDN) | 0 | 无 | 极低 |
| 纯原生 HTML/JS | 0 | 无 | 低，但交互代码多 |
| Preact + esbuild | 2-3 | 轻量构建 | 中 |
| React + Vite | 5-10 | 独立构建链 | 高 |

**理由**：
- htmx（14KB CDN）让服务端返回 HTML 片段即可实现 SPA 级交互，不需要前端框架
- Pico CSS（10KB CDN）提供零 class 的语义化美观样式，不需要写 CSS
- 所有业务逻辑都在 TypeScript 服务端，与项目技术栈一致
- Dashboard 的交互模式（查看数据 + 偶尔点按钮）完全在 htmx 的 sweet spot 内
- 零构建步骤 = 零构建工具依赖 = 零维护负担

### D3: HTML 渲染方案 — TypeScript 模板字符串（非静态文件）

**选择：`dashboard-views.ts` 导出模板函数，服务端直接返回 HTML 字符串**

| 方案 | 优点 | 缺点 |
|------|------|------|
| TS 模板字符串 | 首屏可注入数据、类型安全、无文件 IO | HTML 在 TS 里可读性稍差 |
| public/ 静态目录 | 前端文件独立 | 需处理 MIME/缓存、首屏需二次请求 |
| 模板引擎 (ejs/pug) | 语法清晰 | 多一个依赖 |

**理由**：
- 不需要处理静态文件的 MIME type、缓存 header、路径映射
- 首屏 HTML 直接包含数据（htmx 后续请求只交换片段），页面打开即可见
- htmx 返回的片段本来就是服务端生成的 HTML 字符串，两者模式统一
- 整个 Dashboard 是纯 TypeScript，`pnpm build` 一步到位

### D4: 认证方案 — Bearer Token（派生自 Master Key）

**选择：`SHA-256(masterKey)` 的前 32 字符作为 Dashboard Token**

| 方案 | 安全性 | 复杂度 |
|------|--------|--------|
| Bearer Token (SHA-256 派生) | 内网足够 | 极低 |
| Basic Auth (用户名/密码) | 内网足够 | 低 |
| Cookie Session + 登录页 | 更好 | 中 |
| OAuth2 | 最好 | 高 |

**理由**：
- 个人自用 + 内网访问，Bearer Token 足够安全
- Token 派生自已有的 `VIGILCLAW_MASTER_KEY`，不需要额外配置
- `/health` 端点不做认证保护（docker-compose 健康检查需要）
- 同时支持 `Authorization: Bearer <token>` header 和 `?token=<token>` URL 参数（方便浏览器直接输入）
- Token 在启动日志中输出，方便用户复制

### D5: 路由设计 — /health 保持不变，/api/* 和 /* 新增

**选择：**

```
GET  /health                    — 原有，不做认证（健康检查）
GET  /                          — Dashboard 主页（需认证）
GET  /api/overview              — 概览统计数据（HTML 片段）
GET  /api/costs                 — 费用明细（HTML 片段）
GET  /api/costs/daily?days=N    — 按日汇总费用（HTML 片段）
GET  /api/tasks?page=N          — 任务历史分页（HTML 片段）
GET  /api/schedules             — 定时任务列表（HTML 片段）
POST /api/schedules/:id/toggle  — 启停定时任务
DELETE /api/schedules/:id       — 删除定时任务
GET  /api/skills                — Skill 列表（HTML 片段）
POST /api/skills/:name/toggle   — 启停 Skill
GET  /api/security?page=N       — 安全事件分页（HTML 片段）
GET  /api/credentials           — 凭证状态（HTML 片段）
```

**注意**：API 返回 HTML 片段（非 JSON），因为 htmx 直接替换 DOM。这是 htmx 的标准模式。如果未来需要 JSON API（给第三方工具用），可以通过 `Accept` header 区分。

### D6: DB 查询扩展 — 最小化新增

**选择：只添加 Dashboard 确实需要的查询**

新增方法：
- `getDailyCosts(days: number)`: 按日汇总费用（`GROUP BY date(created_at)`）
- `getTasksPaginated(page, pageSize)`: 分页查询 tasks 表
- `getSecurityEventsPaginated(page, pageSize)`: 分页查询安全事件
- `getOverviewStats()`: 聚合查询（今日/本月费用、任务数、调用数）
- `listCredentialStatus()`: 凭证列表（只返回 provider + last_rotated_at，不返回密文）

**不新增预编译语句**：这些查询频率低（Dashboard 轮询），直接用 `db.prepare().all()` 即可，不值得占预编译语句的内存。

## Risks / Trade-offs

- **[health.ts 职责膨胀]** → 缓解：实际路由逻辑在 `dashboard-server.ts`，health.ts 只做分发入口。可以把 health.ts 重命名为 `http-server.ts` 使语义更清晰。

- **[CDN 依赖外部网络]** → 缓解：htmx 和 Pico CSS 都很小（合计 ~24KB），可以选择内联进 HTML 模板（作为 fallback）。Dashboard 本身是内网管理工具，通常有网络。

- **[认证 Token 泄露]** → 缓解：Token 只在内网使用。HTTPS 部署通过反向代理（Caddy/Nginx）实现，不在本 change scope 内。日志中输出 Token 时只显示前 8 字符。

- **[SQLite 查询性能]** → 缓解：Dashboard 轮询间隔 30 秒，查询数据量小（个人使用），现有索引（`idx_api_calls_user_date`、`idx_tasks_status`）已覆盖。无需额外优化。

- **[代码量增加]** → 预估新增 800-1200 行。当前 12,953 行，加上后约 14,000 行，仍在可审计范围内。Dashboard 是独立模块，不增加核心逻辑复杂度。

## Migration Plan

**对现有用户的影响：**
- `VIGILCLAW_DASHBOARD_ENABLED` 默认 `true`
- 访问 `http://<host>:8080/` 即可看到 Dashboard（需 Token）
- Token 在启动日志中输出
- `/health` 行为完全不变，docker-compose 健康检查不受影响
- 不需要修改 docker-compose.yml 或 .env

**回滚：**
- 设置 `VIGILCLAW_DASHBOARD_ENABLED=false` 即可关闭，退回到只有 `/health` 的行为

## Open Questions

1. ~~费用趋势图是否需要在 Phase A 包含？~~ 不需要。Phase B 再引入 Chart.js。纯数字 + 表格在 Phase A 足够。
2. 是否需要在 Dashboard 上提供"修改预算/切换模型"的功能？ — 暂不做，Phase B 的 Settings Tab 考虑。Phase A 聚焦只读监控 + Skill/Schedule 管理操作。
