import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { csvCell } from '../src/model';
import { toList, toTask, toSubtask, toSession } from '../database/store';
import { Database } from './database';
import { invalid, notFound } from './errors';
import { dayAt, validateRange, type Filters } from './reports';

type Page = { limit?:string;offset?:string;cursor?:string;totals?:string };
export async function sessionWhere(client:PoolClient,id:string,filters:Filters,timeZone:string) {
  validateRange(filters);
  const args:unknown[]=[id]; const parts=['s.workspace_id=$1'];
  if(filters.start || filters.end) {
    const range=await client.query(`SELECT (extract(epoch from($1::date::timestamp AT TIME ZONE $3))*1000)::bigint AS start,
      (extract(epoch from(($2::date+1)::timestamp AT TIME ZONE $3))*1000)::bigint AS end`,[filters.start??null,filters.end??null,timeZone]);
    if(filters.start){args.push(range.rows[0].start);parts.push(`s.start_ms >= $${args.length}`);}
    if(filters.end){args.push(range.rows[0].end);parts.push(`s.start_ms < $${args.length}`);}
  }
  if(filters.listId){args.push(filters.listId);parts.push(`s.list_id=$${args.length}`);}
  if(filters.kind){args.push(filters.kind);parts.push(`s.kind=$${args.length}`);}
  return {sql:parts.join(' AND '),args};
}
export class Queries {
  constructor(private database:Database,private timeZone:string){}
  async tasks(id:string,q:Page & {listId?:string;stage?:string;archived?:string;q?:string}) {
    return this.database.readTransaction(id,async(client,workspace)=>{
      const args:unknown[]=[id], archived=q.archived==='true';
      const parts=['t.workspace_id=$1','NOT t.deleted',archived?'t.archived':'NOT t.archived'];
      if(!archived) parts.push('EXISTS(SELECT 1 FROM daylight_lists l WHERE l.workspace_id=t.workspace_id AND l.id=t.list_id AND NOT l.deleted AND NOT l.archived)');
      if(q.stage){args.push(q.stage);parts.push(`t.stage=$${args.length}`);}
      if(q.listId){args.push(q.listId);parts.push(`t.list_id=$${args.length}`);}
      if(q.q){args.push('%'+q.q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%');parts.push(`lower(t.title || ' ' || t.notes) LIKE $${args.length}`);}
      const where=parts.join(' AND '), limit=Number(q.limit??50),offset=Number(q.offset??0);
      const count=Number((await client.query(`SELECT count(*) FROM daylight_tasks t WHERE ${where}`,args)).rows[0].count);
      const rows=await client.query(`SELECT t.* FROM daylight_tasks t WHERE ${where} ORDER BY t.position,t.id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset]);
      const items=rows.rows.map(toTask), map=new Map(items.map(t=>[t.id,t]));
      if(items.length){const subs=await client.query('SELECT * FROM daylight_subtasks WHERE workspace_id=$1 AND task_id=ANY($2::text[]) ORDER BY position,id',[id,items.map(t=>t.id)]);for(const row of subs.rows)map.get(row.task_id)!.subtasks.push(toSubtask(row));}
      return {workspace,data:{items,total:count,limit,offset,nextOffset:offset+limit<count?offset+limit:null}};
    });
  }
  async session(id:string,sessionId:string) {return this.database.readTransaction(id,async(client,workspace)=>{
    const result=await client.query('SELECT * FROM daylight_sessions WHERE workspace_id=$1 AND id=$2',[id,sessionId]);
    if(!result.rowCount)throw notFound('Session');return {workspace,data:toSession(result.rows[0])};
  });}
  async sessions(id:string,q:Page & Filters) {
    return this.database.readTransaction(id,async(client,workspace)=>{
      const {sql,args}=await sessionWhere(client,id,q,this.timeZone);
      const summary=q.totals==='false'?null:(await client.query(`SELECT count(*) AS count,COALESCE(sum(end_ms-start_ms),0) AS duration FROM daylight_sessions s WHERE ${sql}`,args)).rows[0];
      const limit=Number(q.limit??50),offset=Number(q.offset??0);
      const fingerprint=createHash('sha256').update(JSON.stringify([id,q.start??null,q.end??null,q.listId??null,q.kind??null,this.timeZone])).digest('hex');
      let seek='';
      if(q.cursor){
        if(offset)throw invalid('cursor and nonzero offset cannot be combined');
        let cursor: {start:number;id:string;filter:string};
        try{cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));}catch{throw invalid('Invalid cursor');}
        if(!Number.isSafeInteger(cursor.start)||cursor.start<0||typeof cursor.id!=='string'||cursor.id.length>128||cursor.filter!==fingerprint)throw invalid('Cursor does not match this filter');
        args.push(cursor.start,cursor.id);seek=` AND (s.start_ms,s.id)<($${args.length-1},$${args.length})`;
      }
      const rows=await client.query(`SELECT s.* FROM daylight_sessions s WHERE ${sql}${seek} ORDER BY s.start_ms DESC,s.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit+1,offset]);
      const hasMore=rows.rows.length>limit,items=rows.rows.slice(0,limit).map(toSession),last=items.at(-1);
      const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({start:last.start,id:last.id,filter:fingerprint})).toString('base64url'):null;
      return {workspace,data:{items,total:summary?Number(summary.count):null,totalDurationMs:summary?Number(summary.duration):null,limit,offset,nextOffset:!q.cursor&&hasMore?offset+limit:null,nextCursor,timeZone:this.timeZone}};
    });
  }
  async csv(id:string,filters:Filters) {
    const client=await this.database.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
      const meta=await client.query('SELECT * FROM daylight_workspace_meta WHERE id=$1',[id]); if(!meta.rowCount)throw notFound('Workspace');
      const row=meta.rows[0],workspace={id,revision:Number(row.revision),updatedAt:row.updated_at.toISOString()};
      const {sql,args}=await sessionWhere(client,id,filters,this.timeZone);
      await client.query(`DECLARE daylight_export NO SCROLL CURSOR FOR SELECT s.*,l.name AS list_name FROM daylight_sessions s LEFT JOIN daylight_lists l ON l.workspace_id=s.workspace_id AND l.id=s.list_id WHERE ${sql} ORDER BY s.start_ms DESC,s.id DESC`,args);
      let released=false;
      const finish=async()=>{if(released)return;released=true;await client.query('ROLLBACK').catch(()=>{});client.release();};
      async function* chunks(){try{
        yield '\uFEFFTask,List,Kind,Start,End,Minutes\r\n';
        for(;;){const batch=await client.query('FETCH FORWARD 500 FROM daylight_export');if(!batch.rowCount)break;
          yield batch.rows.map(r=>[r.title,r.list_name??'Deleted list',r.kind,new Date(Number(r.start_ms)).toISOString(),new Date(Number(r.end_ms)).toISOString(),String((Number(r.end_ms)-Number(r.start_ms))/60_000)].map(csvCell).join(',')).join('\r\n')+'\r\n';}
      }finally{await finish();}}
      const stream=Readable.from(chunks());stream.once('close',()=>void finish());
      return {workspace,stream};
    } catch(error){await client.query('ROLLBACK').catch(()=>{});client.release();throw error;}
  }
  async overview(id:string,q:Filters & {days?:'7'|'30'|'90'}) {
    if(!!q.start!==!!q.end)throw invalid('Custom reports need both start and end');
    const end=q.end??dayAt(Date.now(),this.timeZone),start=q.start??new Date(Date.parse(`${end}T00:00:00Z`)-(Number(q.days??7)-1)*86_400_000).toISOString().slice(0,10);
    validateRange({start,end});const calendarDays=(Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86_400_000+1;
    if(calendarDays>366)throw invalid('Report range is limited to 366 calendar days');
    return this.database.readTransaction(id,async(client,workspace)=>{
      const {sql,args}=await sessionWhere(client,id,{start,end,listId:q.listId},this.timeZone);
      const tz=`$${args.length+1}`,local=`(to_timestamp(s.start_ms/1000.0) AT TIME ZONE ${tz})`;
      const totals=(await client.query(`SELECT count(*) AS sessions,count(*) FILTER(WHERE kind='work') AS work_sessions,
        COALESCE(sum(end_ms-start_ms) FILTER(WHERE kind='work'),0) AS focus,
        COALESCE(sum(end_ms-start_ms) FILTER(WHERE kind='break'),0) AS breaks,
        count(DISTINCT ${local}::date) FILTER(WHERE kind='work') AS days FROM daylight_sessions s WHERE ${sql}`,[...args,this.timeZone])).rows[0];
      const completedArgs:unknown[]=[id,start,end,this.timeZone];
      let listCondition='';if(q.listId){completedArgs.push(q.listId);listCondition=' AND list_id=$5';}
      const completed=Number((await client.query(`SELECT count(*) FROM daylight_tasks WHERE workspace_id=$1 AND completed_at_ms >= (extract(epoch from($2::date::timestamp AT TIME ZONE $4))*1000)::bigint AND completed_at_ms < (extract(epoch from(($3::date+1)::timestamp AT TIME ZONE $4))*1000)::bigint${listCondition}`,completedArgs)).rows[0].count);
      const buckets=await client.query(`SELECT extract(dow from ${local})::int AS weekday,extract(hour from ${local})::int AS hour,count(*) AS count,sum(end_ms-start_ms)/60000.0 AS minutes FROM daylight_sessions s WHERE ${sql} AND kind='work' GROUP BY 1,2`,[...args,this.timeZone]);
      const days=Array<number>(7).fill(0),minutes=Array<number>(7).fill(0),hours=Array<number>(24).fill(0);
      for(let n=0;n<calendarDays;n++)days[new Date(Date.parse(`${start}T00:00:00Z`)+n*86_400_000).getUTCDay()]++;
      for(const row of buckets.rows){minutes[row.weekday]+=Number(row.minutes);hours[row.hour]+=Number(row.count);}
      const listTimes=await client.query(`SELECT list_id,sum(end_ms-start_ms) AS focus FROM daylight_sessions s WHERE ${sql} AND kind='work' GROUP BY list_id`,args);
      const listMap=new Map(listTimes.rows.map(r=>[r.list_id,Number(r.focus)]));
      const lists=(await client.query(`SELECT * FROM daylight_lists WHERE workspace_id=$1${q.listId?' AND id=$2':''} ORDER BY position,id`,q.listId?[id,q.listId]:[id])).rows.map(toList);
      const focusMs=Number(totals.focus);
      return {workspace,data:{formula:'daylight-local-v1',timeZone:this.timeZone,range:{start,end,calendarDays},listId:q.listId??null,
        totals:{focusMs,breakMs:Number(totals.breaks),completedTasks:completed,activeDays:Number(totals.days),workSessions:Number(totals.work_sessions),sessions:Number(totals.sessions),averageFocusPerCompletedTaskMs:completed?focusMs/completed:null},
        weekdays:days.map((count,weekday)=>({weekday,calendarDays:count,averageMinutes:count?minutes[weekday]/count:0})),
        startsByHour:hours.map((sessions,hour)=>({hour,sessions})),timeByList:lists.map(l=>({id:l.id,name:l.name,archived:l.archived,deleted:l.deleted,focusMs:listMap.get(l.id)??0})),
        unknowns:['Original server aggregate formulas','Accuracy bucket classification','Activity heatmap semantics']}};
    });
  }
}
