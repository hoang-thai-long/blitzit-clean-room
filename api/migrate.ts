import { readConfig } from './config';
import { Database } from './database';
const database = new Database(readConfig());
try { await database.migrate(); console.log('Daylight normalized PostgreSQL schema v2 ready; original snapshots retained in daylight_workspaces_v1_backup.'); }
catch { console.error('Migration failed. Check PostgreSQL configuration and CREATE permissions.'); process.exitCode = 1; }
finally { await database.close(); }
