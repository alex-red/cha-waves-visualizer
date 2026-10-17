import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Unit tests import plain TypeScript and explicit Vue APIs. Use a checked-in
  // config so a fresh checkout does not require generated Nuxt state first.
  tsconfig: './tsconfig.packages.json',
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/app/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
})
