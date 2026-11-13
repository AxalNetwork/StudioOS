/** D4486 (#4486) — Distribution Channels: existing forms/Ask, observed readings, and read-only connection cards. */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { growChannelsApi } from '../../../lib/api/growChannels';
import { cyclesWrite } from '../../../lib/api/cycles';
import FormLightbox from '../FormLightbox';
import Lightbox from '../../../ui/Lightbox';
import { formFor, editFor } from '../forms';
import { CHANNEL_COLUMNS, CHANNEL_DOORS, CHANNEL_PILLS, CONNECTION_PILLS, activityLabel, channelOptions, connectionAction, recorded } from './channelsModel';

const BUTTON = 'rounded-lg border border-axal-hairline px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const TONES = {
  positive: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  negative: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  lavender: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  muted: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};
export function ChannelPill({ value, connection = false }) {
  const pill = (connection ? CONNECTION_PILLS : CHANNEL_PILLS)[value] || { label: 'Not recorded', tone: 'muted' };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${TONES[pill.tone]}`}><span aria-hidden="true">●</span>{pill.label}</span>;
}
const Reading = ({ value, reason, mono = false }) => <span title={reason || undefined} className={value == null ? 'text-sm italic text-gray-500 dark:text-gray-400' : mono ? 'font-mono text-sm' : 'text-sm'}>{recorded(value, reason)}</span>;

export function ChannelConnectionCard({ connection, onAction }) {
  const action = connectionAction(connection);
  return <article className={`${CARD} flex flex-col gap-3`}>
    <h3 className="font-bold">{connection.name}</h3>
    <div><ChannelPill value={connection.status} connection /></div>
    {connection.permission && <p className="text-sm">{connection.permission}</p>}
    {connection.identity && <p className="break-words text-sm">{connection.identity}</p>}
    {connection.reason && <p className="text-sm text-gray-600 dark:text-gray-300">{connection.reason}</p>}
    {connection.key !== 'lovable' && <button type="button" className={`${BUTTON} mt-auto ${action.label === 'Disconnect' ? 'text-red-700 dark:text-red-300' : ''}`} disabled={action.disabled}
      onClick={() => onAction(connection, action)}>{action.label}</button>}
    {connection.href === '/email' && <Link className="text-sm text-violet-700 dark:text-violet-300" to="/email">Email settings ›</Link>}
    {connection.key === 'lovable' && <Link className="text-sm text-violet-700 dark:text-violet-300" to="/build/prototype-mvp">Prototype links ›</Link>}
  </article>;
}

export default function ChannelsTab({ projectId, refresh, onChanged, fillFor = () => null }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null); const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0); const [editing, setEditing] = useState(null); const [confirm, setConfirm] = useState(null);
  useEffect(() => {
    let alive = true; setData(null); setStatus('loading'); setEditing(null); setConfirm(null);
    if (!projectId) { setStatus('missing'); return () => { alive = false; }; }
    growChannelsApi.channels(projectId).then((d) => { if (alive) { setData(d); setStatus('ready'); } })
      .catch((e) => { if (alive) setStatus(e?.status === 403 || e?.status === 404 ? 'refused' : 'unreadable'); });
    return () => { alive = false; };
  }, [projectId, refresh, retry]);
  if (status === 'loading') return <div role="status" className={`${CARD} animate-pulse`}>Loading channels…</div>;
  if (status === 'missing') return <p role="status">Choose a venture to read its channels.</p>;
  if (status !== 'ready') return <div role="status" className={CARD}><p>{status === 'refused' ? 'These channels are not available to you.' : 'Unreadable: channels could not be read.'}</p>{status !== 'refused' && <button className={BUTTON} onClick={() => setRetry((n) => n + 1)}>Try again</button>}</div>;
  const edit = editing?.uid ? editFor('grow', 'distribution') : formFor('grow', 'distribution');
  const current = editing?.uid ? { name: editing.name, kind: editing.kind || '', state: editing.status,
    purpose: editing.purpose || '', owner_user_id: editing.owner?.user_id == null ? '' : String(editing.owner.user_id) } : null;
  const close = () => setEditing(null);
  return <section className="space-y-5" aria-label="Distribution channels">
    <div className="flex items-center justify-between gap-3"><h2 className="font-bold">Channels</h2>{data.can_write && <button type="button" className={BUTTON} onClick={() => setEditing({})}>Add channel</button>}</div>
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full min-w-[800px] text-left text-sm">
        <colgroup>{['150px', '120px', '130px', undefined, '100px', '110px'].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
        <thead className="bg-gray-50 text-[10.5px] uppercase dark:bg-gray-800"><tr>{CHANNEL_COLUMNS.map((column) => <th key={column} scope="col" className="p-3">{column}</th>)}</tr></thead>
        <tbody>{data.channels.map((ch) => <tr key={ch.uid} className="border-t border-axal-hairline align-top dark:border-gray-700">
          <th scope="row" className="p-3"><span className="font-bold">{ch.name}</span>{ch.kind && <span className="block text-xs font-normal text-gray-500">{ch.kind}</span>}
            {data.can_write && <button type="button" className="mt-1 block text-xs font-normal text-violet-700 dark:text-violet-300" onClick={() => setEditing(ch)} aria-label={`Edit channel ${ch.name}`}>Edit</button>}
            {ch.campaigns?.map((c) => <Link key={c.uid} className="mt-1 block text-xs font-normal text-violet-700 dark:text-violet-300" to={`/grow/distribution/campaigns/${encodeURIComponent(c.uid)}?project_id=${encodeURIComponent(projectId)}`}>{c.name}</Link>)}
            {ch.campaigns == null && ch.campaigns_reason && <span role="status" className="mt-1 block text-xs font-normal text-gray-500">{ch.campaigns_reason}</span>}
          </th>
          <td className="p-3"><ChannelPill value={ch.status} /><span className="sr-only">Channel state; connection state appears in Connections below.</span></td>
          <td className="p-3">{ch.owner?.avatar && <img className="mr-1 inline h-6 w-6 rounded-full" src={ch.owner.avatar} alt="" />}<Reading value={ch.owner?.name} /></td>
          <td className="p-3"><Reading value={ch.purpose} /></td>
          <td className="p-3">{ch.last_activity ? <time dateTime={ch.last_activity} title={ch.last_activity} className="font-mono text-sm">{activityLabel(ch.last_activity)}</time>
            : <Reading value={null} reason={ch.last_activity_reason} mono />}</td>
          <td className="p-3"><Reading value={ch.results} reason={ch.results_reason} mono />{ch.results != null && <span> {ch.results === 1 ? 'lead' : 'leads'}</span>}</td>
        </tr>)}</tbody>
      </table>
      {!data.channels.length && <p className="p-3 text-sm text-gray-500">No channels recorded yet.</p>}
    </div>
    <div><h2 className="mb-2 text-xs font-bold uppercase tracking-wide">Connections</h2><p className="mb-4 text-sm">Each card says what Axal VC may do with that account. Connecting and disconnecting ask first, in a dialog.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.connections.map((c) => <ChannelConnectionCard key={c.key} connection={c} onAction={(connection, action) => setConfirm({ connection, action })} />)}</div>
    </div>
    <nav className="flex flex-wrap gap-3" aria-label="Related tools">{CHANNEL_DOORS.map((d) => <Link key={d.href} className={BUTTON} to={`${d.href}?project_id=${encodeURIComponent(projectId)}`}>{d.label} ›</Link>)}</nav>
    {editing && <FormLightbox key={editing.uid || 'new'} form={edit} current={current} cycle="grow" slug="distribution" moduleName="Distribution"
      fill={fillFor(edit, editing.uid || null)} loadOptions={() => Promise.resolve(channelOptions(data.members))}
      onSubmit={(values) => editing.uid ? edit.submit(cyclesWrite, projectId, editing.uid, values) : edit.submit(cyclesWrite, projectId, values)}
      onSaved={() => { close(); setRetry((n) => n + 1); onChanged?.(); }} onClose={close} />}
    {confirm && <Lightbox title={`${confirm.action.label} ${confirm.connection.name}?`} label={`${confirm.action.label} ${confirm.connection.name}?`} onClose={() => setConfirm(null)} phone="sheet">
      <p className="my-3 text-sm">Continue to settings to review the account and confirm the change there.</p>
      <div className="flex gap-3"><button className={BUTTON} onClick={() => setConfirm(null)}>Cancel</button><button className={BUTTON} onClick={() => { const href = confirm.action.href; setConfirm(null); navigate(href); }}>Continue to settings</button></div>
    </Lightbox>}
  </section>;
}
