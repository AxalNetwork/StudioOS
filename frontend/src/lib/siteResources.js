import { useCallback, useEffect, useState } from 'react';
import { api, articles, eventsPublic, circlesPublic, jobsPublic } from './api';
import { reportError } from './log';

/**
 * The public Network section's live reads and figures (D679, #1553): the
 * Resources hub (`pages/site/ResourcesPage.jsx`), Articles and the Directory.
 *
 * Nothing here is content. Every list is a read the section's own pages
 * already make, and every figure is a count `GET /api/public/stats` returns.
 * A figure the endpoint does not return, or returns as zero, is not drawn.
 *
 * D6992 (#6992): a read that FAILS is not an empty list. Each live read is in
 * one of four states — `loading`, `loaded` (rows), `empty` (the read answered
 * with none) and `unavailable` (the read failed) — and a page draws the empty
 * sentence only for `empty`. `unavailable` draws "Unavailable. We could not
 * load this list." with Try again (`ui/Honesty.jsx`). Before #6992 the hook
 * caught a failure into `[]`, so a failed read said "No open roles right now."
 */

export const words = (s) => String(s || '').replace(/_/g, ' ');

/**
 * The canvas's `dirStats`, as D675 (#1549) names them on the stats endpoint.
 * The canvas's own values (412, 23, 86, 147) are examples and never ship.
 */
export const DIR_FIGURES = [
  { key: 'members_verified', label: 'Verified members' },
  { key: 'countries', label: 'Countries' },
  { key: 'lps_and_funds', label: 'LPs & funds' },
  { key: 'operators_and_advisors', label: 'Operators & advisors' },
];

/** A count the endpoint returned, as a positive integer, or null (as `LandingPage.figure`). */
export function figure(stats, key) {
  const n = Number(stats?.[key]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** The directory figures that have a real value, in the canvas's order. */
export function dirFigures(stats) {
  return DIR_FIGURES
    .map((f) => ({ ...f, value: figure(stats, f.key) }))
    .filter((f) => f.value != null);
}

/** The four states of a live read (D6992). */
export const READ_STATES = Object.freeze(['loading', 'loaded', 'empty', 'unavailable']);

const LOADING = Object.freeze({ state: 'loading', items: null });

/** A list's state once its read has answered: `loaded` with rows, `empty` with none. */
export function listState(list) {
  return Array.isArray(list) && list.length > 0 ? 'loaded' : 'empty';
}

/**
 * Any list value as a read: `{ state, items, retry? }`. A read passes through;
 * null or undefined is still loading; an array is its rows (`loaded` or
 * `empty`). Anything else is not a list the page can draw, so it is
 * `unavailable`, never an empty list.
 */
export function listRead(value) {
  if (value == null) return LOADING;
  if (Array.isArray(value)) return { state: listState(value), items: value };
  if (typeof value === 'object' && READ_STATES.includes(value.state)) return value;
  return { state: 'unavailable', items: null };
}

/**
 * The stats as a read: `{ state, stats, retry? }`, state `loading`, `loaded`
 * or `unavailable`. A bare stats object (what `useSiteStats` returns) is
 * `loaded`; null is still loading.
 */
export function statsRead(value) {
  if (value == null) return { state: 'loading', stats: null };
  if (typeof value === 'object' && READ_STATES.includes(value.state) && 'stats' in value) return value;
  return typeof value === 'object' ? { state: 'loaded', stats: value } : { state: 'unavailable', stats: null };
}

/**
 * The counts `/api/public/stats` returns, as a read (D6992): `loading`, then
 * `loaded` with the counts, or `unavailable` with `stats: null` when the read
 * fails, answers non-2xx or answers something that is not an object. A failure
 * is reported (`reportError`), not swallowed, and `retry` reads again. No
 * state carries a zero: a failed read has no figures, not figures of 0.
 */
export function useSiteStatsRead() {
  const [read, setRead] = useState({ state: 'loading', stats: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/public/stats', { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`public stats answered ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('public stats answered no object');
        setRead({ state: 'loaded', stats: data });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        reportError('site-resources:stats', e);
        setRead({ state: 'unavailable', stats: null });
      });
    return () => ctrl.abort();
  }, [attempt]);
  const retry = useCallback(() => {
    setRead({ state: 'loading', stats: null });
    setAttempt((a) => a + 1);
  }, []);
  return { ...read, retry };
}

/**
 * The counts alone, or null while loading or when the read failed — the shape
 * `PublicDirectoryPage` reads. Null draws no figure there (`dirFigures(null)`
 * is `[]`), so a failure never prints a 0; the failure itself is reported by
 * `useSiteStatsRead`.
 */
export function useSiteStats() {
  return useSiteStatsRead().stats;
}

/**
 * A live list as a read (D6992): `{ state, items, retry }`. `loading` first,
 * then `loaded` with its rows, `empty` when the read answered none, or
 * `unavailable` (items null) when it failed or answered something that is not
 * a list. A failure is reported, and `retry` reads again.
 */
export function useLiveList(load) {
  const [read, setRead] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(load)
      .then((list) => {
        if (!Array.isArray(list)) throw new Error('the read answered no list');
        if (alive) setRead({ state: listState(list), items: list });
      })
      .catch((e) => {
        if (!alive) return;
        reportError('site-resources:list', e);
        setRead({ state: 'unavailable', items: null });
      });
    return () => { alive = false; };
  }, [load, attempt]);
  const retry = useCallback(() => {
    setRead(LOADING);
    setAttempt((a) => a + 1);
  }, []);
  return { ...read, retry };
}

/** How many rows each hub block shows (the canvas's `hub` slices). */
export const HUB_LIMITS = { members: 5, events: 4, articles: 3, circles: 3, jobs: 4 };

const rows = (r, key) => (Array.isArray(r?.[key]) ? r[key] : []);

/**
 * The hub's five reads. Each is the read its section's page makes:
 * the Directory's `publicListPartners`, Events' `eventsPublic.list`, Articles'
 * `articles.list`, Circles' `circlesPublic.list` and Jobs' `jobsPublic.list`.
 */
export const HUB_LOADERS = {
  members: () => api.publicListPartners({}).then((r) => rows(r, 'partners').slice(0, HUB_LIMITS.members)),
  events: () => eventsPublic.list({ limit: HUB_LIMITS.events }).then((r) => rows(r, 'events').slice(0, HUB_LIMITS.events)),
  articles: () => articles.list({ limit: HUB_LIMITS.articles }).then((r) => rows(r, 'items').slice(0, HUB_LIMITS.articles)),
  circles: () => circlesPublic.list().then((r) => rows(r, 'circles').slice(0, HUB_LIMITS.circles)),
  jobs: () => jobsPublic.list({ limit: HUB_LIMITS.jobs }).then((r) => rows(r, 'jobs').slice(0, HUB_LIMITS.jobs)),
  /** The article taxonomy, to name each article's sector as Articles does. */
  sectors: () => articles.sectors().then((r) => rows(r, 'sectors')),
};

/**
 * The directory's entity types. `GET /api/public/partners` lists operating
 * (service) partners and carries no `type` field, so every row it returns is
 * a partner; a row that one day carries its own `type` is filed under it. The
 * canvas's Partners, LPs and Founders filters have no live type and are not
 * drawn.
 */
const DIRECTORY_TYPE_LABELS = {
  partners: { one: 'Operating partner', many: 'Operating partners' },
};

export const directoryTypeOf = (row) => (row && typeof row.type === 'string' && row.type) || 'partners';

export function directoryTypeLabel(key, plural = false) {
  const known = DIRECTORY_TYPE_LABELS[key];
  if (known) return plural ? known.many : known.one;
  return words(key).replace(/^\w/, (c) => c.toUpperCase());
}

/** The filter pills: All, then each type the loaded rows actually carry. */
export function directoryTypeOptions(list) {
  const seen = [];
  for (const r of list || []) {
    const t = directoryTypeOf(r);
    if (!seen.includes(t)) seen.push(t);
  }
  return [{ value: '', label: 'All' }, ...seen.map((t) => ({ value: t, label: directoryTypeLabel(t, true) }))];
}

/** A directory row's second line, from the fields the public read exposes. */
export function directoryRole(p) {
  const cats = (p?.categories || []).slice(0, 3).map(words);
  return [p?.company, p?.headline, ...cats].filter(Boolean).join(' · ');
}

/** The article filter pills: All, then the live sector taxonomy. */
export function articleFilterOptions(sectors) {
  const list = Array.isArray(sectors) ? sectors.filter((s) => s && s.key) : [];
  return [{ value: '', label: 'All' }, ...list.map((s) => ({ value: s.key, label: s.label || words(s.key) }))];
}

/** An article's category: its sector's label in the live taxonomy, or the key in words. */
export function sectorLabel(sectors, key) {
  if (!key) return null;
  const hit = Array.isArray(sectors) ? sectors.find((s) => s && s.key === key) : null;
  return (hit && hit.label) || words(key);
}

/** Up to two initials from a name, for an avatar. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

const TINTS = ['#6d28d9', '#0f766e', '#b45309', '#334155', '#be185d', '#15803d', '#141118'];

/** A stable avatar colour for a key, from the canvas's avatar palette. */
export function tintFor(key) {
  const s = String(key ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** A date's day, month, time and long form in its own zone, or null when it does not parse. */
export function dateParts(iso, timeZone) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const fmt = (opts) => {
    try { return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'UTC' }).format(d); } catch {
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  };
  return {
    day: fmt({ day: '2-digit' }),
    mon: fmt({ month: 'short' }),
    time: fmt({ hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
    long: fmt({ month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

/** "Jul 28, 2026 · 9 min", from the fields an article row carries. */
export function articleMeta(a) {
  const when = dateParts(a?.published_at, 'UTC');
  return [when?.long, a?.read_minutes ? `${a.read_minutes} min` : null].filter(Boolean).join(' · ');
}
