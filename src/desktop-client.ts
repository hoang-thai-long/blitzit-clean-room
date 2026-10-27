import type { DesktopBridge, DesktopSnapshot } from '../desktop/types';
import type { State } from './model';
declare global { interface Window { daylight?: DesktopBridge } }
let snapshot: DesktopSnapshot | null = null;
const listeners = new Set<(value: DesktopSnapshot) => void>();
let pending: Promise<unknown> = Promise.resolve();
export const desktopSnapshot = () => snapshot;
function accept(value: DesktopSnapshot) {
  if (snapshot && value.revision < snapshot.revision) return;
  snapshot = value;
  for (const listener of listeners) listener(value);
}
export async function initializeDesktop() {
  if (!window.daylight) return;
  window.daylight.onSnapshot(accept);
  accept(await window.daylight.bootstrap());
  if (location.hash !== '#island') window.daylight.onPrepareQuit(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    void flushDesktop().finally(() => window.daylight!.readyToQuit());
  });
}
export function subscribeDesktop(fn: (value: DesktopSnapshot) => void) { listeners.add(fn); if (snapshot) fn(snapshot); return () => { listeners.delete(fn); }; }
export function mutateDesktop(fn: (state: State) => State): Promise<void> {
  const job = pending.catch(() => {}).then(async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const base = snapshot!;
      const next = fn(base.state);
      if (next === base.state) return;
      const result = await window.daylight!.commit(base.revision, next);
      accept(result.snapshot);
      if (result.accepted) return;
    }
    throw new Error('Workspace đang thay đổi; vui lòng thử lại thao tác.');
  });
  pending = job;
  return job;
}
export async function flushDesktop() { await pending; if (window.daylight) accept(await window.daylight.flush()); }
export async function desktopTimer(action: Parameters<DesktopBridge['timer']>[0]) { await pending; accept(await window.daylight!.timer(action)); }
