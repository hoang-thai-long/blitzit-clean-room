import type { Session, State } from '../src/model';
import { checkDate } from './domain';
import { invalid } from './errors';
export type Filters = { start?: string; end?: string; listId?: string; kind?: 'work' | 'break' };
export function dayAt(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function validateRange(filters: Filters) {
  if (filters.start) checkDate(filters.start);
  if (filters.end) checkDate(filters.end);
  if (filters.start && filters.end && filters.start > filters.end) throw invalid('start must be on or before end');
}
export function sessionsMatching(sessions: Session[], filters: Filters, timeZone: string) {
  validateRange(filters);
  return sessions.filter(s => { const day = dayAt(s.start, timeZone); return (!filters.start || day >= filters.start) && (!filters.end || day <= filters.end) && (!filters.listId || s.listId === filters.listId) && (!filters.kind || s.kind === filters.kind); }).sort((a, b) => b.start - a.start || a.id.localeCompare(b.id));
}
export function report(s: State, filters: Filters & { days?: '7' | '30' | '90' }, timeZone: string) {
  if (!!filters.start !== !!filters.end) throw invalid('Custom reports need both start and end');
  const end = filters.end ?? dayAt(Date.now(), timeZone);
  const start = filters.start ?? new Date(Date.parse(`${end}T00:00:00Z`) - (Number(filters.days ?? 7) - 1) * 86_400_000).toISOString().slice(0, 10);
  validateRange({ start, end });
  const count = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (count > 366) throw invalid('Report range is limited to 366 calendar days');
  const rows = sessionsMatching(s.sessions, { start, end, listId: filters.listId }, timeZone), work = rows.filter(x => x.kind === 'work');
  const ms = (sessions: Session[]) => sessions.reduce((total, x) => total + x.end - x.start, 0);
  const focusMs = ms(work), breakMs = ms(rows.filter(x => x.kind === 'break'));
  const completed = s.tasks.filter(t => t.completedAt !== null && dayAt(t.completedAt, timeZone) >= start && dayAt(t.completedAt, timeZone) <= end && (!filters.listId || t.listId === filters.listId));
  const weekdayCounts = Array<number>(7).fill(0), weekdayMinutes = Array<number>(7).fill(0), startsByHour = Array<number>(24).fill(0);
  for (let n = 0; n < count; n++) weekdayCounts[new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).getUTCDay()]++;
  const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  for (const session of work) { weekdayMinutes[new Date(`${dayAt(session.start, timeZone)}T00:00:00Z`).getUTCDay()] += (session.end - session.start) / 60_000; startsByHour[Number(hourFormat.format(session.start))]++; }
  return {
    formula: 'daylight-local-v1', timeZone, range: { start, end, calendarDays: count }, listId: filters.listId ?? null,
    totals: { focusMs, breakMs, completedTasks: completed.length, activeDays: new Set(work.map(x => dayAt(x.start, timeZone))).size, workSessions: work.length, sessions: rows.length, averageFocusPerCompletedTaskMs: completed.length ? focusMs / completed.length : null },
    weekdays: weekdayCounts.map((days, weekday) => ({ weekday, calendarDays: days, averageMinutes: days ? weekdayMinutes[weekday] / days : 0 })),
    startsByHour: startsByHour.map((sessions, hour) => ({ hour, sessions })),
    timeByList: s.lists.filter(l => !filters.listId || l.id === filters.listId).map(l => ({ id: l.id, name: l.name, archived: l.archived, deleted: l.deleted, focusMs: ms(work.filter(x => x.listId === l.id)) })),
    unknowns: ['Original server aggregate formulas', 'Accuracy bucket classification', 'Activity heatmap semantics'],
  };
}
