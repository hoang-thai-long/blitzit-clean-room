import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'desktop/**/*.test.ts'], exclude: ['desktop/**/*.integration.test.ts'], environment: 'node' } });
