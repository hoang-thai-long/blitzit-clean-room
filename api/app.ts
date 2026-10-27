import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { BRANDS, type Preferences, type State, type Subtask } from '../src/model';
import { Queries } from './queries';
import type { Scope } from '../database/store';
import type { ApiConfig } from './config';
import { Database, type Workspace } from './database';
import { ApiError, invalid, notFound } from './errors';
import * as schema from './schemas';
import * as domain from './domain';
import { report, sessionsMatching, type Filters } from './reports';

type Params = { workspace: string; listId: string; taskId: string; subtaskId: string; sessionId: string };
type PageQuery = { limit?: string; offset?: string; cursor?:string };
const root = '/api/v1/workspaces';
const path = `${root}/:workspace`;
const paging = <T>(items: T[], query: PageQuery) => { const limit = Number(query.limit ?? 50), offset = Number(query.offset ?? 0); return { items: items.slice(offset, offset + limit), total: items.length, limit, offset, nextOffset: offset + limit < items.length ? offset + limit : null }; };
type Meta=Pick<Workspace,'id'|'revision'|'updatedAt'> & {state?:State};
function etag(reply: FastifyReply, workspace: Meta) { reply.header('ETag', `"${workspace.revision}"`).header('Cache-Control', 'no-store'); }
function envelope(reply: FastifyReply, workspace: Meta, data: unknown = workspace.state) { etag(reply, workspace); return { workspaceId: workspace.id, revision: workspace.revision, updatedAt: workspace.updatedAt, data }; }
function mutationScope(request:FastifyRequest):Scope {
  const p=request.params as Params,b=(request.body??{}) as {ids?:string[];taskId?:string;listId?:string;stage?:string};const url=request.routeOptions.url??'';
  const lists={listIds:[...(p.listId?[p.listId]:[]),...(b.listId?[b.listId]:[])]};
  if(url.endsWith('/lists')||url.endsWith('/lists/reorder'))return {allLists:request.method==='GET'||url.endsWith('/reorder')};
  if(url.endsWith('/tasks/bulk'))return {taskIds:b.ids};
  if(url.endsWith('/tasks/reorder'))return {taskStage:b.stage,taskListId:b.listId};
  if(p.listId && request.method==='DELETE')return {...lists,taskListId:p.listId};
  return {...lists,taskIds:p.taskId?[p.taskId]:b.taskId?[b.taskId]:[],sessionIds:p.sessionId?[p.sessionId]:[],fallbackList:!!p.taskId&&url.endsWith('/restore')};
}
function expectedRevision(request: FastifyRequest): number | undefined {
  const value = request.headers['if-match']; if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^"\d+"$/.test(value)) throw new ApiError(400, 'INVALID_IF_MATCH', 'If-Match must be a quoted numeric revision, e.g. "2"');
  const revision = Number(value.slice(1, -1)); if (!Number.isSafeInteger(revision)) throw new ApiError(400, 'INVALID_IF_MATCH', 'Invalid revision'); return revision;
}
const patchBody = (properties: Record<string, unknown>) => ({ ...schema.object(properties), minProperties: 1 });
const orderBody = schema.object({ ids: { type: 'array', items: schema.entityId, maxItems: 5000, uniqueItems: true } }, ['ids']);

export async function createApi(config: ApiConfig, database = new Database(config)) {
  const queries=new Queries(database,config.timeZone);
  const origins = [...new Set([...config.origins, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`, `http://[::1]:${config.port}`])];
  const app = Fastify({ logger: config.logLevel === 'silent' ? false : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.addHook('onClose', async () => database.close());
  app.addHook('onRequest', async request => {
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not in DAYLIGHT_API_CORS_ORIGINS');
  });
  await app.register(cors, { origin: origins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'If-Match'], exposedHeaders: ['ETag', 'Content-Disposition'], credentials: false });
  await app.register(swagger, { openapi: { info: { title: 'Daylight local REST API', version: '1.0.0', description: 'Independent local-first API backed by PostgreSQL. No product authentication. Writes share the desktop writer lock; a desktop-owned workspace returns 423. See API.md.' }, tags: ['System', 'Workspaces', 'Lists', 'Tasks', 'Subtasks', 'Preferences', 'Sessions', 'Reports'].map(name => ({ name })) } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: { instancePath: string; keyword: string }[] }, request, reply) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'Request could not be completed';
    if (error instanceof ApiError) { status = error.status; code = error.code; message = error.message; }
    else if (error.validation) { status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid request parameters or body'; }
    else if (error.code === '55P03') { status = 423; code = 'WORKSPACE_BUSY'; message = 'Workspace is owned by desktop or another writer; close that app or retry later'; reply.header('Retry-After', '1'); }
    else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '57014', '53300'].includes(error.code ?? '') || /timeout|connection|terminated/i.test(error.message)) { status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'PostgreSQL is unavailable; no save was confirmed'; }
    else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) { status = error.statusCode; code = error.code ?? 'BAD_REQUEST'; message = status === 413 ? 'Request body is too large' : 'Invalid request'; }
    if (status >= 500) app.log.error({ requestId: request.id, code }, 'API request failed');
    reply.code(status).send({ error: { code, message, ...(error.validation ? { details: error.validation.map(v => ({ path: v.instancePath, rule: v.keyword })) } : {}) }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId: request.id }));

  const read = async (request: FastifyRequest) => request.routeOptions.url===path ? database.read((request.params as Params).workspace) : database.readScoped((request.params as Params).workspace,mutationScope(request));
  const mutate = async <T>(request: FastifyRequest, reply: FastifyReply, fn: (s: State) => { state: State; data: T }) => {
    const result = await database.mutate((request.params as Params).workspace, expectedRevision(request), fn,mutationScope(request)); return envelope(reply, result.workspace, result.data);
  };
  const route = (tag: string, summary: string, extra: Record<string, unknown> = {}) => ({ tags: [tag], summary, ...extra });
  const scoped = (tag: string, summary: string, entity?: 'listId' | 'taskId' | 'sessionId', extra: Record<string, unknown> = {}) => route(tag, summary, { params: schema.params(entity), ...extra });

  app.get('/health', { schema: route('System', 'Process liveness') }, async () => ({ status: 'ok', service: 'daylight-api' }));
  app.get('/ready', { schema: route('System', 'PostgreSQL readiness') }, async (_request, reply) => { try { await database.health(); return { status: 'ok', database: 'postgresql' }; } catch { return reply.code(503).send({ status: 'unavailable', database: 'postgresql' }); } });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.get<{ Querystring: PageQuery }>(root, { schema: route('Workspaces', 'List workspace metadata', { querystring: schema.object(schema.paging) }) }, async request => ({ data: await database.list(Number(request.query.limit), Number(request.query.offset)) }));
  app.post<{ Body: { id: string; seed?: boolean } }>(root, { schema: route('Workspaces', 'Create an empty or sample workspace; never overwrite existing', { body: schema.object({ id: schema.workspaceId, seed: schema.bool }, ['id']) }) }, async (request, reply) => {
    const workspace = await database.create(request.body.id, request.body.seed ?? false); reply.code(201).header('Location', `${root}/${workspace.id}`); return envelope(reply, workspace);
  });
  app.get(path, { schema: scoped('Workspaces', 'Read complete workspace snapshot, including archived/deleted history') }, async (request, reply) => envelope(reply, await read(request)));

  app.get<{ Querystring: { archived?: 'true' | 'false' } }>(`${path}/lists`, { schema: scoped('Lists', 'List non-deleted lists', undefined, { querystring: schema.object({ archived: { type: 'string', enum: ['true', 'false'], default: 'false' } }) }) }, async (request, reply) => { const w = await read(request); return envelope(reply, w, w.state.lists.filter(l => !l.deleted && l.archived === (request.query.archived === 'true'))); });
  app.post<{ Body: { name: string; color?: string } }>(`${path}/lists`, { schema: scoped('Lists', 'Create list', undefined, { headers: schema.headers, body: schema.object({ name: schema.title, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }, ['name']) }) }, async (request, reply) => { const result = await mutate(request, reply, s => ({ state: s, data: domain.createList(s, request.body) })); return reply.code(201).send(result); });
  app.post<{ Body: { ids: string[] } }>(`${path}/lists/reorder`, { schema: scoped('Lists', 'Reorder all active lists; IDs must be complete and unique', undefined, { headers: schema.headers, body: orderBody }) }, async (request, reply) => mutate(request, reply, s => {
    const ordered = domain.exactOrder(s.lists.filter(l => !l.deleted && !l.archived), request.body.ids); let i = 0; s.lists = s.lists.map(l => !l.deleted && !l.archived ? ordered[i++] : l); return { state: s, data: ordered };
  }));
  app.get<{ Params: Params }>(`${path}/lists/:listId`, { schema: scoped('Lists', 'Read list', 'listId') }, async (request, reply) => { const w = await read(request); return envelope(reply, w, domain.listOf(w.state, request.params.listId)); });
  app.patch<{ Params: Params; Body: { name?: string; color?: string } }>(`${path}/lists/:listId`, { schema: scoped('Lists', 'Rename or recolor list', 'listId', { headers: schema.headers, body: patchBody({ name: schema.title, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }) }) }, async (request, reply) => mutate(request, reply, s => { const list = domain.listOf(s, request.params.listId); Object.assign(list, request.body, request.body.name !== undefined ? { name: domain.named(request.body.name) } : {}); return { state: s, data: list }; }));
  for (const action of ['archive', 'restore', 'duplicate'] as const) app.post<{ Params: Params }>(`${path}/lists/:listId/${action}`, { schema: scoped('Lists', `${action} list`, 'listId', { headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => domain.listAction(s, request.params.listId, action)));
  app.delete<{ Params: Params }>(`${path}/lists/:listId`, { schema: scoped('Lists', 'Soft-delete list and archive children; preserve sessions', 'listId', { headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => domain.listAction(s, request.params.listId, 'delete')));

  app.get<{ Querystring: PageQuery & { listId?: string; stage?: string; archived?: string; q?: string } }>(`${path}/tasks`, { schema: scoped('Tasks', 'Search and paginate board tasks, or explicitly archived tasks', undefined, { querystring: schema.object({ ...schema.paging, listId: schema.entityId, stage: schema.stage, archived: { type: 'string', enum: ['true', 'false'], default: 'false' }, q: { type: 'string', maxLength: 300 } }) }) }, async (request, reply) => {
    const result=await queries.tasks((request.params as Params).workspace,request.query);return envelope(reply,result.workspace,result.data);
  });
  const taskProperties = { title: schema.title, listId: schema.entityId, stage: schema.stage, notes: schema.notes, estimate: schema.estimate, due: schema.due };
  app.post<{ Body: domain.TaskInput }>(`${path}/tasks`, { schema: scoped('Tasks', 'Create task', undefined, { headers: schema.headers, body: schema.object(taskProperties, ['title', 'listId']) }) }, async (request, reply) => { const result = await mutate(request, reply, s => ({ state: s, data: domain.createTask(s, request.body) })); return reply.code(201).send(result); });
  app.post<{ Body: { ids: string[]; operation: 'done' | 'archive' | 'delete' } }>(`${path}/tasks/bulk`, { schema: scoped('Tasks', 'Bulk action with distinct success/skipped/error results', undefined, { headers: schema.headers, body: schema.object({ ids: { type: 'array', items: schema.entityId, maxItems: 5000 }, operation: { type: 'string', enum: ['done', 'archive', 'delete'] } }, ['ids', 'operation']) }) }, async (request, reply) => mutate(request, reply, s => domain.bulkTasks(s, request.body.ids, request.body.operation)));
  app.post<{ Body: { ids: string[]; stage: string; listId?: string } }>(`${path}/tasks/reorder`, { schema: scoped('Tasks', 'Reorder complete active task set in one stage, optionally one list', undefined, { headers: schema.headers, body: schema.object({ ...orderBody.properties, stage: schema.stage, listId: schema.entityId }, ['ids', 'stage']) }) }, async (request, reply) => mutate(request, reply, s => {
    const matches = (t: State['tasks'][number]) => !t.deleted && !t.archived && t.stage === request.body.stage && (!request.body.listId || t.listId === request.body.listId) && s.lists.some(l => l.id === t.listId && !l.deleted && !l.archived);
    const ordered = domain.exactOrder(s.tasks.filter(matches), request.body.ids); let i = 0; s.tasks = s.tasks.map(t => matches(t) ? ordered[i++] : t); return { state: s, data: ordered };
  }));
  app.get<{ Params: Params }>(`${path}/tasks/:taskId`, { schema: scoped('Tasks', 'Read task with notes/subtasks', 'taskId') }, async (request, reply) => { const w = await read(request); return envelope(reply, w, domain.taskOf(w.state, request.params.taskId)); });
  app.patch<{ Params: Params; Body: Partial<domain.TaskInput> }>(`${path}/tasks/:taskId`, { schema: scoped('Tasks', 'Patch changed task fields; empty notes and null estimate clear values', 'taskId', { headers: schema.headers, body: patchBody(taskProperties) }) }, async (request, reply) => mutate(request, reply, s => domain.patchTask(s, request.params.taskId, request.body)));
  for (const action of ['complete', 'reopen', 'archive'] as const) app.post<{ Params: Params }>(`${path}/tasks/:taskId/${action}`, { schema: scoped('Tasks', `${action} task`, 'taskId', { headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => domain.taskAction(s, request.params.taskId, action)));
  app.post<{ Params: Params; Body?: { listId?: string } }>(`${path}/tasks/:taskId/restore`, { schema: scoped('Tasks', 'Restore task, optionally choose an active destination list', 'taskId', { headers: schema.headers, body: schema.object({ listId: schema.entityId }) }) }, async (request, reply) => mutate(request, reply, s => domain.taskAction(s, request.params.taskId, 'restore', request.body?.listId)));
  app.delete<{ Params: Params }>(`${path}/tasks/:taskId`, { schema: scoped('Tasks', 'Soft-delete task, preserving sessions', 'taskId', { headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => domain.taskAction(s, request.params.taskId, 'delete')));
  app.get<{ Params: Params }>(`${path}/tasks/:taskId/notes`, { schema: scoped('Tasks', 'Read task Markdown source', 'taskId') }, async (request, reply) => { const w = await read(request); return envelope(reply, w, { notes: domain.taskOf(w.state, request.params.taskId).notes }); });
  app.put<{ Params: Params; Body: { notes: string } }>(`${path}/tasks/:taskId/notes`, { schema: scoped('Tasks', 'Replace task notes; empty string clears', 'taskId', { headers: schema.headers, body: schema.object({ notes: schema.notes }, ['notes']) }) }, async (request, reply) => mutate(request, reply, s => { const task = domain.taskOf(s, request.params.taskId); task.notes = request.body.notes; return { state: s, data: { notes: task.notes } }; }));

  const subPath = `${path}/tasks/:taskId/subtasks`;
  app.get<{ Params: Params }>(subPath, { schema: scoped('Subtasks', 'Read ordered subtasks', 'taskId') }, async (request, reply) => { const w = await read(request); return envelope(reply, w, domain.taskOf(w.state, request.params.taskId).subtasks); });
  app.post<{ Params: Params; Body: { title: string; notes?: string; due?: string } }>(subPath, { schema: scoped('Subtasks', 'Create subtask with separate notes/due date', 'taskId', { headers: schema.headers, body: schema.object({ title: schema.title, notes: schema.notes, due: schema.due }, ['title']) }) }, async (request, reply) => { const result = await mutate(request, reply, s => ({ state: s, data: domain.createSubtask(s, request.params.taskId, request.body) })); return reply.code(201).send(result); });
  app.put<{ Params: Params; Body: { ids: string[] } }>(`${subPath}/order`, { schema: scoped('Subtasks', 'Reorder all subtasks', 'taskId', { headers: schema.headers, body: orderBody }) }, async (request, reply) => mutate(request, reply, s => { const task = domain.taskOf(s, request.params.taskId); task.subtasks = domain.exactOrder(task.subtasks, request.body.ids); return { state: s, data: task.subtasks }; }));
  app.patch<{ Params: Params; Body: Partial<Pick<Subtask, 'title' | 'notes' | 'due' | 'done'>> }>(`${subPath}/:subtaskId`, { schema: route('Subtasks', 'Patch subtask; blank rename keeps previous title, never auto-completes parent', { params: schema.params('taskId', true), headers: schema.headers, body: patchBody({ title: schema.title, notes: schema.notes, due: schema.due, done: schema.bool }) }) }, async (request, reply) => mutate(request, reply, s => ({ state: s, data: domain.patchSubtask(s, request.params.taskId, request.params.subtaskId, request.body) })));
  app.delete<{ Params: Params }>(`${subPath}/:subtaskId`, { schema: route('Subtasks', 'Delete one subtask', { params: schema.params('taskId', true), headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => { const task = domain.taskOf(s, request.params.taskId); domain.subtaskOf(task, request.params.subtaskId); task.subtasks = task.subtasks.filter(x => x.id !== request.params.subtaskId); return { state: s, data: { deletedId: request.params.subtaskId } }; }));

  app.get(`${path}/preferences`, { schema: scoped('Preferences', 'Read preferences') }, async (request, reply) => { const w = await read(request); return envelope(reply, w, w.state.prefs); });
  app.patch<{ Body: Partial<Preferences> }>(`${path}/preferences`, { schema: scoped('Preferences', 'Patch preferences; preserve unspecified fields', undefined, { headers: schema.headers, body: patchBody({ mode: { type: 'string', enum: ['dark', 'light', 'system'] }, brand: { type: 'string', enum: Object.keys(BRANDS) }, pomodoro: schema.bool, work: { type: 'integer', minimum: 1, maximum: 120 }, short: { type: 'integer', minimum: 1, maximum: 60 }, long: { type: 'integer', minimum: 1, maximum: 60 }, cycle: { type: 'integer', minimum: 1, maximum: 12 }, sound: schema.bool, showTime: schema.bool, fullTitle: schema.bool }) }) }, async (request, reply) => mutate(request, reply, s => ({ state: s, data: domain.patchPreferences(s, request.body) })));

  app.get<{ Querystring: Filters & PageQuery }>(`${path}/sessions`, { schema: scoped('Sessions', 'SQL pagination; optional keyset cursor avoids deep OFFSET; totals cover full filter', undefined, { querystring: schema.object({ ...schema.paging, ...schema.sessionFilters, cursor:{type:'string',maxLength:1024} }) }) }, async (request, reply) => {
    const result=await queries.sessions((request.params as Params).workspace,request.query);return envelope(reply,result.workspace,result.data);
  });
  app.get<{ Querystring: Filters }>(`${path}/sessions/export.csv`, { schema: scoped('Sessions', 'Stream all filtered CSV rows from one PostgreSQL snapshot in 500-row batches', undefined, { querystring: schema.object(schema.sessionFilters) }) }, async (request, reply) => { const {workspace,stream}=await queries.csv((request.params as Params).workspace,request.query);etag(reply,workspace);return reply.type('text/csv; charset=utf-8').header('Content-Disposition',`attachment; filename="daylight-${workspace.id}-sessions.csv"`).send(stream); });
  app.post<{ Body: domain.SessionInput }>(`${path}/sessions`, { schema: scoped('Sessions', 'Add a recorded work/break interval; this does not launch a live timer', undefined, { headers: schema.headers, body: schema.object({ taskId: schema.entityId, start: schema.timestamp, end: schema.timestamp, kind: { type: 'string', enum: ['work', 'break'] } }, ['taskId', 'start', 'end']) }) }, async (request, reply) => { const result = await mutate(request, reply, s => ({ state: s, data: domain.createSession(s, request.body) })); return reply.code(201).send(result); });
  app.get<{ Params: Params }>(`${path}/sessions/:sessionId`, { schema: scoped('Sessions', 'Read a recorded session', 'sessionId') }, async (request, reply) => { const result=await queries.session(request.params.workspace,request.params.sessionId);return envelope(reply,result.workspace,result.data); });
  app.patch<{ Params: Params; Body: { start?: number; end?: number } }>(`${path}/sessions/:sessionId`, { schema: scoped('Sessions', 'Edit interval; start-only edit preserves duration', 'sessionId', { headers: schema.headers, body: patchBody({ start: schema.timestamp, end: schema.timestamp }) }) }, async (request, reply) => mutate(request, reply, s => ({ state: s, data: domain.patchSession(s, request.params.sessionId, request.body) })));
  app.delete<{ Params: Params }>(`${path}/sessions/:sessionId`, { schema: scoped('Sessions', 'Delete a recorded session (new local API design)', 'sessionId', { headers: schema.headers }) }, async (request, reply) => mutate(request, reply, s => { if (!s.sessions.some(x => x.id === request.params.sessionId)) throw notFound('Session'); s.sessions = s.sessions.filter(x => x.id !== request.params.sessionId); return { state: s, data: { deletedId: request.params.sessionId } }; }));
  app.get<{ Querystring: Filters & { days?: '7' | '30' | '90' } }>(`${path}/reports/overview`, { schema: scoped('Reports', 'SQL aggregate reports with indexed time bounds', undefined, { querystring: schema.object({ days: { type: 'string', enum: ['7', '30', '90'] }, start: schema.dateQuery, end: schema.dateQuery, listId: schema.entityId }) }) }, async (request, reply) => { const result=await queries.overview((request.params as Params).workspace,request.query);return envelope(reply,result.workspace,result.data); });
  return app;
}
