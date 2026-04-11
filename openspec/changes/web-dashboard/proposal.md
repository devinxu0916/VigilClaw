## Why

VigilClaw 的所有管理操作（费用查看、模型切换、预算设置、Skill 管理、定时任务）目前只能通过 Telegram/飞书/钉钉的 `/command` 命令完成。这些命令在手机上操作不便（尤其是 cron 表达式），无法提供数据可视化（费用趋势、模型消耗分布），且没有全局概览视图——用户必须逐个执行 `/cost`、`/schedule list`、`/skill list` 才能了解系统状态。

Web Dashboard 提供一个浏览器可访问的管理界面，让个人用户能快速掌握系统运行状况、费用消耗趋势，并可视化管理定时任务和 Skill。

## What Changes

- 扩展现有 `health.ts` HTTP server 为 Dashboard server，复用同一端口（:8080）
- 新增 REST API 层：概览统计、费用明细、任务历史、Skill 管理、定时任务管理、安全事件查询
- 新增 Bearer Token 认证中间件（派生自 VIGILCLAW_MASTER_KEY）
- 新增服务端 HTML 渲染层（TypeScript 模板字符串），搭配 htmx（CDN）实现动态交互
- 新增 Pico CSS（CDN）提供零配置的美观样式
- DB 层补充若干查询方法（按日汇总费用、分页查询 api_calls/tasks/security_events）

## Capabilities

### New Capabilities
- `web-dashboard`: Web 管理界面 — 系统概览、费用监控、任务历史、Skill 管理、定时任务管理、安全事件日志、凭证状态

### Modified Capabilities
_无。Dashboard 是只读 + 管理操作的新入口，不改变现有渠道和 Runner 的行为规格。_

## Impact

**新增文件：**
- `src/dashboard-server.ts` — HTTP 路由分发 + API 处理器
- `src/dashboard-auth.ts` — Bearer Token 认证中间件
- `src/dashboard-views.ts` — HTML 页面/片段模板函数

**修改文件：**
- `src/health.ts` — 从单一 `/health` 端点扩展为通用 HTTP server，挂载 dashboard 路由
- `src/db.ts` — 新增查询方法（按日费用汇总、分页查询、统计聚合）
- `src/index.ts` — 初始化 Dashboard server，传入所需依赖
- `src/config.ts` — 新增 `VIGILCLAW_DASHBOARD_ENABLED` 环境变量

**新增依赖：** 无（htmx + Pico CSS 从 CDN 加载，零 npm 依赖）

**受影响系统：** HTTP server（health.ts 扩展）、SQLite 查询层
