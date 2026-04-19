/**
 * Unit tests for src/api/config.js — runtime config resolution.
 *
 * Resolution order under test:
 *   1. opts override URL params
 *   2. URL params override defaults
 *   3. defaults kick in last
 *
 * SSR safety verified by simulating the absence of globalThis.location.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readConfig, mcpUrl } from '../../src/api/config.js';

describe('api/config.js', () => {
  /** @type {any} */
  let savedLocation;

  beforeEach(() => {
    savedLocation = globalThis.location;
  });

  afterEach(() => {
    if (savedLocation === undefined) {
      delete globalThis.location;
    } else {
      globalThis.location = savedLocation;
    }
  });

  describe('readConfig — defaults', () => {
    test('returns harmonicwave.ai endpoint when no opts and no URL params', () => {
      delete globalThis.location;
      const config = readConfig();
      expect(config.endpoint).toBe('https://harmonicwave.ai');
      expect(config.shareToken).toBe(null);
      expect(config.apiKey).toBe(null);
    });

    test('strips trailing slash from default endpoint', () => {
      delete globalThis.location;
      const config = readConfig({ endpoint: 'https://example.com/' });
      expect(config.endpoint).toBe('https://example.com');
    });
  });

  describe('readConfig — opts override URL params', () => {
    test('opts.endpoint wins over ?backend= URL param', () => {
      globalThis.location = { search: '?backend=https://from-url.example' };
      const config = readConfig({ endpoint: 'https://from-opts.example' });
      expect(config.endpoint).toBe('https://from-opts.example');
    });

    test('opts.shareToken wins over ?t= URL param', () => {
      globalThis.location = { search: '?t=urltoken' };
      const config = readConfig({ shareToken: 'optstoken' });
      expect(config.shareToken).toBe('optstoken');
    });

    test('opts.apiKey is honored even when no URL param exists', () => {
      delete globalThis.location;
      const config = readConfig({ apiKey: 'hw_abc123' });
      expect(config.apiKey).toBe('hw_abc123');
    });
  });

  describe('readConfig — URL params override defaults', () => {
    test('reads ?backend= from URL', () => {
      globalThis.location = { search: '?backend=https://staging.harmonicwave.ai' };
      const config = readConfig();
      expect(config.endpoint).toBe('https://staging.harmonicwave.ai');
    });

    test('reads ?t= as share token (canonical short form)', () => {
      globalThis.location = { search: '?t=46c54a8f61ba7bb0c8cfd0de3b6c7332' };
      const config = readConfig();
      expect(config.shareToken).toBe('46c54a8f61ba7bb0c8cfd0de3b6c7332');
    });

    test('reads ?token= as share token (long alias)', () => {
      globalThis.location = { search: '?token=46c54a8f61ba7bb0c8cfd0de3b6c7332' };
      const config = readConfig();
      expect(config.shareToken).toBe('46c54a8f61ba7bb0c8cfd0de3b6c7332');
    });

    test('?t= wins over ?token= when both present', () => {
      globalThis.location = { search: '?t=short&token=long' };
      const config = readConfig();
      expect(config.shareToken).toBe('short');
    });

    test('reads multiple params together', () => {
      globalThis.location = {
        search: '?backend=https://localhost:3000&t=abc123',
      };
      const config = readConfig();
      expect(config.endpoint).toBe('https://localhost:3000');
      expect(config.shareToken).toBe('abc123');
    });
  });

  describe('readConfig — apiKey is URL-param-immune (security)', () => {
    test('?apiKey= URL param does NOT populate config.apiKey', () => {
      // Bearer tokens in URLs leak via browser history, server logs, and
      // referer headers. config.apiKey is intentionally only readable
      // from opts (set programmatically by an embedder).
      globalThis.location = { search: '?apiKey=hw_should_be_ignored' };
      const config = readConfig();
      expect(config.apiKey).toBeNull();
    });

    test('?api_key= URL param (snake_case alias) is also ignored', () => {
      globalThis.location = { search: '?api_key=hw_also_ignored' };
      const config = readConfig();
      expect(config.apiKey).toBeNull();
    });

    test('?bearer= URL param is also ignored', () => {
      globalThis.location = { search: '?bearer=hw_nope' };
      const config = readConfig();
      expect(config.apiKey).toBeNull();
    });
  });

  describe('mcpUrl', () => {
    test('appends /mcp/v1/message to the configured endpoint', () => {
      const config = readConfig({ endpoint: 'https://harmonicwave.ai' });
      expect(mcpUrl(config)).toBe('https://harmonicwave.ai/mcp/v1/message');
    });

    test('handles endpoint without trailing slash correctly', () => {
      const config = readConfig({ endpoint: 'http://localhost:3000' });
      expect(mcpUrl(config)).toBe('http://localhost:3000/mcp/v1/message');
    });
  });
});
