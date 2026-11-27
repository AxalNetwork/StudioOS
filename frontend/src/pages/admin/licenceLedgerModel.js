/**
 * D4819 (#4819), Build part 1 — the HQ licence ledger's operating summary, as
 * pure functions over the three reads the page already makes: the ledger page
 * (`GET /api/admin/licences`), the summary (`/summary`) and each loaded
 * licence's open requests (`/:uid/requests`). Nothing here reads anything
 * else, so nothing here can claim a state those reads do not carry.
 *
 * THREE MEANINGS, NEVER ZERO (canvas board L19):
 *   - None          the read succeeded and there is genuinely nothing;
 *   - Not recorded  no authoritative value is on the record;
 *   - Unavailable   the read failed, so the value is unknown.
 * A fourth, Not instrumented, is a fact no ledger read carries at all (the
 * agreement's state, the branch's sync, the licence's invoices). It is said
 * as that, never as 0 and never as None.
 */
import { SIGNAL_WORD } from '../../lib/licenceLegalReadiness';
import { daysTo } from '../../lib/notices';
import { PRICING_SIGNALS } from './licences/pricingHqModel.js';

/** How near a renewal has to be before it needs HQ: the canvas's "renew in the next 90 days". */
export const RENEWAL_WINDOW_DAYS = 90;

/** The licence statuses the ledger reads, in its own order, with the words the counts line uses. */
export const LEDGER_STATUSES = Object.freeze([
  ['active', 'active'],
  ['suspended', 'suspended'],
  ['pending_activation', 'pending activation'],
  ['draft', 'draft'],
  ['terminated', 'terminated'],
]);
export const STATUS_KEYS = Object.freeze(LEDGER_STATUSES.map(([k]) => k));
export const statusFromParam = (param) => (STATUS_KEYS.includes(param) ? param : '');

/** The canvas's sections, in its order. Each opens on its first tab (`SECTION_TAB` below; part 3 draws them). */
export const LICENCE_SECTIONS = Object.freeze(['overview', 'terms', 'agreement', 'access', 'operations', 'history']);

/**
 * A ledger row's state for one cell: `{ state, label }`, where `state` is one
 * of `value | none | not_recorded | unavailable | not_instrumented | reading`.
 */
const cell = (state, label) => ({ state, label });

/** How far off a licence's renewal is, or null when it has no date or is not running. */
export function renewalDays(l) {
  if (!l?.renews_on || !['active', 'suspended'].includes(l.status)) return null;
  return daysTo(l.renews_on);
}

/** True when the licence renews within the window, or is already past its date. */
export function renewalApproaching(l) {
  const d = renewalDays(l);
  return d !== null && d <= RENEWAL_WINDOW_DAYS;
}

export function territoryCell(l) {
  const t = Array.isArray(l?.territories) ? l.territories : null;
  if (!t) return cell('unavailable', 'Unavailable');
  return t.length ? cell('value', t.join(' · ')) : cell('none', 'None');
}

export function renewalCell(l) {
  if (!l?.renews_on) return cell('not_recorded', 'Not recorded');
  const d = renewalDays(l);
  if (d !== null && d < 0) return cell('overdue', `${l.renews_on} · ${-d}d overdue`);
  if (d !== null && d <= RENEWAL_WINDOW_DAYS) return cell('due', `${l.renews_on} · in ${d}d`);
  return cell('value', l.renews_on);
}

/**
 * One licence's open requests, from what `/:uid/requests` answered:
 * `undefined` (not read yet), `{ ok: true, total }` or `{ ok: false }`.
 */
export function requestsCell(read) {
  if (!read) return cell('reading', 'Reading…');
  if (!read.ok) return cell('unavailable', 'Unavailable');
  if (!read.total) return cell('none', 'None');
  return cell('value', `${read.total} waiting`);
}

/** The columns the ledger read does not carry, and the section of the licence that does. */
export const NOT_ON_LEDGER = Object.freeze({
  agreement: { label: 'Agreement', section: 'agreement' },
  branch: { label: 'Branch', section: 'operations' },
  billing: { label: 'Billing', section: 'fee-invoices' },
});
export const notInstrumentedCell = () => cell('not_instrumented', 'Not instrumented');

/**
 * What one licence needs from HQ, as far as the reads tell: `{ items, complete }`.
 * `complete` is false when its requests could not be read, so a row with no
 * known item never reads as needing nothing.
 */
export function attentionOf(l, read, pricing) {
  const items = [];
  if (renewalApproaching(l)) items.push('renewal');
  if (read?.ok && read.total > 0) items.push('requests');
  // D5020 — the pricing signals fold into Attention (board L28: no new column).
  const mine = pricing?.byUid?.[l.uid]?.signals;
  if (mine) for (const [signal] of PRICING_SIGNALS) if (mine[signal] === true) items.push(signal);
  return { items, complete: Boolean(read?.ok) };
}

export function attentionCell(l, read, pricing) {
  const a = attentionOf(l, read, pricing);
  const n = a.items.length;
  const said = `${n} ${n === 1 ? 'item' : 'items'}`;
  if (!read) return n ? cell('value', said) : cell('reading', 'Reading…');
  if (!a.complete) return n ? cell('value', `${said} · requests Unavailable`) : cell('unavailable', 'Unavailable');
  return n ? cell('value', said) : cell('none', 'None');
}

/**
 * The Needs HQ items the reads can compute, each a filter of the table. The
 * ledger also names branch sync and overdue invoices as not instrumented.
 */
const LEGAL_NEEDS = Object.entries(SIGNAL_WORD).map(([signal, title]) => ({
  key: `legal_${signal}`,
  title,
  label: (n) => `${title} · ${n}`,
  matches: (licence) => licence.legal_signals?.includes(signal) === true,
  legal: true,
  group: 'legal',
}));

/**
 * D5020 (#5020) — the four pricing signals, from `/api/admin/licence-pricing/signals` joined by licence uid
 * (`pricingHqModel.js` `pricingSignalsRead`). A signal the read could not compute is Unavailable, never a "no".
 */
const PRICING_NEEDS = PRICING_SIGNALS.map(([signal, title]) => ({
  key: signal,
  title,
  label: (n) => `${title} · ${n}`,
  matches: (licence, read, pricing) => pricing?.byUid?.[licence.uid]?.signals?.[signal] === true,
  pricing: true,
  group: 'pricing',
}));

export const NEEDS = Object.freeze([
  {
    key: 'requests',
    title: 'Requests waiting',
    label: (n) => `${n} ${n === 1 ? 'request' : 'requests'} waiting`,
    matches: (l, read) => Boolean(read?.ok && read.total > 0),
    group: 'operations',
  },
  {
    key: 'renewal',
    title: 'Renewals approaching',
    label: (n) => `${n} ${n === 1 ? 'renewal' : 'renewals'} approaching`,
    matches: (l) => renewalApproaching(l),
    group: 'operations',
  },
  ...LEGAL_NEEDS,
  ...PRICING_NEEDS,
]);

/** The Needs HQ groups, in the canvas's order (L28). */
export const NEED_GROUPS = Object.freeze([['pricing', 'Pricing'], ['legal', 'Legal'], ['operations', 'Operations']]);
export const NEED_KEYS = Object.freeze(NEEDS.map((n) => n.key));
export const NOT_INSTRUMENTED = Object.freeze(['Branch out of sync', 'Overdue invoices']);

/** The `?needs=` value as the list of keys it names, in NEEDS order; anything unknown is dropped. */
export function needsFromParam(param) {
  const asked = String(param || '').split(',').map((s) => s.trim());
  return NEED_KEYS.filter((k) => asked.includes(k));
}
export const needsToParam = (keys) => (keys.length ? NEED_KEYS.filter((k) => keys.includes(k)).join(',') : null);

/**
 * The Needs HQ summary over the loaded rows: one entry per NEEDS item with its
 * `count`, or `state: 'unavailable'` when an input it needs could not be read.
 * Requests count only once every loaded row's read has answered; until then
 * the item is `reading`, never a partial count dressed as the whole.
 */
export function needsSummary(rows, reads, pricing) {
  const list = Array.isArray(rows) ? rows : [];
  return NEEDS.map((n) => {
    if (n.pricing) {
      const state = pricing?.state || 'reading';
      if (state === 'reading') return { key: n.key, state: 'reading', label: `${n.title} · Reading…` };
      if (state !== 'ok' || list.some((l) => pricing.byUid[l.uid]?.signals?.[n.key] === null)) {
        return { key: n.key, state: 'unavailable', label: `${n.title} · Unavailable` };
      }
    }
    if (n.key === 'requests') {
      if (list.some((l) => reads?.[l.uid] && !reads[l.uid].ok)) return { key: n.key, state: 'unavailable', label: `${n.title} · Unavailable` };
      if (list.some((l) => !reads?.[l.uid])) return { key: n.key, state: 'reading', label: `${n.title} · Reading…` };
    }
    if (n.legal && list.some((l) => !Array.isArray(l.legal_signals))) {
      return { key: n.key, state: 'unavailable', label: `${n.title} · Unavailable` };
    }
    const count = list.filter((l) => n.matches(l, reads?.[l.uid], pricing)).length;
    return count
      ? { key: n.key, state: 'value', count, label: n.label(count) }
      : { key: n.key, state: 'none', count: 0, label: `${n.title} · None` };
  });
}

/** The rows every chosen Needs HQ item matches (all of them, so two chips narrow). */
export function filterByNeeds(rows, reads, keys, pricing) {
  const list = Array.isArray(rows) ? rows : [];
  if (!keys?.length) return list;
  const chosen = NEEDS.filter((n) => keys.includes(n.key));
  return list.filter((l) => chosen.every((n) => n.matches(l, reads?.[l.uid], pricing)));
}

/* ------------------------------------------------------------------ *
 * D5919 (#5919): the Territory, Renewal window and Attention menus (L01, L02)
 * ------------------------------------------------------------------ */

/** A row with no country: the Territory menu's "None", as the Territory column says it. */
export const TERRITORY_NONE = 'none';

/** `?territory=`: a two-letter code, `none`, or '' for every territory. */
export function territoryFromParam(param) {
  const v = String(param || '').trim();
  if (v.toLowerCase() === TERRITORY_NONE) return TERRITORY_NONE;
  return /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : '';
}

/**
 * The Territory menu's countries: every code the loaded rows hold, sorted, plus
 * the chosen one if no loaded row holds it, so a link that names it reopens the
 * view it named rather than silently dropping the filter.
 */
export function territoryOptions(rows, chosen = '') {
  const codes = new Set();
  for (const l of Array.isArray(rows) ? rows : []) {
    if (Array.isArray(l?.territories)) for (const t of l.territories) if (t) codes.add(String(t).toUpperCase());
  }
  if (chosen && chosen !== TERRITORY_NONE) codes.add(chosen);
  return [...codes].sort();
}

/** The Renewal window menu, in its order. Overdue and the windows read only running licences, as Renewal does. */
export const RENEWAL_WINDOWS = Object.freeze([
  ['overdue', 'Overdue'],
  ['next_30', 'Next 30 days'],
  ['next_90', 'Next 90 days'],
  ['later', 'Later than 90 days'],
  ['not_recorded', 'Not recorded'],
]);
const RENEWAL_KEYS = RENEWAL_WINDOWS.map(([k]) => k);
export const renewalFromParam = (param) => (RENEWAL_KEYS.includes(param) ? param : '');

/**
 * The Attention menu. `clear` is a row whose reads all answered and that needs
 * nothing; a row whose requests could not be read (or are still being read)
 * and has no known item is `unknown`, never `clear`.
 */
export const ATTENTION_FILTERS = Object.freeze([
  ['needs', 'Needs HQ'],
  ['clear', 'Nothing needed'],
  ['unknown', 'Unknown'],
]);
const ATTENTION_KEYS = ATTENTION_FILTERS.map(([k]) => k);
export const attentionFromParam = (param) => (ATTENTION_KEYS.includes(param) ? param : '');

function territoryMatches(l, territory) {
  if (!territory) return true;
  if (!Array.isArray(l?.territories)) return false; // unreadable: neither a country nor None
  if (territory === TERRITORY_NONE) return l.territories.length === 0;
  return l.territories.some((t) => String(t).toUpperCase() === territory);
}

function renewalMatches(l, window) {
  if (!window) return true;
  if (window === 'not_recorded') return !l?.renews_on;
  const d = renewalDays(l);
  if (d === null) return false;
  if (window === 'overdue') return d < 0;
  if (window === 'next_30') return d >= 0 && d <= 30;
  if (window === 'next_90') return d >= 0 && d <= RENEWAL_WINDOW_DAYS;
  return d > RENEWAL_WINDOW_DAYS; // later
}

function attentionMatches(l, read, attention, pricing) {
  if (!attention) return true;
  // D5020: the pricing signals are Attention items, so the menu reads them as the cell does.
  const a = attentionOf(l, read, pricing);
  if (attention === 'needs') return a.items.length > 0;
  if (attention === 'clear') return a.complete && a.items.length === 0;
  return !a.complete && a.items.length === 0; // unknown
}

/** The menu keys a page has chosen, as `{ territory, renewal, attention }`, each '' when not chosen. */
export function menusFromParams(get) {
  return {
    territory: territoryFromParam(get('territory')),
    renewal: renewalFromParam(get('renewal')),
    attention: attentionFromParam(get('attention')),
  };
}

export const menusChosen = (m) => Boolean(m?.territory || m?.renewal || m?.attention);

/** The loaded rows every chosen menu matches (all of them, so two menus narrow), from the reads already made. */
export function filterByMenus(rows, reads, menus, pricing) {
  const list = Array.isArray(rows) ? rows : [];
  if (!menusChosen(menus)) return list;
  return list.filter((l) => territoryMatches(l, menus.territory)
    && renewalMatches(l, menus.renewal)
    && attentionMatches(l, reads?.[l.uid], menus.attention, pricing));
}

/**
 * The counts line from the summary's `counts`: "12 licences · 9 active ·
 * 1 suspended · 2 draft". Active, suspended and draft are always said (the
 * canvas's line); pending activation and terminated only when there are any.
 * Null when the counts are not a number, so the caller says Unavailable.
 */
export function countsLine(counts) {
  const total = Number(counts?.total);
  if (!counts || !Number.isFinite(total)) return null;
  const by = counts.by_status || {};
  const parts = LEDGER_STATUSES
    .filter(([k]) => ['active', 'suspended', 'draft'].includes(k) || Number(by[k]) > 0)
    .map(([k, word]) => `${Number(by[k]) || 0} ${word}`);
  return { total, head: `${total} ${total === 1 ? 'licence' : 'licences'}`, parts };
}

/**
 * True when the ledger holds no licence at all. Without a filter the page's own
 * total says so; with one, only the summary can (a filter that matches nothing
 * is not an empty ledger). Unknown counts are not zero.
 */
export function ledgerIsEmpty({ total, filtered, summaryTotal }) {
  if (!filtered) return total === 0;
  return summaryTotal === 0;
}

/**
 * Canvas section (or an existing tab key) → the tab the detail pane opens.
 * Part 3 draws the six sections; each opens on its first tab
 * (`licenceNavModel.js` `LICENCE_TABS`), and a tab's own key opens itself.
 */
const SECTION_TAB = Object.freeze({
  overview: 'overview',
  terms: 'terms',
  agreement: 'contract',
  access: 'admins',
  operations: 'deploy',
  history: 'history',
});

export function tabForSection(section, tabKeys) {
  const s = String(section || '').trim().toLowerCase();
  if (SECTION_TAB[s]) return SECTION_TAB[s];
  if (Array.isArray(tabKeys) && tabKeys.includes(s)) return s;
  return SECTION_TAB.overview;
}
