// D1614 W7 part 2 (#4419): the item's activity and Team-only comment mentions.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { workAdapter } from './workAdapter.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, MUTED, HonestBlock } from '../team/teamUi.jsx';

export const taskCost = (cost) => cost?.available === true && Number.isFinite(cost.value_microusd)
  ? `$${(cost.value_microusd / 1000000).toFixed(6)}` : 'Not recorded';
export const reviewError = (e) => {
  const code = e?.code || e?.data?.error;
  return code === 'comment_required' ? 'Add a comment explaining the changes needed.'
    : code === 'not_in_review' ? 'This item is no longer in review. Refresh to see its current state.'
      : e?.message || 'The change could not be saved. Try again.';
};

export default function TaskTimeline({ projectId, number, viewer, onRun, adapter = workAdapter }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [team, setTeam] = useState(null);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState([]);
  const [editing, setEditing] = useState(null);
  const commentRef = useRef(null);
  useEffect(() => { if (editing) commentRef.current?.focus?.(); }, [editing]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const r = await adapter.timeline(projectId, number); setRead(r.available ? { status:'ready', data:r.data } : { status:'off', reason:r.reason }); }
    catch { setRead({ status:'error' }); }
  }, [adapter, projectId, number]);
  useEffect(() => { let live = true; setRead({ status:'loading' });
    adapter.timeline(projectId, number).then((r) => { if (live) setRead(r.available ? { status:'ready', data:r.data } : { status:'off', reason:r.reason }); }, () => { if (live) setRead({ status:'error' }); });
    adapter.assignable(projectId).then((r) => { if (live) setTeam(r.available ? r.data?.team || [] : null); }, () => { if (live) setTeam(null); });
    return () => { live = false; };
  }, [adapter, projectId, number]);
  const write = async (action) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const r = await action(); if (!r.available) { setError(r.reason); return; } setBody(''); setEditing(null); setMentions([]); await load(); }
    catch (e) { setError(reviewError(e)); } finally { setBusy(false); }
  };
  if (read.status === 'off') return <HonestBlock>{read.reason}</HonestBlock>;
  if (read.status === 'error') return <HonestBlock role="alert">Activity could not be read. <button type="button" onClick={load}>Try again</button></HonestBlock>;
  return <section aria-label="Activity" className="mt-4 space-y-3" data-testid="task-timeline">
    <h3 className="font-semibold">Activity</h3>
    {read.status === 'loading' ? <p className={MUTED}>Reading activity…</p> : <>
      <ol className="wk-feed-rows">{(read.data?.entries || []).map((entry, i) => {
        const c = entry.comment, actor = c?.author || entry.actor;
        const run = c?.run || entry.run || (entry.type === 'linked_proposal' ? entry.proposal?.uid : null);
        return <li key={c?.uid || `${entry.type}-${i}`}>
          <p><b>{actor?.name || 'Name not recorded'}</b> · <time>{entry.at}</time></p>
          {c ? <p className="whitespace-pre-wrap break-words">{c.deleted ? 'Comment deleted' : c.body}</p>
            : <p>{String(entry.type).replaceAll('_',' ')}{entry.to ? ` · ${String(entry.to).replaceAll('_',' ')}` : ''}</p>}
          {actor?.kind === 'agent' && <p>Cost: {taskCost(c?.cost || entry.cost)} {run && <button type="button" className={BTN_TEXT} onClick={() => onRun?.(run)}>View run ›</button>}</p>}
          {c && !c.deleted && c.author?.kind === 'person' && c.author.uid === viewer?.user_uid && <span className="flex gap-2">
            <button type="button" disabled={busy} className={BTN_TEXT} onClick={() => { setEditing(c.uid); setBody(c.body); setMentions([]); }}>Edit comment</button>
            <button type="button" disabled={busy} className={BTN_TEXT} onClick={() => write(() => adapter.deleteComment(projectId,c.uid))}>Delete comment</button>
          </span>}
        </li>;
      })}</ol>
      {!read.data?.entries?.length && <p className={MUTED}>No activity yet.</p>}
      {read.data?.truncated && <p className={MUTED}>Only the first 1,000 entries from each source are shown.</p>}
    </>}
    <form onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; write(() => editing
      ? adapter.editComment(projectId, editing, { body:body.trim() })
      : adapter.comment(projectId,number,{ body:body.trim(), mentions })); }}>
      <p role="status">{editing ? 'Editing your comment.' : ''}</p>
      <label className="block">{editing ? 'Edit your comment' : 'Comment'}<textarea ref={commentRef} aria-label={editing ? 'Edit your comment' : 'Comment'} value={body} maxLength={20000} rows={3} className="block w-full rounded border p-2 dark:bg-gray-900 dark:border-gray-700" onChange={(e) => setBody(e.target.value)} /></label>
      {!editing && <fieldset className="my-2"><legend>@ Mention someone on this Team</legend>
        {team === null ? <p className={MUTED}>Unreadable: Team mentions are unavailable.</p> : team.map((person) => <label key={`${person.kind}:${person.uid}`} className="mr-3 inline-flex gap-1">
          <input type="checkbox" checked={mentions.some((m) => m.uid === person.uid && m.kind === person.kind)} onChange={(e) => setMentions((old) => e.target.checked ? [...old,{kind:person.kind,uid:person.uid}] : old.filter((m) => m.uid !== person.uid || m.kind !== person.kind))} />{person.name || 'Name not recorded'}
        </label>)}
      </fieldset>}
      <button className={BTN_PRIMARY} disabled={busy || !body.trim()} type="submit">{editing ? 'Save comment' : 'Comment'}</button>
      {editing && <button type="button" className={BTN_SECONDARY} onClick={() => { setEditing(null); setBody(''); }}>Cancel edit</button>}
    </form>
    {error && <p role="alert">{error}</p>}
  </section>;
}
