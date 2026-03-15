export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  permissions: SkillPermission[];
  tools: SkillToolDefinition[];
  entrypoint?: string;
}

export type SkillPermission = 'bash' | 'read' | 'write' | 'network';

export interface SkillToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface SkillInfo {
  name: string;
  version: string;
  tools: SkillToolDefinition[];
  codePath: string;
}

export const BUILT_IN_TOOLS = ['bash', 'read', 'write', 'edit'] as const;
