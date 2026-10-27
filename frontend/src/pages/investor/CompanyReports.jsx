import { useEffect, useState } from 'react';
import { reportingApi } from '../../lib/api/reporting';
import { Lightbox, Unreadable, usePhoneWidth } from '../../ui';
import { CARD, H2, LINK, MUTED, Pill } from './PortfolioReports';
import {
  FIGURE_KEYS, HOLDING_NOTES, dayOf, formatValue, periodWord, readerModules, seriesLine, seriesOf, termsRows, timelineRows, whatChanged,
} from './portfolioReportsModel';

/**
 * D1061 (#2931) — the company page's blocks (RPT10, RPT11, RPT13): Figures as
 * five small multiples from the frozen figures of the reports received, the
 * Reports timeline with Read, Ask and Waive, Terms read only, the reader, and
 * the holding notes. Every change opens an in-page dialog that says what it
 * changes; nothing here is a browser pop-up, and nothing names another
 * investor.
 *
 * D1062 (#2932), the investor at 390 (RPT21): one chart per screen width,
 * the Reports as a list whose rows each open a full-screen sheet (the reader
 * for a sent report, the period for one still owed) with "‹ Reports" back
 * and the period's own pill, and "Ask for this report" pinned at its foot.
 * Every press is at least 44px tall there.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/60';
const PRIMARY = 'inline-flex min-h-[36px] items-center justify-center rounded-lg bg-axal-violet px-3 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1 dark:hover:bg-violet-500';
const Foot = ({ children }) => <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 max-sm:flex-nowrap max-sm:px-[14px] max-sm:py-[10px] dark:border-gray-800">{children}</div>;
/** D1062: the width at which a `Lightbox` is a full-screen sheet (its `max-sm:`), so the crumb is drawn exactly there. */
export const SHEET_QUERY = '(max-width: 639px)';
/** D1062 (RPT21c): a sheet's own head on a phone: "‹ Reports", the title, its pill and its line. */
function SheetHead({ title, pill, line, onBack }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="company-sheet-head">
      <button type="button" className="inline-flex min-h-11 w-fit items-center bg-transparent p-0 text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200" onClick={onBack} data-testid="company-sheet-back">‹ Reports</button>
      <h2 className="m-0 text-[19px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h2>
      {pill ? <Pill pill={pill} testId="company-sheet-pill" /> : null}
      {line ? <p className={MUTED}>{line}</p> : null}
    </div>
  );
}
const refusal = (e, fallback) => (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback);

// ───────────────────────────────────────────────────────────── RPT13: holding notes

export function HoldingNote({ route }) {
  if (!HOLDING_NOTES[route]) return null;
  return <p className="m-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid={`company-holding-note-${route}`}>{HOLDING_NOTES[route]}</p>;
}

// ───────────────────────────────────────────────────────────── RPT10: Figures

const W = 340; const H = 176; const L = 46; const T = 16; const B = 24;

/** One small multiple: solid between reported values, dashed across a gap and after the last one, dotted the year before, a ring on a corrected value. */
function SmallChart({ s }) {
  const vals = [...s.points.map((p) => p.value), ...(s.prior || [])].filter((v) => v != null);
  const max = Math.max(1, ...vals); const min = Math.min(0, ...vals);
  const n = s.points.length;
  const iw = W - L - 24; const ih = H - T - B;
  const X = (i) => (n <= 1 ? L + iw / 2 : L + (i * iw) / (n - 1));
  const Y = (v) => T + ih - ((v - min) / (max - min || 1)) * ih;
  const segs = [];
  let last = -1;
  s.points.forEach((p, i) => {
    if (p.value == null) return;
    if (last >= 0) segs.push({ key: `s${i}`, x1: X(last), y1: Y(s.points[last].value), x2: X(i), y2: Y(p.value), gap: i - last > 1 });
    last = i;
  });
  const tail = last >= 0 && last < n - 1 ? { x1: X(last), x2: X(n - 1), y: Y(s.points[last].value) } : null;
  const prior = s.prior ? s.prior.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(' ') : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={seriesLine(s)} className="h-auto w-full" data-testid={`company-figure-chart-${s.key}`}>
      {prior ? <polyline points={prior} fill="none" className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1.8" strokeDasharray="1.5 3.5" strokeLinecap="round" data-testid={`company-figure-prior-${s.key}`} /> : null}
      {segs.map((g) => <line key={g.key} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className={g.gap ? 'stroke-gray-400 dark:stroke-gray-500' : 'stroke-violet-600 dark:stroke-violet-400'} strokeWidth={g.gap ? 1.3 : 2.4} strokeDasharray={g.gap ? '4 3' : undefined} data-testid={g.gap ? `company-figure-gap-${s.key}` : undefined} />)}
      {tail ? <><line x1={tail.x1} y1={tail.y} x2={tail.x2} y2={tail.y} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1.3" strokeDasharray="4 3" data-testid={`company-figure-tail-${s.key}`} /><text x={tail.x2} y={tail.y - 7} textAnchor="end" fontSize="10" className="fill-gray-500 dark:fill-gray-400">not reported</text></> : null}
      {s.points.map((p, i) => (p.value == null ? null : (
        <circle key={p.uid} cx={X(i)} cy={Y(p.value)} r={p.corrected ? 5.5 : 3.2} strokeWidth="2"
          className={p.corrected ? 'fill-white stroke-violet-600 dark:fill-gray-900 dark:stroke-violet-400' : 'fill-violet-600 stroke-violet-600 dark:fill-violet-400 dark:stroke-violet-400'}
          data-testid={p.corrected ? `company-figure-ring-${s.key}` : undefined}>
          <title>{`${p.label} · ${s.label} ${formatValue(p.value, s.unit)}${p.corrected ? ' · corrected' : ''}`}</title>
        </circle>
      )))}
      {s.points.map((p, i) => <text key={`x${p.uid}`} x={X(i)} y={H - 6} textAnchor="middle" fontSize="10.5" className="fill-gray-500 dark:fill-gray-400">{p.label}</text>)}
    </svg>
  );
}

function FigureCard({ s }) {
  const [table, setTable] = useState(false);
  return (
    <section className={CARD} data-testid={`company-figure-${s.key}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">{s.label}</h3>
        <button type="button" className={`${LINK} inline-flex min-h-11 items-center sm:min-h-0`} onClick={() => setTable((v) => !v)} data-testid={`company-figure-toggle-${s.key}`}>{table ? 'View as chart' : 'View as table'}</button>
      </div>
      {table ? (
        <table className="w-full text-left text-[12px]" data-testid={`company-figure-table-${s.key}`}>
          <thead><tr className="text-[11px] uppercase text-axal-muted dark:text-gray-400"><th className="py-1">Period</th><th>Value</th><th>Source</th></tr></thead>
          <tbody>{s.points.map((p) => <tr key={p.uid} className="border-t border-axal-ground dark:border-gray-800"><td className="py-1">{p.label}</td><td>{p.value == null ? <span className="text-axal-muted dark:text-gray-400">Not recorded · {p.reason}</span> : `${formatValue(p.value, s.unit)}${p.corrected ? ' · corrected' : ''}`}</td><td>{p.source || '—'}</td></tr>)}</tbody>
        </table>
      ) : <SmallChart s={s} />}
      <p className={MUTED}>{s.sources.length ? `${s.sources.join('; ')}, via the reports. ` : ''}{seriesLine(s)}</p>
    </section>
  );
}

/** Figures (RPT10): read from the frozen figures of each report received (D1061), which records no open. */
export function FiguresTab({ uid, periods }) {
  const [state, setState] = useState({ status: 'loading', reports: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', reports: [] });
    reportingApi.companyFigures(uid).then(
      (r) => { if (alive) setState({ status: 'ready', reports: Array.isArray(r?.reports) ? r.reports : [] }); },
      (e) => { if (alive) setState({ status: Number(e?.status) === 404 ? 'none' : 'unreadable', reports: [] }); },
    );
    return () => { alive = false; };
  }, [uid, tick]);
  if (state.status === 'loading') return <section className={CARD} aria-busy="true"><h2 className={H2}>Figures</h2><div className="h-3 w-40 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  if (state.status === 'unreadable') return <section className={CARD} data-testid="company-figures"><Unreadable what="The figures this company reported" claim="This is not a claim that it reported none." onRetry={() => setTick((n) => n + 1)} /></section>;
  if (state.status === 'none' || !state.reports.length) return <section className={CARD} data-testid="company-figures-none"><h2 className={H2}>Figures</h2><p className={MUTED}>No report from this company has reached you yet, so there is nothing to chart. Nothing here is estimated.</p></section>;
  const changes = whatChanged(state.reports, periods);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="company-figures">
      <section className={CARD}>
        <p className={MUTED}>Figures as this company reported them to you, by report period. Nothing here is estimated.</p>
        <ul className="m-0 flex list-none flex-wrap gap-4 p-0 text-[12px] text-axal-ink dark:text-gray-100" data-testid="company-figures-legend">
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 border-t-[2.4px] border-violet-600 dark:border-violet-400" />As reported</li>
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 border-t-2 border-dotted border-gray-400 dark:border-gray-500" />The year before, as reported (dotted)</li>
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 border-t border-dashed border-gray-400 dark:border-gray-500" />No figure in a report (dashed)</li>
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border-2 border-violet-600 dark:border-violet-400" />Corrected (ring)</li>
        </ul>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="company-figure-grid">{FIGURE_KEYS.map((k) => <FigureCard key={k} s={seriesOf(state.reports, k)} />)}</div>
      <section className={CARD} data-testid="company-what-changed">
        <h2 className={H2}>Eadwyn · What changed since the last report</h2>
        <p className={MUTED}>Eadwyn reads the reports this company sent you. It never fills in a figure and never gives advice.</p>
        {changes.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {changes.map((c) => <li key={c.key} className="text-[12.5px]"><b className="text-axal-ink dark:text-gray-100">{c.text}</b><div className="text-axal-muted dark:text-gray-400">{c.sub}</div></li>)}
          </ul>
        ) : <p className={MUTED} data-testid="company-what-changed-none">No figure changed between the last two reports you received, or only one has arrived.</p>}
        <p className={MUTED} data-testid="company-what-changed-note">Saving this as your own note waits for a notes store; nothing here is saved or sent.</p>
      </section>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── RPT11: Ask and Waive

/** "Ask for this report": once per period, while it is late or missing. The company is told; nobody else sees it. */
export function AskDialog({ company, row, onClose, onDone }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await reportingApi.ask(row.uid); onDone(); } catch (e) { setError(refusal(e, 'The request could not be sent. Try again.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Ask for this report" title={`Ask ${company} for the ${row.title}?`} onClose={onClose} width={460} phone="sheet" testId="company-ask-dialog"
      footer={<Foot><button type="button" className={BTN} onClick={onClose} disabled={busy}>Cancel</button><button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="company-ask-confirm">Ask for this report</button></Foot>}>
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">The company is told that you asked. Nobody else sees your request.</p>
        <p className={MUTED}>You can ask once per period.</p>
        {error ? <p role="alert" className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="company-ask-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** "Waive this period": once. The record shows it waived by the investor. */
export function WaiveDialog({ company, row, onClose, onDone }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await reportingApi.waive(row.uid); onDone(); } catch (e) { setError(refusal(e, 'The period could not be waived. Try again.')); } finally { setBusy(false); }
  };
  return (
    <Lightbox label="Waive this period" title={`Waive ${row.period} for ${company}?`} onClose={onClose} width={460} phone="sheet" testId="company-waive-dialog"
      footer={<Foot><button type="button" className={BTN} onClick={onClose} disabled={busy}>Back</button><button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="company-waive-confirm">Waive</button></Foot>}>
      <div className="flex flex-col gap-2 px-5 py-4">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">The record shows it waived by you, and the company sees that on its desk. The period is no longer owed to you.</p>
        <p className={MUTED}>It cannot be undone here.</p>
        {error ? <p role="alert" className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="company-waive-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

// ───────────────────────────────────────────────────────────── RPT11: the reader

async function saveDocument(doc) {
  const { blob, filename } = await reportingApi.reportDocument(doc.uid);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || doc.filename || 'statement.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A sent report, 640 wide: every figure by module with its source, what was left out and why, and the statements. */
export function ReportReader({ uid, company, onClose, row = null }) {
  const narrow = usePhoneWidth(SHEET_QUERY);
  const [state, setState] = useState({ status: 'loading', report: null });
  const [docError, setDocError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', report: null });
    reportingApi.report(uid).then((r) => { if (alive) setState({ status: 'ready', report: r }); }, () => { if (alive) setState({ status: 'unreadable', report: null }); });
    return () => { alive = false; };
  }, [uid, tick]);
  const r = state.report;
  const mods = r ? readerModules(r) : { groups: [], leftOut: [] };
  const title = r ? (r.title || `${periodWord(r.period?.label)} report`) : 'Report';
  // RPT21: on a phone the reader is a full-screen sheet with "‹ Reports" in place of the dialog's head.
  return (
    <Lightbox label="Report" eyebrow={narrow ? undefined : `Report from ${company}`} title={narrow ? undefined : title} onClose={onClose} width={640} testId="company-reader"
      footer={<Foot><button type="button" className={BTN} onClick={onClose}>Close</button></Foot>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {narrow ? <SheetHead title={title} pill={row?.pill} line={`${row?.kind || 'Report'} from ${company}`} onBack={onClose} /> : null}
        {state.status === 'loading' ? <div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" aria-busy="true" /> : null}
        {state.status === 'unreadable' ? <Unreadable what="This report" claim="This is not a claim that it was not sent." onRetry={() => setTick((n) => n + 1)} /> : null}
        {r ? (
          <>
            <p className={MUTED} data-testid="company-reader-meta">
              {[r.sent_at ? `Sent ${dayOf(r.sent_at)}` : null, r.revision > 1 ? `revision ${r.revision}` : null, r.corrected_by ? `corrected by revision ${r.corrected_by.revision} on ${dayOf(r.corrected_by.corrected_on)}` : null].filter(Boolean).join(' · ')}
            </p>
            {r.correction_reason ? <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="company-reader-correction">This revision corrects the last: ‘{r.correction_reason}’</p> : null}
            {r.corrected_by?.reason ? <p className={MUTED}>Corrected because: ‘{r.corrected_by.reason}’</p> : null}
            {Array.isArray(r.meets) && r.meets.length ? <p className={MUTED} data-testid="company-reader-meets">Meets {r.meets.map((m) => `${periodWord(m.label)} · ${m.title}`).join('; ')}.</p> : null}
            {r.body ? <p className="m-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100">{r.body}</p> : null}
            {mods.groups.map((g) => (
              <section key={g.module} className="flex flex-col gap-1" data-testid={`company-reader-module-${g.module}`}>
                <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{g.title}</h3>
                {g.figures.map((f) => (
                  <div key={f.key} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-ground py-1.5 text-[12.5px] dark:border-gray-800" data-testid={`company-reader-figure-${f.key}`}>
                    <span className="font-semibold text-axal-ink dark:text-gray-100">{f.label}</span>
                    <span className="tabular-nums">{f.value ?? 'Not recorded'}</span>
                    <span className="w-full text-[11.5px] text-axal-muted dark:text-gray-400">{[f.source, f.asOf ? `as of ${f.asOf}` : null].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
              </section>
            ))}
            {mods.leftOut.length ? (
              <section className="flex flex-col gap-1" data-testid="company-reader-left-out">
                <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Left out, and why</h3>
                {mods.leftOut.map((f) => <p key={f.key} className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100"><b>{f.label}</b> · ‘{f.reason}’</p>)}
              </section>
            ) : null}
            <section className="flex flex-col gap-1" data-testid="company-reader-documents">
              <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Documents</h3>
              {Array.isArray(r.documents) && r.documents.length ? r.documents.map((d) => (
                <button key={d.uid} type="button" className={`${LINK} w-fit text-left text-[12.5px]`} onClick={() => saveDocument(d).catch((e) => setDocError(refusal(e, 'The statement could not be downloaded.')))} data-testid={`company-reader-document-${d.uid}`}>
                  {d.label || d.filename}
                </button>
              )) : <p className={MUTED}>No statement is attached to this report.</p>}
              {docError ? <p role="alert" className="m-0 text-[12px] text-amber-800 dark:text-amber-300">{docError}</p> : null}
            </section>
            <p className={MUTED}>Questions about this report go to the company. A report carries no asks to reply to.</p>
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

// ───────────────────────────────────────────────────────────── RPT21c: a period still owed, on a phone

/** A period not sent, full screen on a phone: its pill, when it was due and what the company said, and Ask pinned at its foot. */
export function PeriodSheet({ company, row, onClose, onAsk, onWaive }) {
  return (
    <Lightbox label={row.title} onClose={onClose} width={560} testId="company-period-sheet"
      footer={(row.canAsk || row.canWaive) ? (
        <Foot>
          {row.canWaive ? <button type="button" className={BTN} onClick={onWaive} aria-haspopup="dialog" data-testid="company-sheet-waive">Waive this period</button> : null}
          {row.canAsk ? <button type="button" className={PRIMARY} onClick={onAsk} aria-haspopup="dialog" data-testid="company-sheet-ask">Ask for this report</button> : null}
        </Foot>
      ) : <Foot><button type="button" className={BTN} onClick={onClose}>Close</button></Foot>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <SheetHead title={`${row.period} update`} pill={row.pill} line={`${row.kind} from ${company}`} onBack={onClose} />
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="company-sheet-due">{row.sub}</p>
        {row.asked ? <p className={MUTED} data-testid="company-sheet-asked">You asked for this report. The company was told; nobody else sees it.</p> : null}
        <p className={MUTED}>{row.canAsk ? 'You can ask once per period. The company sees your request; nobody else does.' : 'You can ask for a report once it is late.'}</p>
      </div>
    </Lightbox>
  );
}

// ───────────────────────────────────────────────────────────── RPT10r: the timeline

export function Timeline({ company, onChanged }) {
  const rows = timelineRows(company);
  const [open, setOpen] = useState(null);
  const narrow = usePhoneWidth(SHEET_QUERY);
  const name = company?.name || 'This company';
  return (
    <section className={CARD} data-testid="company-timeline">
      <h2 className={H2}>Reports owed to you</h2>
      {!rows.length ? <p className={MUTED} data-testid="company-timeline-none">No period has opened yet under the documents you signed.</p> : narrow ? (
        // RPT21b: on a phone each period is one 44px row; it opens the reader, or the period's own sheet.
        <ul className="m-0 list-none p-0" aria-label="Reports owed to you" data-testid="company-timeline-list">
          {rows.map((r) => (
            <li key={r.uid} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800">
              <button type="button" aria-haspopup="dialog" onClick={() => setOpen({ kind: r.reportUid ? 'read' : 'period', row: r })}
                className="flex min-h-11 w-full items-center justify-between gap-3 bg-transparent py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet dark:hover:bg-gray-800"
                data-testid={`company-period-${r.uid}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</span>
                  <span className="text-[12px] text-axal-muted dark:text-gray-400">{r.sub}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1"><Pill pill={r.pill} />{r.asked ? <Pill pill={{ tone: 'neutral', text: 'Asked' }} /> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.uid} className="flex flex-wrap items-start justify-between gap-3 border-b border-axal-ground py-2 last:border-b-0 dark:border-gray-800" data-testid={`company-period-${r.uid}`}>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.title}</div>
                <div className="text-[12px] text-axal-muted dark:text-gray-400">{r.sub}</div>
                <div className="mt-1 flex flex-wrap gap-1.5"><Pill pill={r.pill} />{r.asked ? <Pill pill={{ tone: 'neutral', text: 'Asked' }} /> : null}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.reportUid ? <button type="button" className={BTN} onClick={() => setOpen({ kind: 'read', row: r })} data-testid={`company-period-read-${r.uid}`}>Read</button> : null}
                {r.canAsk ? <button type="button" className={BTN} onClick={() => setOpen({ kind: 'ask', row: r })} data-testid={`company-period-ask-${r.uid}`}>Ask for this report</button> : null}
                {r.canWaive ? <button type="button" className={BTN} onClick={() => setOpen({ kind: 'waive', row: r })} data-testid={`company-period-waive-${r.uid}`}>Waive this period</button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={MUTED}>You can ask once per period, once it is late. The company sees your request; nobody else does.</p>
      {open?.kind === 'read' ? <ReportReader uid={open.row.reportUid} company={name} row={open.row} onClose={() => { setOpen(null); onChanged(); }} /> : null}
      {open?.kind === 'period' ? <PeriodSheet company={name} row={open.row} onClose={() => setOpen(null)} onAsk={() => setOpen({ kind: 'ask', row: open.row })} onWaive={() => setOpen({ kind: 'waive', row: open.row })} /> : null}
      {open?.kind === 'ask' ? <AskDialog company={name} row={open.row} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
      {open?.kind === 'waive' ? <WaiveDialog company={name} row={open.row} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── RPT10t: Terms

export function TermsCard({ company }) {
  const rows = termsRows(company);
  return (
    <section className={CARD} data-testid="company-terms">
      <h2 className={H2}>What {company?.name || 'this company'} owes you</h2>
      <p className={MUTED}>Read only. These come from the documents you signed. To change one, the document is amended.</p>
      {rows.map((d) => (
        <div key={d.uid} className="flex flex-col gap-1 border-t border-axal-ground py-2 dark:border-gray-800" data-testid={`company-term-${d.uid}`}>
          <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{d.title}</span>
          <span className="text-[12px] text-axal-muted dark:text-gray-400">{[d.rule, d.figures].filter(Boolean).join(' · ')}</span>
          <span className="flex flex-wrap gap-1.5">
            <Pill pill={{ tone: d.signed ? 'ok' : 'neutral', text: d.signed ? 'Signed document' : 'From the closing’s template' }} />
            <Pill pill={{ tone: 'neutral', text: `${d.document}${d.clause ? ` ${d.clause}` : ''}` }} />
            {d.defaulted ? <Pill pill={{ tone: 'late', text: 'Default, not in the paper' }} /> : null}
            {d.route ? <Pill pill={{ tone: 'neutral', text: d.route }} /> : null}
          </span>
        </div>
      ))}
    </section>
  );
}
