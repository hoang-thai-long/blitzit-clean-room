import { restore, seed, type State } from './model';
import { desktopSnapshot } from './desktop-client';
export const STORAGE_KEY = 'daylight.local.v1';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function validate(data: State): boolean {
  return data?.version === 1 && Array.isArray(data.tasks) && Array.isArray(data.lists) && Array.isArray(data.sessions)
    && data.lists.every(l => typeof l.id === 'string' && typeof l.name === 'string' && typeof l.color === 'string' && typeof l.archived === 'boolean' && typeof l.deleted === 'boolean')
    && data.tasks.every(t => typeof t.id === 'string' && typeof t.listId === 'string' && typeof t.title === 'string' && typeof t.notes === 'string' && typeof t.due === 'string' && ['Backlog', 'This Week', 'Today', 'Done'].includes(t.stage) && typeof t.archived === 'boolean' && typeof t.deleted === 'boolean' && (t.estimate === null || (finite(t.estimate) && t.estimate > 0)) && (t.completedAt === null || finite(t.completedAt)) && Array.isArray(t.subtasks) && t.subtasks.every(sub => typeof sub.id === 'string' && typeof sub.title === 'string' && typeof sub.notes === 'string' && typeof sub.due === 'string' && typeof sub.done === 'boolean'))
    && data.sessions.every(s => typeof s.id === 'string' && typeof s.title === 'string' && typeof s.listId === 'string' && typeof s.taskId === 'string' && ['work', 'break'].includes(s.kind) && finite(s.start) && finite(s.end) && s.end > s.start)
    && !!data.timer && ['running', 'paused', 'idle'].includes(data.timer.status) && ['work', 'short', 'long'].includes(data.timer.phase)
    && [data.timer.elapsed, data.timer.sprint, data.timer.rounds, data.timer.segmentStart, data.timer.segmentMs, data.timer.lastAt].every(n => finite(n) && n >= 0)
    && (data.timer.taskId === null || data.tasks.some(t => t.id === data.timer.taskId && !t.deleted && !t.archived && t.stage !== 'Done'))
    && !!data.prefs && [data.prefs.work, data.prefs.short, data.prefs.long, data.prefs.cycle].every(n => finite(n) && n > 0)
    && data.prefs.work <= 120 && data.prefs.short <= 60 && data.prefs.long <= 60 && Number.isInteger(data.prefs.cycle) && data.prefs.cycle <= 12
    && [data.prefs.pomodoro, data.prefs.sound, data.prefs.showTime, data.prefs.fullTitle].every(v => typeof v === 'boolean');
}
export function load(): { state: State; error: string | null } {
  const desktop = desktopSnapshot();
  if (desktop) return { state: desktop.state, error: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: seed(), error: null };
    const data = JSON.parse(raw);
    if (!validate(data)) throw new Error('Invalid local data');
    return { state: restore(data), error: null };
  } catch { return { state: seed(), error: 'Không thể đọc dữ liệu local. Dữ liệu cũ được giữ nguyên; đang dùng bản mẫu trong bộ nhớ. Tải lại sau khi khắc phục storage.' }; }
}
export function save(state: State) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
