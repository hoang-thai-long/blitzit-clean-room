import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, safeStorage, powerMonitor, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Repository, atomicJson, checkConfig, defaultDbConfig } from './repository';
import type { DbConfig, DesktopInfo } from './types';
import type { State, TimerAction } from '../src/model';

if (process.env.DAYLIGHT_USER_DATA) app.setPath('userData', process.env.DAYLIGHT_USER_DATA);
// X11/XWayland provides explicit window positioning; native Wayland can be opted into.
if (process.platform === 'linux' && process.env.DAYLIGHT_NATIVE_WAYLAND !== '1') app.commandLine.appendSwitch('ozone-platform', 'x11');
app.setName('Daylight');
const single = app.requestSingleInstanceLock();
let main: BrowserWindow | null = null, island: BrowserWindow | null = null, tray: Tray | null = null;
let repo: Repository;
let quitting = false, finishing = false;
let tickLoop: ReturnType<typeof setInterval>, retryLoop: ReturnType<typeof setInterval>, quitTimeout: ReturnType<typeof setTimeout>;
let islandOptions: DesktopInfo['island'] = { visible: true, expanded: false, displayId: null };
let config = { ...defaultDbConfig }, passwordStored = false;
const iconPath = join(__dirname, 'icon.png');
const indexPath = join(__dirname, '../dist/index.html');
const documentUrl = pathToFileURL(indexPath).href;
const credentialsPath = () => join(app.getPath('userData'), 'database-config.json');
const canEncrypt = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

function loadConfig() {
  try {
    const saved = JSON.parse(readFileSync(credentialsPath(), 'utf8'));
    config = { ...defaultDbConfig, ...saved.config };
    if (saved.password && canEncrypt()) { config.password = safeStorage.decryptString(Buffer.from(saved.password, 'base64')); passwordStored = true; }
    checkConfig(config);
  } catch { config = { ...defaultDbConfig }; passwordStored = false; }
  if (process.env.DAYLIGHT_DATABASE_URL) {
    const url = new URL(process.env.DAYLIGHT_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DAYLIGHT_DATABASE_URL must use postgres://');
    config = { host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: ['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''), workspace: process.env.DAYLIGHT_WORKSPACE || 'default' };
    checkConfig(config);
  }
}
function saveConfig(next: DbConfig) {
  checkConfig(next);
  config = { ...next, password: next.password === undefined ? config.password : next.password };
  const { password, ...publicConfig } = config;
  passwordStored = !!password && canEncrypt();
  atomicJson(credentialsPath(), { config: publicConfig, password: passwordStored ? safeStorage.encryptString(password!).toString('base64') : null });
}
function publicInfo(): DesktopInfo {
  const { password: _password, ...publicConfig } = config;
  return { config: publicConfig, passwordStored, displays: screen.getAllDisplays().map(d => ({ id: d.id, label: d.label || `${d.size.width} × ${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' · primary' : ''}` })), island: islandOptions, session: process.env.DAYLIGHT_NATIVE_WAYLAND === '1' ? 'Wayland (positioning depends on compositor)' : 'X11 / XWayland' };
}
function showMain() { if (!main) return; if (main.isMinimized()) main.restore(); main.show(); main.focus(); }
function placeIsland() {
  if (!island) return;
  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id === islandOptions.displayId) ?? screen.getPrimaryDisplay();
  if (islandOptions.displayId !== null && !displays.some(d => d.id === islandOptions.displayId)) islandOptions.displayId = display.id;
  const area = display.workArea;
  const width = Math.min(420, area.width), height = islandOptions.expanded ? 250 : 84;
  island.setBounds({ x: area.x + Math.round((area.width - width) / 2), y: area.y + 10, width, height: Math.min(height, area.height) });
  island.setAlwaysOnTop(true, 'floating');
}
function configureIsland(options: Partial<DesktopInfo['island']>) {
  if (!options || typeof options !== 'object' || Object.keys(options).some(k => !['visible', 'expanded', 'displayId'].includes(k)) || (options.visible !== undefined && typeof options.visible !== 'boolean') || (options.expanded !== undefined && typeof options.expanded !== 'boolean') || (options.displayId !== undefined && options.displayId !== null && !Number.isInteger(options.displayId))) throw new Error('Invalid island options');
  islandOptions = { ...islandOptions, ...options };
  placeIsland();
  if (islandOptions.visible) island?.showInactive(); else island?.hide();
  atomicJson(join(app.getPath('userData'), 'desktop-settings.json'), islandOptions);
}
function secureWindow(window: BrowserWindow) {
  window.on('page-title-updated', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'"] } }));
}
function createWindows() {
  const webPreferences = { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged };
  main = new BrowserWindow({ title: 'Daylight', width: 1440, height: 940, minWidth: 780, minHeight: 580, backgroundColor: '#161a18', icon: iconPath, show: false, webPreferences });
  island = new BrowserWindow({ title: 'Daylight Island', width: 420, height: 84, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000', webPreferences });
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  secureWindow(main); secureWindow(island);
  main.on('ready-to-show', showMain);
  main.on('close', event => { if (!quitting) { event.preventDefault(); main?.hide(); configureIsland({ visible: true }); } });
  island.on('close', event => { if (!quitting) { event.preventDefault(); configureIsland({ visible: false }); } });
  island.on('ready-to-show', () => { placeIsland(); if (islandOptions.visible) island?.showInactive(); });
  void main.loadFile(indexPath); void island.loadFile(indexPath, { hash: 'island' });
  main.webContents.on('render-process-gone', () => { repo.action({ type: 'stop' }); });
  const image = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  tray = new Tray(image); tray.setToolTip('Daylight — focus workspace');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Daylight', click: showMain },
    { label: 'Show Dynamic Island', click: () => configureIsland({ visible: true }) },
    { label: 'Hide Dynamic Island', click: () => configureIsland({ visible: false }) },
    { label: 'Center Island on primary display', click: () => configureIsland({ visible: true, displayId: screen.getPrimaryDisplay().id }) },
    { type: 'separator' }, { label: 'Quit & save', click: beginQuit },
  ]));
  tray.on('click', showMain);
  Menu.setApplicationMenu(null);
}
function authorized(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, dashboardOnly = false) {
  const windows = dashboardOnly ? [main] : [main, island];
  if (!windows.some(w => w && !w.isDestroyed() && w.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url.split('#')[0] !== documentUrl) throw new Error('Unauthorized desktop sender');
}
function handlers() {
  ipcMain.handle('daylight:bootstrap', event => { authorized(event); return repo.snapshot(); });
  ipcMain.handle('daylight:commit', (event, revision: number, state: State) => { authorized(event, true); if (!Number.isSafeInteger(revision)) throw new Error('Invalid revision'); return repo.commit(revision, state); });
  ipcMain.handle('daylight:timer', (event, action: TimerAction) => { authorized(event); if (!action || !['launch', 'pause', 'stop', 'preview', 'confirm', 'break', 'skipBreak', 'cancel'].includes(action.type) || (['launch', 'cancel'].includes(action.type) && typeof (action as { taskId?: unknown }).taskId !== 'string')) throw new Error('Invalid timer action'); const result = repo.action(action); if (action.type === 'preview') showMain(); return result; });
  ipcMain.handle('daylight:flush', async event => { authorized(event); return repo.flush(); });
  ipcMain.handle('daylight:info', event => { authorized(event); return publicInfo(); });
  ipcMain.handle('daylight:configure', async (event, next: DbConfig) => { authorized(event, true); saveConfig(next); return repo.connect(config); });
  ipcMain.handle('daylight:retry-db', async event => { authorized(event, true); return repo.connect(config); });
  ipcMain.handle('daylight:use-db', async event => { authorized(event, true); return repo.useDatabase(); });
  ipcMain.handle('daylight:island', (event, options) => { authorized(event); configureIsland(options); });
  ipcMain.handle('daylight:dashboard', event => { authorized(event); showMain(); });
  ipcMain.handle('daylight:quit', event => { authorized(event); beginQuit(); });
  ipcMain.on('daylight:ready-to-quit', event => { authorized(event, true); if (quitting) void finishQuit(); });
}
function beginQuit() {
  if (quitting) return;
  quitting = true;
  // Allow pending note/preferences edits to blur and drain their renderer queue.
  if (main && !main.isDestroyed()) main.webContents.send('daylight:prepare-quit');
  else { void finishQuit(); return; }
  quitTimeout = setTimeout(() => void finishQuit(), 3500);
}
async function finishQuit() {
  if (finishing) return; finishing = true;
  clearTimeout(quitTimeout); clearInterval(tickLoop); clearInterval(retryLoop);
  try { repo?.action({ type: 'stop' }); await repo?.close(); } finally { tray?.destroy(); app.exit(0); }
}
if (!single) app.quit();
else {
  app.on('second-instance', showMain);
  app.on('before-quit', event => { if (!finishing) { event.preventDefault(); beginQuit(); } });
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    repo = new Repository(app.getPath('userData'),join(__dirname,'../database'));
    loadConfig();
    try { const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'desktop-settings.json'), 'utf8')); if (typeof saved.visible === 'boolean' && (saved.displayId === null || Number.isInteger(saved.displayId))) islandOptions = { visible: saved.visible, expanded: false, displayId: saved.displayId }; } catch { /* First launch. */ }
    if (config.password || process.env.DAYLIGHT_DATABASE_URL) await repo.connect(config);
    handlers(); createWindows();
    repo.subscribe(snapshot => { for (const window of [main, island]) if (window && !window.isDestroyed()) window.webContents.send('daylight:snapshot', snapshot); });
    tickLoop = setInterval(() => { try { repo.tick(); } catch { /* Repository emits a visible storage error. */ } }, 1000);
    retryLoop = setInterval(() => { if (repo.snapshot().database.phase === 'offline') void repo.connect(config); }, 15_000);
    screen.on('display-removed', placeIsland); screen.on('display-metrics-changed', placeIsland);
    powerMonitor.on('suspend', () => { if (repo.snapshot().state.timer.status === 'running') repo.action({ type: 'pause' }); void repo.flush(); });
  }).catch(error => { dialog.showErrorBox('Daylight startup error', error instanceof Error ? error.message : 'Unable to start'); app.exit(1); });
}
