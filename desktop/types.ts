import type { State, TimerAction } from '../src/model';
export type DbConfig = { host: string; port: number; database: string; user: string; password?: string; ssl: boolean; workspace: string };
export type DbStatus = { phase: 'unconfigured' | 'connecting' | 'synced' | 'pending' | 'offline' | 'conflict' | 'error'; message: string; revision: number | null; lastSynced: number | null; passwordStored?: boolean };
export type DesktopSnapshot = { revision: number; state: State; database: DbStatus };
export type DesktopInfo = { config: Omit<DbConfig, 'password'>; displays: { id: number; label: string }[]; island: { visible: boolean; expanded: boolean; displayId: number | null }; session: string; passwordStored: boolean };
export interface DesktopBridge {
  bootstrap(): Promise<DesktopSnapshot>;
  commit(revision: number, state: State): Promise<{ accepted: boolean; snapshot: DesktopSnapshot }>;
  timer(action: TimerAction): Promise<DesktopSnapshot>;
  onSnapshot(fn: (snapshot: DesktopSnapshot) => void): () => void;
  onPrepareQuit(fn: () => void): () => void;
  readyToQuit(): void;
  flush(): Promise<DesktopSnapshot>;
  info(): Promise<DesktopInfo>;
  configure(config: DbConfig): Promise<DesktopSnapshot>;
  retryDatabase(): Promise<DesktopSnapshot>;
  useDatabase(): Promise<DesktopSnapshot>;
  island(options: { visible?: boolean; expanded?: boolean; displayId?: number | null }): Promise<void>;
  showDashboard(): Promise<void>;
  quit(): Promise<void>;
}
