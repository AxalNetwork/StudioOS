import React, { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { reportError } from '../../lib/log';
import { WorkerRail } from '../../ui';
import RailFrame from '../../ui/RailFrame';
import { CycleHeader } from '../cycles/CycleOverview';
import { MODULES } from '../cycles/modules';
import RoundCallSheet, { CALL_FIELDS, shortDate } from './RoundCallSheet';
import { useCallRead, CallReadState, callButton, callInput, moneyCents } from './roundCallParts';

/**
 * D686 §5.6 (#1598), §3.1 item 14 — the founder's view of a Call for Capital,
 * inside the Raise shell at `/raise/calls/:uid`: Raise's header and tabs, the
 * rail, and the call's responses with search, filters and paging. An
 * investor or counsel opening this address is sent to `/round-calls/:uid`,
 * where their own views are; a founder there is sent here.
 *
 * NOTHING IS INVENTED. A matching investor stays nameless until they respond.
 * A commitment's date is drawn only when the Worker stores one (S19-A's
 * `committed_at`); until then the row says what was committed, not when.
 */
export const PAGE_SIZE = 25;
export const FILTERS = [['all', 'All'], ['committed', 'Committed'], ['data_room', 'Data room'], ['opened', 'Opened']];
const INSTRUMENTS = { safe: 'SAFE', equity: 'Equity', convertible_note: 'Convertible note' };
const ghost = callButton;
const danger = 'rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-300';
const pill = 'rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const PILLS = {
  committed: `${pill} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200`,
  data_room: `${pill} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200`,
  opened: `${pill} border-axal-hairline text-axal-muted`,
  none: `${pill} border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400`,
};

/** A recipient's furthest response, as its row reads it. */
export function responseOf(r) {
  if (r.commitment_cents != null) {
    const when = CALL_FIELDS.committed_at || r.committed_at ? shortDate(r.committed_at) : null;
    return { kind: 'committed', text: `Committed ${moneyCents(r.commitment_cents)}${when ? ` · ${when}` : ''}`, pill: 'Committed' };
  }
  if (r.data_room_requested_at) return { kind: 'data_room', text: `Asked for the data room · ${shortDate(r.data_room_requested_at) || 'Not recorded'}`, pill: 'Data room' };
  if (r.opened_at) return { kind: 'opened', text: `Opened · ${shortDate(r.opened_at) || 'Not recorded'}`, pill: 'Opened' };
  return { kind: 'none', text: 'Not opened yet', pill: 'Not opened' };
}

/** Who a recipient is: a matching investor's name is hidden until they respond. */
export const whoOf = (r) => (r.name ? `${r.name} · ${r.email}` : 'Matching investor · name hidden until they respond');

/** When a recipient last did something: the latest of their recorded times, or null. */
export function lastActivity(r) {
  const times = [r.committed_at, r.responded_at, r.data_room_requested_at, r.opened_at].filter(Boolean).map((t) => String(t).replace(' ', 'T'));
  return times.length ? times.sort().at(-1) : null;
}

export const SORTS = [['latest', 'Latest'], ['furthest', 'Furthest along']];

/** The rows the controls leave: latest activity first (no activity last), or furthest along. */
export function visibleRows(recipients, { q = '', filter = 'all', sort = 'latest' } = {}) {
  const needle = q.trim().toLowerCase();
  const latest = (r) => r.commitment_cents != null ? 3 : r.data_room_requested_at ? 2 : r.opened_at ? 1 : 0;
  return (recipients || [])
    .filter((r) => filter === 'all'
      || (filter === 'committed' && r.commitment_cents != null)
      || (filter === 'data_room' && !!r.data_room_requested_at)
      || (filter === 'opened' && !!r.opened_at))
    .filter((r) => !needle || `${r.name || ''} ${r.email || ''} ${responseOf(r).text}`.toLowerCase().includes(needle))
    .map((r, i) => ({ r, i }))
    .sort(sort === 'furthest'
      ? (a, b) => latest(b.r) - latest(a.r) || a.i - b.i
      : (a, b) => {
        const x = lastActivity(a.r); const y = lastActivity(b.r);
        if (x === y) return a.i - b.i;
        if (!x) return 1;
        if (!y) return -1;
        return x < y ? 1 : -1;
      })
    .map(({ r }) => r);
}

/** The banner a call that takes no responses shows, or null while it is open. */
export function callBanner(call, progress, today = new Date().toISOString().slice(0, 10)) {
  if (call.state === 'closed') return `This call closed on ${shortDate(call.closed_at) || 'Not recorded'} with ${moneyCents(progress.committed_cents)} committed. It is read-only.`;
  if (call.state === 'sent' && call.target_close < today) return `This call closed on ${shortDate(call.target_close) || 'Not recorded'} with ${moneyCents(progress.committed_cents)} committed. It is read-only.`;
  if (call.state === 'awaiting_counsel') return 'Responses are paused until counsel approves the extended terms. This call is read-only.';
  return null;
}

export function RaiseCallView({ state: s, on }) {
  const d = s.data; const c = d.call; const p = d.progress;
  const rows = useMemo(() => visibleRows(d.recipients, { q: s.q, filter: s.filter, sort: s.sort }), [d.recipients, s.q, s.filter, s.sort]);
  const page = rows.slice(s.page * PAGE_SIZE, s.page * PAGE_SIZE + PAGE_SIZE);
  const banner = callBanner(c, p);
  const open = c.state === 'sent' && !d.read_only;
  const sub = [c.sent_at ? `Sent ${shortDate(c.sent_at)}` : 'Not sent', `closes ${shortDate(c.target_close) || 'Not recorded'}`, INSTRUMENTS[c.instrument] || c.instrument, c.terms].filter(Boolean).join(' · ');
  return <div className="space-y-4" data-testid="raise-call-page">
    <p className="text-sm text-axal-muted">{sub}</p>
    {banner && <p role="status" className="rounded-lg border border-axal-hairline bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900">{banner}</p>}
    {banner && c.state !== 'awaiting_counsel' && <button type="button" className={ghost} onClick={on.newCall}>Open a new call</button>}
    <section className="space-y-3 rounded-xl border border-axal-hairline p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Committed {moneyCents(p.committed_cents)} of {moneyCents(p.target_cents)}</h2>
        <select aria-label="Sort responses" className={`${callInput} w-auto`} value={s.sort} onChange={(e) => on.sort(e.target.value)}>
          {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search responses" placeholder="Search responses…" className={`${callInput} max-w-xs`} value={s.q} onChange={(e) => on.q(e.target.value)} />
        <div role="group" aria-label="Filter responses" className="flex flex-wrap gap-1">{FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={s.filter === key} className={`${ghost} ${s.filter === key ? 'border-violet-700 text-violet-700 dark:border-violet-300 dark:text-violet-300' : ''}`} onClick={() => on.filter(key)}>{label}</button>))}</div>
      </div>
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800">{page.map((r, i) => {
        const res = responseOf(r);
        return <li key={r.investor_user_id || `match-${s.page}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div className="min-w-0"><p className="font-semibold">{whoOf(r)}</p><p className="text-axal-muted">{res.text}</p></div>
          <span className={PILLS[res.kind]}>{res.pill}</span></li>;
      })}</ul>
      {!d.recipients.length ? <p>No recipients are recorded yet.</p> : !rows.length && <p>No response matches.</p>}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{rows.length ? s.page * PAGE_SIZE + 1 : 0}–{Math.min((s.page + 1) * PAGE_SIZE, rows.length)} of {rows.length}</span>
        <div className="flex gap-2"><button type="button" className={ghost} disabled={s.page === 0} onClick={() => on.page(s.page - 1)}>Previous</button>
          <button type="button" className={ghost} disabled={(s.page + 1) * PAGE_SIZE >= rows.length} onClick={() => on.page(s.page + 1)}>Next</button></div>
      </div>
      <p className="text-xs text-axal-muted">Every response is also an entry in Capital relationships.</p>
    </section>
    <section className="space-y-3"><h2 className="font-semibold">Questions</h2>{d.questions.length ? d.questions.map((q) => (
      <article key={q.uid} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800"><p>{q.question}</p>{q.name && <p className="text-xs text-axal-muted">{q.name} · {shortDate(q.asked_at) || 'Not recorded'}</p>}
        {q.answer ? <p><span className={PILLS.opened}>Answered</span> {q.answer}</p> : <p><span className={PILLS.none}>Unanswered</span></p>}
        {q.update_uid && <Link className="underline" to={`/updates/${q.update_uid}`}>Reply on the source update</Link>}
        {!q.answer && !d.read_only && !q.update_uid && <><label className="block">Answer<textarea className={callInput} value={s.answers[q.uid] || ''} maxLength={4000} onChange={(e) => on.answerValue(q.uid, e.target.value)} /></label>
          <button type="button" className={ghost} disabled={s.busy || !s.answers[q.uid]?.trim()} onClick={() => on.answer(q.uid)}>Answer</button></>}
      </article>)) : <p>No questions are recorded.</p>}</section>
    {s.error && <p role="alert" className="text-red-700 dark:text-red-300">{s.error}</p>}{s.message && <p role="status">{s.message}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800">
      <span className="text-xs text-axal-muted">Received {p.received} · opened {p.opened} · data room {p.data_room_requests} · committed {p.commitments}</span>
      {open && <div className="flex flex-wrap items-center gap-2">
        {s.extending && <input type="date" aria-label="New target close" className={callInput} value={s.target} onChange={(e) => on.target(e.target.value)} />}
        <button type="button" className={ghost} disabled={s.busy || (s.extending && !s.target)} onClick={on.extend}>Extend the date</button>
        <button type="button" className={danger} disabled={s.busy} onClick={on.close}>Close the call</button></div>}
    </footer>
  </div>;
}

export default function RaiseCallPage() {
  const { uid } = useParams();
  const read = useCallRead(() => roundCallsApi.page(uid), [uid]);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState('all'); const [page, setPage] = useState(0); const [sort, setSort] = useState('latest');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [answers, setAnswers] = useState({}); const [target, setTarget] = useState(''); const [extending, setExtending] = useState(false); const [newCall, setNewCall] = useState(false);
  async function perform(action, label) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(label); read.retry(); }
    catch (e) { reportError('round-calls:manage', e); setError(e.status >= 500 || !e.status ? 'The action could not be confirmed. Check the call before retrying.' : 'This change was refused. Check the call’s current state.'); }
    finally { setBusy(false); }
  }
  const on = {
    q: (v) => { setQ(v); setPage(0); }, filter: (v) => { setFilter(v); setPage(0); }, sort: (v) => { setSort(v); setPage(0); }, page: setPage, target: setTarget,
    answerValue: (key, value) => setAnswers((a) => ({ ...a, [key]: value })),
    answer: (key) => perform(() => roundCallsApi.answer(uid, key, answers[key]), 'Answer recorded.'),
    extend: () => (extending ? perform(() => roundCallsApi.manage(uid, { action: 'extend', target_close: target }), 'Target close extended. Responses are paused until counsel approves the extended terms.') : setExtending(true)),
    close: () => perform(() => roundCallsApi.manage(uid, { action: 'close' }), 'Call closed. It is now read-only.'),
    newCall: () => setNewCall(true),
  };
  const d = read.data;
  if (d && d.viewer !== 'founder') return <Navigate to={`/round-calls/${encodeURIComponent(uid)}`} replace />;
  const cards = MODULES.raise.map((m) => ({ slug: m.slug, name: m.name }));
  const rail = <WorkerRail workspace="Raise" role="founder" stance="Evidence-led view" coverage={[d ? `Venture #${d.call.project_id} selected` : 'No venture selected']} footer="Traceable surface · no unsupported automated actions" />;
  return (
    <RailFrame rail={rail} data-testid="raise-call-route">
      <main className="space-y-4 p-5 text-axal-ink dark:text-gray-100">
        <CycleHeader cycle="raise" cards={cards} active="capital-relationships" title={d ? `Call for Capital · ${d.call.name}` : 'Call for Capital'}
          search={d ? `?project_id=${d.call.project_id}` : ''} />
        {read.error?.status === 403 ? <p role="alert">The Worker refused this call: {read.error.message || 'you cannot open it.'}</p>
          : <CallReadState read={read}>{d && <RaiseCallView state={{ data: d, q, filter, sort, page, busy, error, message, answers, target, extending }} on={on} />}</CallReadState>}
        {newCall && d && <RoundCallSheet projectId={d.call.project_id} onClose={() => { setNewCall(false); read.retry(); }} />}
      </main>
    </RailFrame>
  );
}
