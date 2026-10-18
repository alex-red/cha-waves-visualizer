import { defineConfig } from 'vitest/config'
import { availableParallelism } from 'node:os'

export default defineConfig({
  // Unit tests import plain TypeScript and explicit Vue APIs. Use a checked-in
  // config so a fresh checkout does not require generated Nuxt state first.
  tsconfig: './tsconfig.packages.json',
  test: {
    // Several stereo suites render and hash full image fixtures. Bound concurrent
    // workers so those checks do not starve each other's wall-clock deadlines.
    maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
    include: ['packages/**/*.test.ts', 'apps/web/app/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
  },
})
