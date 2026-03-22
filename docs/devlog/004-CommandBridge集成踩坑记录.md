# CommandBridge 自然语言命令集成踩坑记录

> 日期：2026-03-22 | 阶段：Phase 2 NL Command Bridge

---

## 背景

实现 CommandBridge 功能后，Agent 应能用自然语言执行系统命令（创建定时任务、管理 Skill 等）。集成测试时发现 Agent 回复"无法在容器环境中设置系统定时任务"，未调用任何 `system_*` 工具。

---

## 坑点 1：Dockerfile 缺少 `/skills` 目录导致 bind mount 失败

**现象**：Agent 收到消息后未使用任何 `system_schedule_*` 工具，回复称无法操作。

**调试过程**：

1. `loadSkillTools()` 在容器内已正确处理 `codePath`，当 `codePath !== 'built-in'` 时使用该路径
2. 对于 `codePath === 'built-in'` 时，回退到 `/skills/${skill.name}/index.js`
3. ContainerRunner/AppleContainerRunner 将 stub 挂载到 `/skills/system-commands:ro`
4. **关键发现**：Dockerfile 中只创建了 `/ipc`、`/workspace`、`/tmp`，没有 `/skills`

**根因**：Apple Container Runtime 是真正的轻量 VM（Virtualization.framework），对 bind mount 的路径处理与 Docker Desktop 不同。当容器镜像内不存在 `/skills` 目录时，`${stubDir}:/skills/system-commands:ro` 挂载失败或被静默忽略，导致容器内 `/skills/system-commands/index.js` 不存在，`loadSkillTools()` 输出 console.error 后跳过该 skill，Agent 最终看不到任何 `system_*` 工具。

**修复**：在 Dockerfile 中添加 `/skills` 目录并赋予 agent 用户权限：

```dockerfile
RUN mkdir -p /ipc/input /ipc/output /workspace /tmp /skills && \
    chown -R agent:agent /ipc /workspace /tmp /skills
```

然后重建镜像（`pnpm apple:build`）。

**预防**：
- 容器内所有可能的 bind mount 目标路径，必须在 Dockerfile 中预先创建
- Apple Container 等 VM 型运行时对不存在路径的 bind mount 支持不稳定，应视为不支持
- 新增 volume mount 时同步检查 Dockerfile，这是容易遗漏的检查项

---

## 坑点 2：未提交的调试修改混入导致排查困难

**现象**：上一个会话对 `container-runner.ts` 和 `apple-container-runner.ts` 做了未提交的修改（改为 codePath 重写方案，移除了 `/skills/system-commands` 挂载），导致本次排查需要先 `git checkout HEAD` 恢复。

**根因**：在确定根本原因之前就修改了生产代码，且未及时 commit。

**预防**：
- 调试过程中的试验性修改应在独立分支或确认有效后再提交
- 如需临时改变方案，应明确注释或用 `git stash` 暂存

---

## 总结

| # | 类别 | 描述 | 修复 |
|---|------|------|------|
| 1 | Dockerfile 遗漏 | `/skills` 目录未创建，bind mount 失败 | 加入 mkdir /skills |
| 2 | 调试流程 | 未提交修改混淆排查思路 | git checkout 恢复 + 增量调试 |

**关键教训**：添加新的 bind mount 路径时，必须同步更新 Dockerfile 在容器内预创建该路径。对于 VM 型容器运行时（Apple Container、Kata Containers 等），绝对不能假设 Docker Desktop 的自动目录创建行为同样适用。
