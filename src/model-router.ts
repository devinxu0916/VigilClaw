import type { Message } from './types.js';
import { parseProviderModel, getCheapModel } from './provider/factory.js';
import { logger } from './logger.js';

export function classifyTask(
  messages: Message[],
  thresholdChars: number = 500,
): 'simple' | 'complex' {
  const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1);

  if (!lastUserMessage) {
    return 'simple';
  }

  const content = lastUserMessage.content;

  // Check if content has code blocks
  const hasCodeBlocks = /```[\s\S]*?```/.test(content) || /^  \S+.*$/m.test(content);

  // Simple if short and no code
  if (content.length < thresholdChars && !hasCodeBlocks) {
    return 'simple';
  }

  return 'complex';
}

export interface RoutingConfig {
  enabled: boolean;
  simpleModel?: string;
  complexModel?: string;
  simpleThresholdChars?: number;
}

export function routeModel(params: {
  userModel: string;
  messages: Message[];
  routingConfig: RoutingConfig;
}): string {
  if (!params.routingConfig.enabled) {
    return params.userModel;
  }

  const classification = classifyTask(
    params.messages,
    params.routingConfig.simpleThresholdChars ?? 500,
  );
  const parsed = parseProviderModel(params.userModel);

  let selectedModel: string;

  if (classification === 'simple') {
    selectedModel =
      params.routingConfig.simpleModel ?? getCheapModel(parsed.provider, params.userModel);
  } else {
    selectedModel = params.routingConfig.complexModel ?? params.userModel;
  }

  logger.info(
    {
      taskClassification: classification,
      userModel: params.userModel,
      selectedModel,
    },
    'Model routing decision',
  );

  return selectedModel;
}
