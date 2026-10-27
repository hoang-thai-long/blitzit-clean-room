import { Client, type ClientConfig } from 'pg';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { restore, seed, tick, timerAction, type State, type TimerAction } from '../src/model';
import { validate } from '../src/storage';
import type { DbConfig, DbStatus, DesktopSnapshot } from './types';
import { migrateSchema } from '../database/migrate';
import { loadState, saveState } from '../database/store';

type Cache = { format: 1; state: State; dirty: boolean; identity: string | null; baseRevision: number | null };
export const defaultDbConfig: DbConfig = { host: '127.0.0.1', port: 54329, database: 'daylight', user: 'daylight', ssl: false, workspace: 'default' };
export function checkConfig(config: DbConfig): void {
  if (!config || typeof config.host !== 'string' || !config.host.trim() || typeof config.database !== 'string' || !config.database.trim() || typeof config.user !== 'string' || !config.user.trim() || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.ssl !== 'boolean' || typeof config.workspace !== 'string' || !/^[\w-]{1,64}$/.test(config.workspace) || (config.password !== undefined && typeof config.password !== 'string')) throw new Error('Invalid PostgreSQL configuration');
}
const identity = (c: DbConfig) => createHash('sha256').update(JSON.stringify([c.host, c.port, c.database, c.user, c.workspace, c.ssl])).digest('hex');
export function atomicJson(path: string, data: unknown) { writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 }); renameSync(`${path}.tmp`, path); }

export class Repository {
  private cache: Cache;
  private revision = 0;
  private client: Client | null = null;
  private connectionReady = false;
  private baseState: State | null = null;
  private config: DbConfig | null = null;
  private connecting: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readOnly = false;
  private listeners = new Set<(s: DesktopSnapshot) => void>();
  private status: DbStatus = { phase: 'unconfigured', message: 'Chưa kết nối PostgreSQL · bản local đang hoạt động.', revision: null, lastSynced: null };
  constructor(private directory: string, private schemaDirectory = join(process.cwd(),'database')) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'workspace-cache.json');
    try {
      const data: Cache = JSON.parse(readFileSync(path, 'utf8'));
      if (data.format !== 1 || !validate(data.state) || typeof data.dirty !== 'boolean' || !(data.identity === null || typeof data.identity === 'string') || !(data.baseRevision === null || Number.isSafeInteger(data.baseRevision))) throw new Error('Invalid cache');
      this.cache = { ...data, state: restore(data.state) };
      // A restored running session must also be persisted as paused.
      if (data.state.timer.status === 'running' || data.state.timer.preview) this.cache.dirty = true;
    } catch {
      this.cache = { format: 1, state: seed(), dirty: false, identity: null, baseRevision: null };
      if (existsSync(path)) { this.readOnly = true; this.status = { ...this.status, phase: 'error', message: 'Local cache không hợp lệ. Giữ nguyên file; khôi phục từ backup trước khi chỉnh sửa.' }; }
    }
  }
  snapshot(): DesktopSnapshot { return { revision: this.revision, state: structuredClone(this.cache.state), database: { ...this.status } }; }
  subscribe(fn: (s: DesktopSnapshot) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { const snapshot = this.snapshot(); for (const fn of this.listeners) fn(snapshot); }
  private writeCache() { atomicJson(join(this.directory, 'workspace-cache.json'), this.cache); }
  private schedule() { if (!this.timer && !this.closed) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 500); }
  commit(expectedRevision: number, state: State, trusted = false) {
    if (expectedRevision !== this.revision) return { accepted: false, snapshot: this.snapshot() };
    if (this.readOnly) throw new Error('Local cache is read-only after a read failure');
    if (!validate(state) || Buffer.byteLength(JSON.stringify(state)) > 20 * 1024 * 1024) throw new Error('Invalid workspace snapshot');
    const previous = this.cache;
    this.cache = { ...previous, state: trusted ? state : structuredClone(state), dirty: true };
    try { this.writeCache(); } catch { this.cache = previous; this.status = { ...this.status, phase: 'error', message: 'Không ghi được local outbox. Thay đổi chưa được lưu.' }; this.emit(); throw new Error('Cannot write local outbox'); }
    this.revision++;
    if (this.client && this.connectionReady && this.status.phase !== 'conflict') this.status = { ...this.status, phase: 'pending', message: 'Đã lưu local · đang đồng bộ PostgreSQL…' };
    this.emit(); this.schedule();
    return { accepted: true, snapshot: this.snapshot() };
  }
  action(action: TimerAction, now = Date.now()) {
    const next = timerAction(this.cache.state, action, now);
    if (next !== this.cache.state) this.commit(this.revision, next, true);
    return this.snapshot();
  }
  tick(now = Date.now()) {
    const next = tick(this.cache.state, now);
    if (next !== this.cache.state) this.commit(this.revision, next, true);
  }
  async connect(config = this.config): Promise<DesktopSnapshot> {
    if (!config || this.closed || this.readOnly) return this.snapshot();
    checkConfig(config);
    if (this.connecting) { await this.connecting; return this.snapshot(); }
    this.connecting = this.doConnect(config).finally(() => { this.connecting = null; });
    await this.connecting;
    return this.snapshot();
  }
  private async disconnect() { const client = this.client; this.client = null; this.connectionReady = false; if (client) await client.end().catch(() => {}); }
  private async doConnect(config: DbConfig) {
    if (this.flushing) await this.flushing;
    await this.disconnect(); this.config = { ...config };
    this.status = { ...this.status, phase: 'connecting', message: 'Đang kết nối PostgreSQL…' }; this.emit();
    const connection: ClientConfig = { host: config.host, port: config.port, database: config.database, user: config.user, password: config.password ?? '', ssl: config.ssl ? { rejectUnauthorized: true } : false, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 6000, application_name: `Daylight:${config.workspace}` };
    const client = new Client(connection);
    client.on('error', () => { if (this.client === client) { this.client = null; this.connectionReady = false; this.status = { ...this.status, phase: 'offline', message: 'PostgreSQL mất kết nối. Dữ liệu đang nằm trong local outbox.' }; this.emit(); } });
    try {
      await client.connect();
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`daylight:${config.workspace}`]);
      if (!lock.rows[0].acquired) throw new Error('WORKSPACE_BUSY');
      this.client = client;
      await migrateSchema(client,this.schemaDirectory);
      const result = await client.query('SELECT revision FROM daylight_workspace_meta WHERE id = $1', [config.workspace]);
      const row = result.rows[0];
      if (row) row.state=await loadState(client,config.workspace);
      this.baseState=row?.state ?? null;
      const key = identity(config);
      if (row && !validate(row.state)) throw new Error('INVALID_DATABASE_STATE');
      if (row && this.cache.dirty && (this.cache.identity !== key || this.cache.baseRevision !== Number(row.revision))) {
        this.connectionReady = true;
        this.status = { ...this.status, phase: 'conflict', message: 'PostgreSQL và local outbox có lịch sử khác nhau. Chưa ghi đè bên nào; tải bản PostgreSQL sẽ tạo backup local.' }; this.emit(); return;
      }
      if (row && !this.cache.dirty) { this.cache.state = restore(row.state); this.revision++; }
      this.cache.identity = key;
      this.cache.baseRevision = row ? Number(row.revision) : null;
      this.cache.dirty = true;
      this.writeCache();
      this.connectionReady = true;
      this.status = { ...this.status, phase: 'pending', message: 'Đã kết nối · đang lưu PostgreSQL…' };
      await this.flush();
    } catch (error) {
      if (this.client === client) this.client = null;
      this.connectionReady = false;
      await client.end().catch(() => {});
      const message = error instanceof Error ? error.message : '';
      this.status = { ...this.status, phase: message === 'INVALID_DATABASE_STATE' ? 'error' : 'offline', message: message === 'WORKSPACE_BUSY' ? 'Workspace đang được mở bởi một app khác. Đóng app đó hoặc chọn Workspace ID khác.' : message === 'INVALID_DATABASE_STATE' ? 'Snapshot PostgreSQL không hợp lệ; không thay thế dữ liệu local.' : 'Không kết nối được PostgreSQL. Kiểm tra host/port/database/user/password; dữ liệu local được giữ lại.' };
      this.emit();
    }
  }
  async flush(): Promise<DesktopSnapshot> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flushing) { await this.flushing; if (this.cache.dirty && this.client && this.connectionReady && this.status.phase !== 'conflict') return this.flush(); return this.snapshot(); }
    if (!this.client || !this.connectionReady || !this.config || !this.cache.dirty || this.status.phase === 'conflict' || this.readOnly) return this.snapshot();
    this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    await this.flushing;
    return this.snapshot();
  }
  private async doFlush() {
    const client = this.client!, config = this.config!, state = this.cache.state, generation = this.revision;
    try {
      const revision=await saveState(client,config.workspace,this.cache.baseRevision,this.baseState,state);
      if (revision===null) { this.status = { ...this.status, phase: 'conflict', message: 'Revision PostgreSQL đã đổi. Không ghi đè dữ liệu mới; giữ local outbox.' }; this.emit(); return; }
      this.baseState=state;
      this.cache.baseRevision = revision;
      this.cache.dirty = generation !== this.revision;
      this.writeCache();
      this.status = { phase: this.cache.dirty ? 'pending' : 'synced', message: this.cache.dirty ? 'Đã lưu local · đang đồng bộ…' : 'Đã lưu PostgreSQL', revision: this.cache.baseRevision, lastSynced: Date.now() };
      this.emit(); if (this.cache.dirty) this.schedule();
    } catch {
      this.cache.dirty = true;
      await this.disconnect();
      this.status = { ...this.status, phase: 'offline', message: 'Ghi PostgreSQL chưa được xác nhận. Local outbox được giữ; sẽ thử lại kết nối.' }; this.emit();
    }
  }
  async useDatabase() {
    if (!this.client || !this.connectionReady || !this.config || this.readOnly) return this.snapshot();
    if (this.flushing) await this.flushing;
    const result = await this.client.query('SELECT revision FROM daylight_workspace_meta WHERE id = $1', [this.config.workspace]);
    const row = result.rows[0]; if (!row) throw new Error('Database snapshot unavailable');
    row.state=await loadState(this.client,this.config.workspace); this.baseState=row.state;
    if (!validate(row.state)) throw new Error('Database snapshot unavailable');
    atomicJson(join(this.directory, `workspace-backup-${Date.now()}.json`), this.cache);
    this.cache = { format: 1, state: restore(row.state), dirty: true, identity: identity(this.config), baseRevision: Number(row.revision) };
    this.revision++; this.writeCache();
    this.status = { ...this.status, phase: 'pending', message: 'Đã tạo backup local và tải PostgreSQL.' }; this.emit(); return this.flush();
  }
  async close() { this.closed = true; if (this.timer) clearTimeout(this.timer); if (this.connecting) await this.connecting; await this.flush(); await this.disconnect(); }
}
