import { defineConfig } from 'vitest/config';

// Runs only the demo generator (network access, minutes). Not part of `npm test`.
export default defineConfig({
  test: { environment: 'node', include: ['scripts/demo/*.gen.ts'], testTimeout: 45 * 60_000, root: '.' },
});
