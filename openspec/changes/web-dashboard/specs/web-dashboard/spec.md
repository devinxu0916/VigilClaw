# Web Dashboard Spec

**Status:** NEW
**Source:** `src/dashboard-server.ts`, `src/dashboard-auth.ts`, `src/dashboard-views.ts`

## Overview

Web Dashboard 为 VigilClaw 提供浏览器可访问的管理界面，嵌入宿主进程 HTTP server（:8080），通过 htmx + 服务端渲染 HTML 实现动态交互。

## Requirements

### R1: HTTP Server 扩展

现有 `health.ts` 的 HTTP server SHALL 扩展为支持多路由分发：
- `GET /health` — 保持现有行为不变（不做认证）
- `GET /` — Dashboard 主页（需认证）
- `GET /api/*` — Dashboard API 路由（需认证）
- `POST /api/*` — Dashboard 操作路由（需认证）
- `DELETE /api/*` — Dashboard 删除路由（需认证）

**Scenario:**
- WHEN 用户访问 `GET /health` THEN 返回原有的健康检查 JSON（无需 Token）
- WHEN 用户访问 `GET /` 且未提供有效 Token THEN 返回 401 Unauthorized
- WHEN 用户访问 `GET /` 且提供有效 Token THEN 返回 Dashboard HTML 页面

### R2: Bearer Token 认证

Dashboard SHALL 使用 Bearer Token 认证，Token 派生自 `VIGILCLAW_MASTER_KEY`：

- Token = `SHA-256(masterKey)` 的前 32 个十六进制字符
- 认证方式支持两种：
  - HTTP Header: `Authorization: Bearer <token>`
  - URL 参数: `?token=<token>`
- `/health` 端点 MUST NOT 做认证检查
- Token SHALL 在宿主进程启动日志中输出（仅前 8 字符 + `***`）

**Scenario:**
- WHEN Dashboard 启用且宿主进程启动 THEN 日志输出 `Dashboard token: abcd1234***`
- WHEN 请求带有 `Authorization: Bearer <正确token>` THEN 允许访问
- WHEN 请求带有 `?token=<正确token>` THEN 允许访问
- WHEN 请求 Token 错误或缺失 THEN 返回 401，body 为简单的"认证失败"提示页

### R3: Overview Tab — 系统概览

Dashboard 主页 SHALL 展示三个概览卡片和一个模型明细表：

**概览卡片：**
- Today: 今日费用 / 日预算 + 百分比进度条 + 今日调用次数 + 今日任务数
- This Month: 本月费用 / 月预算 + 百分比进度条 + 本月调用次数 + 本月任务数
- System: SQLite 状态 / Docker 状态 / 运行时间 / 内存占用 / 运行时类型

**模型明细表：**
- 列：Model / Calls / Tokens In / Tokens Out / Cost
- 数据范围：今日
- 按 Cost 降序

概览区域 SHALL 每 30 秒通过 htmx 自动刷新。

**Scenario:**
- WHEN 用户打开 Dashboard THEN 概览区域立即显示当前数据（首屏服务端渲染，无需二次请求）
- WHEN 30 秒过去 THEN htmx 自动请求 `GET /api/overview` 并替换概览区域内容

### R4: Tasks Tab — 任务历史 + 定时任务

**任务历史表：**
- 列：Status（✅/❌/⏳） / Time / Duration / Model / Cost / Summary
- 分页：每页 20 条，支持上一页/下一页
- Duration = `completed_at - started_at`，格式 `X.Xs`

**定时任务管理：**
- 列：Status（✅/⏸️） / Cron / Next Run / Prompt / Actions
- Actions：启停按钮（htmx POST `/api/schedules/:id/toggle`）、删除按钮（htmx DELETE `/api/schedules/:id`，需二次确认）
- 启停操作 SHALL 通过 htmx 替换当前行（无需刷新整页）

**Scenario:**
- WHEN 用户点击 "下一页" THEN htmx 请求 `GET /api/tasks?page=2` 并替换任务列表区域
- WHEN 用户点击定时任务的启停按钮 THEN 任务状态切换并刷新该行
- WHEN 用户点击删除按钮 THEN 弹出浏览器原生 `confirm()` 确认后执行删除

### R5: System Tab — Skill 管理 + 安全事件 + 凭证状态

**Skill 列表：**
- 列：Name / Version / Status / Permissions / Actions
- Actions：启停按钮（htmx POST `/api/skills/:name/toggle`）
- built-in Skill（如 system-commands）不显示启停按钮

**安全事件日志：**
- 列：Time / Type / Severity / User / Details
- 分页：每页 30 条
- Severity 使用颜色标识：high=红 / medium=黄 / low=灰

**凭证状态：**
- 列：Provider / Last Rotated / Status
- MUST NOT 显示凭证的加密值或明文
- Status：有值 = `● Active`，无值 = `○ Not Set`

**Scenario:**
- WHEN 用户点击 Skill 启停按钮 THEN Skill 状态切换并刷新该行
- WHEN 安全事件为 high severity THEN 该行文字为红色

### R6: 配置开关

- `VIGILCLAW_DASHBOARD_ENABLED` 环境变量控制 Dashboard 是否启用，默认 `true`
- 当 `VIGILCLAW_DASHBOARD_ENABLED=false` 时，HTTP server 行为与当前完全一致（仅 `/health`）

**Scenario:**
- WHEN `VIGILCLAW_DASHBOARD_ENABLED=false` THEN 访问 `GET /` 返回 404
- WHEN `VIGILCLAW_DASHBOARD_ENABLED=true` THEN 访问 `GET /` 返回 Dashboard（需认证）

### R7: 页面结构 — 单页 Tab 切换

Dashboard SHALL 使用单页面 + Tab 导航结构：
- Tab: Overview / Tasks / System
- Tab 切换通过 htmx `hx-get` 加载对应内容片段，URL 不变
- 默认展示 Overview Tab
- 页面顶部 SHALL 显示：VigilClaw 标识 + 运行状态指示灯 + 运行时间

**Scenario:**
- WHEN 用户点击 "Tasks" Tab THEN htmx 请求 `GET /api/tasks` 并替换主内容区域，不刷新整页
- WHEN 用户刷新浏览器 THEN 回到 Overview Tab（默认状态）
