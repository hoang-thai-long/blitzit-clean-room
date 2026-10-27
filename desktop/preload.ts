import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopSnapshot } from './types';
const api: DesktopBridge = {
  bootstrap: () => ipcRenderer.invoke('daylight:bootstrap'),
  commit: (revision, state) => ipcRenderer.invoke('daylight:commit', revision, state),
  timer: action => ipcRenderer.invoke('daylight:timer', action),
  onSnapshot: fn => { const listener = (_event: unknown, value: DesktopSnapshot) => fn(value); ipcRenderer.on('daylight:snapshot', listener); return () => { ipcRenderer.removeListener('daylight:snapshot', listener); }; },
  onPrepareQuit: fn => { const listener = () => fn(); ipcRenderer.on('daylight:prepare-quit', listener); return () => { ipcRenderer.removeListener('daylight:prepare-quit', listener); }; },
  readyToQuit: () => ipcRenderer.send('daylight:ready-to-quit'),
  flush: () => ipcRenderer.invoke('daylight:flush'),
  info: () => ipcRenderer.invoke('daylight:info'),
  configure: config => ipcRenderer.invoke('daylight:configure', config),
  retryDatabase: () => ipcRenderer.invoke('daylight:retry-db'),
  useDatabase: () => ipcRenderer.invoke('daylight:use-db'),
  island: options => ipcRenderer.invoke('daylight:island', options),
  showDashboard: () => ipcRenderer.invoke('daylight:dashboard'),
  quit: () => ipcRenderer.invoke('daylight:quit'),
};
contextBridge.exposeInMainWorld('daylight', Object.freeze(api));
