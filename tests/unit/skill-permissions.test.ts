import { describe, it, expect } from 'vitest';
import {
  validatePermissions,
  formatPermissionsDisplay,
  logSkillExecution,
} from '../../src/skill-permissions.js';
import type { SkillManifest } from '../../src/skill-types.js';

describe('skill-permissions', () => {
  describe('validatePermissions', () => {
    it('accepts valid permissions', () => {
      const result = validatePermissions(['read', 'write']);
      expect(result).toEqual({ valid: true, invalid: [] });
    });

    it('rejects invalid permissions', () => {
      const result = validatePermissions(['read', 'unknown']);
      expect(result.valid).toBe(false);
      expect(result.invalid).toEqual(['unknown']);
    });

    it('handles empty permissions array', () => {
      const result = validatePermissions([]);
      expect(result).toEqual({ valid: true, invalid: [] });
    });
  });

  describe('formatPermissionsDisplay', () => {
    it('formats permissions list', () => {
      const manifest: SkillManifest = {
        name: 'perm-skill',
        version: '1.0.0',
        description: 'Permissions',
        permissions: ['read', 'bash'],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      };
      const display = formatPermissionsDisplay(manifest);
      expect(display).toContain('请求权限');
      expect(display).toContain('read');
      expect(display).toContain('bash');
    });

    it('formats empty permissions', () => {
      const manifest: SkillManifest = {
        name: 'empty',
        version: '1.0.0',
        description: 'Empty',
        permissions: [],
        tools: [
          {
            name: 'tool',
            description: 'Tool',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      };
      expect(formatPermissionsDisplay(manifest)).toBe('请求权限:\n');
    });
  });

  describe('logSkillExecution', () => {
    it('does not throw', () => {
      expect(() =>
        logSkillExecution({
          skillName: 'logger-skill',
          toolName: 'logger-tool',
          userId: 'user-1',
          status: 'success',
          duration: 120,
        }),
      ).not.toThrow();
    });
  });
});
