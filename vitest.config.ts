import { defineConfig } from 'vitest/config';

// Tests unitaires (logique pure). Les tests E2E Playwright vivent dans e2e/ et se lancent via `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
