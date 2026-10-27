import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './desktop-tests', workers: 1, fullyParallel: false, timeout: 60_000, outputDir: 'desktop-test-results', use: { trace: 'retain-on-failure' } });
