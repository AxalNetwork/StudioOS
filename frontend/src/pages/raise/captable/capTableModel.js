/**
 * D1015 (#2432) — the Cap table tool's addresses, words and derivations, kept
 * pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/cap-table` is CycleRoute's module page, and
 * every `/raise/cap-table/<word>` is its record route (`/raise/:slug/:id`,
 * `cyclePaths.js` RECORD_ID). A row of the table is a record whose id is
 * `h-<n>`, `e-<n>` or `pool` (D691 decision 4), so the tool's tabs are words
 * CycleRoute reads as tabs, never records (`isCapTableTab`), as D906 did for
 * the Investor narrative. No route is added: the module page is Overview,
 * `/raise/cap-table/h-12` is still a holder and `/new` is still Add holder.
 *
 * WHAT IS READ, AND FROM WHERE. Every figure comes from a read on `main`:
 *   - `GET /api/cycles/raise/modules/cap-table` → Overview (the Planned round
 *     card, the Holders records, From Mercury), as CycleRoute draws it today;
 *   - `GET /api/safe-issuances/project/:id` → the SAFEs sent through StudioOS,
 *     each with its envelope's status (D578);
 *   - `GET /api/captable/scenarios/by-project/:id/compare` → the saved model
 *     and its draft variants, each with its computed result;
 *   - `GET /api/captable/409a/:projectId` → the 409A in force and the
 *     safe-harbour status, in the Worker's words.
 *
 * ON RECORD AND MODELLED. The canvas never lets the two share a number without
 * a tag. Today nothing records what was issued: the Holders list and the
 * Planned round card are the saved model, so every figure they draw is
 * Modelled. Only a countersigned SAFE is on record. The record is D1017's (part 2).
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. History, Access and Import and
 * export have no read and no tab (D953's rule); the holder and instrument
 * drawers, the dialogs and the proposals wait for their parts (D1015 §6).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const SLUG = 'cap-table';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Cap table';
/** The canvas's line, with the company left out: the header names the venture. */
export const LINE = 'Who owns the company, what was issued, and what the next round does to it.';
/** The old page that still holds the simulator, until the Scenarios part retires it. */
export const SIMULATOR_PATH = '/raise/capital/cap-table';
export const VARIANTS_PATH = '/raise/cap-table/variants';

export const MODELLED = 'Modelled';
export const ON_RECORD = 'On record';
/** Overview's line under the tabs: the Holders list is the model, not a record. */
export const HOME_NOTE = 'Every figure on this page comes from your saved model, not from a record of what was issued. A record of issued shares is not kept yet.';

/**
 * The canvas's seven tabs, less History, Access and Import and export, which
 * have no read yet. `path` is the tab's segment under HOME_PATH.
 */
export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'instruments', label: 'Instruments', path: '/instruments' },
  { id: 'option-pool', label: 'Option pool', path: '/option-pool' },
  { id: 'scenarios', label: 'Scenarios', path: '/scenarios' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a row. */
export const isCapTableTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "$500,000" from whole dollars (the model's unit). Missing is "Not recorded", never $0. */
export function dollars(v) {
  const n = num(v);
  if (n == null) return NOT_RECORDED;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 })}`;
}

/** An amount in the currency's smallest unit (SAFE issuances), in its own currency. */
export function money(cents, currency = 'USD') {
  const n = num(cents);
  if (n == null) return NOT_RECORDED;
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD';
  try {
    return (n / 100).toLocaleString('en-US', { style: 'currency', currency: code, maximumFractionDigits: n % 100 ? 2 : 0 });
  } catch {
    return `${(n / 100).toLocaleString('en-US')} ${code}`;
  }
}

/** "61.54%" to two places; missing is "Not recorded". */
export function pct(v) {
  const n = num(v);
  return n == null ? NOT_RECORDED : `${n.toFixed(2)}%`;
}

export const shares = (v) => (num(v) == null ? NOT_RECORDED : Math.round(v).toLocaleString('en-US'));

/** "24 Oct 2026" from an ISO date or stamp; anything else is "Not recorded". */
export function day(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return NOT_RECORDED;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}`;
}

/** The SAFEs sent through StudioOS (D578), each on record only once countersigned. */
export function issuedSafes(read) {
  const list = Array.isArray(read?.safes) ? read.safes : [];
  return list.map((s) => ({
    uid: s.uid,
    holder: String(s.investor_name || '').trim() || NOT_RECORDED,
    amount: money(s.amount_cents, s.currency),
    cap: money(s.valuation_cap_cents, s.currency),
    // The Worker stores no discount for these SAFEs (D578): never 0%.
    discount: s.discount == null ? NOT_RECORDED : `${s.discount}%`,
    basis: s.form === 'post_money_cap' ? 'Post-money' : NOT_RECORDED,
    status: s.status?.label || NOT_RECORDED,
    onRecord: s.status?.key === 'countersigned',
    created: day(s.created_at),
  }));
}

/** The engine stores a discount and a rate as fractions (0.15 is 15%). */
export const fraction = (v) => `${Math.round(v * 10000) / 100}%`;

/** The model's basis words. A missing basis is how the engine reads pre-money. */
export function basisWord(entry) {
  if (entry?.basis === 'post_money') return 'Post-money';
  if (entry?.basis === 'pre_money') return 'Pre-money';
  return 'Pre-money (not stated)';
}

/**
 * The SAFEs and notes in the saved model (Modelled). A pre-money or unstated
 * basis carries CT3's note, since Axal's own SAFE and Mercury's are post-money.
 */
export function modelInstruments(scenario) {
  const list = Array.isArray(scenario?.inputs?.safes) ? scenario.inputs.safes : [];
  return list.map((s, i) => {
    const note = s?.instrument === 'note';
    return {
      key: `${i}`,
      holder: String(s?.name || '').trim() || NOT_RECORDED,
      type: note ? 'Convertible note' : 'SAFE',
      amount: dollars(s?.amount),
      cap: num(s?.cap) && s.cap > 0 ? dollars(s.cap) : NOT_RECORDED,
      discount: num(s?.discount) && s.discount > 0 ? fraction(s.discount) : NOT_RECORDED,
      basis: basisWord(s),
      interest: note ? (num(s?.interest_rate) > 0 ? fraction(s.interest_rate) : NOT_RECORDED) : null,
      signed: day(s?.issue_date),
      check: s?.basis !== 'post_money',
      cannotConvert: !(num(s?.cap) > 0) && !(num(s?.discount) > 0),
    };
  });
}

export const BASIS_CHECK = 'Basis: pre-money, as entered. Axal’s SAFE template is post-money.';
export const CANNOT_CONVERT = 'Cannot convert: no cap and no discount recorded.';

/** How the model's instruments convert in its first round, in the engine's own words. */
export function conversionLines(scenario) {
  const round = scenario?.result?.rounds?.[0];
  if (!round) return null;
  return { round: String(round.name || 'the round'), lines: Array.isArray(round.events) ? round.events.map(String) : [] };
}

/** The option pool in the saved model: its target and the shares the founding table gives it. */
export function modelPool(scenario) {
  if (!scenario) return null;
  const target = num(scenario.inputs?.option_pool_pct);
  const row = (scenario.result?.founding || []).find((h) => h?.type === 'option_pool');
  return { target: target == null ? NOT_RECORDED : `${target}%`, shares: row ? shares(row.shares) : NOT_RECORDED, pct: row ? pct(row.pct) : NOT_RECORDED };
}

/** The 409A read in the Worker's words; null for a read that did not answer. */
export function harbour(read) {
  if (!read || read.ok !== true) return null;
  const st = read.status || {};
  const c = read.current;
  return {
    state: String(st.state || 'none'),
    reason: st.reason || NOT_RECORDED,
    expires: day(st.expires_on),
    fmv: c && num(c.fmv_per_share) != null ? `$${c.fmv_per_share.toFixed(2)}` : NOT_RECORDED,
    provider: c?.provider || NOT_RECORDED,
    valued: day(c?.valuation_date),
  };
}

const HARBOUR_TONE = { valid: 'good', expiring: 'warn', expired: 'bad', invalidated: 'bad', none: 'muted' };
export const harbourTone = (state) => HARBOUR_TONE[state] || 'muted';

/** Founders' share after a scenario's last round, or of the founding table when it plans none. */
export function foundersAfter(result) {
  const rounds = Array.isArray(result?.rounds) ? result.rounds : [];
  const ledger = rounds.length ? rounds[rounds.length - 1].ledger : result?.founding;
  if (!Array.isArray(ledger) || !ledger.some((h) => num(h?.pct) != null)) return null;
  return ledger.filter((h) => h?.type === 'founder').reduce((t, h) => t + (num(h.pct) ?? 0), 0);
}

/** One scenario card (CT6), every figure Modelled. The saved model is "Cap table · model" (CT19b). */
export function scenarioCard(s, { model = false } = {}) {
  const round = s?.inputs?.rounds?.[0];
  const after = foundersAfter(s?.result);
  return {
    uid: s?.uid,
    name: model ? 'Cap table · model' : (String(s?.name || '').trim() || NOT_RECORDED),
    model,
    round: round
      ? `${String(round.name || 'Round').trim()} · pre-money ${dollars(round.pre_money)} · raise ${dollars(round.investment)}${num(round.post_round_pool_pct) != null ? ` · pool ${round.post_round_pool_pct}% post` : ''}`
      : 'No round is planned.',
    founders: after == null ? NOT_RECORDED : pct(after),
    changed: day(s?.updated_at),
    computed: !!s?.result && !s.result.errors,
  };
}

/** The compare read as cards: the model first, then the variants, newest first as the Worker sends them. */
export function scenarioCards(read) {
  if (!read) return [];
  const out = [];
  if (read.canonical) out.push(scenarioCard(read.canonical, { model: true }));
  for (const v of Array.isArray(read.variants) ? read.variants : []) out.push(scenarioCard(v));
  return out;
}

/** The two old pages read the venture as `?project=` (CapTablePage, CapTableVariantsPage). */
function oldSearch(search = '') {
  const q = tabSearch(search);
  return q ? q.replace('project_id=', 'project=') : '';
}

/** A variant's page; it reads its own venture, so only the variants index needs it. */
export const variantHref = (uid) => `${VARIANTS_PATH}/${encodeURIComponent(uid)}`;
export const variantsHref = (search = '') => `${VARIANTS_PATH}${oldSearch(search)}`;
export const simulatorHref = (search = '') => `${SIMULATOR_PATH}${oldSearch(search)}`;
