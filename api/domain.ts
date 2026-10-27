import { BRANDS, bulk, moveTask, newTask, renameSubtask, timerAction, uid, type List, type Preferences, type Session, type Stage, type State, type Subtask, type Task } from '../src/model';
import { invalid, notFound } from './errors';

export const named = (title: string) => { if (!title.trim()) throw invalid('Title must not be blank'); return title.trim(); };
export function checkDate(value: string): string {
  if (value === '') return value;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!match || (match[2] && (Number(match[2]) > 23 || Number(match[3]) > 59))) throw invalid('Use YYYY-MM-DD or YYYY-MM-DDTHH:mm for dates');
  const d = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== match[1]) throw invalid('Invalid calendar date');
  return value;
}
export function listOf(s: State, id: string, active = false): List {
  const list = s.lists.find(l => l.id === id && !l.deleted);
  if (!list) throw notFound('List');
  if (active && list.archived) throw invalid('Choose a non-archived list');
  return list;
}
export function taskOf(s: State, id: string): Task { const task = s.tasks.find(t => t.id === id && !t.deleted); if (!task) throw notFound('Task'); return task; }
export function exactOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  if (new Set(ids).size !== ids.length || items.length !== ids.length || ids.some(id => !items.some(item => item.id === id))) throw invalid('Order must contain each existing ID exactly once');
  const index = new Map(items.map(item => [item.id, item])); return ids.map(id => index.get(id)!);
}
export function createList(s: State, input: { name: string; color?: string }) {
  const list: List = { id: uid(), name: named(input.name), color: input.color ?? '#a5edb5', archived: false, deleted: false };
  s.lists.push(list); return list;
}
export function listAction(s: State, id: string, action: 'archive' | 'restore' | 'delete' | 'duplicate') {
  const list = listOf(s, id);
  if (action === 'duplicate') { const copy = { ...list, id: uid(), name: `${list.name} Copy`, archived: false }; s.lists.push(copy); return { state: s, data: copy }; }
  if (action === 'delete') {
    if (s.tasks.some(t => t.id === s.timer.taskId && t.listId === id)) s = timerAction(s, { type: 'stop' });
    s.lists = s.lists.map(l => l.id === id ? { ...l, deleted: true } : l);
    s.tasks = s.tasks.map(t => t.listId === id ? { ...t, archived: true } : t);
  } else list.archived = action === 'archive';
  return { state: s, data: s.lists.find(l => l.id === id)! };
}
export type TaskInput = { title: string; listId: string; stage?: Stage; notes?: string; estimate?: number | null; due?: string };
export function createTask(s: State, input: TaskInput) {
  listOf(s, input.listId, true);
  const task = newTask(named(input.title), input.listId, input.stage);
  if (!task) throw invalid('Title must not be blank');
  if (input.notes !== undefined) task.notes = input.notes;
  if (input.estimate !== undefined) task.estimate = input.estimate;
  if (input.due !== undefined) task.due = checkDate(input.due);
  s.tasks.push(task); return task;
}
export function patchTask(s: State, id: string, patch: Partial<TaskInput>) {
  let task = taskOf(s, id);
  if (patch.listId !== undefined) listOf(s, patch.listId, true);
  if (patch.stage === 'Done' && s.timer.taskId === id) s = timerAction(s, { type: 'stop' });
  task = taskOf(s, id);
  let next = { ...task, ...patch, ...(patch.title !== undefined ? { title: named(patch.title) } : {}), ...(patch.due !== undefined ? { due: checkDate(patch.due) } : {}) };
  if (patch.stage !== undefined) next = moveTask(next, patch.stage);
  s.tasks = s.tasks.map(t => t.id === id ? next : t);
  return { state: s, data: next };
}
export function taskAction(s: State, id: string, action: 'complete' | 'reopen' | 'archive' | 'restore' | 'delete', destination?: string) {
  const task = taskOf(s, id);
  if (action === 'complete' || action === 'reopen') return patchTask(s, id, { stage: action === 'complete' ? 'Done' : 'Today' });
  if (s.timer.taskId === id && (action === 'archive' || action === 'delete')) s = timerAction(s, { type: 'stop' });
  let listId = task.listId;
  if (action === 'restore') {
    listId = destination ?? s.lists.find(l => l.id === task.listId && !l.deleted && !l.archived)?.id ?? s.lists.find(l => !l.deleted && !l.archived)?.id ?? '';
    if (!listId) throw invalid('Create an active list before restoring this task');
    listOf(s, listId, true);
  }
  const next = { ...task, listId, archived: action === 'archive' ? true : action === 'restore' ? false : task.archived, deleted: action === 'delete' };
  s.tasks = s.tasks.map(t => t.id === id ? next : t); return { state: s, data: next };
}
export function bulkTasks(s: State, ids: string[], operation: 'done' | 'archive' | 'delete') {
  if (ids.includes(s.timer.taskId ?? '')) s = timerAction(s, { type: 'stop' });
  const result = bulk(s, ids, operation); return { state: result.state, data: result.results };
}
export function subtaskOf(task: Task, id: string): Subtask { const sub = task.subtasks.find(s => s.id === id); if (!sub) throw notFound('Subtask'); return sub; }
export function createSubtask(s: State, taskId: string, input: { title: string; notes?: string; due?: string }) {
  const task = taskOf(s, taskId);
  const sub: Subtask = { id: uid(), title: named(input.title), done: false, notes: input.notes ?? '', due: checkDate(input.due ?? '') };
  task.subtasks.push(sub); return sub;
}
export function patchSubtask(s: State, taskId: string, id: string, patch: Partial<Pick<Subtask, 'title' | 'notes' | 'due' | 'done'>>) {
  const task = taskOf(s, taskId), sub = subtaskOf(task, id);
  const next = { ...sub, ...patch, title: patch.title !== undefined ? renameSubtask(sub, patch.title).title : sub.title, due: patch.due !== undefined ? checkDate(patch.due) : sub.due };
  task.subtasks = task.subtasks.map(x => x.id === id ? next : x); return next;
}
export function patchPreferences(s: State, patch: Partial<Preferences>) {
  if (patch.brand !== undefined && !BRANDS[patch.brand]) throw invalid('Unknown brand');
  s.prefs = { ...s.prefs, ...patch }; return s.prefs;
}
export type SessionInput = { taskId: string; start: number; end: number; kind?: Session['kind'] };
export function createSession(s: State, input: SessionInput) {
  const task = taskOf(s, input.taskId);
  if (input.end <= input.start) throw invalid('Session end must be after start');
  const session: Session = { id: uid(), taskId: task.id, listId: task.listId, title: task.title, start: input.start, end: input.end, kind: input.kind ?? 'work' };
  s.sessions.push(session); return session;
}
export function patchSession(s: State, id: string, patch: { start?: number; end?: number }) {
  const session = s.sessions.find(x => x.id === id); if (!session) throw notFound('Session');
  const start = patch.start ?? session.start;
  const end = patch.end ?? (patch.start === undefined ? session.end : start + session.end - session.start);
  if (!Number.isSafeInteger(end) || end > 8640000000000000 || end <= start) throw invalid('Session end must be after start and a valid timestamp');
  const next = { ...session, start, end }; s.sessions = s.sessions.map(x => x.id === id ? next : x); return next;
}
