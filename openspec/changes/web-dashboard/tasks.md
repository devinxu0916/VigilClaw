## 1. HTTP Server 扩展 + 认证

- [ ] 1.1 创建 `src/dashboard-auth.ts`：导出 `generateDashboardToken(masterKey: Buffer): string`（SHA-256 前 32 字符）和 `authMiddleware(token: string, req: http.IncomingMessage): boolean`（检查 header 和 URL 参数）
- [ ] 1.2 创建 `src/dashboard-server.ts` 骨架：导出 `createDashboardHandler(deps)` 函数，返回 `(req, res) => void` 请求处理器。deps 包含 db、skillRegistry、taskScheduler 等依赖
- [ ] 1.3 重构 `src/health.ts`：将 HTTP server 创建逻辑与路由分离。`/health` 原有逻辑不变；当 Dashboard 启用时，非 `/health` 请求转发给 dashboard handler
- [ ] 1.4 修改 `src/config.ts`：新增 `VIGILCLAW_DASHBOARD_ENABLED` 环境变量（默认 `true`），映射到 config 对象
- [ ] 1.5 修改 `src/index.ts`：Dashboard 启用时，启动日志输出 Token 前 8 字符；将 dashboard handler 注册到 HTTP server
- [ ] 1.6 验证：`pnpm typecheck` 通过；手动测试 `GET /health` 不需要认证；`GET /` 无 Token 返回 401；带 Token 返回 200

## 2. DB 查询扩展

- [ ] 2.1 在 `src/db.ts` 新增 `getOverviewStats()` 方法：返回 `{ todayCost, monthCost, todayCalls, monthCalls, todayTasks, monthTasks }`
- [ ] 2.2 在 `src/db.ts` 新增 `getDailyCosts(days: number)` 方法：返回 `Array<{ date, totalCost, callCount }>`，按日汇总
- [ ] 2.3 在 `src/db.ts` 新增 `getTasksPaginated(page, pageSize)` 方法：返回分页 tasks + total count
- [ ] 2.4 在 `src/db.ts` 新增 `getSecurityEventsPaginated(page, pageSize)` 方法：同上
- [ ] 2.5 在 `src/db.ts` 新增 `listCredentialStatus()` 方法：返回 `Array<{ provider, lastRotatedAt }>`（不返回密文）
- [ ] 2.6 验证：`pnpm typecheck` 通过；编写对应的单元测试

## 3. HTML 视图层

- [ ] 3.1 创建 `src/dashboard-views.ts`：导出 `renderPage(content, token, uptime)` 函数 — 完整 HTML 页面骨架，包含 htmx/Pico CSS CDN link、Tab 导航、认证 Token meta 传递
- [ ] 3.2 实现 `renderOverview(stats, modelBreakdown, healthChecks)` — 三个概览卡片 + 模型明细表，带 `hx-get="/api/overview" hx-trigger="every 30s"` 自动刷新
- [ ] 3.3 实现 `renderTasks(tasks, pagination, scheduledTasks)` — 任务历史表（分页）+ 定时任务管理表（启停/删除按钮）
- [ ] 3.4 实现 `renderSystem(skills, securityEvents, credentials)` — Skill 表 + 安全事件表（分页）+ 凭证状态表
- [ ] 3.5 验证：`pnpm typecheck` 通过

## 4. API 路由实现

- [ ] 4.1 在 `dashboard-server.ts` 实现 `GET /` — 调用 renderPage + renderOverview 返回完整首页
- [ ] 4.2 实现 `GET /api/overview` — 返回 Overview HTML 片段（htmx 轮询用）
- [ ] 4.3 实现 `GET /api/tasks?page=N` — 返回 Tasks Tab HTML 片段
- [ ] 4.4 实现 `GET /api/schedules` — 返回定时任务列表 HTML 片段
- [ ] 4.5 实现 `POST /api/schedules/:id/toggle` — 切换定时任务启停，返回更新后的行 HTML
- [ ] 4.6 实现 `DELETE /api/schedules/:id` — 删除定时任务，返回空内容（htmx 移除行）
- [ ] 4.7 实现 `GET /api/skills` — 返回 Skill 列表 HTML 片段
- [ ] 4.8 实现 `POST /api/skills/:name/toggle` — 切换 Skill 启停，返回更新后的行 HTML
- [ ] 4.9 实现 `GET /api/system` — 返回 System Tab 完整 HTML 片段（Skills + Security Events + Credentials）
- [ ] 4.10 实现 `GET /api/security?page=N` — 返回安全事件分页 HTML 片段
- [ ] 4.11 实现 `GET /api/credentials` — 返回凭证状态 HTML 片段
- [ ] 4.12 验证：`pnpm typecheck` 通过

## 5. 集成 + 测试

- [ ] 5.1 编写 `tests/unit/dashboard-auth.test.ts`：Token 生成、Header 认证、URL 参数认证、401 拒绝
- [ ] 5.2 编写 `tests/unit/dashboard-server.test.ts`：路由分发、API 响应格式、认证拦截、Schedule/Skill 操作
- [ ] 5.3 编写 `tests/unit/dashboard-db.test.ts`：新增 DB 查询方法的正确性（分页、汇总、边界条件）
- [ ] 5.4 全量检查：`pnpm check`（lint + typecheck + test）通过
- [ ] 5.5 更新 `docs/planning/ROADMAP.md`：Web Dashboard 状态标记为 ✅
- [ ] 5.6 更新 `docs/planning/CHANGELOG.md`：记录 Web Dashboard 变更
