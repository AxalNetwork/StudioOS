/**
 * D1419 (#3698) — the Studio grid's pure rules, over the Worker's catalogue
 * and layout reads (`studioLayoutApi`, D1421, D1418, D1594). No React and no
 * request here, so every rule is tested without a browser.
 *
 * - A layout is an ordered list of `{ key, size }`, at most `STUDIO_MAX`.
 * - Edits are local: nothing saves per move. Done is the one save.
 * - A saved `[]` is the member's choice and stays empty; it never falls back
 *   to the default (SM8d). Only a FAILED read draws the default (SM8a).
 * - "Not recorded" is a state with its reason, never a 0.
 */
import { MODULES as CYCLE_MODULES } from '../cycles/modules.js';
import { lockedPlanName } from '../../lib/archetypeLock.js';

export const STUDIO_MAX = 12;
export const SIZES = ['1/3', '1/2', 'full'];
export const SIZE_NAME = { '1/3': 'One third', '1/2': 'Half', full: 'Full width' };
export const SIZE_SHORT = { '1/3': '1/3', '1/2': '1/2', full: 'Full' };
/** Column spans: 6 columns on desktop, 2 at tablet width, 1 on a phone (SM14, SM13). */
export const SPAN = {
  desktop: { '1/3': 2, '1/2': 3, full: 6 },
  tablet: { '1/3': 1, '1/2': 1, full: 2 },
  phone: { '1/3': 1, '1/2': 1, full: 1 },
};

/** The tile frame's states (SM7), plus Withheld for an administrator's preview (SM11). */
export const TILE = Object.freeze({
  LOADING: 'loading', UNREADABLE: 'unreadable', NOT_RECORDED: 'not_recorded', EMPTY: 'empty', READY: 'ready', WITHHELD: 'withheld',
});

/** The purpose line under each profile's "Studio" (`pageHead`). */
export const PURPOSE = {
  investor: 'Your deals, portfolio and events, arranged the way you work.',
  advisor: 'Your sessions, clients and earnings, arranged the way you work.',
  partner: 'Your firm’s engagements and feed, arranged the way you work.',
};

export const CAP_LINE = `Your Studio holds ${STUDIO_MAX} modules. Remove one to add another.`;

/**
 * The `profile` the layout routes are sent. A member's own role names their
 * Studio, so nothing is sent; an administrator previews one profile and must
 * name it, or every read is 400 `invalid_profile` (D1421 §3).
 */
export function layoutProfileFor(viewer, profile) {
  return viewer?.role === 'admin' ? profile : undefined;
}

// ---- edits (local until Done) ------------------------------------------------

const clean = (list) => (Array.isArray(list) ? list.filter((e) => e && typeof e.key === 'string') : []);

/** The list with the entry at `from` moved to `to`. Out-of-range moves change nothing. */
export function move(list, from, to) {
  const l = clean(list);
  if (from < 0 || from >= l.length || to < 0 || to >= l.length || from === to) return l;
  const next = l.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export const moveUp = (list, key) => { const i = clean(list).findIndex((e) => e.key === key); return move(list, i, i - 1); };
export const moveDown = (list, key) => { const i = clean(list).findIndex((e) => e.key === key); return move(list, i, i + 1); };

/** Whether one more module fits. */
export const canAdd = (list) => clean(list).length < STUDIO_MAX;

/** Appends a module at its default size (the lightbox: "Added modules go to the end"). At the cap, or placed already, nothing changes. */
export function add(list, mod) {
  const l = clean(list);
  if (!mod?.key || l.some((e) => e.key === mod.key) || !canAdd(l) || mod.locked_by_plan) return l;
  return [...l, { key: mod.key, size: SIZES.includes(mod.default_size) ? mod.default_size : '1/3' }];
}
export const remove = (list, key) => clean(list).filter((e) => e.key !== key);
export function resize(list, key, size) {
  if (!SIZES.includes(size)) return clean(list);
  return clean(list).map((e) => (e.key === key ? { key: e.key, size } : e));
}
/** The body `PUT /api/studio/layout` takes: exactly `{ key, size }` per entry. */
export const toSave = (list) => clean(list).map(({ key, size }) => ({ key, size }));
export const sameLayout = (a, b) => JSON.stringify(toSave(a)) === JSON.stringify(toSave(b));

// ---- the module map ------------------------------------------------------------

/** "Recommended for you": the profile's default modules not placed, never one the plan locks (D1418 `in_default`). */
export function recommended(modules, placed) {
  const on = new Set(clean(placed).map((e) => e.key));
  return (Array.isArray(modules) ? modules : []).filter((m) => m.in_default && !on.has(m.key) && !m.locked_by_plan);
}

/** Modules whose title or purpose holds the query, case folded. */
export function search(modules, q) {
  const needle = String(q || '').trim().toLowerCase();
  const all = Array.isArray(modules) ? modules : [];
  if (!needle) return all;
  return all.filter((m) => `${m.title} ${m.purpose || ''}`.toLowerCase().includes(needle));
}

/** The catalogue's groups in the Worker's order, each with its modules; a group left with none is not drawn. */
export function grouped(groups, modules) {
  const all = Array.isArray(modules) ? modules : [];
  return (Array.isArray(groups) ? groups : [])
    .map((g) => ({ key: g.key, label: g.label, modules: all.filter((m) => m.group === g.key) }))
    .filter((g) => g.modules.length);
}

/** A locked entry's line: "Included in <plan>", the plan named by the Worker. */
export function includedIn(plan) {
  const name = lockedPlanName(plan);
  return name ? `Included in ${name}` : 'Included in a paid plan';
}

// ---- notices (SM8) ---------------------------------------------------------------

/**
 * SM8b's lines from the read's `dropped` (D1594): each module named by its
 * title, never by its key. A title the Worker no longer knows is "A module".
 */
export function droppedLines(dropped) {
  return (Array.isArray(dropped) ? dropped : []).map((d) => {
    const who = typeof d?.title === 'string' && d.title.trim() ? d.title.trim() : 'A module';
    if (d?.reason === 'plan') return `${who} was removed from your layout because it is no longer available on your plan.`;
    return `${who} was removed from your layout because your Studio no longer offers it.`;
  });
}

/** What a failed layout read means: no Studio at all (SM12a), a stored row that cannot be parsed, or a read that failed (SM8a). */
export function readFailureOf(e) {
  const status = e?.status ?? null;
  const code = e?.code || e?.data?.code || null;
  if (status === 403 && code === 'no_studio_profile') return 'no_profile';
  if (status === 500 && code === 'layout_unreadable') return 'layout_unreadable';
  return 'failed';
}

/** What a failed save means, so edit mode keeps the edits and says why (SM5, SM8c, SM12b). */
export function saveFailureOf(e) {
  const status = e?.status ?? null;
  const code = e?.code || e?.data?.code || null;
  if (status === 409 && code === 'stale_layout') return { kind: 'stale' };
  if (status === 402 && code === 'module_locked') {
    const extra = e?.data?.extra || e?.data || {};
    return { kind: 'locked', key: extra.key || null, plan: extra.plan || null };
  }
  return { kind: 'failed' };
}

// ---- the founder's cycle modules ------------------------------------------------

/** `<cycle>_<slug with "-" as "_">`, as the Worker keys them (D1418 §3). */
export const cycleKey = (cycle, slug) => `${cycle}_${String(slug).replace(/-/g, '_')}`;

/** Every cycle module by its Studio key: `{ cycle, slug, name }`. */
export const CYCLE_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(CYCLE_MODULES).flatMap(([cycle, list]) => list.map((m) => [cycleKey(cycle, m.slug), { cycle, slug: m.slug, name: m.name }])),
));

/** The cycles with at least one placed tile: one overview read each. */
export function cyclesPlaced(list) {
  return [...new Set(clean(list).map((e) => CYCLE_KEYS[e.key]?.cycle).filter(Boolean))];
}

/**
 * A cycle tile's frame state from its cycle's overview read and its card
 * (the card's five states, `cycleCards.ts`). `too_little` is drawn by the
 * card body itself, so it is ready here.
 */
export function cycleTileState(read, slug) {
  if (read === undefined) return { state: TILE.LOADING };
  if (read && read.noProject) return { state: TILE.NOT_RECORDED, reason: 'No company record yet, so nothing is recorded for this module.' };
  if (!read || read.failed) return { state: TILE.UNREADABLE };
  const card = (Array.isArray(read.cards) ? read.cards : []).find((c) => c?.slug === slug) || null;
  if (!card) return { state: TILE.NOT_RECORDED, reason: 'This cycle’s overview has no card for this module.' };
  if (card.state === 'not_recorded') return { state: TILE.NOT_RECORDED, reason: card.reason || 'Not recorded for this venture yet.', card };
  if (card.state === 'unreadable') return { state: TILE.UNREADABLE, card };
  return { state: TILE.READY, card };
}

// ---- the edit bar's count -------------------------------------------------------

/** "[n] of 12 modules" in edit mode, "[n] of 12 placed" on the page. Counted placed modules only. */
export const placedLine = (list, editing = false) => `${clean(list).length} of ${STUDIO_MAX} ${editing ? 'modules' : 'placed'}`;
