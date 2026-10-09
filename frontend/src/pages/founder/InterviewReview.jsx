import React, { useState } from 'react';

/**
 * The review step of an interview session (D660 part 2, #1473), to
 * `design/incoming/Interview Session.dc.html`, step `review`, on the response
 * shapes of #1494 (D658 part 2).
 *
 * NOT MOUNTED YET. These components take data as props and call nothing: the
 * routes they render (`GET …/sessions/:id/placements`, `POST …/structure`,
 * `POST …/ask`, the structuring receipt) are in #1494, and the drift test
 * refuses a client method whose route is not on main (D527). When #1494
 * merges, the client methods are added and `InterviewSessionPage` mounts this.
 *
 * WHAT EADWYN SAYS IS A PROPOSAL. Each placement names its module, quotes the
 * passage it came from, and waits for the founder: accept, edit then accept,
 * or discard. A kind with no store yet (a market fact) says so and cannot be
 * accepted. An answer from "Ask the transcript" is shown only with the
 * passages it cites; the Worker refuses an answer that cites nothing, and the
 * page shows that refusal, not an answer.
 */

export const MODULE_LABELS = {
  problem_discovery: 'Problem discovery',
  customer_research: 'Customer research',
  ideal_customer_profile: 'Ideal customer profile',
  demand_signals: 'Demand signals',
  experiments: 'Experiments',
  market_intelligence: 'Market intelligence',
  other: 'Other',
};

export const MODULE_ORDER = Object.keys(MODULE_LABELS);

const SEVERITY = { severe: 'Severe', real: 'Real', mild: 'Mild' };
const FIT = { strong: 'Strong fit', partial: 'Partial fit', none: 'Not a fit' };
const DEMAND = { need_to_have: 'Need to have', would_pay: 'Would pay', loi: 'Letter of intent', pre_sale: 'Pre-sale' };
const STRENGTH = { anecdote: 'Anecdote', pattern: 'Pattern', measured: 'Measured' };
const STEP_LABELS = { structured: 'Structured', re_structured: 'Re-structured', asked: 'Asked' };
export const STRUCTURING_STEPS = new Set(Object.keys(STEP_LABELS));

/** A placement's payload, as one line a founder reads. Unknown shapes say so. */
export function placementText(p) {
  const v = p?.edited_payload || p?.payload || {};
  switch (p?.kind) {
    case 'pain_severity': return `“${v.phrase}” · ${SEVERITY[v.severity] || 'Severity not recorded'}`;
    case 'icp_fit': return `${FIT[v.fit] || 'Fit not recorded'} · ${v.reason || ''}`.replace(/ · $/, '');
    case 'segment': return `Segment: ${v.name}`;
    case 'demand_signal': return `${DEMAND[v.signal] || 'Signal not recorded'}${v.detail ? ` · ${v.detail}` : ''}`;
    case 'evidence': return `${v.direction === 'refutes' ? 'Refutes' : 'Supports'} hypothesis #${v.hypothesis_id} through pain group #${v.pain_group_id} · ${STRENGTH[v.strength] || 'Strength not recorded'}`;
    case 'competitor_mention': return `${v.name}${v.context ? ` · ${v.context}` : ''}`;
    case 'market_fact': return `${v.fact} · source: ${v.source}`;
    default: return 'Unreadable: this placement has a shape the page does not know.';
  }
}

/** ms → m:ss, for a cited span. */
export function spanLabel(from, to) {
  const f = (ms) => { const t = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  return Number.isFinite(from) && Number.isFinite(to) ? `${f(from)}–${f(to)}` : 'Span not recorded';
}

/** The latest run's placements, grouped by module in the canvas's order. */
export function groupByModule(read) {
  const runs = read?.runs || [];
  const latest = runs[runs.length - 1];
  const groups = new Map();
  for (const pl of latest?.placements || []) {
    const m = MODULE_LABELS[pl.module] ? pl.module : 'other';
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(pl);
  }
  return MODULE_ORDER.filter((m) => groups.has(m)).map((m) => ({ module: m, label: MODULE_LABELS[m], placements: groups.get(m) }));
}

/**
 * What a refused call means for the page. A budget refusal (D640: 503 with a
 * `budget_*` refusal) is its own state, in the budget's own words.
 */
export function refusalKind(err) {
  const refusal = err?.data?.refusal;
  if (typeof refusal === 'string' && refusal.startsWith('budget_')) return 'budget';
  if (err?.code === 'no_citation' || err?.data?.error === 'no_citation') return 'no_citation';
  if (err?.code === 'writer_refused' || err?.data?.error === 'writer_refused') return 'writer_refused';
  return 'error';
}

const usd = (micro) => `$${(Number(micro || 0) / 1e6).toFixed(4)}`;
const CARD = 'rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'rounded-md px-2.5 py-1 text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-50';

export function BudgetRefusal({ err }) {
  return (
    <p role="alert" data-testid="budget-refused" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {err?.data?.message || err?.message || 'Your AI allowance is used up.'} Nothing was run and nothing was stored.
    </p>
  );
}

export function PlacementCard({ p, error, busy, onAccept, onDiscard }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(p.edited_payload || p.payload || {}, null, 2));
  const decided = p.status !== 'pending';
  return (
    <li className={CARD} data-testid={`placement-${p.id}`} data-status={p.status}>
      <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{placementText(p)}</p>
      <blockquote className="mt-1 border-l-2 border-violet-300 pl-2 text-[12px] italic text-gray-600 dark:border-violet-700 dark:text-gray-300" data-testid={`placement-cite-${p.id}`}>
        {p.cite?.quote || 'Quote not recorded'} <span className="not-italic text-axal-faint">· {spanLabel(p.cite?.from, p.cite?.to)}</span>
      </blockquote>
      {error && (refusalKind(error) === 'budget'
        ? <BudgetRefusal err={error} />
        : <p role="alert" data-testid={`placement-error-${p.id}`} className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-400">{error.data?.detail || error.message} It is still proposed.</p>)}
      {!p.can_accept && <p className="mt-2 text-[12px] text-axal-faint" data-testid={`placement-no-store-${p.id}`}>Not recorded: {MODULE_LABELS[p.module] || 'this module'} has no store for this yet, so it stays proposed.</p>}
      {decided ? (
        <p className="mt-2 text-[12px] font-bold text-axal-muted">{p.status === 'accepted' ? 'Accepted' : p.status === 'discarded' ? 'Discarded' : p.status}</p>
      ) : (
        <>
          {editing && (
            <textarea aria-label="Edit before accepting" data-testid={`placement-edit-${p.id}`} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)}
              className="mt-2 w-full rounded-md border border-gray-200 bg-white p-2 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" data-testid={`placement-accept-${p.id}`} disabled={!p.can_accept || busy}
              onClick={() => { if (!editing) return onAccept?.(p.id); let payload; try { payload = JSON.parse(draft); } catch { return undefined; } return onAccept?.(p.id, payload); }}
              className={`${BTN} bg-violet-700 text-white`}>{editing ? 'Save and accept' : 'Accept'}</button>
            <button type="button" data-testid={`placement-edit-toggle-${p.id}`} disabled={!p.can_accept || busy} onClick={() => setEditing((x) => !x)} className={`${BTN} border border-gray-200 dark:border-gray-700`}>{editing ? 'Cancel edit' : 'Edit'}</button>
            <button type="button" data-testid={`placement-discard-${p.id}`} disabled={busy} onClick={() => onDiscard?.(p.id)} className={`${BTN} text-gray-600 dark:text-gray-300`}>Discard</button>
          </div>
        </>
      )}
    </li>
  );
}

/** Placements, grouped by module; or running, none, or the refusal. */
export function PlacementsPanel({ read, running, runError, errors = {}, busyId, onAccept, onDiscard, onStructure }) {
  if (running) return <p data-testid="structuring-running" aria-live="polite" className="text-[13px] text-axal-muted">Eadwyn is reading the transcript and placing what it finds…</p>;
  const groups = groupByModule(read);
  return (
    <section data-testid="placements" className="space-y-3">
      {runError && (refusalKind(runError) === 'budget' ? <BudgetRefusal err={runError} /> : <p role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-400">{runError.message}</p>)}
      {groups.length === 0 ? (
        <div data-testid="placements-none" className="text-[13px] text-axal-faint">
          <p>No placements yet. Eadwyn has not structured this transcript, or found nothing it could cite.</p>
          {onStructure && <button type="button" onClick={onStructure} className={`${BTN} mt-2 bg-violet-700 text-white`}>Structure the transcript</button>}
        </div>
      ) : groups.map((g) => (
        <div key={g.module} data-testid={`module-${g.module}`}>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-axal-faint">{g.label}</h3>
          <ul className="space-y-2">{g.placements.map((pl) => <PlacementCard key={pl.id} p={pl} error={errors[pl.id]} busy={busyId === pl.id} onAccept={onAccept} onDiscard={onDiscard} />)}</ul>
        </div>
      ))}
    </section>
  );
}

/** Two runs side by side, by module. Needs two runs; says so otherwise. */
export function ComparePanel({ read }) {
  const cmp = read?.compare;
  if (!cmp) return <p data-testid="compare-none" className="text-[13px] text-axal-faint">Structure again with a second model to compare the two.</p>;
  const model = (id) => read.runs.find((r) => r.run_id === id)?.model || 'Model not recorded';
  return (
    <table data-testid="compare" className="w-full table-fixed text-[12px]">
      <thead><tr><th className="w-1/4 text-left">Module</th><th className="text-left">{model(cmp.first)}</th><th className="text-left">{model(cmp.second)}</th></tr></thead>
      <tbody>
        {cmp.modules.map((m) => (
          <tr key={m.module} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`compare-${m.module}`}>
            <td className="py-1 font-semibold">{MODULE_LABELS[m.module] || m.module}</td>
            {[m.first, m.second].map((side, i) => (
              <td key={i} className="py-1 pr-2">{side.length ? side.map((pl) => <div key={pl.id}>{placementText(pl)}</div>) : <span className="text-axal-faint">Nothing placed</span>}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Ask the transcript": an answer only with its cited passages. */
export function AskPanel({ result, error, busy, onAsk }) {
  const [q, setQ] = useState('');
  const kind = error ? refusalKind(error) : null;
  return (
    <section data-testid="ask" className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk?.(q.trim()); }} className="flex gap-2">
        <input aria-label="Ask the transcript" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the transcript…"
          className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[13px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        <button type="submit" disabled={busy} className={`${BTN} bg-violet-700 text-white`}>Ask</button>
      </form>
      {kind === 'budget' && <BudgetRefusal err={error} />}
      {kind === 'no_citation' && <p role="status" data-testid="ask-no-citation" className="text-[13px] text-axal-muted">{error.data?.detail || error.message}</p>}
      {kind === 'error' && <p role="alert" className="text-[13px] text-red-700 dark:text-red-400">{error.message}</p>}
      {!error && result?.ok && Array.isArray(result.cites) && result.cites.length > 0 && (
        <div data-testid="ask-answer" className={CARD}>
          <p className="text-[13px]">{result.answer}</p>
          <ul className="mt-2 space-y-1">
            {result.cites.map((c, i) => (
              <li key={i} data-testid="ask-cite" className="border-l-2 border-violet-300 pl-2 text-[12px] italic text-gray-600 dark:border-violet-700 dark:text-gray-300">
                {c.quote} <span className="not-italic text-axal-faint">· {spanLabel(c.from, c.to)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The structuring lines of the session's receipt: step, model, cost, time. */
export function StructureReceipt({ items }) {
  if (items === null) return <p className="text-[12px] text-axal-faint">Unreadable: the receipt could not be read.</p>;
  const rows = (items || []).filter((r) => STRUCTURING_STEPS.has(r.kind));
  if (!rows.length) return <p data-testid="structure-receipt-none" className="text-[12px] text-axal-faint">Not recorded</p>;
  return (
    <ul data-testid="structure-receipt" className="space-y-1 text-[12px]">
      {rows.map((r, i) => (
        <li key={i} className="flex justify-between gap-2">
          <span>
            {STEP_LABELS[r.kind]} · {r.model}
            {Number(r.fallback_used) ? ` (fallback for ${r.requested_model || 'the chosen model'})` : ''}
            {r.outcome === 'refused' ? ` · refused${r.refusal ? ` (${r.refusal})` : ''}` : ''}
            <span className="text-axal-faint"> · {r.created_at || 'Time not recorded'}</span>
          </span>
          <span className="tabular-nums">{usd(r.cost_microusd)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The whole review step, light by default, dark on request. */
export default function InterviewReview({ theme = 'light', read, running, runError, errors, busyId, onAccept, onDiscard, onStructure, ask = {}, onAsk, receiptItems }) {
  return (
    <div data-testid="interview-review" data-theme={theme} className={theme === 'dark' ? 'dark' : ''}>
      <div className="grid gap-6 bg-white p-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100 md:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <PlacementsPanel read={read} running={running} runError={runError} errors={errors} busyId={busyId} onAccept={onAccept} onDiscard={onDiscard} onStructure={onStructure} />
          <section><h2 className="mb-2 text-[14px] font-bold">Compare models</h2><ComparePanel read={read} /></section>
          <section><h2 className="mb-2 text-[14px] font-bold">Ask the transcript</h2><AskPanel result={ask.result} error={ask.error} busy={ask.busy} onAsk={onAsk} /></section>
        </div>
        <aside><h2 className="mb-2 text-[11px] font-bold uppercase text-axal-faint">Structuring receipt</h2><StructureReceipt items={receiptItems} /></aside>
      </div>
    </div>
  );
}
