/**
 * Auth header construction for MCP requests.
 *
 * Two paths:
 *   1. Bearer API key — for authenticated developer / agent embedding
 *      (`Authorization: Bearer hw_…`)
 *   2. Anonymous + share token — for /run/:token listener paths. The
 *      share token authorizes the listener as "this experience is
 *      published; here is its public access token." Today the platform's
 *      anonymous get_experience-by-share-token path is not yet public
 *      MCP — when it lands, the share token will travel as a request
 *      arg. Until then, mcp-client passes apiKey-or-nothing and lets
 *      the platform's existing /p/:token render path handle the
 *      anonymous case server-side.
 */

/**
 * @param {{ apiKey: string|null }} config
 * @returns {Record<string, string>}
 */
export function buildHeaders(config) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return headers;
}
