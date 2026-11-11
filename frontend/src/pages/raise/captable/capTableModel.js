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
 * `/raise/cap-table/h-12` is still a holder; `/new` is Record an issuance (D1025).
 *
 * WHAT IS READ, AND FROM WHERE. Every figure comes from a read on `main`:
 *   - `GET /api/cycles/raise/modules/cap-table` → Overview (the Planned round
 *     card, the Holders records, From Mercury), as CycleRoute draws it today;
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
 * WHAT IS DRAWN WHERE. Instruments, its drawer and Option pool are D1023's
 * (`instrumentsModel.js`, `poolModel.js`), from the record and part 3's
 * scenario reads. History, the proposal drawers and the dialogs are
 * D1025's (`historyModel.js`). Access and Import and export are D1026's
 * (`capTableAccess.js`, `capTableImport.js`); the holder and instrument
 * drawers, the dialogs and the proposals wait for their parts (D1015 §6).
 * D1029 retired the old pages: nothing here links to them any more.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { exponentOf, formatMinorOrCount } from '../../../lib/money.js';

export const SLUG = 'cap-table';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Cap table';
/** The canvas's line, with the company left out: the header names the venture. */
export const LINE = 'Who owns the company, what was issued, and what the next round does to it.';
/**
 * D1029 (#2866): the old addresses forward here with `?moved=<key>`
 * (App.jsx `CapTableMovedRedirect`), and the tool says so once (D936).
 */
export const MOVED_NOTICES = Object.freeze({
  'cap-table': 'Cap table has a new address. Update your bookmark.',
  variants: 'Draft variants is now Scenarios, under Cap table.',
});

export const MODELLED = 'Modelled';
export const ON_RECORD = 'On record';
/**
 * Overview's line under the tabs. D1022: the blocks tagged On record come
 * from the record of what was issued (D1017); the Holders list and the Planned
 * round card further down are still the saved model.
 */
export const HOME_NOTE = 'Figures tagged On record come from the record of what was issued. The Holders list and the Planned round card below still come from your saved model.';

/**
 * The canvas's seven tabs. History reads D1017's history read, by section
 * (D1025); Access and Import and export read D1019's and D1020's routes and
 * D1017's record (D1026). `path` is the tab's segment under HOME_PATH.
 */
export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'instruments', label: 'Instruments', path: '/instruments' },
  { id: 'option-pool', label: 'Option pool', path: '/option-pool' },
  { id: 'scenarios', label: 'Scenarios', path: '/scenarios' },
  { id: 'history', label: 'History', path: '/history' },
  { id: 'access', label: 'Access', path: '/access' },
  { id: 'import-export', label: 'Import and export', path: '/import-export' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));
/** D1022: a holder's address, `h-<n>`, opens the holder drawer over Overview. */
export const HOLDER_ID = /^h-[1-9]\d*$/;

/**
 * True when CycleRoute's record id under this module is the tool's own page,
 * not a record: a tab word, or (D1022) a holder, whose drawer is the tool's.
 * `e-<n>` and `pool` are still records.
 */
export const isCapTableTab = (slug, id) => slug === SLUG && (TAB_WORDS.has(String(id ?? '')) || HOLDER_ID.test(String(id ?? '')));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * D5373: the currency code a cap-table figure is shown in: a bare code, a read's `{ code }`, or USD (the venture default
 * when none is recorded). Upper-cased, as `money()` reads it.
 */
export function codeOf(currency) {
  const c = currency && typeof currency === 'object' ? currency.code : currency;
  return String(c || 'USD').toUpperCase();
}

/**
 * D5497: the currency a cap-table figure is in. A saved model (and any scenario that starts from it) is whole US dollars by
 * contract; a figure that comes from the RECORD (Today, a recorded instrument, a scenario that starts from Today) is in the
 * record's own currency. `fromRecord` says which; where it cannot be told, the caller passes false and the figure is USD.
 */
export const sourceCurrency = (fromRecord, recordCurrency) => (fromRecord ? codeOf(recordCurrency) : 'USD');

/** The mark that goes before an amount: "$" for USD, the code and a space for any other currency (as the option pool does). */
export const symbolOf = (currency) => { const c = codeOf(currency); return c === 'USD' ? '$' : `${c} `; };

/**
 * "$500,000" from whole major units (the model's unit), in the venture's currency (D5373): USD prints exactly as it
 * always did; any other code prints "EUR 5,000", "JPY 5,000", "KWD 1.25" at that currency's own decimals (JPY none, KWD
 * up to three, else up to two). The value is already whole major units, so nothing is converted here. A code the layer
 * does not list prints the number as stored beside the code, with no decimals guessed. Missing is "Not recorded", never 0.
 */
export function dollars(v, currency = 'USD') {
  const n = num(v);
  if (n == null) return NOT_RECORDED;
  const code = codeOf(currency);
  const exp = exponentOf(code);
  if (exp === null) return `${code} ${n}`;
  return `${symbolOf(code)}${n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? exp : 0 })}`;
}

/** An amount in the currency's smallest unit (SAFE issuances), in its own currency. */
export function money(cents, currency = 'USD') {
  const n = num(cents);
  if (n == null) return NOT_RECORDED;
  // D5373: at the currency's own decimals; a missing currency is the issuance's USD default, an unlisted code names the count.
  return formatMinorOrCount(n, String(currency || 'USD').toUpperCase(), { locale: 'en-US', trimWhole: true });
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

/** CT3's note on a pre-money SAFE (D1023 draws it on the record's instruments). */
export const BASIS_CHECK = 'Basis: pre-money, as entered. Axal’s SAFE template is post-money.';

/** The 409A read in the Worker's words; null for a read that did not answer. */
export function harbour(read) {
  if (!read || read.ok !== true) return null;
  const st = read.status || {};
  const c = read.current;
  return {
    state: String(st.state || 'none'),
    reason: st.reason || NOT_RECORDED,
    expires: day(st.expires_on),
    // A 409A valuation is a US tax valuation: `valuations_409a` has no currency column, so the FMV is US dollars by contract.
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
export function scenarioCard(s, { model = false, currency = 'USD' } = {}) {
  // `currency` is the RECORD's; only a scenario that starts from Today is in it (the saved model and model scenarios are USD, D5497).
  const cur = sourceCurrency(!model && !!s?.inputs?.start, currency);
  const round = s?.inputs?.rounds?.[0];
  const after = foundersAfter(s?.result);
  return {
    uid: s?.uid,
    name: model ? 'Cap table · model' : (String(s?.name || '').trim() || NOT_RECORDED),
    model,
    // D1024: where the scenario starts — the record (D1018's `start`), or a model typed by hand.
    start: model ? 'Your saved model' : s?.inputs?.start ? 'Starts from Today' : 'Starts from your model',
    round: round
      ? `${String(round.name || 'Round').trim()} · pre-money ${dollars(round.pre_money, cur)} · raise ${dollars(round.investment, cur)}${num(round.post_round_pool_pct) != null ? ` · pool ${round.post_round_pool_pct}% post` : ''}`
      : 'No round is planned.',
    founders: after == null ? NOT_RECORDED : pct(after),
    changed: day(s?.updated_at),
    computed: !!s?.result && !s.result.errors,
  };
}

/** The compare read as cards: the model first, then the variants, newest first as the Worker sends them. */
export function scenarioCards(read, currency = 'USD') {
  if (!read) return [];
  const out = [];
  if (read.canonical) out.push(scenarioCard(read.canonical, { model: true, currency }));
  for (const v of Array.isArray(read.variants) ? read.variants : []) out.push(scenarioCard(v, { currency }));
  return out;
}

// ─────────────────────────────────────────────────────────── D1028: the phone and dark

/**
 * D1028 (#2865, CT23): below 1024px the tool's root carries this class, and
 * `capTable.css` makes every control in it a 44 × 44px target.
 */
export const PHONE_ROOT = 'captable-phone';
/** CT23a: the holder cards Overview shows on a phone before "Show more". */
export const PHONE_HOLDERS = 6;

/**
 * D1028 (CT8): the dark pairs every board uses. Violet text is #a78bfa, and
 * each status colour keeps its own pair: positive #34d399, negative #f87171,
 * amber #fcd34d. The hairline is #374151 and the ink #e5e7eb.
 * `captable_phone_dark_d1028.test.mjs` holds every file here to them.
 */
export const DARK = {
  violet: 'dark:text-violet-400',
  positive: 'dark:text-emerald-400',
  negative: 'dark:text-red-400',
  amber: 'dark:text-amber-300',
  hairline: 'dark:border-gray-700',
  ink: 'dark:text-gray-200',
  muted: 'dark:text-gray-400',
  card: 'dark:bg-gray-900',
  raised: 'dark:bg-gray-800',
  lavender: 'dark:bg-[#211f3d]',
  lavenderEdge: 'dark:border-[#4c3a8a]',
};
