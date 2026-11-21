import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Pill } from '../../ui';
import { Unreadable, Unrecorded } from '../../ui/Honesty';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { api } from '../../lib/api';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { researchMarketReadingsApi } from '../../lib/api/researchMarketReadings.js';
import ReadingsSummary from './ReadingsSummary.jsx';
import MarketDirectoryPanel, { CoverageNote } from './MarketDirectory.jsx';
import { DIRECTORY_TABS, MARKET_SORTS, readMarketQuery, writeMarketQuery, sectorSlug } from './marketDirectoryQuery.js';
import { researchOverviewApi } from '../../lib/api/researchOverview.js';
import { researchSectorsApi } from '../../lib/api/researchSectors.js';
import { SaveNote } from '../advisor/expertise/kit';
import { STALE_AT, ageBand, daysSince } from './marketReadingRead';
import {
  AGE_AT, FIELD_COPY, RANGE_BACKWARDS, READINGS_CSV_HEADER, comparableCount, dollarsToCents, firstError, freshReadingForm,
  rangeLine, rangeReadsForward, readingErrors, readingsCsvRows, scopeValue,
} from './marketReadingRead';
import { LatestSignals } from './RankedSignals.jsx';
import { useMarketHeaderOps } from './MarketHeaderOps.jsx';

import { PublicPanel, ScopedExport } from './ListedCompaniesPanel.jsx';
import { LISTED_CSV_HEADER, MARKET_CSV_HEADER, changeListedQuery, clearListedFilters, collectMarkets,
  listedCsvCells, listedExport, listedRequest, marketCsvCells, marketExport, readListedQuery, writeTab } from './listedCompaniesRead.js';
import { downloadCsv, exportFileName, exportView, stamp } from '../../lib/csvExport';

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
//
// D7174 (#7174, canvas D7039 RMP-01 to RMP-13): every amount to the cent from
// the form to the list, the range, count and scope on each row, a CSV export
// of the readings, Scope on the form, a correction under each field, and no
// readings card for an investor (D6273 Q2).

/** The reading page's own sentence for a range that runs backwards. */
export { RANGE_BACKWARDS };

/** What each refusal of `POST /api/research/market-readings` means, said plainly. */
const REFUSED = {
  metric_required: FIELD_COPY.metric,
  range_required: RANGE_BACKWARDS,
  comparable_count_required: FIELD_COPY.count,
  ran_at_required: FIELD_COPY.ranAt,
  not_found: 'That service line is not in your catalog, so nothing was saved.',
};

/** A save the Worker never answered: the form keeps every input (D7039 RMP-03C). */
export const NO_ANSWER = 'StudioOS did not answer, so nothing was recorded. Your entries are still here, to the cent. Record this reading again when you are ready.';

const AGE_PILL = { current: ['Current', 'ok', '✓'], ageing: ['Ageing', 'warn', '▲'], stale: ['Stale', 'danger', '◷'] };

/** The age as a word and a shape, never a colour alone. */
function AgeMark({ band }) {
  const [word, tone, glyph] = AGE_PILL[band];
  return <Pill tone={tone}><span aria-hidden="true" className="mr-1">{glyph}</span>{word}</Pill>;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The form for a new reading. `row` is a service line or a reading from the
 * list, or nothing for a blank form. Either way the dollars start blank and the
 * run date is today (`freshReadingForm`): a re-run is a new reading, and the
 * old range does not come forward. What it prices, the scope and the count do.
 */
export function readingForm(row = null, on = today()) {
  return freshReadingForm({
    offering_uid: row?.offering_uid || '',
    metric: row?.metric || '',
    scope: row?.uid && row?.scope ? row.scope : '',
    n: row?.comparable_count ? String(row.comparable_count) : '',
  }, on);
}

/**
 * The form → the body `POST /api/research/market-readings` takes, or the
 * corrections that refuse it, one per field (`errors`) and the first as one
 * sentence (`error`). These are the Worker's own refusals, made first with the
 * reading page's helpers, so nothing is sent that it would turn away.
 */
export function readingPayload(form) {
  const errors = readingErrors(form, { needMetric: true });
  const error = firstError(errors);
  if (error) return { error, errors };
  return {
    payload: {
      ...(form.offering_uid ? { offering_uid: form.offering_uid } : {}),
      metric: String(form.metric || '').trim(),
      range_low_cents: dollarsToCents(form.low, 'low').cents,
      range_high_cents: dollarsToCents(form.high, 'high').cents,
      comparable_count: comparableCount(form.n).n,
      ran_at: form.ran_at,
      scope: scopeValue(form.scope),
    },
  };
}

/** A refusal from the Worker, in the sentence the form shows; no answer at all says so. */
export const refusalText = (err) => REFUSED[err?.code]
  || (err?.status ? (err?.message || 'That reading could not be saved.') : NO_ANSWER);

/**
 * Record the form as a new reading and open it. A form the checks above refuse
 * sends nothing and answers its `errors`. A save opens the stored reading with
 * `{ recorded: true }`, so it says what was stored. A refusal or no answer
 * answers `failed`, and the caller keeps the form as typed. `create` and `go`
 * are the API call and the navigation, passed in.
 */
export async function submitReading(form, { create, go }) {
  const { payload, error, errors } = readingPayload(form);
  if (error) return { ok: false, text: error, errors };
  try {
    const saved = await create(payload);
    const uid = saved?.item?.uid;
    if (!uid) return { ok: true, text: 'Recorded. It is in your list below.' };
    const to = `/research/markets/${encodeURIComponent(uid)}`;
    go(to, { state: { recorded: true } });
    return { ok: true, opened: to };
  } catch (err) {
    return { ok: false, text: refusalText(err), failed: true };
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
  + 'read-only:opacity-70 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-violet-400 dark:focus:ring-violet-400';
const LABEL = 'block text-[11px] font-semibold text-axal-muted dark:text-gray-400';
const BAD = ' border-red-300 dark:border-red-800';
const HINT = 'mt-1 block text-[11px] font-normal text-axal-muted dark:text-gray-400';

/** The correction under one field, tied to it by `aria-describedby`. */
function FieldError({ id, text }) {
  if (!text) return null;
  return (
    <span id={id} className="mt-1 flex items-start gap-1 text-[11px] font-semibold leading-snug text-axal-destructive dark:text-red-300">
      <span aria-hidden="true" className="flex-none font-extrabold">!</span>
      <span>{text}</span>
    </span>
  );
}

export function RecordReading({ form, lines = [], onChange, onCancel, onSave, busy = false, note = null, errors = null }) {
  const forward = rangeReadsForward(form.low, form.high);
  const err = errors || {};
  const set = (key) => (e) => onChange({ ...form, [key]: e.target.value });
  const pick = (e) => {
    const line = lines.find((l) => l.offering_uid === e.target.value);
    onChange({ ...form, offering_uid: line ? line.offering_uid : '', metric: line ? line.metric : '' });
  };
  const describe = (key) => (err[key] ? `rr-${key}-error` : undefined);
  // Focus lands on the first field still to fill, which also scrolls a form
  // opened from the header row into view.
  const first = form.offering_uid || form.metric ? 'low' : (lines.length ? 'line' : 'metric');
  const backwards = forward === false;
  const failed = note && !note.ok ? note : null;
  return (
    <form data-testid="record-reading" onSubmit={onSave} aria-busy={busy ? 'true' : 'false'} noValidate className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Record a reading</h3>
        {busy ? <Pill tone="neutral">Saving…</Pill> : null}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        What comparable engagements went for, how many there were, and the date you ran it. A save writes a new reading; it never edits an old one.
      </p>
      {failed ? (
        <div role="alert" data-testid="record-reading-failed" className="mt-2 flex items-start gap-2 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3 py-2.5 text-[12px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span aria-hidden="true" className="flex-none font-extrabold">!</span>
          <span><b className="block">This reading was not saved.</b>{failed.text}</span>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {lines.length ? (
          <label className={`${LABEL} sm:col-span-2`}>
            Service line
            <select aria-label="Service line" autoFocus={first === 'line'} disabled={busy} value={form.offering_uid} onChange={pick} className={FIELD}>
              <option value="">Not a catalog service line</option>
              {lines.map((l) => <option key={l.offering_uid} value={l.offering_uid}>{l.metric}</option>)}
            </select>
            {form.offering_uid ? <span className={HINT}>From your catalog. The reading takes the service line’s own name.</span> : null}
          </label>
        ) : null}
        {form.offering_uid ? null : (
          <label className={`${LABEL} sm:col-span-2`}>
            What it prices
            <input aria-label="What it prices" autoFocus={first === 'metric'} maxLength={200} readOnly={busy} value={form.metric} onChange={set('metric')}
              placeholder="e.g. Board-pack preparation" aria-invalid={Boolean(err.metric)} aria-describedby={describe('metric')} className={`${FIELD}${err.metric ? BAD : ''}`} />
            <FieldError id="rr-metric-error" text={err.metric} />
          </label>
        )}
        <label className={`${LABEL} sm:col-span-2`}>
          Scope <em className="font-normal not-italic text-axal-faint">optional</em>
          <input aria-label="Scope" maxLength={200} readOnly={busy} value={form.scope ?? ''} onChange={set('scope')} placeholder="What this range covers" className={FIELD} />
          <span className={HINT}>Left blank, the reading says Not recorded.</span>
        </label>
        <label className={LABEL}>
          Low (USD)
          <input aria-label="Low (USD)" autoFocus={first === 'low'} inputMode="decimal" placeholder="0.00" readOnly={busy} value={form.low} onChange={set('low')}
            aria-invalid={backwards || Boolean(err.low)} aria-describedby={describe('low')} className={`${FIELD} font-mono${backwards || err.low ? BAD : ''}`} />
          <FieldError id="rr-low-error" text={err.low} />
        </label>
        <label className={LABEL}>
          High (USD)
          <input aria-label="High (USD)" inputMode="decimal" placeholder="0.00" readOnly={busy} value={form.high} onChange={set('high')}
            aria-invalid={backwards || Boolean(err.high)} aria-describedby={describe('high')} className={`${FIELD} font-mono${backwards || err.high ? BAD : ''}`} />
          <FieldError id="rr-high-error" text={err.high} />
        </label>
        <label className={LABEL}>
          Comparables
          <input aria-label="Comparables" inputMode="numeric" placeholder="e.g. 7" readOnly={busy} value={form.n} onChange={set('n')}
            aria-invalid={Boolean(err.n)} aria-describedby={describe('n')} className={`${FIELD} font-mono${err.n ? BAD : ''}`} />
          {err.n ? <FieldError id="rr-n-error" text={err.n} /> : <span className={HINT}>How many engagements the range came from. Refused if 0.</span>}
        </label>
        <label className={LABEL}>
          Run date
          <input aria-label="Run date" type="date" readOnly={busy} value={form.ran_at} onChange={set('ran_at')}
            aria-invalid={Boolean(err.ran_at)} aria-describedby={describe('ran_at')} className={`${FIELD}${err.ran_at ? BAD : ''}`} />
          {err.ran_at ? <FieldError id="rr-ran_at-error" text={err.ran_at} /> : <span className={HINT}>The day you ran it. Age counts from here.</span>}
        </label>
      </div>
      {backwards ? (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint px-3 py-2.5 text-[12px] text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span aria-hidden="true" className="flex-none font-extrabold">!</span>
          <span>{RANGE_BACKWARDS}</span>
        </div>
      ) : null}
      {note && note.ok ? <SaveNote note={note} /> : null}
      {/* On a phone the button is held above the keyboard (D7039 RMP-13). */}
      <div className="mt-3 flex flex-wrap items-center gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-1 max-sm:bg-white max-sm:px-1 max-sm:py-2 max-sm:dark:bg-gray-900">
        <button type="submit" disabled={busy || backwards}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[48px] max-sm:w-full dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500">
          {busy ? 'Recording…' : 'Record this reading'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-[12px] font-semibold text-axal-muted underline max-sm:min-h-[44px] dark:text-gray-400">Cancel</button>
      </div>
    </form>
  );
}

/** The export of the loaded rows: the file's name says how many went in. */
export function exportReadings(items, save = downloadCsv) {
  const rows = readingsCsvRows(items);
  if (!rows.length) return false;
  return save(`market-readings-${rows.length}-rows-${stamp()}.csv`, READINGS_CSV_HEADER, rows);
}

const TH = 'px-2 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.06em] text-axal-faint';
const TD = 'px-2 py-2.5 align-top text-[12.5px] text-axal-ink dark:text-gray-100';

/**
 * The caller's readings, the way back into `/research/markets/:uid`, and the
 * form that records one. `record` carries the form's state and handlers; the
 * form is offered only once the list has been read, because the list is where
 * the service lines it offers come from. A service line never read keeps its
 * row and says No reading yet, never $0.
 */
export function Readings({ readings, record = null, onExport = exportReadings, summary = null }) {
  const items = readings.data?.items || [];
  const offer = record && readings.status === 'ready';
  let body;
  if (readings.status === 'loading' && !readings.data) body = <Loading what="your readings" />;
  else if (readings.status === 'unreadable') body = <Unreadable what="Your market readings" claim="This is not a sign you have none." onRetry={readings.reload} />;
  else if (!items.length) {
    body = <p className="text-[12.5px] text-axal-muted dark:text-gray-400">You have not run a market reading yet. A reading records the comparable range for something you sell, how many engagements it came from, and the date you ran it.</p>;
  } else {
    const rows = items.map((r) => {
      const days = r.uid ? daysSince(r.ran_at) : null;
      return { r, days, band: days == null ? null : ageBand(days) };
    });
    const open = (r) => `/research/markets/${encodeURIComponent(r.uid)}`;
    const recordFor = (r) => (offer && !record.form
      ? <button type="button" onClick={() => record.onOpen(r)} className="rounded-lg border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">Record a reading</button>
      : null);
    body = (
      <>
        {/* Desktop: one table, six columns (RMP-01). */}
        <table data-testid="readings-table" className="hidden w-full border-collapse sm:table">
          <thead>
            <tr className="border-b border-axal-hairline dark:border-gray-800">
              <th className={TH}>What it prices</th>
              <th className={TH}>Comparable range (USD)</th>
              <th className={`${TH} text-right`}>Comparables</th>
              <th className={TH}>Run date</th>
              <th className={TH}>Age</th>
              <th className={TH}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-axal-hairline dark:divide-gray-800">
            {rows.map(({ r, days, band }) => (r.uid ? (
              <tr key={r.uid}>
                <td className={TD}>
                  <Link to={open(r)} className="font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{r.metric}</Link>
                  <small className="mt-0.5 block text-[11px] text-axal-muted dark:text-gray-400">
                    {r.offering_uid ? 'Service line' : 'Not a service line'} · scope: {r.scope ? r.scope : <i>Not recorded</i>}
                  </small>
                </td>
                <td className={`${TD} whitespace-nowrap font-mono`}>{rangeLine(r) || <Unrecorded />}</td>
                <td className={`${TD} text-right font-mono`}>{r.comparable_count}</td>
                <td className={`${TD} whitespace-nowrap font-mono`}>{String(r.ran_at).slice(0, 10)}</td>
                <td className={TD}>
                  <span className="flex items-center gap-1.5">
                    {band ? <AgeMark band={band} /> : null}
                    {days == null ? null : <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{days} d</span>}
                  </span>
                </td>
                <td className={`${TD} text-right`}>
                  <Link to={open(r)} className="text-[12px] font-semibold text-axal-violet hover:underline dark:text-violet-300">Open ›</Link>
                </td>
              </tr>
            ) : (
              <tr key={`line-${r.offering_uid}`}>
                <td className={TD}>
                  <b className="font-semibold">{r.metric}</b>
                  <small className="mt-0.5 block text-[11px] text-axal-muted dark:text-gray-400">Service line · in your catalog</small>
                </td>
                <td className={TD}><span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">No reading yet</span></td>
                <td className={`${TD} text-right`}><Unrecorded /></td>
                <td className={TD}><Unrecorded /></td>
                <td className={TD}><span className="text-[12px] text-axal-muted dark:text-gray-400">Nothing to age</span></td>
                <td className={`${TD} text-right`}>{recordFor(r)}</td>
              </tr>
            )))}
          </tbody>
        </table>
        {/* Phone: the same rows as cards (RMP-13A). */}
        <ul data-testid="readings-cards" className="space-y-2 sm:hidden">
          {rows.map(({ r, band }) => (
            <li key={r.uid || `line-${r.offering_uid}`} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
              {r.uid
                ? <Link to={open(r)} className="flex min-h-[44px] items-center font-semibold text-axal-ink dark:text-gray-100">{r.metric}</Link>
                : <b className="font-semibold text-axal-ink dark:text-gray-100">{r.metric}</b>}
              {r.uid ? (
                <>
                  <div className="font-mono text-[14px] font-bold text-axal-ink dark:text-gray-100">{rangeLine(r)}</div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.comparable_count} comparables · {String(r.ran_at).slice(0, 10)}</span>
                    {band ? <AgeMark band={band} /> : null}
                  </div>
                  <p className="mt-1 text-[11px] text-axal-muted dark:text-gray-400">Scope: {r.scope || 'Not recorded'}</p>
                </>
              ) : (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">No reading yet</span>
                  {recordFor(r)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </>
    );
  }
  const lines = [];
  for (const r of items) {
    if (r.offering_uid && !lines.some((l) => l.offering_uid === r.offering_uid)) lines.push({ offering_uid: r.offering_uid, metric: r.metric });
  }
  const canExport = readings.status === 'ready' && items.length > 0;
  return (
    <Card data-testid="markets-readings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Your market readings</h2>
          <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">Comparable ranges you entered, each with its run date and age. Newest per service line.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {canExport ? (
            <button type="button" onClick={() => onExport(items)}
              className="rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800">
              Export CSV
            </button>
          ) : null}
          {offer && !record.form ? (
            <button type="button" onClick={() => record.onOpen()}
              className="rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 max-sm:min-h-[48px] max-sm:flex-1 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500">
              Record a reading
            </button>
          ) : null}
        </div>
      </div>
      {/* D7651 part 2: the Eadwyn summary of these readings, under the CSV export (RMP-12). */}
      {summary ? <ReadingsSummary read={summary} /> : null}
      <div className="mt-2">{body}</div>
      {offer && record.form ? (
        <RecordReading key={record.opened} form={record.form} lines={lines} onChange={record.onChange} onCancel={record.onCancel}
          onSave={record.onSave} busy={record.busy} note={record.note} errors={record.errors} />
      ) : null}
      {!record?.form && record?.note ? <SaveNote note={record.note} /> : null}
      {items.length ? (
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
          A range is what you found, recorded by you. The count is stored; the engagements behind it are not, and a count says nothing about how many clients want the work. Ageing after {AGE_AT} days, stale after {STALE_AT}.
        </p>
      ) : null}
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
  // D7171 part 2: New market research and Edit thesis (MarketHeaderOps.jsx).
  // Export view is D7172's scoped export below: one export path.
  const headerOps = useMarketHeaderOps({ read: markets, params, navigate });
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
  // D7651 part 2: an investor never asks for the summary (D6273 Q2); the Worker refuses one anyway.
  const [readingsSummary, reloadReadingsSummary] = useRead(() => (showReadings ? researchMarketReadingsApi.all() : Promise.resolve(null)), role);
  const [overview, reloadOverview] = useRead(() => researchOverviewApi.get(1));
  const [form, setForm] = useState(null);
  const [opened, setOpened] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [errors, setErrors] = useState(null);

  const openForm = (row = null) => {
    setNote(null);
    setErrors(null);
    setForm(readingForm(row));
    setOpened((n) => n + 1);
  };

  // A save opens the new reading, which is where its age, its comparables and
  // its proposal attachment are. Only a refusal leaves the form open, with
  // every input as typed (D7039 RMP-03C, RMP-08).
  const save = async (e) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setNote(null);
    setErrors(null);
    const result = await submitReading(form, { create: api.research.marketReadingCreate, go: navigate });
    setBusy(false);
    if (result.opened) return;
    if (result.errors) { setErrors(result.errors); return; }
    setNote({ ok: result.ok, text: result.text });
    if (result.ok) {
      setForm(null);
      reloadReadings();
      reloadReadingsSummary();
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
    // D7171 part 2: the D7036 header ops (MarketHeaderOps.jsx). Export view
    // is not a handler: the tables declare it `kind: 'export'`, and the zone
    // header runs D7172's scoped export (`scoped`) for the active tab.
    newMarketResearch: headerOps.handlers.newMarketResearch,
    editThesis: headerOps.handlers.editThesis,
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
      <LatestSignals sigs={{ ...sigs, reload: reloadSigs }} sectors={sectors} />
      {/* Full width: the readings table has six columns (D7039 RMP-01). An
          investor's view draws no readings card (D6273 Q2). */}
      {showReadings ? (
        <Readings
          readings={{ ...readings, reload: reloadReadings }}
          record={{
            form, opened, busy, note, errors, onSave: save,
            onOpen: (row) => openForm(row || null),
            onChange: setForm,
            onCancel: () => { setForm(null); setNote(null); setErrors(null); },
          }}
          summary={{ ...readingsSummary, reload: reloadReadingsSummary }}
        />
      ) : null}
      <p className="text-[11px] leading-relaxed text-axal-faint">
        Markets come from the Axal sector taxonomy; their company counts are the taxonomy source’s own and are not market size. Indexes are worldwide only. What no source holds reads “Not recorded”.
      </p>
    </div>
  );
}
