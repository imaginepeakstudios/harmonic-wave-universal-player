/**
 * Vitest config — minimal.
 *
 * happy-dom enabled per-project so Step 5+ renderer tests can call
 * document.createElement etc. Pure-logic tests (engine, composition,
 * registry snapshot) don't need a DOM but pay no measurable cost from
 * having one available — happy-dom is fast (≈1ms env setup per file).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
});
