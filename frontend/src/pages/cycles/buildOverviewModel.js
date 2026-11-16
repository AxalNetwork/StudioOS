// D6028 (#6028) — Build Overview V2's model (BD1 desktop, BD2 phone): what
// `BuildOverview.jsx` draws, from `GET /api/cycles/build/overview` as D6027
// sends it (`focus`, `figures[].module`, `attention`, `plan`, `cards`,
// `index`). Pure: it reads nothing and formats no money.
//
// Each part fails on its own. A part the read could not answer says so and
// offers its own retry; a value the venture has not recorded says Not
// recorded, never 0. A link the Worker sends is drawn only when it is a path
// on this site (`safeHref`).

import { figureValue, safeHref } from './cycleModel.js';
import { phoneFocus } from './validatePhone.js';
import { planHref } from './buildPlanModel.js';
import { projectSearch } from './founderToolNavigation.js';

/** The Worker's module labels (`services/buildAttention.ts` MODULE_LABEL), for a figure's source. */
export const MODULE_LABEL = {
  'solution-design': 'Solution design', 'prototype-mvp': 'Prototype / MVP', 'product-roadmap': 'Product roadmap',
  'founding-team': 'Founding team', 'company-creation': 'Company creation', 'operating-systems': 'Operating systems',
  plan: 'Build Plan',
};

/** BD1's state language for a Needs attention row (the canvas's `T` map, its words only). */
export const TONE_LABEL = {
  needs_attention: 'Needs attention', blocked: 'Blocked', not_recorded: 'Not recorded', processing: 'Processing', unreadable: 'Could not be read',
};

const list = (v) => (Array.isArray(v) ? v : []);
const UNREADABLE = 'Unreadable';
const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'];

/**
 * Read only. The overview read carries no write flag of its own, but its plan
 * preview does: `plan.state === 'restricted'` is D1065's read gate (the
 * venture's founders or an admin), the same people `canWrite` lets write. So
 * a restricted plan means a reader who cannot write; the attention rows then
 * carry no write action either (the Worker sends `action: null`).
 */
export function buildReadOnly(raw, readOnly = false) {
  return Boolean(readOnly || raw?.read_only === true || raw?.plan?.state === 'restricted');
}

/** `?add=1` opens a module's Add form: a write. A reader who cannot write gets the module page. */
const withoutAdd = (href) => {
  const [path, rest = ''] = String(href).split('?');
  const [query, hash] = rest.split('#');
  const params = new URLSearchParams(query);
  params.delete('add');
  const q = params.toString();
  return `${path}${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`;
};

/**
 * The read as both widths draw it. For a reader who cannot write, the focus's
 * button names the record, not a write: its `?add=1` is dropped and it reads
 * "Open". The phone root (`PhoneCycleRoot.jsx`) and the desktop Next card read
 * this one object, so one venture state gives one action on both.
 */
export function overviewForViewer(raw, readOnly) {
  if (!raw || !readOnly || !raw.focus?.cta?.href) return raw;
  return { ...raw, focus: { ...raw.focus, cta: { label: 'Open', href: withoutAdd(raw.focus.cta.href) } } };
}

/** The page's one dominant action: the Worker's focus (D6027), through the phone's own adapter. */
export function nextAction(raw, search = '') {
  return raw ? phoneFocus(raw, search, 'build') : null;
}

function figureText(fig) {
  if (fig?.key === 'days_to_mvp' && fig.state === 'ok' && typeof fig.value === 'number' && Number.isFinite(fig.value)) {
    const n = fig.value;
    return n < 0 ? `${-n} ${n === -1 ? 'day' : 'days'} past` : `${n} ${n === 1 ? 'day' : 'days'}`;
  }
  return figureValue(fig);
}

/**
 * BD1's status strip: each figure, its value, and the module it comes from
 * (`figures[].module`). A figure the venture has not recorded is
 * `not_recorded`; one whose source failed is `unreadable`. Neither has a value.
 */
export function statusStrip(raw, search = '') {
  return list(raw?.figures).map((f) => {
    const value = f?.state === 'unreadable' ? null : figureText(f);
    const module = typeof f?.module === 'string' ? f.module : null;
    return {
      key: String(f?.key ?? ''),
      label: String(f?.label ?? ''),
      value,
      state: f?.state === 'unreadable' ? 'unreadable' : value == null ? 'not_recorded' : 'ok',
      reason: f?.reason || null,
      source: module ? MODULE_LABEL[module] || null : null,
      href: module && MODULE_LABEL[module] ? `/build/${module}${projectSearch(search)}` : null,
    };
  });
}

/**
 * Needs attention (D6027 `attention`), material blockers only, in the Worker's
 * order. Each row has one link: the write that clears it for a writer, else
 * its record. A source that could not be read is its own row with a retry and
 * no link. `state` is the Worker's; a read with no `attention` at all is
 * `unreadable`, never "nothing needs attention".
 */
export function attentionView(raw, readOnly = false) {
  const a = raw?.attention;
  const known = a && typeof a === 'object' && ['ready', 'partial', 'unreadable'].includes(a.state);
  const items = (known ? list(a.items) : []).filter((i) => i && typeof i.title === 'string' && i.title.trim()).map((i) => {
    const unreadable = i.tone === 'unreadable';
    const action = !readOnly && i.action && safeHref(i.action.href) ? { label: String(i.action.label || 'Open'), href: safeHref(i.action.href) } : null;
    const record = safeHref(i.href);
    return {
      key: String(i.key || i.title),
      tone: TONE_LABEL[i.tone] ? i.tone : 'needs_attention',
      toneLabel: TONE_LABEL[i.tone] || TONE_LABEL.needs_attention,
      title: i.title,
      detail: i.detail || null,
      unreadable,
      link: unreadable ? null : action || (record ? { label: `Open ${MODULE_LABEL[i.module] || 'record'}`, href: record } : null),
    };
  });
  // Every source failed but each named itself: draw those rows, each with its own retry.
  const state = !known || (a.state === 'unreadable' && !items.length) ? 'unreadable' : a.state === 'unreadable' ? 'partial' : a.state;
  return { state, items, count: items.filter((i) => !i.unreadable).length };
}

/**
 * The Build Plan preview (D6027 `plan`): its counts and first three waiting
 * proposals. `not_recorded` (no plan prepared), `restricted` (not this
 * reader's) and `unreadable` say so and show no count.
 */
export function planPreview(raw, search = '') {
  const p = raw?.plan;
  const href = safeHref(p?.href) || planHref('plan', search);
  const state = ['ready', 'not_recorded', 'restricted', 'unreadable'].includes(p?.state) ? p.state : 'unreadable';
  if (state !== 'ready') return { state, line: null, items: [], href, paused: false };
  const counted = Number.isSafeInteger(p.accepted) && Number.isSafeInteger(p.waiting);
  if (!counted) return { state: 'unreadable', line: null, items: [], href, paused: false };
  const paused = p.status === 'paused';
  const line = `${paused ? 'Paused · ' : ''}${p.accepted} accepted · ${p.waiting} waiting for decision`;
  const items = list(p.items).filter((i) => i && typeof i.uid === 'string').map((i) => ({
    uid: i.uid,
    title: typeof i.title === 'string' && i.title.trim() ? i.title.trim() : null,
    meta: [i.kind ? `${String(i.kind).charAt(0).toUpperCase()}${String(i.kind).slice(1).replace(/_/g, ' ')}` : null, i.module_label || MODULE_LABEL[i.module] || null].filter(Boolean).join(' · '),
  }));
  return { state, line, items, href, paused };
}

/**
 * Compact module cards: one status sentence and one link each. The sentence
 * is the phone index's own (`index`, D692), which the overview already sends;
 * an empty or unrecorded module says its card's reason; a module whose read
 * failed says so alone and offers its own retry. The link is the card's next
 * step for a writer, else its module page.
 *
 * `cards` is the page's own list (CycleRoute's `data.cards`), which a card's
 * retry replaces; the index came with the first read, so a row it marks
 * Unreadable is set aside once the card itself reads again.
 */
export function moduleCards(raw, search = '', readOnly = false, cards = raw?.cards) {
  const index = list(raw?.index);
  const venture = projectSearch(search);
  return list(cards).filter((c) => c && typeof c.slug === 'string').map((c) => {
    const name = c.name || MODULE_LABEL[c.slug] || c.slug;
    const indexed = index.find((r) => r?.key === c.slug) || null;
    const row = indexed?.value === UNREADABLE && c.state !== 'unreadable' ? null : indexed;
    const page = { label: `Open ${name}`, href: `/build/${c.slug}${venture}` };
    const next = !readOnly && c.next?.text && safeHref(c.next.href) ? { label: c.next.text, href: safeHref(c.next.href) } : null;
    const base = { slug: c.slug, name };
    if (c.state === 'unreadable' || !CARD_STATES.includes(c.state)) {
      return { ...base, state: 'unreadable', sentence: `${name} could not be read.`, link: page, retry: true };
    }
    if (c.state === 'empty' || c.state === 'not_recorded' || c.state === 'too_little') {
      return { ...base, state: c.state === 'too_little' ? 'ok' : c.state, sentence: c.reason || (c.state === 'empty' ? 'Nothing recorded here yet.' : 'Not recorded.'), link: next || page, retry: false };
    }
    if (row && row.value == null) return { ...base, state: 'not_recorded', sentence: `${row.detail}: not recorded.`, link: next || page, retry: false };
    if (row && row.value) return { ...base, state: 'ok', sentence: `${row.detail} · ${row.value}`, link: next || page, retry: false };
    if (row && row.detail) return { ...base, state: 'ok', sentence: row.detail, link: next || page, retry: false };
    return { ...base, state: 'ok', sentence: c.caption || 'Open the module to see its records.', link: next || page, retry: false };
  });
}
