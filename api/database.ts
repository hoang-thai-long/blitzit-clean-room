import { Pool, type PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import { migrateSchema } from '../database/migrate';
import { loadState, writeDiff, type Scope } from '../database/store';
import { idleTimer, seed, type State } from '../src/model';
import { validate } from '../src/storage';
import { ApiError, notFound } from './errors';
import type { ApiConfig } from './config';

export type Workspace = { id: string; revision: number; updatedAt: string; state: State };
function decode(row: { id: string; revision: string; updated_at: Date; state: State }): Workspace {
  let valid = false;
  try { valid = validate(row.state); } catch { /* Invalid persisted data is not replaced. */ }
  const revision = Number(row.revision);
  if (!valid || !Number.isSafeInteger(revision) || revision < 0) throw new ApiError(500, 'INVALID_STORED_STATE', 'Stored workspace is invalid; no changes were applied');
  return { id: row.id, revision, state: row.state, updatedAt: row.updated_at.toISOString() };
}
export class Database {
  readonly pool: Pool;
  constructor(private config: ApiConfig, onPoolError: () => void = () => {}) { this.pool = new Pool(config.database); this.pool.on('error', onPoolError); }
  async migrate() {
    const client = await this.pool.connect();
    try { await migrateSchema(client,fileURLToPath(new URL('../database',import.meta.url))); }
    finally { client.release(); }
  }
  async health() { await this.pool.query('SELECT 1'); }
  async list(limit: number, offset: number) {
    const result = await this.pool.query('SELECT id, revision, updated_at FROM daylight_workspace_meta ORDER BY updated_at DESC, id LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows.map(row => ({ id: row.id as string, revision: Number(row.revision), updatedAt: (row.updated_at as Date).toISOString() }));
  }
  async read(id: string): Promise<Workspace> {
    return this.readTransaction(id,async (client,meta)=>({...meta,state:await loadState(client,id)}));
  }
  async readTransaction<T>(id:string,fn:(client:PoolClient,meta:Omit<Workspace,'state'>)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result=await client.query('SELECT * FROM daylight_workspace_meta WHERE id=$1',[id]);
      if (!result.rowCount) throw notFound('Workspace');
      const row=result.rows[0]; const data=await fn(client,{id,revision:Number(row.revision),updatedAt:row.updated_at.toISOString()});
      await client.query('COMMIT'); return data;
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
  }
  async readScoped(id:string,scope:Scope):Promise<Workspace> { return this.readTransaction(id,async(client,meta)=>({...meta,state:await loadState(client,id,scope)})); }
  private async transaction<T>(id: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('lock_timeout', $1, true)", [`${this.config.lockTimeoutMs}ms`]);
      // Same lock identity as desktop: readers are allowed, concurrent writers are not.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`daylight:${id}`]);
      const result = await fn(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async create(id: string, sample: boolean): Promise<Workspace> {
    return this.transaction(id, async client => {
      const state = seed();
      if (!sample) { state.tasks = []; state.lists = []; state.sessions = []; state.timer = idleTimer(); }
      const result = await client.query('INSERT INTO daylight_workspace_meta (id, revision) VALUES ($1, 1) ON CONFLICT DO NOTHING RETURNING *', [id]);
      if (!result.rowCount) throw new ApiError(409, 'WORKSPACE_EXISTS', 'Workspace already exists; it was not replaced');
      await writeDiff(client,id,null,state);
      return decode({...result.rows[0],state});
    });
  }
  async mutate<T>(id: string, expected: number | undefined, fn: (state: State) => { state: State; data: T }, scope?:Scope): Promise<{ workspace: Workspace; data: T }> {
    return this.transaction(id, async client => {
      const result = await client.query('SELECT * FROM daylight_workspace_meta WHERE id = $1 FOR UPDATE', [id]);
      if (!result.rowCount) throw notFound('Workspace');
      const current = decode({...result.rows[0],state:await loadState(client,id,scope)});
      if (expected !== undefined && expected !== current.revision) throw new ApiError(412, 'REVISION_MISMATCH', 'If-Match is stale; reload the workspace and retry');
      const original = JSON.stringify(current.state);
      const before=structuredClone(current.state);
      const change = fn(current.state);
      let valid = false;
      try { valid = validate(change.state); } catch { /* Reject invalid mutation atomically. */ }
      if (!valid) throw new ApiError(422, 'INVALID_STATE', 'This operation would create an invalid workspace');
      const encoded = JSON.stringify(change.state);
      if (Buffer.byteLength(encoded) > 20 * 1024 * 1024) throw new ApiError(413, 'WORKSPACE_TOO_LARGE', 'Workspace exceeds the 20 MiB snapshot limit');
      if (encoded === original) return { workspace: current, data: change.data };
      await writeDiff(client,id,before,change.state);
      const updated = await client.query('UPDATE daylight_workspace_meta SET revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $2 RETURNING *', [id, current.revision]);
      if (!updated.rowCount) throw new ApiError(409, 'REVISION_CONFLICT', 'Workspace changed during the write');
      return { workspace: decode({...updated.rows[0],state:change.state}), data: change.data };
    });
  }
  async close() { await this.pool.end(); }
}
