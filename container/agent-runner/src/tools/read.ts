import fs from 'node:fs';
import type { Tool } from '../types.js';

export class ReadTool implements Tool {
  name = 'read';
  description = 'Read the contents of a file. Returns the file content with line numbers.';
  input_schema = {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file to read' },
      offset: { type: 'number', description: 'Line number to start from (1-indexed, default: 1)' },
      limit: { type: 'number', description: 'Maximum number of lines to read (default: 2000)' },
    },
    required: ['file_path'],
  };

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.file_path as string;
    const offset = (params.offset as number | undefined) ?? 1;
    const limit = (params.limit as number | undefined) ?? 2000;

    if (!filePath.startsWith('/workspace') && !filePath.startsWith('/tmp')) {
      return 'Error: Can only read files under /workspace or /tmp';
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const selected = lines.slice(offset - 1, offset - 1 + limit);
      return selected.map((line, i) => `${offset + i}: ${line}`).join('\n');
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
