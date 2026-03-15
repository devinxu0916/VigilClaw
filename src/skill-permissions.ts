import type { SkillManifest, SkillPermission } from './skill-types.js';
import { logger } from './logger.js';

const VALID_PERMISSIONS: SkillPermission[] = ['bash', 'read', 'write', 'network'];

export function validatePermissions(permissions: string[]): { valid: boolean; invalid: string[] } {
  const invalid = permissions.filter((p) => !VALID_PERMISSIONS.includes(p as SkillPermission));
  return { valid: invalid.length === 0, invalid };
}

export function formatPermissionsDisplay(manifest: SkillManifest): string {
  // Format permissions for display during installation confirmation
  // Return a multi-line string showing each permission and its risk level
  const riskLevels: Record<SkillPermission, string> = {
    read: '低风险',
    write: '中风险',
    bash: '高风险',
    network: '中风险',
  };
  const lines = manifest.permissions.map((p) => `  - ${p} (${riskLevels[p]})`);
  return `请求权限:\n${lines.join('\n')}`;
}

export function logSkillExecution(params: {
  skillName: string;
  toolName: string;
  userId: string;
  status: 'success' | 'failure' | 'denied';
  duration?: number;
  error?: string;
}): void {
  logger.info(
    {
      type: 'skill_execution',
      skill: params.skillName,
      tool: params.toolName,
      userId: params.userId,
      status: params.status,
      duration: params.duration,
      error: params.error,
    },
    'Skill execution audit',
  );
}
