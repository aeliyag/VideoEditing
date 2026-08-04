import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.browser.test.ts'],
    environmentMatchGlobs: [['**/*.browser.test.ts', 'happy-dom']],
  },
})
