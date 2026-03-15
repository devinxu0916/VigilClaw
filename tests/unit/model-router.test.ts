import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyTask, routeModel } from '../../src/model-router.js';
import type { Message } from '../../src/types.js';

vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn() },
}));

const factoryMocks = vi.hoisted(() => ({
  parseProviderModel: vi.fn(),
  getCheapModel: vi.fn(),
}));

vi.mock('../../src/provider/factory.js', () => ({
  parseProviderModel: factoryMocks.parseProviderModel,
  getCheapModel: factoryMocks.getCheapModel,
}));

beforeEach(() => {
  factoryMocks.parseProviderModel.mockReset();
  factoryMocks.getCheapModel.mockReset();
});

afterEach(() => {
  factoryMocks.parseProviderModel.mockReset();
  factoryMocks.getCheapModel.mockReset();
});

describe('classifyTask', () => {
  it('should classify short message without code as simple', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello world' }];
    expect(classifyTask(messages, 500)).toBe('simple');
  });

  it('should classify long message as complex', () => {
    const messages: Message[] = [{ role: 'user', content: 'a'.repeat(500) }];
    expect(classifyTask(messages, 500)).toBe('complex');
  });

  it('should classify short message with code block as complex', () => {
    const messages: Message[] = [{ role: 'user', content: 'Example:\n```js\nconst x = 1;\n```' }];
    expect(classifyTask(messages, 500)).toBe('complex');
  });

  it('should return simple for empty messages', () => {
    expect(classifyTask([], 500)).toBe('simple');
  });
});

describe('routeModel', () => {
  it('should return user model when routing disabled', () => {
    const result = routeModel({
      userModel: 'claude:claude-sonnet',
      messages: [],
      routingConfig: { enabled: false },
    });
    expect(result).toBe('claude:claude-sonnet');
  });

  it('should return simple model for simple tasks', () => {
    factoryMocks.parseProviderModel.mockReturnValue({ provider: 'openai', model: 'gpt-4o' });

    const result = routeModel({
      userModel: 'openai:gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      routingConfig: { enabled: true, simpleModel: 'openai:gpt-4o-mini' },
    });

    expect(result).toBe('openai:gpt-4o-mini');
  });

  it('should return complex model or fallback to user model', () => {
    factoryMocks.parseProviderModel.mockReturnValue({ provider: 'openai', model: 'gpt-4o' });

    const result = routeModel({
      userModel: 'openai:gpt-4o',
      messages: [{ role: 'user', content: 'a'.repeat(600) }],
      routingConfig: { enabled: true, complexModel: 'openai:o1-preview' },
    });

    expect(result).toBe('openai:o1-preview');

    const fallback = routeModel({
      userModel: 'openai:gpt-4o',
      messages: [{ role: 'user', content: 'a'.repeat(600) }],
      routingConfig: { enabled: true },
    });

    expect(fallback).toBe('openai:gpt-4o');
  });

  it('should return cheap model when simple without simpleModel', () => {
    factoryMocks.parseProviderModel.mockReturnValue({ provider: 'openai', model: 'gpt-4o' });
    factoryMocks.getCheapModel.mockReturnValue('openai:gpt-4o-mini');

    const result = routeModel({
      userModel: 'openai:gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      routingConfig: { enabled: true },
    });

    expect(factoryMocks.getCheapModel).toHaveBeenCalledWith('openai', 'openai:gpt-4o');
    expect(result).toBe('openai:gpt-4o-mini');
  });
});
