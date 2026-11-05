/** D4489 — inspect a plan; PublishSheet owns every send and founder check. */
import { useEffect, useState } from 'react';
import Sheet from '../../../ui/Sheet';
import PublishSheet from '../publish/PublishSheet';
import DistributionAskIntent from './DistributionAskIntent';
import { AskButtonView } from '../../../ui/AskButton';
import PostPreview from './PostPreview';
import { FOUNDER_REASON, pieceStatus } from './calendarModel';
export default function PieceSheet({ piece, projectId, onClose, onEdit, canPublish, destinations, destinationsState, onTime, canEdit = false }) {
  const [publish, setPublish] = useState(false); const [time, setTime] = useState(piece.planned_at_time || ''); const [error, setError] = useState('');
  const [copy, setCopy] = useState(''); const [asking, setAsking] = useState(false); const [image, setImage] = useState(null);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  const attach = (file) => { if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Choose a PNG, JPEG or WebP image up to 10 MB.'); return; } setError(''); setImage(URL.createObjectURL(file)); };
  const status = pieceStatus(piece);
  return <><Sheet width={480} title={piece.title} label={piece.title} onClose={onClose} sub={`Planned piece · ${piece.channel_name || 'No channel'}`} footer={<div className="flex gap-2 p-4">
    {canEdit && piece.source !== 'notion' && <button onClick={onEdit}>Edit</button>}
    <button disabled={!canPublish || destinationsState !== 'ready' || !destinations.some(d => d.on) || !!image} title={!canPublish ? FOUNDER_REASON : undefined} onClick={() => setPublish(true)}>Publish to…</button>
  </div>}><div className="space-y-4 p-5 text-gray-900 dark:text-gray-100 [&_button]:min-h-[44px] [&_input]:min-h-[44px]"><span className={status.className}>{status.label}</span>
    <p>You press Send for each post.</p>
    {destinationsState === 'ready' && canPublish === false && <p>{FOUNDER_REASON}<button disabled title={FOUNDER_REASON}>Send</button></p>}
    <dl><dt>Planned for</dt><dd>{piece.planned_on || 'Not recorded'} {piece.planned_at_time || ''}</dd><dt>Status</dt><dd>{status.label}</dd><dt>Channel</dt><dd>{piece.channel_name || 'Not recorded'}</dd><dt>URL</dt><dd>{piece.url || 'Not recorded: added once it is published'}</dd></dl>
    {(piece.campaigns || []).map((c) => <p key={c.uid}>{c.name} · <code>{c.utm_campaign || 'UTM not recorded'}</code></p>)}
    <label className="block">Copy<textarea className="mt-1 w-full rounded border bg-white p-2 dark:border-gray-700 dark:bg-gray-900" value={copy} onChange={e => setCopy(e.target.value)} /></label>
    {!copy.trim() && canEdit && <AskButtonView onClick={() => setAsking(true)} />}
    <label className="block rounded-xl border border-dashed p-4 dark:border-gray-700" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); attach(e.dataTransfer.files[0]); }}>Add an image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => attach(e.target.files[0])} /></label>
    <p className="text-sm text-gray-500 dark:text-gray-400">Copy and image previews stay in this sheet until it closes. Copy passes to Publish to… for your review.</p>
    {image && <p role="status">Image publishing is not available yet. Remove the preview image to publish text.<button onClick={() => setImage(null)}>Remove image</button></p>}
    <PostPreview platform={piece.channel_name || piece.channel_kind} text={copy} image={image} />
    {!canEdit ? <p>You can read this plan but not change it.</p> : piece.source === 'notion' ? <p>Edit this piece in Notion.</p> : <label>Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /><button onClick={async () => { try { await onTime(time || null); setError(''); } catch { setError('The time could not be saved. Try again.'); } }}>Save time</button></label>}
    {error && <p role="alert">{error}</p>}
    {destinationsState === 'error' && <p>Unreadable: publish destinations could not be read.</p>}
    {destinationsState === 'ready' && !destinations.length && <div><p>No place to publish to yet.</p><p>Connect one first. Nothing is posted until you confirm it.</p><a href={`/grow/distribution/channels?project_id=${encodeURIComponent(projectId)}`}>Open Channels</a></div>}
  </div></Sheet>{publish && <PublishSheet initialText={copy} projectId={projectId} module="distribution" onClose={() => setPublish(false)} />}
  {asking && <DistributionAskIntent projectId={projectId} campaignUid={piece.campaigns?.[0]?.uid} kinds={['post']} onClose={() => setAsking(false)} onAccept={rows => { const p = rows[0]; const v = p?.decided_payload || p?.payload; if (typeof v?.text === 'string') setCopy(v.text); setAsking(false); }} />}</>;
}
