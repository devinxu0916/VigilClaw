# 里程碑：Phase 2 — 差异化能力

> 周期：2026-03-13 ~ 2026-06-21 · 状态：✅ 功能完成

MVP（Phase 1）跑通后，按 P1/P2/P3 优先级迭代差异化能力。本阶段全部规划项交付完毕。

## 交付清单

### P1 必做

| 功能 | 说明 |
| ---- | ---- |
| 多模型支持 | OpenAI + Ollama Provider + `provider:model` 标识 |
| 上下文压缩 | 增量摘要，避免 Compaction 死锁 |
| Token 预算管理 | 基于消息特征的 simple/complex 模型分级路由 |
| 持久化记忆 | sqlite-vec 向量搜索 + 本地嵌入（all-MiniLM-L6-v2） |

### P2 应做

| 功能 | 说明 |
| ---- | ---- |
| 定时任务系统 | Cron 解析 + 延迟队列 + `/schedule` |
| 自然语言命令 | CommandBridge + system-commands skill |
| 飞书 / 钉钉渠道 | WSClient / Stream 长连接，零公网 IP |
| Web Search | SearchBridge + web-search skill（Brave + 抓取 + Haiku 摘要） |
| Web Dashboard | htmx + Pico CSS，成本/任务/健康监控，零新依赖 |
| Skill 系统 | 注册表 + 权限校验 + 只读卷挂载 |
| Apple Container | macOS 原生容器运行时 |

### P3 可做

| 功能 | 说明 |
| ---- | ---- |
| 一键部署 | Docker Compose + systemd + setup/upgrade 脚本 + CI/CD |
| 知识图谱记忆 | SQLite 实体-关系图存储 + 三元组提取 + 图谱遍历召回（迁移 v4） |
| 多 Agent 编排 | TaskExecutor 抽象 + Orchestrator（自动复杂度检测 + Haiku 拆解 + 枢纽辐射有界并发 + 结果综合） |

## 工程指标（阶段末）

- 代码量约 9,000 行，仍在可审计范围（目标 ≤ 10,000）
- 测试 293 个，全绿
- 生产依赖 12 个（上限 50）
- 零外部数据库依赖（SQLite 单文件，迁移至 v4）

## 关联 OpenSpec changes（已归档）

`context-compression-and-memory` · `multi-model-and-routing` · `apple-container-support` · `skill-system` · `nl-command-bridge` · `web-search-bridge` · `knowledge-graph-memory` · `multi-agent-orchestration`
