import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { readConfig } from './config';
import { createApi } from './app';
import { Queries } from './queries';
import { loadState, saveState } from '../database/store';
import type { FastifyInstance } from 'fastify';
import { mkdir,writeFile } from 'node:fs/promises';
let database:Database,app:FastifyInstance;
const id=`perf-${randomUUID()}`,base=`/api/v1/workspaces/${id}`,epoch=Date.UTC(2026,0,1);
const measurements:Record<string,unknown>={fixture:{tasks:10000,sessions:100000},maintenance:'VACUUM (ANALYZE) before measurement; enable_seqscan unchanged',measuredAt:new Date().toISOString()};
beforeAll(async()=>{
  const config=readConfig({...process.env,DAYLIGHT_API_LOG_LEVEL:'silent'});database=new Database(config);await database.migrate();await database.create(id,false);app=await createApi(config,database);
  await database.pool.query("INSERT INTO daylight_lists(workspace_id,id,position,name,color) VALUES($1,'bench-list',0,'Benchmark','#a5edb5')",[id]);
  await database.pool.query(`INSERT INTO daylight_tasks(workspace_id,id,list_id,position,title,stage,notes)
    SELECT $1,'task-'||n,'bench-list',n,CASE WHEN n=5000 THEN 'unique benchmark needle' ELSE 'Task '||n END,'Today','A retained note' FROM generate_series(1,10000) n`,[id]);
  await database.pool.query(`INSERT INTO daylight_sessions(workspace_id,id,position,task_id,list_id,title,start_ms,end_ms,kind)
    SELECT $1,'session-'||lpad(n::text,6,'0'),n,'task-'||(1+(n%10000)),'bench-list','Focus session',$2::bigint+(n/3)*60000,$2::bigint+(n/3)*60000+90000,'work' FROM generate_series(1,100000) n`,[id,epoch]);
  await database.pool.query('VACUUM (ANALYZE) daylight_tasks');await database.pool.query('VACUUM (ANALYZE) daylight_sessions');
},30_000);
afterAll(async()=>{await database.pool.query('DELETE FROM daylight_workspace_meta WHERE id=$1',[id]);await app.close();await mkdir('benchmark-results',{recursive:true});await writeFile('benchmark-results/normalized-db.json',JSON.stringify(measurements,null,2));});

function indices(plan:Record<string,unknown>):string[]{return [...(typeof plan['Index Name']==='string'?[plan['Index Name']]:[]),...((plan.Plans as Record<string,unknown>[]|undefined)??[]).flatMap(indices)];}
it('100k sessions: first/keyset pages and task search use real indexes without disabling seqscan',async()=>{
  const plans=await database.pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM daylight_sessions WHERE workspace_id=$1 AND (start_ms,id)<($2,$3) ORDER BY start_ms DESC,id DESC LIMIT 50',[id,epoch+33000*60000,'session-099000']);
  const plan=plans.rows[0]['QUERY PLAN'][0];expect(indices(plan.Plan)).toContain('daylight_sessions_page_idx');
  const search=await database.pool.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM daylight_tasks WHERE workspace_id=$1 AND NOT deleted AND lower(title || ' ' || notes) LIKE '%unique benchmark needle%'",[id]);
  const searchPlan=search.rows[0]['QUERY PLAN'][0];measurements.queryPlans={sessions:plan,search:searchPlan};expect(indices(searchPlan.Plan)).toContain('daylight_tasks_search_idx');
  console.log(JSON.stringify({fixture:{tasks:10000,sessions:100000},sessionsPlan:indices(plan.Plan),sessionsExecutionMs:plan['Execution Time'],searchPlan:indices(searchPlan.Plan),searchExecutionMs:searchPlan['Execution Time']}));
});
it('cursor pages with tied timestamps contain no duplicate IDs; mismatched filters fail',async()=>{
  let cursor:string|null=null;const seen=new Set<string>();
  for(let i=0;i<4;i++){
    const response=await app.inject(`${base}/sessions?limit=7${cursor?'&cursor='+cursor:''}`);expect(response.statusCode).toBe(200);
    const data:{total:number;items:{id:string}[];nextCursor:string|null}=response.json().data;expect(data.total).toBe(100000);expect(data.items).toHaveLength(7);
    for(const row of data.items){expect(seen.has(row.id)).toBe(false);seen.add(row.id);}cursor=data.nextCursor;
  }
  expect((await app.inject(`${base}/sessions?limit=7&listId=bench-list&cursor=${cursor}`)).statusCode).toBe(422);
});
it('task edit and timer checkpoint leave every historical session tuple unchanged',async()=>{
  const version=(await database.pool.query('SELECT xmin::text FROM daylight_sessions WHERE workspace_id=$1 LIMIT 1',[id])).rows[0].xmin;
  const times:number[]=[];
  for(let i=0;i<5;i++){
    const start=performance.now();const response=await app.inject({method:'PATCH',url:`${base}/tasks/task-5000`,payload:{title:`unique benchmark needle ${i}`}});times.push(performance.now()-start);expect(response.statusCode).toBe(200);
  }
  const client=await database.pool.connect();
  try{const revision=Number((await client.query('SELECT revision FROM daylight_workspace_meta WHERE id=$1',[id])).rows[0].revision);
    const before=await loadState(client,id,{}),after={...before,timer:{...before.timer,lastAt:Date.now()}};
    expect(await saveState(client,id,revision,before,after)).toBe(revision+1);
  }finally{client.release();}
  expect((await database.pool.query('SELECT bool_and(xmin::text=$2) AS untouched FROM daylight_sessions WHERE workspace_id=$1',[id,version])).rows[0].untouched).toBe(true);
  measurements.mutations={taskPatchSamplesMs:times,taskPatchMedianMs:[...times].sort((a,b)=>a-b)[2],historyRowsUntouched:100000};
});
it('SQL report and list page return aggregates/pages, not 100k rows in Node',async()=>{
  const pageStart=performance.now();const page=await app.inject(`${base}/sessions?limit=50`);const pageMs=performance.now()-pageStart;
  expect(page.json().data.items).toHaveLength(50);expect(page.body.length).toBeLessThan(30_000);
  const start=performance.now();const response=await app.inject(`${base}/reports/overview?start=2026-01-01&end=2026-01-30`);const reportMs=performance.now()-start;
  expect(response.statusCode).toBe(200);expect(response.json().data.totals.sessions).toBe(100000);expect(response.body.length).toBeLessThan(10_000);
  measurements.reads={sessionPageMs:pageMs,sessionResponseBytes:page.body.length,reportMs,reportResponseBytes:response.body.length};
});
it('CSV cursor cleanup also runs when export is aborted before the first chunk',async()=>{
  const q=new Queries(database,'UTC');const {stream}=await q.csv(id,{});stream.destroy();
  await new Promise(resolve=>stream.once('close',resolve));
  await new Promise(resolve=>setTimeout(resolve,30));
  expect(database.pool.idleCount).toBe(database.pool.totalCount);
});
