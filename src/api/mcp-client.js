/**
 * MCP client — JSON-RPC 2.0 wrapper around the platform's `/mcp/v1/message`
 * endpoint. The engine NEVER queries the platform DB or any private API;
 * everything flows through the public MCP surface.
 *
 * Three tools are wrapped:
 *   - getExperience()         — full HWES v1 payload (composition + recipes
 *                               + actor cascade + scene + theme + display
 *                               directives + hwes_extensions metadata)
 *   - refreshExperienceUrls() — refreshes proxied media URLs
 *   - verifyAccess()          — public tool, no auth required
 *
 * Auth is handled at the request layer (see api/auth.js): API-key paths
 * pass Bearer; anonymous paths omit it. The share_token model for fully
 * anonymous listener access is a future platform-side feature; until it
 * lands the player either holds an API key or relies on the platform's
 * server-rendered share landing for anonymous flows.
 */

import { mcpUrl } from './config.js';
import { buildHeaders } from './auth.js';

/**
 * @typedef {object} PlayerConfig
 * @property {string} endpoint
 * @property {string|null} shareToken
 * @property {string|null} apiKey
 */

/**
 * @typedef {object} McpClient
 * @property {(args: GetExperienceArgs) => Promise<object>} getExperience
 * @property {(args: { experience_id: number }) => Promise<object>} refreshExperienceUrls
 * @property {(args: VerifyAccessArgs) => Promise<{ has_access: boolean }>} verifyAccess
 */

/**
 * @typedef {object} GetExperienceArgs
 * @property {string} [slug]
 * @property {number} [id]
 * @property {string} [profile_slug]
 * @property {string} [mode]
 * @property {string} [content_rating_filter]
 */

/**
 * @typedef {object} VerifyAccessArgs
 * @property {string} email
 * @property {string} [experience_slug]
 * @property {number} [experience_id]
 * @property {string} [profile_slug]
 */

/**
 * @param {PlayerConfig} config
 * @param {{ fetch?: typeof fetch; warn?: (msg: string) => void }} [deps]
 * @returns {McpClient}
 */
export function createMcpClient(config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createMcpClient: no fetch implementation available (pass via deps.fetch under Node)',
    );
  }
  // SECURITY: a Bearer API key in a browser context is visible in the
  // Network tab, in any other JS on the page (analytics, ad tags,
  // extensions), and in any leaked memory dump. The intended pattern is
  // share_token (URL) for anonymous listeners, HttpOnly session cookie
  // for authenticated listeners, and API key only for server-to-server
  // / agent-embedded paths where a browser is not in the loop.
  if (config.apiKey && typeof globalThis.window !== 'undefined') {
    const warn = deps.warn ?? ((m) => globalThis.console?.warn?.(m));
    warn(
      '[hwes/mcp-client] An API key has been configured in a browser context. ' +
        'Bearer tokens are visible to any other JS on the page (extensions, analytics, etc.) ' +
        'and to anyone who can see the Network tab. For listener flows use share_token URL ' +
        'paths; for premium listeners use HttpOnly session cookies. API keys are intended for ' +
        'server-side / agent-embedded use, not browser distribution.',
    );
  }
  let nextId = 1;
  const url = mcpUrl(config);

  /**
   * @template T
   * @param {string} tool
   * @param {Record<string, unknown>} args
   * @returns {Promise<T>}
   */
  async function callTool(tool, args) {
    const id = nextId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    });
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: buildHeaders(config), body });
    } catch (networkErr) {
      const err = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      throw new McpError(`Network error calling ${tool}: ${err.message}`, {
        kind: 'network',
        cause: err,
        tool,
      });
    }
    if (!res.ok) {
      throw new McpError(`HTTP ${res.status} calling ${tool}`, {
        kind: 'http',
        tool,
        status: res.status,
      });
    }
    /** @type {{ jsonrpc: string; id: number; result?: { content?: Array<{ type: string; text: string }> }; error?: { code: number; message: string } }} */
    let envelope;
    try {
      envelope = await res.json();
    } catch (parseErr) {
      const err = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      throw new McpError(`Malformed JSON response from ${tool}`, {
        kind: 'shape',
        cause: err,
        tool,
      });
    }
    if (envelope.error) {
      throw new McpError(`MCP error from ${tool}: ${envelope.error.message}`, {
        kind: 'rpc',
        tool,
        code: envelope.error.code,
      });
    }
    // JSON-RPC permits out-of-order responses; today MCP transport is
    // request/response over HTTP so this can't happen, but if we ever
    // move to keep-alive (websocket / SSE) the id round-trip becomes
    // load-bearing. Cheap to assert now.
    if (envelope.id !== id) {
      throw new McpError(
        `MCP response id mismatch for ${tool} (expected ${id}, got ${envelope.id})`,
        {
          kind: 'shape',
          tool,
        },
      );
    }
    const text = envelope?.result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new McpError(`Unexpected MCP response shape from ${tool}`, {
        kind: 'shape',
        tool,
      });
    }
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      const err = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      throw new McpError(`Tool ${tool} returned non-JSON content`, {
        kind: 'shape',
        cause: err,
        tool,
      });
    }
  }

  // Methods are `async` so argument-validation throws surface as
  // promise rejections rather than synchronous exceptions. Mixing
  // sync-throw with async-return is a footgun (caller writes
  // `try { await x }` expecting both paths through `catch`).
  return {
    async getExperience(args) {
      if (!args || (args.slug == null && args.id == null)) {
        throw new TypeError('getExperience requires either { slug } or { id }');
      }
      return callTool('get_experience', args);
    },
    async refreshExperienceUrls(args) {
      if (!args || typeof args.experience_id !== 'number') {
        throw new TypeError('refreshExperienceUrls requires { experience_id: number }');
      }
      return callTool('refresh_experience_urls', args);
    },
    async verifyAccess(args) {
      if (!args || typeof args.email !== 'string') {
        throw new TypeError('verifyAccess requires { email: string }');
      }
      return callTool('verify_access', args);
    },
  };
}

/**
 * Typed error thrown by the MCP client. Carries `kind` + `tool` always;
 * `status` / `code` / `cause` when the underlying failure surfaced one.
 * Renderers branch on `kind` to present the right message:
 *   - 'network' — browser failed to reach the backend; offer retry
 *   - 'http'    — backend returned a non-2xx; check `status` (403 = access
 *                 changed mid-session, 404 = experience not found)
 *   - 'rpc'     — backend returned a JSON-RPC error envelope; check `code`
 *   - 'shape'   — response was malformed (parse failure / wrong content
 *                 shape / id mismatch); usually a backend / proxy bug
 */
export class McpError extends Error {
  /**
   * @param {string} message
   * @param {{ kind: 'network' | 'http' | 'rpc' | 'shape'; tool: string; status?: number; code?: number; cause?: Error }} info
   */
  constructor(message, info) {
    super(message, info.cause ? { cause: info.cause } : undefined);
    this.name = 'McpError';
    this.kind = info.kind;
    this.tool = info.tool;
    if (info.status !== undefined) this.status = info.status;
    if (info.code !== undefined) this.code = info.code;
  }
}
