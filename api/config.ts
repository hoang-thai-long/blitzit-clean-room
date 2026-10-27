import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export type ApiConfig = { host: string; port: number; origins: string[]; timeZone: string; logLevel: 'info' | 'warn' | 'error' | 'debug' | 'silent'; lockTimeoutMs: number; database: PoolConfig };
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  let host = env.DAYLIGHT_DB_HOST || '127.0.0.1', port = integer(env, 'DAYLIGHT_DB_PORT', 54329, 1, 65535);
  let database = env.DAYLIGHT_DB_NAME || 'daylight', user = env.DAYLIGHT_DB_USER || 'daylight', password = env.DAYLIGHT_DB_PASSWORD;
  if (env.DAYLIGHT_DB_SSL !== undefined && !['true', 'false'].includes(env.DAYLIGHT_DB_SSL)) throw new Error('DAYLIGHT_DB_SSL must be true or false');
  let tls = env.DAYLIGHT_DB_SSL === 'true';
  if (env.DAYLIGHT_DATABASE_URL) {
    let url: URL;
    try { url = new URL(env.DAYLIGHT_DATABASE_URL); } catch { throw new Error('Invalid DAYLIGHT_DATABASE_URL (URL value omitted)'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DAYLIGHT_DATABASE_URL must use postgres:// or postgresql://');
    host = url.hostname; port = Number(url.port || 5432); database = decodeURIComponent(url.pathname.slice(1)); user = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
    const mode = url.searchParams.get('sslmode');
    if (mode && !['disable', 'require', 'verify-full', 'verify-ca'].includes(mode)) throw new Error('Unsupported sslmode; use disable or verify-full');
    if (mode) tls = mode !== 'disable';
  }
  if (!host || !database || !user || password === undefined || !password.length) throw new Error('PostgreSQL host/database/user/password are required. Run npm run db:setup, or configure DAYLIGHT_DATABASE_URL.');
  const origins = (env.DAYLIGHT_API_CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',').map(s => s.trim()).filter(Boolean);
  if (origins.some(origin => { try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; } catch { return true; } })) throw new Error('CORS origins must be exact http(s) origins, without paths or wildcards');
  const timeZone = env.DAYLIGHT_API_TIME_ZONE || 'Asia/Ho_Chi_Minh';
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); } catch { throw new Error('Invalid DAYLIGHT_API_TIME_ZONE'); }
  const logLevel = env.DAYLIGHT_API_LOG_LEVEL || 'info';
  if (!['info', 'warn', 'error', 'debug', 'silent'].includes(logLevel)) throw new Error('Invalid DAYLIGHT_API_LOG_LEVEL');
  const queryTimeout = integer(env, 'DAYLIGHT_DB_QUERY_TIMEOUT_MS', 5000, 100, 60_000);
  return {
    host: env.DAYLIGHT_API_HOST || '127.0.0.1', port: integer(env, 'DAYLIGHT_API_PORT', 3001, 1, 65535), origins, timeZone, logLevel: logLevel as ApiConfig['logLevel'],
    lockTimeoutMs: integer(env, 'DAYLIGHT_DB_LOCK_TIMEOUT_MS', 750, 50, 10_000),
    database: { host, port, database, user, password, ssl: tls ? { rejectUnauthorized: true, ...(env.DAYLIGHT_DB_CA_FILE ? { ca: readFileSync(env.DAYLIGHT_DB_CA_FILE, 'utf8') } : {}) } : false,
      max: integer(env, 'DAYLIGHT_DB_POOL_MAX', 8, 1, 50), connectionTimeoutMillis: integer(env, 'DAYLIGHT_DB_CONNECT_TIMEOUT_MS', 3000, 100, 30_000), idleTimeoutMillis: 30_000,
      statement_timeout: queryTimeout, query_timeout: queryTimeout + 1000, application_name: 'Daylight-API' },
  };
}
