import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Check, ChevronDown, ChevronUp, Coffee, Leaf, Pause, Play, X } from 'lucide-react';
import { BRANDS } from './model';
import { desktopSnapshot, desktopTimer, subscribeDesktop } from './desktop-client';
const clock = (ms: number) => `${String(Math.floor(Math.max(0, ms) / 60_000)).padStart(2, '0')}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
export function Island() {
  const [snapshot, setSnapshot] = useState(desktopSnapshot()!), [expanded, setExpanded] = useState(false), [error, setError] = useState('');
  useEffect(() => subscribeDesktop(setSnapshot), []);
  useEffect(() => { const refresh = () => { void window.daylight!.info().then(info => setExpanded(info.island.expanded)); }; refresh(); window.addEventListener('resize', refresh); return () => window.removeEventListener('resize', refresh); }, []);
  const { timer, tasks, prefs, lists } = snapshot.state;
  const task = tasks.find(t => t.id === timer.taskId), list = lists.find(l => l.id === task?.listId);
  const remaining = timer.phase === 'work' ? timer.elapsed : prefs[timer.phase] * 60_000 - timer.elapsed;
  const toggle = () => { const next = !expanded; setExpanded(next); void window.daylight!.island({ expanded: next }); };
  const command = (type: 'pause' | 'preview' | 'break' | 'skipBreak') => { void desktopTimer({ type }).catch(() => setError('Chưa lưu được. Mở Dashboard để kiểm tra.')); };
  return <div className={`island-shell ${expanded ? 'expanded' : ''}`} style={{ '--island-accent': BRANDS[prefs.brand] } as CSSProperties}>
    <div className="island-top"><span className={`island-orb ${timer.status === 'running' ? 'pulsing' : ''}`}><Leaf size={17}/></span><button className="island-caption" aria-label="Expand or collapse Island" onClick={toggle}><strong>{task?.title ?? 'A little space to focus'}</strong><small>{task ? `${timer.phase === 'work' ? 'Focus' : 'Break'} · ${timer.status}` : 'Daylight · ready when you are'}</small></button><span className="island-time" data-testid="island-time">{task ? clock(remaining) : '✦'}</span>{task && <button aria-label="Island pause resume" disabled={!!timer.preview} onClick={() => command('pause')}>{timer.status === 'running' ? <Pause size={17}/> : <Play size={17}/>}</button>}<button aria-label="Toggle Island details" onClick={toggle}>{expanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}</button></div>
    {expanded && <div className="island-details"><div className="island-meta"><span>{list?.name ?? 'Your local workspace'}</span><span>{snapshot.database.phase === 'synced' ? '● PostgreSQL' : '◌ Local outbox'}</span></div><p>{task ? `${prefs.pomodoro ? `${prefs.work} min sprint` : 'Free focus'} · ${timer.rounds} sprints completed` : 'Mở Dashboard và chọn một task để bắt đầu.'}</p><div className="island-buttons"><button onClick={() => void window.daylight!.showDashboard()}><ArrowUpRight size={15}/> Dashboard</button>{task && <><button disabled={!!timer.preview} onClick={() => command(timer.phase === 'work' ? 'break' : 'skipBreak')}><Coffee size={15}/>{timer.phase === 'work' ? 'Break' : 'End break'}</button><button disabled={timer.phase !== 'work' || !!timer.preview} onClick={() => command('preview')}><Check size={15}/> Done</button></>}<button aria-label="Hide Island" onClick={() => void window.daylight!.island({ visible: false })}><X size={14}/></button></div>{error && <small role="alert">{error}</small>}<div className="island-drag-hint">Kéo vùng trống để di chuyển · một timer dùng chung</div></div>}
  </div>;
}
