/** D4489 — inspect a plan; PublishSheet owns every send and founder check. */
import { useState } from 'react';
import Sheet from '../../../ui/Sheet';
import PublishSheet from '../publish/PublishSheet';
import { FOUNDER_REASON, pieceStatus } from './calendarModel';
export default function PieceSheet({ piece, projectId, onClose, onEdit, canPublish, destinations, destinationsState, onTime }) {
  const [publish, setPublish] = useState(false); const [time, setTime] = useState(piece.planned_at_time || ''); const [error, setError] = useState('');
  const status = pieceStatus(piece);
  return <><Sheet width={480} title={piece.title} label={piece.title} onClose={onClose} sub={`Planned piece · ${piece.channel_name || 'No channel'}`} footer={<div className="flex gap-2 p-4">
    {piece.source !== 'notion' && <button onClick={onEdit}>Edit</button>}
    <button disabled={!canPublish || destinationsState !== 'ready' || !destinations.length} title={!canPublish ? FOUNDER_REASON : undefined} onClick={() => setPublish(true)}>Publish to…</button>
  </div>}><div className="space-y-4 p-5"><span className={status.className}>{status.label}</span>
    <p>You press Send for each post.</p>
    {destinationsState === 'ready' && canPublish === false && <p>{FOUNDER_REASON}<button disabled title={FOUNDER_REASON}>Send</button></p>}
    <dl><dt>Planned for</dt><dd>{piece.planned_on || 'Not recorded'} {piece.planned_at_time || ''}</dd><dt>Status</dt><dd>{status.label}</dd><dt>Channel</dt><dd>{piece.channel_name || 'Not recorded'}</dd><dt>URL</dt><dd>{piece.url || 'Not recorded: added once it is published'}</dd></dl>
    {(piece.campaigns || []).map((c) => <p key={c.uid}>{c.name} · <code>{c.utm_campaign || 'UTM not recorded'}</code></p>)}
    <p>Copy and images are added in Publish to… before you confirm each post.</p>
    {piece.source === 'notion' ? <p>Edit this piece in Notion.</p> : <label>Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /><button onClick={async () => { try { await onTime(time || null); setError(''); } catch { setError('The time could not be saved. Try again.'); } }}>Save time</button></label>}
    {error && <p role="alert">{error}</p>}
    {destinationsState === 'error' && <p>Unreadable: publish destinations could not be read.</p>}
    {destinationsState === 'ready' && !destinations.length && <div><p>No place to publish to yet.</p><p>Connect one first. Nothing is posted until you confirm it.</p><a href={`/grow/distribution/channels?project_id=${encodeURIComponent(projectId)}`}>Open Channels</a></div>}
  </div></Sheet>{publish && <PublishSheet projectId={projectId} module="distribution" onClose={() => setPublish(false)} />}</>;
}
