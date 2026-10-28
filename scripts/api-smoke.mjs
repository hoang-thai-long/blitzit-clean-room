import assert from 'node:assert/strict';
const base = `http://127.0.0.1:${process.env.DAYLIGHT_API_PORT || 3001}`;
async function request(path, options) { const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000), ...options }); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response; }
assert.equal((await (await request('/health')).json()).status, 'ok');
assert.equal((await (await request('/ready')).json()).database, 'postgresql');
const spec = await (await request('/openapi.json')).json();
assert.ok(spec.paths['/api/v1/workspaces/{workspace}/tasks']);
const html = await (await request('/docs/')).text(); assert.ok(html.includes('swagger-ui'));
// This deliberately creates one user-visible sample workspace, and never replaces it.
const workspace = '/api/v1/workspaces/api-demo';
const existing = await fetch(`${base}${workspace}`, { signal: AbortSignal.timeout(10_000) });
if (existing.status === 404) await request('/api/v1/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'api-demo', seed: true }) });
else if (!existing.ok) throw new Error(`Cannot read api-demo: HTTP ${existing.status}`);
const tasks = await (await request(`${workspace}/tasks?limit=5`)).json();
const report = await (await request(`${workspace}/reports/overview?days=7`)).json();
assert.equal(report.data.formula, 'daylight-local-v1');
const lightweightPage = await (await request(`${workspace}/sessions?limit=5&totals=false`)).json();
assert.equal(lightweightPage.data.total, null);
assert.equal(lightweightPage.data.totalDurationMs, null);
console.log(JSON.stringify({ status: 'PASS', api: base, docs: `${base}/docs/`, workspace: 'api-demo', taskCount: tasks.data.total, openApiPaths: Object.keys(spec.paths).length }, null, 2));
