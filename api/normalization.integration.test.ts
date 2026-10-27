import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readConfig } from './config';
import { migrateSchema } from '../database/migrate';
import { loadState, writeDiff } from '../database/store';
import { seed } from '../src/model';
let client:Client;
const schemas:string[]=[];
beforeAll(async()=>{client=new Client(readConfig().database);await client.connect();});
afterAll(async()=>{await client.query('SET search_path=public');for(const schema of schemas)await client.query(`DROP SCHEMA "${schema}" CASCADE`);await client.end();});
async function legacy(){
  const schema=`migration_${randomUUID().replaceAll('-','')}`;schemas.push(schema);
  await client.query(`CREATE SCHEMA "${schema}"`);await client.query(`SET search_path="${schema}",public`);
  // Do not use IF NOT EXISTS: each fixture must have its own v1 table.
  await client.query('CREATE TABLE daylight_workspaces(id text PRIMARY KEY,revision bigint NOT NULL,state jsonb NOT NULL,updated_at timestamptz DEFAULT now())');
  const state=seed();state.tasks[0].notes='Unicode: tiếng Việt\n**Markdown**';
  await client.query('INSERT INTO daylight_workspaces(id,revision,state) VALUES($1,7,$2)',['legacy',JSON.stringify(state)]);
  return {state,schema};
}
it('migration round-trips complete v1 data, keeps immutable backup, and reruns without modifying rows',async()=>{
  const {state}=await legacy();await migrateSchema(client,join(process.cwd(),'database'));
  expect(await loadState(client,'legacy')).toEqual(state);
  expect((await client.query('SELECT state FROM daylight_workspaces WHERE id=$1',['legacy'])).rows[0].state).toEqual(state);
  const oldXmin=(await client.query('SELECT xmin::text FROM daylight_tasks WHERE workspace_id=$1 ORDER BY position LIMIT 1',['legacy'])).rows[0].xmin;
  await migrateSchema(client,join(process.cwd(),'database'));
  expect((await client.query('SELECT xmin::text FROM daylight_tasks WHERE workspace_id=$1 ORDER BY position LIMIT 1',['legacy'])).rows[0].xmin).toBe(oldXmin);
  const changed=structuredClone(state);changed.tasks[0].notes='Changed only one task';
  await client.query('BEGIN');await writeDiff(client,'legacy',state,changed);await client.query('COMMIT');
  expect((await client.query('SELECT state FROM daylight_workspaces_v1_backup WHERE id=$1',['legacy'])).rows[0].state).toEqual(state);
  await expect(client.query('UPDATE daylight_workspaces SET state=$1 WHERE id=$2',[JSON.stringify(state),'legacy'])).rejects.toThrow(/cannot update column/i);
});
it('malformed v1 records roll back the entire migration, retaining the original table and bytes',async()=>{
  const {state,schema}=await legacy();const malformed=structuredClone(state);delete (malformed.tasks[0] as Partial<typeof malformed.tasks[0]>).notes;
  await client.query('UPDATE daylight_workspaces SET state=$1',[JSON.stringify(malformed)]);
  await expect(migrateSchema(client,join(process.cwd(),'database'))).rejects.toThrow();
  expect((await client.query('SELECT state FROM daylight_workspaces')).rows[0].state).toEqual(malformed);
  expect((await client.query('SELECT to_regclass($1) AS name',[`${schema}.daylight_workspace_meta`])).rows[0].name).toBeNull();
});
it('composite foreign keys reject cross-workspace task/list references',async()=>{
  await legacy();await migrateSchema(client,join(process.cwd(),'database'));
  await client.query("INSERT INTO daylight_workspace_meta(id) VALUES('other')");
  await expect(client.query("INSERT INTO daylight_tasks(workspace_id,id,list_id,position,title,stage) VALUES('other','bad','studio',0,'Bad relation','Today')")).rejects.toThrow(/foreign key/i);
});
