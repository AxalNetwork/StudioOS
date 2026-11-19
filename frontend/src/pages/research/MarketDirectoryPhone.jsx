import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StateChip } from '../../ui/Honesty';
import { researchMarketsApi } from '../../lib/api/researchMarkets.js';
import { FRESH_OPTIONS, SRC_OPTIONS, countryName, marketListParams } from './marketDirectoryQuery.js';
import { THESIS_EDIT } from './marketDirectoryExport.js';

/**
 * D7171 part 2 (#7171, canvas D7036, board RMD-11) — the Markets directory at
 * phone width (below `md`).
 *
 * ONE FILTERS SHEET (RMD-11B). Country, Source freshness and Source type are
 * one "Filters · N" button opening one bottom sheet. Choices are a draft until
 * "Show N markets"; Reset clears the draft. N is the Worker's `total` for the
 * draft, read with the same request the page would make (limit 1), so the
 * button never promises a count the directory will not show. While that count
 * is being read, or if it cannot be read, the button says "Show markets" with
 * no number.
 *
 * THE COLLAPSED THESIS STRIP (RMD-11D, E, F). An investor's thesis is one line
 * that opens: "Your thesis · <sectors>" and the match count over the filtered
 * directory; open, it has the thesis, how a match is made, "Show only markets
 * that match" and Edit thesis. No thesis and an unreadable profile keep their
 * own words.
 */

const fmt = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const PRIMARY = 'inline-flex min-h-[48px] items-center justify-center rounded-lg border border-violet-600 bg-violet-600 px-3 text-[13.5px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-violet-500 dark:bg-violet-600 dark:text-white';
const EYEBROW = 'mt-3 block text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-faint dark:text-gray-400';
/** Countries shown before "All N countries". */
export const COUNTRIES_SHOWN = 5;

/** How many of the three sheet filters are set: the "Filters · N" count. */
export const sheetFilterCount = (v) => (v?.country?.length || 0) + (v?.fresh ? 1 : 0) + (v?.src ? 1 : 0);

/** The draft → the count request: the page's own request, one row. */
export function draftCountParams(view, draft, sectors = []) {
  return { ...marketListParams({ ...view, ...draft, page: 1 }, sectors), limit: 1, offset: undefined };
}

/** The apply button's words: the Worker's count for the draft, or none while it is unknown. */
export function showLabel(count) {
  if (count?.status !== 'ready') return 'Show markets';
  const n = Number(count.total) || 0;
  return `Show ${fmt(n)} ${n === 1 ? 'market' : 'markets'}`;
}

function Option({ type, name, checked, onChange, label, count }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-2 text-[13px] text-axal-ink hover:bg-violet-50 dark:text-gray-100 dark:hover:bg-violet-950">
      <span className="flex items-center gap-2">
        <input type={type} name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-violet-600" />
        {label}
      </span>
      <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{count == null ? '' : fmt(count)}</span>
    </label>
  );
}

const countOf = (facet, value) => (facet ? (facet.options?.find((o) => (o.value ?? o.code) === value)?.count ?? 0) : null);

/** The sheet itself: pure over its props, so a test can draw it open. */
export function FiltersSheetBody({ draft, setDraft, facets, count, onApply, onClose, allCountries, setAllCountries, headingRef = null }) {
  const options = (facets?.country?.options || []).map((o) => ({ value: o.code, label: countryName(o.code), count: o.count }));
  for (const c of draft.country) if (!options.some((o) => o.value === c)) options.push({ value: c, label: countryName(c), count: 0 });
  const shown = allCountries ? options : options.filter((o, i) => i < COUNTRIES_SHOWN || draft.country.includes(o.value));
  const hidden = options.length - shown.length;
  const notRecorded = Number(facets?.country?.not_recorded) || 0;
  const toggleCountry = (c) => setDraft((d) => ({ ...d, country: d.country.includes(c) ? d.country.filter((x) => x !== c) : [...d.country, c] }));
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="markets-filters-h" data-testid="markets-filters-sheet"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-axal-hairline bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <div className="overflow-y-auto px-4 pb-2 pt-2">
        <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-axal-hairline dark:bg-gray-700" />
        <div className="mt-2 flex items-center justify-between">
          <h2 id="markets-filters-h" ref={headingRef} tabIndex={-1} className="text-[16px] font-bold text-axal-ink dark:text-gray-100">Filters</h2>
          <button type="button" onClick={onClose} aria-label="Close filters" className={`${BTN} w-11 px-0`}>✕</button>
        </div>
        <fieldset className="mt-2">
          <legend className={EYEBROW}>Country</legend>
          {shown.map((o) => (
            <Option key={o.value} type="checkbox" name="markets-country" checked={draft.country.includes(o.value)} onChange={() => toggleCountry(o.value)} label={o.label} count={o.count} />
          ))}
          {hidden > 0 ? (
            <button type="button" onClick={() => setAllCountries(true)} className="min-h-[44px] text-[12.5px] font-semibold text-axal-violet underline dark:text-violet-300">
              All {fmt(options.length)} countries ▾
            </button>
          ) : null}
          <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
            {notRecorded ? `${fmt(notRecorded)} ${notRecorded === 1 ? 'market has' : 'markets have'} no recorded country and never match one.` : 'A market with no recorded country never matches one.'}
          </p>
        </fieldset>
        <fieldset className="mt-2">
          <legend className={EYEBROW}>Source freshness</legend>
          <Option type="radio" name="markets-fresh" checked={!draft.fresh} onChange={() => setDraft((d) => ({ ...d, fresh: '' }))} label="Any date" />
          {FRESH_OPTIONS.map((o) => (
            <Option key={o.value} type="radio" name="markets-fresh" checked={draft.fresh === o.value} onChange={() => setDraft((d) => ({ ...d, fresh: o.value }))} label={o.label} count={countOf(facets?.fresh, o.value)} />
          ))}
        </fieldset>
        <fieldset className="mt-2">
          <legend className={EYEBROW}>Source type</legend>
          <Option type="radio" name="markets-src" checked={!draft.src} onChange={() => setDraft((d) => ({ ...d, src: '' }))} label="Any source" />
          {SRC_OPTIONS.map((o) => (
            <Option key={o.value} type="radio" name="markets-src" checked={draft.src === o.value} onChange={() => setDraft((d) => ({ ...d, src: o.value }))} label={o.label} count={countOf(facets?.src, o.value)} />
          ))}
        </fieldset>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
        <button type="button" className={`${BTN} min-h-[48px]`} onClick={() => setDraft({ country: [], fresh: '', src: '' })}>Reset</button>
        <button type="button" className={PRIMARY} onClick={onApply} data-testid="markets-filters-apply" aria-live="polite">{showLabel(count)}</button>
      </div>
    </div>
  );
}

/**
 * "Filters · N" and its sheet. `sectors` are the thesis's tracked sectors when
 * the view asks for thesis matches, so the count is the one the page would show.
 */
export function FiltersSheet({ view, facets, onPatch, sectors = [], list = researchMarketsApi.list }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ country: view.country, fresh: view.fresh, src: view.src });
  const [allCountries, setAllCountries] = useState(false);
  const [count, setCount] = useState({ status: 'idle' });
  const [draftFacets, setDraftFacets] = useState(null);
  const btn = useRef(null);
  const heading = useRef(null);
  const n = sheetFilterCount(view);
  const key = JSON.stringify(draftCountParams(view, draft, sectors));

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setCount({ status: 'loading' });
    const t = setTimeout(() => {
      Promise.resolve().then(() => list(JSON.parse(key)))
        .then((res) => { if (live) { setCount({ status: 'ready', total: res?.total }); setDraftFacets(res?.facets || null); } })
        .catch(() => { if (live) setCount({ status: 'unreadable' }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) heading.current?.focus?.(); }, [open]);

  const close = () => { setOpen(false); btn.current?.focus?.(); };
  const apply = () => { onPatch({ country: draft.country, fresh: draft.fresh, src: draft.src }); close(); };
  return (
    <div onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}>
      <button ref={btn} type="button" aria-haspopup="dialog" aria-expanded={open} data-testid="markets-filters-open"
        onClick={() => { setDraft({ country: view.country, fresh: view.fresh, src: view.src }); setAllCountries(false); setOpen(true); }}
        className={`${BTN} w-full ${n ? 'border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300' : ''}`}>
        Filters{n ? ` · ${n}` : ''}
      </button>
      {open ? (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60" onClick={close} />
          <FiltersSheetBody draft={draft} setDraft={setDraft} facets={draftFacets || facets} count={count} onApply={apply} onClose={close}
            allCountries={allCountries} setAllCountries={setAllCountries} headingRef={heading} />
        </>
      ) : null}
    </div>
  );
}

// ---- The collapsed thesis strip (RMD-11D/E/F) ---------------------------------------

/** The investor's thesis at phone width: one line that opens. */
export function ThesisStrip({ read, matchCount = 0, total = 0, onlyMatches = false, onOnlyMatches, onRetry, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  const box = 'rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-950';
  if (!read || read.status === 'loading') {
    return <section className={box} data-testid="markets-thesis-strip"><p role="status" className="text-[12.5px] text-axal-muted dark:text-gray-400">Reading your thesis…</p></section>;
  }
  if (read.status !== 'ready') {
    return (
      <section className={box} data-testid="markets-thesis-strip">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-axal-ink dark:text-gray-100">Your thesis <StateChip kind="unavailable" /></p>
        <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">Your investor profile could not be read, so no thesis matches are shown. This is not a claim that nothing matches.</p>
        <button type="button" onClick={onRetry} className={`${BTN} mt-2`}>Retry</button>
      </section>
    );
  }
  if (read.thesis.kind === 'none') {
    return (
      <section className={box} data-testid="markets-thesis-strip">
        <p className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Your thesis</p>
        <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">No thesis on your profile yet. The directory works without one.</p>
        <Link to={THESIS_EDIT} className={`${BTN} mt-2 w-full`}>Add a thesis in Settings</Link>
      </section>
    );
  }
  const t = read.thesis;
  const mapped = t.via.filter((v) => v.tracked.length);
  return (
    <section className={box} data-testid="markets-thesis-strip">
      <button type="button" aria-expanded={open} aria-controls="markets-thesis-strip-body" onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[13px] font-bold text-axal-ink dark:text-gray-100">
        <span className="min-w-0 truncate">Your thesis{t.sectors.length ? ` · ${t.sectors.join(', ')}` : ''}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {!open ? (
        <p className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="thesis-strip-count">
          {!t.tracked.length ? 'No profile sector maps to a tracked sector · tap to read the thesis'
            : onlyMatches ? `${fmt(total)} markets match · showing only these · tap to read the thesis`
              : `${fmt(matchCount)} of ${fmt(total)} markets match · tap to read the thesis`}
        </p>
      ) : (
        <div id="markets-thesis-strip-body" className="mt-1 space-y-2 text-[12.5px]">
          {t.text ? <p className="leading-relaxed text-axal-ink dark:text-gray-100">{t.text}</p> : null}
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px]">
            {t.stages.length ? <><dt className="font-semibold text-axal-faint">Stages</dt><dd className="text-axal-ink dark:text-gray-100">{t.stages.join(' · ')}</dd></> : null}
            {t.geos.length ? <><dt className="font-semibold text-axal-faint">Geographies</dt><dd className="text-axal-ink dark:text-gray-100">{t.geos.join(' · ')}</dd></> : null}
            {t.anti.length ? <><dt className="font-semibold text-axal-faint">Anti-thesis</dt><dd className="text-axal-ink dark:text-gray-100">{t.anti.join(' · ')}</dd></> : null}
          </dl>
          <p className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
            A market matches only when its tracked sector is one of your profile sectors{mapped.length ? `: ${mapped.map((v) => `${v.sector} → ${v.tracked.join(', ')}`).join('; ')}` : ''}. Keywords and geographies never make a match.
          </p>
          {t.tracked.length ? (
            <label className="flex min-h-[44px] items-center gap-2 font-semibold text-axal-ink dark:text-gray-200">
              <input type="checkbox" checked={onlyMatches} onChange={(e) => onOnlyMatches?.(e.target.checked)} className="h-4 w-4 accent-violet-600" /> Show only markets that match
            </label>
          ) : <p className="text-[12px] text-axal-muted dark:text-gray-400">None of your profile sectors maps to a tracked sector, so no market can match yet.</p>}
          <Link to={THESIS_EDIT} className={`${BTN} w-full`}>Edit thesis</Link>
        </div>
      )}
    </section>
  );
}
