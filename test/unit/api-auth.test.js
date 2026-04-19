/**
 * Unit tests for src/api/auth.js — auth header construction.
 */

import { describe, test, expect } from 'vitest';
import { buildHeaders } from '../../src/api/auth.js';

describe('api/auth.js', () => {
  test('always sets Content-Type: application/json', () => {
    expect(buildHeaders({ apiKey: null })['Content-Type']).toBe('application/json');
    expect(buildHeaders({ apiKey: 'hw_abc' })['Content-Type']).toBe('application/json');
  });

  test('omits Authorization header when no API key', () => {
    const headers = buildHeaders({ apiKey: null });
    expect(headers.Authorization).toBeUndefined();
  });

  test('emits Bearer Authorization header when API key present', () => {
    const headers = buildHeaders({ apiKey: 'hw_test_key_12345' });
    expect(headers.Authorization).toBe('Bearer hw_test_key_12345');
  });

  test('does not mutate the config object', () => {
    const config = { apiKey: 'hw_abc' };
    const snapshot = JSON.stringify(config);
    buildHeaders(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});
