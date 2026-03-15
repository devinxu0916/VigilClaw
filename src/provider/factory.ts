import type { IProvider } from './types.js';
import { ClaudeProvider } from './claude.js';

export type ProviderType = 'claude' | 'openai' | 'ollama';

export interface ParsedModel {
  provider: ProviderType;
  model: string;
}

const CHEAP_MODELS: Record<ProviderType, string> = {
  claude: 'claude-haiku-3-5-20250929',
  openai: 'gpt-4o-mini',
  ollama: '',
};

export function parseProviderModel(identifier: string): ParsedModel {
  const colonIdx = identifier.indexOf(':');
  if (colonIdx > 0) {
    const provider = identifier.slice(0, colonIdx) as ProviderType;
    const model = identifier.slice(colonIdx + 1);
    if (['claude', 'openai', 'ollama'].includes(provider)) {
      return { provider, model };
    }
  }
  return { provider: 'claude', model: identifier };
}

export function formatProviderModel(provider: ProviderType, model: string): string {
  return `${provider}:${model}`;
}

export function getCheapModel(providerType: ProviderType, fallbackModel?: string): string {
  return CHEAP_MODELS[providerType] || fallbackModel || '';
}

export async function createProvider(
  type: ProviderType,
  config?: { apiKey?: string; baseURL?: string; baseUrl?: string },
): Promise<IProvider> {
  switch (type) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(config);
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./ollama.js');
      return new OllamaProvider({ baseUrl: config?.baseUrl ?? config?.baseURL });
    }
    default:
      throw new Error(`Unknown provider type: ${type as string}`);
  }
}
