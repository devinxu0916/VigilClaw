import { execSync } from 'node:child_process';
import type { Tool } from '../types.js';

export class BashTool implements Tool {
  name = 'bash';
  description =
    'Execute a shell command and return its output. Use for running programs, checking file status, installing packages, etc.';
  input_schema = {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
    },
    required: ['command'],
  };

  async execute(params: Record<string, unknown>): Promise<string> {
    const command = params.command as string;
    try {
      const output = execSync(command, {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        cwd: '/workspace',
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const execErr = err as {
        killed?: boolean;
        status?: number;
        stderr?: string;
        message?: string;
      };
      if (execErr.killed) return `Error: Command timed out after 120s`;
      return `Error (exit code ${execErr.status ?? 'unknown'}): ${execErr.stderr || execErr.message || 'Unknown error'}`;
    }
  }
}
