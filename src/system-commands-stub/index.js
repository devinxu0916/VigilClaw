// system-commands stub — generated per-task by ContainerRunner
// Placeholders __TASK_ID__, __USER_ID__, __GROUP_ID__ are replaced at generation time.
'use strict';

const TASK_ID = '__TASK_ID__';
const USER_ID = '__USER_ID__';
const GROUP_ID = '__GROUP_ID__';

/**
 * Convert tool name to CommandBridge route.
 * e.g. system_schedule_create → /system/schedule/create
 */
function toolNameToRoute(name) {
  return '/' + name.replace(/_/g, '/');
}

/**
 * Called by loadSkillTools() for each tool definition in TaskInput.skills.
 * @param {object} def - Tool definition from TaskInput
 * @returns {object} Tool object with execute() method
 */
function createTool(def) {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
    async execute(params) {
      const bridgeUrl = process.env.COMMAND_BRIDGE_URL;
      if (!bridgeUrl) {
        return 'Error: COMMAND_BRIDGE_URL environment variable is not set';
      }

      const route = toolNameToRoute(def.name);
      const url = bridgeUrl.replace(/\/$/, '') + route;

      // Map snake_case param keys to camelCase for CommandBridge
      const body = {
        taskId: TASK_ID,
        userId: USER_ID,
        groupId: GROUP_ID || undefined,
        ...remapParams(def.name, params),
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: CommandBridge unavailable (${err instanceof Error ? err.message : String(err)})`;
      }
    },
  };
}

/**
 * Remap snake_case input params to camelCase field names expected by CommandBridge.
 */
function remapParams(toolName, params) {
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    result[snakeToCamel(key)] = value;
  }
  return result;
}

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

module.exports = { createTool };
