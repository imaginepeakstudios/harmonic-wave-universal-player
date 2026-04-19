/**
 * Runtime config for the player.
 *
 * Resolution order (most specific wins):
 *   1. Explicit opts passed to readConfig()
 *   2. URL query params (browser only)
 *   3. Hardcoded defaults
 *
 * SSR-safe: no top-level window/location access. URL params are read via
 * globalThis.location with optional chaining so this module can be imported
 * + executed under Node (vitest) without throwing.
 *
 * Why a separate module: the MCP endpoint URL needs to be configurable per
 * deployment (production, staging, self-hosted, partner backends, dev). The
 * share token comes from /run/:token style URLs. The API key is for
 * authenticated developer / agent embedding paths. All three want to be
 * driven by configuration, not hardcoded.
 */

const DEFAULT_ENDPOINT = 'https://harmonicwave.ai';

/**
 * @typedef {object} PlayerConfig
 * @property {string} endpoint  Backend MCP base URL (no trailing slash).
 * @property {string|null} shareToken  Anonymous share token from /run/:token URLs (32 hex chars).
 * @property {string|null} apiKey  Bearer API key (`hw_…`) for authenticated calls.
 */

/**
 * @param {Partial<PlayerConfig>} [opts]
 * @returns {PlayerConfig}
 */
export function readConfig(opts = {}) {
  const params = readUrlParams();
  const endpointRaw = opts.endpoint ?? params.get('backend') ?? DEFAULT_ENDPOINT;
  const endpoint = stripTrailingSlash(String(endpointRaw));
  const shareToken = opts.shareToken ?? params.get('t') ?? params.get('token') ?? null;
  // SECURITY: apiKey is INTENTIONALLY only readable from opts, never URL
  // params. URL params are visible in browser history, server logs, and
  // referer headers — terrible places to put a Bearer token. API keys
  // are for server-side / agent-embedded paths where the embedder sets
  // them programmatically. The negative test in api-config.test.js
  // locks this behavior in.
  const apiKey = opts.apiKey ?? null;
  return { endpoint, shareToken, apiKey };
}

/**
 * Build the URL for an MCP request against the configured backend.
 * Currently: `${endpoint}/mcp/v1/message`.
 * @param {PlayerConfig} config
 * @returns {string}
 */
export function mcpUrl(config) {
  return `${config.endpoint}/mcp/v1/message`;
}

function readUrlParams() {
  // SSR-safe: globalThis.location is undefined under Node.
  const search =
    typeof globalThis !== 'undefined' && globalThis.location
      ? globalThis.location.search || ''
      : '';
  return new URLSearchParams(search);
}

function stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
