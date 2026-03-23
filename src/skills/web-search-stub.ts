// CJS stub generated into /ipc/web-search-stub/index.js at task start.
// The container loads it via require(). SEARCH_BRIDGE_URL is set in container env.

// Template for the stub JS. No runtime placeholders needed — the URL
// comes from the SEARCH_BRIDGE_URL environment variable injected into the container.
const STUB_TEMPLATE_JS = `
'use strict';

function createTool(def) {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
    execute: def._execute,
  };
}

const webSearchTool = {
  name: 'web_search',
  description: 'Search the web using Brave Search. Returns a list of relevant results with titles, URLs, and descriptions.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-20, default 5)',
      },
    },
    required: ['query'],
  },
  _execute: async function(params) {
    const bridgeUrl = process.env.SEARCH_BRIDGE_URL;
    if (!bridgeUrl) {
      return 'Error: Search service unavailable (SEARCH_BRIDGE_URL not set)';
    }
    const count = params.count || 5;
    const url = bridgeUrl.replace(/\\/$/, '') + '/search?q=' + encodeURIComponent(params.query) + '&count=' + count;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (!res.ok) {
        return 'Error: ' + text;
      }
      return text;
    } catch (err) {
      return 'Error: Search service unavailable (' + (err instanceof Error ? err.message : String(err)) + ')';
    }
  },
};

const webFetchTool = {
  name: 'web_fetch',
  description: 'Fetch and summarize the content of a web page. Returns a concise summary of the page content.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the web page to fetch',
      },
      prompt: {
        type: 'string',
        description: 'Optional: what specific information to extract from the page',
      },
    },
    required: ['url'],
  },
  _execute: async function(params) {
    const bridgeUrl = process.env.SEARCH_BRIDGE_URL;
    if (!bridgeUrl) {
      return 'Error: Search service unavailable (SEARCH_BRIDGE_URL not set)';
    }
    const endpoint = bridgeUrl.replace(/\\/$/, '') + '/fetch';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: params.url, prompt: params.prompt }),
        signal: AbortSignal.timeout(45000),
      });
      const text = await res.text();
      if (!res.ok) {
        return 'Error fetching page: ' + text;
      }
      return text;
    } catch (err) {
      return 'Error: Search service unavailable (' + (err instanceof Error ? err.message : String(err)) + ')';
    }
  },
};

module.exports = {
  createTool: function(def) {
    if (def.name === 'web_search') return createTool(Object.assign({}, webSearchTool, def));
    if (def.name === 'web_fetch') return createTool(Object.assign({}, webFetchTool, def));
    return createTool(def);
  },
};
`.trimStart();

export function generateWebSearchStubJs(): string {
  return STUB_TEMPLATE_JS;
}

export function getWebSearchSkillInfo(): {
  name: string;
  codePath: string;
  tools: Array<{
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }>;
} {
  return {
    name: 'web-search',
    codePath: 'built-in',
    tools: [
      {
        name: 'web_search',
        description:
          'Search the web using Brave Search. Returns a list of relevant results with titles, URLs, and descriptions.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            count: {
              type: 'number',
              description: 'Number of results to return (1-20, default 5)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'web_fetch',
        description:
          'Fetch and summarize the content of a web page. Returns a concise summary of the page content.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL of the web page to fetch' },
            prompt: {
              type: 'string',
              description: 'Optional: what specific information to extract from the page',
            },
          },
          required: ['url'],
        },
      },
    ],
  };
}
