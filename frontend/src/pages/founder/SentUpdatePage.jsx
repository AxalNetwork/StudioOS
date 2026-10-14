import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../ui';
import { shareUpdateApi } from '../../lib/api/shareUpdate.js';
import { ASK_LABELS, metricText, periodTitle } from './ShareUpdateSheet';

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

/** Where each module keeps the items a reply becomes, by Grow's and Raise's module names (D686 §5.8). */
export const MODULE_LINKS = {
  talent: ['Team expansion', '/grow/team-expansion'],
  customers: ['Distribution', '/grow/distribution'],
  partnerships: ['Partner network', '/grow/partner-network'],
  capital: ['Capital relationships', '/raise/capital-relationships'],
  // D664: a market reply is read under the market its ask links to.
  'market-expansion': ['Market expansion', '/grow/market-expansion'],
};

/** The module link, with the venture kept once the Worker returns `project_id` (S19-B). */
export function moduleHref(module, projectId) {
  const link = MODULE_LINKS[module];
  if (!link) return null;
  return projectId ? `${link[1]}?project_id=${encodeURIComponent(projectId)}` : link[1];
}

/** What a reply became, by the ask's kind. */
export const REPLY_PILL = { hire: 'Candidate', customer: 'Lead', market: 'Contact', partner: 'Partner', capital: 'Investor' };
export const PAGE_SIZE = 25;
export const SENT_FILTERS = [['all', 'All'], ['replies', 'Replies'], ['opened', 'Opened']];

const dayMon = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || String(v).length <= 10 ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};
const listOf = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "Update · October 2026" from the period, else the stored title. */
export function sentTitle(data) {
  return data.period_start && data.period_end ? `Update · ${periodTitle(data.period_start, data.period_end)}` : data.title;
}

/** "Sent 1 Nov to 3 investors, 2 team members and the Axal network (asks only)": only the audiences it went to. */
export function sentSub(data) {
  const when = dayMon(data.sent_at);
  const s = data.sent_to;
  if (!s) return when ? `Sent ${when}` : 'Sent';
  // The audiences chosen (`audience`, S19-B), else those it reached.
  const chose = (key) => (data.audience ? data.audience[key] !== false : s[key] > 0);
  const parts = [];
  if (chose('investors')) parts.push(`${s.investors} investor${s.investors === 1 ? '' : 's'}`);
  if (chose('team')) parts.push(`${s.team} team member${s.team === 1 ? '' : 's'}`);
  if (chose('network')) parts.push(`the Axal network (asks only${data.network_includes_metrics ? ', with metrics' : ''})`);
  return `Sent${when ? ` ${when}` : ''}${parts.length ? ` to ${listOf(parts)}` : ''}`;
}

const at = (v) => { const t = v ? Date.parse(String(v).replace(' ', 'T')) : NaN; return Number.isNaN(t) ? -Infinity : t; };

/**
 * The author's rows after search, filter, sort (latest first) and paging:
 * replies (with their ask) and recipients, `total` counted before paging.
 */
export function sentRows(data, { q = '', filter = 'all', page = 1 } = {}) {
  const needle = q.trim().toLowerCase();
  const has = (...v) => !needle || v.some((x) => String(x ?? '').toLowerCase().includes(needle));
  const replies = filter === 'opened' ? [] : (data.asks || []).flatMap((a) => (a.replies || [])
    .filter((r) => has(a.text, ASK_LABELS[a.kind], r.name, r.message)).map((r) => ({ ask: a, reply: r })))
    .sort((x, y) => at(y.reply.created_at) - at(x.reply.created_at));
  const recipients = filter === 'replies' ? [] : (data.recipients || [])
    .filter((r) => has(r.label, r.audience)).sort((x, y) => at(y.opened_at) - at(x.opened_at));
  const all = [...replies.map((x) => ({ type: 'reply', ...x })), ...recipients.map((r) => ({ type: 'recipient', recipient: r }))];
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const shown = all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  return { total, page: p, pages, from: total ? (p - 1) * PAGE_SIZE + 1 : 0, to: (p - 1) * PAGE_SIZE + shown.length,
    replies: shown.filter((x) => x.type === 'reply'), recipients: shown.filter((x) => x.type === 'recipient').map((x) => x.recipient) };
}

/** The network as one row: "12 in the Axal network · 5 opened · 1 replied" (counted, never named). */
export function networkRow(n) {
  if (!n || !(n.sent > 0)) return null;
  return `${n.sent} in the Axal network · ${n.opened ?? 0} opened · ${n.replied ?? 0} replied`;
}

/** A recipient's state: Not delivered (why), Replied, Opened d Mon, Not opened. */
export function recipientState(r) {
  if (r.not_delivered_reason) return `Not delivered · ${r.not_delivered_reason}`;
  if (r.replied) return 'Replied';
  return r.opened_at ? `Opened ${dayMon(r.opened_at) || String(r.opened_at).slice(0, 10)}` : 'Not opened';
}

const ROW = 'flex items-start justify-between gap-3 border-b border-axal-hairline py-2.5 text-[12.5px] dark:border-gray-800';
const LINK = 'text-[12.5px] font-bold text-violet-700 dark:text-violet-300';
const PRIMARY = 'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';
const CONTROL = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12px] dark:border-gray-700 dark:bg-gray-950';
const PILL = 'whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const VIOLET = `${PILL} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200`;
const AMBER = `${PILL} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200`;

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
export function SentUpdateView({ data, onReply = null, onAskAgain = null, initial = {} }) {
  const author = Array.isArray(data.recipients);
  const metrics = Array.isArray(data.metrics) ? data.metrics : null;
  const [q, setQ] = useState(initial.q || '');
  const [filter, setFilter] = useState(initial.filter || 'all');
  const [page, setPage] = useState(initial.page || 1);
  const view = useMemo(() => (author ? sentRows(data, { q, filter, page }) : null), [author, data, q, filter, page]);
  const searching = !!q.trim();
  return (
    <div className="space-y-4" data-testid={author ? 'sent-update-author' : 'sent-update-recipient'}>
      <div>
        <h1 className="text-2xl font-extrabold">{author ? sentTitle(data) : data.title}</h1>
        <p className="text-[12.5px] text-axal-muted">{author ? sentSub(data) : `Sent ${dayMon(data.sent_at) || String(data.sent_at || '').slice(0, 10)}`}</p>
      </div>
      {author && (
        <div className="flex flex-wrap items-center gap-2" data-testid="sent-controls">
          <input type="search" aria-label="Search replies" placeholder="Search replies…" className={`${CONTROL} min-w-[12rem] flex-1`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <div role="group" aria-label="Show" className="flex gap-1">{SENT_FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}
              className={`${CONTROL} ${filter === key ? 'border-violet-300 bg-violet-50 font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200' : ''}`}>{label}</button>
          ))}</div>
          <select aria-label="Sort" className={CONTROL} value="latest" onChange={() => {}}><option value="latest">Latest</option></select>
        </div>
      )}
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
      {(!author || filter !== 'opened') && <Card padding="lg">
        <h2 className="text-sm font-extrabold">{author ? 'Replies to asks' : 'Asks'}</h2>
        <ul>{(data.asks || []).map((a) => {
          const all = a.replies || [];
          const replies = author ? view.replies.filter((x) => x.ask.uid === a.uid).map((x) => x.reply) : [];
          // A capital ask linked to a call: its replies land on the call, so it has no noreply row here.
          const onCall = a.kind === 'capital' && !!a.link_ref;
          if (author && searching && replies.length === 0) return null;
          return (
            <li key={a.uid} className="border-b border-axal-hairline py-2.5 text-[12.5px] dark:border-gray-800" data-testid="sent-ask">
              <div className="font-semibold">{ASK_LABELS[a.kind]} · {a.text}</div>
              {a.kind==='capital'&&(a.link_ref?<Link className={LINK} to={(author?'/raise/calls/':'/round-calls/')+encodeURIComponent(a.link_ref)}>{author?'Open the call':'Open the private round call'}</Link>:a.link_reason&&<p className="text-axal-muted">{a.link_reason}</p>)}
              {replies.map((r) => {
                const href = moduleHref(r.landed_module, data.project_id);
                const when = dayMon(r.created_at);
                return (
                  <div key={r.uid} className={ROW} data-testid="sent-reply">
                    <span className="min-w-0">
                      <span className="block font-semibold">{a.kind === 'hire' ? `${r.name || 'Someone'} proposed a candidate` : (r.name || 'Someone')}{when ? ` · ${when}` : ''}</span>
                      <span className="block text-axal-muted">{r.message}</span>
                      {href ? <Link className={LINK} to={href}>Open in {MODULE_LINKS[r.landed_module][0]}</Link> : <span className="text-[11.5px] text-axal-muted">{r.landed_reason}</span>}
                    </span>
                    <span className={VIOLET}>{REPLY_PILL[a.kind] || 'Reply'}</span>
                  </div>
                );
              })}
              {author && all.length === 0 && !onCall && (
                <div className={ROW} data-testid="sent-noreply">
                  <span className="text-axal-muted">{a.can_ask_again ? 'No replies after 14 days.' : 'No replies yet.'}</span>
                  <span className="flex items-center gap-2">
                    {a.can_ask_again && <span className={AMBER}>No replies</span>}
                    {a.can_ask_again && onAskAgain && <button type="button" className={PRIMARY} onClick={() => onAskAgain(a.uid)}>Ask again</button>}
                  </span>
                </div>
              )}
              {!author && onReply && <ReplyForm ask={a} onReply={onReply} />}
            </li>
          );
        })}</ul>
        {author && <p className="mt-2 text-[11.5px] text-axal-faint">Each reply became an item in the module that asked, unless it says why not.</p>}
      </Card>}
      {author && filter !== 'replies' && (
        <Card padding="lg">
          <h2 className="text-sm font-extrabold">Opened</h2>
          <ul>{view.recipients.map((r, i) => (
            <li key={i} className={ROW} data-testid="sent-recipient">
              <span>{r.label || `${r.audience} recipient`}</span>
              <span className="text-axal-muted">{recipientState(r)}</span>
            </li>
          ))}
          {networkRow(data.network) && !q.trim() && <li className={ROW} data-testid="sent-network"><span>{networkRow(data.network)}</span></li>}</ul>
        </Card>
      )}
      {author && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-[12px] text-axal-muted" data-testid="sent-paging">
          <span>{view.total ? `${view.from}–${view.to} of ${view.total}` : searching ? 'Nothing matches this search.' : '0 of 0'}</span>
          {view.pages > 1 && <span className="flex gap-1">
            <button type="button" className={CONTROL} disabled={view.page <= 1} onClick={() => setPage(view.page - 1)} aria-label="Previous page">‹</button>
            <button type="button" className={CONTROL} disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)} aria-label="Next page">›</button>
          </span>}
        </nav>
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
