import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.DAYLIGHT_DATABASE_URL && !process.env.DAYLIGHT_DB_PASSWORD) throw new Error('Thiếu DAYLIGHT_DB_PASSWORD hoặc DAYLIGHT_DATABASE_URL; chạy npm run db:setup trước.');
const host = process.env.DAYLIGHT_DB_HOST || '127.0.0.1';
const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
const url = process.env.DAYLIGHT_DATABASE_URL || `postgresql://${encodeURIComponent(process.env.DAYLIGHT_DB_USER || 'daylight')}:${encodeURIComponent(process.env.DAYLIGHT_DB_PASSWORD)}@${urlHost}:${process.env.DAYLIGHT_DB_PORT || '54329'}/${encodeURIComponent(process.env.DAYLIGHT_DB_NAME || 'daylight')}${process.env.DAYLIGHT_DB_SSL === 'true' ? '?sslmode=verify-full' : ''}`;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '', DAYLIGHT_DATABASE_URL: url } });
child.on('exit', code => { process.exitCode = code ?? 1; });
