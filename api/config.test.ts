import { expect, it } from 'vitest';
import { readConfig } from './config';
const env = { DAYLIGHT_DB_PASSWORD: 'test-only-password' };
it('defaults bind API to loopback and match local PostgreSQL compose port', () => {
  const config = readConfig(env); expect(config.host).toBe('127.0.0.1'); expect(config.port).toBe(3001);
  expect(config.database).toMatchObject({ host: '127.0.0.1', port: 54329, user: 'daylight', database: 'daylight', max: 8 });
});
it('URL overrides discrete connection settings and TLS always verifies certificates', () => {
  const config = readConfig({ ...env, DAYLIGHT_DATABASE_URL: 'postgresql://reader:pa%40ss@db.example:5432/focus?sslmode=require' });
  expect(config.database).toMatchObject({ host: 'db.example', port: 5432, user: 'reader', password: 'pa@ss', database: 'focus', ssl: { rejectUnauthorized: true } });
});
it.each([{ DAYLIGHT_API_PORT: 'abc' }, { DAYLIGHT_DB_PORT: '65536' }, { DAYLIGHT_DB_SSL: 'yes' }, { DAYLIGHT_DB_POOL_MAX: '0' }, { DAYLIGHT_API_CORS_ORIGINS: '*' }, { DAYLIGHT_API_TIME_ZONE: 'invalid-zone' }])('invalid configuration fails before serving requests: %o', patch => {
  expect(() => readConfig({ ...env, ...patch })).toThrow();
});
it('invalid URL failure does not include supplied credentials', () => {
  try { readConfig({ DAYLIGHT_DATABASE_URL: 'sensitive-password-is-not-a-url' }); throw new Error('Expected rejection'); }
  catch (error) { expect(String(error)).not.toContain('sensitive-password'); }
});
