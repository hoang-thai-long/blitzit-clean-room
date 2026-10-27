import { test, expect, type Page } from '@playwright/test';
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('daylight.local.v1')!));
const openSettings = (page: Page) => page.getByTitle('Settings', { exact: true }).click();
test.beforeEach(async ({ page }) => { await page.clock.install(); await page.goto('/'); });

test('AC-01 board, seed, empty validation, one created task, reload persistence', async ({ page }) => {
  for (const name of ['Backlog', 'This Week', 'Today', 'Done']) await expect(page.getByRole('region', { name: `${name} column`, exact: true })).toBeVisible();
  await expect(page.locator('.today-column')).toBeVisible();
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await page.getByLabel('New task title').fill('   ');
  await expect(page.getByRole('button', { name: 'Create task' })).toBeDisabled();
  await page.getByLabel('New task title').fill('Acceptance task');
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Acceptance task', exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Acceptance task', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Complete Acceptance task', exact: true }).click();
  expect((await stored(page)).tasks.find((t: any) => t.title === 'Acceptance task').completedAt).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Reopen Acceptance task', exact: true }).click();
  expect((await stored(page)).tasks.find((t: any) => t.title === 'Acceptance task')).toMatchObject({ stage: 'Today', completedAt: null });
});

test('AC-07 list create rename copy archive restore', async ({ page }) => {
  await page.getByRole('button', { name: 'New list', exact: true }).click();
  await page.getByLabel('List name', { exact: true }).fill('New ideas');
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await page.getByRole('button', { name: 'Manage New ideas', exact: true }).click();
  await page.getByLabel('List name', { exact: true }).fill('Ideas renamed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Ideas renamed', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ideas renamed Copy', exact: true })).toBeVisible();
  const before = (await stored(page)).tasks;
  await page.getByRole('button', { name: 'Manage Creative studio', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
  expect((await stored(page)).tasks).toEqual(before);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Restore list', exact: true }).click();
  await page.getByTitle('All lists', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Design the landing page', exact: true })).toBeVisible();
});

test('drag task across columns, reorder subtasks, filter disables task dragging', async ({ page }) => {
  const source = page.getByTestId('task-card').filter({ has: page.getByRole('button', { name: 'Build a reading list', exact: true }) });
  const target = page.getByTestId('task-card').filter({ has: page.getByRole('button', { name: 'Design the landing page', exact: true }) });
  await source.dragTo(target);
  expect((await stored(page)).tasks.find((t: any) => t.title === 'Build a reading list').stage).toBe('Today');
  await page.getByLabel('Search tasks', { exact: true }).fill('reading');
  await expect(page.getByTestId('task-card')).toHaveAttribute('draggable', 'false');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Design the landing page', exact: true }).click();
  const from = page.locator('.subtask-block').filter({ has: page.getByLabel('Tên subtask Outline the story', { exact: true }) });
  const to = page.locator('.subtask-block').filter({ has: page.getByLabel('Tên subtask Explore two hero concepts', { exact: true }) });
  await from.dragTo(to);
  expect((await stored(page)).tasks.find((t: any) => t.title === 'Design the landing page').subtasks[0].title).toBe('Explore two hero concepts');
});

test('deleted list archives child tasks, restore chooses an active list', async ({ page }) => {
  const count = (await stored(page)).sessions.length;
  await page.getByRole('button', { name: 'Manage Creative studio', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.locator('.archive-row').filter({ hasText: 'Design the landing page' }).getByRole('button', { name: 'Restore task', exact: true }).click();
  await page.getByTitle('All lists', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Design the landing page', exact: true })).toBeVisible();
  const s = await stored(page);
  expect(s.tasks.find((t: any) => t.title === 'Design the landing page')).toMatchObject({ archived: false, listId: 'personal' });
  expect(s.sessions).toHaveLength(count);
});

test('AC-08/09/10 subtasks blank rename, Escape, toggle, separate notes and flush', async ({ page }) => {
  await page.getByRole('button', { name: 'Design the landing page', exact: true }).click();
  const oldTitle = 'Explore two hero concepts';
  await page.getByLabel(`Tên subtask ${oldTitle}`, { exact: true }).fill(' ');
  await page.getByLabel(`Tên subtask ${oldTitle}`, { exact: true }).press('Enter');
  await expect(page.getByLabel(`Tên subtask ${oldTitle}`, { exact: true })).toHaveValue(oldTitle);
  await page.getByLabel('Add subtask', { exact: true }).fill('Discard this');
  await page.getByLabel('Add subtask', { exact: true }).press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Add subtask', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: `Toggle ${oldTitle}`, exact: true }).click();
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
  await page.getByLabel('Task notes', { exact: true }).fill('First draft');
  await page.getByLabel('Task notes', { exact: true }).fill('**Latest** notes');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Design the landing page', exact: true }).click();
  await expect(page.getByLabel('Task notes', { exact: true })).toHaveValue('**Latest** notes');
  await page.getByRole('button', { name: `Chi tiết ${oldTitle}`, exact: true }).click();
  await page.getByLabel(`Notes: ${oldTitle}`, { exact: true }).fill('Independent subtask note');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  const task = (await stored(page)).tasks.find((t: any) => t.title === 'Design the landing page');
  expect(task.notes).toBe('**Latest** notes');
  expect(task.subtasks[1].notes).toBe('Independent subtask note');
  expect(task.stage).toBe('Today');
});

test('AC-11/12/13/17/18 focus pause, preview, switch, stop, reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Focus Design the landing page', exact: true }).click();
  await page.clock.runFor(3100);
  expect((await stored(page)).timer.elapsed).toBeGreaterThanOrEqual(2000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedText = await page.getByTestId('timer-digits').textContent();
  await page.clock.runFor(5000);
  await expect(page.getByTestId('timer-digits')).toHaveText(pausedText!);
  await page.getByRole('button', { name: 'Complete active task', exact: true }).click();
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Complete active task', exact: true }).click();
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const before = await stored(page);
  await page.getByLabel('Switch focus task', { exact: true }).selectOption({ label: 'Read a chapter, take a note' });
  expect((await stored(page)).timer.sprint).toBeGreaterThanOrEqual(before.timer.sprint);
  await page.clock.runFor(2100);
  await page.getByRole('button', { name: 'Back to Dashboard · stop & save', exact: true }).click();
  expect((await stored(page)).timer.status).toBe('idle');
  expect((await stored(page)).sessions.length).toBe(before.sessions.length + 2);
  await page.getByRole('button', { name: 'Focus Design the landing page', exact: true }).click();
  await page.clock.runFor(1100);
  await page.reload();
  expect((await stored(page)).timer.status).toBe('paused');
});

test('AC-34/35 settings flush, System follows OS while brand independent', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await page.getByRole('button', { name: 'Cosmic Indigo', exact: true }).click();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  expect((await stored(page)).prefs).toMatchObject({ mode: 'system', brand: 'Cosmic Indigo' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.app')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/light/);
  expect((await stored(page)).prefs.mode).toBe('system');
});

test('AC-16 preferences reject zero break without overwriting valid duration', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Short break', { exact: true }).fill('0');
  await expect(page.getByLabel('Short break', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  expect((await stored(page)).prefs.short).toBe(5);
});

test('AC-31/32 reports filter, all-row CSV, safe cells, invalid session editing', async ({ page }) => {
  const fixture = await stored(page);
  const startMs = Date.now() - 3600_000;
  fixture.sessions = Array.from({ length: 121 }, (_, i) => ({ id: String(i), taskId: fixture.tasks[0].id, listId: 'studio', title: '=SUM("unsafe")\nnext', kind: 'work', start: startMs, end: startMs + 90_000 }));
  await page.addInitScript(s => localStorage.setItem('daylight.local.v1', JSON.stringify(s)), fixture);
  await page.reload();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream(); let csv = ''; for await (const chunk of stream!) csv += chunk.toString();
  expect(csv.match(/"1.5"/g)).toHaveLength(121);
  expect(csv).toContain('"\'=SUM(""unsafe"")\nnext"');
  await page.getByRole('button', { name: /Edit session/ }).first().click();
  const start = await page.getByLabel('Session start', { exact: true }).inputValue();
  await page.getByLabel('Session end', { exact: true }).fill(start);
  await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.getByLabel('Report list filter', { exact: true }).selectOption('personal');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('No completed tasks', { exact: true })).toHaveCount(0);
});

test('AC-41 shortcuts honor text and break context', async ({ page }) => {
  await page.getByLabel('Search tasks', { exact: true }).fill('test');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Focus Design the landing page', exact: true }).click();
  await page.getByRole('button', { name: 'Take a break', exact: true }).click();
  await page.keyboard.press('Control+Shift+D');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Complete active task', exact: true })).toBeDisabled();
});

test('task archive separate from done, bulk and delete confirmation', async ({ page }) => {
  await page.getByLabel('Select Design the landing page', { exact: true }).check();
  await page.getByLabel('Select Read a chapter, take a note', { exact: true }).check();
  await page.locator('.toolbar-right').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('2 thành công');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore task', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Restore task', exact: true }).first().click();
  await page.getByTitle('All lists', { exact: true }).click();
  await page.getByRole('button', { name: 'Actions Design the landing page', exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Design the landing page', exact: true })).toBeVisible();
});

test('storage failure is visible, not reported as saved', async ({ page }) => {
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await page.getByLabel('New task title', { exact: true }).fill('Unsaved task');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Không thể lưu local');
  await expect(page.locator('.board-footer')).toContainText('Save error');
});

test('desktop/mobile render, no external requests, keyboard accessible modal, screenshots', async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4173')) external.push(req.url()); });
  await page.reload();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await page.screenshot({ path: 'test-results/reports-desktop.png', fullPage: true });
  await page.getByTitle('All lists', { exact: true }).click();
  await page.getByRole('button', { name: 'Focus Design the landing page', exact: true }).click();
  await page.screenshot({ path: 'test-results/focus-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to Dashboard · stop & save', exact: true }).click();
  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.screenshot({ path: 'test-results/appearance-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add task', exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
