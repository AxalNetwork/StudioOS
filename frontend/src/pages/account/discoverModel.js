/**
 * D753 F6 (#1877) — Discover's filter menu and grid, as pure functions over
 * what `useConnectors()` already reads (the `/available` catalogue, the
 * active company's suggestions, and `category_order` when the Worker serves
 * it). Nothing here reads, and nothing here takes a company.
 *
 * THE ONE RULE. `filterCatalogue` is the only place a choice becomes a list.
 * `discoverFacets` counts each row by calling it, and `discoverGrid` draws
 * each section from it, so a count can never differ from the cards drawn.
 * Every count is taken after the member's search (`matchesQuery`).
 *
 * Claude's Topic, Department, Industry and Everyday life rows, and its
 * Trending, Community, Custom, In-chat UI and Desktop extensions types,
 * describe data Axal VC does not hold, so none is drawn. Cycle and Sign-in
 * come from registry facts instead, and the Type rows count real states.
 */
import { CATEGORY_ORDER, SUGGESTED, authKind, cardAction, isEntityRow, matchesQuery } from './connectorsModel.js';
import { verifiedDay } from '../../ui/VerifiedBadge.jsx';

export const TOP_COUNT = 8;
export const NO_CATEGORY = 'No category recorded';
export const CYCLES = [['validate', 'Validate'], ['build', 'Build'], ['raise', 'Raise'], ['grow', 'Grow'], ['network', 'Network']];
export const SIGN_IN_LABEL = {
  oauth: 'Sign in at the service',
  oauth_or_key: 'Sign-in or a personal token',
  key: 'API key or token',
  first_party: 'Google, Microsoft or LinkedIn sign-in',
  entity: 'Connected by a Super Admin',
  mcp: 'Sign in through the service’s MCP server',
};
export const TYPES = [
  ['all', 'All'], ['suggested', SUGGESTED], ['connected', 'Connected'], ['available', 'Available now'], ['read_only', 'Read-only'],
  ['new', 'New'], ['verified', 'Verified'], ['live', 'Live'], ['beta', 'Beta'], ['coming_soon', 'Coming soon'], ['needs_plan', 'Needs a plan'],
];
/** where: 'all' | 'category:<name>' | 'cycle:<key>' | 'sign_in:<kind>'; type: a TYPES id. */
export const NO_FILTER = Object.freeze({ where: 'all', type: 'all' });

export const CONNECTIONS_UNREAD = 'Your connections could not be read.';
const DAY_MS = 86_400_000;
const NEW_DAYS = 90;
const CYCLE_KEYS = new Set(CYCLES.map(([k]) => k));
const TYPE_LABEL = Object.fromEntries(TYPES);
const CYCLE_LABEL = Object.fromEntries(CYCLES);

/** D753 decision 7: verified means a live connect on production passed, on a recorded day. */
export function isVerified(p) {
  return p?.verified === true && verifiedDay(p?.verified_on) !== null;
}

/** Added on or less than 90 days before `now`, counting the `YYYY-MM` month from its first day (UTC). */
export function isNew(p, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(p?.added ?? ''));
  if (!m) return false;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  const start = Date.UTC(Number(m[1]), month - 1, 1);
  const age = Number(now) - start;
  return age >= 0 && age <= NEW_DAYS * DAY_MS;
}

/** Read-only by the connector's own field, or by #1875's trust block; nothing else. */
export function isReadOnly(p) {
  return p?.read_only === true || p?.trust?.read_only === true;
}

/** The cycles a connector feeds: the first path segment of each `feed_modules[].href`, no repeats, in CYCLES order. */
export function cyclesOf(p) {
  const found = new Set();
  for (const fm of p?.feed_modules || []) {
    if (!fm || typeof fm !== 'object' || typeof fm.href !== 'string') continue;
    const seg = fm.href.split(/[/?#]/).filter(Boolean)[0];
    if (CYCLE_KEYS.has(seg)) found.add(seg);
  }
  return CYCLES.map(([k]) => k).filter((k) => found.has(k));
}

/** How a connector connects (#1875 decision 12): `sign_in.kind` when served, else derived from what the page knows. */
export function signInKind(p) {
  if (typeof p?.sign_in?.kind === 'string' && p.sign_in.kind) return p.sign_in.kind;
  if (isEntityRow(p)) return 'entity';
  const kind = authKind(p);
  if (kind === 'first_party' || kind === 'key') return kind;
  if (kind === 'token_first') return 'oauth_or_key';
  if (p?.supports_pat) return 'oauth_or_key';
  return 'oauth';
}

/** "by <maker>" when the Worker names who made it; '' otherwise, so no card says "by <the provider>". */
export function makerLine(p) {
  const m = p?.made_by;
  const name = typeof m === 'string' ? m : m?.name;
  return typeof name === 'string' && name.trim() ? `by ${name.trim()}` : '';
}

const categoryName = (p) => p?.category || NO_CATEGORY;

function inWhere(p, where) {
  if (!where || where === 'all') return true;
  const [group, ...rest] = String(where).split(':');
  const id = rest.join(':');
  if (group === 'category') return categoryName(p) === id;
  if (group === 'cycle') return cyclesOf(p).includes(id);
  if (group === 'sign_in') return signInKind(p) === id;
  return false;
}

function inType(p, type, now) {
  switch (type) {
    case 'all': return true;
    case 'connected': return !!p.connection;
    case 'available': return cardAction(p) === 'add' && !p.locked;
    case 'read_only': return isReadOnly(p);
    case 'new': return isNew(p, now);
    case 'verified': return isVerified(p);
    case 'live': case 'beta': case 'coming_soon': return p.status === type;
    case 'needs_plan': return !!p.locked;
    default: return false;
  }
}

/**
 * The grid's list for one choice. "Suggested for you" keeps the suggestions'
 * order, names each connector once and carries its `why`; it is empty when
 * the suggestions could not be read (the facets then say the count is unknown).
 */
export function filterCatalogue(catalogue, { q = '', where = 'all', type = 'all', suggestions = null, now = Date.now() } = {}) {
  const list = (catalogue || []).filter((p) => matchesQuery(p, q) && inWhere(p, where));
  if (type === 'suggested') {
    if (!Array.isArray(suggestions)) return [];
    const keyed = new Map(list.map((p) => [p.key, p]));
    const seen = new Set();
    const out = [];
    for (const s of suggestions) {
      const key = s?.provider_key || s?.key;
      const p = keyed.get(key);
      if (!p || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...p, why: s.reason || '' });
    }
    return out;
  }
  return list.filter((p) => inType(p, type, now));
}

/** The category rows' order: the Worker's when served, else CATEGORY_ORDER; any other category A–Z after; "No category recorded" last. */
function categoriesIn(catalogue, categoryOrder) {
  const order = Array.isArray(categoryOrder) ? categoryOrder.filter((c) => typeof c === 'string' && c) : CATEGORY_ORDER;
  const present = new Set((catalogue || []).map((p) => p?.category).filter(Boolean));
  const known = order.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !order.includes(c)).sort((a, b) => a.localeCompare(b));
  const none = (catalogue || []).some((p) => !p?.category) ? [NO_CATEGORY] : [];
  return [...new Set([...known, ...extra]), ...none];
}

/**
 * The menu's rows, each `{ id, label, count, reason, active }`, with the
 * hidden rows (count 0, not "All", not the active choice) removed. `count`
 * is null when it cannot be known: the suggestions read failed, or the
 * connections read failed. Unknown is never 0 and never hidden.
 */
export function discoverFacets(catalogue, suggestions, {
  q = '', where = 'all', type = 'all', categoryOrder = null, connectionsRead = true, suggestionsNote = '', now = Date.now(),
} = {}) {
  const suggestionsUnknown = !Array.isArray(suggestions);
  const suggestedReason = suggestionsNote || 'Suggestions could not be read.';
  const unknownFor = (t) => {
    if (t === 'suggested' && suggestionsUnknown) return suggestedReason;
    if (t === 'connected' && !connectionsRead) return CONNECTIONS_UNREAD;
    return '';
  };
  const count = (w, t) => {
    const reason = unknownFor(t);
    if (reason) return { count: null, reason };
    return { count: filterCatalogue(catalogue, { q, where: w, type: t, suggestions, now }).length, reason: '' };
  };
  const keep = (row, always = false) => always || row.active || row.count === null || row.count > 0;
  const whereRow = (id, label) => ({ id, label, ...count(id, type), active: where === id });

  const all = whereRow('all', 'All categories');
  const categories = categoriesIn(catalogue, categoryOrder).map((c) => whereRow(`category:${c}`, c)).filter((r) => keep(r));
  const cycles = CYCLES.map(([k, label]) => whereRow(`cycle:${k}`, label)).filter((r) => keep(r));
  const signIn = Object.entries(SIGN_IN_LABEL).map(([k, label]) => whereRow(`sign_in:${k}`, label)).filter((r) => keep(r));
  const types = TYPES.map(([id, label]) => ({ id, label, ...count(where, id), active: type === id })).filter((r) => keep(r, r.id === 'all'));
  return { all, categories, cycles, signIn, types };
}

/** A choice's words: "CRM", "Connected", or "CRM · Connected". */
export function choiceTitle({ where = 'all', type = 'all' } = {}) {
  const parts = [];
  if (where && where !== 'all') {
    const [group, ...rest] = String(where).split(':');
    const id = rest.join(':');
    parts.push(group === 'cycle' ? (CYCLE_LABEL[id] || id) : group === 'sign_in' ? (SIGN_IN_LABEL[id] || id) : id);
  }
  if (type && type !== 'all') parts.push(TYPE_LABEL[type] || type);
  return parts.join(' · ');
}

/**
 * Discover's sections (D753 decision 8), each `{ id, title, cards, count }`.
 * With no choice: Suggested for you (desktop only, when it has a card), Top
 * connectors (every card that is not coming soon, in the Worker's order) and
 * Coming soon. With a choice: one section, titled by it. The Community card
 * is the view's, drawn only with no choice. Suggested's `cards` is null when
 * its read failed.
 */
export function discoverGrid(catalogue, { q = '', where = 'all', type = 'all', suggestions = null, now = Date.now(), phone = false } = {}) {
  const pick = (w, t) => filterCatalogue(catalogue, { q, where: w, type: t, suggestions, now });
  if (where === 'all' && type === 'all') {
    const out = [];
    if (!phone && Array.isArray(suggestions)) {
      const cards = pick('all', 'suggested');
      if (cards.length) out.push({ id: 'suggested', title: SUGGESTED, cards, count: cards.length });
    }
    const list = pick('all', 'all');
    const top = list.filter((p) => p.status !== 'coming_soon');
    const soon = list.filter((p) => p.status === 'coming_soon');
    out.push({ id: 'top', title: 'Top connectors', cards: top, count: top.length });
    if (soon.length) out.push({ id: 'coming_soon', title: 'Coming soon', cards: soon, count: soon.length });
    return out;
  }
  const title = choiceTitle({ where, type });
  if (type === 'suggested' && !Array.isArray(suggestions)) return [{ id: 'choice', title, cards: null, count: null }];
  const cards = pick(where, type);
  return [{ id: 'choice', title, cards, count: cards.length }];
}

/** The first `n` cards, and how many more "Show all" would add. */
export function topSlice(list, n = TOP_COUNT) {
  const cards = Array.isArray(list) ? list : [];
  return { cards: cards.slice(0, n), more: Math.max(0, cards.length - n) };
}

/** The chips under the toolbar: one per active choice, `{ group, id, label }`. */
export function activeFilters(sel = NO_FILTER, facets = null) {
  const rows = facets ? [facets.all, ...facets.categories, ...facets.cycles, ...facets.signIn] : [];
  const out = [];
  if (sel.where && sel.where !== 'all') {
    const row = rows.find((r) => r?.id === sel.where);
    out.push({ group: 'where', id: sel.where, label: row?.label || choiceTitle({ where: sel.where }) });
  }
  if (sel.type && sel.type !== 'all') out.push({ group: 'type', id: sel.type, label: TYPE_LABEL[sel.type] || sel.type });
  return out;
}

/**
 * The filter menu's keyboard, as a pure step. `state` is
 * `{ open, index, sub, subIndex }`: the focused row of the menu, and of the
 * open submenu (`sub` is its id, or null). `parents` maps a menu row's index
 * to the submenu it opens; `checked` is where opening lands.
 * The result is the next state plus what the component does with it:
 * `choose` (pick the focused row), `returnFocus` (focus the trigger) and
 * `prevent` (mark the Escape handled, so the shared Escape stack does not
 * also close the menu).
 */
export function menuKey(state, key, { size, subSize = 0, parents = {}, checked = 0 } = {}) {
  const s = { open: false, index: 0, sub: null, subIndex: 0, ...state };
  const out = (next, extra = {}) => ({ ...s, ...next, choose: false, returnFocus: false, prevent: false, ...extra });
  const wrap = (i, n) => (n > 0 ? (i + n) % n : 0);
  if (!s.open) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown') return out({ open: true, index: checked, sub: null, subIndex: 0 }, { prevent: true });
    if (key === 'ArrowUp') return out({ open: true, index: Math.max(0, size - 1), sub: null, subIndex: 0 }, { prevent: true });
    return out({});
  }
  if (key === 'Tab') return out({ open: false, sub: null });
  if (s.sub) {
    if (key === 'ArrowDown') return out({ subIndex: wrap(s.subIndex + 1, subSize) }, { prevent: true });
    if (key === 'ArrowUp') return out({ subIndex: wrap(s.subIndex - 1, subSize) }, { prevent: true });
    if (key === 'Home') return out({ subIndex: 0 }, { prevent: true });
    if (key === 'End') return out({ subIndex: Math.max(0, subSize - 1) }, { prevent: true });
    if (key === 'Enter' || key === ' ') return out({}, { choose: true, prevent: true });
    if (key === 'ArrowLeft' || key === 'Escape') return out({ sub: null, subIndex: 0 }, { prevent: true });
    return out({});
  }
  if (key === 'ArrowDown') return out({ index: wrap(s.index + 1, size) }, { prevent: true });
  if (key === 'ArrowUp') return out({ index: wrap(s.index - 1, size) }, { prevent: true });
  if (key === 'Home') return out({ index: 0 }, { prevent: true });
  if (key === 'End') return out({ index: Math.max(0, size - 1) }, { prevent: true });
  const parent = parents[s.index];
  if (key === 'ArrowRight') return parent ? out({ sub: parent, subIndex: 0 }, { prevent: true }) : out({});
  if (key === 'Enter' || key === ' ') return parent ? out({ sub: parent, subIndex: 0 }, { prevent: true }) : out({}, { choose: true, prevent: true });
  if (key === 'Escape') return out({ open: false, sub: null }, { returnFocus: true, prevent: true });
  return out({});
}
