import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository, checkConfig, defaultDbConfig } from './repository';
import { newTask } from '../src/model';
const opened: { repo: Repository; directory: string }[] = [];
function fixture() { const directory = mkdtempSync(join(tmpdir(), 'daylight-unit-')); const repo = new Repository(directory); opened.push({ repo, directory }); return { repo, directory }; }
afterEach(async () => { for (const f of opened.splice(0)) { await f.repo.close(); rmSync(f.directory, { recursive: true, force: true }); } });
it('CAS rejects stale renderer snapshots instead of overwriting island actions', () => {
  const { repo } = fixture(); const before = repo.snapshot();
  repo.action({ type: 'launch', taskId: before.state.tasks[0].id }, 100_000);
  before.state.tasks.push(newTask('Stale edit', 'studio')!);
  expect(repo.commit(before.revision, before.state).accepted).toBe(false);
  expect(repo.snapshot().state.timer.status).toBe('running');
  expect(repo.snapshot().state.tasks.some(t => t.title === 'Stale edit')).toBe(false);
});
it('local outbox survives a new repository and running timer restores paused', async () => {
  const { repo, directory } = fixture(); const s = repo.snapshot(); s.state.tasks[0].notes = 'offline change'; repo.commit(s.revision, s.state);
  repo.action({ type: 'launch', taskId: s.state.tasks[0].id }, 100_000); repo.tick(102_000); await repo.close();
  const recovered = new Repository(directory); opened.push({ repo: recovered, directory: mkdtempSync(join(tmpdir(), 'daylight-unit-extra-')) });
  expect(recovered.snapshot().state.tasks[0].notes).toBe('offline change');
  expect(recovered.snapshot().state.timer).toMatchObject({ elapsed: 2000, status: 'paused' });
  expect(JSON.parse(readFileSync(join(directory, 'workspace-cache.json'), 'utf8')).dirty).toBe(true);
});
it('main timer produces one interval despite many observers', () => {
  const { repo } = fixture(); const s = repo.snapshot(); const count = s.state.sessions.length;
  repo.action({ type: 'launch', taskId: s.state.tasks[0].id }, 100_000); repo.tick(105_000);
  repo.snapshot(); repo.snapshot();
  repo.action({ type: 'stop' }, 105_000); repo.action({ type: 'stop' }, 106_000);
  expect(repo.snapshot().state.sessions).toHaveLength(count + 1);
});
it('invalid connection config is rejected before database effects', () => {
  expect(() => checkConfig({ ...defaultDbConfig, workspace: '../escape' })).toThrow();
  expect(() => checkConfig({ ...defaultDbConfig, port: 0 })).toThrow();
  expect(() => checkConfig(defaultDbConfig)).not.toThrow();
});
