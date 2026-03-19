import { loadConfig } from './config.js';
import { parseMasterKey, encrypt } from './crypto.js';
import { VigilClawDB } from './db.js';
import { CredentialProxy } from './credential-proxy.js';
import { CostGuard } from './cost-guard.js';
import { SessionManager } from './session-manager.js';
import { SecurityLogger } from './security-logger.js';
import { ContainerRunner } from './container-runner.js';
import { LocalRunner } from './local-runner.js';
import { AppleContainerRunner } from './apple-container-runner.js';
import type { IRunner } from './runner-types.js';
import { GroupQueue } from './group-queue.js';
import { SkillRegistry } from './skill-registry.js';
import { TaskScheduler } from './task-scheduler.js';
import { RateLimiter } from './rate-limiter.js';
import { Router } from './router.js';
import { TelegramChannel } from './channels/telegram.js';
import { FeishuChannel } from './channels/feishu.js';
import { DingTalkChannel } from './channels/dingtalk.js';
import { startHealthServer } from './health.js';
import { ClaudeProvider } from './provider/claude.js';
import { createProvider } from './provider/factory.js';
import type { ProviderType } from './provider/factory.js';
import { ContextCompressor } from './context-compressor.js';
import { Embedder } from './embedder.js';
import { MemoryStore } from './memory-store.js';
import { logger } from './logger.js';
import type { IChannel } from './channels/types.js';
import type { QueuedTask } from './types.js';

async function main(): Promise<void> {
  logger.info('VigilClaw starting...');

  const config = loadConfig();
  const masterKey = parseMasterKey(config.masterKey);

  const db = new VigilClawDB(config.dbPath);
  logger.info({ dbPath: config.dbPath }, 'Database initialized');

  seedCredentialsFromEnv(db, masterKey);

  const credentialProxy = new CredentialProxy(db, masterKey);
  const costGuard = new CostGuard(db);
  const sessionManager = new SessionManager(db, config.session.contextLength);
  const securityLogger = new SecurityLogger(db);

  const summaryProvider = new ClaudeProvider();

  const compressor = new ContextCompressor(summaryProvider, db, {
    maxContextTokens: config.session.maxContextTokens,
    recentMessagesKeep: config.session.recentMessagesKeep,
  });
  sessionManager.setCompressor(compressor);

  const embedder = new Embedder(config.memory.embeddingModel);
  const memoryStore = new MemoryStore(db, embedder, summaryProvider, {
    enabled: config.memory.enabled,
    similarityThreshold: config.memory.similarityThreshold,
    maxRecallCount: config.memory.maxRecallCount,
  });
  if (config.memory.enabled) {
    sessionManager.setMemoryStore(memoryStore);
  }

  const containerRunner = new ContainerRunner(config.docker, credentialProxy, config.dataDir);
  const appleRunner = new AppleContainerRunner(config.docker, credentialProxy, config.dataDir);
  const localRunner = new LocalRunner(db, masterKey);

  const runner = await selectRunner(
    config.docker.runtime,
    appleRunner,
    containerRunner,
    localRunner,
  );
  const runtimeType =
    runner === appleRunner ? 'apple' : runner === containerRunner ? 'docker' : 'local';

  logger.info({ runtime: runtimeType }, 'Runtime selected');

  if (runtimeType === 'local') {
    logger.warn('Using local runner (no container isolation)');
  }

  const groupQueue = new GroupQueue(config.maxConcurrentContainers);

  groupQueue.setExecutor(async (task: QueuedTask) => {
    db.updateTaskRunning(task.id, `vigilclaw-${task.id.slice(0, 12)}`);

    try {
      const result = await runner.runTask(task);

      const providerForCost = await createProvider(task.provider as ProviderType).catch(
        () => summaryProvider,
      );
      const cost = providerForCost.estimateCost(
        result.response.usage.inputTokens,
        result.response.usage.outputTokens,
        result.response.model,
      );

      db.recordApiCall({
        taskId: task.id,
        userId: task.userId,
        groupId: task.groupId,
        provider: task.provider,
        model: result.response.model,
        inputTokens: result.response.usage.inputTokens,
        outputTokens: result.response.usage.outputTokens,
        costUsd: cost,
      });

      db.updateTaskCompleted(task.id, 'completed', {
        outputSummary: result.response.content.slice(0, 200),
        totalCost: cost,
      });

      sessionManager.saveAssistantMessage(task.userId, task.groupId, result.response.content);
      await task.replyFn(result.response.content);

      if (config.memory.enabled) {
        const lastUserMsg = [...task.messages].reverse().find((m) => m.role === 'user');
        if (lastUserMsg) {
          void memoryStore.extractMemory(
            task.userId,
            task.groupId,
            lastUserMsg.content,
            result.response.content,
          );
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      db.updateTaskCompleted(task.id, 'failed', { error: errorMsg });
      securityLogger.log({
        eventType: 'task_timeout',
        userId: task.userId,
        severity: 'medium',
        details: { taskId: task.id, error: errorMsg },
      });

      await task.replyFn(`⚠️ 任务执行失败: ${errorMsg}`);
    }
  });

  const taskScheduler = new TaskScheduler(db, groupQueue);
  const rateLimiter = new RateLimiter(config.rateLimit);

  const defaultProvider = config.provider.default;
  const defaultModelConfig = config.provider[defaultProvider] as { model: string };
  const defaultModel = `${defaultProvider}:${defaultModelConfig.model}`;

  const router = new Router(db, costGuard, sessionManager, groupQueue, rateLimiter, defaultModel);

  router.setMasterKey(masterKey);
  router.setRoutingConfig(config.routing);

  const skillRegistry = new SkillRegistry(db);
  router.setSkillRegistry(skillRegistry);

  // 管理员统一收集（支持多渠道）
  const adminUsers: string[] = [];
  if (config.telegram.allowedUsers.length > 0) {
    adminUsers.push(...config.telegram.allowedUsers.map((id) => `telegram:${id}`));
  }
  if (config.feishu?.enabled && config.feishu.allowedUsers.length > 0) {
    adminUsers.push(...config.feishu.allowedUsers.map((id) => `feishu:${id}`));
  }
  if (config.dingtalk?.enabled && config.dingtalk.allowedUsers.length > 0) {
    adminUsers.push(...config.dingtalk.allowedUsers.map((id) => `dingtalk:${id}`));
  }
  if (adminUsers.length > 0) {
    router.setAdminUsers(adminUsers);
  }

  const channels: IChannel[] = [];

  if (config.telegram.enabled) {
    const telegram = new TelegramChannel(config.telegram);
    telegram.onMessage((msg) => router.handleMessage(msg));
    router.registerChannel(telegram);
    channels.push(telegram);
  }

  if (config.feishu?.enabled) {
    const feishu = new FeishuChannel(config.feishu);
    feishu.onMessage((msg) => router.handleMessage(msg));
    router.registerChannel(feishu);
    channels.push(feishu);
  }

  if (config.dingtalk?.enabled) {
    const dingtalk = new DingTalkChannel(config.dingtalk);
    dingtalk.onMessage((msg) => router.handleMessage(msg));
    router.registerChannel(dingtalk);
    channels.push(dingtalk);
  }

  for (const channel of channels) {
    await channel.start();
  }

  taskScheduler.setChannelRegistry({
    async sendToUser(userId: string, groupId: string | null, text: string): Promise<void> {
      for (const channel of channels) {
        try {
          await channel.sendMessage(userId, groupId ?? undefined, text);
          return;
        } catch (err) {
          logger.error({ err, channel: channel.name }, 'Failed to send scheduled task reply');
        }
      }
    },
  });
  router.setTaskScheduler(taskScheduler);

  taskScheduler.start();

  if (runtimeType !== 'local') {
    startHealthServer(
      config.healthPort,
      db,
      (containerRunner as unknown as { docker: import('dockerode') }).docker,
    );
  }

  const cleanupInterval = setInterval(() => {
    const hour = new Date().getUTCHours();
    if (hour === 3) {
      db.cleanupOldData();
      rateLimiter.cleanup();
    }
  }, 3600_000);
  cleanupInterval.unref();

  setupGracefulShutdown(channels, containerRunner, credentialProxy, taskScheduler, db);

  logger.info(
    {
      telegram: config.telegram.enabled,
      feishu: config.feishu?.enabled ?? false,
      dingtalk: config.dingtalk?.enabled ?? false,
      docker: runtimeType !== 'local',
      maxConcurrent: config.maxConcurrentContainers,
      model: config.provider.claude.model,
    },
    'VigilClaw started',
  );
}

function seedCredentialsFromEnv(db: VigilClawDB, masterKey: Buffer): void {
  const envMappings: Record<string, string> = {
    ANTHROPIC_API_KEY: 'anthropic',
    ANTHROPIC_AUTH_TOKEN: 'anthropic.auth_token',
    ANTHROPIC_BASE_URL: 'anthropic.base_url',
  };

  for (const [envVar, credKey] of Object.entries(envMappings)) {
    const value = process.env[envVar];
    if (!value) continue;

    const existing = db.getCredential(credKey);
    if (existing) continue;

    const { encrypted, iv } = encrypt(value, masterKey);
    db.upsertCredential(credKey, encrypted, iv);
    logger.info({ credKey }, 'Credential seeded from environment');
  }
}

function setupGracefulShutdown(
  channels: IChannel[],
  containerRunner: ContainerRunner,
  credentialProxy: CredentialProxy,
  taskScheduler: TaskScheduler,
  db: VigilClawDB,
): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');

    for (const channel of channels) {
      try {
        await channel.stop();
      } catch (err) {
        logger.error({ err }, 'Error stopping channel');
      }
    }

    taskScheduler.stop();
    await containerRunner.drainAll(30_000);
    await credentialProxy.destroyAll();
    db.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function selectRunner(
  runtime: string,
  appleRunner: IRunner,
  dockerRunner: IRunner,
  localRunner: IRunner,
): Promise<IRunner> {
  if (process.env.VIGILCLAW_LOCAL_MODE === 'true') return localRunner;

  switch (runtime) {
    case 'apple':
      if (await appleRunner.ping()) return appleRunner;
      throw new Error('Apple Container runtime not available');
    case 'docker':
      if (await dockerRunner.ping()) return dockerRunner;
      throw new Error('Docker runtime not available');
    case 'local':
      return localRunner;
    case 'auto':
    default:
      if (process.platform === 'darwin' && (await appleRunner.ping())) return appleRunner;
      if (await dockerRunner.ping()) return dockerRunner;
      return localRunner;
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start VigilClaw');
  process.exit(1);
});
