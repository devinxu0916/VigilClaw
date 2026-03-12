# VigilClaw 文档中心

> 轻量、安全、可信赖的 OpenClaw 替代方案

---

## 快速导航

| 类别 | 文档 | 说明 |
|------|------|------|
| **项目规划** | [ROADMAP.md](./planning/ROADMAP.md) | 当前进度、里程碑、下一步计划 |
| **变更记录** | [CHANGELOG.md](./planning/CHANGELOG.md) | 版本变更历史 |
| **产品需求** | [VigilClaw-PRD.md](./product/VigilClaw-PRD.md) | 产品需求文档 (PRD) |
| **技术方案** | [技术方案索引](./architecture/VigilClaw-技术方案.md) | 4 篇技术方案总览 |
| **调研报告** | [research/](./research/) | 竞品分析、架构调研 |

---

## 文档结构

```
docs/
├── README.md                    # 本文件 - 文档入口
├── planning/                    # 项目规划与进度
│   ├── ROADMAP.md              # 路线图 + 当前进度（唯一进度真相源）
│   ├── CHANGELOG.md            # 版本变更记录 (Keep a Changelog)
│   └── milestones/             # 已完成里程碑归档
├── architecture/                # 技术方案
│   ├── VigilClaw-技术方案.md   # 索引文件
│   ├── 技术方案-第一篇-*.md    # 整体架构与模块设计
│   ├── 技术方案-第二篇-*.md    # 安全模型与容器隔离
│   ├── 技术方案-第三篇-*.md    # 数据模型与成本控制
│   └── 技术方案-第四篇-*.md    # 部署方案与工程规范
├── product/                     # 产品文档
│   └── VigilClaw-PRD.md        # 产品需求文档
└── research/                    # 调研报告
    ├── OpenClaw架构调研报告.md
    ├── OpenClaw用户痛点调研报告.md
    ├── OpenClaw轻量平替项目调研报告.md
    └── NanoClaw深度架构分析报告.md
```

---

## 文档状态总览

| 文档 | 版本 | 状态 | 最后更新 |
|------|------|------|---------|
| PRD | v1.0.0 | 待评审 | 2026-03-10 |
| 技术方案（4 篇） | v1.0.0 | ✅ 全部完成 | 2026-03-11 |
| ROADMAP | v1.0.0 | 规划中 | 2026-03-11 |
| 调研报告（4 篇） | v1.0.0 | ✅ 完成 | 2026-03-10 |

---

## 阅读顺序建议

1. **了解项目** → [PRD](./product/VigilClaw-PRD.md) — 产品定位、核心价值、用户画像
2. **了解进度** → [ROADMAP](./planning/ROADMAP.md) — 当前阶段、下一步计划
3. **深入架构** → [技术方案索引](./architecture/VigilClaw-技术方案.md) → 4 篇详细设计
4. **了解背景** → [research/](./research/) — 竞品分析与调研

---

## 文档维护规范

- **进度更新**：所有进度变更统一更新 `planning/ROADMAP.md`，不在其他文档中记录进度
- **版本变更**：每次发版更新 `planning/CHANGELOG.md`，遵循 [Keep a Changelog](https://keepachangelog.com) 格式
- **里程碑归档**：完成的里程碑从 ROADMAP 移至 `planning/milestones/` 目录
- **架构决策**：重大技术决策记录在技术方案的 ADR 附录中
