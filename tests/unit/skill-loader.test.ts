import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTools, loadSkillTools } from '../../container/agent-runner/src/tools/index.js';
import type { TaskInput } from '../../container/agent-runner/src/types.js';

vi.mock('node:module', () => ({
  createRequire: () => {
    return () => ({
      execute: async () => 'wrapped',
    });
  },
}));

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeMockSkill(entryDir: string, content: string): string {
  const skillDir = path.join(entryDir, 'mock-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  const entryPath = path.join(skillDir, 'index.js');
  fs.writeFileSync(entryPath, content);
  return entryPath;
}

function createSkillInput(): NonNullable<TaskInput['skills']>[number] {
  return {
    name: 'mock-skill',
    version: '1.0.0',
    codePath: '/skills/mock-skill',
    tools: [
      {
        name: 'mock_tool',
        description: 'Mock tool',
        input_schema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'input' },
          },
        },
      },
    ],
  };
}

describe('skill-loader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('createTools returns built-in tools', () => {
    const tools = createTools(['bash', 'read', 'write', 'edit']);
    expect(tools.map((tool) => tool.name)).toEqual(['bash', 'read', 'write', 'edit']);
  });

  it('loadSkillTools returns empty when no skills', () => {
    expect(loadSkillTools([])).toEqual([]);
  });

  it('creates wrapper tool when module has execute', async () => {
    const dir = createTempDir('skills-');
    writeMockSkill(dir, "module.exports.execute = async () => 'wrapped';");

    const originalExistsSync = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => {
      if (target === '/skills/mock-skill/index.js') {
        return true;
      }
      return originalExistsSync(target as string);
    });

    const tools = loadSkillTools([createSkillInput()]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('mock_tool');
    const result = await tools[0]?.execute({});
    expect(result).toBe('wrapped');
  });
});
