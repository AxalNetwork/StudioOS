import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { shareUpdateApi } from '../../lib/api/shareUpdate.js';

/**
 * Grow › Share an update (D654, #1466), to `design/incoming/Cycle Action.dc.html`,
 * `action=update`: six steps — Period, Metrics, Highlights, Asks, Audience,
 * Preview — plus `nometrics` and `nothing`.
 *
 * ONE ROW. The sheet writes the founder's `portfolio_updates` row
 * (`routes/portfolio_updates.ts`); it is never a second updates store.
 *
 * NOTHING IS INVENTED. Each metric comes from Revenue and traction with its
 * source and date; a figure no snapshot records reads "Not recorded", never 0.
 * With no metrics the update still sends, with the metrics left out. Eadwyn
 * drafts the highlights and lowlights from the period's stored data, and every
 * line names its source; the founder edits them before sending.
 *
 * WHO GETS WHAT. Investors and the team receive the whole update. The Axal
 * network receives the asks only, unless the founder includes the metrics.
 */

export const STEPS = ['Period', 'Metrics', 'Highlights', 'Asks', 'Audience', 'Preview'];

export const ASK_LABELS = {
  hire: 'A hire', customer: 'A customer introduction', partner: 'A partner', market: 'A market contact', capital: 'Capital',
};

const iso = (d) => d.toISOString().slice(0, 10);

/** This month and last month, as the canvas offers them; dates in UTC. */
export function periodChoices(now = new Date()) {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  const thisStart = new Date(Date.UTC(y, m, 1)); const thisEnd = new Date(Date.UTC(y, m + 1, 0));
  const lastStart = new Date(Date.UTC(y, m - 1, 1)); const lastEnd = new Date(Date.UTC(y, m, 0));
  return [
    { key: 'this', label: 'This month', start: iso(thisStart), end: iso(thisEnd) },
    { key: 'last', label: 'Last month', start: iso(lastStart), end: iso(lastEnd) },
  ];
}

const money = (v) => `$${Number(v).toLocaleString('en-US')}`;

/** A metric as the sheet prints it: the figure, or "Not recorded" with its reason. Never 0 for a missing one. */
export function metricText(m) {
  if (m == null || m.value == null) return { value: 'Not recorded', detail: m?.reason || 'Not recorded' };
  const v = m.unit === 'usd' ? money(m.value) : m.unit === 'pct' ? `${m.value > 0 ? '+' : ''}${m.value}%`
    : m.unit === 'months' ? `${m.value} months` : Number(m.value).toLocaleString('en-US');
  return { value: v, detail: `${m.source}${m.as_of ? ` · ${m.as_of}` : ''}` };
}

/** What the network will receive, in words, from the audience choice. */
export function networkLine(includeMetrics) {
  return includeMetrics ? 'Asks and metrics. Highlights stay with investors and the team.' : 'Asks only. Metrics stay private unless you choose to include them.';
}

const ROW = 'flex items-start justify-between gap-3 border-b border-axal-hairline py-2.5 text-[12.5px] dark:border-gray-800';
const PILL = 'rounded-full border px-2 py-0.5 text-[10.5px] font-semibold';
const NR = `${PILL} border-dashed border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400`;
const LINK = 'text-[12.5px] font-bold text-violet-700 dark:text-violet-300';
const PRIMARY = 'rounded-lg bg-violet-700 px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600';
const GHOST = 'rounded-lg border border-axal-hairline px-3 py-2 text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100';

function Line({ line, onEdit, onRemove }) {
  return (
    <li className={ROW} data-testid="share-line">
      <div className="min-w-0">
        {onEdit
          ? <input aria-label="Line" className="w-full rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={line.text} onChange={(e) => onEdit(e.target.value)} />
          : <div className="font-semibold">{line.text}</div>}
        <div className="text-[11.5px] text-violet-700 dark:text-violet-300">Source: {line.source?.label}{line.source?.as_of ? ` · ${line.source.as_of}` : ''}</div>
      </div>
      {onRemove && <button type="button" className={LINK} onClick={onRemove}>Remove</button>}
    </li>
  );
}

/**
 * The sheet's body from props alone. `s` is the sheet state: step, period,
 * context, metrics, lines, asks, audience, includeMetrics, draft status.
 */
export function ShareUpdateView({ s, on }) {
  const step = s.step;
  const ctx = s.context;
  let body = null; let banner = null; let back = step > 0 ? 'Back' : ''; let next = step === 5 ? 'Send the update' : 'Next';
  if (step === 0) {
    body = (
      <ul>{periodChoices(s.now).map((p) => (
        <li key={p.key} className={ROW}>
          <label className="flex items-center gap-2"><input type="radio" name="period" checked={s.period?.key === p.key} onChange={() => on.period(p)} />
            <span className="font-semibold">{p.label}</span></label>
          <span className="text-axal-muted">{p.start} – {p.end}</span>
        </li>
      ))}</ul>
    );
  }
  if (step === 1) {
    if (ctx?.no_metrics || !s.metrics.some((m) => m.value != null)) {
      banner = 'No metrics are connected yet. The update still sends, with the metrics left out.';
      body = <ul><li className={ROW}><div><div className="font-semibold">Connect Stripe or accounting</div><div className="text-axal-muted">Then figures fill in here each month.</div></div><a className={LINK} href="/build/metrics">Enter figures</a></li></ul>;
    } else {
      body = (
        <ul data-testid="share-metrics">{s.metrics.map((m) => {
          const t = metricText(m);
          return (
            <li key={m.key} className={ROW}>
              <div><div className="font-semibold">{m.label}</div><div className="text-axal-muted">{t.value === 'Not recorded' ? t.detail : `${t.value} · ${t.detail}`}</div></div>
              <div className="flex items-center gap-2">{m.value == null && <span className={NR}>Not recorded</span>}
                <button type="button" className={LINK} onClick={() => on.removeMetric(m.key)}>Remove</button></div>
            </li>
          );
        })}</ul>
      );
    }
  }
  if (step === 2) {
    if (s.draftStatus === 'nothing' && !s.handWritten) {
      banner = 'Nothing new this month: no metric changed and nothing shipped. You can skip this update, or write it by hand.';
      back = 'Skip this month'; next = 'Write by hand';
      body = null;
    } else {
      body = (
        <div>
          {s.draftStatus === 'unavailable' && <p className="py-2 text-[12px] text-axal-muted">Eadwyn could not draft this time. Write the lines by hand; each one names its source.</p>}
          <h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">Highlights{s.draftStatus === 'drafted' ? ' · draft by Eadwyn' : ''}</h3>
          <ul>{s.highlights.map((l, i) => <Line key={`h${i}`} line={l} onEdit={(t) => on.editLine('highlights', i, t)} onRemove={() => on.removeLine('highlights', i)} />)}</ul>
          <h3 className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">Lowlights{s.draftStatus === 'drafted' ? ' · draft by Eadwyn' : ''}</h3>
          <ul>{s.lowlights.map((l, i) => <Line key={`l${i}`} line={l} onEdit={(t) => on.editLine('lowlights', i, t)} onRemove={() => on.removeLine('lowlights', i)} />)}</ul>
          {s.handWritten && <p className="py-2 text-[12px] text-axal-muted">Lines written by hand cite your own words as the source.</p>}
          {s.handWritten && <button type="button" className={`${GHOST} mt-2`} onClick={on.addLine}>Add a highlight</button>}
        </div>
      );
    }
  }
  if (step === 3) {
    const roles = ctx?.open_roles || [];
    const markets = ctx?.markets || [];
    body = (
      <ul data-testid="share-asks">{Object.keys(ASK_LABELS).map((kind) => {
        const a = s.asks.find((x) => x.kind === kind);
        const meta = (ctx?.ask_kinds || []).find((k) => k.kind === kind);
        return (
          <li key={kind} className={ROW}>
            <div className="min-w-0 flex-1">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!a} onChange={() => on.toggleAsk(kind)} />{ASK_LABELS[kind]}</label>
              {a && <input aria-label={`${ASK_LABELS[kind]} text`} className="mt-1 w-full rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={a.text} onChange={(e) => on.askText(kind, e.target.value)} placeholder="What you are asking for" />}
              {a && kind === 'hire' && (roles.length
                ? <select aria-label="Open role" className="mt-1 rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={a.link_ref || ''} onChange={(e) => on.askLink(kind, e.target.value || null)}>
                    <option value="">Links to no role</option>{roles.map((r) => <option key={r.id} value={String(r.id)}>{r.title}</option>)}</select>
                : <div className="text-[11.5px] text-axal-muted">No open role in Talent yet, so a reply stays on the ask.</div>)}
              {a && kind === 'market' && (markets.length
                ? <select aria-label="Market" className="mt-1 rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={a.link_ref || ''} onChange={(e) => on.askLink(kind, e.target.value || null)}>
                    <option value="">Links to no market</option>{markets.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}</select>
                : <div className="text-[11.5px] text-axal-muted">No market in Market expansion yet, so a reply stays on the ask.</div>)}
              <div className="text-[11.5px] text-axal-muted">{meta?.lands === false ? meta.reason : a && kind === 'market' && !a.link_ref ? 'Linked to no market, so a reply stays on the ask.' : `Replies land in ${meta?.module || 'the module that asked'}.`}</div>
            </div>
            <span className={`${PILL} border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200`}>{kind[0].toUpperCase() + kind.slice(1)}</span>
          </li>
        );
      })}</ul>
    );
  }
  if (step === 4) {
    const n = ctx?.audience || {};
    body = (
      <ul data-testid="share-audience">
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.investors} onChange={() => on.audience('investors')} /><span><span className="font-semibold">Investors</span><span className="block text-axal-muted">{n.investors ?? 'Not recorded'} from Capital relationships · full update</span></span></label></li>
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.team} onChange={() => on.audience('team')} /><span><span className="font-semibold">The team</span><span className="block text-axal-muted">{n.team ?? 'Not recorded'} people · full update</span></span></label></li>
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.network} onChange={() => on.audience('network')} /><span><span className="font-semibold">The Axal network</span><span className="block text-axal-muted">{networkLine(s.includeMetrics)}</span></span></label>
          {s.audience.network && <button type="button" className={LINK} onClick={on.includeMetrics}>{s.includeMetrics ? 'Keep metrics private' : 'Include metrics'}</button>}</li>
      </ul>
    );
  }
  if (step === 5) {
    const recorded = s.metrics.filter((m) => m.value != null);
    body = (
      <ul data-testid="share-preview">
        <li className={ROW}><div><div className="font-semibold">{s.title}</div><div className="text-axal-muted">{recorded.length ? recorded.map((m) => `${m.label} ${metricText(m).value}`).join(' · ') : 'Metrics left out: none is recorded'}</div></div></li>
        <li className={ROW}><div className="font-semibold">Highlights</div><div className="text-axal-muted">{s.highlights.length} · Lowlights {s.lowlights.length}</div></li>
        <li className={ROW}><div className="font-semibold">Asks</div><div className="text-axal-muted">{s.asks.length} · each with a reply button</div></li>
      </ul>
    );
  }
  return (
    <aside role="dialog" aria-label="Share an update" data-testid="share-update-sheet" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950">
      <header className="border-b border-axal-hairline p-5 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint">Grow</div>
            <h2 className="text-[17px] font-extrabold">Share an update</h2>
            <p className="text-[12.5px] text-axal-muted">One update for investors, the team and the Axal network. Written once, sent everywhere it belongs.</p></div>
          <button type="button" aria-label="Close" onClick={on.close}><X size={18} /></button>
        </div>
        <ol className="mt-3 flex flex-wrap gap-1.5">{STEPS.map((t, i) => (
          <li key={t} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${i === step ? 'bg-violet-700 text-white dark:bg-violet-600' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{i + 1} · {t}</li>
        ))}</ol>
      </header>
      {banner && <p data-testid="share-banner" className="mx-5 mt-3 rounded-lg border border-axal-hairline bg-gray-50 p-3 text-[12.5px] dark:border-gray-800 dark:bg-gray-900">{banner}</p>}
      {s.error && <p role="alert" className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{s.error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{s.busy ? <p className="py-4 text-[12.5px] text-axal-muted">Working…</p> : body}</div>
      {step === 5 && <p className="px-5 text-[11.5px] text-axal-faint">It also appears in Raise › Capital relationships as an investor update sent.</p>}
      <footer className="flex items-center justify-between gap-2 border-t border-axal-hairline p-4 dark:border-gray-800">
        <span className="text-[11.5px] text-axal-faint">Step {step + 1} of 6</span>
        <div className="flex gap-2">
          {back && <button type="button" className={GHOST} onClick={on.back}>{back}</button>}
          <button type="button" className={PRIMARY} disabled={s.busy || (step === 0 && !s.period)} onClick={on.next}>{next}</button>
        </div>
      </footer>
    </aside>
  );
}

/** The sheet with its state and the Worker calls. */
export default function ShareUpdateSheet({ projectId, onClose, onSent }) {
  const [s, setS] = useState({
    step: 0, period: null, context: null, metrics: [], highlights: [], lowlights: [], asks: [],
    audience: { investors: true, team: true, network: false }, includeMetrics: false,
    draftStatus: null, handWritten: false, busy: false, error: '', uid: null, title: '', now: new Date(),
  });
  const set = (patch) => setS((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  const fail = (e) => set({ busy: false, error: e?.message || 'That did not work. Nothing was sent.' });

  const loadContext = useCallback(async (p) => {
    set({ busy: true, error: '' });
    try {
      const ctx = await shareUpdateApi.context(projectId, p.start, p.end);
      set({ context: ctx, metrics: ctx.metrics || [], busy: false, step: 1 });
    } catch (e) { fail(e); }
  }, [projectId]);

  const draft = useCallback(async () => {
    set({ busy: true, error: '' });
    try {
      const d = await shareUpdateApi.draftLines(projectId, s.period.start, s.period.end);
      set({ highlights: d.highlights || [], lowlights: d.lowlights || [], draftStatus: d.status, busy: false, step: 2 });
    } catch (e) { fail(e); }
  }, [projectId, s.period]);

  const send = async () => {
    set({ busy: true, error: '' });
    try {
      const title = s.title || `${s.period.label} update`;
      const created = s.uid ? { uid: s.uid } : await shareUpdateApi.create(projectId, title);
      await shareUpdateApi.save(created.uid, {
        period_start: s.period.start, period_end: s.period.end,
        metrics: s.metrics.filter((m) => m.value != null),
        highlights: s.highlights.filter((l) => l.text.trim()), lowlights: s.lowlights.filter((l) => l.text.trim()),
        asks: s.asks.filter((a) => a.text.trim()), audience: s.audience, network_includes_metrics: s.includeMetrics,
      });
      const sent = await shareUpdateApi.send(created.uid);
      set({ busy: false, uid: created.uid });
      onSent?.(created.uid, sent);
    } catch (e) { fail(e); }
  };

  useEffect(() => { set({ title: s.period ? `${s.period.label} update` : '' }); }, [s.period]);

  const on = {
    close: onClose,
    period: (p) => set({ period: p }),
    removeMetric: (key) => set((p) => ({ metrics: p.metrics.filter((m) => m.key !== key) })),
    editLine: (field, i, text) => set((p) => ({ [field]: p[field].map((l, j) => (j === i ? { ...l, text } : l)) })),
    removeLine: (field, i) => set((p) => ({ [field]: p[field].filter((_, j) => j !== i) })),
    addLine: () => set((p) => ({ highlights: [...p.highlights, { text: '', source: { label: 'Written by the founder', ref: null, as_of: null } }] })),
    toggleAsk: (kind) => set((p) => ({ asks: p.asks.some((a) => a.kind === kind) ? p.asks.filter((a) => a.kind !== kind) : [...p.asks, { kind, text: '', link_ref: null }] })),
    askText: (kind, text) => set((p) => ({ asks: p.asks.map((a) => (a.kind === kind ? { ...a, text } : a)) })),
    askLink: (kind, ref) => set((p) => ({ asks: p.asks.map((a) => (a.kind === kind ? { ...a, link_ref: ref } : a)) })),
    audience: (key) => set((p) => ({ audience: { ...p.audience, [key]: !p.audience[key] } })),
    includeMetrics: () => set((p) => ({ includeMetrics: !p.includeMetrics })),
    back: () => {
      if (s.step === 2 && s.draftStatus === 'nothing' && !s.handWritten) { onClose?.(); return; } // Skip this month
      set((p) => ({ step: Math.max(0, p.step - 1), error: '' }));
    },
    next: () => {
      if (s.step === 0) return loadContext(s.period);
      if (s.step === 1) return draft();
      if (s.step === 2 && s.draftStatus === 'nothing' && !s.handWritten) return set({ handWritten: true });
      if (s.step === 5) return send();
      return set((p) => ({ step: p.step + 1, error: '' }));
    },
  };
  return <ShareUpdateView s={s} on={on} />;
}
