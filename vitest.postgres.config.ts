import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['desktop/**/*.integration.test.ts'], environment: 'node', testTimeout: 20_000, hookTimeout: 20_000, fileParallelism: false } });
