import type { ClientBase, QueryResultRow } from 'pg';
import { DEFAULTS, idleTimer, type State, type Task, type Session, type List, type Subtask, type Preferences, type Timer } from '../src/model';

export type Scope = { taskIds?: string[]; taskListId?: string; taskStage?: string; sessionIds?: string[]; allLists?:boolean; listIds?:string[]; fallbackList?:boolean };
type Row = QueryResultRow;
export const toList = (r: Row): List => ({ id:r.id, name:r.name, color:r.color, archived:r.archived, deleted:r.deleted });
export const toSubtask = (r: Row): Subtask => ({ id:r.id,title:r.title,done:r.done,notes:r.notes,due:r.due });
export const toTask = (r: Row): Task => ({ id:r.id,listId:r.list_id,title:r.title,stage:r.stage,notes:r.notes,estimate:r.estimate,due:r.due,completedAt:r.completed_at_ms === null ? null : Number(r.completed_at_ms),archived:r.archived,deleted:r.deleted,subtasks:[] });
export const toSession = (r: Row): Session => ({ id:r.id,taskId:r.task_id,listId:r.list_id,title:r.title,start:Number(r.start_ms),end:Number(r.end_ms),kind:r.kind });
export const toPrefs = (r: Row): Preferences => ({ mode:r.mode,brand:r.brand,pomodoro:r.pomodoro,work:r.work,short:r.short,long:r.long,cycle:r.cycle,sound:r.sound,showTime:r.show_time,fullTitle:r.full_title });
export const toTimer = (r: Row): Timer => ({ taskId:r.task_id,status:r.status,phase:r.phase,elapsed:Number(r.elapsed),sprint:Number(r.sprint),rounds:r.rounds,lastAt:Number(r.last_at),segmentStart:Number(r.segment_start),segmentMs:Number(r.segment_ms),preview:r.preview });

// scope omitted = explicit full bootstrap/export. Mutation scopes never read
// unrelated task bodies or historical sessions.
export async function loadState(client: ClientBase, id: string, scope?: Scope): Promise<State> {
  const prefs = (await client.query('SELECT * FROM daylight_preferences WHERE workspace_id=$1',[id])).rows[0];
  const timer = (await client.query('SELECT * FROM daylight_timers WHERE workspace_id=$1',[id])).rows[0];
  const s: State = { version:1,lists:[],tasks:[],sessions:[],prefs:prefs ? toPrefs(prefs) : {...DEFAULTS},timer:timer ? toTimer(timer) : idleTimer() };
  const values: unknown[] = [id]; let condition = '';
  if (scope) {
    values.push([...new Set([...(scope.taskIds ?? []), ...(s.timer.taskId ? [s.timer.taskId] : [])])]);
    const parts = ['id=ANY($2::text[])'];
    if (scope.taskListId && !scope.taskStage) { values.push(scope.taskListId); parts.push(`list_id=$${values.length}`); }
    if (scope.taskStage) { values.push(scope.taskStage); let p = `stage=$${values.length}`; if (scope.taskListId) { values.push(scope.taskListId); p += ` AND list_id=$${values.length}`; } parts.push(`(${p})`); }
    condition = ` AND (${parts.join(' OR ')})`;
  }
  s.tasks = (await client.query(`SELECT * FROM daylight_tasks WHERE workspace_id=$1${condition} ORDER BY position,id`,values)).rows.map(toTask);
  if(!scope || scope.allLists) s.lists=(await client.query('SELECT * FROM daylight_lists WHERE workspace_id=$1 ORDER BY position,id',[id])).rows.map(toList);
  else {
    const ids=[...new Set([...(scope.listIds??[]),...s.tasks.map(t=>t.listId)])];
    s.lists=(await client.query(`SELECT * FROM daylight_lists WHERE workspace_id=$1 AND (id=ANY($2::text[])${scope.fallbackList?' OR id=(SELECT id FROM daylight_lists WHERE workspace_id=$1 AND NOT deleted AND NOT archived ORDER BY position,id LIMIT 1)':''}) ORDER BY position,id`,[id,ids])).rows.map(toList);
  }
  if (s.tasks.length) {
    const map = new Map(s.tasks.map(t => [t.id,t]));
    const subs = await client.query('SELECT * FROM daylight_subtasks WHERE workspace_id=$1 AND task_id=ANY($2::text[]) ORDER BY position,id',[id,[...map.keys()]]);
    for (const row of subs.rows) map.get(row.task_id)!.subtasks.push(toSubtask(row));
  }
  if (!scope || scope.sessionIds?.length) s.sessions = (await client.query(`SELECT * FROM daylight_sessions WHERE workspace_id=$1${scope ? ' AND id=ANY($2::text[])' : ''} ORDER BY position,id`,scope ? [id,scope.sessionIds] : [id])).rows.map(toSession);
  return s;
}

type Values = Record<string, unknown>;
type Def = { table: string; keys: string[]; group?: string; ordered?: boolean };
const same = (a: unknown,b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const keyOf = (row: Values, keys: string[]) => keys.map(k => row[k]).join('\0');
async function writeRows(client: ClientBase, workspace: string, def: Def, before: Values[], after: Values[]) {
  const previous = new Map(before.map(r => [keyOf(r,def.keys),r]));
  const next = new Map(after.map(r => [keyOf(r,def.keys),r]));
  const removed = before.filter(r => !next.has(keyOf(r,def.keys)));
  for (let offset=0; offset<removed.length; offset+=300) {
    const batch = removed.slice(offset,offset+300), values: unknown[] = [workspace];
    const clauses = batch.map(row => '('+def.keys.map(k => { values.push(row[k]); return `${k}=$${values.length}`; }).join(' AND ')+')');
    await client.query(`DELETE FROM ${def.table} WHERE workspace_id=$1 AND (${clauses.join(' OR ')})`,values);
  }
  const positions = new Map<string, number>();
  if (def.ordered) {
    const groups = [...new Set(after.map(r => def.group ? String(r[def.group]) : ''))];
    for (const group of groups) {
      const oldGroup = before.filter(r => !def.group || String(r[def.group]) === group);
      const newGroup = after.filter(r => !def.group || String(r[def.group]) === group);
      const oldKeys = oldGroup.filter(r => next.has(keyOf(r,def.keys))).map(r => keyOf(r,def.keys));
      const newKeys = newGroup.filter(r => previous.has(keyOf(r,def.keys))).map(r => keyOf(r,def.keys));
      const reorders = !same(oldKeys,newKeys), adds = newGroup.filter(r => !previous.has(keyOf(r,def.keys)));
      if (reorders) {
        const rows = await client.query(`SELECT ${def.keys.join(',')},position FROM ${def.table} WHERE workspace_id=$1${def.group ? ` AND ${def.group}=$2` : ''} AND id=ANY($${def.group ? 3 : 2}::text[]) ORDER BY position,id`,def.group ? [workspace,group,newGroup.map(r=>r.id)] : [workspace,newGroup.map(r=>r.id)]);
        const slots = rows.rows.map(r=>Number(r.position)); newKeys.forEach((key,i)=>positions.set(key,slots[i]));
      }
      if (adds.length) {
        const max = await client.query(`SELECT position FROM ${def.table} WHERE workspace_id=$1${def.group ? ` AND ${def.group}=$2` : ''} ORDER BY position DESC LIMIT 1`,def.group ? [workspace,group] : [workspace]);
        const start = max.rowCount ? Number(max.rows[0].position)+1 : 0;
        adds.forEach((row,i)=>positions.set(keyOf(row,def.keys),start+i));
      }
    }
  }
  // Group identical column sets, batch inserts/updates. An edit to title does
  // not bind/rewrite notes; an elapsed tick never writes session rows.
  const groups = new Map<string,{ columns:string[]; rows:Values[]; insert:boolean }>();
  for (const row of after) {
    const key=keyOf(row,def.keys), old=previous.get(key);
    const current:Values={...row,...(positions.has(key)?{position:positions.get(key)}:{})};
    const changed=Object.keys(current).filter(k=>!def.keys.includes(k) && (!old || !same(current[k],old[k])));
    if (old && !changed.length) continue;
    const columns=old ? [...def.keys,...changed] : Object.keys(current);
    const groupKey=(old?'update:':'insert:')+columns.join(',');
    if (!groups.has(groupKey)) groups.set(groupKey,{columns,rows:[],insert:!old});
    groups.get(groupKey)!.rows.push(current);
  }
  for (const {columns,rows,insert} of groups.values()) for (let offset=0;offset<rows.length;offset+=300) {
    const batch=rows.slice(offset,offset+300);
    // jsonb_populate_recordset supplies PostgreSQL's actual column types while
    // sending only changed columns; payloads are bounded to a batch, not a workspace.
    const payload=JSON.stringify(batch.map(row=>Object.fromEntries(columns.map(k=>[k,row[k]]))));
    if (insert) await client.query(`INSERT INTO ${def.table}(workspace_id,${columns.join(',')}) SELECT $1,${columns.join(',')} FROM jsonb_populate_recordset(NULL::${def.table},$2::jsonb)`,[workspace,payload]);
    else await client.query(`UPDATE ${def.table} t SET ${columns.filter(k=>!def.keys.includes(k)).map(k=>`${k}=v.${k}`).join(',')} FROM jsonb_populate_recordset(NULL::${def.table},$2::jsonb) v WHERE t.workspace_id=$1${def.keys.length ? ' AND '+def.keys.map(k=>`t.${k}=v.${k}`).join(' AND ') : ''}`,[workspace,payload]);
  }
}
const listRows=(s:State)=>s.lists.map(l=>({id:l.id,name:l.name,color:l.color,archived:l.archived,deleted:l.deleted}));
const taskRows=(s:State)=>s.tasks.map(t=>({id:t.id,list_id:t.listId,title:t.title,stage:t.stage,notes:t.notes,estimate:t.estimate,due:t.due,completed_at_ms:t.completedAt,archived:t.archived,deleted:t.deleted}));
const subRows=(s:State)=>s.tasks.flatMap(t=>t.subtasks.map(x=>({task_id:t.id,id:x.id,title:x.title,done:x.done,notes:x.notes,due:x.due})));
const sessionRows=(s:State)=>s.sessions.map(x=>({id:x.id,task_id:x.taskId,list_id:x.listId,title:x.title,start_ms:x.start,end_ms:x.end,kind:x.kind}));
const prefRow=(p:Preferences)=>({mode:p.mode,brand:p.brand,pomodoro:p.pomodoro,work:p.work,short:p.short,long:p.long,cycle:p.cycle,sound:p.sound,show_time:p.showTime,full_title:p.fullTitle});
const timerRow=(t:Timer)=>({task_id:t.taskId,status:t.status,phase:t.phase,elapsed:t.elapsed,sprint:t.sprint,rounds:t.rounds,last_at:t.lastAt,segment_start:t.segmentStart,segment_ms:t.segmentMs,preview:t.preview});
export async function writeDiff(client:ClientBase,id:string,before:State|null,after:State) {
  if (!before || before.lists!==after.lists) await writeRows(client,id,{table:'daylight_lists',keys:['id'],ordered:true},before?listRows(before):[],listRows(after));
  if (!before || before.tasks!==after.tasks) {
    await writeRows(client,id,{table:'daylight_tasks',keys:['id'],ordered:true},before?taskRows(before):[],taskRows(after));
    await writeRows(client,id,{table:'daylight_subtasks',keys:['task_id','id'],ordered:true,group:'task_id'},before?subRows(before):[],subRows(after));
  }
  if (!before || before.sessions!==after.sessions) await writeRows(client,id,{table:'daylight_sessions',keys:['id'],ordered:true},before?sessionRows(before):[],sessionRows(after));
  if (!before || before.prefs!==after.prefs) await writeRows(client,id,{table:'daylight_preferences',keys:[]},before?[prefRow(before.prefs)]:[],[prefRow(after.prefs)]);
  if (!before || before.timer!==after.timer) await writeRows(client,id,{table:'daylight_timers',keys:[]},before?[timerRow(before.timer)]:[],[timerRow(after.timer)]);
}
export async function saveState(client:ClientBase,id:string,baseRevision:number|null,before:State|null,state:State):Promise<number|null> {
  await client.query('BEGIN');
  try {
    const changed=baseRevision===null
      ? await client.query('INSERT INTO daylight_workspace_meta(id,revision) VALUES($1,1) ON CONFLICT DO NOTHING RETURNING revision',[id])
      : await client.query('UPDATE daylight_workspace_meta SET revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING revision',[id,baseRevision]);
    if (!changed.rowCount) { await client.query('ROLLBACK'); return null; }
    await writeDiff(client,id,before,state); await client.query('COMMIT'); return Number(changed.rows[0].revision);
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
}
