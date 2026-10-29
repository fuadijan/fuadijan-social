import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Database tests migrate a whole schema in beforeAll; sharp and the fixture workbook take a moment too.
    hookTimeout: 60_000,
    testTimeout: 120_000,
  },
});
