import React, { useEffect, useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Unreadable } from '../../../ui';
import { Chart, ChartTable, Legend } from '../../../ui/Charts.jsx';
import {
  ACTIONS, DEFAULT_PERIOD, LINK_NOTE, PERIODS, ZERO_NOTE,
  chartAlt, chartTitle, dailyChart, investorRows, logCount, logRows, periodQuery, phoneDays, totalsLine,
} from './activityModel';

/**
 * D1108 (#2988) — Activity (DR10, DR11 in the dark colours, DR22c on a phone):
 * events by day for the chosen period against the same days before, events by
 * investor, the event log with its filters and pages, and Export (CSV). Every
 * figure is D1105's read; a link issued is never drawn as a read, and a
 * refusal is never an open (`activityModel.js`).
 *
 * Export downloads the log's rows as a file; it changes nothing, so it opens
 * no dialog. A refusal (more than 10,000 rows) is said in one sentence.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const SELECT = 'min-h-[32px] rounded-full border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SEG_ON = 'border-axal-violet bg-axal-lavender font-bold text-axal-violet-deep dark:border-[#a78bfa] dark:bg-violet-900/30 dark:text-[#a78bfa]';
const SEG_OFF = 'border-axal-hairline font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const LEGEND = [
  { label: 'Room opens', tone: 'violet', mark: 'line' },
  { label: 'Links issued', tone: 'sky', mark: 'line' },
  { label: 'Blocked by the NDA', tone: 'amber', mark: 'line' },
];

function Block({ title, aside, children, testId, foot }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title}</h2>
        {aside}
      </div>
      <div className="px-4 py-3">{children}</div>
      {foot ? <p className={`m-0 border-t border-axal-hairline px-4 py-2.5 text-[11.5px] dark:border-gray-800 ${MUTED}`}>{foot}</p> : null}
    </section>
  );
}

function Segments({ value, onChange, label, testId }) {
  return (
    <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label} data-testid={testId}>
      {PERIODS.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={value === p.id} onClick={() => onChange(p.id)}
          className={`min-h-[30px] rounded-full border px-3 text-[12px] ${value === p.id ? SEG_ON : SEG_OFF}`} data-testid={`${testId}-${p.id}`}>
          {p.label}
        </button>
      ))}
    </span>
  );
}

function useActivity(projectUid, q, reload) {
  const [state, setState] = useState({ status: 'loading', read: null });
  const key = JSON.stringify(q);
  useEffect(() => {
    if (!projectUid) return undefined;
    let alive = true;
    setState((s) => (s.read ? { ...s, refreshing: true } : { status: 'loading', read: null }));
    dataRoomApi.activity(projectUid, q)
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch(() => { if (alive) setState({ status: 'error', read: null }); });
    return () => { alive = false; };
  }, [projectUid, key, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export default function DataRoomActivity({ projectUid, phone = false }) {
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [investor, setInvestor] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [asTable, setAsTable] = useState(false);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportLine, setExportLine] = useState(null);
  const [readers, setReaders] = useState([]);
  const q = { ...periodQuery(period), investor: investor || undefined, action: action || undefined, page };
  const { status, read } = useActivity(projectUid, q, reload);

  // The investor filter offers every reader with a grant from the unfiltered read.
  useEffect(() => {
    if (status === 'ready' && !investor) setReaders(investorRows(read).filter((r) => r.grantUid));
  }, [status, read, investor]);

  const pick = (fn) => (v) => { fn(v); setPage(1); };
  const exportCsv = async () => {
    setExporting(true); setExportLine(null);
    try {
      await dataRoomApi.activityCsv(projectUid, { ...periodQuery(period), investor: investor || undefined, action: action || undefined });
    } catch (e) {
      setExportLine(Number(e?.status) === 413
        ? 'More than 10,000 rows. Choose a shorter period, one investor or one event, then export again.'
        : 'The export did not go through. Try again.');
    } finally { setExporting(false); }
  };

  const range = (
    <div className="flex flex-wrap items-center gap-2.5" data-testid="dataroom-activity-range">
      <span className={EYEBROW}>Range</span>
      <Segments value={period} onChange={pick(setPeriod)} label="Range" testId="dataroom-activity-period" />
      {!phone && readers.length ? (
        <select aria-label="Investor" className={SELECT} value={investor} onChange={(e) => pick(setInvestor)(e.target.value)} data-testid="dataroom-activity-investor">
          <option value="">Every investor</option>
          {readers.map((r) => <option key={r.grantUid} value={r.grantUid}>{r.who}</option>)}
        </select>
      ) : null}
      {!phone ? (
        <button type="button" className={`${BTN} ml-auto`} onClick={exportCsv} disabled={exporting || status !== 'ready'} data-testid="dataroom-activity-export">
          {exporting ? 'Exporting…' : 'Export (CSV)'}
        </button>
      ) : null}
      {exportLine ? <p role="alert" className="m-0 w-full text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="dataroom-activity-export-refused">{exportLine}</p> : null}
    </div>
  );

  if (status === 'loading') {
    return <div className="flex flex-col gap-4">{range}<div className="h-40 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="dataroom-activity-loading" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-4">
        {range}
        <div data-testid="dataroom-activity-unreadable">
          <Unreadable what="Activity" claim="This is not a claim that nobody opened the room." onRetry={() => setReload((n) => n + 1)} />
        </div>
      </div>
    );
  }

  const chart = dailyChart(read);
  const investors = investorRows(read);
  const log = logRows(read);
  const pages = Number(read?.log?.pages) || 1;

  if (phone) {
    const days = phoneDays(read);
    return (
      <div className="flex flex-col gap-3" data-testid="dataroom-activity-phone">
        {range}
        <Block title="Activity by day" testId="dataroom-activity-days" foot={`The last ${days.length} days of the period. A link issued is not a read.`}>
          <table className="w-full border-collapse">
            <thead><tr><th className={TH}>Day</th><th className={`${TH} text-right`}>Opened</th><th className={`${TH} text-right`}>Links</th><th className={`${TH} text-right`}>Blocked</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid="dataroom-activity-day">
                  <td className={`${TD} ${MONO}`}>{d.day}</td>
                  <td className={`${TD} text-right ${MONO}`}>{d.opened}</td>
                  <td className={`${TD} text-right ${MONO}`}>{d.downloaded}</td>
                  <td className={`${TD} text-right ${MONO}`}>{d.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
        <Block title="By investor" testId="dataroom-activity-investors">
          {investors.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {investors.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 border-b border-axal-hairline py-2 last:border-0 dark:border-gray-800" data-testid="dataroom-activity-investor-row">
                  <span className="flex min-w-0 flex-col"><strong className={`text-[13px] ${INK}`}>{r.who}</strong><span className={`text-[11.5px] ${MUTED}`}>{r.last}</span></span>
                  <span className={`text-[12px] ${MONO} ${INK}`}>{r.opened} opens</span>
                </li>
              ))}
            </ul>
          ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-activity-investors-none">No investor has an event in this period.</p>}
        </Block>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="dataroom-activity">
      {range}
      <Block title={chartTitle(read)} testId="dataroom-activity-chart" foot={totalsLine(read)}
        aside={(
          <span className="flex items-center gap-3">
            <Legend items={LEGEND} />
            <button type="button" className={BTN} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} data-testid="dataroom-activity-astable">
              {asTable ? 'View as chart' : 'View as table'}
            </button>
          </span>
        )}>
        {asTable
          ? <ChartTable chart={chart} caption={chartTitle(read)} />
          : <div role="img" aria-label={chartAlt(read)}><div aria-hidden="true"><Chart chart={chart} /></div></div>}
      </Block>
      <Block title="By investor" testId="dataroom-activity-investors" foot={ZERO_NOTE}>
        {investors.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Investor</th><th className={`${TH} text-right`}>Room opens</th><th className={`${TH} text-right`}>Links issued</th><th className={`${TH} text-right`}>Blocked</th><th className={TH}>Last event</th></tr>
              </thead>
              <tbody>
                {investors.map((r) => (
                  <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid="dataroom-activity-investor-row">
                    <td className={`${TD} font-bold`}>{r.who}</td>
                    <td className={`${TD} text-right ${MONO}`}>{r.opened}</td>
                    <td className={`${TD} text-right ${MONO}`}>{r.downloaded}</td>
                    <td className={`${TD} text-right ${MONO}`}>{r.blocked}</td>
                    <td className={TD}>{r.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-activity-investors-none">No investor has an event in this period.</p>}
      </Block>
      <Block title="Event log" testId="dataroom-activity-log" foot={LINK_NOTE}
        aside={(
          <span className="flex items-center gap-2">
            <select aria-label="Event" className={SELECT} value={action} onChange={(e) => pick(setAction)(e.target.value)} data-testid="dataroom-activity-action">
              {ACTIONS.map((a) => <option key={a.id || 'all'} value={a.id}>{a.label}</option>)}
            </select>
            <span className={`text-[11.5px] ${MONO} ${MUTED}`} data-testid="dataroom-activity-count">{logCount(read)}</span>
          </span>
        )}>
        {log.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><th className={TH}>Time (UTC)</th><th className={TH}>Investor</th><th className={TH}>Event</th></tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid="dataroom-activity-log-row">
                    <td className={`${TD} whitespace-nowrap ${MONO}`}>{r.when}</td>
                    <td className={`${TD} font-bold`}>{r.who}</td>
                    <td className={TD}>{r.event}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-activity-log-none">Nothing in the log for this period.</p>}
        {pages > 1 ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="dataroom-activity-prev">Newer</button>
            <span className={`text-[11.5px] ${MONO} ${MUTED}`}>Page {page} of {pages}</span>
            <button type="button" className={BTN} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="dataroom-activity-next">Older</button>
          </div>
        ) : null}
      </Block>
    </div>
  );
}
