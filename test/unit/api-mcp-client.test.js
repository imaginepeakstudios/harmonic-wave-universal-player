/**
 * Unit tests for src/api/mcp-client.js — JSON-RPC 2.0 wrapper.
 *
 * Strategy: inject a mock fetch via deps. Verify request shape (URL,
 * headers, body), response parsing (result.content[0].text → JSON), and
 * error mapping (network / HTTP / JSON-RPC error / malformed payload).
 */

import { describe, test, expect, vi } from 'vitest';
import { createMcpClient, McpError } from '../../src/api/mcp-client.js';

// ---- Helpers --------------------------------------------------------------

const BASE_CONFIG = {
  endpoint: 'https://harmonicwave.ai',
  shareToken: null,
  apiKey: 'hw_test_abc',
};

/**
 * Build a Response-shaped mock that mimics what fetch() returns, with the
 * minimum surface our client uses (`ok`, `status`, `json()`).
 * @param {object} envelope  JSON-RPC 2.0 response envelope to return
 * @param {{ status?: number; ok?: boolean }} [opts]
 */
/**
 * Build a Response-shaped mock with whatever envelope you pass. Status
 * defaults to 200; `ok` is computed from status unless overridden.
 */
function mockResponse(envelope, opts = {}) {
  const status = opts.status ?? 200;
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    async json() {
      return envelope;
    },
  };
}

/**
 * Build a fetch mock. By default the response's JSON-RPC id is rewritten
 * on each call to echo the request's id (so the client's id-round-trip
 * guard passes for normal tests). Tests that want to exercise the
 * mismatch case pass `{ echoId: false }` and a fixed id in the envelope.
 */
function mockFetch(response, opts = {}) {
  const echoId = opts.echoId !== false;
  return vi.fn(async (_url, init) => {
    if (!echoId) return response;
    let reqId;
    try {
      reqId = JSON.parse(init.body).id;
    } catch {
      /* */
    }
    const orig = await response.json();
    return {
      ...response,
      json: async () => ({ ...orig, id: reqId ?? orig.id }),
    };
  });
}

/** Wrap text content in the standard MCP response envelope. */
function envelope(textObject, id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(textObject) }],
    },
  };
}

// ---- Tests ----------------------------------------------------------------

describe('createMcpClient — request shape', () => {
  test('POSTs to the configured /mcp/v1/message endpoint', async () => {
    const fetch = mockFetch(mockResponse(envelope({ id: 42 })));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await client.getExperience({ slug: 'test-exp' });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://harmonicwave.ai/mcp/v1/message');
    expect(init.method).toBe('POST');
  });

  test('includes Bearer Authorization header when apiKey configured', async () => {
    const fetch = mockFetch(mockResponse(envelope({ id: 1 })));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await client.getExperience({ slug: 'x' });
    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer hw_test_abc');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test('omits Authorization header when no apiKey', async () => {
    const fetch = mockFetch(mockResponse(envelope({ has_access: true })));
    const client = createMcpClient({ ...BASE_CONFIG, apiKey: null }, { fetch });
    await client.verifyAccess({ email: 'a@b.com' });
    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  test('builds JSON-RPC 2.0 envelope with tools/call method', async () => {
    const fetch = mockFetch(mockResponse(envelope({ id: 1 })));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await client.getExperience({ slug: 'late-night-reflections', mode: 'late_night' });
    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('tools/call');
    expect(typeof body.id).toBe('number');
    expect(body.params).toEqual({
      name: 'get_experience',
      arguments: { slug: 'late-night-reflections', mode: 'late_night' },
    });
  });

  test('increments request ids across multiple calls', async () => {
    const fetch = mockFetch(mockResponse(envelope({ ok: true })));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await client.getExperience({ slug: 'a' });
    await client.getExperience({ slug: 'b' });
    const id1 = JSON.parse(fetch.mock.calls[0][1].body).id;
    const id2 = JSON.parse(fetch.mock.calls[1][1].body).id;
    expect(id2).toBe(id1 + 1);
  });
});

describe('createMcpClient — argument validation', () => {
  test('getExperience throws when neither slug nor id is provided', async () => {
    const client = createMcpClient(BASE_CONFIG, { fetch: mockFetch(mockResponse({})) });
    await expect(client.getExperience({})).rejects.toThrow(/slug.*id/);
  });

  test('refreshExperienceUrls throws when experience_id is not a number', async () => {
    const client = createMcpClient(BASE_CONFIG, { fetch: mockFetch(mockResponse({})) });
    // @ts-expect-error testing runtime validation
    await expect(client.refreshExperienceUrls({ experience_id: 'foo' })).rejects.toThrow(
      /experience_id/,
    );
  });

  test('verifyAccess throws when email is missing', async () => {
    const client = createMcpClient(BASE_CONFIG, { fetch: mockFetch(mockResponse({})) });
    // @ts-expect-error testing runtime validation
    await expect(client.verifyAccess({})).rejects.toThrow(/email/);
  });
});

describe('createMcpClient — response parsing', () => {
  test('parses result.content[0].text as JSON', async () => {
    const payload = { id: 42, name: 'Test', items: [] };
    const fetch = mockFetch(mockResponse(envelope(payload)));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    const result = await client.getExperience({ slug: 'x' });
    expect(result).toEqual(payload);
  });

  test('returns full HWES response shape with hwes_extensions etc', async () => {
    const payload = {
      hwes_version: 1,
      hwes_extensions: ['display_recipes_v1'],
      id: 1,
      items: [{ item_id: 1, content_type_slug: 'song' }],
    };
    const fetch = mockFetch(mockResponse(envelope(payload)));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    const result = await client.getExperience({ id: 1 });
    expect(result.hwes_version).toBe(1);
    expect(result.hwes_extensions).toContain('display_recipes_v1');
    expect(result.items[0].content_type_slug).toBe('song');
  });
});

describe('createMcpClient — error handling', () => {
  test('throws McpError with kind=http and status on HTTP non-2xx', async () => {
    const fetch = mockFetch(mockResponse({ error: 'Not Found' }, { status: 404 }));
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await expect(client.getExperience({ slug: 'gone' })).rejects.toMatchObject({
      name: 'McpError',
      kind: 'http',
      tool: 'get_experience',
      status: 404,
    });
  });

  test('throws McpError with kind=rpc and code on JSON-RPC error response', async () => {
    const fetch = mockFetch(
      mockResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Experience not found' },
      }),
    );
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await expect(client.getExperience({ slug: 'gone' })).rejects.toMatchObject({
      name: 'McpError',
      kind: 'rpc',
      tool: 'get_experience',
      code: -32603,
    });
  });

  test('throws McpError with kind=network on network failure (cause preserved)', async () => {
    const networkErr = new TypeError('Failed to fetch');
    const fetch = vi.fn(async () => {
      throw networkErr;
    });
    const client = createMcpClient(BASE_CONFIG, { fetch });
    let thrown;
    try {
      await client.getExperience({ slug: 'x' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(McpError);
    expect(thrown.kind).toBe('network');
    expect(thrown.tool).toBe('get_experience');
    expect(thrown.cause).toBe(networkErr);
  });

  test('throws McpError with kind=shape when MCP returns non-text content', async () => {
    const fetch = mockFetch(
      mockResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'image', data: 'base64...' }] },
      }),
    );
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await expect(client.getExperience({ slug: 'x' })).rejects.toMatchObject({
      kind: 'shape',
      tool: 'get_experience',
    });
  });

  test('throws McpError with kind=shape when text content is not JSON', async () => {
    const fetch = mockFetch(
      mockResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'not json' }] },
      }),
    );
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await expect(client.getExperience({ slug: 'x' })).rejects.toMatchObject({
      kind: 'shape',
    });
  });

  test('throws McpError with kind=shape when response id does not match request id', async () => {
    // Server returns a response with wrong id — load-bearing once we
    // move to keep-alive / pipelined transports. Today HTTP request/
    // response prevents this; the assert is cheap insurance.
    const fetch = mockFetch(
      mockResponse({
        jsonrpc: '2.0',
        id: 99999, // wrong, and { echoId: false } prevents the mock from rewriting it
        result: { content: [{ type: 'text', text: '{}' }] },
      }),
      { echoId: false },
    );
    const client = createMcpClient(BASE_CONFIG, { fetch });
    await expect(client.getExperience({ slug: 'x' })).rejects.toMatchObject({
      kind: 'shape',
      tool: 'get_experience',
    });
  });
});

describe('createMcpClient — security warnings', () => {
  test('warns when apiKey is configured in a browser context', () => {
    const warn = vi.fn();
    // Simulate browser by ensuring globalThis.window exists.
    const savedWindow = globalThis.window;
    globalThis.window = /** @type {any} */ ({});
    try {
      createMcpClient(
        { ...BASE_CONFIG, apiKey: 'hw_secret' },
        { fetch: mockFetch(mockResponse(envelope({}))), warn },
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0][0])).toMatch(/API key.*browser/);
    } finally {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
    }
  });

  test('does NOT warn when apiKey is null in a browser context', () => {
    const warn = vi.fn();
    const savedWindow = globalThis.window;
    globalThis.window = /** @type {any} */ ({});
    try {
      createMcpClient(
        { ...BASE_CONFIG, apiKey: null },
        { fetch: mockFetch(mockResponse(envelope({}))), warn },
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (savedWindow === undefined) delete globalThis.window;
      else globalThis.window = savedWindow;
    }
  });

  test('does NOT warn when apiKey is configured in a server context (no window)', () => {
    const warn = vi.fn();
    const savedWindow = globalThis.window;
    delete globalThis.window;
    try {
      createMcpClient(
        { ...BASE_CONFIG, apiKey: 'hw_server_side' },
        { fetch: mockFetch(mockResponse(envelope({}))), warn },
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (savedWindow !== undefined) globalThis.window = savedWindow;
    }
  });
});

describe('createMcpClient — bootstrap errors', () => {
  test('throws when no fetch is available (Node without polyfill)', () => {
    expect(() => createMcpClient(BASE_CONFIG, { fetch: undefined })).not.toThrow();
    // ^ defers; only throws if globalThis.fetch is also missing
    const savedFetch = globalThis.fetch;
    delete globalThis.fetch;
    try {
      expect(() => createMcpClient(BASE_CONFIG, {})).toThrow(/fetch/);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
