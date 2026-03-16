# Apple Container 集成踩坑记录

> 日期：2026-03-16 | 阶段：Phase 2 Apple Container

---

## 背景

为 VigilClaw 添加 Apple Container（macOS 26 原生容器）作为 Docker 的替代运行时。实现了 AppleContainerRunner 后进行 E2E 验证，遇到 3 个问题。

---

## 坑点 1：`container` CLI 命令与 Docker 不兼容

**现象**：`ping()` 方法始终返回 false，导致 Apple Container 运行时检测失败，回退到 Docker。

**根因**：Apple Container CLI 的子命令与 Docker 不同：

- `container system info` 不存在，正确命令是 `container system status`
- `container ls` 不存在，正确命令是 `container list`
- `container rm` 不存在，正确命令是 `container delete`
- `container stop -t 3` 的 flag 是 `--time` 不是 `-t`

**修复**：逐个修正 CLI 命令调用，通过 `container --help` 验证每个子命令。

**预防**：集成第三方 CLI 时，先跑一遍 `--help` 确认全部子命令和 flag，不要假设与同类工具兼容。

---

## 坑点 2：环境变量映射缺失

**现象**：`.env` 中设置了 `VIGILCLAW_CONTAINER_RUNTIME=apple`，但日志仍显示 `"runtime":"docker"`。

**根因**：`config.ts` 的 `directMappings` 中没有 `VIGILCLAW_CONTAINER_RUNTIME` 到 `['docker', 'runtime']` 的映射。环境变量被静默忽略。

**修复**：在 `directMappings` 中添加 `VIGILCLAW_CONTAINER_RUNTIME: ['docker', 'runtime']`。

**预防**：每次在 config schema 中新增字段时，同步检查是否需要添加 env 变量映射。

---

## 坑点 3：容器内无法访问宿主机 Credential Proxy

**现象**：容器启动成功但返回 `Agent error: Connection error`。

**根因**：两个问题叠加：

1. Credential Proxy 监听 `127.0.0.1`，Apple Container 的 VM 通过真实网络（`192.168.64.x`）访问，无法连到 `127.0.0.1`
2. `host.container.internal` DNS 在 Apple Container 中不可用（与 Docker Desktop 的 `host.docker.internal` 不同）

Docker Desktop 能工作是因为它有特殊的 host 网络桥接机制，自动处理 `host.docker.internal` 解析。Apple Container 用的是标准 VM 网络，没有这种魔法。

**修复**：

1. Proxy 改为监听 `0.0.0.0`
2. 通过在容器内执行 `ip route` 获取默认网关 IP（即宿主机 IP：`192.168.64.1`）

**预防**：容器网络架构假设要明确文档化。不同容器运行时的宿主访问机制差异很大。

---

## 总结

| #   | 类别       | 耗时  | 可预防           |
| --- | ---------- | ----- | ---------------- |
| 1   | CLI 兼容性 | 10min | ✅ 先验证 --help |
| 2   | 配置遗漏   | 5min  | ✅ checklist     |
| 3   | 网络架构   | 20min | ⚠️ 需要实际测试  |

**最大教训**：Apple Container 是真正的轻量级 VM，网络模型与 Docker Desktop 的用户空间代理完全不同 — 不要假设 Docker 的网络魔法（host.docker.internal）在其他运行时也存在。
