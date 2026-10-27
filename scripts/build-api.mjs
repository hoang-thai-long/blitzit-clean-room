import { build } from 'esbuild';
await build({ entryPoints: ['api/server.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', outfile: 'api-dist/server.mjs', sourcemap: true });
