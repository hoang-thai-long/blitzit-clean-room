import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Check, Plus, Trash2, GripVertical, Eye, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { STAGES, quickDate, renameSubtask, reorder, uid, type Task, type List, type Subtask } from './model';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const nodes = () => Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]')).filter(el => el.offsetParent !== null);
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (!node.contains(e.target as Node)) return;
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close.current(); }
      if (e.key === 'Tab') { const els = nodes(); if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0]?.focus(); } }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); old?.focus(); };
  }, []);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header>{children}</div></div>;
}

export function Notes({ value, onChange, label = 'Task notes' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const [draft, setDraft] = useState(value), [preview, setPreview] = useState(false);
  const pending = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), change = useRef(onChange);
  change.current = onChange;
  const flush = () => { clearTimeout(timer.current); if (pending.current !== null) { change.current(pending.current); pending.current = null; } };
  useEffect(() => () => flush(), []);
  return <section className="notes"><div className="section-heading"><span>{label} <small>Markdown</small></span><button className="quiet" onClick={() => { flush(); setPreview(!preview); }}>{preview ? <Pencil size={14}/> : <Eye size={14}/>} {preview ? 'Edit' : 'Preview'}</button></div>{preview ? <div className="markdown"><ReactMarkdown>{draft || '*Chưa có ghi chú.*'}</ReactMarkdown></div> : <textarea aria-label={label} value={draft} placeholder="Một ý tưởng, một đường dẫn, một ghi chú…" onBlur={flush} onChange={e => { const text = e.target.value; setDraft(text); pending.current = text === value ? null : text; clearTimeout(timer.current); timer.current = setTimeout(flush, 300); }}/>}</section>;
}

function SubtaskRow({ sub, change, remove, drag, drop }: { sub: Subtask; change: (sub: Subtask) => void; remove: () => void; drag: () => void; drop: () => void }) {
  const [title, setTitle] = useState(sub.title), [details, setDetails] = useState(false);
  const finish = () => { const next = renameSubtask(sub, title); setTitle(next.title); change(next); };
  return <div className="subtask-block" draggable onDragStart={e => { e.stopPropagation(); drag(); }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(); }}>
    <div className="subtask-row"><GripVertical size={15} className="muted"/><button className={`check ${sub.done ? 'checked' : ''}`} aria-label={`Toggle ${sub.title}`} onClick={() => change({ ...sub, done: !sub.done })}>{sub.done && <Check size={12}/>}</button><input aria-label={`Tên subtask ${sub.title}`} className={sub.done ? 'struck' : ''} value={title} onChange={e => setTitle(e.target.value)} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTitle(sub.title); } }}/><button className="quiet" onClick={() => setDetails(!details)} aria-label={`Chi tiết ${sub.title}`}>Notes</button><button className="icon-button small" onClick={remove} aria-label={`Xóa subtask ${sub.title}`}><Trash2 size={14}/></button></div>
    {details && <div className="subtask-details"><label>Subtask due date<input type="date" value={sub.due} onChange={e => change({ ...sub, due: e.target.value })}/></label><Notes value={sub.notes} onChange={notes => change({ ...sub, notes })} label={`Notes: ${sub.title}`}/></div>}
  </div>;
}

export function TaskEditor({ task, lists, patch, onClose, launch }: { task: Task; lists: List[]; patch: (patch: Partial<Task>) => void; onClose: () => void; launch: () => void }) {
  const [title, setTitle] = useState(task.title), [draft, setDraft] = useState('');
  const drag = useRef<string | null>(null);
  return <Modal title="Task details" onClose={onClose} wide><div className="task-editor">
    <div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div>
    <input className="task-title-input" aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim()) patch({ title: title.trim() }); else setTitle(task.title); }}/>
    <div className="form-grid"><label>List<select value={task.listId} onChange={e => patch({ listId: e.target.value })}>{lists.filter(l => !l.deleted).map(l => <option key={l.id} value={l.id}>{l.name}{l.archived ? ' (archived)' : ''}</option>)}</select></label><label>Status<select value={task.stage} onChange={e => patch({ stage: e.target.value as Task['stage'], completedAt: e.target.value === 'Done' ? Date.now() : null })}>{STAGES.map(s => <option key={s}>{s}</option>)}</select></label><label>Estimate · minutes<input aria-label="Estimate" type="number" min="1" value={task.estimate ?? ''} onChange={e => patch({ estimate: e.target.value ? Math.max(1, Number(e.target.value)) : null })}/></label><label>Do date<input aria-label="Do date" type="date" value={task.due.slice(0, 10)} onChange={e => patch({ due: e.target.value })}/></label></div>
    <div className="quick-dates"><span className="muted">Plan for</span>{(['later', 'tomorrow', 'nextWeek'] as const).map((k, i) => <button key={k} className="chip" onClick={() => patch({ due: quickDate(k) })}>{['Later today', 'Tomorrow', 'Next week'][i]}</button>)}{task.due && <button className="quiet" onClick={() => patch({ due: '' })}>Clear · {task.due.replace('T', ' ')}</button>}</div>
    <Notes value={task.notes} onChange={notes => patch({ notes })}/>
    <div className="section-heading"><span>Subtasks</span><span className="muted">{task.subtasks.filter(s => s.done).length} / {task.subtasks.length}</span></div>
    <div className="progress-track"><div style={{ width: `${task.subtasks.length ? task.subtasks.filter(s => s.done).length / task.subtasks.length * 100 : 0}%` }}/></div>
    <div className="subtasks">{task.subtasks.map(sub => <SubtaskRow key={sub.id} sub={sub} change={next => patch({ subtasks: task.subtasks.map(s => s.id === sub.id ? next : s) })} remove={() => patch({ subtasks: task.subtasks.filter(s => s.id !== sub.id) })} drag={() => { drag.current = sub.id; }} drop={() => { if (drag.current) patch({ subtasks: reorder(task.subtasks, drag.current, sub.id) }); drag.current = null; }}/>)}</div>
    <form className="inline-form" onSubmit={e => { e.preventDefault(); if (draft.trim()) { patch({ subtasks: [...task.subtasks, { id: uid(), title: draft.trim(), done: false, notes: '', due: '' }] }); setDraft(''); } }}><Plus size={16}/><input aria-label="Add subtask" placeholder="Thêm subtask, Enter để lưu…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(''); } }}/><button className="quiet" type="submit" disabled={!draft.trim()}>Add</button></form>
    {task.completedAt && <p className="muted">Completed {new Date(task.completedAt).toLocaleString()}</p>}
    <footer className="editor-footer"><span className="muted">Thay đổi được lưu local</span>{task.stage !== 'Done' && !task.archived && <button className="primary" onClick={launch}>Start focusing ↗</button>}</footer>
  </div></Modal>;
}
