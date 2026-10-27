export type Stage = 'Backlog' | 'This Week' | 'Today' | 'Done';
export const STAGES: Stage[] = ['Backlog', 'This Week', 'Today', 'Done'];
export type Subtask = { id: string; title: string; done: boolean; notes: string; due: string };
export type Task = { id: string; listId: string; title: string; stage: Stage; notes: string; estimate: number | null; subtasks: Subtask[]; completedAt: number | null; archived: boolean; deleted: boolean; due: string };
export type List = { id: string; name: string; color: string; archived: boolean; deleted: boolean };
export type Session = { id: string; taskId: string; listId: string; title: string; start: number; end: number; kind: 'work' | 'break' };
export type Preferences = { mode: 'dark' | 'light' | 'system'; brand: string; pomodoro: boolean; work: number; short: number; long: number; cycle: number; sound: boolean; showTime: boolean; fullTitle: boolean };
export const BRANDS: Record<string, string> = { 'Blitz Green': '#a5edb5', 'Atomic Flame': '#ffab7a', 'Electric Lime': '#d8ed81', 'Cosmic Indigo': '#b6adff', 'Cherry Blossom Pink': '#f5b4d0' };
export const DEFAULTS: Preferences = { mode: 'dark', brand: 'Blitz Green', pomodoro: true, work: 25, short: 5, long: 15, cycle: 4, sound: true, showTime: true, fullTitle: true };
export type Timer = { taskId: string | null; status: 'idle' | 'running' | 'paused'; phase: 'work' | 'short' | 'long'; elapsed: number; sprint: number; rounds: number; lastAt: number; segmentStart: number; segmentMs: number; preview: { taskId: string; wasRunning: boolean } | null };
export type State = { version: 1; tasks: Task[]; lists: List[]; sessions: Session[]; prefs: Preferences; timer: Timer };
export const uid = () => crypto.randomUUID();
export const idleTimer = (): Timer => ({ taskId: null, status: 'idle', phase: 'work', elapsed: 0, sprint: 0, rounds: 0, lastAt: 0, segmentStart: 0, segmentMs: 0, preview: null });
export function newTask(title: string, listId: string, stage: Stage = 'Today'): Task | null {
  if (!title.trim()) return null;
  return { id: uid(), listId, title: title.trim(), stage, notes: '', estimate: null, subtasks: [], completedAt: stage === 'Done' ? Date.now() : null, archived: false, deleted: false, due: '' };
}
export function moveTask(task: Task, stage: Stage, now = Date.now()): Task {
  return { ...task, stage, completedAt: stage === 'Done' ? task.completedAt ?? now : null };
}
export function renameSubtask(sub: Subtask, title: string): Subtask { return title.trim() ? { ...sub, title: title.trim() } : sub; }
export function reorder<T extends { id: string }>(items: T[], from: string, to: string | null): T[] {
  const a = items.findIndex(i => i.id === from), b = items.findIndex(i => i.id === to);
  if (a < 0 || b < 0 || a === b) return items;
  const next = [...items]; next.splice(b, 0, next.splice(a, 1)[0]); return next;
}
export function bulk(state: State, ids: string[], operation: 'done' | 'archive' | 'delete') {
  const results: { id: string; status: 'success' | 'skipped' | 'error' }[] = [];
  let tasks = [...state.tasks];
  for (const id of new Set(ids)) {
    const task = tasks.find(t => t.id === id);
    if (!task) { results.push({ id, status: 'error' }); continue; }
    if (task.deleted || (operation === 'done' && task.stage === 'Done') || (operation === 'archive' && task.archived)) { results.push({ id, status: 'skipped' }); continue; }
    tasks = tasks.map(t => t.id !== id ? t : operation === 'done' ? moveTask(t, 'Done') : { ...t, [operation === 'archive' ? 'archived' : 'deleted']: true });
    results.push({ id, status: 'success' });
  }
  return { state: { ...state, tasks }, results };
}
export function validMinutes(value: number, max = 60) { return Number.isFinite(value) && value > 0 && value <= max ? Math.max(1, Math.round(value)) : null; }
function record(state: State, now: number): State {
  const t = state.timer, task = state.tasks.find(x => x.id === t.taskId);
  if (!task || t.segmentMs < 1000) return { ...state, timer: { ...t, segmentStart: now, segmentMs: 0 } };
  const session: Session = { id: uid(), taskId: task.id, listId: task.listId, title: task.title, start: t.segmentStart, end: t.segmentStart + t.segmentMs, kind: t.phase === 'work' ? 'work' : 'break' };
  return { ...state, sessions: [...state.sessions, session], timer: { ...t, segmentStart: now, segmentMs: 0 } };
}
export function tick(state: State, now: number): State {
  const t = state.timer;
  if (t.status !== 'running') return state;
  const delta = Math.max(0, now - t.lastAt);
  if (delta > 60_000) return { ...state, timer: { ...t, status: 'paused', lastAt: now } };
  let next: State = { ...state, timer: { ...t, elapsed: t.elapsed + delta, sprint: t.sprint + (t.phase === 'work' ? delta : 0), segmentMs: t.segmentMs + delta, lastAt: now } };
  if (state.prefs.pomodoro && t.phase === 'work' && next.timer.sprint >= state.prefs.work * 60_000) {
    next = record(next, now);
    const rounds = t.rounds + 1;
    next.timer = { ...next.timer, phase: rounds % state.prefs.cycle === 0 ? 'long' : 'short', rounds, elapsed: 0, sprint: 0, preview: null };
  } else if (t.phase !== 'work' && next.timer.elapsed >= state.prefs[t.phase] * 60_000) {
    next = record(next, now);
    next.timer = { ...next.timer, phase: 'work', status: 'paused', elapsed: 0, sprint: 0 };
  }
  return next;
}
export type TimerAction = { type: 'launch'; taskId: string } | { type: 'pause' | 'stop' | 'preview' | 'confirm' | 'break' | 'skipBreak' } | { type: 'cancel'; taskId: string };
export function timerAction(state: State, action: TimerAction, now = Date.now()): State {
  let next = tick(state, now), t = next.timer;
  if (action.type === 'launch') {
    const task = next.tasks.find(x => x.id === action.taskId && !x.deleted && !x.archived && x.stage !== 'Done');
    if (!task) return next;
    if (t.taskId === task.id) return { ...next, timer: { ...t, status: t.preview ? t.status : 'running', lastAt: now } };
    next = record(next, now);
    return { ...next, timer: { ...idleTimer(), taskId: task.id, status: 'running', sprint: t.phase === 'work' ? t.sprint : 0, rounds: t.rounds, lastAt: now, segmentStart: now } };
  }
  if (!t.taskId) return next;
  if (action.type === 'pause' && !t.preview) return { ...next, timer: { ...t, status: t.status === 'running' ? 'paused' : 'running', lastAt: now } };
  if (action.type === 'stop') return { ...record(next, now), timer: idleTimer() };
  if (action.type === 'preview' && t.phase === 'work' && !t.preview) return { ...next, timer: { ...t, status: 'paused', preview: { taskId: t.taskId, wasRunning: t.status === 'running' } } };
  if (action.type === 'cancel' && t.preview?.taskId === action.taskId && t.taskId === action.taskId) return { ...next, timer: { ...t, status: t.preview.wasRunning ? 'running' : 'paused', lastAt: now, preview: null } };
  if (action.type === 'confirm' && t.preview?.taskId === t.taskId) return { ...record(next, now), tasks: next.tasks.map(x => x.id === t.taskId ? moveTask(x, 'Done', now) : x), timer: idleTimer() };
  if (action.type === 'break' && t.phase === 'work' && !t.preview) { next = record(next, now); return { ...next, timer: { ...next.timer, phase: 'short', elapsed: 0, lastAt: now, status: 'running' } }; }
  if (action.type === 'skipBreak' && t.phase !== 'work') { next = record(next, now); return { ...next, timer: { ...next.timer, phase: 'work', elapsed: 0, status: 'paused', lastAt: now } }; }
  return next;
}
export function restore(state: State): State {
  return { ...state, prefs: { ...DEFAULTS, ...state.prefs, mode: ['dark', 'light', 'system'].includes(state.prefs.mode) ? state.prefs.mode : 'dark', brand: BRANDS[state.prefs.brand] ? state.prefs.brand : 'Blitz Green' }, timer: { ...state.timer, status: state.timer.taskId ? 'paused' : 'idle', preview: null } };
}
export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function quickDate(kind: 'tomorrow' | 'nextWeek' | 'later', now = new Date()): string {
  const date = new Date(now);
  if (kind === 'later') { date.setTime(Math.round((date.getTime() + 3600_000) / 1800_000) * 1800_000); return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
  date.setDate(date.getDate() + (kind === 'tomorrow' ? 1 : (8 - date.getDay()) % 7 || 7)); return localDate(date);
}
export function rangeDates(days: number, now = new Date()) { const end = localDate(now); const start = new Date(now); start.setDate(start.getDate() - days + 1); return { start: localDate(start), end }; }
export function filterSessions(sessions: Session[], start: string, end: string, listId: string) { return sessions.filter(s => { const day = localDate(new Date(s.start)); return day >= start && day <= end && (!listId || s.listId === listId); }).sort((a, b) => b.start - a.start); }
export function weekdayAverage(sessions: Session[], start: string, end: string) {
  const counts = Array(7).fill(0) as number[], sums = Array(7).fill(0) as number[];
  for (let d = new Date(`${start}T12:00:00`); localDate(d) <= end; d.setDate(d.getDate() + 1)) counts[d.getDay()]++;
  for (const s of sessions.filter(s => s.kind === 'work')) sums[new Date(s.start).getDay()] += (s.end - s.start) / 60_000;
  return sums.map((sum, i) => counts[i] ? sum / counts[i] : 0);
}
export function csvCell(value: string) { const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
export function exportCsv(sessions: Session[], lists: List[]) { return '\uFEFF' + ['Task,List,Kind,Start,End,Minutes', ...sessions.map(s => [s.title, lists.find(l => l.id === s.listId)?.name ?? 'Deleted list', s.kind, new Date(s.start).toISOString(), new Date(s.end).toISOString(), String((s.end - s.start) / 60_000)].map(csvCell).join(','))].join('\r\n'); }
export function seed(): State {
  const lists: List[] = [{ id: 'studio', name: 'Creative studio', color: '#a5edb5', archived: false, deleted: false }, { id: 'personal', name: 'Personal growth', color: '#b6adff', archived: false, deleted: false }, { id: 'life', name: 'Everyday life', color: '#f2c88b', archived: false, deleted: false }];
  const make = (title: string, listId: string, stage: Stage, estimate: number, notes = '') => ({ ...newTask(title, listId, stage)!, estimate, notes });
  const tasks = [
    make('Explore ideas for the next chapter', 'studio', 'Backlog', 45, '## A little space to think\n\nCollect a few directions before committing.\n\n- What feels useful?\n- What can be simpler?'),
    make('Build a reading list', 'personal', 'Backlog', 15),
    make('Plan the portfolio refresh', 'studio', 'This Week', 60),
    make('Make time for a long walk', 'life', 'This Week', 30),
    make('Design the landing page', 'studio', 'Today', 50, '## Make it feel effortless\n\nStart with the **hero section**, then work through the story.\n\n> One clear idea at a time.'),
    make('Read a chapter, take a note', 'personal', 'Today', 25, 'Capture one idea worth coming back to.'),
    make('A fresh start for the workspace', 'life', 'Today', 15),
    make('Sketch the first direction', 'studio', 'Done', 30),
    make('Write down this week’s intentions', 'personal', 'Done', 10)
  ];
  tasks[4].subtasks = ['Outline the story', 'Explore two hero concepts', 'Review the mobile layout'].map((title, i) => ({ id: uid(), title, done: i === 0, notes: '', due: '' }));
  tasks[2].subtasks = ['Choose three projects', 'Collect project images'].map(title => ({ id: uid(), title, done: false, notes: '', due: '' }));
  const sessions: Session[] = [];
  for (let day = 6; day >= 0; day--) for (let n = 0; n < (day === 3 ? 0 : 3); n++) {
    const date = new Date(); date.setDate(date.getDate() - day); date.setHours(9 + n * 2, 0, 0, 0);
    const task = tasks[(day + n) % tasks.length];
    sessions.push({ id: uid(), taskId: task.id, listId: task.listId, title: task.title, start: date.getTime(), end: date.getTime() + (20 + ((day + n) % 4) * 10) * 60_000, kind: 'work' });
    sessions.push({ id: uid(), taskId: task.id, listId: task.listId, title: 'Short break', start: date.getTime() + 3600_000, end: date.getTime() + 3900_000, kind: 'break' });
  }
  return { version: 1, tasks, lists, sessions, prefs: { ...DEFAULTS }, timer: idleTimer() };
}
