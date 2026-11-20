/**
 * D7169 (#7169) — Research › Fund dossier › Quarterly reports, built to the
 * `Research Funds Quarterly Reports` canvas (boards FND-Q0 to FND-Q11, D7034).
 *
 * The section shows the latest quarter with its units, a chart with each
 * quarter at its own position, and the history with Edit and Delete. No
 * reports yet, Loading and Failed to load are three separate states: a failed
 * read says Unavailable with Retry and keeps Add quarter off, so a quarter
 * that exists is not added twice. A quarter between two reports with no row
 * is a gap in the chart and a "No report" row, never a joined line.
 *
 * Writes go through `FundReportSheet` (create-only POST, partial PATCH with
 * a revision). After a save focus returns to the saved row and the change is
 * announced; a save whose list re-read failed says so. Delete is Scope →
 * Review → Result with Keep report as the default. Every quarter, figure,
 * source and note on the canvas is sample data; this reads only the Worker.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sheet from '../../ui/Sheet.jsx';
import { StateChip } from '../../ui/Honesty.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { researchFundReportsApi } from '../../lib/api/researchFundReports.js';
import FundReportsChart from './FundReportsChart.jsx';
import FundReportSheet, { holdDraft, readHeld } from './FundReportSheet.jsx';
import {
  FIELD, METRICS, fmtDate, fmtTime, fmtValue, latestReport, periodIndex, periodLabel, periodRange, quarterTimeline, savedSentence,
} from './fundReportsModel.js';

const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-[13px] font-bold text-white hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const DANGER = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-300 bg-white px-3.5 text-[13px] font-bold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-50 dark:border-red-500/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-500/10';
const EYE = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const METRIC_LABEL = { quarterly_return_bps: 'Quarterly return', nav_cents: 'NAV', net_irr_bps: 'Net IRR', tvpi_bps: 'TVPI' };
const UNIT = { nav_cents: 'US$', fund_size_cents: 'US$', quarterly_return_bps: '%', net_irr_bps: '%', tvpi_bps: '×' };

/** A dashed square and the words "No report": a quarter between reports with no row (FND-Q5). */
export function NoReportChip({ label = 'No report' }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-full border-[1.5px] border-dashed border-gray-400 py-px pl-1.5 pr-2 text-[11px] font-bold text-gray-600 dark:border-gray-500 dark:text-gray-400" data-platform-state="no_report">
      <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.5" /></svg>
      {label}
    </span>
  );
}

/** One metric value in one state: the figure, or Not recorded; a measured zero says so. */
export function MetricValue({ field, value, zeroTag = false }) {
  const text = fmtValue(field, value);
  if (text === null) return <StateChip kind="not_recorded" />;
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono font-bold text-axal-ink dark:text-gray-100">{text}</span>
      {zeroTag && value === 0 && <span className="ml-1.5 rounded border border-gray-300 px-1 text-[10px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">measured 0</span>}
    </span>
  );
}

function SourceLink({ report }) {
  if (!report.source_url) return <StateChip kind="not_recorded" />;
  let host = 'Source';
  try { host = new URL(report.source_url).hostname.replace(/^www\./, ''); } catch { /* shown as Source */ }
  return (
    <a href={report.source_url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300" aria-label={`Source for ${periodLabel(report.period)}: ${host} (opens in a new tab)`}>
      {host} ↗
    </a>
  );
}

function LatestStrip({ report, unavailable = false }) {
  const m = (label, field, unit, zeroTag) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={EYE}>{label}</span>
      <div className="text-[15px]">{unavailable ? <StateChip kind="unavailable" /> : <MetricValue field={field} value={report[field]} zeroTag={zeroTag} />}</div>
      <small className="text-[11px] text-axal-muted dark:text-gray-400">{unit}</small>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-axal-hairline bg-gray-50 p-3 sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-800 dark:bg-gray-950" data-testid="fund-reports-latest">
      <div className="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-1">
        <span className={EYE}>Latest reported quarter</span>
        <b className="font-mono text-[16px] text-axal-ink dark:text-gray-100">{periodLabel(report.period)}</b>
        <small className="text-[11px] text-axal-muted dark:text-gray-400">{periodRange(report.period)}{report.report_date ? ` · report dated ${fmtDate(report.report_date)}` : ''}</small>
      </div>
      {m('NAV', 'nav_cents', 'US dollars')}
      {m('Quarterly return', 'quarterly_return_bps', 'percent, this quarter', true)}
      {m('Net IRR', 'net_irr_bps', 'percent, since inception')}
      {m('TVPI', 'tvpi_bps', 'multiple of paid-in')}
      {m('Fund size', 'fund_size_cents', 'US dollars')}
    </div>
  );
}

function MetricSwitch({ metric, setMetric }) {
  const refs = useRef({});
  const move = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = METRICS.indexOf(metric);
    const next = METRICS[(i + (e.key === 'ArrowRight' ? 1 : METRICS.length - 1)) % METRICS.length];
    setMetric(next); refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Chart metric" className="inline-flex flex-wrap rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700" onKeyDown={move}>
      {METRICS.map((k) => (
        <button
          key={k}
          ref={(el) => { refs.current[k] = el; }}
          type="button"
          role="radio"
          aria-checked={metric === k}
          tabIndex={metric === k ? 0 : -1}
          onClick={() => setMetric(k)}
          className={`min-h-[36px] rounded-md px-2.5 text-[12px] font-bold ${metric === k ? 'bg-violet-700 text-white dark:bg-violet-600' : 'text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800'}`}
        >{METRIC_LABEL[k]}</button>
      ))}
    </div>
  );
}

/** The history, oldest first, the same values as the chart (FND-Q1, FND-Q6). */
export function HistoryTable({ timeline, highlight, onEdit, onDelete, onAdd, metricOnly }) {
  const cols = metricOnly ? [metricOnly] : ['nav_cents', 'fund_size_cents', 'quarterly_return_bps', 'net_irr_bps', 'tvpi_bps'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-0 text-left text-[12.5px]" data-testid="fund-reports-table">
        <caption className="pb-2 text-left text-[11.5px] text-axal-muted dark:text-gray-400">
          {metricOnly ? `${METRIC_LABEL[metricOnly]} by quarter, oldest first.` : 'Quarterly reports, oldest first. Same values as the chart.'}
        </caption>
        <thead>
          <tr className="border-b border-axal-hairline text-[11px] uppercase tracking-[.06em] text-axal-muted dark:border-gray-800 dark:text-gray-400">
            <th scope="col" className="py-2 pr-3">Period</th>
            {cols.map((k) => <th key={k} scope="col" className="py-2 pr-3 text-right">{FIELD[k].label} <span className="normal-case">{UNIT[k]}</span></th>)}
            {!metricOnly && <th scope="col" className="py-2 pr-3">Source</th>}
            {!metricOnly && <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
          {timeline.map((q) => (q.report ? (
            <tr key={q.period} id={`fund-report-row-${q.report.uid}`} tabIndex={-1} className={`outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 ${highlight === q.report.uid ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}>
              <th scope="row" className="py-2 pr-3 align-top font-normal">
                <b className="font-mono">{periodLabel(q.period)}</b>
                <small className="block text-[11px] text-axal-muted dark:text-gray-400">{highlight === q.report.uid && fmtTime(q.report.updated_at) ? `updated ${fmtTime(q.report.updated_at)} today` : q.report.report_date ? `dated ${fmtDate(q.report.report_date)}` : periodRange(q.period)}</small>
              </th>
              {cols.map((k) => <td key={k} className="py-2 pr-3 text-right align-top"><MetricValue field={k} value={q.report[k]} zeroTag={k === 'quarterly_return_bps'} /></td>)}
              {!metricOnly && <td className="py-2 pr-3 align-top"><SourceLink report={q.report} /></td>}
              {!metricOnly && (
                <td className="whitespace-nowrap py-2 text-right align-top">
                  <button type="button" className={BTN} aria-label={`Edit ${periodLabel(q.period)} report`} data-edit-for={q.report.uid} onClick={(e) => onEdit(q.report, e.currentTarget)}>Edit</button>{' '}
                  <button type="button" className={`${BTN} text-red-700 dark:text-red-300`} aria-label={`Delete ${periodLabel(q.period)} report`} data-delete-for={q.report.uid} onClick={(e) => onDelete(q.report, e.currentTarget)}>Delete</button>
                </td>
              )}
            </tr>
          ) : (
            <tr key={q.period} className="bg-gray-50/70 dark:bg-gray-950/60">
              <th scope="row" className="py-2 pr-3 align-top font-normal"><b className="font-mono">{periodLabel(q.period)}</b><small className="block text-[11px] text-axal-muted dark:text-gray-400">{periodRange(q.period)}</small></th>
              <td colSpan={cols.length + (metricOnly ? 0 : 1)} className="py-2 pr-3 align-top"><NoReportChip label="No report for this quarter" /> <span className="text-[12px] text-axal-muted dark:text-gray-400">A gap in the chart, never 0.</span></td>
              {!metricOnly && <td className="py-2 text-right align-top"><button type="button" className={BTN} aria-label={`Add a report for ${periodLabel(q.period)}`} onClick={(e) => onAdd(q.period, e.currentTarget)}>Add {periodLabel(q.period)}</button></td>}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneCards({ timeline, highlight, onEdit, onDelete, onAdd }) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="fund-reports-cards">
      {timeline.slice().reverse().map((q) => (q.report ? (
        <div key={q.period} id={`fund-report-row-${q.report.uid}`} tabIndex={-1} className={`${CARD} flex flex-col gap-2 p-3 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 ${highlight === q.report.uid ? 'border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10' : ''}`}>
          <div className="flex items-center justify-between"><b className="font-mono">{periodLabel(q.period)}</b><span className="text-[11px] text-axal-muted dark:text-gray-400">{q.report.report_date ? `dated ${fmtDate(q.report.report_date)}` : periodRange(q.period)}</span></div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
            {['nav_cents', 'quarterly_return_bps', 'net_irr_bps', 'tvpi_bps', 'fund_size_cents'].map((k) => (
              <React.Fragment key={k}><dt className="text-axal-muted dark:text-gray-400">{FIELD[k].label}</dt><dd><MetricValue field={k} value={q.report[k]} zeroTag={k === 'quarterly_return_bps'} /></dd></React.Fragment>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <SourceLink report={q.report} />
            <span className="ml-auto flex gap-1.5">
              <button type="button" className={BTN} aria-label={`Edit ${periodLabel(q.period)} report`} data-edit-for={q.report.uid} onClick={(e) => onEdit(q.report, e.currentTarget)}>Edit</button>
              <button type="button" className={`${BTN} text-red-700 dark:text-red-300`} aria-label={`Delete ${periodLabel(q.period)} report`} data-delete-for={q.report.uid} onClick={(e) => onDelete(q.report, e.currentTarget)}>Delete</button>
            </span>
          </div>
        </div>
      ) : (
        <div key={q.period} className="flex flex-col gap-2 rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-700">
          <div className="flex items-center justify-between"><b className="font-mono">{periodLabel(q.period)}</b><NoReportChip /></div>
          <button type="button" className={BTN} onClick={(e) => onAdd(q.period, e.currentTarget)}>Add {periodLabel(q.period)}</button>
        </div>
      )))}
    </div>
  );
}

function DeleteDialog({ report, timeline, onKeep, onDeleted, fundUid }) {
  const keepRef = useRef(null);
  const [state, setState] = useState('review');
  const label = periodLabel(report.period);
  const i = timeline.findIndex((q) => q.period === report.period);
  const middle = i > 0 && i < timeline.length - 1;
  const remove = async () => {
    setState('deleting');
    try { await researchFundReportsApi.remove(fundUid, report.uid); onDeleted(report); } catch { setState('failed'); }
  };
  return (
    <Sheet
      title={`Delete the ${label} report?`}
      eyebrow="Quarterly reports"
      sub="This removes one quarter from your private dossier. The fund is not told."
      width={480}
      onClose={onKeep}
      initialFocus={keepRef}
      testId="fund-report-delete"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button ref={keepRef} type="button" className={BTN} onClick={onKeep}>Keep report</button>
          <button type="button" className={DANGER} onClick={remove} disabled={state === 'deleting'}>{state === 'deleting' ? 'Deleting…' : `Delete ${label}`}</button>
        </div>
      )}
    >
      <div className="flex flex-col gap-3 px-5 py-4 text-[12.5px]">
        {state === 'failed' && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2.5 font-semibold text-red-800 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200">{label} was not deleted. The server did not answer; try again.</p>}
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5">
          {['nav_cents', 'quarterly_return_bps', 'net_irr_bps', 'tvpi_bps', 'fund_size_cents'].map((k) => (
            <React.Fragment key={k}><dt className="text-axal-muted dark:text-gray-400">{FIELD[k].label}</dt><dd><MetricValue field={k} value={report[k]} /></dd></React.Fragment>
          ))}
          <dt className="text-axal-muted dark:text-gray-400">Source</dt><dd><SourceLink report={report} /></dd>
        </dl>
        <p className="text-axal-muted dark:text-gray-400">{middle ? `After deletion ${label} becomes a gap in the chart and a “No report” row.` : `After deletion the history ${i === 0 ? 'starts' : 'ends'} at the next reported quarter.`}</p>
      </div>
    </Sheet>
  );
}

export default function FundReportsPanel({ fundUid }) {
  const phone = usePhoneWidth();
  const [read, setRead] = useState({ status: 'loading', items: [] });
  const [savedAt, setSavedAt] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [del, setDel] = useState(null);
  const [metric, setMetric] = useState('quarterly_return_bps');
  const [announce, setAnnounce] = useState('');
  const [highlight, setHighlight] = useState(null);
  const [focusTo, setFocusTo] = useState(null);
  const [held, setHeld] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const headingRef = useRef(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const mine = ++gen.current;
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const res = await researchFundReportsApi.list(fundUid);
      if (mine !== gen.current) return true;
      setRead({ status: 'ok', items: Array.isArray(res?.items) ? res.items : [] });
      return true;
    } catch {
      if (mine !== gen.current) return false;
      setRead({ status: 'failed', items: [] });
      return false;
    }
  }, [fundUid]);
  useEffect(() => { setSavedAt(null); load(); setHeld(readHeld(fundUid)); }, [load, fundUid]);

  // Focus moves after the list has drawn: the saved row, the next row after a delete, or the heading.
  useEffect(() => {
    if (!focusTo || read.status !== 'ok') return undefined;
    const el = (focusTo.uid && document.getElementById(`fund-report-row-${focusTo.uid}`)) || headingRef.current;
    el?.focus?.();
    setFocusTo(null);
    if (!focusTo.highlight) return undefined;
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [focusTo, read.status]);

  const items = read.items;
  const timeline = quarterTimeline(items);
  const latest = latestReport(items);
  const valuesFor = timeline.filter((q) => q.report && typeof q.report[metric] === 'number').length;
  const ready = read.status === 'ok';

  const openAdd = (period) => { if (ready) setSheet({ period: period || null }); };
  const openEdit = (report) => setSheet({ saved: report });
  const onChartOpen = (q) => (q.report ? openEdit(q.report) : openAdd(q.period));

  const onSaved = async ({ report, period, changes, added }) => {
    setSheet(null);
    const sentence = savedSentence(period, changes, { added });
    const ok = await load();
    if (ok) {
      setSavedAt(null);
      setAnnounce(sentence);
      setHighlight(report?.uid || null);
      setFocusTo({ uid: report?.uid, highlight: true });
    } else {
      setSavedAt(fmtTime(report?.updated_at) || 'just now');
      setAnnounce(`${sentence} The list could not be re-read.`);
    }
  };

  const onDeleted = async (report) => {
    setDel(null);
    const after = timeline.find((q) => q.report && periodIndex(q.period) > periodIndex(report.period))
      || timeline.slice().reverse().find((q) => q.report && periodIndex(q.period) < periodIndex(report.period));
    await load();
    setAnnounce(`${periodLabel(report.period)} report deleted.`);
    setFocusTo({ uid: after?.report?.uid || null });
  };

  const resumeHeld = () => {
    const saved = held.reportUid ? items.find((r) => r.uid === held.reportUid) : null;
    setSheet(saved ? { saved, draft: { fields: held.fields } } : { period: held.period, draft: { fields: held.fields } });
    setHeld(null);
  };

  const addButton = (
    <button
      type="button"
      className={`${PRIMARY} ${phone ? 'min-h-[48px] w-full' : ''}`}
      aria-disabled={ready ? undefined : 'true'}
      title={ready ? undefined : read.status === 'failed' ? 'Off while the list is unknown, so a quarter is not added twice' : 'Held until the list has loaded'}
      onClick={() => openAdd(null)}
      data-testid="fund-reports-add"
    >Add quarter</button>
  );

  return (
    <section data-testid="fund-quarterly-reports" aria-labelledby="fund-reports-heading" className={`${CARD} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="fund-reports-heading" ref={headingRef} tabIndex={-1} className="text-[16px] font-extrabold tracking-tight text-axal-ink outline-none dark:text-gray-100">Quarterly reports</h2>
          <p className="mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">Sourced snapshots you entered. A blank metric stays blank; nothing is estimated.</p>
        </div>
        {(ready && items.length > 0) || !phone ? addButton : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="fund-reports-announce">{read.status === 'loading' ? 'Loading quarterly reports.' : announce}</p>

      {held && ready && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] dark:border-amber-500/50 dark:bg-amber-500/10">
          <b>Your unsaved edit{held.period ? ` to ${periodLabel(held.period)}` : ''} is held in this tab.</b>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={resumeHeld}>Resume editing</button>
            <button type="button" className={BTN} onClick={() => { holdDraft(fundUid, null); setHeld(null); }}>Discard it</button>
          </div>
        </div>
      )}

      {savedAt && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-gray-50 p-3 text-[12.5px] dark:border-gray-700 dark:bg-gray-950">
          <div className="min-w-0 flex-1"><b>Saved at {savedAt}.</b> <span className="text-axal-muted dark:text-gray-400">The list could not be re-read, so its values show as Unavailable.</span></div>
          <button type="button" className={BTN} onClick={async () => { if (await load()) setSavedAt(null); }}>Retry</button>
        </div>
      )}

      {read.status === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-2" data-platform-state="loading">
          <span className="h-[46px] rounded-lg bg-gray-200 dark:bg-gray-800" />
          <span className="h-[110px] rounded-lg bg-gray-200 dark:bg-gray-800" />
          <span className="h-[22px] rounded-lg bg-gray-200 dark:bg-gray-800" />
          <span className="h-[22px] rounded-lg bg-gray-200 dark:bg-gray-800" />
        </div>
      )}

      {read.status === 'failed' && (
        <>
          {!savedAt && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-[12.5px] dark:border-red-500/50 dark:bg-red-500/10" data-testid="fund-reports-failed">
              <div className="min-w-0 flex-1"><b className="text-red-800 dark:text-red-200">Quarterly reports could not be read.</b><div className="text-axal-muted dark:text-gray-300">This is not a claim that none exist. Nothing you entered is lost.</div></div>
              <button type="button" className={PRIMARY} onClick={load}>Retry</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><span className={EYE}>Latest quarter</span><div className="mt-1"><StateChip kind="unavailable" /></div></div>
            <div><span className={EYE}>History</span><div className="mt-1"><StateChip kind="unavailable" /></div></div>
          </div>
        </>
      )}

      {ready && !items.length && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700" data-testid="fund-reports-empty">
          <b className="text-[13.5px]">No quarterly reports yet</b>
          <p className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">Add the first quarter from a published source, like a GP letter. The chart appears once two quarters have a value; a quarter without a report stays a gap.</p>
          <button type="button" className={`${PRIMARY} self-start`} onClick={() => openAdd(null)}>Add first quarter</button>
        </div>
      )}

      {ready && items.length > 0 && latest && (
        <>
          <LatestStrip report={latest} />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MetricSwitch metric={metric} setMetric={setMetric} />
              {phone
                ? <button type="button" className={BTN} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>Table</button>
                : <span className="text-[11px] text-axal-muted dark:text-gray-400">Each quarter at its own position · gaps stay gaps</span>}
            </div>
            {valuesFor < 2 ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-3 text-[12.5px] text-axal-muted dark:border-gray-700 dark:text-gray-400">
                At least two sourced quarterly observations are needed to draw a trend. Current observations of {METRIC_LABEL[metric].toLowerCase()}: {valuesFor}.
              </div>
            ) : (
              <FundReportsChart timeline={phone ? timeline.slice(-4) : timeline} metric={metric} onOpen={onChartOpen} compact={phone} />
            )}
          </div>
          {phone
            ? (asTable ? <HistoryTable timeline={timeline} metricOnly={metric} /> : <PhoneCards timeline={timeline} highlight={highlight} onEdit={openEdit} onDelete={setDel} onAdd={openAdd} />)
            : <HistoryTable timeline={timeline} highlight={highlight} onEdit={openEdit} onDelete={setDel} onAdd={openAdd} />}
        </>
      )}

      {sheet && (
        <FundReportSheet
          key={sheet.saved?.uid || sheet.period || 'add'}
          fundUid={fundUid}
          reports={items}
          initial={sheet}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
      {del && (
        <DeleteDialog report={del} timeline={timeline} fundUid={fundUid} onKeep={() => setDel(null)} onDeleted={onDeleted} />
      )}
    </section>
  );
}
