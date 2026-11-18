import React, { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { StateChip, Unreadable, Unrecorded } from '../../ui/Honesty';
import { PhoneSheet } from '../../ui/phone/PhoneSheet.jsx';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import {
  LISTED_SORTS, LISTED_SOURCES, SOURCE_LABEL, allEdgar, edgarLeftOut, foldedColumns, headingContext,
  inBothOnPage, listedExport, otherListingsText, pageInfo, pagerLine, readListedQuery, shortDate, sourceFileName,
} from './listedCompaniesRead.js';

/**
 * D7172 (#7172) — Research › Markets › Listed companies, built to the D7037
 * canvas (`design/incoming/Research Markets Listed Search and CSV Exports
 * Page.dc.html`, boards RML-02 to RML-11): search by name or ticker, a Source
 * choice and a Sort, all in the URL; the count of listing records with each
 * source's share; one row per source for a ticker both stores hold, never
 * merged; Details; columns no row records folded into one line; focus to the
 * result heading after paging; the scoped "Export this page · N rows"; phone
 * cards with a filters sheet; dark tokens.
 *
 * EVERY NUMBER IS THE WORKER'S. `total`, each source's `total` and
 * `store_total`, and `in_both` (the search's tickers in both sources, across
 * every page) come from `GET /api/research/listed-companies`; the page counts
 * only what is on the page ("Same ticker, 2 sources").
 *
 * The URL state and the CSV mapping live in `listedCompaniesRead.js`; the page
 * that mounts this reads the URL, asks the Worker, and runs the export.
 */

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-violet-600 dark:focus-visible:outline-violet-400';
const BTN = `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 max-lg:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 ${FOCUS}`;
const BTN_PRIMARY = `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-violet-700 px-3.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 max-lg:min-h-[48px] dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400 ${FOCUS}`;
const LABEL = 'mb-1.5 block text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const FIELD = `min-h-[40px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink max-lg:min-h-[44px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 ${FOCUS}`;

/** The download glyph the canvas draws on its export buttons. */
function DownloadGlyph() {
  return (
    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" className="flex-none">
      <line x1="6" y1="1.5" x2="6" y2="7.5" stroke="currentColor" strokeWidth="1.6" />
      <polyline points="3.2,5 6,7.8 8.8,5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="1.8" y1="10.5" x2="10.2" y2="10.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 12 12" className="flex-none">
      <polyline points="7,1.5 10.5,1.5 10.5,5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10.5" y1="1.5" x2="5.5" y2="6.5" stroke="currentColor" strokeWidth="1.4" />
      <polyline points="9,7.5 9,10.5 1.5,10.5 1.5,3 4.5,3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * The scoped export (RML-04B, RML-06): the label says what is written and how
 * many rows, the line under it says which rows and in what order, and a
 * Completed or Error note follows a press. Disabled states say why in the label.
 * `exporter` is `{ ctl, note, run, busy }` from the page that owns the rows.
 */
export function ScopedExport({ exporter, block = false }) {
  if (!exporter?.ctl) return null;
  const { ctl, note, run, busy } = exporter;
  return (
    <div data-testid="scoped-export" className={`flex flex-col gap-1 ${block ? 'w-full' : 'items-end text-right max-sm:items-stretch max-sm:text-left'}`}>
      <button type="button" data-testid="scoped-export-button" onClick={ctl.disabled ? undefined : run}
        disabled={ctl.disabled || busy} aria-busy={busy ? 'true' : undefined}
        className={`${BTN_PRIMARY}${block ? ' w-full' : ''}`}>
        <DownloadGlyph />{busy ? `${ctl.label}…` : ctl.label}
      </button>
      {ctl.scope ? <small className="text-[11px] text-axal-muted dark:text-gray-400">{ctl.scope}</small> : null}
      {note?.ok ? (
        <div role="status" data-testid="scoped-export-done" className="flex flex-col gap-1 text-[12px]">
          <span className="font-semibold text-emerald-800 dark:text-emerald-300">✓ Downloaded · {fmt(note.count)} {note.count === 1 ? 'row' : 'rows'}</span>
          <span className="break-all font-mono text-[11px] text-axal-muted dark:text-gray-400">{note.file}</span>
        </div>
      ) : null}
      {note && !note.ok ? (
        <div role="alert" data-testid="scoped-export-error" className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-left text-[12px] dark:border-red-900 dark:bg-red-950/40">
          <b className="text-red-800 dark:text-red-300">{note.text || 'The file could not be created in this browser.'}</b>
          <span className="text-axal-muted dark:text-gray-400">Nothing was downloaded. The rows on screen are unchanged.</span>
          <button type="button" onClick={run} className={`${BTN} self-start`}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The source label (RML-02): a neutral chip whose letter tells the two apart
 * by shape, not colour — a filled "S" for Signal companies, an outlined "E"
 * for SEC EDGAR.
 */
function SourceChip({ source }) {
  const edgar = source === 'sec_edgar';
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-300 py-px pl-0.5 pr-2 text-[11px] font-bold text-axal-ink dark:border-gray-600 dark:text-gray-100 ${edgar ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800'}`}>
      <i aria-hidden="true" className={`grid h-[15px] w-[15px] place-items-center rounded font-mono text-[9px] font-extrabold not-italic ${edgar
        ? 'border-[1.5px] border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100'
        : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'}`}>{edgar ? 'E' : 'S'}</i>
      {SOURCE_LABEL[source] || SOURCE_LABEL.signal_companies}
    </span>
  );
}

/** The recorded source link, which opens in a new tab and says so. Signal companies return none. */
function SourceLink({ row, text }) {
  if (!row?.source_url) return <span className="text-[11px] text-axal-muted dark:text-gray-400">No link recorded</span>;
  return (
    <a href={row.source_url} target="_blank" rel="noreferrer" title={`${row.source_url} · opens in a new tab`}
      className={`inline-flex items-center gap-1 text-[12px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${FOCUS}`}>
      {text || 'Source file'}<ExternalGlyph /><span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function DupMark({ short = false }) {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-200 bg-white px-1.5 text-[10.5px] font-bold text-violet-700 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300">
      <span aria-hidden="true">⇄</span>{short ? '2 sources' : 'Same ticker, 2 sources'}
    </span>
  );
}

/**
 * Search name or ticker (RML-09 step 2): typing updates after a pause, Esc
 * clears, the ✕ clears and gives the field its focus back. Any change returns
 * to page 1 (the page's `onChange` does that).
 */
function SearchField({ value, onCommit, inputRef, label = 'Search name or ticker', hint = 'name contains · ticker starts with' }) {
  const id = useId();
  const [text, setText] = useState(value);
  const timer = useRef(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v) => { clearTimeout(timer.current); onCommit?.(v); };
  const change = (v) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit?.(v), 350);
  };
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label} <small className="ml-1 font-normal text-axal-muted dark:text-gray-400">{hint}</small>
      </label>
      <span className="relative block">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-axal-faint" />
        <input id={id} ref={inputRef} type="search" value={text} maxLength={120} placeholder="e.g. a ticker or a company name"
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setText(''); commit(''); }
            if (e.key === 'Enter') { e.preventDefault(); commit(text); }
          }}
          className={`${FIELD} pl-9 pr-10`} />
        {text ? (
          <button type="button" aria-label="Clear search" onClick={() => { setText(''); commit(''); inputRef?.current?.focus(); }}
            className={`absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100 ${FOCUS}`}>
            ✕
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Source as a radio group (RML-09 step 4): one Tab stop, arrows choose. While a
 * country or sector filter is on, SEC EDGAR is struck through and says why: it
 * records neither, so it could match nothing (RML-05).
 */
function SourceGroup({ value, onChange, edgarOff }) {
  const id = useId();
  const refs = useRef([]);
  const live = LISTED_SOURCES.map((s) => !(edgarOff && s.value === 'sec_edgar'));
  const move = (from, step) => {
    for (let i = 1; i <= LISTED_SOURCES.length; i += 1) {
      const j = (from + step * i + LISTED_SOURCES.length) % LISTED_SOURCES.length;
      if (live[j]) { onChange(LISTED_SOURCES[j].value); refs.current[j]?.focus(); return; }
    }
  };
  return (
    <div>
      <span id={id} className={LABEL}>Source</span>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex flex-wrap rounded-lg border border-axal-hairline bg-white p-0.5 dark:border-gray-700 dark:bg-gray-950">
        {LISTED_SOURCES.map((s, i) => {
          const on = s.value === value;
          const off = !live[i];
          return (
            <button key={s.value || 'all'} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on}
              aria-disabled={off ? 'true' : undefined}
              title={off ? 'Left out while a country or sector filter is on: SEC EDGAR records neither' : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => { if (!off) onChange(s.value); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
              }}
              className={`inline-flex min-h-[36px] items-center gap-1 rounded-md px-3 text-[12.5px] font-semibold ${FOCUS} ${on
                ? 'bg-violet-50 text-violet-800 ring-1 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-700'
                : 'text-axal-ink dark:text-gray-200'} ${off ? 'cursor-not-allowed text-axal-faint line-through dark:text-gray-500' : ''}`}>
              {on ? <span aria-hidden="true">✓</span> : null}{s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SortSelect({ value, onChange, id }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>Sort</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {LISTED_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  );
}

/** The skeleton in the table's shape: four rows of four bars, never a 0. */
function Skeleton() {
  return (
    <div aria-hidden="true" className="mt-2 space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-[60px_1fr_90px_120px] gap-3">
          {[0, 1, 2, 3].map((j) => <span key={j} className="block h-3 rounded bg-gray-200 dark:bg-gray-800" />)}
        </div>
      ))}
    </div>
  );
}

/** The country's name as the rows on screen spell it, else its code. */
function countryNameOf(view, items) {
  if (!view.country) return null;
  return items.find((x) => x.country_code === view.country && x.country)?.country || view.country;
}

/** The sentence under the count (RML-02, RML-03, RML-04, RML-05). Numbers are the Worker's. */
function CountSentence({ view, data }) {
  const sig = (data.sources || []).find((s) => s.key === 'signal_companies');
  const ed = (data.sources || []).find((s) => s.key === 'sec_edgar');
  const q = view.q.trim();
  if (edgarLeftOut(view)) {
    const what = view.country && view.sector ? 'a country and a sector filter are' : view.country ? 'a country filter is' : 'a sector filter is';
    const noun = view.country && view.sector ? 'country or sector' : view.country ? 'country' : 'sector';
    return (
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        <b className="text-axal-ink dark:text-gray-100">SEC EDGAR is left out while {what} on.</b>{' '}
        EDGAR records no {noun} for its {ed?.store_total != null ? `${fmt(ed.store_total)} ` : ''}companies, so none of them can match.
        {view.country && view.sector ? '' : ` A ${view.country ? 'sector' : 'country'} filter works the same way.`} Remove the filter to see EDGAR rows again.
      </p>
    );
  }
  if (view.source === 'sec_edgar') {
    return <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">SEC EDGAR records ticker, name, exchange and CIK. Its rows carry no country, sector, market cap band or employees.</p>;
  }
  if (view.source === 'signal_companies') {
    return <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">Signal companies carry the country, sector and bands their source sets. SEC EDGAR is left out by your Source choice.</p>;
  }
  // `in_both` is this search's count across every page (D7172); an older Worker sent
  // only the store-wide overlap, which is the same thing only with no search.
  const both = data.in_both ?? (!q ? ed?.also_signal_companies : null);
  return (
    <p className="mt-0.5 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
      {q ? '' : 'All sources, no search. '}
      {sig && ed ? <><b className="text-axal-ink dark:text-gray-100">{fmt(sig.total)}</b> from Signal companies, with bands, and <b className="text-axal-ink dark:text-gray-100">{fmt(ed.total)}</b> from SEC EDGAR. </> : null}
      {both ? (q
        ? <><b className="text-axal-ink dark:text-gray-100">{fmt(both)}</b> {both === 1 ? 'ticker in this search is' : 'tickers in this search are'} in both sources: each keeps its own row with what that source records. The rows are not merged. </>
        : <><b className="text-axal-ink dark:text-gray-100">{fmt(both)}</b> {both === 1 ? 'ticker is' : 'tickers are'} in both sources, so each appears once per source and is counted twice. </>) : null}
      {q ? '' : 'The company directory does not record listing status.'}
    </p>
  );
}

/** Details for one record (RML-03): what its source records, and what it does not. */
function RowDetails({ x }) {
  const edgar = x.source === 'sec_edgar';
  const DT = 'text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-faint dark:text-gray-500';
  const DD = 'mt-0.5 text-[12.5px] text-axal-ink dark:text-gray-100';
  return edgar ? (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
      <div><dt className={DT}>CIK</dt><dd className={`${DD} font-mono font-semibold`}>{x.cik || <Unrecorded />}</dd></div>
      <div><dt className={DT}>Other listings</dt><dd className={DD}>{Array.isArray(x.other_listings) && x.other_listings.length ? otherListingsText(x.other_listings) : <StateChip kind="none" />}</dd></div>
      <div><dt className={DT}>Read from SEC EDGAR</dt><dd className={DD}>{shortDate(x.as_of) || <Unrecorded />}</dd></div>
      <div><dt className={DT}>Source</dt><dd className={DD}><SourceLink row={x} text={sourceFileName(x.source_url)} /></dd></div>
      <div className="sm:col-span-2"><dt className={DT}>Not recorded by this source</dt><dd className={DD}>Country, sector, market cap band and employees. EDGAR’s file lists ticker, name, exchange and CIK.</dd></div>
      <div className="sm:col-span-2"><dt className={DT}>Licence</dt><dd className={DD}>{x.licence || <Unrecorded />}</dd></div>
    </dl>
  ) : (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
      <div><dt className={DT}>Updated by the source</dt><dd className={DD}>{shortDate(x.updated_at) || <Unrecorded />}</dd></div>
      <div><dt className={DT}>Region</dt><dd className={DD}>{x.region || <Unrecorded />}</dd></div>
      <div><dt className={DT}>Source link</dt><dd className={DD}><SourceLink row={x} /></dd></div>
      <div><dt className={DT}>Not recorded by this source</dt><dd className={DD}>CIK, other listings and licence.</dd></div>
    </dl>
  );
}

const rowKey = (x) => `${x.source || 'signal_companies'}:${x.cik || x.symbol}`;

/** The desktop table (RML-02, RML-03, RML-04). */
function ListedTable({ items, info, open, onToggle }) {
  const [showFolded, setShowFolded] = useState(false);
  const dups = inBothOnPage(items);
  const foldable = foldedColumns(items);
  const folded = new Set(showFolded ? [] : foldable.map((c) => c.key));
  const edgarOnly = allEdgar(items);
  const cols = [
    { key: 'symbol', label: 'Ticker' },
    { key: 'name', label: 'Company' },
    ...(edgarOnly ? [{ key: 'cik', label: 'CIK' }] : []),
    { key: 'exchange', label: 'Exchange' },
    ...(edgarOnly ? [{ key: 'other_listings', label: 'Other listings' }] : []),
    { key: 'country', label: 'Country' },
    { key: 'sector', label: 'Sector' },
    { key: 'market_cap_band', label: 'Market cap band' },
    { key: 'employee_band', label: 'Employees' },
    { key: 'source', label: 'Source' },
  ].filter((c) => !folded.has(c.key));
  const span = cols.length + 1;
  const TD = 'py-2 pr-3 align-top';
  const cell = (x, c) => {
    switch (c.key) {
      case 'symbol': return <td key={c.key} className={`${TD} font-mono font-semibold text-axal-ink dark:text-gray-100`}>{x.symbol}</td>;
      case 'name': return (
        <td key={c.key} className={`${TD} text-axal-ink dark:text-gray-100`}>
          <b className="font-semibold">{x.name}</b>{dups.has(x.symbol) ? <DupMark /> : null}
          {!edgarOnly && x.cik ? <span className="block font-mono text-[10.5px] text-axal-faint dark:text-gray-500">CIK {x.cik}</span> : null}
        </td>
      );
      case 'cik': return <td key={c.key} className={`${TD} font-mono text-[12px]`}>{x.cik || <Unrecorded />}</td>;
      case 'other_listings': return (
        <td key={c.key} className={TD}>{Array.isArray(x.other_listings) && x.other_listings.length
          ? <span className="font-mono text-[12px]">{otherListingsText(x.other_listings)}</span> : <StateChip kind="none" />}</td>
      );
      case 'source': return (
        <td key={c.key} className={TD}>
          <SourceChip source={x.source || 'signal_companies'} />
          <div className="mt-1"><SourceLink row={x} /></div>
        </td>
      );
      default: return <td key={c.key} className={TD}>{x[c.key] || <Unrecorded />}</td>;
    }
  };
  return (
    <div>
      {foldable.length ? (
        <div data-testid="listed-folded" className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-axal-hairline px-3 py-2 text-[12px] text-axal-muted dark:border-gray-700 dark:text-gray-400">
          <StateChip kind="not_recorded" />
          <span>
            <b className="text-axal-ink dark:text-gray-100">{foldable.map((c) => c.label).join(', ')}</b>
            {foldable.length === 1 ? ' is' : ' are'} Not recorded for every row in this view, so {foldable.length === 1 ? 'its column is' : 'their columns are'} folded. The export keeps {foldable.length === 1 ? 'it' : 'them'}, marked Not recorded.
          </span>
          <button type="button" aria-pressed={showFolded} onClick={() => setShowFolded((v) => !v)} className={`${BTN} ml-auto min-h-[32px]`}>
            {showFolded ? 'Fold them again' : 'Show folded columns'}
          </button>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <caption className="sr-only">Listed companies, rows {info.from} to {info.to} of {info.total}</caption>
          <thead>
            <tr className="border-b border-axal-hairline text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:border-gray-800 dark:text-gray-500">
              {cols.map((c) => <th key={c.key} scope="col" className="py-2 pr-3">{c.label}</th>)}
              <th scope="col" className="py-2"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => {
              const k = rowKey(x);
              const isOpen = open.has(k);
              return (
                <React.Fragment key={k}>
                  <tr className={`border-b border-axal-hairline/60 dark:border-gray-800 ${dups.has(x.symbol) ? 'bg-violet-50/40 dark:bg-violet-950/20' : ''}`}>
                    {cols.map((c) => cell(x, c))}
                    <td className="py-1.5 text-right align-top">
                      <button type="button" aria-expanded={isOpen} aria-controls={`det-${k}`} onClick={() => onToggle(k)}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${x.symbol}, ${SOURCE_LABEL[x.source || 'signal_companies']}`}
                        className={`inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${FOCUS}`}>
                        Details <span aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr id={`det-${k}`} data-testid="listed-details" className="border-b border-axal-hairline bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60">
                      <td colSpan={span} className="px-3 py-3"><RowDetails x={x} /></td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Phone cards (RML-10A, RML-10B): company, ticker and source first; the rest behind More details. */
function ListedCards({ items, open, onToggle }) {
  const dups = inBothOnPage(items);
  const DT = 'text-[11px] font-semibold text-axal-muted dark:text-gray-400';
  const DD = 'text-[12.5px] text-axal-ink dark:text-gray-100';
  return (
    <div className="space-y-2">
      {items.map((x) => {
        const k = rowKey(x);
        const isOpen = open.has(k);
        const edgar = x.source === 'sec_edgar';
        return (
          <article key={k} data-testid="listed-card" className="rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <b className="block text-[14px] text-axal-ink dark:text-gray-100">{x.name}</b>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{x.symbol}</span>
              <SourceChip source={x.source || 'signal_companies'} />
              {dups.has(x.symbol) ? <DupMark short /> : null}
            </div>
            <button type="button" aria-expanded={isOpen} onClick={() => onToggle(k)}
              aria-label={`${isOpen ? 'Fewer' : 'More'} details for ${x.symbol}, ${SOURCE_LABEL[x.source || 'signal_companies']}`}
              className={`mt-1 inline-flex min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-axal-violet dark:text-violet-300 ${FOCUS}`}>
              {isOpen ? 'Fewer details' : 'More details'}<span aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen ? (
              <>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                  <dt className={DT}>Exchange</dt><dd className={DD}>{x.exchange || <Unrecorded />}</dd>
                  <dt className={DT}>CIK</dt><dd className={`${DD} font-mono`}>{x.cik || <Unrecorded />}</dd>
                  <dt className={DT}>Country</dt><dd className={DD}>{x.country || <Unrecorded />}</dd>
                  <dt className={DT}>Sector</dt><dd className={DD}>{x.sector || <Unrecorded />}</dd>
                  <dt className={DT}>Market cap</dt><dd className={DD}>{x.market_cap_band || <Unrecorded />}</dd>
                  <dt className={DT}>Employees</dt><dd className={DD}>{x.employee_band || <Unrecorded />}</dd>
                  <dt className={DT}>Read</dt><dd className={DD}>{(edgar ? shortDate(x.as_of) : (shortDate(x.updated_at) && `Updated ${shortDate(x.updated_at)}`)) || <Unrecorded />}</dd>
                </dl>
                {x.source_url ? (
                  <a href={x.source_url} target="_blank" rel="noreferrer" className={`${BTN} mt-2 w-full`}>
                    Open source file<ExternalGlyph /><span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">No source link recorded</p>}
              </>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

/** The phone's filters sheet (RML-10C): Source and Sort; Apply returns to page 1. */
function FiltersSheet({ view, onApply, onClose, opener }) {
  const [source, setSource] = useState(view.source);
  const [sort, setSort] = useState(view.sort);
  const sortId = useId();
  const off = edgarLeftOut(view);
  return (
    <PhoneSheet title="Filters" onClose={onClose} opener={opener}>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className={LABEL}>Source</legend>
        {LISTED_SOURCES.map((s) => {
          const disabled = off && s.value === 'sec_edgar';
          const on = source === s.value;
          return (
            <label key={s.value || 'all'} className={`flex min-h-[48px] items-start gap-2.5 rounded-[10px] border px-2.5 py-2 ${on
              ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950' : 'border-axal-hairline dark:border-gray-800'} ${disabled ? 'opacity-60' : ''}`}>
              <input type="radio" name="listed-source" checked={on} disabled={disabled} onChange={() => setSource(s.value)} className="mt-1 accent-violet-600" />
              <span>
                <b className={`text-[13.5px] text-axal-ink dark:text-gray-100 ${disabled ? 'line-through' : ''}`}>{s.label}</b>
                <span className="block text-[12px] text-axal-muted dark:text-gray-400">{disabled ? 'Left out while a country or sector filter is on' : s.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="mt-3"><SortSelect id={sortId} value={sort} onChange={setSort} /></div>
      <p className="mt-2 text-[12px] text-axal-muted dark:text-gray-400">Applying returns to page 1.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setSource(''); setSort(LISTED_SORTS[0].value); }} className={`${BTN} min-h-[48px]`}>Reset</button>
        <button type="button" onClick={() => onApply({ source, sort })} className={`${BTN_PRIMARY} min-h-[48px]`}>Apply</button>
      </div>
    </PhoneSheet>
  );
}

/** The two source captions (RML-02, RML-04), from the Worker's `sources`. */
function SourceCaptions({ view, data }) {
  const sig = (data?.sources || []).find((s) => s.key === 'signal_companies');
  const ed = (data?.sources || []).find((s) => s.key === 'sec_edgar');
  const narrowed = !!(view.q.trim() || view.country || view.sector);
  const n = (s, noun) => (narrowed && s.store_total != null
    ? `${fmt(s.total)} of ${fmt(s.store_total)} ${noun} match${view.q.trim() ? ` “${view.q.trim()}”` : ''}`
    : `${fmt(s.store_total ?? s.total)} ${noun}`);
  const showSig = sig && view.source !== 'sec_edgar';
  const showEd = ed && view.source !== 'signal_companies' && !edgarLeftOut(view);
  if (!showSig && !showEd) return null;
  return (
    <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-axal-faint dark:text-gray-500">
      {showSig ? (
        <p data-testid="listed-signal-source">
          Signal companies · {n(sig, 'listed companies')} · bands as the source sets them{shortDate(sig.as_of) ? ` · updated ${shortDate(sig.as_of)}` : ''}
        </p>
      ) : null}
      {showEd ? (
        <p data-testid="listed-edgar-source">
          {ed.label || SOURCE_LABEL.sec_edgar} · {n(ed, 'companies')}{shortDate(ed.as_of) ? ` · read ${shortDate(ed.as_of)}` : ''}
          {ed.licence ? ` · ${ed.licence}` : ''}
          {ed.url ? <>{' · '}<a href={ed.url} target="_blank" rel="noreferrer" className={`hover:underline ${FOCUS}`}>{String(ed.url).replace(/^https?:\/\/(www\.)?/, '')} ↗<span className="sr-only"> (opens in a new tab)</span></a></> : null}
          {' '}· EDGAR records ticker, name, exchange and CIK only, so country, sector, market cap and employees are Not recorded for its rows.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Listed companies tab. `listed` is the read (`{ status, data, reload }`),
 * `view` the URL's view (`readListedQuery`), `onChange(patch)` writes the URL
 * (anything but `page` returns to page 1), `onClear` clears the filters, and
 * `exporter` is the page's scoped export.
 */
export function PublicPanel({ listed, view = readListedQuery(null), onChange = null, onClear = null, exporter = null, onPage = null }) {
  const phone = usePhoneWidth();
  const heading = useRef(null);
  const search = useRef(null);
  const filtersBtn = useRef(null);
  const pendingFocus = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [sheet, setSheet] = useState(false);
  const sortId = useId();
  const change = (patch) => onChange?.(patch);
  const goPage = (p) => {
    pendingFocus.current = true;
    if (onChange) change({ page: p });
    else onPage?.((p - 1) * (listed.data?.limit || 50));
  };
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // RML-09: after paging and Retry the result heading takes focus once the rows
  // are in, so a screen reader hears the new count; a Next that has become
  // disabled never keeps it.
  useEffect(() => {
    if (listed.status !== 'loading') setRetrying(false);
    if (listed.status === 'ready' && pendingFocus.current) {
      pendingFocus.current = false;
      heading.current?.focus?.();
      heading.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [listed.status, listed.data]);
  useEffect(() => { setOpen(new Set()); }, [listed.data]);

  const data = listed.data;
  const items = data?.items || [];
  const info = pageInfo(data);
  const countryName = countryNameOf(view, items);
  const ctx = headingContext(view, info, countryName);
  const filtered = !!(view.q.trim() || view.source || view.country || view.sector);
  const retry = () => { pendingFocus.current = true; setRetrying(true); listed.reload?.(); };
  const clear = () => { onClear?.(); search.current?.focus?.(); };
  const exp = exporter || { ctl: listedExport(listed, view, countryName) };

  const toolbar = phone ? (
    <div className="space-y-2">
      <SearchField value={view.q} onCommit={(q) => change({ q })} inputRef={search} />
      <button ref={filtersBtn} type="button" aria-haspopup="dialog" onClick={() => setSheet(true)} className={`${BTN} w-full justify-between`}>
        <span>Filters{view.source || view.sort !== LISTED_SORTS[0].value ? ` · ${[view.source, view.sort !== LISTED_SORTS[0].value].filter(Boolean).length}` : ''}</span>
        <span className="text-axal-muted dark:text-gray-400">Source: {view.source ? SOURCE_LABEL[view.source] : 'All sources'} ▾</span>
      </button>
    </div>
  ) : (
    <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto_220px]">
      <SearchField value={view.q} onCommit={(q) => change({ q })} inputRef={search} />
      <SourceGroup value={view.source} onChange={(source) => change({ source })} edgarOff={edgarLeftOut(view)} />
      <SortSelect id={sortId} value={view.sort} onChange={(sort) => change({ sort })} />
    </div>
  );

  const chips = view.country || view.sector ? (
    <div data-testid="listed-filter-chips" className="flex flex-wrap items-center gap-2">
      {view.country ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 pl-2.5 text-[12px] font-semibold text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
          Country: {countryName}
          <button type="button" aria-label="Remove country filter" onClick={() => change({ country: '' })} className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${FOCUS}`}>✕</button>
        </span>
      ) : null}
      {view.sector ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 pl-2.5 text-[12px] font-semibold text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200">
          Sector: {view.sector}
          <button type="button" aria-label="Remove sector filter" onClick={() => change({ sector: '' })} className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${FOCUS}`}>✕</button>
        </span>
      ) : null}
      <button type="button" onClick={clear} className={`${BTN} min-h-[32px]`}>Clear filters</button>
    </div>
  ) : null;

  let body;
  let count;
  if (listed.status === 'unreadable' || listed.status === 'not_found') {
    count = null;
    body = (
      <div data-testid="listed-unreadable">
        <Unreadable what="The listed companies" claim={`This is not a sign there are none; try again.${filtered ? ' Your search and filters are kept.' : ''}`} onRetry={retry} />
      </div>
    );
  } else if (!data || listed.status === 'loading') {
    count = <h2 ref={heading} tabIndex={-1} className={`text-[16px] font-bold text-axal-ink dark:text-gray-100 ${FOCUS}`}>Counting…</h2>;
    body = (
      <div>
        <p role="status" className="text-[12.5px] text-axal-muted dark:text-gray-400">{retrying || data ? 'Reading again…' : 'Reading the listed companies…'}</p>
        <Skeleton />
      </div>
    );
  } else {
    count = (
      <>
        <h2 ref={heading} tabIndex={-1} data-testid="listed-heading" className={`rounded text-[16px] font-bold text-axal-ink dark:text-gray-100 ${FOCUS}`}>
          {fmt(info.total)} <small className="text-[13px] font-semibold text-axal-muted dark:text-gray-400">{info.total === 1 ? 'listing record' : 'listing records'}{ctx ? ` ${ctx}` : ''}</small>
        </h2>
        <CountSentence view={view} data={data} />
      </>
    );
    if (!info.total && !filtered) {
      body = (
        <div data-testid="listed-empty" className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-800">
          <StateChip kind="none" />
          <p className="mt-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">No listed companies are recorded yet.</p>
          <p className="text-[12px] text-axal-muted dark:text-gray-400">Both stores are empty: the read worked and holds nothing.</p>
        </div>
      );
    } else if (!info.total) {
      body = (
        <div data-testid="listed-no-match" className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-800">
          <StateChip kind="none" label="No match" />
          <p className="mt-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
            No listing record matches{view.q.trim() ? ` “${view.q.trim()}”` : ' these filters'}{view.source ? ` in ${SOURCE_LABEL[view.source]}` : ''}.
          </p>
          <p className="text-[12px] text-axal-muted dark:text-gray-400">Check the ticker, or search all sources. A ticker matches from its first letter.</p>
          <button type="button" data-testid="listed-clear-filters" onClick={clear} className={`${BTN} mt-2`}>Clear filters</button>
        </div>
      );
    } else if (!items.length) {
      body = (
        <div data-testid="listed-past-end" className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-800">
          <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">Page {fmt(view.page)} is past the last page of this list, page {fmt(info.pages)}.</p>
          <button type="button" onClick={() => goPage(1)} className={`${BTN} mt-2`}>Go to page 1</button>
        </div>
      );
    } else {
      body = phone
        ? <ListedCards items={items} open={open} onToggle={toggle} />
        : <ListedTable key={`${view.source}|${info.page}`} items={items} info={info} open={open} onToggle={toggle} />;
    }
  }

  const pager = data && items.length && info.pages > 1 ? (
    <div data-testid="listed-pager" className="mt-3 flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-3 text-[12px] text-axal-muted dark:border-gray-800 dark:text-gray-400">
      <span>{pagerLine(info, fmt)}</span>
      <span className="ml-auto flex gap-2">
        <button type="button" disabled={info.page <= 1} onClick={() => goPage(info.page - 1)} className={BTN}>‹ Previous</button>
        <button type="button" disabled={info.page >= info.pages} onClick={() => goPage(info.page + 1)} className={BTN}>Next ›</button>
      </span>
    </div>
  ) : (data && items.length ? (
    <p data-testid="listed-pager" className="mt-3 border-t border-axal-hairline pt-3 text-[12px] text-axal-muted dark:border-gray-800 dark:text-gray-400">{pagerLine(info, fmt)}</p>
  ) : null);

  return (
    <div data-testid="markets-public" className="space-y-3">
      {toolbar}
      {chips}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div aria-live="polite" className="min-w-0 flex-1">{count}</div>
        {phone ? null : <ScopedExport exporter={exp} />}
      </div>
      {body}
      {phone ? (
        <div data-testid="listed-phone-bar" className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-axal-hairline bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
          {data && items.length && info.pages > 1 ? (
            <div className="flex items-center justify-between gap-2 text-[12.5px] text-axal-muted dark:text-gray-400">
              <button type="button" disabled={info.page <= 1} onClick={() => goPage(info.page - 1)} className={`${BTN} min-h-[44px]`}>‹ Previous</button>
              <span>Page {fmt(info.page)} of {fmt(info.pages)}</span>
              <button type="button" disabled={info.page >= info.pages} onClick={() => goPage(info.page + 1)} className={`${BTN} min-h-[44px]`}>Next ›</button>
            </div>
          ) : null}
          <ScopedExport exporter={exp} block />
        </div>
      ) : pager}
      {data ? <SourceCaptions view={view} data={data} /> : null}
      {sheet ? (
        <FiltersSheet view={view} opener={filtersBtn} onClose={() => setSheet(false)}
          onApply={(patch) => { setSheet(false); change(patch); }} />
      ) : null}
    </div>
  );
}
