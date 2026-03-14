import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string().min(1),
  allowedUsers: z.array(z.string()).default([]),
  allowedGroups: z.array(z.string()).default([]),
  mode: z.enum(['polling', 'webhook']).default('polling'),
  webhookUrl: z.string().optional(),
});

export const DockerConfigSchema = z.object({
  socketPath: z.string().default('/var/run/docker.sock'),
  image: z.string().default('vigilclaw/agent-runner:latest'),
  memoryLimit: z.number().default(512 * 1024 * 1024),
  cpuQuota: z.number().default(100_000),
  cpuPeriod: z.number().default(100_000),
  pidsLimit: z.number().default(100),
  taskTimeout: z.number().default(300_000),
  networkWhitelist: z.array(z.string()).default(['api.anthropic.com']),
});

export const ProviderConfigSchema = z.object({
  default: z.enum(['claude']).default('claude'),
  claude: z
    .object({
      model: z.string().default('claude-sonnet-4-5-20250929'),
      maxTokens: z.number().default(4096),
    })
    .default({}),
});

export const CostConfigSchema = z.object({
  maxCostPerTask: z.number().default(1.0),
  maxCostPerDay: z.number().default(10.0),
  maxCostPerMonth: z.number().default(100.0),
  budgetResetHour: z.number().min(0).max(23).default(0),
});

export const SessionConfigSchema = z.object({
  contextLength: z.number().default(50),
  idleTimeout: z.number().default(1800_000),
  maxContextTokens: z.number().default(6000),
  recentMessagesKeep: z.number().default(6),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  similarityThreshold: z.number().min(0).max(1).default(0.3),
  maxRecallCount: z.number().default(5),
  embeddingModel: z.string().default('Xenova/all-MiniLM-L6-v2'),
});

export const RateLimitConfigSchema = z.object({
  perUser: z.number().default(10),
  perGroup: z.number().default(30),
  global: z.number().default(100),
});

export const ConfigSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  dbPath: z.string().default('./data/vigilclaw.db'),
  masterKey: z.string().min(64),
  dataDir: z.string().default('./data'),
  telegram: TelegramConfigSchema,
  docker: DockerConfigSchema.default({}),
  provider: ProviderConfigSchema.default({}),
  cost: CostConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  maxConcurrentContainers: z.number().default(5),
  rateLimit: RateLimitConfigSchema.default({}),
  healthPort: z.number().default(9100),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type DockerConfig = z.infer<typeof DockerConfigSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

function loadConfigFile(filePath: string): Record<string, unknown> {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return {};
    const content = fs.readFileSync(resolved, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function loadEnvConfig(): Record<string, unknown> {
  const prefix = 'VIGILCLAW_';
  const result: Record<string, unknown> = {};

  // 直接映射：环境变量名 → 配置路径
  // 解决下划线分隔与嵌套路径的歧义（如 MASTER_KEY → masterKey 而非 master.key）
  const directMappings: Record<string, string[]> = {
    VIGILCLAW_MASTER_KEY: ['masterKey'],
    VIGILCLAW_LOG_LEVEL: ['logLevel'],
    VIGILCLAW_DB_PATH: ['dbPath'],
    VIGILCLAW_DATA_DIR: ['dataDir'],
    VIGILCLAW_HEALTH_PORT: ['healthPort'],
    VIGILCLAW_MAX_CONCURRENT_CONTAINERS: ['maxConcurrentContainers'],
    VIGILCLAW_TELEGRAM_BOT_TOKEN: ['telegram', 'botToken'],
    VIGILCLAW_TELEGRAM_MODE: ['telegram', 'mode'],
    VIGILCLAW_TELEGRAM_WEBHOOK_URL: ['telegram', 'webhookUrl'],
    VIGILCLAW_DOCKER_SOCKET_PATH: ['docker', 'socketPath'],
    VIGILCLAW_DOCKER_IMAGE: ['docker', 'image'],
    VIGILCLAW_DOCKER_TASK_TIMEOUT: ['docker', 'taskTimeout'],
    ANTHROPIC_MODEL: ['provider', 'claude', 'model'],
    VIGILCLAW_MAX_CONTEXT_TOKENS: ['session', 'maxContextTokens'],
    VIGILCLAW_RECENT_MESSAGES_KEEP: ['session', 'recentMessagesKeep'],
    VIGILCLAW_MEMORY_ENABLED: ['memory', 'enabled'],
  };

  for (const [envKey, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    const configPath = directMappings[envKey];
    if (!configPath) continue;

    let current: Record<string, unknown> = result;
    for (let i = 0; i < configPath.length - 1; i++) {
      const segment = configPath[i]!;
      if (!(segment in current)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }

    const lastSegment = configPath[configPath.length - 1]!;
    if (value === 'true') current[lastSegment] = true;
    else if (value === 'false') current[lastSegment] = false;
    else if (/^\d+$/.test(value)) current[lastSegment] = parseInt(value, 10);
    else if (/^\d+\.\d+$/.test(value)) current[lastSegment] = parseFloat(value);
    else current[lastSegment] = value;
  }

  return result;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function loadConfig(configPath = './vigilclaw.config.json'): Config {
  const fileConfig = loadConfigFile(configPath);
  const envConfig = loadEnvConfig();
  const merged = deepMerge(fileConfig, envConfig);
  return ConfigSchema.parse(merged);
}
