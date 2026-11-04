/** D4489 — plans by month/week; no automatic publishing or invented analytics. */
import { useEffect, useState } from 'react';
import { growCalendar } from '../../../lib/api/growCalendar';
import { cyclesWrite } from '../../../lib/api/cycles';
import { destinationRows } from '../publish/publishModel';
import { publishApi } from '../../../lib/api/publish';
import { PieceDialog, DeleteDialog } from '../ContentCalendar';
import { dayKey, monthGrid, weekGrid, dayPieces, pieceStatus } from './calendarModel';
import PieceSheet from './PieceSheet';
import PostPreview from './PostPreview';

export default function CalendarTab({ projectId, channels = [], campaigns = [], api = growCalendar }) {
  const [date, setDate] = useState(() => new Date()); const [mode, setMode] = useState('month');
  const [channel, setChannel] = useState(''); const [campaign, setCampaign] = useState('');
  const [read, setRead] = useState({ state: 'loading', pieces: [] }); const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null); const [dialog, setDialog] = useState(null); const [expanded, setExpanded] = useState({});
  const [places, setPlaces] = useState({ state: 'loading', rows: [], canPublish: false });
  const days = mode === 'month' ? monthGrid(date) : weekGrid(date); const from = dayKey(days[0]); const to = dayKey(days.at(-1));
  const reload = () => setRevision((n) => n + 1);
  useEffect(() => {
    let live = true; setRead({ state: 'loading', pieces: [] }); setSelected(null);
    if (projectId) api.pieces(projectId, { from, to, channel, campaign }).then((r) => { if (live) setRead({ state: 'ready', pieces: r.pieces || [] }); }).catch(() => { if (live) setRead({ state: 'error', pieces: [] }); });
    else setRead({ state: 'error', pieces: [] });
    return () => { live = false; };
  }, [api, projectId, from, to, channel, campaign, revision]);
  useEffect(() => {
    let live = true; setPlaces({ state: 'loading', rows: [], canPublish: false });
    if (projectId) publishApi.destinations(projectId).then((r) => { if (live) setPlaces({ state: 'ready', rows: destinationRows(r), canPublish: r.can_publish === true }); }).catch(() => { if (live) setPlaces({ state: 'error', rows: [], canPublish: false }); });
    return () => { live = false; };
  }, [projectId]);
  const move = (n) => { const next = new Date(date); if (mode === 'month') { next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + n); } else next.setUTCDate(next.getUTCDate() + n * 7); setDate(next); setExpanded({}); };
  const done = () => { setDialog(null); setSelected(null); reload(); };
  const all = read.pieces;
  return <section className="space-y-4 text-gray-900 dark:text-gray-100" aria-label="Content calendar">
    <div className="flex flex-wrap items-center gap-3"><button aria-label="Previous period" onClick={() => move(-1)}>‹</button><strong>{date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button aria-label="Next period" onClick={() => move(1)}>›</button><button onClick={() => setDate(new Date())}>Today</button>
      {['month', 'week'].map((v) => <button key={v} aria-pressed={mode === v} onClick={() => { setMode(v); setExpanded({}); }} className={mode === v ? 'rounded-full bg-violet-100 px-3 text-violet-900 dark:bg-violet-950 dark:text-violet-200' : ''}>{v === 'month' ? 'Month' : 'Week'}</button>)}
      <select aria-label="Channel filter" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option>{channels.map((c) => <option key={c.uid || c.id} value={c.uid || c.id}>{c.name}</option>)}</select>
      <select aria-label="Campaign filter" value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}</select>
      <button onClick={() => setDialog({ kind: 'add' })}>+ Plan a piece</button>
    </div>
    <p>Pieces you plan to publish. A plan, never a record of what was sent.</p><p>You press Send for each post.</p>
    {read.state === 'loading' ? <div role="status" aria-label="Loading calendar" className="h-96 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" /> : read.state === 'error' ? <p role="alert">Unreadable: the calendar could not be read. <button onClick={reload}>Try again</button></p> : <>
      {!all.length && <p>Nothing planned this month. <button onClick={() => setDialog({ kind: 'add' })}>+ Plan a piece</button></p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"><div className="min-w-0 overflow-x-auto rounded-xl border bg-white dark:border-gray-700 dark:bg-gray-900"><div className="grid min-w-[630px] grid-cols-7">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="p-2 font-bold" key={d}>{d}</div>)}
        {days.map((d) => { const key = dayKey(d); const { visible, overflow } = dayPieces(all, key, expanded[key]); return <div key={key} className={`min-h-[88px] border-t p-2 dark:border-gray-700 ${key === dayKey(new Date()) ? 'bg-violet-50 dark:bg-violet-950' : ''}`} style={{ opacity: mode === 'month' && d.getUTCMonth() !== date.getUTCMonth() ? 0.45 : 1 }}><time dateTime={key}>{d.getUTCDate()}</time>
          {visible.map((p) => { const status = pieceStatus(p); return <button className={`mb-1 block w-full rounded border p-1 text-left text-xs ${status.dropped ? 'line-through' : ''}`} key={p.uid} onClick={() => setSelected(p)}><span className="block text-gray-500 dark:text-gray-400">{p.channel_name || 'No channel'}</span><span className="block truncate">{p.title}</span><span className={status.className}>{status.label}</span>{(p.campaigns || []).map((c) => <span className="block truncate" key={c.uid}>{c.name}</span>)}</button>; })}
          {overflow > 0 && <button onClick={() => setExpanded((v) => ({ ...v, [key]: true }))}>+{overflow} more</button>}
        </div>; })}
      </div></div><aside className="min-w-0 rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-900">{selected ? <><h3>{selected.title} · {selected.channel_name || 'No channel'}</h3><PostPreview platform={selected.channel_kind} /></> : <p>Select a piece to preview it.</p>}<p>Notion-planned pieces show as Planned, never as Sent.</p></aside></div>
    </>}
    {selected && !dialog && <PieceSheet piece={selected} projectId={projectId} onClose={() => setSelected(null)} onEdit={() => setDialog({ kind: 'edit', item: selected })} onTime={(time) => api.time(projectId, selected.uid, time).then(done)} canPublish={places.canPublish} destinations={places.rows} destinationsState={places.state} />}
    {(dialog?.kind === 'add' || dialog?.kind === 'edit') && <PieceDialog item={dialog.item} channels={channels} onClose={() => setDialog(null)} onSave={(b) => (dialog.item ? cyclesWrite.grow.contentUpdate(projectId, dialog.item.uid, b) : cyclesWrite.grow.content(projectId, b)).then(done)} />}
    {selected && <button onClick={() => setDialog({ kind: 'delete', item: selected })}>Delete piece</button>}
    {dialog?.kind === 'delete' && <DeleteDialog item={dialog.item} onClose={() => setDialog(null)} onConfirm={() => cyclesWrite.grow.contentDelete(projectId, dialog.item.uid).then(done)} />}
  </section>;
}
