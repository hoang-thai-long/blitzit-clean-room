import { afterEach, beforeEach, expect, it } from 'vitest';
import { Client } from 'pg';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository, defaultDbConfig } from './repository';
import type { DbConfig } from './types';
let directory: string, config: DbConfig, repo: Repository, sql: Client;
const others: Repository[] = [];
beforeEach(async () => {
  if (!process.env.DAYLIGHT_DB_PASSWORD) throw new Error('Run npm run db:setup && npm run db:up first');
  directory = mkdtempSync(join(tmpdir(), 'daylight-postgres-'));
  config = { ...defaultDbConfig, database: process.env.DAYLIGHT_DB_NAME || 'daylight', password: process.env.DAYLIGHT_DB_PASSWORD, port: Number(process.env.DAYLIGHT_DB_PORT || 54329), workspace: `test-${randomUUID()}` };
  sql = new Client({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });
  await sql.connect(); repo = new Repository(directory); await repo.connect(config);
});
afterEach(async () => { await repo?.close(); for (const r of others.splice(0)) await r.close(); if (sql) { await sql.query('DELETE FROM daylight_workspaces WHERE id = $1', [config.workspace]); await sql.end(); } if (directory) rmSync(directory, { recursive: true, force: true }); });
it('real PostgreSQL stores complete workspace and a fresh installation reloads it', async () => {
  expect(repo.snapshot().database.phase).toBe('synced');
  const snapshot = repo.snapshot(); snapshot.state.tasks[0].notes = 'Persisted to actual PostgreSQL'; snapshot.state.prefs.brand = 'Cosmic Indigo';
  repo.commit(snapshot.revision, snapshot.state); await repo.flush();
  const row = (await sql.query('SELECT state, revision FROM daylight_workspaces WHERE id = $1', [config.workspace])).rows[0];
  expect(row.state.tasks[0].notes).toBe('Persisted to actual PostgreSQL'); expect(Number(row.revision)).toBeGreaterThan(1);
  await repo.close();
  const fresh = new Repository(join(directory, 'fresh')); others.push(fresh); await fresh.connect(config);
  expect(fresh.snapshot().state.prefs.brand).toBe('Cosmic Indigo'); expect(fresh.snapshot().state.tasks[0].notes).toBe('Persisted to actual PostgreSQL');
});
it('PostgreSQL disconnect queues local edits and reconnect syncs them', async () => {
  await sql.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid() AND datname = current_database()', [`Daylight:${config.workspace}`]);
  await new Promise(resolve => setTimeout(resolve, 100));
  const snapshot = repo.snapshot(); snapshot.state.tasks[1].notes = 'Edited while offline'; repo.commit(snapshot.revision, snapshot.state);
  expect(repo.snapshot().database.phase).toBe('offline');
  await repo.connect(config); await repo.flush();
  expect(repo.snapshot().database.phase).toBe('synced');
  expect((await sql.query('SELECT state FROM daylight_workspaces WHERE id = $1', [config.workspace])).rows[0].state.tasks[1].notes).toBe('Edited while offline');
});
it('database revision conflict does not overwrite either side; explicit load backs up local', async () => {
  const old = repo.snapshot();
  await sql.query('UPDATE daylight_workspaces SET revision = revision + 1 WHERE id = $1', [config.workspace]);
  old.state.tasks[0].notes = 'Keep this conflicting local draft'; repo.commit(old.revision, old.state); await repo.flush();
  expect(repo.snapshot().database.phase).toBe('conflict');
  expect((await sql.query('SELECT state FROM daylight_workspaces WHERE id = $1', [config.workspace])).rows[0].state.tasks[0].notes).not.toBe('Keep this conflicting local draft');
  await repo.useDatabase();
  expect(repo.snapshot().database.phase).toBe('synced');
  expect(readdirSync(directory).some(name => name.startsWith('workspace-backup-'))).toBe(true);
});
it('exclusive writer lock rejects a second desktop instance for the same workspace', async () => {
  const other = new Repository(join(directory, 'second')); others.push(other); await other.connect(config);
  expect(other.snapshot().database.phase).toBe('offline'); expect(other.snapshot().database.message).toContain('app khác');
});

it('edits during reconnect wait until the PostgreSQL base revision has been loaded', async () => {
  await sql.query('BEGIN');
  await sql.query('LOCK TABLE daylight_workspaces IN ACCESS EXCLUSIVE MODE');
  const reconnecting = repo.connect(config);
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    const snapshot = repo.snapshot(); snapshot.state.tasks[0].notes = 'Edit during database initialization';
    repo.commit(snapshot.revision, snapshot.state);
    const started = Date.now(); await repo.flush();
    expect(Date.now() - started).toBeLessThan(1000);
  } finally { await sql.query('COMMIT'); }
  await reconnecting; await repo.flush();
  expect(repo.snapshot().database.phase).toBe('synced');
  expect((await sql.query('SELECT state FROM daylight_workspaces WHERE id = $1', [config.workspace])).rows[0].state.tasks[0].notes).toBe('Edit during database initialization');
});
