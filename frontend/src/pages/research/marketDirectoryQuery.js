/**
 * D7171 (#7171, canvas D7036, boards RMD-00 to RMD-14) — the Markets
 * directory's view, kept in the URL, and the rules the page draws by.
 *
 * EVERY VIEW IS A LINK (RMD-00 "URL"). `tab`, `q`, `country` (repeatable),
 * `fresh`, `src`, `sort`, `view`, `group`, `page`, `open` and `thesis` live in
 * the query string, so Back from a sector page, the browser's Back and a
 * shared link all give the same view. Defaults are left out, so the plain
 * `/research/markets` stays plain. Anything unreadable falls back to its
 * default here; the Worker refuses an unreadable filter rather than drop it.
 *
 * THE WORKER FILTERS AND PAGES (D7171). Country, freshness and source type are
 * applied to the whole directory on `GET /api/research/markets` with counts
 * per option, so the totals are right past 100 markets. This module only turns
 * the URL into that request; the page never re-filters or re-sorts the rows.
 *
 * THE THESIS CROSSWALK (owner answer Q1 A). Profile sectors (the eleven
 * options of `investor_signals.ts`) and tracked sectors (the market
 * intelligence sectors) are different lists. A market matches an investor's
 * thesis only when its tracked sector is one this published crosswalk names for
 * one of the profile's sectors. Keywords and geographies never make a match.
 */

export const DIRECTORY_TABS = [
  { key: 'directory', label: 'Market directory' },
  { key: 'listed', label: 'Listed companies' },
];

export const MARKET_SORTS = [
  { value: 'supplied_count:desc', label: 'Taxonomy count, highest first' },
  { value: 'supplied_count:asc', label: 'Taxonomy count, lowest first' },
  { value: 'name:asc', label: 'Name, A to Z' },
  { value: 'newest_source:desc', label: 'Newest source first' },
];

export const MARKET_VIEWS = [
  { key: 'table', label: 'Table' },
  { key: 'cards', label: 'Cards' },
  { key: 'analysis', label: 'Analysis' },
];

/** `?fresh=`, by the newest source of any kind (the Worker's FRESH_BANDS). */
export const FRESH_OPTIONS = [
  { value: '30', label: 'Last 30 days', chip: 'Newest source: last 30 days' },
  { value: '90', label: '31 to 90 days', chip: 'Newest source: 31 to 90 days' },
  { value: 'older', label: 'Older than 90 days (Stale)', chip: 'Newest source: older than 90 days' },
  { value: 'none', label: 'No source recorded', chip: 'No source recorded' },
];

/** `?src=` (the Worker's SOURCE_KINDS). */
export const SRC_OPTIONS = [
  { value: 'named', label: 'Evidence that names the market', chip: 'Source: names the market' },
  { value: 'sector', label: 'Sector-level only', chip: 'Source: sector-level only' },
  { value: 'none', label: 'No source recorded', chip: 'Source: none recorded' },
];

/** The rows one page of the directory shows (RMD-01: "the page shows 25"). */
export const PAGE_SIZE = 25;
/** Past this many days a newest source is Stale (the Worker's STALE_DAYS). */
export const STALE_DAYS = 90;

const FRESH = FRESH_OPTIONS.map((o) => o.value);
const SRC = SRC_OPTIONS.map((o) => o.value);
const VIEWS = MARKET_VIEWS.map((v) => v.key);

const one = (params, key) => String(params?.get?.(key) || '');
const slugish = (v) => (/^[a-z0-9][a-z0-9-]{0,119}$/.test(v) ? v : '');

/** The URL → the view. Every value is checked; anything else is its default. */
export function readMarketQuery(params) {
  const tab = one(params, 'tab') === 'listed' ? 'listed' : 'directory';
  const q = one(params, 'q').slice(0, 120);
  const rawSort = one(params, 'sort');
  const sort = MARKET_SORTS.some((s) => s.value === rawSort) ? rawSort : MARKET_SORTS[0].value;
  const view = VIEWS.includes(one(params, 'view')) ? one(params, 'view') : 'table';
  const country = [...new Set((params?.getAll?.('country') || [])
    .flatMap((v) => String(v).split(',')).map((v) => v.trim().toUpperCase()).filter((v) => /^[A-Z]{2}$/.test(v)))].slice(0, 20);
  const fresh = FRESH.includes(one(params, 'fresh')) ? one(params, 'fresh') : '';
  const src = SRC.includes(one(params, 'src')) ? one(params, 'src') : '';
  const page = Math.min(400, Math.max(1, Number.parseInt(one(params, 'page'), 10) || 1));
  // Owner answer Q2 A: a flat table by default; grouping is the toggle `group=1`.
  const grouped = one(params, 'group') === '1';
  const open = slugish(one(params, 'open'));
  const thesis = one(params, 'thesis') === '1';
  return { tab, q, sort, view, country, fresh, src, page, grouped, open, thesis };
}

/** The view → the params; defaults stay out of the URL. Other params are kept. */
export function writeMarketQuery(params, v) {
  const next = new URLSearchParams(params);
  const set = (key, value, isDefault) => { if (isDefault) next.delete(key); else next.set(key, String(value)); };
  set('tab', v.tab, !v.tab || v.tab === 'directory');
  set('q', v.q, !v.q);
  next.delete('country');
  for (const c of v.country || []) next.append('country', c);
  set('fresh', v.fresh, !v.fresh);
  set('src', v.src, !v.src);
  set('sort', v.sort, !v.sort || v.sort === MARKET_SORTS[0].value);
  set('view', v.view, !v.view || v.view === 'table');
  set('group', '1', !v.grouped);
  set('page', v.page, !v.page || v.page <= 1);
  set('open', v.open, !v.open);
  set('thesis', '1', !v.thesis);
  return next;
}

/**
 * A change to what the list holds starts it again at page 1 and closes the
 * open row; a change of view, page or row keeps the rest.
 */
export function patchMarketQuery(view, patch) {
  const narrows = ['q', 'country', 'fresh', 'src', 'sort', 'thesis'].some((k) => k in patch);
  return { ...view, ...(narrows ? { page: 1, open: '' } : {}), ...patch };
}

/** The view → `GET /api/research/markets` params. `sectors` are the thesis's tracked sectors when `thesis=1`. */
export function marketListParams(view, sectors = []) {
  const [sort, dir] = view.sort.split(':');
  return {
    q: view.q || undefined,
    sort, dir,
    country: view.country.length ? view.country.join(',') : undefined,
    fresh: view.fresh || undefined,
    src: view.src || undefined,
    sector: view.thesis && sectors.length ? sectors.join(',') : undefined,
    limit: PAGE_SIZE,
    offset: (view.page - 1) * PAGE_SIZE || undefined,
  };
}

/** Whether any filter narrows the list (search, country, freshness, source type or thesis). */
export const isFiltered = (v) => !!(v.q || v.country.length || v.fresh || v.src || v.thesis);

/** A country code → its English name, or the code where the runtime has none. */
export function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch { return code; }
}

/** The active filters as chips: `{ key, label, patch }`, `patch` removing that one. */
export function filterChips(v) {
  const chips = [];
  if (v.q) chips.push({ key: 'q', label: `Search: ${v.q}`, patch: { q: '' } });
  for (const c of v.country) chips.push({ key: `country:${c}`, label: `Country: ${countryName(c)}`, patch: { country: v.country.filter((x) => x !== c) } });
  if (v.fresh) chips.push({ key: 'fresh', label: FRESH_OPTIONS.find((o) => o.value === v.fresh).chip, patch: { fresh: '' } });
  if (v.src) chips.push({ key: 'src', label: SRC_OPTIONS.find((o) => o.value === v.src).chip, patch: { src: '' } });
  if (v.thesis) chips.push({ key: 'thesis', label: 'Matches your thesis sectors', patch: { thesis: false } });
  return chips;
}

/** The filters in a few words, for the sector page's Back link: “energy” · Germany · last 30 days. */
export function filterWords(v) {
  const words = [];
  if (v.q) words.push(`“${v.q}”`);
  if (v.country.length) words.push(v.country.map(countryName).join(', '));
  if (v.fresh) words.push(FRESH_OPTIONS.find((o) => o.value === v.fresh).label.toLowerCase());
  if (v.src) words.push(SRC_OPTIONS.find((o) => o.value === v.src).label.toLowerCase());
  if (v.thesis) words.push('thesis matches');
  if (v.view !== 'table') words.push(`${v.view} view`);
  return words.join(' · ');
}

/**
 * The sector page link from a market row (RMD-05): a mapped market opens its
 * tracked sector with the market named; an unmapped one opens its own market
 * page. Either carries the directory's query in `from`, row open, so Back
 * returns to the same view with focus on that row.
 */
export function sectorHref(market, view) {
  const from = writeMarketQuery(new URLSearchParams(), { ...view, open: market.slug }).toString();
  const target = market.mi_sector ? sectorSlug(market.mi_sector) : market.slug;
  const p = new URLSearchParams();
  if (market.mi_sector) p.set('market', market.slug);
  if (from) p.set('from', from);
  const s = p.toString();
  return `/research/markets/sector/${encodeURIComponent(target)}${s ? `?${s}` : ''}`;
}

/**
 * `from` → the Markets URL it names, rebuilt through `readMarketQuery`, so
 * the link can only ever be `/research/markets` with the directory's own
 * params: never another path or host.
 */
export function marketsBackHref(from) {
  const view = readMarketQuery(new URLSearchParams(String(from || '')));
  const s = writeMarketQuery(new URLSearchParams(), view).toString();
  return { href: `/research/markets${s ? `?${s}` : ''}`, words: filterWords(view) };
}

/** The slug the sector page is keyed by: the tracked sector's own name, slugged. */
export const sectorSlug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- The thesis (RMD-08) ---------------------------------------------------

/**
 * The published crosswalk, profile sector → tracked sectors (owner answer Q1 A).
 * A profile sector with no tracked sector here matches nothing; the page says so.
 */
export const THESIS_CROSSWALK = Object.freeze({
  'AI/ML': ['Enterprise AI', 'AI Infrastructure', 'Agentic B2B'],
  Climate: ['Climate Intelligence'],
  Energy: ['Climate Intelligence'],
  Fintech: ['Fintech / DeFi'],
  Crypto: ['Fintech / DeFi'],
  'Enterprise SaaS': ['Vertical SaaS', 'DevTools'],
  Bio: ['Bio-Automation'],
  Robotics: ['Autonomous Robotics'],
  Defense: [],
  Healthtech: [],
  Consumer: [],
});

/**
 * The investor profile read → the thesis the page draws:
 *   `{ kind: 'none' }` — no thesis text and no sector on the profile;
 *   `{ kind: 'set', text, sectors, stages, geos, anti, via, tracked }` — `via`
 *   is each profile sector with the tracked sectors it maps to, and `tracked`
 *   the set a market's tracked sector must be in to match.
 */
export function thesisFrom(profile) {
  const text = String(profile?.thesis_text || '').trim();
  const sectors = (profile?.sectors || []).filter((s) => typeof s === 'string');
  if (!text && !sectors.length) return { kind: 'none' };
  const via = sectors.map((s) => ({ sector: s, tracked: THESIS_CROSSWALK[s] || [] }));
  const tracked = [...new Set(via.flatMap((v) => v.tracked))];
  return {
    kind: 'set', text, sectors, via, tracked,
    stages: profile?.stages || [], geos: profile?.geos || [], anti: profile?.anti_thesis_sectors || [],
  };
}

/** A market against the thesis: 'match' (with the profile sectors it came through), 'no_match', or 'no_sector'. */
export function thesisMatch(market, thesis) {
  if (!market?.mi_sector) return { kind: 'no_sector' };
  const through = (thesis?.via || []).filter((v) => v.tracked.includes(market.mi_sector)).map((v) => v.sector);
  return through.length ? { kind: 'match', through } : { kind: 'no_match' };
}

/** Of the markets the summary counts, how many a thesis's tracked sectors claim. */
export function thesisMatchCount(summary, thesis) {
  if (!summary || !thesis?.tracked?.length) return 0;
  return (summary.by_sector || []).filter((s) => thesis.tracked.includes(s.sector)).reduce((n, s) => n + (Number(s.markets) || 0), 0);
}
