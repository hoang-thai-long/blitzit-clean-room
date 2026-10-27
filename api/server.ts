import { readConfig } from './config';
import { Database } from './database';
import { createApi } from './app';
async function main() {
  const config = readConfig(), database = new Database(config);
  const app = await createApi(config, database);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; try { await app.close(); } catch { process.exitCode = 1; } };
  process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
  try { await database.migrate(); await app.listen({ host: config.host, port: config.port }); }
  catch { console.error('Daylight API startup failed. Verify PostgreSQL configuration, database permissions and API port. Credentials omitted.'); await close(); process.exitCode = 1; }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Invalid API configuration'); process.exitCode = 1; });
