import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Pill } from '../../ui';
import { Unreadable, Unrecorded } from '../../ui/Honesty';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { api } from '../../lib/api';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import MarketDirectoryPanel, { CoverageNote } from './MarketDirectory.jsx';
import { DIRECTORY_TABS, MARKET_SORTS, readMarketQuery, writeMarketQuery, sectorSlug } from './marketDirectoryQuery.js';
import { researchOverviewApi } from '../../lib/api/researchOverview.js';
import { researchSectorsApi } from '../../lib/api/researchSectors.js';
import { SaveNote } from '../advisor/expertise/kit';
import { STALE_AT, ageBand, daysSince } from './marketReadingRead';
import { comparableCount, dollarsToCents, freshReadingForm, rangeReadsForward } from './marketReadingRead';
import { LatestSignals } from './RankedSignals.jsx';

import { PublicPanel, ScopedExport } from './ListedCompaniesPanel.jsx';
import { LISTED_CSV_HEADER, MARKET_CSV_HEADER, changeListedQuery, clearListedFilters, collectMarkets,
  listedCsvCells, listedExport, listedRequest, marketCsvCells, marketExport, readListedQuery, writeTab } from './listedCompaniesRead.js';
import { exportFileName, exportView } from '../../lib/csvExport';

export { LatestSignals };
export const MARKET_TABS = DIRECTORY_TABS;
export { LISTED_PAGE } from './listedCompaniesRead.js';
export { PublicPanel };

/**
 * Research · Markets (`/research/markets`), to the Markets canvas
 * (`design/incoming/Research · Markets.dc.html`, D546). Issue #1080, D533.
 *
 * EVERY NUMBER HERE IS READ FROM THE WORKER. The page used to print the
 * bundled `marketDirectory.json` and an ETF snapshot whose 1D/1Y line was red
 * whatever its sign. It now reads `/api/research/markets`,
 * `/api/research/sectors`, `/api/research/listed-companies`,
 * `/api/research/geographies` and the signals feed, and prints the totals
 * those answer with.
 *
 * FOUR STATES, PER SECTION. Each card loads on its own, so one failed read
 * says "could not be read" on that card and leaves the others standing:
 * loading, unreadable (the read failed; nothing is known either way), empty
 * (the read worked and holds nothing), and the rows.
 *
 * WHAT NO SOURCE HOLDS reads "Not recorded" with the reason: government-owned
 * companies (no source names an owner, EDGAR included; D537, #1083 answer 3A).
 * The top movers read the Research overview's live heat grid (D536).
 *
 * D595 — THE PUBLIC TAB READS TWO STORES, each row labelled: the signal
 * companies with their bands, and SEC EDGAR's companies (migration 404) with
 * what EDGAR records. The Worker pages the list; this page asks for one page
 * at a time and prints the totals and the source lines the API sends.
 *
 * D593 — EVERY TRACKED SECTOR IS A GROUP, and each opens its own page. The
 * sector list is `GET /api/research/sectors` (D547), not a list written here:
 * a sector no market maps to yet still has a group, saying so, with its
 * "Open sector →" link. The markets no sector claims sit last, under
 * "Not mapped yet" (canvas M1).
 *
 * D593 — A COMPARABLE RANGE IS RECORDED HERE AGAIN. `MarketZone` held the only
 * "Record a reading" form, and nothing has mounted it since the directory
 * replaced it, so nobody could record a first reading. The form now sits in the
 * "Your market readings" card. `POST /api/research/market-readings` asks only
 * that the caller is signed in (its service line, when one is named, must be
 * theirs), and `MarketZone` checked no licence either, so every licence that
 * reaches this page gets it once its list has been read. That includes an
 * empty list, where `MarketZone` showed only its empty state: the Worker takes
 * a reading named by what it prices, with no catalog service line behind it.
 * A save opens the new reading.
 */

/**
 * D7171 (#7171, canvas D7036): two tabs, Market directory and Listed
 * companies, kept in the URL (`?tab=listed`). Government ownership is no
 * longer a tab that always says Not recorded: the coverage note says why it is
 * not available. The directory's view and its URL live in
 * `marketDirectoryQuery.js`; the directory itself is `MarketDirectory.jsx`.
 */
export { DIRECTORY_TABS, MARKET_SORTS, readMarketQuery, writeMarketQuery, sectorSlug };

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));

/**
 * One section's read: `{ status: 'loading' | 'unreadable' | 'not_found' | 'ready', data }`.
 * `key` re-runs it when what it reads changes; `fn` is read through a ref so
 * an inline arrow does not re-fire it on every render.
 */
export function useRead(fn, key = '') {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    fnRef.current().then((data) => { if (live) setState({ status: 'ready', data }); })
      // A 404 is an answer (there is no such thing), not a failed read.
      .catch((e) => { if (live) setState({ status: e?.status === 404 ? 'not_found' : 'unreadable', data: null }); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => load(), [load]);
  return [state, load];
}

function Loading({ what }) {
  return <p className="text-[12px] text-axal-muted" role="status">Loading {what}…</p>;
}

function Caption({ children }) {
  return <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">{children}</p>;
}

function Bar({ value, max }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return <span className="block h-1.5 rounded-full bg-violet-100 dark:bg-violet-950"><span className="block h-1.5 rounded-full bg-violet-500" style={{ width: `${w}%` }} /></span>;
}

export function WhereBased({ geos }) {
  const SHOWN = 12;
  let body;
  if (geos.status === 'loading' && !geos.data) body = <Loading what="the countries" />;
  else if (geos.status === 'unreadable') body = <Unreadable what="The countries" claim="This is not a sign the companies have no location." onRetry={geos.reload} />;
  else {
    // `/geographies` lists a country holding a company OR a fund, so its
    // `total` overstates where companies are. This card counts and lists only
    // the countries with at least one directory company.
    const withCompanies = (geos.data?.items || []).filter((k) => k.company_count > 0);
    if (withCompanies.length === 0) {
      body = <p className="text-[12.5px] text-axal-muted">No directory company has a country that maps yet.</p>;
    } else {
    const items = withCompanies.slice(0, SHOWN);
    const placed = withCompanies.reduce((s, k) => s + k.company_count, 0);
    const max = Math.max(...items.map((k) => k.company_count));
    body = (
      <>
        <p className="text-[12.5px] text-axal-muted">
          {fmt(placed + (geos.data.companies_unmapped || 0))} companies in {fmt(withCompanies.length)} countries
          {geos.data.companies_unmapped ? `, and ${fmt(geos.data.companies_unmapped)} whose country does not map` : ''}.
          The taxonomy’s companies carry no location, so this reads the company directory.
        </p>
        <ul className="mt-3">
          {items.map((k) => (
            <li key={k.code} className="grid grid-cols-[140px_1fr_48px] items-center gap-3 py-1">
              <Link to={`/research/geographies/${k.code}`} className="truncate text-[12.5px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100">{k.name}</Link>
              <Bar value={k.company_count} max={max} />
              <span className="text-right font-mono text-[12px] text-axal-muted">{fmt(k.company_count)}</span>
            </li>
          ))}
        </ul>
        {withCompanies.length > SHOWN ? <Link to="/research/geographies" className="mt-2 inline-block text-[12.5px] font-semibold text-axal-violet">{fmt(withCompanies.length - SHOWN)} more countries →</Link> : null}
        <Caption>research_company_directory</Caption>
      </>
    );
    }
  }
  return <Card data-testid="markets-where"><h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Where the directory’s companies are based</h2><div className="mt-2">{body}</div></Card>;
}

/** The month before a `YYYY-MM` period key, or null for anything else. */
export function previousPeriod(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/**
 * The overview's heat grid → the largest live changes on last month, rising
 * and falling, `n` of each. A cell with no live row, or no change recorded,
 * is left out: it is not a change of zero.
 */
export function topMovers(heat, n = 4) {
  const cells = [];
  for (const s of heat?.sectors || []) {
    for (const [dimension, c] of Object.entries(s?.dimensions || {})) {
      // No change recorded (null) is neither above nor below 0, so the two
      // filters below leave it out with the unchanged cells.
      cells.push({ sector: s.sector, slug: sectorSlug(s.sector), dimension, delta_pct: c?.delta_pct });
    }
  }
  return {
    rising: cells.filter((c) => c.delta_pct > 0).sort((a, b) => b.delta_pct - a.delta_pct).slice(0, n),
    falling: cells.filter((c) => c.delta_pct < 0).sort((a, b) => a.delta_pct - b.delta_pct).slice(0, n),
  };
}

const pct = (d) => `${Math.abs(d).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

function MoverRows({ rows, dir }) {
  return (
    <ul>
      {rows.map((r) => (
        <li key={`${r.sector}|${r.dimension}`} className="flex min-h-[40px] items-center justify-between gap-3">
          <Link to={`/research/markets/sector/${encodeURIComponent(r.slug)}`} className="truncate text-[12.5px] text-axal-ink hover:text-axal-violet dark:text-gray-100">
            <span className="font-semibold">{r.sector}</span><span className="text-axal-muted"> · {r.dimension}</span>
          </Link>
          <span className="font-mono text-[12px] text-axal-ink dark:text-gray-100">
            {dir === 'up' ? '▲' : '▼'} {pct(r.delta_pct)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Top movers this month (canvas "Top movers"), from the Research overview's
 * heat grid (`GET /api/research/overview`, D536): live index rows only, this
 * month to date against last month.
 */
export function TopMovers({ overview }) {
  const heat = overview?.data?.heat;
  let body;
  if (!overview || (overview.status === 'loading' && !overview.data)) body = <Loading what="the movers" />;
  else if (overview.status === 'unreadable' || heat?.status === 'unreadable') {
    body = <Unreadable what="The month's indexes" claim="This is not a sign nothing moved." onRetry={overview.reload} />;
  } else if (!heat || heat.status !== 'ok') {
    body = <p><Unrecorded reason={heat?.reason || 'The Research overview sent no index grid.'} /></p>;
  } else {
    const { rising, falling } = topMovers(heat);
    const prev = previousPeriod(heat.period_key);
    body = !rising.length && !falling.length
      ? <p><Unrecorded reason="No live index has a change on last month yet." /></p>
      : (
        <>
          <p className="text-[12.5px] text-axal-muted">Largest changes across the tracked sectors and six dimensions, against last month. This month is month to date.</p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-axal-muted">Rising</p>
          {rising.length ? <MoverRows rows={rising} dir="up" /> : <p className="text-[12.5px] text-axal-muted">No live index rose on last month.</p>}
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-axal-muted">Falling</p>
          {falling.length ? <MoverRows rows={falling} dir="down" /> : <p className="text-[12.5px] text-axal-muted">No live index fell on last month.</p>}
          <Caption>market_intel_indexes · global · {heat.period_key}{prev ? ` against ${prev}` : ''}</Caption>
        </>
      );
  }
  return <Card data-testid="markets-movers"><h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Top movers this month</h2><div className="mt-2">{body}</div></Card>;
}

// Top-ranked signals moved to `RankedSignals.jsx` (D7173); re-exported above.

// ---- Your market readings, and recording one ---------------------------------

/** The reading page's own sentence for a range that runs backwards. */
export const RANGE_BACKWARDS = 'High is below low. Nothing is saved until the range reads forward.';

/** What each refusal of `POST /api/research/market-readings` means, said plainly. */
const REFUSED = {
  metric_required: 'Name what the range prices.',
  range_required: RANGE_BACKWARDS,
  comparable_count_required: 'How many engagements the range came from. Refused if 0.',
  ran_at_required: 'A reading needs the date you ran it.',
  not_found: 'That service line is not in your catalog, so nothing was saved.',
};

const AGE_PILL = { current: ['Current', 'ok'], ageing: ['Ageing', 'warn'], stale: ['Stale', 'danger'] };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The form for a new reading. `row` is a service line or a reading from the
 * list, or nothing for a blank form. Either way the dollars start blank and the
 * run date is today (`freshReadingForm`): a re-run is a new reading, and the
 * old range does not come forward.
 */
export function readingForm(row = null, on = today()) {
  return freshReadingForm({
    offering_uid: row?.offering_uid || '',
    metric: row?.metric || '',
    n: row?.comparable_count ? String(row.comparable_count) : '',
  }, on);
}

/**
 * The form → the body `POST /api/research/market-readings` takes, or the
 * sentence that refuses it. These are the Worker's own refusals, made first
 * with the reading page's helpers, so nothing is sent that it would turn away:
 * something to price, a range that reads forward, a comparable count above
 * zero, and the date it was run.
 */
export function readingPayload(form) {
  const metric = String(form?.metric || '').trim();
  if (!form?.offering_uid && !metric) return { error: REFUSED.metric_required };
  const low = dollarsToCents(form.low);
  const high = dollarsToCents(form.high);
  if (low.error || high.error) return { error: low.error || high.error };
  if (high.cents < low.cents) return { error: RANGE_BACKWARDS };
  const count = comparableCount(form.n);
  if (count.n == null) return { error: count.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.ran_at || ''))) return { error: REFUSED.ran_at_required };
  return {
    payload: {
      ...(form.offering_uid ? { offering_uid: form.offering_uid } : {}),
      metric,
      range_low_cents: low.cents,
      range_high_cents: high.cents,
      comparable_count: count.n,
      ran_at: form.ran_at,
    },
  };
}

/** A refusal from the Worker, in the sentence the form shows. */
export const refusalText = (err) => REFUSED[err?.code] || err?.message || 'That reading could not be saved.';

/**
 * Record the form as a new reading and open it. A form the checks above refuse
 * sends nothing. Answers the note the form shows, or `{ opened }` with the path
 * it went to. `create` and `go` are the API call and the navigation, passed in.
 */
export async function submitReading(form, { create, go }) {
  const { payload, error } = readingPayload(form);
  if (error) return { ok: false, text: error };
  try {
    const saved = await create(payload);
    const uid = saved?.item?.uid;
    if (!uid) return { ok: true, text: 'Recorded. It is in your list below.' };
    const to = `/research/markets/${encodeURIComponent(uid)}`;
    go(to);
    return { ok: true, opened: to };
  } catch (err) {
    return { ok: false, text: refusalText(err) };
  }
}

/**
 * The reading `Re-run stale` opens the form on: the first past ninety days,
 * else the first service line never read — as `MarketZone` chose it. Null when
 * there is neither.
 */
export function nextToRerun(items = []) {
  const rows = items.map((r) => ({ ...r, band: ageBand(daysSince(r.ran_at)) }));
  return rows.find((r) => r.band === 'stale') || rows.find((r) => r.band === null) || null;
}

const FIELD = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-axal-ink '
  + 'focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-400 dark:focus:ring-violet-400';
const LABEL = 'block text-[11px] font-semibold text-axal-muted dark:text-gray-400';

export function RecordReading({ form, lines = [], onChange, onCancel, onSave, busy = false, note = null }) {
  const forward = rangeReadsForward(form.low, form.high);
  const set = (key) => (e) => onChange({ ...form, [key]: e.target.value });
  const pick = (e) => {
    const line = lines.find((l) => l.offering_uid === e.target.value);
    onChange({ ...form, offering_uid: line ? line.offering_uid : '', metric: line ? line.metric : '' });
  };
  // Focus lands on the first field still to fill, which also scrolls a form
  // opened from the header row into view.
  const first = form.offering_uid || form.metric ? 'low' : (lines.length ? 'line' : 'metric');
  const backwards = forward === false ? ' border-red-300 dark:border-red-800' : '';
  return (
    <form data-testid="record-reading" onSubmit={onSave} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
      <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Record a reading</h3>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        What comparable engagements went for, how many there were, and the date you ran it. A save writes a new reading; it never edits an old one.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {lines.length ? (
          <label className={`${LABEL} sm:col-span-2`}>
            Service line
            <select aria-label="Service line" autoFocus={first === 'line'} value={form.offering_uid} onChange={pick} className={FIELD}>
              <option value="">Not a catalog service line</option>
              {lines.map((l) => <option key={l.offering_uid} value={l.offering_uid}>{l.metric}</option>)}
            </select>
          </label>
        ) : null}
        {form.offering_uid ? null : (
          <label className={`${LABEL} sm:col-span-2`}>
            What it prices
            <input aria-label="What it prices" autoFocus={first === 'metric'} maxLength={200} value={form.metric} onChange={set('metric')} className={FIELD} />
          </label>
        )}
        <label className={LABEL}>
          Low (USD)
          <input aria-label="Low (USD)" autoFocus={first === 'low'} inputMode="decimal" value={form.low} onChange={set('low')} aria-invalid={forward === false} className={`${FIELD}${backwards}`} />
        </label>
        <label className={LABEL}>
          High (USD)
          <input aria-label="High (USD)" inputMode="decimal" value={form.high} onChange={set('high')} aria-invalid={forward === false} className={`${FIELD}${backwards}`} />
        </label>
        <label className={LABEL}>
          Comparables
          <input aria-label="Comparables" inputMode="numeric" value={form.n} onChange={set('n')} className={FIELD} />
        </label>
        <label className={LABEL}>
          Run date
          <input aria-label="Run date" type="date" value={form.ran_at} onChange={set('ran_at')} className={FIELD} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-axal-muted dark:text-gray-400">How many engagements the range came from. Refused if 0.</p>
      {forward === false ? <SaveNote note={{ ok: false, text: RANGE_BACKWARDS }} /> : null}
      <SaveNote note={note} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || forward === false}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500">
          {busy ? 'Recording…' : 'Record this reading'}
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-axal-muted underline dark:text-gray-400">Cancel</button>
      </div>
    </form>
  );
}

/**
 * The caller's readings, the way back into `/research/markets/:uid`, and the
 * form that records one. `record` carries the form's state and handlers; the
 * form is offered only once the list has been read, because the list is where
 * the service lines it offers come from.
 */
export function Readings({ readings, record = null }) {
  let body;
  if (readings.status === 'loading' && !readings.data) body = <Loading what="your readings" />;
  else if (readings.status === 'unreadable') body = <Unreadable what="Your market readings" claim="This is not a sign you have none." onRetry={readings.reload} />;
  else {
    const run = (readings.data?.items || []).filter((r) => r.uid);
    body = run.length === 0
      ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400">You have not run a market reading yet. A reading records the comparable range for something you sell, how many engagements it came from, and the date you ran it.</p>
      : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
          {run.map((r) => {
            const days = daysSince(r.ran_at);
            const band = ageBand(days);
            return (
              <li key={r.uid} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <Link to={`/research/markets/${encodeURIComponent(r.uid)}`} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{r.metric}</Link>
                <span className="flex items-center gap-2 text-[11.5px] text-axal-muted dark:text-gray-400">
                  {r.ran_at ? `run ${String(r.ran_at).slice(0, 10)}${days == null ? '' : ` · ${days} d old`}` : <Unrecorded />}
                  {band ? <Pill tone={AGE_PILL[band][1]}>{AGE_PILL[band][0]}</Pill> : null}
                </span>
              </li>
            );
          })}
        </ul>
      );
  }
  const lines = [];
  for (const r of readings.data?.items || []) {
    if (r.offering_uid && !lines.some((l) => l.offering_uid === r.offering_uid)) lines.push({ offering_uid: r.offering_uid, metric: r.metric });
  }
  const offer = record && readings.status === 'ready';
  return (
    <Card data-testid="markets-readings">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Your market readings</h2>
        {offer && !record.form ? (
          <button type="button" onClick={() => record.onOpen()} className="text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">
            Record a reading →
          </button>
        ) : null}
      </div>
      <div className="mt-2">{body}</div>
      {offer && record.form ? (
        <RecordReading key={record.opened} form={record.form} lines={lines} onChange={record.onChange} onCancel={record.onCancel}
          onSave={record.onSave} busy={record.busy} note={record.note} />
      ) : null}
      {!record?.form && record?.note ? <SaveNote note={record.note} /> : null}
    </Card>
  );
}

/** D7172: export the entire filtered directory using the same request as D7171's view. */
export function useDirectoryExport(markets, params) {
  const view = readMarketQuery(params);
  const count = markets.status === 'ready' ? (markets.data?.total ?? null) : null;
  const ctl = marketExport({ status: markets.status, count, query: view.q, sort: view.sort,
    sortLabel: MARKET_SORTS.find((x) => x.value === view.sort)?.label });
  const rows = async () => {
    if ((markets.data?.items?.length || 0) >= count && !markets.request?.offset) return markets.data?.items || [];
    return collectMarkets({ request: markets.request, fetchPage: (p) => researchMarketsApi.list(p) });
  };
  return { ctl, rows };
}

export default function MarketDirectoryZone({ role = 'founder', zoneActions = null }) {
  const navigate = useNavigate();
  // D7172: the tab and the Listed companies view are the URL's (history replace).
  const [params, setParams] = useSearchParams();
  const view = readListedQuery(params);
  const tab = view.tab;
  const [markets, setDirectoryRead] = useState({ status: 'loading', data: null, request: null });
  const [sectors] = useRead(() => researchSectorsApi.list());
  const listedReq = listedRequest(view);
  const listedKey = JSON.stringify(listedReq);
  const [listed, reloadListed] = useRead(() => researchMarketsApi.listedCompanies(listedReq), listedKey);
  const directoryExport = useDirectoryExport(markets, params);
  const [exportNote, setExportNote] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [geos, reloadGeos] = useRead(() => researchMarketsApi.geographies({ sort: 'company_count', limit: 100 }));
  const [sigs, reloadSigs] = useRead(() => api.signals.list({ limit: 3, mode: role === 'advisor' ? 'advisor' : 'founder' }), role);
  const showReadings = role !== 'investor';
  const [readings, reloadReadings] = useRead(() => (showReadings ? api.research.marketReadings() : Promise.resolve({ items: [] })), role);
  const [overview, reloadOverview] = useRead(() => researchOverviewApi.get(1));
  const [form, setForm] = useState(null);
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const openForm = (row = null) => {
    setNote(null);
    setForm(readingForm(row));
    setOpened((n) => n + 1);
  };

  // A save opens the new reading, which is where its age, its comparables and
  // its proposal attachment are. Only a refusal leaves the form open.
  const save = async (e) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setNote(null);
    const result = await submitReading(form, { create: api.research.marketReadingCreate, go: navigate });
    setBusy(false);
    if (result.opened) return;
    setNote({ ok: result.ok, text: result.text });
    if (result.ok) {
      setForm(null);
      reloadReadings();
    }
  };

  // `Re-run stale` on the partner row (D593). Re-reading is work a person does,
  // so the op opens the form on the reading that needs it and runs nothing.
  const rerun = readings.status === 'ready' ? nextToRerun(readings.data?.items || []) : null;
  const opsHandlers = {
    reRunStale: {
      onClick: () => { if (rerun) openForm(rerun); },
      disabled: !rerun,
      title: readings.status === 'unreadable'
        ? 'Your readings could not be read, so this page cannot tell which are stale.'
        : readings.status !== 'ready'
          ? 'Your readings are still loading.'
          : (rerun
            ? `Record a fresh reading for ${rerun.metric}.`
            : `No reading is past ${STALE_AT} days, and every service line has one.`),
    },
  };

  // The Listed count is every listing record in both stores, one row per source
  // (`store_total`), whatever the search; the result heading carries the search's.
  const tabCount = {
    directory: markets.status === 'ready' ? `${fmt(markets.data?.total ?? 0)} markets` : null,
    listed: listed.status === 'ready' ? `${fmt(listed.data?.store_total ?? listed.data?.total ?? 0)} listing records` : null,
  };
  const setTab = (t) => setParams((prev) => writeTab(prev, t), { replace: true });
  const setListed = (patch) => setParams((prev) => changeListedQuery(prev, patch), { replace: true });
  const clearListed = () => setParams((prev) => clearListedFilters(prev), { replace: true });

  // The active tab's export: the same label and click in the zone's header row
  // and beside the count. A new view drops the last Downloaded or Error note.
  const exportKey = tab === 'listed' ? `listed|${listedKey}` : `directory|${JSON.stringify(markets.request)}|${markets.status}`;
  useEffect(() => { setExportNote(null); }, [exportKey]);
  const ctl = tab === 'listed' ? listedExport(listed, view) : directoryExport.ctl;
  const runExport = async () => {
    if (ctl.disabled || exportBusy) return;
    setExportBusy(true);
    setExportNote(null);
    try {
      const listedTab = tab === 'listed';
      let rows;
      try {
        rows = listedTab ? (listed.data?.items || []) : await directoryExport.rows();
      } catch {
        setExportNote({ ok: false, text: 'The markets could not be read for the file.' });
        return;
      }
      const header = listedTab ? LISTED_CSV_HEADER : MARKET_CSV_HEADER;
      const cells = rows.map(listedTab ? listedCsvCells : marketCsvCells);
      let ok = false;
      try { ok = exportView({ scope: null, zone: ctl.zone, header, rows: cells }); } catch { ok = false; }
      setExportNote(ok
        ? { ok: true, count: cells.length, file: exportFileName({ scope: null, zone: ctl.zone, count: cells.length }) }
        : { ok: false });
    } finally {
      setExportBusy(false);
    }
  };
  const exporter = { ctl, note: exportNote, run: runExport, busy: exportBusy };
  const scoped = { ...ctl, onClick: runExport, busy: exportBusy };
  const tabRefs = useRef([]);
  const tabKeys = (e, i) => {
    const n = MARKET_TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    setTab(MARKET_TABS[to].key);
    tabRefs.current[to]?.focus();
  };

  return (
    <div data-testid="market-directory" className="space-y-4">
      {zoneActions ? <ZoneToolbar role={role} className="mb-3" actions={zoneActions(scoped, opsHandlers)} /> : null}
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Markets</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-axal-muted">
          The markets of the Axal sector taxonomy, the listed companies StudioOS knows, and six indexes for each tracked sector.
        </p>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="tablist" aria-label="Markets" className="flex flex-wrap gap-1">
            {MARKET_TABS.map((t, i) => (
              <button key={t.key} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`markets-tab-${t.key}`}
                aria-selected={tab === t.key} aria-controls="markets-tabpanel" tabIndex={tab === t.key ? 0 : -1}
                onClick={() => setTab(t.key)} onKeyDown={(e) => tabKeys(e, i)}
                className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[13px] font-semibold max-lg:min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-violet-600 dark:focus-visible:outline-violet-400 ${tab === t.key ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800' : 'text-axal-ink dark:text-gray-200'}`}>
                {t.label} {tabCount[t.key] ? <span className="text-[11.5px] font-medium text-axal-muted max-sm:hidden">{tabCount[t.key]}</span> : null}
              </button>
            ))}
          </div>
          {/* D537: no source names an owner, so government ownership is a note, not a tab. */}
          <span data-testid="markets-government" className="inline-flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400 lg:ml-auto">
            Government ownership <Unrecorded /> no source records who owns a company
          </span>
        </div>
        <div className="mt-3"><CoverageNote asOf={markets.data?.items?.[0]?.as_of} /></div>
        <div className="mt-4" role="tabpanel" id="markets-tabpanel" aria-labelledby={`markets-tab-${tab}`}>
          {tab === 'directory' ? <>
            <ScopedExport exporter={exporter} />
            <MarketDirectoryPanel role={role} onRead={setDirectoryRead} />
          </> : null}
          {tab === 'listed' ? <PublicPanel listed={{ ...listed, reload: reloadListed }} view={view} onChange={setListed} onClear={clearListed} exporter={exporter} /> : null}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <WhereBased geos={{ ...geos, reload: reloadGeos }} />
        <TopMovers overview={{ ...overview, reload: reloadOverview }} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LatestSignals sigs={{ ...sigs, reload: reloadSigs }} sectors={sectors} />
        {showReadings ? (
          <Readings
            readings={{ ...readings, reload: reloadReadings }}
            record={{
              form, opened, busy, note, onSave: save,
              onOpen: () => openForm(null),
              onChange: setForm,
              onCancel: () => { setForm(null); setNote(null); },
            }}
          />
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-axal-faint">
        Markets come from the Axal sector taxonomy; their company counts are the taxonomy source’s own and are not market size. Indexes are worldwide only. What no source holds reads “Not recorded”.
      </p>
    </div>
  );
}
