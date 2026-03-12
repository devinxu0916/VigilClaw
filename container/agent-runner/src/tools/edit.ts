import fs from 'node:fs';
import type { Tool } from '../types.js';

export class EditTool implements Tool {
  name = 'edit';
  description =
    'Make a precise edit to a file by replacing an exact string match with new content.';
  input_schema = {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      old_string: { type: 'string', description: 'Exact string to find and replace' },
      new_string: { type: 'string', description: 'Replacement string' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  };

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.file_path as string;
    const oldString = params.old_string as string;
    const newString = params.new_string as string;

    if (!filePath.startsWith('/workspace') && !filePath.startsWith('/tmp')) {
      return 'Error: Can only edit files under /workspace or /tmp';
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) return 'Error: old_string not found in file';
      if (occurrences > 1)
        return `Error: Found ${occurrences} matches. Provide more context to identify a unique match.`;

      const newContent = content.replace(oldString, newString);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return `Successfully edited ${filePath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
