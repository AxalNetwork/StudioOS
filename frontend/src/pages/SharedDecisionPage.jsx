/**
 * D6862 (#6862, D6021 V20 A–D, V23; owner answers Q1 B, Q2 A, Q3 A) — what a
 * named Operating Partner or investor reads at `/shared/decisions/:id`: the
 * one decision a founder shared with them, read-only, from
 * `GET /api/shared-decisions/:id`. The decision, its scope, date and author,
 * the evidence with directions and what counted, the commitments, the
 * reasoning only when the founder included it, and who shared it and when.
 * No edit, no other decision, no Eadwyn action. A superseded decision opens
 * with a banner and never shows the later decision (C). Refused (B) is one
 * page for every reason, and never says who else can see it. A failed read is
 * Unavailable with Try again (D).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Unrecorded, Unreadable } from '../ui/Honesty.jsx';
import { decisionSharesApi } from '../lib/api/decisionShares.js';
import { dayMonth } from './cycles/verdictEvidenceModel.js';

const WORD = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const REASON = { duplicate_source: 'Same source as another link', other_hypothesis: 'Evidence for another hypothesis', no_observed_result: 'No observed result' };
const STRENGTH = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const CARD = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const H2 = 'm-0 text-sm font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const year = (raw) => { const m = /^(\d{4})/.exec(String(raw ?? '')); return m ? m[1] : ''; };

/** D4586's coverage in named units, as the founder's record says it; null for a v1 decision. */
export function coverageWords(m) {
  if (!m) return null;
  return [plural(m.links, 'relationship', 'relationships'), plural(m.sources, 'source', 'sources'), plural(m.interviews, 'interview', 'interviews'),
    `${m.counted} of ${m.bar} counted: ${m.counted_supporting} supporting, ${m.counted_contradicting} contradicting`].join(' · ');
}

function Direction({ value }) {
  const against = value === 'contradicts';
  return <span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ' + (against
    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300')}>
    <span aria-hidden="true">{against ? '−' : '+'}</span>{against ? 'Contradicts' : 'Supports'}</span>;
}

function Message({ testid, chip, title, body, action }) {
  return <section className={CARD + ' max-w-[520px]'} data-testid={testid}>
    {chip}<b className="text-[15px] text-axal-ink dark:text-gray-100">{title}</b><p className={'m-0 text-[12.5px] leading-snug ' + MUTED}>{body}</p>{action}
  </section>;
}

export default function SharedDecisionPage() {
  const { id } = useParams();
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(() => {
    setRead({ status: 'loading' });
    decisionSharesApi.received(id).then((r) => setRead({ status: 'ready', d: r?.decision }),
      (e) => setRead({ status: Number(e?.status) === 403 || e?.code === 'not_shared' ? 'refused' : 'unavailable' }));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (read.status === 'loading') return <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6" aria-busy="true" data-testid="shared-decision">
    <span className="sr-only" role="status">Loading the shared decision</span>
    {[40, 70, 100, 100].map((w, i) => <span key={i} className="h-5 animate-pulse rounded bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}
  </main>;
  if (read.status === 'refused') return <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6" data-testid="shared-decision">
    <Message testid="shared-decision-refused"
      chip={<span className="self-start rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200"><span aria-hidden="true">🔒 </span>Refused</span>}
      title="This decision was shared with named people only."
      body="Ask the founder for access. The same page shows after a revoke; it never says who else can see it."
      action={<Link to="/" className="self-start rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">Back to Home</Link>} />
  </main>;
  if (read.status === 'unavailable' || !read.d) return <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6" data-testid="shared-decision">
    <Unreadable what="This decision" claim="Nothing is shown over a failed read." onRetry={load} size="block" />
  </main>;

  const d = read.d;
  const word = WORD[d.decision] ?? 'Decision';
  const scope = d.for === 'The venture' ? 'the venture' : d.for;
  const coverage = coverageWords(d.method);
  return <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-6" data-testid="shared-decision">
    <div role="note" className="flex gap-2.5 rounded-xl border border-axal-lavender-edge bg-axal-lavender p-3 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100">
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-axal-violet text-[11px] font-bold text-white dark:bg-violet-600">i</span>
      <div><b>Shared by {d.shared_by_name || 'the founder'} on {dayMonth(d.shared_at) ?? 'an unrecorded date'}.</b> Read-only. You can see this one decision and nothing else from {d.venture}’s Validate.</div>
    </div>
    {d.superseded_at && <div role="status" data-testid="shared-decision-superseded" className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <span aria-hidden="true">!</span><div><b>A later decision replaced this one on {dayMonth(d.superseded_at) ?? 'an unrecorded date'}.</b> This share covers only the decision below.</div>
    </div>}
    <header className="flex flex-col gap-1.5">
      <nav aria-label="Breadcrumb" className={'text-[11.5px] ' + MUTED}>Shared with you · {d.venture} · {word}</nav>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[11px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300">{word}</span>
        <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200">{d.superseded_at ? 'Superseded' : 'Current'}</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Given</span>
      </div>
      <h1 className="m-0 text-[22px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{d.venture} · {word} · {scope}</h1>
      <p className={'m-0 text-[12.5px] ' + MUTED}>Recorded {dayMonth(d.decided_at) ?? 'on an unrecorded date'} {year(d.decided_at)}{d.decided_by_name ? ` by ${d.decided_by_name}` : ''} · rests on {plural(d.evidence_count, 'piece of evidence', 'pieces of evidence')}</p>
    </header>
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <section className={CARD}>
          <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className={MUTED}>Decision</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{word}</dd>
            <dt className={MUTED}>For</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{d.for}</dd>
            <dt className={MUTED}>Evidence</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{plural(d.evidence_count, 'item', 'items')}</dd>
            <dt className={MUTED}>Counted{d.method ? ` (methodology v${d.method.methodology_version})` : ''}</dt>
            <dd className="m-0 font-mono text-[12px] font-semibold text-axal-ink dark:text-gray-100">{coverage ?? <Unrecorded reason="Recorded under methodology v1, which counted each checked link." reasonVisible />}</dd>
          </dl>
        </section>
        <section className={CARD}>
          <div className="flex items-baseline justify-between gap-2"><h2 className={H2}>Reasoning</h2>{d.reasoning_included && <span className={'text-[11.5px] ' + MUTED}>included by {d.shared_by_name || 'the founder'}</span>}</div>
          {d.reasoning_included ? (d.reasoning ? <p className="m-0 whitespace-pre-line text-[13px] leading-relaxed text-axal-ink dark:text-gray-200">{d.reasoning}</p> : <Unrecorded />)
            : <p className={'m-0 text-[12.5px] ' + MUTED}>Not part of this share.</p>}
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <section className={CARD}><h2 className={H2}>Commitments</h2>
          {d.commitments.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{d.commitments.map((m, i) => <li key={i} className="text-[12.5px]">
            <b className="block text-axal-ink dark:text-gray-100">{m.text}</b>
            <span className={MUTED}>{m.done_at ? `Done ${dayMonth(m.done_at) ?? ''}` : <>{m.owner_name ?? <Unrecorded>Owner not recorded</Unrecorded>} · {m.due_date ? `due ${dayMonth(m.due_date)}` : <Unrecorded>Due not recorded</Unrecorded>}</>}</span>
          </li>)}</ul> : <p className={'m-0 text-[12.5px] ' + MUTED}>No commitments yet.</p>}
        </section>
        <section className={CARD}><span className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400">Not part of this share</span>
          <p className={'m-0 text-[12.5px] leading-snug ' + MUTED}>Other decisions, interviews and hypotheses stay with the founder. Nothing here can be edited.</p></section>
      </div>
    </div>
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className={H2}>Evidence it rests on</h2>
        <span className={'text-[11.5px] ' + MUTED}>{d.evidence.length} counted · {d.excluded.length} checked, not counted</span></div>
      {d.evidence.length + d.excluded.length === 0 ? <p className={'m-0 text-[12.5px] ' + MUTED}>No evidence checked.</p>
        : <ul className="m-0 flex list-none flex-col p-0">
          {d.evidence.map((e, i) => <li key={`e${i}`} className="grid grid-cols-1 gap-1 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3">
            <b className="min-w-0 break-words text-axal-ink dark:text-gray-100">{e.label}</b>
            <span>{STRENGTH[e.strength] ?? <Unrecorded>Strength not recorded</Unrecorded>}</span>
            <span className={'font-mono ' + MUTED}>{dayMonth(e.on_date) ?? ''}</span>
            <span className="flex items-center gap-2"><Direction value={e.direction} /><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">Counted</span></span>
          </li>)}
          {d.excluded.map((e, i) => <li key={`x${i}`} className="grid grid-cols-1 gap-1 border-b border-axal-ground py-2 text-[12.5px] opacity-80 last:border-b-0 dark:border-gray-800 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
            <b className="min-w-0 break-words text-axal-ink dark:text-gray-100">{e.label}</b>
            <span className="flex items-center gap-2"><Direction value={e.direction} /><span className={'text-[11.5px] ' + MUTED}>{REASON[e.reason] ?? 'Not counted'}</span></span>
          </li>)}
        </ul>}
    </section>
  </main>;
}
