import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../ui';
import { shareUpdateApi } from '../../lib/api/shareUpdate.js';
import { ASK_LABELS, metricText } from './ShareUpdateSheet';

/**
 * `/updates/:uid` — a sent update (D654, #1466), to `Cycle Action`'s
 * `action=update` `page` and `noreply` views.
 *
 * THE AUTHOR sees each ask's replies, with the module each reply became an
 * item in, who the update was sent to and who opened it, and "Ask again" on an
 * ask with no reply after 14 days.
 *
 * A RECIPIENT sees what their audience may read — the Worker decides it: the
 * Axal network gets the asks only unless the founder included the metrics —
 * and answers an ask in place. Opening the page records the open.
 */

/** Where each module keeps the items a reply becomes. */
export const MODULE_LINKS = {
  talent: ['Talent', '/grow/talent'],
  customers: ['Customers', '/grow/customers'],
  partnerships: ['Partnerships', '/grow/partnerships'],
  capital: ['Capital relationships', '/raise/capital/pipeline'],
};

const ROW = 'flex items-start justify-between gap-3 border-b border-axal-hairline py-2.5 text-[12.5px] dark:border-gray-800';
const LINK = 'text-[12.5px] font-bold text-violet-700 dark:text-violet-300';
const PRIMARY = 'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';

function ReplyForm({ ask, onReply }) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await onReply(ask.uid, { message, email: email || undefined });
      setState({ ok: true, text: r?.landed_module ? 'Sent. It reached the company.' : 'Sent.' });
      setMessage('');
    } catch (err) { setState({ ok: false, text: err?.message || 'That reply did not send.' }); }
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-1.5">
      <textarea aria-label={`Reply to ${ASK_LABELS[ask.kind]}`} className="w-full rounded border border-axal-hairline bg-white p-2 dark:border-gray-700 dark:bg-gray-950" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your reply" />
      {(ask.kind !== 'market') && <input aria-label="Their email" className="w-full rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="The person's email (optional)" />}
      <button type="submit" className={PRIMARY} disabled={!message.trim()}>Reply</button>
      {state && <p role="status" className={`text-[12px] ${state.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{state.text}</p>}
    </form>
  );
}

/** The page body from props alone. `data` is the Worker's `/page` answer. */
export function SentUpdateView({ data, onReply = null, onAskAgain = null }) {
  const author = Array.isArray(data.recipients);
  const metrics = Array.isArray(data.metrics) ? data.metrics : null;
  const s = data.sent_to;
  return (
    <div className="space-y-4" data-testid={author ? 'sent-update-author' : 'sent-update-recipient'}>
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Update</div>
        <h1 className="text-2xl font-extrabold">{data.title}</h1>
        <p className="text-[12.5px] text-axal-muted">
          Sent {String(data.sent_at || '').slice(0, 10)}
          {author && s ? ` to ${s.investors} investors, ${s.team} team members and ${s.network} in the Axal network (asks only${data.network_includes_metrics ? ', with metrics' : ''})` : ''}
        </p>
      </div>
      {metrics && (
        <Card padding="lg">
          <h2 className="text-sm font-extrabold">Metrics</h2>
          {metrics.length === 0
            ? <p className="mt-1 text-[12.5px] text-axal-muted">No metric was recorded for this period, so the metrics were left out.</p>
            : <ul>{metrics.map((m) => { const t = metricText(m); return <li key={m.key} className={ROW}><span className="font-semibold">{m.label}</span><span className="text-axal-muted">{t.value}{t.value !== 'Not recorded' ? ` · ${t.detail}` : ''}</span></li>; })}</ul>}
        </Card>
      )}
      {Array.isArray(data.highlights) && (
        <Card padding="lg">
          <h2 className="text-sm font-extrabold">Highlights</h2>
          <ul>{data.highlights.map((l, i) => <li key={i} className={ROW}><span>{l.text}</span><span className="text-[11.5px] text-violet-700 dark:text-violet-300">Source: {l.source?.label}</span></li>)}</ul>
          {data.lowlights?.length > 0 && <><h2 className="mt-3 text-sm font-extrabold">Lowlights</h2>
            <ul>{data.lowlights.map((l, i) => <li key={i} className={ROW}><span>{l.text}</span><span className="text-[11.5px] text-violet-700 dark:text-violet-300">Source: {l.source?.label}</span></li>)}</ul></>}
        </Card>
      )}
      <Card padding="lg">
        <h2 className="text-sm font-extrabold">{author ? 'Replies to asks' : 'Asks'}</h2>
        <ul>{(data.asks || []).map((a) => {
          const replies = a.replies || [];
          return (
            <li key={a.uid} className="border-b border-axal-hairline py-2.5 text-[12.5px] dark:border-gray-800" data-testid="sent-ask">
              <div className="font-semibold">{ASK_LABELS[a.kind]} · {a.text}</div>
              {a.kind==='capital'&&(a.link_ref?<Link className={LINK} to={'/round-calls/'+encodeURIComponent(a.link_ref)}>Open the private round call</Link>:a.link_reason&&<p className="text-axal-muted">{a.link_reason}</p>)}
              {author && replies.map((r) => {
                const link = MODULE_LINKS[r.landed_module];
                return (
                  <div key={r.uid} className={ROW}>
                    <span>{r.name || 'Someone'}: {r.message}</span>
                    {link ? <Link className={LINK} to={link[1]}>Open in {link[0]}</Link> : <span className="text-[11.5px] text-axal-muted">{r.landed_reason}</span>}
                  </div>
                );
              })}
              {author && replies.length === 0 && (
                <div className={ROW}>
                  <span className="text-axal-muted">{a.can_ask_again ? 'No replies after 14 days.' : 'No replies yet.'}</span>
                  {a.can_ask_again && onAskAgain && <button type="button" className={PRIMARY} onClick={() => onAskAgain(a.uid)}>Ask again</button>}
                </div>
              )}
              {!author && onReply && <ReplyForm ask={a} onReply={onReply} />}
            </li>
          );
        })}</ul>
        {author && <p className="mt-2 text-[11.5px] text-axal-faint">Each reply became an item in the module that asked, unless it says why not.</p>}
      </Card>
      {author && (
        <Card padding="lg">
          <h2 className="text-sm font-extrabold">Opened</h2>
          <ul>{data.recipients.map((r, i) => (
            <li key={i} className={ROW}>
              <span>{r.label || `${r.audience} recipient`}</span>
              <span className="text-axal-muted">{r.not_delivered_reason || (r.opened_at ? `Opened ${String(r.opened_at).slice(0, 10)}` : 'Not opened')}</span>
            </li>
          ))}</ul>
        </Card>
      )}
    </div>
  );
}

export default function SentUpdatePage() {
  const { uid } = useParams();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const load = useCallback(async () => {
    setState({ loading: true, error: null, data: null });
    try { setState({ loading: false, error: null, data: await shareUpdateApi.page(uid) }); }
    catch (e) { setState({ loading: false, error: e?.status === 404 ? 'This update was not found.' : (e?.message || 'Unreadable'), data: null }); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  const askAgain = async (askUid) => { await shareUpdateApi.askAgain(askUid); load(); };
  return (
    <main className="mx-auto max-w-3xl p-4">
      {state.loading && <p className="text-[12.5px] text-axal-muted">Loading this update…</p>}
      {state.error && <Card padding="lg"><p className="text-[12.5px]">{state.error}</p></Card>}
      {state.data && <SentUpdateView data={state.data} onReply={shareUpdateApi.reply} onAskAgain={askAgain} />}
    </main>
  );
}
