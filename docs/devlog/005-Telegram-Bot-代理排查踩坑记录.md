# Telegram Bot 无响应排查与代理配置踩坑记录

> 日期：2026-04-11 | 阶段：本地开发调试

---

## 背景

在本地执行 `pnpm dev` 启动 VigilClaw 后，向 Telegram Bot 发送消息（包括 `/clear` 命令和普通消息）均无任何响应，整个排查过程历时约 1 小时。

---

## 坑点 1：僵尸进程占用端口导致新实例启动失败

**现象**：`pnpm dev` 启动后出现 `EADDRINUSE: address already in use 0.0.0.0:9100`，进程崩溃退出，Bot 无法正常工作。

**根因**：上一次 `pnpm dev` 使用 `tsx --watch` 模式运行，Ctrl+C 只终止了 tsx 父进程，子进程（实际的 VigilClaw Node.js 进程）没有被清理，残留进程持续占用健康检查端口 9100。

**修复**：手动 kill 僵尸进程后重新启动。
```bash
pkill -f "tsx.*src/index.ts"
```

**预防**：
- `pnpm dev` 之前先执行 `lsof -i :9100` 确认端口释放
- 或在 `.env` 中配置备用端口 `VIGILCLAW_HEALTH_PORT=9101`
- 考虑在 `health.ts` 的 Server 加 `server.unref()`，避免健康服务器阻止进程退出

---

## 坑点 2：Telegram Bot 静默无法建立 polling 连接

**现象**：进程启动后日志显示 "VigilClaw started"，但始终没有出现 "Telegram bot started (polling)" 日志；发送消息零日志输出；直接 `curl getUpdates` 成功（无 409 冲突，说明 grammY 根本没有在 polling）；kill 进程时出现 `Error: Aborted delay`（说明 bot 一直在 withRetries 的退避延迟中）。

**根因**：三层原因叠加：

1. **网络层**：机器配置了本地代理（`http://127.0.0.1:7890`，Clash/V2Ray 等），Telegram API 需要经过代理才能访问。
2. **环境变量层**：代理配置以小写形式存在（`https_proxy=http://127.0.0.1:7890`），`curl` 会自动读取小写代理变量，而 Node.js 原生 `fetch` **两种大小写都不读取**。
3. **grammY 层**：grammY 1.x 使用 `node-fetch` 而非 Node.js 内置 `fetch`，`node-fetch` 同样不读取代理环境变量。grammY 的 `bot.start()` 在正式 polling 前会先调用 `deleteWebhook`，该请求被 `withRetries` 包裹，网络超时后无限重试，`onStart` 回调永远不被触发，错误也不通过 `bot.catch` 传递（polling 级别错误走独立链路）。

**修复**：安装 `https-proxy-agent`，在 `TelegramChannel` 构造函数中检测代理环境变量，通过 grammY 的 `baseFetchConfig.agent` 选项注入代理 agent：

```typescript
// src/channels/telegram.ts
import { HttpsProxyAgent } from 'https-proxy-agent';

function buildBotOptions(): ConstructorParameters<typeof Bot>[1] {
  const proxyUrl =
    process.env['https_proxy'] ??
    process.env['HTTPS_PROXY'] ??
    process.env['http_proxy'] ??
    process.env['HTTP_PROXY'];
  if (!proxyUrl) return undefined;
  const agent = new HttpsProxyAgent(proxyUrl);
  return { client: { baseFetchConfig: { agent, compress: true } } };
}

// 构造时传入
this.bot = new Bot(config.botToken, buildBotOptions());
```

**预防**：
- 凡是用 Node.js 访问需要代理的外部服务（Telegram、OpenAI 等），**不能依赖环境变量自动生效**，必须显式配置
- 排查 Bot 不响应时，优先用 `curl` vs `node fetch` 对比：两者都通说明无代理问题，curl 通但 node 不通说明代理未透传

---

## 坑点 3：调试路径走了弯路——`setGlobalDispatcher` 无效

**现象**：尝试用 `undici` 的 `setGlobalDispatcher(new ProxyAgent(...))` 来全局设置代理，但对 grammY 无效。

**根因**：Node.js v22 内置 `fetch` 使用的是 Node.js **内部捆绑**的 undici，与 npm 上的 `undici` 包是**独立实例**，`setGlobalDispatcher` 只影响 npm 包实例，不影响内置 fetch。此外 grammY 根本不用内置 `fetch`，用的是 `node-fetch`，所以两个方向都打错了。

**预防**：看到 grammY 的 `shim.node.js`，直接确认它用的 HTTP 客户端类型：
```bash
grep "require\|fetch" node_modules/grammy/out/shim.node.js
# → var node_fetch_1 = require("node-fetch");  ← 确认使用 node-fetch
```

---

## 坑点 4：`bot.start()` 错误被 `void` 静默吞掉

**现象**：原代码 `void this.bot.start({...})` 导致 polling 错误完全不可见，既没有日志，也没有 unhandledRejection 警告。

**根因**：grammY 的 `bot.start()` 内部对 polling 错误做了重试处理，Promise 本身不 reject（只在内部循环中处理）。即使最终 reject，`void` 也会静默丢弃。

**修复**：改为显式 `.catch()` 捕获：
```typescript
this.bot.start({
  onStart: () => logger.info('Telegram bot started (polling)'),
}).catch((err: unknown) => {
  logger.error({ err }, 'Telegram bot polling failed');
});
```

**预防**：Bot 关键启动路径禁止用 `void` 丢弃 Promise，必须 `.catch()` 记录错误。

---

## 总结

| #   | 类别             | 耗时   | 可预防 |
| --- | ---------------- | ------ | ------ |
| 1   | 进程管理         | ~5 min | ✅     |
| 2   | 网络代理透传     | ~40 min | ✅    |
| 3   | undici 实例混淆  | ~10 min | ✅    |
| 4   | Promise 错误吞掉 | ~5 min | ✅     |

**最大教训**：Node.js 中没有任何一个 HTTP 客户端（内置 fetch、node-fetch、undici npm 包）会自动读取代理环境变量，代理必须在应用层**显式注入**；curl 能通不代表 Node.js 能通，这是排查网络问题时最容易被忽略的差异。
