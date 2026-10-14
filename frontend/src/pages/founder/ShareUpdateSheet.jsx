import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionSheet, { primary as PRIMARY, ghost as GHOST } from '../../ui/ActionSheet';
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
 *
 * THE FRAME (D686 §5.8, #1599). `ShareUpdateView` is the body of an
 * `ActionSheet` (header, the steps as pills, one banner, a scrolling body, a
 * pinned footer); `ShareUpdateLightbox.jsx` draws it in the tall cycle
 * lightbox. Nothing here is fixed to the viewport.
 */

/**
 * D686 §5.8 flags. `network_default_on` is on since S19-B (#1595, #1637)
 * made the Worker's `cleanAudience` default the network on.
 */
export const SHARE_FIELDS = Object.freeze({ network_default_on: true });

export const SHARE_SHEET = Object.freeze({
  eyebrow: 'Grow', title: 'Share an update', titleId: 'share-update-title', testId: 'share-update-sheet',
  sub: 'One update for investors, the team and the Axal network. Written once, sent everywhere it belongs.',
});

export const STEPS = ['Period', 'Metrics', 'Highlights', 'Asks', 'Audience', 'Preview'];

export const ASK_LABELS = {
  hire: 'A hire', customer: 'A customer introduction', partner: 'A partner', market: 'A market contact', capital: 'Capital',
};

const iso = (d) => d.toISOString().slice(0, 10);
const shortDay = (v) => (validIso(String(v || '').slice(0, 10)) ? utc(String(v).slice(0, 10)).toLocaleDateString('en-GB', DAY) : 'Not recorded');
/** The Worker's ASK_MODULE labels predate Grow's module names; until S19-B renames them, read them as Grow does. */
const GROW_MODULE = { Talent: 'Team expansion', Customers: 'Distribution', Partnerships: 'Partner network' };
const moduleName = (m) => GROW_MODULE[m] || m;

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

const DAY = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const utc = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const validIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(utc(v).valueOf());

/** "1 Oct – 31 Oct", read in UTC so a founder west of UTC sees the dates they picked. */
export function periodRange(start, end) {
  if (!validIso(start) || !validIso(end)) return 'Choose dates';
  return `${utc(start).toLocaleDateString('en-GB', DAY)} – ${utc(end).toLocaleDateString('en-GB', DAY)}`;
}

/** Whether the range is exactly one calendar month. */
export function wholeMonth(start, end) {
  if (!validIso(start) || !validIso(end)) return false;
  const a = utc(start); const b = utc(end);
  return a.getUTCDate() === 1 && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
    && b.getUTCDate() === new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)).getUTCDate();
}

/** "October 2026" for a whole calendar month, else "1 Oct – 15 Oct". Shared with the sent page. */
export function periodTitle(start, end) {
  if (wholeMonth(start, end)) return utc(start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return periodRange(start, end);
}

/** The preview group's heading: "Preview · October update", or the range for a part month. */
export function previewHeading(start, end) {
  const name = wholeMonth(start, end) ? utc(start).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) : periodRange(start, end);
  return `Preview · ${name} update`;
}

/** The preview's first row: "<Venture> · October", or the range for a part month. */
export function ventureRow(name, start, end) {
  const when = wholeMonth(start, end) ? utc(start).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) : periodRange(start, end);
  return `${name} · ${when}`;
}

/** Why a custom range cannot be used, or null. */
export function periodError(p) {
  if (!p) return 'Choose a period.';
  if (!validIso(p.start) || !validIso(p.end)) return 'Choose both dates.';
  if (p.start > p.end) return 'The start date must be on or before the end date.';
  return null;
}

/** Who the update can reach, or why Send is off. Null counts (unreadable) never read as zero. */
export function audienceRefusal(audience, counts = {}) {
  const on = ['investors', 'team', 'network'].filter((k) => audience[k]);
  if (!on.length) return 'Switch on at least one audience to send.';
  const known = on.map((k) => counts[k]);
  if (known.every((n) => typeof n === 'number') && known.reduce((a, b) => a + b, 0) === 0) return 'The audiences switched on have no one in them yet.';
  return null;
}

/**
 * Send without orphans: create the draft once and hand its uid back at once,
 * so a retry after a failed save or send reuses it. A 409 from save means the
 * update was already sent; it is reported as sent, not as "Nothing was sent".
 */
export async function sendShareUpdate(api, projectId, s, onUid) {
  let uid = s.uid;
  if (!uid) { uid = (await api.create(projectId, s.title)).uid; onUid?.(uid); }
  const removed = new Set(s.removedMetrics || []);
  try {
    await api.save(uid, {
      period_start: s.period.start, period_end: s.period.end,
      metrics: s.metrics.filter((m) => m.value != null && !removed.has(m.key)),
      highlights: s.highlights.filter((l) => l.text.trim()), lowlights: s.lowlights.filter((l) => l.text.trim()),
      asks: s.asks.filter((a) => a.text.trim()), audience: s.audience, network_includes_metrics: s.includeMetrics,
    });
  } catch (e) {
    if (e?.status === 409) return { uid, sent: null, alreadySent: true };
    throw e;
  }
  return { uid, sent: await api.send(uid), alreadySent: false };
}

const money = (v) => `$${Number(v).toLocaleString('en-US')}`;

/** A metric as the sheet prints it: the figure, or "Not recorded" with its reason. Never 0 for a missing one. */
export function metricText(m) {
  if (m == null || m.value == null) return { value: 'Not recorded', detail: m?.reason || 'Not recorded' };
  const v = m.unit === 'usd' ? money(m.value) : m.unit === 'pct' ? `${m.value > 0 ? '+' : ''}${m.value}%${m.key === 'growth' ? ' month on month' : ''}`
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

// Rows are keyed by index, so which one is being edited lives in the sheet, never here.
function Line({ line, editing, onEdit, onToggle, onRemove }) {
  const open = editing || !line.text.trim();
  return (
    <li className={ROW} data-testid="share-line">
      <div className="min-w-0 flex-1">
        {open
          ? <input aria-label="Line" className="w-full rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={line.text} onChange={(e) => onEdit(e.target.value)} />
          : <div className="font-semibold">{line.text}</div>}
        <div className="text-[11.5px] text-violet-700 dark:text-violet-300">Source: {line.source?.label}{line.source?.as_of ? ` · ${line.source.as_of}` : ''}</div>
      </div>
      <div className="flex shrink-0 gap-3">
        <button type="button" className={LINK} onClick={onToggle}>{open ? 'Done' : 'Edit'}</button>
        <button type="button" className={LINK} onClick={onRemove}>Remove</button>
      </div>
    </li>
  );
}
const SELECTED = 'rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200';
const onOff = (v, on = 'On') => <span className={v ? SELECTED : NR}>{v ? on : 'Off'}</span>;

/**
 * The sheet's body from props alone. `s` is the sheet state: step, period,
 * context, metrics, lines, asks, audience, includeMetrics, draft status.
 */
export function ShareUpdateView({ s, on }) {
  const step = s.step;
  const ctx = s.context;
  let body = null; let banner = null; let back = step > 0 ? 'Back' : ''; let next = step === 5 ? 'Send the update' : 'Next';
  const periodProblem = step === 0 ? periodError(s.period) : null;
  if (step === 0) {
    const custom = s.period?.key === 'custom' ? s.period : null;
    const choices = [...periodChoices(s.now), { key: 'custom', label: 'Custom', start: custom?.start || '', end: custom?.end || '' }];
    body = (
      <div role="radiogroup" aria-label="Period">
        <h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">Period</h3>
        <ul>{choices.map((p) => (
          <li key={p.key} className={ROW}>
            <div className="min-w-0 flex-1">
              <label className="flex items-center gap-2"><input type="radio" name="period" checked={s.period?.key === p.key} onChange={() => on.period(p)} />
                <span className="font-semibold">{p.label}</span></label>
              {p.key === 'custom' && custom && <div className="mt-1 flex flex-wrap gap-2">
                <input type="date" aria-label="Start date" className="rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={custom.start} onChange={(e) => on.period({ ...custom, start: e.target.value })} />
                <input type="date" aria-label="End date" className="rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={custom.end} onChange={(e) => on.period({ ...custom, end: e.target.value })} />
              </div>}
            </div>
            <span className="flex items-center gap-2 text-axal-muted">{periodRange(p.start, p.end)}{s.period?.key === p.key && <span className={SELECTED}>Selected</span>}</span>
          </li>
        ))}</ul>
        {s.period && periodProblem && <p className="py-2 text-[12px] text-red-700 dark:text-red-300">{periodProblem}</p>}
      </div>
    );
  }
  if (step === 1) {
    if (ctx?.no_metrics || !s.metrics.some((m) => m.value != null)) {
      banner = 'No metrics are connected yet. The update still sends, with the metrics left out.';
      // "Connect a tool" opens Build's lightbox once S02-B lands; until then only the hand route is drawn.
      body = <ul><li className={ROW}><div><div className="font-semibold">Connect Stripe or accounting</div><div className="text-axal-muted">Then figures fill in here each month.</div></div><Link className={GHOST} to={`/build/metrics?project_id=${encodeURIComponent(s.projectId ?? '')}`}>Enter figures by hand</Link></li></ul>;
    } else {
      const removed = s.removedMetrics || [];
      body = (
        <div>
        <h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">From Revenue and traction</h3>
        <ul data-testid="share-metrics">{s.metrics.filter((m) => !removed.includes(m.key)).map((m) => {
          const t = metricText(m);
          return (
            <li key={m.key} className={ROW}>
              <div><div className="font-semibold">{m.label}</div><div className="text-axal-muted">{t.value === 'Not recorded' ? t.detail : `${t.value} · ${t.detail}`}</div></div>
              <div className="flex items-center gap-2">{m.value == null && <span className={NR}>Not recorded</span>}
                <button type="button" className={LINK} onClick={() => on.removeMetric(m.key)}>Remove</button></div>
            </li>
          );
        })}</ul>
        {removed.length > 0 && <p className="py-2 text-[12px] text-axal-muted">Removed: {s.metrics.filter((m) => removed.includes(m.key)).map((m) => (
          <span key={m.key} className="mr-2">{m.label} · <button type="button" className={LINK} onClick={() => on.restoreMetric(m.key)}>Restore</button></span>))}</p>}
        </div>
      );
    }
  }
  if (step === 2) {
    if (s.draftStatus === 'nothing' && !s.handWritten) {
      banner = `${wholeMonth(s.period?.start, s.period?.end) ? 'Nothing new this month' : 'Nothing new in this period'}: no metric changed and nothing shipped. You can skip this update, or write it by hand.`;
      back = 'Skip this month'; next = 'Write by hand';
      body = null;
    } else {
      body = (
        <div>
          {s.draftStatus === 'unavailable' && <p className="py-2 text-[12px] text-axal-muted">Eadwyn could not draft this time. Write the lines by hand; each one names its source.</p>}
          <h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">Highlights{s.draftStatus === 'drafted' ? ' · draft by Eadwyn' : ''}</h3>
          <ul>{s.highlights.map((l, i) => <Line key={`h${i}`} line={l} editing={s.editing?.field === 'highlights' && s.editing.i === i} onToggle={() => on.toggleEdit('highlights', i)} onEdit={(t) => on.editLine('highlights', i, t)} onRemove={() => on.removeLine('highlights', i)} />)}</ul>
          <h3 className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">Lowlights{s.draftStatus === 'drafted' ? ' · draft by Eadwyn' : ''}</h3>
          <ul>{s.lowlights.map((l, i) => <Line key={`l${i}`} line={l} editing={s.editing?.field === 'lowlights' && s.editing.i === i} onToggle={() => on.toggleEdit('lowlights', i)} onEdit={(t) => on.editLine('lowlights', i, t)} onRemove={() => on.removeLine('lowlights', i)} />)}</ul>
          <p className="py-2 text-[12px] text-axal-muted">Lines written by hand cite your own words as the source.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={GHOST} onClick={() => on.addLine('highlights')}>Add a highlight</button>
            <button type="button" className={GHOST} onClick={() => on.addLine('lowlights')}>Add a lowlight</button>
          </div>
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
                : <div className="text-[11.5px] text-axal-muted">No open role in Team expansion yet, so a reply stays on the ask.</div>)}
              {a && kind === 'hire' && a.link_ref && roles.find((r) => String(r.id) === String(a.link_ref)) && <div className="text-[11.5px] text-axal-muted">{roles.find((r) => String(r.id) === String(a.link_ref)).title} · links to the open role in Team expansion</div>}
              {a && kind === 'market' && (markets.length
                ? <select aria-label="Market" className="mt-1 rounded border border-axal-hairline bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={a.link_ref || ''} onChange={(e) => on.askLink(kind, e.target.value || null)}>
                    <option value="">Links to no market</option>{markets.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}</select>
                : <div className="text-[11.5px] text-axal-muted">No market in Market expansion yet, so a reply stays on the ask.</div>)}
              <div className="text-[11.5px] text-axal-muted">{kind === 'capital' && ctx?.open_call
                ? `Links to the open Call for Capital · ${ctx.open_call.name} (closes ${shortDay(ctx.open_call.target_close)}). Replies from investors it was sent to land on the call; others become investor contacts.`
                : kind === 'capital' && ctx?.open_call_reason ? `${ctx.open_call_reason}. Replies become investor contacts in Capital relationships.`
                : meta?.lands === false ? meta.reason : `Replies land in ${moduleName(meta?.module) || 'the module that asked'}.`}</div>
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
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.investors} onChange={() => on.audience('investors')} /><span><span className="font-semibold">Investors</span><span className="block text-axal-muted">{n.investors ?? 'Not recorded'} from Capital relationships · full update</span></span></label>{onOff(s.audience.investors)}</li>
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.team} onChange={() => on.audience('team')} /><span><span className="font-semibold">The team</span><span className="block text-axal-muted">{n.team ?? 'Not recorded'} people · full update</span></span></label>{onOff(s.audience.team)}</li>
        <li className={ROW}><label className="flex items-center gap-2"><input type="checkbox" checked={s.audience.network} onChange={() => on.audience('network')} /><span><span className="font-semibold">The Axal network</span><span className="block text-axal-muted">{networkLine(s.includeMetrics)}</span></span></label>
          <div className="flex items-center gap-2">{s.audience.network && <button type="button" className={LINK} onClick={on.includeMetrics}>{s.includeMetrics ? 'Keep metrics private' : 'Include metrics'}</button>}
          {onOff(s.audience.network, s.includeMetrics ? 'Asks and metrics' : 'Asks only')}</div></li>
      </ul>
    );
  }
  if (step === 5) {
    const recorded = s.metrics.filter((m) => m.value != null && !(s.removedMetrics || []).includes(m.key));
    body = (
      <ul data-testid="share-preview">
        <li><h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-axal-faint">{previewHeading(s.period?.start, s.period?.end)}</h3></li>
        {ctx?.project?.name && <li className={ROW}><div className="font-semibold">{ventureRow(ctx.project.name, s.period?.start, s.period?.end)}</div></li>}
        <li className={ROW}><div><div className="font-semibold">{s.title}</div><div className="text-axal-muted">{recorded.length ? recorded.map((m) => `${m.label} ${metricText(m).value}`).join(' · ') : 'Metrics left out: none is recorded'}</div></div></li>
        <li className={ROW}><div className="font-semibold">Highlights</div><div className="text-axal-muted">{s.highlights.length} · Lowlights {s.lowlights.length}</div></li>
        <li className={ROW}><div className="font-semibold">Asks</div><div className="text-axal-muted">{s.asks.length} · each with a reply button</div></li>
      </ul>
    );
  }
  const refusal = step === 5 ? audienceRefusal(s.audience, ctx?.audience || {}) : null;
  const tone = step === 1 ? 'warn' : 'info';
  const footer = <>
    {refusal && <span className="text-[11.5px] text-axal-muted">{refusal}</span>}
    {back && <button type="button" className={GHOST} onClick={on.back}>{back}</button>}
    <button type="button" className={PRIMARY} disabled={s.busy || !!periodProblem || !!refusal} onClick={on.next}>{next}</button>
  </>;
  return (
    <ActionSheet {...SHARE_SHEET} onClose={on.close} steps={STEPS} step={step}
      banner={s.error ? { tone: 'error', text: s.error } : banner ? { tone, text: banner } : null}
      footNote={`Step ${step + 1} of 6`} footer={footer}>
      {s.error && banner && <p data-testid="share-banner" className="mb-2 text-[12.5px] text-axal-muted">{banner}</p>}
      {s.busy ? <p className="py-4 text-[12.5px] text-axal-muted">Working…</p> : body}
      {step === 5 && <p className="mt-3 text-[11.5px] text-axal-faint">It also appears in Raise › Capital relationships as an investor update sent.</p>}
    </ActionSheet>
  );
}

/** After removing row `i` of `field`, the row being edited keeps pointing at the same line. */
export function shiftEditing(editing, field, i) {
  if (!editing || editing.field !== field) return editing;
  if (editing.i === i) return null;
  return editing.i > i ? { field, i: editing.i - 1 } : editing;
}

/** The sheet with its state and the Worker calls. */
export default function ShareUpdateSheet({ projectId, onClose, onSent }) {
  const [s, setS] = useState({
    step: 0, period: periodChoices(new Date())[0], context: null, metrics: [], removedMetrics: [], highlights: [], lowlights: [], asks: [], editing: null, projectId,
    audience: { investors: true, team: true, network: SHARE_FIELDS.network_default_on }, includeMetrics: false,
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
      const r = await sendShareUpdate(shareUpdateApi, projectId, s, (uid) => set({ uid }));
      set({ busy: false, uid: r.uid });
      onSent?.(r.uid, r.sent);
    } catch (e) { fail(e); }
  };

  useEffect(() => { set({ title: s.period && !periodError(s.period) ? `${periodTitle(s.period.start, s.period.end)} update` : '' }); }, [s.period]);

  const on = {
    close: onClose,
    period: (p) => set({ period: p }),
    removeMetric: (key) => set((p) => ({ removedMetrics: [...p.removedMetrics.filter((k) => k !== key), key] })),
    restoreMetric: (key) => set((p) => ({ removedMetrics: p.removedMetrics.filter((k) => k !== key) })),
    editLine: (field, i, text) => set((p) => ({ [field]: p[field].map((l, j) => (j === i ? { ...l, text } : l)) })),
    toggleEdit: (field, i) => set((p) => ({ editing: p.editing?.field === field && p.editing.i === i ? null : { field, i } })),
    removeLine: (field, i) => set((p) => ({ [field]: p[field].filter((_, j) => j !== i), editing: shiftEditing(p.editing, field, i) })),
    addLine: (field) => set((p) => ({ [field]: [...p[field], { text: '', source: { label: 'Written by the founder', ref: null, as_of: null } }], editing: { field, i: p[field].length } })),
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
