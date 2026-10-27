import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApi } from './app';
import { readConfig } from './config';
import { Database } from './database';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance, database: Database, id: string, base: string;
const created: string[] = [];
const config = readConfig({ ...process.env, DAYLIGHT_API_LOG_LEVEL: 'silent', DAYLIGHT_API_TIME_ZONE: 'UTC' });
beforeAll(async () => { database = new Database(config); await database.migrate(); app = await createApi(config, database); await app.ready(); });
beforeEach(async () => {
  id = `api-test-${randomUUID()}`; created.push(id); base = `/api/v1/workspaces/${id}`;
  const response = await app.inject({ method: 'POST', url: '/api/v1/workspaces', payload: { id } }); expect(response.statusCode).toBe(201);
});
afterEach(async () => { await database.pool.query('DELETE FROM daylight_workspaces WHERE id = ANY($1::text[])', [created.splice(0)]); });
afterAll(async () => { await app?.close(); });
async function list(name = 'API list') {
  const response = await app.inject({ method: 'POST', url: `${base}/lists`, payload: { name } }); expect(response.statusCode).toBe(201); return response.json().data as { id: string; name: string };
}
async function task(listId?: string, title = 'API task') {
  const response = await app.inject({ method: 'POST', url: `${base}/tasks`, payload: { title, listId: listId ?? (await list()).id } }); expect(response.statusCode).toBe(201); return response.json().data as { id: string; listId: string; stage: string };
}
const snapshot = async () => (await app.inject({ method: 'GET', url: base })).json();

it('health, readiness, Swagger UI and OpenAPI expose the actual contract', async () => {
  expect((await app.inject('/health')).json().status).toBe('ok');
  expect((await app.inject('/ready')).json().database).toBe('postgresql');
  expect((await app.inject('/docs/')).statusCode).toBe(200);
  const spec = (await app.inject('/openapi.json')).json();
  expect(spec.paths['/api/v1/workspaces/{workspace}/tasks'].post).toBeTruthy();
  expect(spec.paths['/api/v1/workspaces/{workspace}/sessions/export.csv'].get).toBeTruthy();
});
it('workspace creation is explicit, seeds once and never overwrites duplicates', async () => {
  const seededId = `${id}-seed`; created.push(seededId);
  const response = await app.inject({ method: 'POST', url: '/api/v1/workspaces', payload: { id: seededId, seed: true } });
  expect(response.statusCode).toBe(201); expect(response.json().data.tasks).toHaveLength(9);
  expect((await app.inject({ method: 'POST', url: '/api/v1/workspaces', payload: { id: seededId } })).statusCode).toBe(409);
  expect((await app.inject('/api/v1/workspaces/missing-test-workspace')).statusCode).toBe(404);
});
it('title validation and unknown properties reject bad writes without changing revision', async () => {
  const l = await list(); const before = await snapshot();
  expect((await app.inject({ method: 'POST', url: `${base}/tasks`, payload: { listId: l.id, title: '  ' } })).statusCode).toBe(422);
  expect((await app.inject({ method: 'POST', url: `${base}/tasks`, payload: { listId: l.id, title: 'ok', deleted: true } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: `${base}/tasks`, payload: { listId: 'missing', title: 'ok' } })).statusCode).toBe(404);
  expect((await snapshot()).revision).toBe(before.revision);
});
it('task patches distinguish clearing notes/estimate, Done and reopen', async () => {
  const t = await task();
  const patch = await app.inject({ method: 'PATCH', url: `${base}/tasks/${t.id}`, payload: { notes: '**Notes**', estimate: 25, due: '2026-10-28' } });
  expect(patch.statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: `${base}/tasks/${t.id}/notes` })).json().data.notes).toBe('**Notes**');
  await app.inject({ method: 'PUT', url: `${base}/tasks/${t.id}/notes`, payload: { notes: '' } });
  const cleared = await app.inject({ method: 'PATCH', url: `${base}/tasks/${t.id}`, payload: { estimate: null } });
  expect(cleared.json().data).toMatchObject({ notes: '', estimate: null });
  const done = await app.inject({ method: 'POST', url: `${base}/tasks/${t.id}/complete` }); expect(done.json().data.completedAt).toBeGreaterThan(0);
  const reopened = await app.inject({ method: 'POST', url: `${base}/tasks/${t.id}/reopen` }); expect(reopened.json().data).toMatchObject({ stage: 'Today', completedAt: null });
  expect((await app.inject({ method: 'PATCH', url: `${base}/tasks/${t.id}`, payload: { due: '2026-02-30' } })).statusCode).toBe(422);
});
it('subtask notes/due/toggle/reorder/delete stay independent from the parent', async () => {
  const t = await task();
  const a = (await app.inject({ method: 'POST', url: `${base}/tasks/${t.id}/subtasks`, payload: { title: 'First', notes: 'Sub note', due: '2026-10-29' } })).json().data;
  const b = (await app.inject({ method: 'POST', url: `${base}/tasks/${t.id}/subtasks`, payload: { title: 'Second' } })).json().data;
  const renamed = await app.inject({ method: 'PATCH', url: `${base}/tasks/${t.id}/subtasks/${a.id}`, payload: { title: ' ', done: true } });
  expect(renamed.json().data).toMatchObject({ title: 'First', done: true, notes: 'Sub note' });
  const reordered = await app.inject({ method: 'PUT', url: `${base}/tasks/${t.id}/subtasks/order`, payload: { ids: [b.id, a.id] } });
  expect(reordered.json().data.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
  expect((await app.inject({ method: 'PUT', url: `${base}/tasks/${t.id}/subtasks/order`, payload: { ids: [a.id] } })).statusCode).toBe(422);
  await app.inject({ method: 'DELETE', url: `${base}/tasks/${t.id}/subtasks/${b.id}` });
  const parent = (await app.inject(`${base}/tasks/${t.id}`)).json().data;
  expect(parent.subtasks).toHaveLength(1); expect(parent.stage).toBe('Today'); expect(parent.notes).toBe('');
});
it('list rename/duplicate/reorder/archive/restore and delete preserve specified child semantics', async () => {
  const first = await list('First'), second = await list('Second'), t = await task(first.id);
  const copy = await app.inject({ method: 'POST', url: `${base}/lists/${first.id}/duplicate` }); expect(copy.json().data.name).toBe('First Copy');
  expect((await snapshot()).data.tasks).toHaveLength(1);
  const reordered = await app.inject({ method: 'POST', url: `${base}/lists/reorder`, payload: { ids: [second.id, copy.json().data.id, first.id] } }); expect(reordered.json().data[0].id).toBe(second.id);
  await app.inject({ method: 'PATCH', url: `${base}/lists/${first.id}`, payload: { name: 'Renamed' } });
  await app.inject({ method: 'POST', url: `${base}/lists/${first.id}/archive` });
  expect((await app.inject(`${base}/tasks`)).json().data.total).toBe(0);
  expect((await app.inject(`${base}/tasks/${t.id}`)).json().data.archived).toBe(false);
  await app.inject({ method: 'POST', url: `${base}/lists/${first.id}/restore` });
  expect((await app.inject(`${base}/tasks`)).json().data.total).toBe(1);
  await app.inject({ method: 'DELETE', url: `${base}/lists/${first.id}` });
  expect((await app.inject(`${base}/tasks?archived=true`)).json().data.total).toBe(1);
  const restored = await app.inject({ method: 'POST', url: `${base}/tasks/${t.id}/restore`, payload: { listId: second.id } }); expect(restored.json().data).toMatchObject({ listId: second.id, archived: false });
});
it('bulk results deduplicate IDs and preserve success/skipped/error states', async () => {
  const l = await list(), a = await task(l.id), b = await task(l.id);
  await app.inject({ method: 'DELETE', url: `${base}/tasks/${b.id}` });
  const response = await app.inject({ method: 'POST', url: `${base}/tasks/bulk`, payload: { ids: [a.id, a.id, b.id, 'missing'], operation: 'done' } });
  expect(response.json().data.map((x: { status: string }) => x.status)).toEqual(['success', 'skipped', 'error']);
  const before = (await snapshot()).revision;
  await app.inject({ method: 'POST', url: `${base}/tasks/bulk`, payload: { ids: [], operation: 'delete' } }); expect((await snapshot()).revision).toBe(before);
});
it('preferences patch preserves other values; invalid durations are rejected', async () => {
  const response = await app.inject({ method: 'PATCH', url: `${base}/preferences`, payload: { mode: 'system', brand: 'Cosmic Indigo' } });
  expect(response.json().data).toMatchObject({ mode: 'system', brand: 'Cosmic Indigo', short: 5 });
  expect((await app.inject({ method: 'PATCH', url: `${base}/preferences`, payload: { short: 0 } })).statusCode).toBe(400);
  expect((await app.inject(`${base}/preferences`)).json().data.short).toBe(5);
});
it('ETag/If-Match rejects stale writes atomically', async () => {
  const l = await list(); const old = await app.inject(base);
  expect(old.headers.etag).toMatch(/^"\d+"$/);
  const ok = await app.inject({ method: 'PATCH', url: `${base}/lists/${l.id}`, headers: { 'if-match': String(old.headers.etag) }, payload: { name: 'New name' } }); expect(ok.statusCode).toBe(200);
  const stale = await app.inject({ method: 'PATCH', url: `${base}/lists/${l.id}`, headers: { 'if-match': String(old.headers.etag) }, payload: { name: 'Stale name' } });
  expect(stale.statusCode).toBe(412); expect(stale.json().error.code).toBe('REVISION_MISMATCH');
  expect((await app.inject(`${base}/lists/${l.id}`)).json().data.name).toBe('New name');
});
it('concurrent independent API mutations serialize without lost tasks', async () => {
  const l = await list();
  const responses = await Promise.all([1, 2, 3, 4].map(n => app.inject({ method: 'POST', url: `${base}/tasks`, payload: { title: `Concurrent ${n}`, listId: l.id } })));
  expect(responses.map(r => r.statusCode)).toEqual([201, 201, 201, 201]);
  expect((await snapshot()).data.tasks).toHaveLength(4);
});
it('a desktop writer lock allows reads but API writes return 423, then recover', async () => {
  const client = await database.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`daylight:${id}`]);
    expect((await app.inject(base)).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: `${base}/lists`, payload: { name: 'Blocked' } });
    expect(response.statusCode).toBe(423); expect(response.json().error.code).toBe('WORKSPACE_BUSY');
    expect((await snapshot()).data.lists).toHaveLength(0);
  } finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`daylight:${id}`]); client.release(); }
  expect((await list('After unlock')).name).toBe('After unlock');
});
it('session CRUD validates interval and preserves duration on start-only edit', async () => {
  const t = await task(), start = Date.UTC(2026, 9, 20, 9);
  expect((await app.inject({ method: 'POST', url: `${base}/sessions`, payload: { taskId: t.id, start, end: start } })).statusCode).toBe(422);
  const session = (await app.inject({ method: 'POST', url: `${base}/sessions`, payload: { taskId: t.id, start, end: start + 90_000 } })).json().data;
  const moved = await app.inject({ method: 'PATCH', url: `${base}/sessions/${session.id}`, payload: { start: start + 86_400_000 } });
  expect(moved.json().data.end - moved.json().data.start).toBe(90_000);
  expect((await app.inject(`${base}/sessions/${session.id}`)).statusCode).toBe(200);
  await app.inject({ method: 'DELETE', url: `${base}/sessions/${session.id}` });
  expect((await app.inject(`${base}/sessions/${session.id}`)).statusCode).toBe(404);
});
it('session CSV exports all 121 matching rows, escapes formulas/quotes/newlines and keeps fractional minutes', async () => {
  const t = await task(undefined, '=SUM("x")\nnext'), start = Date.UTC(2026, 9, 20, 9);
  await database.mutate(id, undefined, s => {
    s.sessions = Array.from({ length: 121 }, (_, i) => ({ id: randomUUID(), taskId: t.id, listId: t.listId, title: '=SUM("x")\nnext', start: start + i * 1000, end: start + i * 1000 + 90_000, kind: 'work' as const })); return { state: s, data: null };
  });
  const page = await app.inject(`${base}/sessions?limit=10&offset=0`);
  expect(page.json().data.items).toHaveLength(10); expect(page.json().data.total).toBe(121); expect(page.json().data.totalDurationMs).toBe(121 * 90_000);
  const csv = await app.inject(`${base}/sessions/export.csv?listId=${t.listId}`);
  expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.body.match(/"1.5"/g)).toHaveLength(121); expect(csv.body).toContain('"\'=SUM(""x"")\nnext"');
  expect((await app.inject(`${base}/sessions?limit=500`)).statusCode).toBe(400);
});
it('reports use complete filtered state, calendar zero days and no average without completed tasks', async () => {
  const t = await task(), start = Date.UTC(2026, 9, 19, 9);
  await app.inject({ method: 'POST', url: `${base}/sessions`, payload: { taskId: t.id, start, end: start + 3600_000 } });
  const response = await app.inject(`${base}/reports/overview?start=2026-10-19&end=2026-10-26`);
  expect(response.statusCode).toBe(200); const data = response.json().data;
  expect(data.totals).toMatchObject({ focusMs: 3600_000, activeDays: 1, averageFocusPerCompletedTaskMs: null });
  expect(data.weekdays[1]).toMatchObject({ calendarDays: 2, averageMinutes: 30 });
  expect(data.startsByHour[9].sessions).toBe(1);
  expect((await app.inject(`${base}/reports/overview?start=2026-02-30&end=2026-03-01`)).statusCode).toBe(422);
  expect((await app.inject(`${base}/reports/overview?start=2020-01-01&end=2026-03-01`)).statusCode).toBe(422);
});
it('CORS allows the web app and same-origin Swagger, and rejects unlisted browser origins', async () => {
  const good = await app.inject({ method: 'GET', url: base, headers: { origin: 'http://localhost:5173' } }); expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  expect((await app.inject({ method: 'GET', url: base, headers: { origin: `http://127.0.0.1:${config.port}` } })).statusCode).toBe(200);
  const bad = await app.inject({ method: 'POST', url: `${base}/lists`, headers: { origin: 'https://unlisted.example' }, payload: { name: 'Must not write' } });
  expect(bad.statusCode).toBe(403); expect((await snapshot()).data.lists).toHaveLength(0);
});
it('database failure returns 503 without exposing connection credentials', async () => {
  const unavailable = await createApi({ ...config, database: { ...config.database, port: 1, connectionTimeoutMillis: 100 } });
  try {
    expect((await unavailable.inject('/ready')).statusCode).toBe(503);
    const response = await unavailable.inject(base); expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(String(config.database.password)); expect(response.body).not.toContain('SELECT');
  } finally { await unavailable.close(); }
});
