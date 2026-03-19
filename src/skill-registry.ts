import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { VigilClawDB } from './db.js';
import type { SkillManifest, SkillInfo, SkillPermission } from './skill-types.js';
import { BUILT_IN_TOOLS } from './skill-types.js';

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const VALID_PERMISSIONS: SkillPermission[] = ['bash', 'read', 'write', 'network'];

export class SkillRegistry {
  private skillsDir: string;

  constructor(
    private db: VigilClawDB,
    skillsDir?: string,
  ) {
    this.skillsDir =
      skillsDir ?? path.join(process.env.HOME ?? '~', '.config', 'vigilclaw', 'skills');
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }

  validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be a JSON object'] };
    }

    const m = manifest as Record<string, unknown>;

    if (!m.name || typeof m.name !== 'string') errors.push('Missing or invalid "name"');
    if (!m.version || typeof m.version !== 'string') errors.push('Missing or invalid "version"');
    else if (typeof m.version === 'string' && !SEMVER_REGEX.test(m.version)) errors.push('Version must be semver (x.y.z)');
    if (!m.description || typeof m.description !== 'string')
      errors.push('Missing or invalid "description"');
    if (!Array.isArray(m.permissions)) errors.push('Missing or invalid "permissions" array');
    else {
      for (const p of m.permissions as unknown[]) {
        if (!VALID_PERMISSIONS.includes(p as SkillPermission)) {
          errors.push(`Invalid permission: "${String(p)}". Valid: ${VALID_PERMISSIONS.join(', ')}`);
        }
      }
    }
    if (!Array.isArray(m.tools) || (m.tools as unknown[]).length === 0)
      errors.push('Missing or empty "tools" array');

    return { valid: errors.length === 0, errors };
  }

  checkToolConflicts(toolNames: string[]): string[] {
    const conflicts: string[] = [];

    for (const name of toolNames) {
      if ((BUILT_IN_TOOLS as readonly string[]).includes(name)) {
        conflicts.push(`"${name}" conflicts with built-in tool`);
      }
    }

    const existingSkills = this.db.listSkills();
    for (const s of existingSkills) {
      const full = this.db.getSkill(s.name);
      if (!full) continue;
      const manifest = JSON.parse(full.manifest) as SkillManifest;
      for (const tool of manifest.tools) {
        if (toolNames.includes(tool.name)) {
          conflicts.push(`"${tool.name}" conflicts with skill "${s.name}"`);
        }
      }
    }

    return conflicts;
  }

  installSkill(sourcePath: string, installedBy: string): { success: boolean; error?: string } {
    const manifestPath = path.join(sourcePath, 'skill.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'skill.json not found at source path' };
    }

    let manifest: SkillManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SkillManifest;
    } catch {
      return { success: false, error: 'Failed to parse skill.json' };
    }

    const validation = this.validateManifest(manifest);
    if (!validation.valid) {
      return { success: false, error: `Invalid manifest: ${validation.errors.join('; ')}` };
    }

    const entrypoint = manifest.entrypoint ?? 'index.js';
    const entryPath = path.join(sourcePath, entrypoint);
    if (!fs.existsSync(entryPath)) {
      return { success: false, error: `Entrypoint "${entrypoint}" not found` };
    }

    const toolNames = manifest.tools.map((t) => t.name);
    const conflicts = this.checkToolConflicts(toolNames);
    if (conflicts.length > 0) {
      return { success: false, error: `Tool conflicts: ${conflicts.join('; ')}` };
    }

    const existing = this.db.getSkill(manifest.name);
    if (existing) {
      return { success: false, error: `Skill "${manifest.name}" already installed. Use upgrade.` };
    }

    const targetDir = path.join(this.skillsDir, manifest.name);
    fs.mkdirSync(targetDir, { recursive: true });
    this.copyDir(sourcePath, targetDir);

    this.db.insertSkill({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      manifest: JSON.stringify(manifest),
      codePath: targetDir,
      installedBy,
    });

    logger.info(
      { skill: manifest.name, version: manifest.version, permissions: manifest.permissions },
      'Skill installed',
    );
    return { success: true };
  }

  removeSkill(name: string): { success: boolean; error?: string } {
    const skill = this.db.getSkill(name);
    if (!skill) {
      return { success: false, error: `Skill "${name}" not found` };
    }

    if (fs.existsSync(skill.code_path)) {
      fs.rmSync(skill.code_path, { recursive: true, force: true });
    }

    this.db.deleteSkill(name);
    logger.info({ skill: name }, 'Skill removed');
    return { success: true };
  }

  enableSkill(name: string): { success: boolean; error?: string } {
    const skill = this.db.getSkill(name);
    if (!skill) return { success: false, error: `Skill "${name}" not found` };
    if (skill.enabled === 1) return { success: false, error: `Skill "${name}" already enabled` };
    this.db.setSkillEnabled(name, true);
    return { success: true };
  }

  disableSkill(name: string): { success: boolean; error?: string } {
    const skill = this.db.getSkill(name);
    if (!skill) return { success: false, error: `Skill "${name}" not found` };
    if (skill.enabled === 0) return { success: false, error: `Skill "${name}" already disabled` };
    this.db.setSkillEnabled(name, false);
    return { success: true };
  }

  listSkills(): Array<{
    name: string;
    version: string;
    description: string | null;
    enabled: boolean;
  }> {
    return this.db.listSkills().map((s) => ({
      name: s.name,
      version: s.version,
      description: s.description,
      enabled: s.enabled === 1,
    }));
  }

  getSkillInfo(name: string): {
    manifest: SkillManifest;
    enabled: boolean;
    installedAt: string;
  } | null {
    const skill = this.db.getSkill(name);
    if (!skill) return null;
    return {
      manifest: JSON.parse(skill.manifest) as SkillManifest,
      enabled: skill.enabled === 1,
      installedAt: skill.installed_at,
    };
  }

  getEnabledSkillInfos(): SkillInfo[] {
    const skills = this.db.listSkills().filter((s) => s.enabled === 1);
    const result: SkillInfo[] = [];

    for (const skill of skills) {
      const dbSkill = this.db.getSkill(skill.name);
      if (!dbSkill) continue;
      const manifest = JSON.parse(dbSkill.manifest) as SkillManifest;
      result.push({
        name: manifest.name,
        version: manifest.version,
        tools: manifest.tools,
        codePath: dbSkill.code_path,
      });
    }

    return result;
  }

  upgradeSkill(name: string, sourcePath: string): { success: boolean; error?: string } {
    const existing = this.db.getSkill(name);
    if (!existing) return { success: false, error: `Skill "${name}" not found` };

    const manifestPath = path.join(sourcePath, 'skill.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'skill.json not found at source path' };
    }

    let manifest: SkillManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SkillManifest;
    } catch {
      return { success: false, error: 'Failed to parse skill.json' };
    }

    if (manifest.name !== name) {
      return { success: false, error: `Manifest name "${manifest.name}" does not match "${name}"` };
    }

    const validation = this.validateManifest(manifest);
    if (!validation.valid) {
      return { success: false, error: `Invalid manifest: ${validation.errors.join('; ')}` };
    }

    const targetDir = existing.code_path;
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    this.copyDir(sourcePath, targetDir);

    this.db.updateSkill(name, manifest.version, JSON.stringify(manifest), targetDir);
    logger.info(
      { skill: name, oldVersion: existing.version, newVersion: manifest.version },
      'Skill upgraded',
    );
    return { success: true };
  }

  private copyDir(src: string, dest: string): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
