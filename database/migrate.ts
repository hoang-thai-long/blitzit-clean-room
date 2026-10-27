import type { ClientBase } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function migrateSchema(client: ClientBase, directory: string) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('daylight:api-schema-v1'))");
    const schema=String((await client.query('SELECT current_schema() AS name')).rows[0].name).replaceAll('"','""');
    const versions=`"${schema}".daylight_schema_migrations`;
    await client.query(`CREATE TABLE IF NOT EXISTS ${versions}(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = await client.query(`SELECT version FROM ${versions} WHERE version=2`);
    if (!done.rowCount) {
      await client.query(await readFile(join(directory, '001-workspaces.sql'), 'utf8'));
      await client.query(await readFile(join(directory, '002-normalized.sql'), 'utf8'));
      await client.query(`INSERT INTO ${versions}(version) VALUES(2)`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
