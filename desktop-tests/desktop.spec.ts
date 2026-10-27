import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { Client } from 'pg';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
let app: ElectronApplication, main: Page, island: Page, directory: string, workspace: string, sql: Client;
async function launch(dir = directory) {
  const url = `postgresql://daylight:${encodeURIComponent(process.env.DAYLIGHT_DB_PASSWORD!)}@127.0.0.1:${process.env.DAYLIGHT_DB_PORT || 54329}/${process.env.DAYLIGHT_DB_NAME || 'daylight'}`;
  app = await electron.launch({ executablePath: process.env.DAYLIGHT_TEST_EXECUTABLE, args: [...(process.env.DAYLIGHT_TEST_EXECUTABLE ? [] : ['.']), '--no-sandbox'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '', DAYLIGHT_USER_DATA: dir, DAYLIGHT_DATABASE_URL: url, DAYLIGHT_WORKSPACE: workspace } });
  await expect.poll(() => app.windows().filter(p => p.url().startsWith('file:')).length).toBe(2);
  main = app.windows().find(p => !p.url().endsWith('#island'))!;
  island = app.windows().find(p => p.url().endsWith('#island'))!;
  await expect(main.getByTestId('database-status')).toHaveText('Đã lưu PostgreSQL');
  await expect(island.locator('.island-shell')).toBeVisible();
}
test.beforeEach(async () => {
  if (!process.env.DAYLIGHT_DB_PASSWORD) throw new Error('Run db:setup and db:up first');
  workspace = `desktop-test-${randomUUID()}`; directory = mkdtempSync(join(tmpdir(), 'daylight-desktop-'));
  sql = new Client({ host: '127.0.0.1', port: Number(process.env.DAYLIGHT_DB_PORT || 54329), database: process.env.DAYLIGHT_DB_NAME || 'daylight', user: 'daylight', password: process.env.DAYLIGHT_DB_PASSWORD });
  await sql.connect(); await launch();
});
test.afterEach(async () => { await app?.close(); if (sql) { await sql.query('DELETE FROM daylight_workspaces WHERE id = $1', [workspace]); await sql.end(); } if (directory) rmSync(directory, { recursive: true, force: true }); });

test('Dynamic Island and Dashboard share one timer; close hides main, controls and completion work', async () => {
  const errors: string[] = []; main.on('pageerror', error => errors.push(error.message)); island.on('pageerror', error => errors.push(error.message));
  await main.getByRole('button', { name: 'Focus Design the landing page', exact: true }).click();
  await expect(island.locator('.island-caption strong')).toHaveText('Design the landing page');
  await expect.poll(async () => (await main.evaluate(() => window.daylight!.bootstrap())).state.timer.elapsed).toBeGreaterThan(1000);
  await island.getByRole('button', { name: 'Island pause resume', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(island.getByTestId('island-time')).toHaveText((await main.getByTestId('timer-digits').textContent())!);
  await island.getByRole('button', { name: 'Toggle Island details', exact: true }).click();
  await expect(island.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Daylight Island')?.getBounds().height)).toBe(250);
  await island.screenshot({ path: 'desktop-test-results/island-expanded.png', omitBackground: true });
  const before = (await main.evaluate(() => window.daylight!.bootstrap())).state.timer.elapsed;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().endsWith('#island'))!.close());
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().endsWith('#island'))!.isVisible())).toBe(false);
  await island.getByRole('button', { name: 'Island pause resume', exact: true }).click();
  await expect.poll(async () => (await island.evaluate(() => window.daylight!.bootstrap())).state.timer.elapsed).toBeGreaterThan(before + 1000);
  await island.getByRole('button', { name: 'Island pause resume', exact: true }).click();
  await island.getByRole('button', { name: 'Dashboard', exact: true }).click();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().endsWith('#island'))!.isVisible())).toBe(true);
  await island.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(main.getByRole('dialog', { name: 'A task well done?' })).toBeVisible();
  await main.getByRole('button', { name: 'Complete task', exact: true }).click();
  await main.evaluate(() => window.daylight!.flush());
  const row = (await sql.query('SELECT state FROM daylight_workspaces WHERE id = $1', [workspace])).rows[0].state;
  expect(row.tasks.find((t: { title: string }) => t.title === 'Design the landing page').stage).toBe('Done');
  expect(row.sessions).toHaveLength(37);
  expect(row.timer.status).toBe('idle'); expect(errors).toEqual([]);
  await main.screenshot({ path: 'desktop-test-results/desktop-dashboard.png' });
});

test('PostgreSQL reload from a fresh profile and offline outbox reconnect', async () => {
  await main.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await main.getByLabel('New task title').fill('Stored in PostgreSQL');
  await main.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Stored in PostgreSQL', exact: true })).toBeVisible();
  await main.evaluate(() => window.daylight!.flush());
  await app.close();
  await launch(join(directory, 'fresh-profile'));
  await expect(main.getByRole('button', { name: 'Stored in PostgreSQL', exact: true })).toBeVisible();
  await sql.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()', [`Daylight:${workspace}`]);
  await expect(main.getByTestId('database-status')).toContainText('mất kết nối');
  await main.getByRole('button', { name: 'Stored in PostgreSQL', exact: true }).click();
  await main.getByLabel('Task notes', { exact: true }).fill('Outbox survives a database outage');
  await main.getByRole('button', { name: 'Đóng', exact: true }).click();
  await main.getByRole('button', { name: 'Desktop & PostgreSQL', exact: true }).click();
  await main.getByRole('button', { name: 'Retry sync', exact: true }).click();
  await expect(main.getByTestId('database-status')).toHaveText('Đã lưu PostgreSQL');
  const row = (await sql.query('SELECT state FROM daylight_workspaces WHERE id = $1', [workspace])).rows[0].state;
  expect(row.tasks.find((t: { title: string }) => t.title === 'Stored in PostgreSQL').notes).toBe('Outbox survives a database outage');
  await main.screenshot({ path: 'desktop-test-results/postgres-settings.png' });
});

test('isolated renderer, restricted IPC, positioning fallback and compact controls', async () => {
  expect(await main.evaluate(() => typeof (window as unknown as { require: unknown }).require)).toBe('undefined');
  const settings = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => { const p = w.webContents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }; }));
  expect(settings.every(p => p.sandbox && p.contextIsolation && !p.nodeIntegration)).toBe(true);
  await expect(island.evaluate(async () => { const snapshot = await window.daylight!.bootstrap(); return window.daylight!.commit(snapshot.revision, snapshot.state); })).rejects.toThrow('Unauthorized');
  await main.evaluate(() => window.daylight!.island({ visible: true, displayId: -999, expanded: false }));
  const info = await main.evaluate(() => window.daylight!.info());
  expect(info.displays.some(d => d.id === info.island.displayId)).toBe(true);
  await expect.poll(async () => island.evaluate(() => innerHeight)).toBe(84);
  await island.screenshot({ path: 'desktop-test-results/island-compact.png', omitBackground: true });
  const position = await app.evaluate(({ BrowserWindow, screen }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#island'))!; const area = screen.getPrimaryDisplay().workArea; return { top: win.isAlwaysOnTop(), bounds: win.getBounds(), area }; });
  expect(position.top).toBe(true);
  expect(position.bounds.x).toBe(position.area.x + Math.round((position.area.width - position.bounds.width) / 2));
});
