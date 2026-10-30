import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror the aliases Nuxt provides (#server/#shared are built in there).
    alias: {
      '#server': fileURLToPath(new URL('./server', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@@': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // PGlite boot + migrations in beforeAll can exceed the 10s default under
    // a parallel full-suite run.
    hookTimeout: 60_000,
    include: [
      'app/**/*.test.ts',
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
})
