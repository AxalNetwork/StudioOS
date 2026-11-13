import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart, ChartTable, Legend, usePhoneWidth } from '../../../ui';
import { PROGRAMS, programGroups } from '../../../lib/programGrants';
import { GrantLightbox } from './GrantDialogs';
import {
  HOLDING_SERIES, MONTH_SERIES, UNREADABLE, gridRows, holdingChart, holdingRows, monthsChart, tilesOf,
} from './grantsModel';

/**
 * D987 (#2778) — GR1: the four tiles, "Studios holding each program" and
 * "Requests by month", and the grid of studios against the nine programs from
 * D982's read. A studio's name opens its page (GR3); an empty grantable cell
 * offers Grant (GR4). A phone lists the studios with their programs as chips
 * (GR15b).
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const DANGER = 'inline-flex min-h-[36px] items-center justify-center self-start rounded-[9px] border border-axal-destructive-edge bg-white px-3.5 text-[12.5px] font-bold text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400';
const ALERT = 'flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3.5 py-3 text-[13px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';

export const PILL_TONE = {
  granted: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  own: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  requested: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  paused: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  draft: 'border-dashed border-axal-muted bg-white text-axal-muted dark:bg-gray-900 dark:text-gray-400',
};

export function Pill({ cell, testId }) {
  if (!cell.pill) return null;
  return (
    <span className={`relative inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${PILL_TONE[cell.kind] || PILL_TONE.paused}`} data-testid={testId}>
      {cell.pill}
      {cell.kind === 'own' ? <span aria-label="own terms" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#0ea5e9]" /> : null}
    </span>
  );
}

function Skeleton() { return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />; }

export function Tile({ t, testId }) {
  return (
    <div className={`${CARD} flex flex-col gap-1.5 px-4 py-3.5`} data-testid={testId}>
      <span className={EYE}>{t.label}</span>
      {t.loading ? <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></> : t.unreadable ? (
        <><span className="text-[15px] font-bold text-axal-muted dark:text-gray-400">{UNREADABLE}</span><span className={SUB}>{t.reason}</span></>
      ) : (
        <>
          <span className={`${MONO} text-[26px] font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{typeof t.value === 'number' ? t.value.toLocaleString('en-US') : t.value ?? 'Not recorded'}</span>
          {t.flag ? <span className="self-start rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-axal-destructive dark:bg-red-950/40 dark:text-red-300">● {t.flag}</span> : null}
          <span className={SUB}>{t.sub}</span>
        </>
      )}
    </div>
  );
}

/** A chart block with its Chart / Table toggle and its alt sentence; a failed read is its own Unreadable. */
export function ChartBlock({ title, id, chart, legend, unreadable, onRetry, span }) {
  const [table, setTable] = useState(false);
  return (
    <section className={`${CARD} col-span-12 flex min-w-0 flex-col gap-2.5 px-[18px] py-4 ${span}`} aria-labelledby={`grants-h-${id}`} data-testid={`grants-chart-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`grants-h-${id}`} className={H2}>{title}</h2>
        {chart ? (
          <span role="group" aria-label="View" className="inline-flex rounded-[8px] border border-axal-hairline text-[12px] dark:border-gray-700">
            <button type="button" aria-pressed={!table} onClick={() => setTable(false)} className={`px-2.5 py-1 ${!table ? 'font-bold text-axal-ink dark:text-gray-100' : 'text-axal-muted'}`}>Chart</button>
            <button type="button" aria-pressed={table} onClick={() => setTable(true)} className={`px-2.5 py-1 ${table ? 'font-bold text-axal-ink dark:text-gray-100' : 'text-axal-muted'}`} data-testid={`grants-chart-${id}-table`}>Table</button>
          </span>
        ) : null}
      </div>
      {unreadable ? (
        <div role="alert" className={ALERT}><span>{unreadable}</span><button type="button" className={DANGER} onClick={onRetry}>Try again</button></div>
      ) : !chart ? <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></> : (
        <>
          <Legend items={legend} />
          {table ? <ChartTable chart={chart} caption={title} /> : <div role="img" aria-label={chart.alt}><Chart chart={chart} /></div>}
          {chart.foot ? <span className={SUB}>{chart.foot}</span> : null}
        </>
      )}
    </section>
  );
}

export default function GridView({ grid, requests, reload, reloadGrid, reloadRequests }) {
  const phone = usePhoneWidth();
  const [now] = useState(() => Date.now());
  const [granting, setGranting] = useState(null);
  const [done, setDone] = useState('');
  const items = requests.status === 'ready' ? requests.data?.items || [] : [];
  const g = grid.status === 'ready' ? grid.data : null;
  const rows = useMemo(() => (g ? gridRows(g, items) : []), [g, items]);
  const tiles = useMemo(() => (g ? tilesOf(g, requests, now) : null), [g, requests, now]);
  const holding = useMemo(() => (g ? holdingChart(holdingRows(g, items)) : null), [g, items]);
  const months = useMemo(() => (g ? monthsChart(g.series?.requests_by_month) : null), [g]);
  const groups = programGroups();
  const defaults = new Map((g?.programs || []).map((p) => [p.program_key, p]));
  const LABELS = ['Studios with a licence', 'Grants in force', 'Requests waiting', 'Ending in 90 days'];

  return (
    <div className="flex flex-col gap-3.5" data-testid="grants-grid-view">
      {done ? <p role="status" className="m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="grants-done">{done}</p> : null}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="grants-tiles">
        {grid.status === 'error'
          ? LABELS.map((label, i) => <Tile key={label} t={{ label, unreadable: true, reason: 'Not read with the grid.' }} testId={`grants-tile-${i}`} />)
          : (tiles || LABELS.map((label) => ({ label, loading: true }))).map((t, i) => <Tile key={t.label} t={t} testId={`grants-tile-${t.key || i}`} />)}
      </div>

      <div className="grid grid-cols-12 gap-3.5">
        <ChartBlock title="Studios holding each program" id="holding" chart={holding} legend={HOLDING_SERIES} span="lg:col-span-8"
          unreadable={grid.status === 'error' ? 'Program grants could not be read. That is not the same as none.' : null} onRetry={reloadGrid} />
        <ChartBlock title="Requests by month" id="months" chart={months} legend={MONTH_SERIES} span="lg:col-span-4"
          unreadable={grid.status === 'error' ? 'Program grants could not be read.' : g && !months ? (g.series?.requests_by_month_reason || 'Requests could not be read.') : null}
          onRetry={g && !months ? reloadRequests : reloadGrid} />
      </div>

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="grants-h-grid" data-testid="grants-grid">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="grants-h-grid" className={H2}>Grants by studio</h2>
          {!phone ? <span className={SUB}>Scroll sideways · the studio column stays</span> : null}
        </div>
        {grid.status === 'loading' && !g ? <><span className="font-mono text-[13px] text-axal-muted">Reading…</span><Skeleton /></> : null}
        {grid.status === 'error' ? (
          <div role="alert" className={ALERT} data-testid="grants-unreadable">
            <span>Program grants could not be read. That is not the same as none.</span>
            <button type="button" className={DANGER} onClick={reloadGrid}>Try again</button>
          </div>
        ) : null}
        {requests.status === 'error' && g ? <p className={`m-0 ${SUB}`} data-testid="grants-requests-unread">Requests could not be read, so a requested program shows as not granted here until they are.</p> : null}
        {g && rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="grants-empty">
            <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">No studio holds a licence yet.</span>
            <span className={SUB}>Issue one in the ledger, then grant programs here.</span>
            <Link to="/admin/licences" className="font-bold text-axal-violet underline dark:text-violet-300">Open the ledger</Link>
          </div>
        ) : null}
        {g && rows.length > 0 && phone ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="grants-phone-list">
            {rows.map((r) => (
              <li key={r.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`grants-card-${r.ref}`}>
                <Link to={`/admin/licences/programs/studio/${encodeURIComponent(r.uid)}`} className="font-bold text-axal-violet dark:text-violet-300">{r.name}</Link>
                <span className={`${MONO} ${SUB}`}>{r.ref} · {r.statusWord}</span>
                <span className="flex flex-wrap gap-1.5">
                  {r.cells.filter((c) => c.pill && c.program.grant === 'yes').map((c) => <Pill key={c.program.key} cell={{ ...c, pill: `${c.pill.split(' ')[0]} ${c.program.name}` }} />)}
                  {!r.cells.some((c) => c.pill && c.program.grant === 'yes') ? <span className={SUB}>○ Nothing granted</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {g && rows.length > 0 && !phone ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1428px] border-collapse text-left text-[12px]">
              <thead>
                <tr className={EYE}>
                  <th scope="col" rowSpan={2} className="sticky left-0 z-10 bg-white py-1.5 pr-3 font-bold dark:bg-gray-900">Studio</th>
                  {groups.map((x) => <th key={x.group} scope="colgroup" colSpan={x.span} className="border-l border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-700">{x.group}</th>)}
                </tr>
                <tr className="text-[11.5px] text-axal-ink dark:text-gray-100">
                  {PROGRAMS.map((p) => (
                    <th key={p.key} scope="col" className={`border-l border-axal-hairline px-2 py-1.5 font-bold dark:border-gray-700 ${p.grant === 'notready' ? 'text-axal-muted' : ''}`}>
                      {p.name}{p.note ? <span className={`block font-normal ${SUB}`}>{p.note}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-t border-axal-hairline align-top dark:border-gray-700" data-testid={`grants-row-${r.ref}`}>
                    <th scope="row" className="sticky left-0 z-10 bg-white py-2 pr-3 font-normal dark:bg-gray-900">
                      <Link to={`/admin/licences/programs/studio/${encodeURIComponent(r.uid)}`} className="block font-bold text-axal-violet hover:underline dark:text-violet-300" title={`${r.name} · licence ${r.ref}`}>{r.name}</Link>
                      <span className={`block ${SUB}`}>{r.kind} · {r.statusWord}</span>
                      <span className={`block ${MONO} ${SUB}`}>{r.ref}</span>
                      {r.note ? <span className={`mt-1 block text-[11.5px] ${r.frozen ? 'text-axal-destructive dark:text-red-400' : 'text-axal-muted'}`}>{r.note}</span> : null}
                    </th>
                    {r.cells.map((c) => (
                      <td key={c.program.key} title={c.tip} aria-label={c.tip} data-testid={`grants-cell-${r.ref}-${c.program.key}`}
                        className={`border-l border-axal-hairline px-2 py-2 dark:border-gray-700 ${c.kind === 'hq' ? 'bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(107,101,119,.12)_4px,rgba(107,101,119,.12)_8px)] text-[11px] text-axal-muted' : c.kind === 'notready' ? 'bg-axal-ground text-axal-faint dark:bg-gray-800 dark:text-gray-500' : ''} ${r.frozen && c.program.grant === 'yes' ? 'opacity-60' : ''}`}>
                        {c.kind === 'hq' || c.kind === 'notready' ? c.pill : null}
                        {c.kind !== 'hq' && c.kind !== 'notready' && c.pill ? <Pill cell={c} /> : null}
                        {c.sub ? <span className={`block ${MONO} text-[11px] ${c.waiting ? 'text-amber-800 dark:text-amber-300' : 'text-axal-muted'}`}>{c.sub}</span> : null}
                        {c.canGrant ? (
                          <button type="button" onClick={() => setGranting({ row: r, program: c.program })} className="mt-0.5 rounded-[7px] border border-axal-lavender-edge px-2 py-0.5 text-[11.5px] font-bold text-axal-violet hover:bg-axal-lavender dark:border-violet-800 dark:text-violet-300" data-testid={`grants-grant-${r.ref}-${c.program.key}`}>+ Grant</button>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {g ? <span className={SUB}>A studio name opens its page. + Grant opens a grant on the program’s default terms.</span> : null}
      </section>

      {granting ? (
        <GrantLightbox mode="grant" licence={{ uid: granting.row.uid, licence_ref: granting.row.ref, brand_name: granting.row.name, status: granting.row.status }}
          defaults={defaults.get(granting.program.key)} onClose={() => setGranting(null)}
          onDone={() => { setDone(`${granting.program.name} granted to ${granting.row.name}.`); setGranting(null); reload(); }} />
      ) : null}
    </div>
  );
}
