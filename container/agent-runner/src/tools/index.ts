import type { Tool } from '../types.js';
import { BashTool } from './bash.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';

const ALL_TOOLS: Record<string, () => Tool> = {
  bash: () => new BashTool(),
  read: () => new ReadTool(),
  write: () => new WriteTool(),
  edit: () => new EditTool(),
};

export function createTools(toolNames: string[]): Tool[] {
  return toolNames
    .map((name) => ALL_TOOLS[name])
    .filter((factory): factory is () => Tool => factory !== undefined)
    .map((factory) => factory());
}
