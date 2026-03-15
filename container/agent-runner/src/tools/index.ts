import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Tool, TaskInput } from '../types.js';
import { BashTool } from './bash.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';

const require = createRequire(import.meta.url);

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

export function loadSkillTools(skills: NonNullable<TaskInput['skills']>): Tool[] {
  const tools: Tool[] = [];

  for (const skill of skills) {
    const skillDir = `/skills/${skill.name}`;
    const entryPath = path.join(skillDir, 'index.js');

    if (!fs.existsSync(entryPath)) {
      console.error(`Skill "${skill.name}": entrypoint not found at ${entryPath}`);
      continue;
    }

    try {
      const mod = require(entryPath) as Record<string, unknown>;
      const createTool =
        typeof mod.createTool === 'function' ? (mod.createTool as (def: unknown) => Tool) : null;

      for (const toolDef of skill.tools) {
        if (createTool) {
          const tool = createTool(toolDef);
          tools.push(tool);
        } else if (typeof mod.default === 'function') {
          const ToolClass = mod.default as new (def: unknown) => Tool;
          const tool = new ToolClass(toolDef);
          tools.push(tool);
        } else {
          tools.push(createWrapperTool(skill.name, entryPath, toolDef));
        }
      }
    } catch (err) {
      console.error(
        `Skill "${skill.name}": failed to load — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return tools;
}

function createWrapperTool(
  skillName: string,
  entryPath: string,
  toolDef: NonNullable<TaskInput['skills']>[number]['tools'][number],
): Tool {
  const mod = require(entryPath) as Record<string, unknown>;
  const executeFn =
    typeof mod.execute === 'function'
      ? (mod.execute as (params: Record<string, unknown>) => Promise<string>)
      : typeof mod[toolDef.name] === 'function'
        ? (mod[toolDef.name] as (params: Record<string, unknown>) => Promise<string>)
        : null;

  return {
    name: toolDef.name,
    description: toolDef.description,
    input_schema: toolDef.input_schema,
    async execute(params: Record<string, unknown>): Promise<string> {
      if (!executeFn) {
        return `Error: Skill "${skillName}" has no execute function for tool "${toolDef.name}"`;
      }
      try {
        return await executeFn(params);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
