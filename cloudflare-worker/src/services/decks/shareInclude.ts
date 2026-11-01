/**
 * D902 (#2681) — WHAT A PITCH DECK LINK INCLUDES.
 *
 * The share dialog's "What is included" (PD18) is stored on the link as
 * `include_json` (migration 567), and the share read sends the version's cards
 * through `shareSlides()` before anything leaves the Worker. The owner's
 * question 3 (#2434) is not answered, so this is answer A, as the canvas
 * draws it:
 *
 *   figures   on    the figure fields (`metric_grid`), with their chips;
 *   sources   on    the Sources appendix cards (`appendix: true`);
 *   notes     off   speaker notes (a card's `notes`; part 4 adds them);
 *   bands     off   the scorecard and product-market fit bands.
 *
 * NEVER, WHATEVER THE LINK SAYS:
 *   · an internal score: the readiness fields (`vr_*`);
 *   · a bank balance, an account or a counterparty: a field whose key names
 *     one (`BANK_KEY`);
 *   · a quote without its consent recorded (`consent: true` on the field).
 *     No editor records consent yet, so today no quote goes out on a link;
 *   · a figure's record: a D896 binding goes out as its grade and date only,
 *     and a field bound to a score, a bank slot or a band is judged by that
 *     slot as by its own key.
 *
 * A link made before 567 has no `include_json` and gets the default. A field
 * this removes is gone from the card, not blanked: the viewer shows what is
 * there and says nothing about what is not.
 *
 * D1507 (#3758, deck v2 A14) — THE GRID'S BLOCKS. Every block goes
 * through `blockKept(block, include, gates)`. A block that names its element
 * (`block.element`, an id of `elementModels.ELEMENTS`) is judged by that
 * element's gate (`ELEMENT_GATES`); one that names none by its kind's
 * (`BLOCK_KIND_GATES`). Both tables cover every id and kind: a new element
 * or kind with no gate fails `share_scoping_d1507.test.ts`. The gates:
 *
 *   none         always on the link;
 *   figures      only with `include.figures` (charts, metrics, tables, the
 *                money elements);
 *   notes        only with `include.notes`;
 *   team_photos  only with `include.team_photos` (off by default): the team
 *                grid and the team bios;
 *   cap_table    only with `include.cap_table` (off by default), and then a
 *                table keeps its header and its total rows only, never a
 *                holder's row; a cap table in any other shape is left out;
 *   consent      an interview quote, only when its `session_uid` is one of
 *                `gates.quote_sessions`: sessions this venture recorded
 *                consent for, quotable (`quote_consent`), read by the Worker
 *                at share time (`shareGatesFor`), never taken from the block;
 *   permission   a logo wall, and any logo a connected CRM (HubSpot, #3880)
 *                supplied, only when its `logo_key` is one of
 *                `gates.logo_permissions`. No store records a permission yet
 *                (#3781), so today no such logo goes out on a link.
 *
 * And, whatever the gate: a block bound anywhere (its own binding, a chart
 * series, a table cell) to a bank slot or an internal score is never sent;
 * one bound to a band needs `include.bands`. An element id this file does not
 * know is left out, not let through.
 */

import type { Env } from '../../types';

export type ShareInclude = { figures: boolean; sources: boolean; notes: boolean; bands: boolean; cap_table: boolean; team_photos: boolean };

export const DEFAULT_SHARE_INCLUDE: Readonly<ShareInclude> = Object.freeze({ figures: true, sources: true, notes: false, bands: false, cap_table: false, team_photos: false });
export const SHARE_INCLUDE_KEYS = ['figures', 'sources', 'notes', 'bands', 'cap_table', 'team_photos'] as const;

/** A readiness field: the venture's internal score. Never on a link. */
const INTERNAL_SCORE_KEY = /^vr_/;
/** A field that names a bank balance, an account or a counterparty. Never on a link. */
const BANK_KEY = /(^|_)(bank|balance|balances|account|accounts|iban|routing|counterparty|counterparties)(_|$)/;
/** A scorecard or product-market fit band: only when the link includes bands. */
const BAND_PREFIX = /^(scorecard|pmf|band)_/;
const BAND_SUFFIX = /_band$/;
const isBandKey = (key: string) => BAND_PREFIX.test(key) || BAND_SUFFIX.test(key);

/** The stored `include_json`, or the default for a link that has none or one that cannot be read. */
export function parseShareInclude(raw: unknown): ShareInclude {
  if (raw == null || raw === '') return { ...DEFAULT_SHARE_INCLUDE };
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return { ...DEFAULT_SHARE_INCLUDE }; }
  }
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SHARE_INCLUDE };
  for (const k of SHARE_INCLUDE_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

/**
 * The writer's check of a body's `include`: an object of the six booleans,
 * any of them left out taking the default. Null when it is not one, so the
 * writer can refuse it.
 */
export function shareIncludeFromBody(v: unknown): ShareInclude | null {
  if (v === undefined) return { ...DEFAULT_SHARE_INCLUDE };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(SHARE_INCLUDE_KEYS as readonly string[]).includes(k) || typeof o[k] !== 'boolean') return null;
  }
  return parseShareInclude(o);
}

/** The slot a D896 binding names (`area.slot`), lower-cased; '' with none. */
function boundSlot(b: any): string {
  const k = b && typeof b === 'object' && typeof b.source_key === 'string' ? b.source_key.toLowerCase() : '';
  return k.includes('.') ? k.slice(k.indexOf('.') + 1) : '';
}

/** What a link may say of a binding: its grade and its date. Its record and snapshot are the venture's. */
function shareBinding(b: any): { grade: string | null; as_of: string | null } | undefined {
  if (!b || typeof b !== 'object') return undefined;
  return { grade: typeof b.grade === 'string' ? b.grade : null, as_of: typeof b.as_of === 'string' ? b.as_of : null };
}

function fieldKept(f: any, inc: ShareInclude): boolean {
  if (!f || typeof f !== 'object') return false;
  // A field is judged by its own key and by the slot it is bound to (D896).
  for (const key of [String(f.key || '').toLowerCase(), boundSlot(f.binding)]) {
    if (!key) continue;
    if (INTERNAL_SCORE_KEY.test(key) || BANK_KEY.test(key)) return false;
    if (isBandKey(key) && !inc.bands) return false;
  }
  if (f.kind === 'quote' && f.consent !== true) return false;
  if (f.kind === 'metric_grid' && !inc.figures) return false;
  return true;
}

/** A field, a slide or a block as a link sends it: its binding cut to grade and date. */
function withSharedBinding<T extends Record<string, any>>(x: T): T {
  if (!x || typeof x !== 'object' || !('binding' in x)) return x;
  const out: any = { ...x };
  const b = shareBinding(x.binding);
  if (b) out.binding = b; else delete out.binding;
  return out;
}

/** One version's cards as a link may send them. `gates` are the venture's recorded consents and permissions (`shareGatesFor`); none by default. */
export function shareSlides(slides: unknown, include: ShareInclude, gates: ShareGates = NO_GATES): any[] {
  if (!Array.isArray(slides)) return [];
  return slides
    .filter((s) => s && typeof s === 'object' && (include.sources || !(s as any).appendix))
    .map((s: any) => {
      const out: any = withSharedBinding({ ...s });
      if (!include.notes) delete out.notes;
      if (Array.isArray(s.fields)) {
        out.fields = s.fields.filter((f: any) => fieldKept(f, include)).map((f: any) => {
          const g = withSharedBinding(f);
          if (include.notes || !('notes' in g)) return g;
          const { notes: _n, ...rest } = g;
          return rest;
        });
      }
      if (Array.isArray(s.blocks)) {
        out.blocks = s.blocks.flatMap((b: any) => {
          const kept = blockKept(b, include, gates);
          if (!kept) return [];
          // The references a gate checked are the venture's: the viewer gets the block, not its session or logo key.
          const { session_uid: _s, logo_key: _l, ...sent } = kept;
          return [withSharedBinding(sent)];
        });
      }
      return out;
    });
}

// ---------------------------------------------------------------------------
// D1507: the Grid's blocks
// ---------------------------------------------------------------------------

export type ShareGate = 'none' | 'figures' | 'notes' | 'team_photos' | 'cap_table' | 'consent' | 'permission';

/** What the Worker read of the venture's records at share time. */
export type ShareGates = { quote_sessions: ReadonlySet<string>; logo_permissions: ReadonlySet<string> };
export const NO_GATES: ShareGates = Object.freeze({ quote_sessions: new Set<string>(), logo_permissions: new Set<string>() });

/**
 * Each element of `elementModels.ELEMENTS` (the one catalogue, #3754) and its
 * gate. The test fails on an element with no row here.
 */
export const ELEMENT_GATES: Readonly<Record<string, ShareGate>> = Object.freeze({
  // text
  title: 'none', kicker: 'none', body: 'none', bullets: 'none', callout: 'none', caption: 'none',
  quote_founder: 'none', team_bios: 'team_photos', speaker_notes: 'notes',
  // images
  photo: 'none', illustration: 'none', upload: 'none', brand_assets: 'none', edit_vary: 'none', remove_bg: 'none', upscale: 'none',
  // graphics
  icons: 'none', shapes: 'none', textures: 'none', logo_wall: 'permission',
  // data
  chart: 'figures', metric: 'figures', table: 'figures', typed_table: 'figures', market_size: 'figures', projections: 'figures',
  market_chart: 'figures', projection_chart: 'figures', timeline: 'none', competition: 'none', positioning: 'none',
  // diagrams
  flow: 'none', cycle: 'none', matrix: 'none', funnel: 'none', hierarchy: 'none', hub: 'none',
  // venture
  team_grid: 'team_photos', use_of_funds: 'figures', round_terms: 'figures', interview_quote: 'consent', cap_table: 'cap_table',
  // media
  video: 'none', audio: 'none', link: 'none', recorded_video: 'none', button: 'none', embeds: 'none',
});

/** A block that names no element is judged by its kind (`slideModel.BLOCK_KINDS`). The test fails on a kind with no row here. */
export const BLOCK_KIND_GATES: Readonly<Record<string, ShareGate>> = Object.freeze({
  text: 'none', chart: 'figures', graphic: 'none', image: 'none', video: 'none', audio: 'none', link: 'none', metric: 'figures', table: 'figures',
});

/** A connected CRM's source keys (`hubspot.*`, #3880): a logo from one needs the customer's permission. */
const CRM_SOURCE = /^hubspot\./;
/** A cap table's total row: its first cell reads "Total" or "Totals". */
const TOTAL_ROW = /^\s*totals?\b/i;

/** Every slot a block is bound to: its own binding, each chart series' and each table cell's. */
function blockSlots(b: any): string[] {
  const out = [boundSlot(b?.binding)];
  for (const sr of Array.isArray(b?.series) ? b.series : []) out.push(boundSlot(sr?.binding));
  for (const row of Array.isArray(b?.rows) ? b.rows : []) for (const cell of Array.isArray(row) ? row : []) out.push(boundSlot(cell?.binding));
  return out.filter(Boolean);
}

const cellText = (cell: any): string => (cell && typeof cell === 'object' ? String(cell.text ?? cell.value ?? '') : String(cell ?? ''));

/** The gate a block is judged by: its element's, else its kind's; null when neither is known. */
export function gateOf(b: any): ShareGate | null {
  if (b && typeof b.element === 'string') return Object.prototype.hasOwnProperty.call(ELEMENT_GATES, b.element) ? ELEMENT_GATES[b.element] : null;
  const kind = b && typeof b.kind === 'string' ? b.kind : '';
  return Object.prototype.hasOwnProperty.call(BLOCK_KIND_GATES, kind) ? BLOCK_KIND_GATES[kind] : null;
}

/**
 * One block as a link may send it, or null when the link leaves it out. A
 * cap table comes back cut to its header and total rows.
 */
export function blockKept(b: any, include: ShareInclude, gates: ShareGates = NO_GATES): any | null {
  if (!b || typeof b !== 'object') return null;
  for (const slot of blockSlots(b)) {
    if (INTERNAL_SCORE_KEY.test(slot) || BANK_KEY.test(slot)) return null;
    if (isBandKey(slot) && !include.bands) return null;
  }
  const crmLogo = CRM_SOURCE.test(String(b?.binding?.source_key ?? '').toLowerCase()) && (b.kind === 'image' || b.kind === 'graphic');
  const gate: ShareGate | null = crmLogo ? 'permission' : gateOf(b);
  switch (gate) {
    case 'none': return b;
    case 'figures': return include.figures ? b : null;
    case 'notes': return include.notes ? b : null;
    case 'team_photos': return include.team_photos ? b : null;
    case 'consent': return typeof b.session_uid === 'string' && gates.quote_sessions.has(b.session_uid) ? b : null;
    case 'permission': return typeof b.logo_key === 'string' && gates.logo_permissions.has(b.logo_key) ? b : null;
    case 'cap_table': {
      if (!include.cap_table) return null;
      if (b.kind === 'metric') return b;
      if (b.kind !== 'table' || !Array.isArray(b.rows)) return null;
      const rows = b.rows.filter((row: any, i: number) => (b.header !== false && i === 0) || (Array.isArray(row) && TOTAL_ROW.test(cellText(row[0]))));
      const totals = rows.length - (b.header !== false ? 1 : 0);
      return totals > 0 ? { ...b, rows } : null;
    }
    default: return null;
  }
}

/**
 * The venture's recorded consents and permissions, read at share time. A
 * quote's session counts when it recorded consent and its interview agreed to
 * be quoted (the same rule as `quoteRetrieval.quotableLines`). Logo
 * permissions have no store yet (#3781), so the set is empty.
 */
export async function shareGatesFor(env: Pick<Env, 'DB'>, projectId: number): Promise<ShareGates> {
  let quote_sessions = new Set<string>();
  try {
    const rows = await env.DB.prepare(
      `SELECT s.uid FROM interview_sessions s JOIN discovery_interviews i ON i.id = s.interview_id
        WHERE s.project_id = ? AND i.project_id = s.project_id
          AND s.consent_status = 'given' AND s.consent_at IS NOT NULL AND i.quote_consent = 1
        LIMIT 1000`,
    ).bind(projectId).all<{ uid: string }>();
    quote_sessions = new Set((rows.results || []).map((r) => String(r.uid)));
  } catch { /* no interview tables here: no quote is consented */ }
  return { quote_sessions, logo_permissions: new Set<string>() };
}

/** The Spin-Out fields baked onto a shared deck, with the same two "never" rules. */
export function shareSpinoutFields(fields: Record<string, string> | null): Record<string, string> | null {
  if (!fields) return fields;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.toLowerCase();
    if (!INTERNAL_SCORE_KEY.test(key) && !BANK_KEY.test(key)) out[k] = v;
  }
  return out;
}
