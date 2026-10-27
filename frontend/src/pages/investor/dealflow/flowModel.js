/**
 * D1240 (#3253, part 4 of #2423) — Deal flow's board and table as pure rules,
 * over the reads parts 2 and 3 and SCORING's batch added:
 *
 *   - `GET /api/deals/flow` (D1238): the firm's own rows, each with its stage,
 *     owner, how it entered, days in stage and `can_open`;
 *   - `GET /api/deals` (D1236): every listed round, for All deals and for each
 *     round's currency and instrument;
 *   - `POST /api/venture-scores/batch` (D1256): per scope its state, band and
 *     confidence word, **never a number**, for the deals the investor may read;
 *   - `GET /api/deals/fit` (D1239): the investor's own fit to their thesis;
 *   - `GET /api/venture-scores/weights` (D1256): "Your weighting", for sort only;
 *   - `/api/deals/views` (D1239): saved settings.
 *
 * A SCORE IS A BAND. The batch gives Strong, Fair or Weak with High, Medium or
 * Low confidence, so a cell says the band, never a figure, and a missing score
 * is a word (Not scored, Not enough recorded, Locked), never 0. Sorting by a
 * scope ranks the band, then its confidence; unscored and locked rows sort
 * last whichever way. No React here.
 */

import { SCOPES as SCORE_SCOPES } from '../../../components/scoring/scorecard/scorecardModel.js';
import { BASE, MAX_COMPARE, roundWord } from './dealFlowModel.js';

/** SCORING's eleven scope keys and labels, in its one order. There is no Overall. */
export const SCOPE_KEYS = Object.freeze(SCORE_SCOPES.map((s) => s.key));
export const SCOPE_LABEL = Object.freeze(Object.fromEntries(SCORE_SCOPES.map((s) => [s.key, s.label])));
/** The table's short heads (DLS2): PMF, Pol. & reg., Legal & IP. */
export const SCOPE_SHORT = Object.freeze({ ...SCOPE_LABEL, pmf: 'PMF', political: 'Pol. & reg.', legal_ip: 'Legal & IP' });
export const SHORT_LINE = 'PMF is Product-market fit. Pol. & reg. is Political and regulatory.';

// ---------------------------------------------------------------- stages and entry

/** The firm's own stages (D1238), in board order; Passed sits outside the board as a filter. */
export const BOARD_STAGES = Object.freeze(['sourcing', 'screening', 'diligence', 'commit', 'closing']);
export const STAGE_WORD = Object.freeze({ sourcing: 'Sourced', screening: 'Screening', diligence: 'Diligence', commit: 'Commit', closing: 'Closing', passed: 'Passed' });
export const stageWord = (s) => STAGE_WORD[s] || 'Not on your deals';

/** How a row entered the flow (D1238 `entered_via`), in the canvas's words. */
export const ENTERED_WORD = Object.freeze({
  invited: 'Invited by the studio', requested: 'Invitation requested', committed: 'You committed', added: 'Added by you',
  thesis: 'Matches your thesis', introduction: 'Introduction', syndicate: 'Syndicate open', watchlist: 'From your watchlist',
});
export const enteredWord = (v) => ENTERED_WORD[v] || 'Not recorded';

/**
 * Where a card may move. Passed is reached only by the pass, with its reason
 * (D1238 §3, part 5's dialog), so it is never offered here; a row already
 * passed may move back onto the board.
 */
export const moveTargets = (stage) => BOARD_STAGES.filter((s) => s !== stage);

// ---------------------------------------------------------------- scores

const BAND_RANK = Object.freeze({ Strong: 3, Fair: 2, Weak: 1 });
const CONF_RANK = Object.freeze({ High: 3, Medium: 2, Low: 1 });
/** Risk reads as a risk word on the same bands (D1253 `bandOf`). */
const RISK_WORD = Object.freeze({ Strong: 'Low risk', Fair: 'Medium risk', Weak: 'High risk' });

export const SCORE_WORDS = Object.freeze({
  not_scored: 'Not scored',
  not_enough: 'Not enough recorded',
  not_expected: 'Not expected yet',
  unreadable: 'Unreadable',
  locked: 'Locked',
  not_shared: 'Not shared',
  loading: 'Reading…',
  failed: '—',
});
export const SCORE_TITLES = Object.freeze({
  not_scored: 'This venture has not been scored on this scope. Scores appear after its scoring run.',
  not_enough: 'Not enough is recorded for this scope to score it.',
  not_expected: 'This scope is not expected at the venture’s stage.',
  unreadable: 'This scope could not be read. Try again.',
  locked: 'The founder has not shared this scorecard with investors.',
  not_shared: 'Scores show on deals you are invited to or have committed on.',
  failed: 'Scores could not be read. Names, stages and money are current.',
});

/**
 * One row's scores from the batch: `ok` with each scope by key, `locked`,
 * `unreadable`, or `not_shared` when the batch left the deal out (the
 * investor may not read it). `failed` is the whole read failing.
 */
export function scoresOf(batch, dealId) {
  if (batch === 'failed') return { state: 'failed', byScope: {} };
  if (!batch) return { state: 'loading', byScope: {} };
  const item = (batch.items || []).find((i) => String(i.deal_id) === String(dealId));
  if (!item) return { state: 'not_shared', byScope: {} };
  if (item.locked) return { state: 'locked', byScope: {}, reason: item.reason || SCORE_TITLES.locked };
  if (item.unreadable) return { state: 'unreadable', byScope: {} };
  const byScope = {};
  for (const s of item.scopes || []) byScope[s.scope] = { state: s.state, band: s.band || null, confidence: s.confidence_word || null };
  return { state: 'ok', byScope };
}

/** One scope's cell: a band and its confidence, or the word for why there is none. Never a number. */
export function scopeCell(scores, key) {
  if (scores.state !== 'ok') return { kind: scores.state, word: SCORE_WORDS[scores.state], title: scores.reason || SCORE_TITLES[scores.state] || null };
  const s = scores.byScope[key];
  if (!s || s.state === 'not_read') return { kind: 'not_scored', word: SCORE_WORDS.not_scored, title: SCORE_TITLES.not_scored };
  if (s.state === 'not_expected') return { kind: 'not_expected', word: SCORE_WORDS.not_expected, title: SCORE_TITLES.not_expected };
  if (s.state === 'unreadable') return { kind: 'unreadable', word: SCORE_WORDS.unreadable, title: SCORE_TITLES.unreadable };
  if (s.state !== 'scored' || !BAND_RANK[s.band]) return { kind: 'not_enough', word: SCORE_WORDS.not_enough, title: `${SCOPE_LABEL[key]} · ${SCORE_TITLES.not_enough}` };
  const band = key === 'risk' ? RISK_WORD[s.band] : s.band;
  return {
    kind: 'scored', word: band, band: s.band, confidence: s.confidence,
    title: `${SCOPE_LABEL[key]}: ${band}${s.confidence ? `, ${s.confidence.toLowerCase()} confidence` : ''}`,
  };
}

/** The strip's scopes (`ScopeStrip`) from the batch: the strip draws a band's height, never a figure. */
export function stripScopes(scores) {
  const STRIP = { Strong: 85, Fair: 55, Weak: 25 };
  return SCOPE_KEYS.map((key) => {
    const c = scopeCell(scores, key);
    if (c.kind === 'scored') return { key, state: 'scored', value: STRIP[c.band], confidence: (c.confidence || 'low').toLowerCase() };
    if (c.kind === 'not_expected') return { key, state: 'not_expected' };
    if (c.kind === 'not_enough') return { key, state: 'not_enough' };
    return { key, state: 'not_read' };
  });
}

// ---------------------------------------------------------------- fit

/** The fit cell (D1239): a personal comparison, its own number, never one of SCORING's scopes. */
export function fitCell(fit) {
  if (fit === 'failed') return { kind: 'unreadable', word: 'Unreadable', title: 'Fit to your thesis could not be read. Try again.' };
  if (!fit) return { kind: 'loading', word: SCORE_WORDS.loading, title: null };
  if (fit.state === 'not_set') return { kind: 'not_set', word: 'Set your thesis', title: 'Every Fit cell reads Set your thesis until a thesis is saved.' };
  if (fit.state === 'unavailable') return { kind: 'unavailable', word: '—', title: 'Fit shows on deals you are invited to or have committed on.' };
  if (fit.state === 'unreadable') return { kind: 'unreadable', word: 'Unreadable', title: fit.reason || 'The fit inputs could not be read. Try again.' };
  if (fit.score == null) return { kind: 'not_enough', word: SCORE_WORDS.not_enough, title: 'Not enough of the venture is recorded to compare with your thesis.' };
  return { kind: 'scored', word: String(fit.score), confidence: fit.confidence_label || null, title: `Fit to my thesis ${fit.score}${fit.confidence_label ? `, ${fit.confidence_label.toLowerCase()} confidence` : ''}` };
}
export const fitOf = (fits, dealId) => (fits === 'failed' ? 'failed' : fits ? fits.get(String(dealId)) || null : null);

// ---------------------------------------------------------------- rows

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || null;

/**
 * The rows a scope shows. Mine is the flow; All deals is every listed round,
 * each with its flow row when the firm has one. A round's currency and
 * instrument come from the deal list, which the flow does not carry.
 */
export function flowRows(scope, { flow, deals }) {
  const byDeal = new Map((Array.isArray(deals) ? deals : []).map((d) => [String(d.id), d]));
  const entries = new Map((flow?.items || []).map((f) => [String(f.deal_id), f]));
  const row = (id, f, d) => ({
    id,
    name: f?.venture || d?.project_name || 'Name not recorded',
    sector: f?.sector || d?.project_sector || null,
    roundStatus: f?.round_status || d?.status || null,
    round: roundWord(f?.round_status || d?.status),
    ask: f ? num(f.ask) : num(d?.target_raise ?? d?.amount),
    currency: d?.currency || null,
    instrument: d?.instrument || null,
    inFlow: !!f,
    stage: f?.stage || null,
    owner: f?.owner ? { id: Number(f.owner.user_id), name: f.owner.name || null, initials: initials(f.owner.name) } : null,
    enteredVia: f?.entered_via || null,
    enteredAt: f?.entered_at || null,
    daysInStage: f ? num(f.days_in_stage) : null,
    // D1241: the firm's note on its row, for the peek (DLS7).
    note: f?.note ?? null,
    // A door only where DEAL's rule holds (D1238 `can_open`); a listed round alone is never one.
    canOpen: !!f?.can_open,
  });
  if (scope === 'all') return [...byDeal.entries()].map(([id, d]) => row(id, entries.get(id), d));
  return [...entries.entries()].map(([id, f]) => row(id, f, byDeal.get(id)));
}

/** A money figure, compact, in its currency; null is the caller's "Not recorded". Never a guessed currency. */
export function moneyText(n, currency) {
  if (n == null) return null;
  if (!currency) return `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} (currency not recorded)`;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n); } catch { return `${n} ${currency}`; }
}

/** A board column's line: its asks in one currency, or how many currencies, and how many have none. */
export function columnAsks(rows) {
  const recorded = rows.filter((r) => r.ask != null);
  const none = rows.length - recorded.length;
  const currencies = [...new Set(recorded.map((r) => r.currency || '?'))];
  let sum = null;
  if (recorded.length && currencies.length === 1) sum = `${moneyText(recorded.reduce((a, r) => a + r.ask, 0), currencies[0] === '?' ? null : currencies[0])} in asks`;
  else if (recorded.length) sum = `Asks in ${currencies.length} currencies`;
  return [sum, none ? `${none} with none recorded` : null].filter(Boolean).join(' · ') || null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-10-02 …` → `2 Oct`; anything else is null, never a guessed date. */
export function shortDayOf(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
}

export const daysWord = (n) => (n == null ? null : n === 1 ? '1 day' : `${n} days`);

// ---------------------------------------------------------------- filters

export const ROUND_KEYS = Object.freeze(['applied', 'scored', 'active', 'funded', 'rejected']);
export const MIN_BANDS = Object.freeze([{ id: '', label: 'Any' }, { id: 'fair', label: 'Fair or better' }, { id: 'strong', label: 'Strong' }]);
export const MIN_CONF = Object.freeze([{ id: '', label: 'Any confidence' }, { id: 'medium', label: 'Medium or high' }, { id: 'high', label: 'High only' }]);
const MIN_RANK = { fair: 2, strong: 3 };
const CONF_MIN = { medium: 2, high: 3 };
export const OWNERS = Object.freeze([{ id: '', label: 'Anyone' }, { id: 'me', label: 'Me' }, { id: 'none', label: 'Unassigned' }]);

export const emptyFilters = () => ({ q: '', stage: [], round: [], via: [], sector: [], owner: '', min: {}, conf: '', unscored: false });

/** How many filters are on (the toolbar's count). Search is not a filter; a confidence counts with its minimum. */
export const filterCount = (f) => ['stage', 'round', 'via', 'sector'].filter((k) => f[k].length).length
  + (f.owner ? 1 : 0) + Object.values(f.min).filter(Boolean).length;

/**
 * Whether a row passes the filters. A score minimum keeps a row only when
 * that scope is scored at or above it (and at the confidence asked); a row
 * not scored there is kept only with "Include deals not scored". Passed rows
 * show only when Passed is asked for.
 */
export function passes(r, f, me = null) {
  const needle = f.q.trim().toLowerCase();
  if (needle && !`${r.name} ${r.sector || ''}`.toLowerCase().includes(needle)) return false;
  if (f.stage.length ? !f.stage.includes(r.stage || 'none') : r.stage === 'passed') return false;
  if (f.round.length && !f.round.includes(r.roundStatus)) return false;
  if (f.via.length && !f.via.includes(r.enteredVia)) return false;
  if (f.sector.length && !f.sector.includes(r.sector)) return false;
  if (f.owner === 'me' && r.owner?.id !== me) return false;
  if (f.owner === 'none' && r.owner) return false;
  for (const [key, min] of Object.entries(f.min)) {
    if (!min) continue;
    const c = scopeCell(r.scores, key);
    if (c.kind !== 'scored') { if (!f.unscored) return false; continue; }
    if (BAND_RANK[c.band] < MIN_RANK[min]) return false;
    if (f.conf && (CONF_RANK[c.confidence] || 0) < CONF_MIN[f.conf]) return false;
  }
  return true;
}

/** The chips under the toolbar: one per filter on, in words (DLS1). */
export function filterChips(f) {
  const out = [];
  for (const [key, min] of Object.entries(f.min)) if (min) out.push({ id: `min-${key}`, word: `${SCOPE_LABEL[key]}: ${MIN_BANDS.find((b) => b.id === min).label}${f.conf ? ` · ${MIN_CONF.find((c) => c.id === f.conf).label.toLowerCase()}` : ' · any confidence'}` });
  if (f.stage.length) out.push({ id: 'stage', word: `My stage: ${f.stage.map((s) => STAGE_WORD[s] || 'Not on your deals').join(', ')}` });
  if (f.round.length) out.push({ id: 'round', word: `Round: ${f.round.map(roundWord).join(', ')}` });
  if (f.via.length) out.push({ id: 'via', word: `Entered: ${f.via.map(enteredWord).join(', ')}` });
  if (f.sector.length) out.push({ id: 'sector', word: `Sector: ${f.sector.join(', ')}` });
  if (f.owner) out.push({ id: 'owner', word: `Owner: ${OWNERS.find((o) => o.id === f.owner).label}` });
  return out;
}

// ---------------------------------------------------------------- sort

export const SORT_FIELDS = Object.freeze([
  ...SCOPE_KEYS.map((k) => ({ id: k, label: SCOPE_LABEL[k], scope: true })),
  { id: 'weighting', label: 'Your weighting', scope: true },
  { id: 'fit', label: 'Fit to my thesis' },
  { id: 'days', label: 'Days in stage' },
  { id: 'ask', label: 'Ask' },
  { id: 'name', label: 'Venture' },
]);
export const sortLabel = (id) => (SORT_FIELDS.find((s) => s.id === id) || SORT_FIELDS[0]).label;
export const DEFAULT_SORT = Object.freeze({ by: 'team', dir: 'desc', mode: 'score' });

/**
 * One row's sort key, or null when it has none: a scope ranks its band, then
 * its confidence (`mode: 'confidence'` ranks confidence first). "Your
 * weighting" is the weighted mean of the scored scopes' band ranks with the
 * investor's weights (equal when none); it orders rows, it never makes a score.
 */
export function sortKey(r, by, mode = 'score', weights = null) {
  if (SCOPE_KEYS.includes(by)) {
    const c = scopeCell(r.scores, by);
    if (c.kind !== 'scored') return null;
    const b = BAND_RANK[c.band]; const k = CONF_RANK[c.confidence] || 0;
    return mode === 'confidence' ? k * 10 + b : b * 10 + k;
  }
  if (by === 'weighting') {
    let sum = 0; let total = 0;
    for (const key of SCOPE_KEYS) {
      const c = scopeCell(r.scores, key);
      const w = weights && Number.isFinite(Number(weights[key])) ? Number(weights[key]) : 1;
      if (c.kind !== 'scored' || !w) continue;
      sum += BAND_RANK[c.band] * w; total += w;
    }
    return total ? sum / total : null;
  }
  if (by === 'fit') { const c = fitCell(r.fit); return c.kind === 'scored' ? Number(c.word) : null; }
  if (by === 'days') return r.daysInStage;
  if (by === 'ask') return r.ask;
  if (by === 'name') return r.name.toLowerCase();
  return null;
}

/** Rows sorted. A row with no key (unscored, locked, not recorded) sorts last, whichever the direction. */
export function sortRows(rows, { by, dir, mode } = DEFAULT_SORT, weights = null) {
  const keyed = rows.map((r, i) => ({ r, i, k: sortKey(r, by, mode, weights) }));
  const sign = dir === 'asc' ? 1 : -1;
  return keyed.sort((a, b) => {
    if (a.k == null || b.k == null) return (a.k == null) - (b.k == null) || a.i - b.i;
    const c = typeof a.k === 'string' ? a.k.localeCompare(b.k) : a.k - b.k;
    return c * sign || a.i - b.i;
  }).map((x) => x.r);
}
export const SORT_LAST = 'Unscored and locked deals sort last, whichever direction you choose.';

// ---------------------------------------------------------------- columns and card scopes

/** The table's columns after Venture, which is always shown (DLS3). */
export const COLUMNS = Object.freeze([
  { id: 'stage', label: 'My stage' }, { id: 'round', label: 'Round' }, { id: 'ask', label: 'Ask' }, { id: 'scorecard', label: 'Scorecard' },
  ...SCOPE_KEYS.map((k) => ({ id: k, label: SCOPE_LABEL[k], scope: true })),
  { id: 'fit', label: 'Fit to my thesis' }, { id: 'days', label: 'Days in stage' }, { id: 'owner', label: 'Owner' }, { id: 'entered', label: 'Entered' },
]);
export const DEFAULT_COLUMNS = Object.freeze(COLUMNS.map((c) => c.id));
export const MAX_CARD_SCOPES = 3;
export const DEFAULT_CARDS = Object.freeze(['team', 'market', 'geographic']);

/** A column toggle; the order is always the canvas's, whatever the order of clicks. */
export const toggleColumn = (cols, id) => COLUMNS.map((c) => c.id).filter((x) => (x === id ? !cols.includes(id) : cols.includes(x)));
/** A card-scope toggle: at most three, in SCORING's order. */
export function toggleCard(cards, key) {
  if (cards.includes(key)) return cards.filter((k) => k !== key);
  if (cards.length >= MAX_CARD_SCOPES) return cards;
  return SCOPE_KEYS.filter((k) => k === key || cards.includes(k));
}

export const PAGE_SIZE = 25;
export const pageOf = (rows, page) => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
export const pagesFor = (n) => Math.max(1, Math.ceil(n / PAGE_SIZE));

// ---------------------------------------------------------------- settings: the address and a saved view

/** Everything a view keeps: filters, sort, columns and card scopes. The view and scope are `dealFlowModel`'s. */
export const defaultSettings = () => ({ filters: emptyFilters(), sort: { ...DEFAULT_SORT }, columns: [...DEFAULT_COLUMNS], cards: [...DEFAULT_CARDS] });

const list = (v, allowed) => String(v || '').split(',').map((x) => x.trim()).filter((x) => x && allowed.includes(x));
const STAGE_KEYS = [...BOARD_STAGES, 'passed', 'none'];
const SORT_IDS = SORT_FIELDS.map((s) => s.id);
const VIA_KEYS = Object.keys(ENTERED_WORD);

/** The settings an address names; anything unknown is dropped, never guessed. */
export function settingsOf(search = '') {
  const q = new URLSearchParams(String(search));
  const s = defaultSettings();
  s.filters.q = (q.get('q') || '').slice(0, 100);
  s.filters.stage = list(q.get('stage'), STAGE_KEYS);
  s.filters.round = list(q.get('round'), ROUND_KEYS);
  s.filters.via = list(q.get('via'), VIA_KEYS);
  s.filters.sector = String(q.get('sector') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  s.filters.owner = ['me', 'none'].includes(q.get('owner')) ? q.get('owner') : '';
  for (const key of SCOPE_KEYS) { const m = q.get(`min_${key}`); if (m === 'fair' || m === 'strong') s.filters.min[key] = m; }
  s.filters.conf = ['medium', 'high'].includes(q.get('conf')) ? q.get('conf') : '';
  s.filters.unscored = q.get('unscored') === '1';
  if (SORT_IDS.includes(q.get('sort'))) s.sort.by = q.get('sort');
  if (q.get('dir') === 'asc') s.sort.dir = 'asc';
  if (q.get('mode') === 'confidence') s.sort.mode = 'confidence';
  if (q.has('cols')) s.columns = list(q.get('cols'), DEFAULT_COLUMNS);
  if (q.has('cards')) s.cards = list(q.get('cards'), SCOPE_KEYS).slice(0, MAX_CARD_SCOPES);
  return s;
}

/** Whether the address names any setting (a saved default view applies only when it names none). */
export const namesSettings = (search = '') => {
  const q = new URLSearchParams(String(search));
  return ['q', 'stage', 'round', 'via', 'sector', 'owner', 'conf', 'unscored', 'sort', 'dir', 'mode', 'cols', 'cards', 'v'].some((k) => q.has(k))
    || SCOPE_KEYS.some((k) => q.has(`min_${k}`));
};

/** The address of a view: the defaults are left out, so a plain `/deals` is Board, Mine, sorted by Team. */
export function settingsHref({ view = 'board', scope = 'mine', settings = defaultSettings(), viewUid = null } = {}) {
  const q = new URLSearchParams();
  if (view !== 'board') q.set('view', view);
  if (scope !== 'mine') q.set('scope', scope);
  if (viewUid) q.set('v', viewUid);
  const f = settings.filters;
  if (f.q.trim()) q.set('q', f.q.trim());
  for (const k of ['stage', 'round', 'via', 'sector']) if (f[k].length) q.set(k, f[k].join(','));
  if (f.owner) q.set('owner', f.owner);
  for (const key of SCOPE_KEYS) if (f.min[key]) q.set(`min_${key}`, f.min[key]);
  if (f.conf) q.set('conf', f.conf);
  if (f.unscored) q.set('unscored', '1');
  if (settings.sort.by !== DEFAULT_SORT.by) q.set('sort', settings.sort.by);
  if (settings.sort.dir !== DEFAULT_SORT.dir) q.set('dir', settings.sort.dir);
  if (settings.sort.mode !== DEFAULT_SORT.mode) q.set('mode', settings.sort.mode);
  if (settings.columns.join(',') !== DEFAULT_COLUMNS.join(',')) q.set('cols', settings.columns.join(','));
  if (settings.cards.join(',') !== DEFAULT_CARDS.join(',')) q.set('cards', settings.cards.join(','));
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * A saved view's spec (D1239 `viewSpec`): `version`, `scope`, `view`,
 * `filters`, `sort` and `columns`, with lower-case keys only. Card scopes ride
 * in `columns.cards`. The spec is settings only: it never opens a deal.
 */
export function specOf({ view, scope, settings }) {
  const f = settings.filters;
  return {
    version: 1, view, scope,
    filters: { q: f.q.trim(), stage: f.stage, round: f.round, via: f.via, sector: f.sector, owner: f.owner, min: { ...f.min }, conf: f.conf, unscored: f.unscored },
    sort: { ...settings.sort },
    columns: { table: settings.columns, cards: settings.cards },
  };
}

/** A saved spec back into settings, through the same checks as an address. */
export function settingsOfSpec(spec = {}) {
  const f = spec.filters || {};
  const q = new URLSearchParams();
  if (f.q) q.set('q', String(f.q));
  for (const k of ['stage', 'round', 'via', 'sector']) if (Array.isArray(f[k]) && f[k].length) q.set(k, f[k].join(','));
  if (f.owner) q.set('owner', String(f.owner));
  for (const [k, v] of Object.entries(f.min || {})) q.set(`min_${k}`, String(v));
  if (f.conf) q.set('conf', String(f.conf));
  if (f.unscored) q.set('unscored', '1');
  if (spec.sort?.by) q.set('sort', String(spec.sort.by));
  if (spec.sort?.dir) q.set('dir', String(spec.sort.dir));
  if (spec.sort?.mode) q.set('mode', String(spec.sort.mode));
  if (Array.isArray(spec.columns?.table)) q.set('cols', spec.columns.table.join(','));
  if (Array.isArray(spec.columns?.cards)) q.set('cards', spec.columns.cards.join(','));
  return {
    view: spec.view === 'table' ? 'table' : 'board',
    scope: ['all', 'new'].includes(spec.scope) ? spec.scope : 'mine',
    settings: settingsOf(q.toString()),
  };
}

/** Whether what is on screen differs from the saved view ("• edited", DLS5 C). */
export function viewChanged(saved, current) {
  if (!saved) return false;
  const a = settingsOfSpec(saved.spec);
  return settingsHref({ ...a }) !== settingsHref({ view: current.view, scope: current.scope, settings: current.settings });
}

/** What a saved view keeps, in words, for the Save view dialog (DLS5 B). */
export function keepsLines({ view, scope, settings }) {
  const chips = filterChips(settings.filters);
  return [
    `View: ${view === 'table' ? 'Table' : 'Board'}`,
    `Scope: ${scope === 'all' ? 'All deals' : scope === 'new' ? 'New for you' : 'Mine'}`,
    `Filters: ${chips.length ? chips.map((c) => c.word).join('; ') : 'none on'}`,
    `Sort: ${sortLabel(settings.sort.by)}, ${settings.sort.dir === 'asc' ? 'lowest first' : 'highest first'}`,
    'Columns and card scopes',
  ];
}

export const pickToggle = (picked, id) => (picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= MAX_COMPARE ? picked : [...picked, id]);
