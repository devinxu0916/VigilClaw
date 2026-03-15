import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillRegistry } from '../../src/skill-registry.js';
import { VigilClawDB } from '../../src/db.js';
import type { SkillManifest, SkillPermission, SkillToolDefinition } from '../../src/skill-types.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(dir: string, manifest: unknown): void {
  fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify(manifest));
}

function createTempSkill(
  name = 'test-skill',
  options?: {
    version?: string;
    permissions?: SkillPermission[];
    tools?: SkillToolDefinition[];
    entrypoint?: string;
    createEntrypoint?: boolean;
  },
): string {
  const dir = createTempDir('skill-');
  const manifest: SkillManifest = {
    name,
    version: options?.version ?? '1.0.0',
    description: 'Test skill',
    permissions: options?.permissions ?? ['read'],
    tools: options?.tools ?? [
      {
        name: `${name}_tool`,
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'test' },
          },
        },
      },
    ],
  };
  if (options?.entrypoint) {
    manifest.entrypoint = options.entrypoint;
  }
  writeManifest(dir, manifest);
  const entryFile = manifest.entrypoint ?? 'index.js';
  if (options?.createEntrypoint ?? true) {
    fs.writeFileSync(path.join(dir, entryFile), 'module.exports.execute = async () => "ok";');
  }
  return dir;
}

describe('SkillRegistry', () => {
  let db: VigilClawDB;
  let registry: SkillRegistry;
  let skillsDir: string;

  beforeEach(() => {
    db = new VigilClawDB(':memory:');
    skillsDir = createTempDir('skills-dir-');
    registry = new SkillRegistry(db, skillsDir);
  });

  afterEach(() => {
    db.close();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('validateManifest', () => {
    it('accepts a valid manifest', () => {
      const manifest: SkillManifest = {
        name: 'valid-skill',
        version: '1.0.0',
        description: 'Valid',
        permissions: ['read'],
        tools: [
          {
            name: 'valid_tool',
            description: 'Valid tool',
            input_schema: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'input' },
              },
            },
          },
        ],
      };
      expect(registry.validateManifest(manifest)).toEqual({ valid: true, errors: [] });
    });

    it('rejects missing name', () => {
      const manifest = {
        version: '1.0.0',
        description: 'Bad',
        permissions: ['read'],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      };
      const result = registry.validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or invalid "name"');
    });

    it('rejects invalid version', () => {
      const manifest: SkillManifest = {
        name: 'bad-version',
        version: '1.0',
        description: 'Bad',
        permissions: ['read'],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      };
      const result = registry.validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Version must be semver (x.y.z)');
    });

    it('rejects missing tools', () => {
      const manifest: SkillManifest = {
        name: 'no-tools',
        version: '1.0.0',
        description: 'Bad',
        permissions: ['read'],
        tools: [],
      };
      const result = registry.validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or empty "tools" array');
    });

    it('rejects invalid permission', () => {
      const manifest = {
        name: 'bad-permission',
        version: '1.0.0',
        description: 'Bad',
        permissions: ['read', 'unknown'],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      };
      const result = registry.validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid permission: "unknown"');
    });
  });

  describe('installSkill', () => {
    it('installs a valid skill', () => {
      const source = createTempSkill('install-skill');
      const result = registry.installSkill(source, 'tester');
      expect(result).toEqual({ success: true });
      const info = registry.getSkillInfo('install-skill');
      expect(info?.manifest.name).toBe('install-skill');
      expect(info?.enabled).toBe(true);
    });

    it('fails when skill.json is missing', () => {
      const source = createTempDir('skill-missing-json-');
      const result = registry.installSkill(source, 'tester');
      expect(result.success).toBe(false);
      expect(result.error).toContain('skill.json not found');
    });

    it('fails when manifest is invalid', () => {
      const source = createTempDir('skill-invalid-');
      writeManifest(source, {
        version: '1.0.0',
        description: 'Invalid',
        permissions: ['read'],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      });
      fs.writeFileSync(path.join(source, 'index.js'), 'module.exports.execute = async () => "ok";');
      const result = registry.installSkill(source, 'tester');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid manifest');
    });

    it('fails when entrypoint is missing', () => {
      const source = createTempSkill('missing-entry', {
        entrypoint: 'missing.js',
        createEntrypoint: false,
      });
      const result = registry.installSkill(source, 'tester');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Entrypoint "missing.js" not found');
    });
  });

  describe('removeSkill', () => {
    it('removes an installed skill', () => {
      const source = createTempSkill('remove-skill');
      registry.installSkill(source, 'tester');
      const result = registry.removeSkill('remove-skill');
      expect(result).toEqual({ success: true });
      expect(registry.getSkillInfo('remove-skill')).toBeNull();
    });

    it('fails when skill is missing', () => {
      const result = registry.removeSkill('missing-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('enableSkill/disableSkill', () => {
    it('toggles skill enabled state', () => {
      const source = createTempSkill('toggle-skill');
      registry.installSkill(source, 'tester');

      expect(registry.disableSkill('toggle-skill')).toEqual({ success: true });
      expect(registry.disableSkill('toggle-skill').success).toBe(false);
      expect(registry.enableSkill('toggle-skill')).toEqual({ success: true });
      expect(registry.enableSkill('toggle-skill').success).toBe(false);
    });
  });

  describe('listSkills', () => {
    it('returns an empty list when none installed', () => {
      expect(registry.listSkills()).toEqual([]);
    });

    it('returns installed skills', () => {
      const source = createTempSkill('listed-skill');
      registry.installSkill(source, 'tester');
      const list = registry.listSkills();
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('listed-skill');
      expect(list[0]?.enabled).toBe(true);
    });
  });

  describe('getSkillInfo', () => {
    it('returns info when skill exists', () => {
      const source = createTempSkill('info-skill');
      registry.installSkill(source, 'tester');
      const info = registry.getSkillInfo('info-skill');
      expect(info?.manifest.name).toBe('info-skill');
      expect(info?.enabled).toBe(true);
    });

    it('returns null when skill missing', () => {
      expect(registry.getSkillInfo('missing')).toBeNull();
    });
  });

  describe('checkToolConflicts', () => {
    it('detects built-in tool conflicts', () => {
      const conflicts = registry.checkToolConflicts(['bash']);
      expect(conflicts).toContain('"bash" conflicts with built-in tool');
    });

    it('returns empty when no conflicts', () => {
      expect(registry.checkToolConflicts(['unique_tool'])).toEqual([]);
    });
  });

  describe('upgradeSkill', () => {
    it('upgrades an installed skill', () => {
      const source = createTempSkill('upgrade-skill');
      registry.installSkill(source, 'tester');

      const upgradeSource = createTempSkill('upgrade-skill', { version: '2.0.0' });
      const result = registry.upgradeSkill('upgrade-skill', upgradeSource);
      expect(result).toEqual({ success: true });

      const info = registry.getSkillInfo('upgrade-skill');
      expect(info?.manifest.version).toBe('2.0.0');
    });

    it('fails when skill is missing', () => {
      const source = createTempSkill('missing-upgrade');
      const result = registry.upgradeSkill('unknown', source);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
