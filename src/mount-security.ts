import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const FORBIDDEN_PATHS = [
  '/',
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/root',
  '/run',
];

const HOME_FORBIDDEN_SUBDIRS = ['.ssh', '.gnupg', '.config', '.aws'];

export class MountSecurityError extends Error {
  constructor(
    message: string,
    public readonly eventType: string = 'mount_violation',
  ) {
    super(message);
    this.name = 'MountSecurityError';
  }
}

function getAllowlistPath(): string {
  return path.join(os.homedir(), '.config', 'vigilclaw', 'mount-allowlist.json');
}

function loadMountAllowlist(): string[] {
  const filePath = getAllowlistPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { paths?: string[] };
    return content.paths ?? [];
  } catch {
    return [];
  }
}

export function validateMountPath(requestedPath: string): void {
  const resolved = path.resolve(requestedPath);

  for (const forbidden of FORBIDDEN_PATHS) {
    if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
      throw new MountSecurityError(`Mount path "${resolved}" is forbidden`);
    }
  }

  const home = os.homedir();
  for (const subdir of HOME_FORBIDDEN_SUBDIRS) {
    const forbidden = path.join(home, subdir);
    if (resolved === forbidden || resolved.startsWith(forbidden + '/')) {
      throw new MountSecurityError(`Mount path "${resolved}" is forbidden (sensitive home dir)`);
    }
  }

  const allowlist = loadMountAllowlist();

  if (allowlist.length === 0) return;

  const isAllowed = allowlist.some(
    (allowed) => resolved === allowed || resolved.startsWith(allowed + '/'),
  );

  if (!isAllowed) {
    throw new MountSecurityError(`Mount path "${resolved}" is not in allowlist`);
  }
}
