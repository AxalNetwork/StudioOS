/**
 * D4155 (#4155) — HQ › Decks, the words and rules the page draws by.
 *
 * Pure, for the Node test. `HqDecksPage.jsx` reads three routes that exist on
 * main — the reports queue (D1540), the feature flags (D1509) and the default
 * templates by sector and stage (D905) — and resolves a report. Every other
 * control waits for its build task (K1–K5) and says so; when a task lands its
 * builder flips `BUILD[key].live` and wires it, and the words here stay.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

export const BASE = '/admin/platform/decks';

/** The five tabs at their own addresses (D936), HD1–HD5. "Models" is the existing card on AI usage. */
export const TABS = [
  { key: 'reports', label: 'Reports', to: BASE },
  { key: 'flags', label: 'Feature flags', to: `${BASE}/flags` },
  { key: 'beta', label: 'Beta cohort', to: `${BASE}/beta` },
  { key: 'templates', label: 'Default templates', to: `${BASE}/templates` },
  { key: 'norms', label: 'Stage norms', to: `${BASE}/norms` },
];
export const MODELS_LINK = { label: 'Models · existing', to: '/admin/platform/ai-usage' };

/** Which tab an address opens; an unknown sub-path falls back to Reports. */
export function viewFor(pathname = '') {
  const [tab] = String(pathname).replace(/\/+$/, '').slice(BASE.length).split('/').filter(Boolean);
  return TABS.some((t) => t.key === tab) ? tab : 'reports';
}

/** The build tasks behind the boards (#4155 K1–K5). `live: false` until each lands. */
export const BUILD = {
  K1: { issue: 4188, live: false, what: 'The founder, deck and card by name, and the area before and after' },
  K2: { issue: 4189, live: false, what: 'A reason and an audit row on every flag change' },
  K3: { issue: 4190, live: false, what: 'The beta cohort' },
  K4: { issue: 4191, live: false, what: 'A reason and an audit row on every default template change' },
  K5: { issue: 4192, live: false, what: 'HQ stage norms' },
};
export const notYet = (key) => {
  const b = BUILD[key];
  return `Not switched on yet. ${b.what} arrives with #${b.issue}.`;
};

export const SUBTITLE = 'How the Pitch deck studio behaves for every founder: reports on bad results, features and who gets them early, default templates, and the norms the deck critic cites. Every change asks for a reason and is audited.';

export const shown = (v, fmt = String) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? NOT_RECORDED : fmt(v));

// ── HD1 · Reports ───────────────────────────────────────────────────────────

/** The founder's reasons, in the Worker's words (`REPORT_REASONS`). */
export const REASONS = {
  wrong_figure: 'States something my records do not',
  poor_writing: 'Badly written or unusable',
  wrong_place: 'Put in the wrong place',
  bad_image: 'The picture is wrong',
  unsafe: 'Offensive or unsafe',
  other: 'Something else',
};

/** The two outcomes the route takes. */
export const OUTCOMES = [
  { id: 'addressed', label: 'Addressed: we changed something' },
  { id: 'no_fault', label: 'No fault found' },
];
export const NOTE_MIN = 10;
export const NOTE_MAX = 500;
export const noteOk = (n) => {
  const t = String(n ?? '').trim();
  return t.length >= NOTE_MIN && t.length <= NOTE_MAX;
};
/** Resolve arms on an outcome and a note: the canvas makes the note required (the founder sees it). */
export const resolveArmed = ({ outcome, note }) => OUTCOMES.some((o) => o.id === outcome) && noteOk(note);

/** "$0.004" from micro-dollars; null (never $0) when the charge was not recorded. */
export const usdMicro = (m) => (m == null || !Number.isFinite(Number(m)) ? null : `$${(Number(m) / 1e6).toFixed(3)}`);

const textOf = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One HD1 row from a `GET /api/admin/deck-reports` report. The founder, the
 * deck and card, and the area before and after are K1's (#4188): until then
 * they read "Not recorded", and the row carries what the route sends — when,
 * the model, the reason and note, the status, the charge.
 */
export function reportRow(r) {
  const payload = r?.proposal?.payload && typeof r.proposal.payload === 'object' ? r.proposal.payload : null;
  return {
    uid: String(r?.uid ?? ''),
    when: r?.created_at ?? null,
    founder: textOf(r?.founder?.name) ?? NOT_RECORDED,
    deck: textOf(r?.deck?.title) ? `${r.deck.title}${r.deck.version != null ? ` · v${r.deck.version}` : ''}` : NOT_RECORDED,
    card: textOf(r?.card?.label) ?? NOT_RECORDED,
    asked: textOf(r?.asked) ?? textOf(r?.rail_option) ?? NOT_RECORDED,
    model: textOf(r?.model) ?? NOT_RECORDED,
    reason: r?.reason_label || REASONS[r?.reason] || NOT_RECORDED,
    note: textOf(r?.note),
    status: r?.status === 'resolved' ? 'Resolved' : 'Open',
    open: r?.status !== 'resolved',
    outcome: r?.outcome ?? null,
    resolution: textOf(r?.resolution_note),
    charged: usdMicro(r?.charged_microusd) ?? NOT_RECORDED,
    before: textOf(r?.before) ?? NOT_RECORDED,
    after: textOf(r?.after) ?? textOf(payload?.text) ?? textOf(payload?.after) ?? NOT_RECORDED,
    proposal: r?.proposal?.status ?? null,
  };
}

/** The filters over the rows the route sent: model and reason, by exact value. */
export function filterReports(rows, { model = '', reason = '', q = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return (rows || []).filter((r) => (!model || r.model === model) && (!reason || r.reason === reason)
    && (!needle || [r.deck, r.founder, r.card, r.note].some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))));
}

/** What the proposal's status means for the deck, in the canvas's words. */
export const PROPOSAL_LINE = {
  discarded: 'The founder discarded the proposal. Nothing was written to the deck.',
  accepted: 'The founder accepted the proposal. It was written to the deck.',
  pending: 'The proposal is still open on the founder’s deck.',
};

// ── HD2 · Feature flags ─────────────────────────────────────────────────────

/** A flag key in plain words. `grid_generate`, `element:<id>` and `model:<id>` are D1509's. */
export function flagLabel(key) {
  const k = String(key ?? '');
  if (k === 'grid_generate') return { name: 'Generate with The Grid', what: 'Founders generate cards and areas on The Grid.' };
  if (k.startsWith('element:')) return { name: `Element · ${k.slice(8)}`, what: 'One grid element founders can generate.' };
  if (k.startsWith('model:')) return { name: `Model · ${k.slice(6)}`, what: 'One model founders can choose for a deck element.' };
  return { name: k || NOT_RECORDED, what: null };
}

/** A row's scope in the canvas's words: Everyone, a role, or one named person. */
export function scopeLabel({ scope, scope_id: id } = {}) {
  if (scope === 'global') return 'Everyone';
  if (scope === 'role') return `Role · ${id ? String(id)[0].toUpperCase() + String(id).slice(1) : NOT_RECORDED}`;
  if (scope === 'user') return 'One named person';
  return NOT_RECORDED;
}

/** HD2's rows from `GET /api/admin/feature-flags`. `updated_by` is an id until K2 names it. */
export function flagRows(reply) {
  const flags = Array.isArray(reply?.flags) ? reply.flags : [];
  return flags.map((f) => {
    const { name, what } = flagLabel(f.key);
    return {
      id: `${f.key}|${f.scope}|${f.scope_id ?? ''}`,
      key: String(f.key), name, what,
      scope: scopeLabel(f),
      on: f.enabled === 1 || f.enabled === true,
      by: textOf(f?.updated_by?.name) ?? NOT_RECORDED,
      at: f.updated_at ?? null,
    };
  });
}

/** "No row is the default, on" (D1509): the keys with no row, so HQ sees them too. */
export function defaultOnKeys(reply) {
  const named = new Set((reply?.flags || []).map((f) => f.key));
  return (reply?.keys || []).filter((k) => !named.has(k));
}

// ── HD4 · Default templates ─────────────────────────────────────────────────

/** The canvas's grid: six sectors by four stages. Stages in the engine's own ids. */
export const SECTORS = ['B2B software', 'Fintech', 'Health', 'Climate', 'Consumer', 'Deep tech'];
export const STAGES = [
  { id: 'pre_seed', label: 'Pre-seed' },
  { id: 'seed', label: 'Seed' },
  { id: 'series_a', label: 'Series A' },
  { id: 'series_b', label: 'Series B+' },
];
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const STAGE_OF = { preseed: 'pre_seed', pre_seed: 'pre_seed', seed: 'seed', series_a: 'series_a', a: 'series_a', series_b: 'series_b', b: 'series_b' };

/** The engine's default when the reply carries `defaults` (K4, #4191); else null. */
const defaultOf = (reply, sector, stage) => {
  const d = (reply?.defaults || []).find((x) => norm(x.sector) === norm(sector) && (STAGE_OF[norm(x.stage)] ?? norm(x.stage)) === stage);
  return d?.method_id ?? null;
};

/**
 * HD4's grid, one cell per sector and stage. A cell with an override names
 * its template and who changed it; one without says "Default", and names the
 * engine's pick only when the reply carries it (K4): never a guessed template.
 */
export function templateGrid(reply, methods = []) {
  const names = new Map((methods || []).map((m) => [m.id, m.label]));
  const label = (id) => (id ? names.get(id) || id : null);
  const overrides = Array.isArray(reply?.overrides) ? reply.overrides : [];
  return SECTORS.map((sector) => ({
    sector,
    cells: STAGES.map((st) => {
      const o = overrides.find((x) => norm(x.sector) === norm(sector) && (STAGE_OF[norm(x.stage)] ?? norm(x.stage)) === st.id);
      if (o) return { stage: st.id, template: label(o.method_id), changed: true, by: textOf(o?.updated_by?.name) ?? NOT_RECORDED, at: o.updated_at ?? null };
      const d = defaultOf(reply, sector, st.id);
      return { stage: st.id, template: d ? label(d) : 'The engine’s own pick', changed: false, by: null, at: null };
    }),
  }));
}

/** Overrides saved under a sector the grid does not draw, listed so none is hidden. */
export function offGridOverrides(reply) {
  const known = new Set(SECTORS.map(norm));
  return (reply?.overrides || []).filter((o) => !known.has(norm(o.sector)));
}

// ── HD5 · Stage norms ───────────────────────────────────────────────────────

export const NORM_COLUMNS = ['Metric', 'Typical range', 'Source', 'Last reviewed'];
export const NORM_RULE = 'The deck critic quotes the norm, its range and its source beside a founder’s figure. It never rates the company. A norm with no source is never cited.';

// ── HD3 · Beta cohort ───────────────────────────────────────────────────────

export const BETA_COLUMNS = ['Name', 'Features on', 'Added'];

/** Every change on this page takes a reason (the dialogs' shared rule). */
export const REASON_MIN = 10;
export const reasonOk = (r) => String(r ?? '').trim().length >= REASON_MIN;
