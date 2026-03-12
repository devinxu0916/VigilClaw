import fs from 'node:fs';
import path from 'node:path';
import type { Tool } from '../types.js';

export class WriteTool implements Tool {
  name = 'write';
  description = 'Create or overwrite a file with the given content.';
  input_schema = {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'Absolute path for the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['file_path', 'content'],
  };

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.file_path as string;
    const content = params.content as string;

    if (!filePath.startsWith('/workspace') && !filePath.startsWith('/tmp')) {
      return 'Error: Can only write files under /workspace or /tmp';
    }

    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
