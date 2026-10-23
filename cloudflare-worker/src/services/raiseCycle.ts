/**
 * D663 — the Raise cycle's reads: four figures, seven cards, seven record
 * tables. Mounted by `routes/cycle_raise.ts` at `/api/cycles/raise`.
 *
 * THE SHAPES ARE D656's AND D661's. `Card`, `Figure` and the five states come
 * from `services/cycleCards.ts`. A card's `series` is D661's list of chart
 * specs, and a module's records are D661's `{ cols: [{key, label}], rows:
 * [{id, cells}] }` with their `filters`, `sorts` and `add`.
 *
 * EVERY CARD READS ITS OWN STORES AND FAILS ON ITS OWN. A throw reaches
 * `safeCard`, which makes that card `unreadable` and leaves the other six.
 *
 * NOTHING HERE IS GUESSED. A value no store holds is `null` ("Not recorded"),
 * never 0. A prospect's last contact is its stored contact's
 * `last_activity_at`; a prospect with no contact has none. A category's
 * monthly spend is not recorded, because no store splits burn by category.
 *
 * THE SPIN-OUT LAB READS THROUGH THE SAME FUNCTIONS. A Lab venture is an
 * ordinary `projects` row. The computed readiness detectors below are the
 * Lab capital page's data-room readiness rules, moved here and stored, so a
 * Lab venture and a founder see the same scores.
 *
 * A RECEIVED WIRE (D752 §5, decision 12). Capital relationships' stage cell
 * reads a stored raise receipt's posted date only (`receivedDates`), never a
 * Mercury connection, a last four, a counterparty or a bank figure.
 */
import type { Env } from '../types';
import { safeCard, safeFigure, countState, PAGE_SIZE, type Card, type Figure } from './cycleCards';
import { daysBefore, recordQuery, type RecordQuery } from './cycleValidate';
import { roundCallsEnabled } from './roundCallPolicy';
import { peerBenchmark, type PeerBenchmark } from './peerBenchmark';
import { SERVED_FUNDS } from './researchFundDirectory';
import { focusTokens, mapCompanySector, mapFundFocus, normalizeLabel } from './researchTaxonomy';

export { recordQuery };
export type { RecordQuery };

export const CYCLE = 'raise';
export const QUESTION = 'What resources does this venture need?';

/** D691 (#1699): each module's list is titled as the canvas titles it (CO:623-629). */
export const MODULES = [
  { slug: 'fundraising-readiness', name: 'Fundraising readiness', records_title: 'Readiness items' },
  { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' },
  { slug: 'pitch-deck', name: 'Pitch deck', records_title: 'Investor links' },
  { slug: 'data-room', name: 'Data room', records_title: 'Files' },
  { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' },
  { slug: 'use-of-funds', name: 'Use of funds', records_title: 'Categories' },
  { slug: 'capital-relationships', name: 'Capital relationships', records_title: 'Investors' },
] as const;
export type ModuleSlug = (typeof MODULES)[number]['slug'];

export type Ctx = { env: Env; projectId: number; today: string };

const href = (ctx: Ctx, slug: string) => `/raise/${slug}?project=${ctx.projectId}`;
/**
 * D695 (#1657) decision 11: a module's Add form, which its empty card and its
 * records' Add both open (D688: a card and its module page's Add go to one place).
 */
const addHref = (ctx: Ctx, slug: string) => `/raise/${slug}/new?project=${ctx.projectId}`;
/**
 * The full tools the module pages summarise; the pages link to them.
 * `dataRoom` is the file tool (`DataRoomPage`), which holds upload, grants and
 * the NDA switch; the bare `/raise/data-room` becomes D696's module page.
 */
export const TOOL_HREF = {
  pitch: '/raise/pitch',
  dataRoom: '/raise/data-room?mode=workspace',
  capTable: '/raise/capital/cap-table',
  pipeline: '/raise/capital/pipeline',
  model: '/raise/capital/model',
  metrics: '/build/kpi',
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const day = (v: unknown): string | null => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ---------------------------------------------------------------------------
// Fundraising readiness
// ---------------------------------------------------------------------------

/** The readiness items, in the order the card draws them. */
export const READINESS_ITEMS = [
  { key: 'narrative', label: 'Investor narrative' },
  { key: 'deck', label: 'Pitch deck' },
  { key: 'data_room', label: 'Data room' },
  { key: 'cap_table', label: 'Cap table' },
  { key: 'use_of_funds', label: 'Use of funds' },
  { key: 'traction', label: 'Traction proof' },
  { key: 'team', label: 'Team' },
] as const;
export type ReadinessKey = (typeof READINESS_ITEMS)[number]['key'];
export const READINESS_KEYS: readonly string[] = READINESS_ITEMS.map((i) => i.key);
export const EVIDENCE = ['anecdote', 'pattern', 'measured'] as const;
const EVIDENCE_TONE: Record<string, string> = { measured: 'v1', pattern: 'v2', anecdote: 'v3' };

export type ScoreRow = { item_id: number; item_key: string; score: number; evidence: string; missing: string | null; source: string; scored_at: string };
export type ItemRow = { id: number; item_key: string; label: string; position: number };

export async function loadReadiness(ctx: Ctx): Promise<{ items: ItemRow[]; scores: ScoreRow[] }> {
  const items = await ctx.env.DB.prepare(
    `SELECT id, item_key, label, position FROM readiness_items WHERE project_id = ? ORDER BY position, id`,
  ).bind(ctx.projectId).all<ItemRow>();
  const scores = await ctx.env.DB.prepare(
    `SELECT s.item_id, i.item_key, s.score, s.evidence, s.missing, s.source, s.scored_at
       FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id
      WHERE s.project_id = ? ORDER BY s.scored_at, s.id`,
  ).bind(ctx.projectId).all<ScoreRow>();
  return { items: items.results || [], scores: (scores.results || []).filter(s => READINESS_KEYS.includes(s.item_key) && (s.item_key === 'team' || s.source === 'computed') && !(s.source === 'manual' && s.evidence === 'measured')) };
}

/** The newest score each item has, as of the end of `asOf` (or now). */
export function latestScores(scores: ScoreRow[], asOf?: string): Map<number, ScoreRow> {
  const out = new Map<number, ScoreRow>();
  for (const s of scores) {
    if (asOf && String(s.scored_at).slice(0, 10) > asOf) continue;
    out.set(Number(s.item_id), s); // scores arrive oldest first, so the last wins
  }
  return out;
}

/** The overall score out of 100: the mean of each scored item's newest score. Null with none. */
export function overallReadiness(latest: Iterable<{ score: number }>): number | null {
  const xs = [...latest].map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10);
}

/** The overall score at the end of each day a score was given, oldest first. */
export function readinessHistory(scores: ScoreRow[]): Array<{ day: string; score: number }> {
  const days = [...new Set(scores.map((s) => String(s.scored_at).slice(0, 10)))].sort();
  const out: Array<{ day: string; score: number }> = [];
  for (const d of days) {
    const v = overallReadiness(latestScores(scores, d).values());
    if (v != null) out.push({ day: d, score: v });
  }
  return out;
}

/** One input a computed check read: what it counted, and whether that input is met (D691 decision 8). */
export type ReadRow = { a: string; b: string; c: 'Counted' | 'Partial' | 'Missing'; tone: 'ok' | 'amb' | 'bad' };
export type ComputedScore = { key: ReadinessKey; score: number; evidence: 'measured'; missing: string | null; reads: ReadRow[] };
const met = (ok: boolean, partial = false): Pick<ReadRow, 'c' | 'tone'> => (ok ? { c: 'Counted', tone: 'ok' } : partial ? { c: 'Partial', tone: 'amb' } : { c: 'Missing', tone: 'bad' });

/**
 * The computed readiness checks — the Lab capital page's data-room readiness
 * rules (`SpinoutLabCapitalPage.jsx` `buildDataroom`), now stored. Each reads
 * one store; `team` has no store to read and is scored by a person.
 */
export async function computeReadiness(env: Env, projectId: number): Promise<ComputedScore[]> {
  const p = await env.DB.prepare(
    `SELECT use_of_funds, funding_needed, mrr, paying_customers, revenue FROM projects WHERE id = ?`,
  ).bind(projectId).first<{ use_of_funds: string | null; funding_needed: number | null; mrr: number | null; paying_customers: number | null; revenue: number | null }>();
  const decks = await env.DB.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ?').bind(projectId).first<{ n: number }>();
  const scen = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0',
  ).bind(projectId).first<{ n: number }>();
  const mapped = await env.DB.prepare(
    `SELECT DISTINCT checklist_item FROM data_room_files WHERE project_id = ? AND checklist_item IS NOT NULL`,
  ).bind(projectId).all<{ checklist_item: string }>();
  const latestVersion = await env.DB.prepare(
    `SELECT MAX(version) AS v FROM spinout_deck_overrides WHERE project_id = ? AND version > 0`,
  ).bind(projectId).first<{ v: number | null }>();
  const staged = await env.DB.prepare(
    'SELECT COUNT(*) AS files, COUNT(DISTINCT folder_id) AS folders FROM data_room_files WHERE project_id = ?',
  ).bind(projectId).first<{ files: number; folders: number }>();

  // Each check says what it read beside its score (decision 8); no score changes.
  const out: ComputedScore[] = [];
  const deckCount = Number(decks?.n ?? 0);
  const hasDeck = deckCount > 0;
  out.push({
    key: 'deck', score: hasDeck ? 10 : 0, evidence: 'measured', missing: hasDeck ? null : 'Build the pitch deck.',
    reads: [{ a: 'Pitch decks', b: hasDeck ? plural(deckCount, 'deck saved', 'decks saved') : 'none saved', ...met(hasDeck) }],
  });

  const hasAlloc = String(p?.use_of_funds ?? '').trim().startsWith('[');
  const hasTarget = (num(p?.funding_needed) ?? 0) > 0;
  out.push({
    key: 'use_of_funds', score: hasAlloc && hasTarget ? 10 : hasAlloc || hasTarget ? 5 : 0, evidence: 'measured',
    missing: hasAlloc && hasTarget ? null : 'Set a raise target and a 100% allocation.',
    reads: [
      { a: 'Raise target', b: hasTarget ? usd(Number(p!.funding_needed)) : 'not set', ...met(hasTarget) },
      { a: 'Allocation', b: hasAlloc ? 'split stored' : 'no split stored', ...met(hasAlloc) },
    ],
  });

  const scenarios = Number(scen?.n ?? 0);
  const hasCap = scenarios > 0;
  out.push({
    key: 'cap_table', score: hasCap ? 10 : 0, evidence: 'measured', missing: hasCap ? null : 'Set up the cap table.',
    reads: [{ a: 'Cap table', b: hasCap ? 'a base scenario is saved' : 'no scenario saved', ...met(hasCap) }],
  });

  const fieldOf = (v: unknown) => (num(v) ?? 0) > 0;
  const traction = fieldOf(p?.revenue) || fieldOf(p?.mrr) || fieldOf(p?.paying_customers);
  out.push({
    key: 'traction', score: traction ? 10 : 0, evidence: 'measured', missing: traction ? null : 'Log revenue or update your proof fields.',
    reads: [
      { a: 'Revenue', b: fieldOf(p?.revenue) ? usd(Number(p!.revenue)) : 'not recorded', ...met(fieldOf(p?.revenue), traction) },
      { a: 'MRR', b: fieldOf(p?.mrr) ? usd(Number(p!.mrr)) : 'not recorded', ...met(fieldOf(p?.mrr), traction) },
      { a: 'Paying customers', b: fieldOf(p?.paying_customers) ? String(Math.round(Number(p!.paying_customers))) : 'not recorded', ...met(fieldOf(p?.paying_customers), traction) },
    ],
  });

  const known = new Set((mapped.results || []).map((r) => r.checklist_item).filter((k) => CHECKLIST_KEYS.has(k)));
  const open = DILIGENCE_CHECKLIST.length - known.size;
  const files = Number(staged?.files ?? 0);
  out.push({
    key: 'data_room', score: Math.round((known.size / DILIGENCE_CHECKLIST.length) * 10), evidence: 'measured',
    missing: open === 0 ? null : `${plural(open, 'checklist item has', 'checklist items have')} no file.`,
    reads: [
      { a: 'Files staged', b: files ? `${files} in ${plural(Number(staged?.folders ?? 0), 'folder', 'folders')}` : 'none uploaded', ...met(files > 0) },
      { a: 'Diligence checklist covered', b: `${known.size} of ${DILIGENCE_CHECKLIST.length} items`, ...met(open === 0, known.size > 0) },
    ],
  });

  const v = num(latestVersion?.v);
  if (v == null) {
    out.push({
      key: 'narrative', score: 0, evidence: 'measured', missing: 'Save an investor narrative version.',
      reads: [{ a: 'Narrative versions', b: 'none saved', ...met(false) }],
    });
  } else {
    const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ? AND version = ?')
      .bind(projectId, v).first<{ n: number }>();
    const mismatches = Number(m?.n ?? 0);
    out.push({
      key: 'narrative', score: Math.max(0, 10 - 2 * mismatches), evidence: 'measured',
      missing: mismatches === 0 ? null : `${plural(mismatches, 'figure differs', 'figures differ')} from the stored metrics.`,
      reads: [
        { a: 'Newest version', b: `v${v}`, ...met(true) },
        { a: 'Consistency check', b: mismatches ? plural(mismatches, 'mismatch', 'mismatches') : 'no mismatch', ...met(mismatches === 0, true) },
      ],
    });
  }
  return out;
}

/**
 * The newest write to the stores each computed check reads (D691 decision 8),
 * one fixed statement per item. `null` marks a check that reads `projects`
 * fields, which keep no write time, so it always re-scores.
 */
const LATEST_WRITE: Record<Exclude<ReadinessKey, 'team'>, string | null> = {
  deck: 'SELECT MAX(created_at) AS at FROM pitch_decks WHERE project_id = ?',
  use_of_funds: null,
  cap_table: 'SELECT MAX(updated_at) AS at FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0',
  traction: null,
  data_room: 'SELECT MAX(updated_at) AS at FROM data_room_files WHERE project_id = ?',
  narrative: `SELECT MAX(at) AS at FROM (
      SELECT MAX(updated_at) AS at FROM spinout_deck_overrides WHERE project_id = ? AND version > 0
      UNION ALL SELECT MAX(checked_at) FROM narrative_checks WHERE project_id = ?
      UNION ALL SELECT MAX(updated_at) FROM narrative_version_meta WHERE project_id = ?)`,
};

/**
 * `since: 'last'`: whether a computed item needs a new score. It does when it
 * has none, when a store its check reads has a row written after its newest
 * score, when its check reads `projects` fields, or when the check now finds
 * something other than that score (a deleted row leaves no newer write).
 */
export async function changedSinceScored(
  env: Env, projectId: number, c: ComputedScore, newest: { score: number; missing: string | null; scored_at: string } | undefined,
): Promise<boolean> {
  if (!newest) return true;
  if (Number(newest.score) !== c.score || (newest.missing ?? null) !== c.missing) return true;
  const sql = LATEST_WRITE[c.key as Exclude<ReadinessKey, 'team'>];
  if (sql == null) return true;
  // Each statement names the venture once per store it reads.
  const binds = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => projectId);
  const row = await env.DB.prepare(sql).bind(...binds).first<{ at: string | null }>();
  return !!row?.at && String(row.at) > String(newest.scored_at);
}

export async function readinessCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('fundraising-readiness', 'All time', 'Each readiness item by its score out of 10, shaded by evidence; the overall score over time.', 'Readiness scores'), async (): Promise<CardBody> => {
    const { items, scores } = await loadReadiness(ctx);
    if (items.length === 0) {
      return {
        state: 'empty', series: null,
        next: { text: 'Score readiness', href: `${href(ctx, 'fundraising-readiness')}&add=1` },
        reason: 'No readiness score yet. Readiness by evidence appears here.',
      };
    }
    const latest = latestScores(scores);
    const history = readinessHistory(scores);
    const series: unknown[] = [{
      kind: 'hbar',
      items: items.map((i) => {
        const s = latest.get(Number(i.id));
        return { label: i.label, value: s ? Number(s.score) : null, tone: s ? EVIDENCE_TONE[s.evidence] ?? 'grey' : 'grey' };
      }),
      legend: [{ label: 'Measured', tone: 'v1' }, { label: 'Pattern', tone: 'v2' }, { label: 'Anecdote', tone: 'v3' }],
    }];
    if (history.length > 0) {
      series.push({
        kind: 'line', values: history.map((h) => h.score), target: 100, target_label: 'ready · 100',
        labels: [{ at: 0, label: history[0].day }, { at: history.length - 1, label: history[history.length - 1].day }],
      });
    }
    series.push(await benchmarkSpec(ctx));
    const unscored = items.filter((i) => !latest.has(Number(i.id)));
    const gap = items.map((i) => latest.get(Number(i.id))).find((s) => s && s.missing);
    const next = gap
      ? { text: String(gap.missing), href: href(ctx, 'fundraising-readiness') }
      : unscored.length > 0
        ? { text: `Score ${plural(unscored.length, 'item', 'items')} no check can measure`, href: href(ctx, 'fundraising-readiness') }
        : null;
    return { state: countState(latest.size), series, next, reason: null };
  });
}

/**
 * The peer benchmark beside the founder's own venture score, as a rows spec
 * (#1524). Its own failure is said in its own row: the readiness card does
 * not become unreadable because the benchmark could not be read.
 */
export function benchmarkRows(b: PeerBenchmark): Array<{ label: string; value: string | number | null; tone?: string }> {
  const own = { label: 'Your Lab score', value: b.own_score };
  if (b.state === 'ok' && b.group) {
    return [
      own,
      { label: `Peer median · ${b.group.size} ${b.group.label}`, value: b.p50 },
      { label: 'Middle half of peers', value: `${b.p25}–${b.p75}` },
      { label: 'Your percentile', value: `${b.percentile}th`, tone: 'v1' },
    ];
  }
  return [own, { label: 'Peer benchmark', value: b.reason, tone: 'muted' }];
}

async function benchmarkSpec(ctx: Ctx): Promise<unknown> {
  try {
    return { kind: 'rows', items: benchmarkRows(await peerBenchmark(ctx.env, ctx.projectId)) };
  } catch (e) {
    console.warn('[raiseCycle] peer benchmark unreadable:', (e as Error)?.message);
    return { kind: 'rows', items: [{ label: 'Peer benchmark', value: 'The peer benchmark could not be read.', tone: 'bad' }] };
  }
}

const READINESS_STATES = [{ value: 'scored', label: 'Scored' }, { value: 'gap', label: 'Has a gap' }, { value: 'not_scored', label: 'Not scored' }];

async function readinessRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const { items, scores } = await loadReadiness(ctx);
  const latest = latestScores(scores);
  let rows = items.map((i) => ({ i, s: latest.get(Number(i.id)) ?? null })).filter(({ i }) => has(rq.q, i.label));
  const state = rq.filter.state;
  if (state === 'scored') rows = rows.filter(({ s }) => s != null);
  else if (state === 'gap') rows = rows.filter(({ s }) => s != null && String(s.missing ?? '').trim() !== '');
  else if (state === 'not_scored') rows = rows.filter(({ s }) => s == null);
  // Score, highest first, is the default; an item no one scored comes last.
  if (rq.sort !== 'order') rows.sort((a, b) => (b.s?.score ?? -1) - (a.s?.score ?? -1));
  return paged(
    [col('item', 'Item'), col('score', 'Score'), col('evidence', 'Evidence'), col('missing', 'Missing'), col('updated', 'Updated')],
    rows.map(({ i, s }) => ({
      // D691 decision 3: the item's key, the same in every list, record and write.
      id: READINESS_KEYS.includes(i.item_key) ? i.item_key : null,
      cells: {
        item: i.label, score: s ? Number(s.score) : null, evidence: s?.evidence ?? null,
        missing: s ? s.missing ?? '' : null, updated: s ? day(s.scored_at) : null,
      },
    })),
    rq.page,
    {
      filters: [{ key: 'state', label: 'State', options: READINESS_STATES }],
      sorts: [{ key: 'score', label: 'Score' }, { key: 'order', label: 'Order' }],
    },
  );
}

// ---------------------------------------------------------------------------
// Investor narrative — versions and the consistency check
// ---------------------------------------------------------------------------

export const INVESTOR_TYPES = ['angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other'] as const;
export const INVESTOR_TYPE_LABEL: Record<string, string> = {
  angel: 'Angel', pre_seed_fund: 'Pre-seed fund', seed_fund: 'Seed fund', series_a_fund: 'Series A fund',
  strategic: 'Strategic', grant: 'Grant', other: 'Other',
};
/** The marker row every saved version carries, so a version with no override still exists. */
export const VERSION_MARKER_KEY = '_version';

export const FIGURES = ['mrr', 'paying_customers', 'raise'] as const;
export type FigureKey = (typeof FIGURES)[number];
export const FIGURE_LABEL: Record<FigureKey, string> = { mrr: 'MRR', paying_customers: 'Paying customers', raise: 'The raise' };

export type Stated = { figure: FigureKey; value: number; source: string };
export type Mismatch = { figure: FigureKey; stated_value: number; stated_source: string; metric_value: number; metric_source: string };

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const amount = (digits: string, scale?: string) => {
  const n = Number(digits.replace(/,/g, ''));
  return Number.isFinite(n) ? n * (scale ? SCALE[scale.toLowerCase()] ?? 1 : 1) : NaN;
};

/**
 * The figures a piece of narrative wording states, read by fixed patterns —
 * never by a model. Only a figure stated in a recognisable form is read; a
 * sentence with no figure states none.
 */
export function parseStatedFigures(fieldKey: string, text: string): Stated[] {
  const out: Stated[] = [];
  const src = `Narrative · ${fieldKey}`;
  const t = String(text ?? '');
  const MONEY = String.raw`\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\b`;
  const mrr = new RegExp(`${MONEY}\\s*(?:in\\s+)?(?:MRR|monthly recurring revenue)`, 'i').exec(t)
    || new RegExp(`(?:MRR|monthly recurring revenue)\\s*(?:of|is|at|:|=)?\\s*${MONEY}`, 'i').exec(t);
  if (mrr) { const v = amount(mrr[1], mrr[2]); if (Number.isFinite(v)) out.push({ figure: 'mrr', value: v, source: src }); }
  const cust = /(\d[\d,]*)\s+paying\s+(?:customers|accounts)/i.exec(t);
  if (cust) { const v = amount(cust[1]); if (Number.isFinite(v)) out.push({ figure: 'paying_customers', value: v, source: src }); }
  const raise = new RegExp(`rais(?:e|ing)\\s+(?:a\\s+|an\\s+|our\\s+)?${MONEY}`, 'i').exec(t);
  if (raise) { const v = amount(raise[1], raise[2]); if (Number.isFinite(v)) out.push({ figure: 'raise', value: v, source: src }); }
  return out;
}

/** Two figures agree within 2% (or within 1 for small counts). */
export function agrees(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Every stated figure that differs from the stored metric for the same
 * figure. Each mismatch carries both values and both sources; a figure with
 * no stored metric is not a mismatch, because there is nothing to compare.
 */
export function consistencyCheck(stated: Stated[], metrics: Partial<Record<FigureKey, { value: number; source: string }>>): Mismatch[] {
  const out: Mismatch[] = [];
  for (const s of stated) {
    const m = metrics[s.figure];
    if (!m || !Number.isFinite(m.value) || !Number.isFinite(s.value)) continue;
    if (agrees(s.value, m.value)) continue;
    out.push({ figure: s.figure, stated_value: s.value, stated_source: s.source, metric_value: m.value, metric_source: m.source });
  }
  return out;
}

/** What the deck and a narrative version state, and what the stores hold, for one project. */
export async function checkInputs(env: Env, projectId: number, version: number) {
  const p = await env.DB.prepare('SELECT mrr, paying_customers, funding_needed FROM projects WHERE id = ?')
    .bind(projectId).first<{ mrr: number | null; paying_customers: number | null; funding_needed: number | null }>();
  const stated: Stated[] = [];
  // The deck's own traction and ask slides read these three fields.
  if ((num(p?.mrr) ?? 0) > 0) stated.push({ figure: 'mrr', value: Number(p!.mrr), source: 'Deck · projects.mrr' });
  if ((num(p?.paying_customers) ?? 0) > 0) stated.push({ figure: 'paying_customers', value: Number(p!.paying_customers), source: 'Deck · projects.paying_customers' });
  if ((num(p?.funding_needed) ?? 0) > 0) stated.push({ figure: 'raise', value: Number(p!.funding_needed), source: 'Deck · projects.funding_needed' });
  const words = await env.DB.prepare(
    'SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key != ? ORDER BY field_key',
  ).bind(projectId, version, VERSION_MARKER_KEY).all<{ field_key: string; value: string }>();
  for (const w of words.results || []) stated.push(...parseStatedFigures(w.field_key, w.value));
  // Why now has no deck key: it lives in the version's meta (D691 decision 7).
  const meta = await env.DB.prepare('SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?')
    .bind(projectId, version).first<{ why_now: string | null }>();
  if (meta?.why_now) stated.push(...parseStatedFigures('why_now', meta.why_now));

  const metrics: Partial<Record<FigureKey, { value: number; source: string }>> = {};
  const mrr = await env.DB.prepare(
    'SELECT mrr, snapshot_date FROM project_metrics WHERE project_id = ? AND mrr IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1',
  ).bind(projectId).first<{ mrr: number; snapshot_date: string }>();
  if (mrr) metrics.mrr = { value: Number(mrr.mrr), source: `Metrics · project_metrics.mrr on ${mrr.snapshot_date}` };
  const pay = await env.DB.prepare(
    'SELECT paying_accounts, snapshot_date FROM project_metrics WHERE project_id = ? AND paying_accounts IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1',
  ).bind(projectId).first<{ paying_accounts: number; snapshot_date: string }>();
  if (pay) metrics.paying_customers = { value: Number(pay.paying_accounts), source: `Metrics · project_metrics.paying_accounts on ${pay.snapshot_date}` };
  const round = await env.DB.prepare(
    `SELECT target_amount FROM raise_rounds WHERE project_id = ? AND status = 'active' AND target_amount IS NOT NULL LIMIT 1`,
  ).bind(projectId).first<{ target_amount: number }>();
  if (round) metrics.raise = { value: Number(round.target_amount), source: 'Pipeline · raise_rounds.target_amount (active round)' };
  return { stated, metrics };
}

export type VersionRow = { version: number; investor_type: string | null; deck_version: number | null; saved_at: string; mismatches: number };

export async function loadVersions(ctx: Ctx): Promise<VersionRow[]> {
  const res = await ctx.env.DB.prepare(
    `SELECT o.version, MAX(o.investor_type) AS investor_type, MAX(o.deck_version) AS deck_version, MAX(o.updated_at) AS saved_at,
            (SELECT COUNT(*) FROM narrative_checks c WHERE c.project_id = o.project_id AND c.version = o.version) AS mismatches
       FROM spinout_deck_overrides o
      WHERE o.project_id = ? AND o.version > 0
      GROUP BY o.version ORDER BY o.version DESC`,
  ).bind(ctx.projectId).all<VersionRow>();
  return res.results || [];
}

export const fmtFigure = (f: FigureKey, v: number) => (f === 'paying_customers' ? Math.round(v).toLocaleString('en-US') : usd(v));
/** One mismatch as a sentence that names both figures and both sources. */
export function mismatchSentence(m: Mismatch): string {
  return `${FIGURE_LABEL[m.figure]}: ${fmtFigure(m.figure, m.stated_value)} in ${m.stated_source}, ${fmtFigure(m.figure, m.metric_value)} in ${m.metric_source}`;
}

export async function narrativeCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('investor-narrative', 'All versions', 'Saved narrative versions by investor type, and what the consistency check found in the newest.', 'Narrative versions'), async (): Promise<CardBody> => {
    const versions = await loadVersions(ctx);
    if (versions.length === 0) {
      return { state: 'empty', series: null, next: { text: 'New version', href: `${href(ctx, 'investor-narrative')}&add=1` }, reason: 'No narrative saved yet. Each version appears here.' };
    }
    const byType = new Map<string, number>();
    for (const v of versions) {
      const k = v.investor_type ?? 'other';
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    const newest = versions[0];
    const checks = await ctx.env.DB.prepare(
      `SELECT figure, stated_value, stated_source, metric_value, metric_source FROM narrative_checks
        WHERE project_id = ? AND version = ? ORDER BY id`,
    ).bind(ctx.projectId, newest.version).all<Mismatch>();
    const found = checks.results || [];
    const series: unknown[] = [
      { kind: 'hbar', items: [...byType.entries()].map(([k, n]) => ({ label: INVESTOR_TYPE_LABEL[k] ?? k, value: n, tone: 'v1' })) },
      {
        kind: 'rows',
        items: [
          { label: `Newest · v${newest.version} · ${INVESTOR_TYPE_LABEL[newest.investor_type ?? 'other'] ?? 'Other'}`, value: day(newest.saved_at) },
          { label: 'Mismatches', value: found.length, tone: found.length ? 'warn' : 'ok' },
          ...found.map((m) => ({ label: FIGURE_LABEL[m.figure as FigureKey] ?? m.figure, value: mismatchSentence(m), tone: 'warn' })),
        ],
      },
    ];
    const next = found.length
      ? { text: `Reconcile ${plural(found.length, 'figure', 'figures')} the narrative states differently from the metrics`, href: href(ctx, 'investor-narrative') }
      : null;
    return { state: 'ok', series, next, reason: null };
  });
}

async function narrativeRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  let rows = (await loadVersions(ctx)).filter((v) => has(rq.q, INVESTOR_TYPE_LABEL[v.investor_type ?? 'other'], `v${v.version}`));
  if (rq.filter.investor_type) rows = rows.filter((v) => (v.investor_type ?? 'other') === rq.filter.investor_type);
  if (rq.sort === 'oldest') rows.reverse();
  return paged(
    [col('version', 'Version'), col('investor_type', 'Investor type'), col('deck', 'Used by deck'), col('mismatches', 'Mismatches'), col('date', 'Date')],
    rows.map((v) => ({
      id: v.version,
      cells: {
        version: `v${v.version}`, investor_type: INVESTOR_TYPE_LABEL[v.investor_type ?? 'other'] ?? null,
        deck: v.deck_version != null ? `v${v.deck_version}` : null,
        mismatches: { text: String(Number(v.mismatches)), tone: Number(v.mismatches) ? 'warn' : 'ok' },
        date: day(v.saved_at),
      },
    })),
    rq.page,
    {
      filters: [{ key: 'investor_type', label: 'Investor type', options: INVESTOR_TYPES.map((t) => ({ value: t, label: INVESTOR_TYPE_LABEL[t] })) }],
      sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }],
    },
  );
}

// ---------------------------------------------------------------------------
// Pitch deck — views and per-slide time
// ---------------------------------------------------------------------------

export { MAX_SLIDE_INDEX, capSlideSeconds, slideTotals, recordSlideSeconds } from './deckSlideDwell';

/** Views per week, oldest first, over the last `n` weeks. */
async function weeklyViews(ctx: Ctx, n: number): Promise<number[]> {
  const res = await ctx.env.DB.prepare(
    `SELECT CAST((julianday(?) - julianday(substr(v.created_at, 1, 10))) / 7 AS INTEGER) AS wk, COUNT(*) AS n
       FROM deck_share_views v JOIN pitch_decks d ON d.id = v.deck_id
      WHERE d.project_id = ? AND julianday(substr(v.created_at, 1, 10)) <= julianday(?)
        AND julianday(?) - julianday(substr(v.created_at, 1, 10)) < ? * 7
      GROUP BY wk`,
  ).bind(ctx.today, ctx.projectId, ctx.today, ctx.today, n).all<{ wk: number; n: number }>();
  const out = new Array(n).fill(0);
  for (const r of res.results || []) {
    const wk = Number(r.wk);
    if (wk >= 0 && wk < n) out[n - 1 - wk] = Number(r.n);
  }
  return out;
}

export async function pitchDeckCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('pitch-deck', 'Last 8 weeks', 'Share-link views per week, and the seconds investors spent on each slide.', 'Deck share views'), async (): Promise<CardBody> => {
    const deck = await ctx.env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? LIMIT 1').bind(ctx.projectId).first();
    if (!deck) return { state: 'empty', series: null, next: { text: 'Build your deck', href: TOOL_HREF.pitch }, reason: 'No deck yet. Views per week appear here.' };
    const total = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM deck_share_views v JOIN pitch_decks d ON d.id = v.deck_id WHERE d.project_id = ?',
    ).bind(ctx.projectId).first<{ n: number }>();
    if (Number(total?.n ?? 0) === 0) {
      return { state: 'empty', series: null, next: { text: 'Share the deck with an investor', href: addHref(ctx, 'pitch-deck') }, reason: 'No one has opened a deck link yet.' };
    }
    const weeks = await weeklyViews(ctx, 8);
    const slides = await ctx.env.DB.prepare(
      `SELECT s.slide_index, SUM(s.seconds) AS seconds
         FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id JOIN pitch_decks d ON d.id = v.deck_id
        WHERE d.project_id = ? GROUP BY s.slide_index ORDER BY s.slide_index`,
    ).bind(ctx.projectId).all<{ slide_index: number; seconds: number }>();
    const per = (slides.results || []).filter((r) => Number(r.seconds) > 0);
    const series: unknown[] = [{ kind: 'vbars', values: weeks, labels: [{ at: 0, label: '8 wk ago' }, { at: 7, label: 'This wk' }] }];
    series.push(per.length
      ? { kind: 'hbar', items: per.map((r) => ({ label: `Slide ${Number(r.slide_index) + 1}`, value: Number(r.seconds), tone: 'v2' })) }
      : { kind: 'rows', items: [{ label: 'Seconds per slide', value: null }] });
    return { state: 'ok', series, next: null, reason: null };
  });
}

/** A link made with "Never" stores this expiry: the column is NOT NULL (D691 decision 5). */
export const NEVER_EXPIRES = '9999-12-31 23:59:59';

async function pitchRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const res = await ctx.env.DB.prepare(
    `SELECT t.id, t.created_at, t.expires_at, t.revoked_at, t.view_count, t.last_viewed_at, t.investor_label,
            p.name AS prospect_name, p.firm AS prospect_firm,
            (SELECT COALESCE(SUM(v.read_seconds), 0) FROM deck_share_views v WHERE v.share_token_id = t.id) AS seconds,
            (SELECT s.slide_index FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
              WHERE v.share_token_id = t.id GROUP BY s.slide_index HAVING SUM(s.seconds) > 0
              ORDER BY SUM(s.seconds) DESC, s.slide_index LIMIT 1) AS top_slide
       FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
       LEFT JOIN raise_prospects p ON p.id = t.prospect_id AND p.project_id = d.project_id
      WHERE d.project_id = ? ORDER BY t.created_at DESC, t.id DESC`,
  ).bind(ctx.projectId).all<any>();
  // A link needs a deck: with none, the Add builds one first (D695 decision 11).
  const deck = await ctx.env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? LIMIT 1').bind(ctx.projectId).first();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const status = (t: any) => (t.revoked_at ? 'revoked' : String(t.expires_at) < now ? 'expired' : 'active');
  // The investor a link was made for: a prospect still of this venture, else the
  // name typed in. A link made before 463 recorded neither, so it is named by its day.
  const investor = (t: any) => [t.prospect_name, t.prospect_firm].filter(Boolean).join(' · ')
    || String(t.investor_label ?? '').trim() || `Link created ${day(t.created_at) ?? 'on an unrecorded day'}`;
  const expires = (t: any): Cell => {
    const st = status(t);
    if (st !== 'active') return { text: st === 'revoked' ? 'Revoked' : 'Expired', tone: 'muted' };
    return { text: String(t.expires_at).startsWith(NEVER_EXPIRES.slice(0, 10)) ? 'Never' : day(t.expires_at) ?? '', tone: 'ok' };
  };
  let rows = (res.results || []).filter((t) => has(rq.q, investor(t), day(t.created_at)));
  if (rq.filter.status) rows = rows.filter((t) => status(t) === rq.filter.status);
  if (rq.sort === 'views') rows.sort((a, b) => Number(b.view_count) - Number(a.view_count));
  else if (rq.sort !== 'newest') {
    // Last viewed, the default: the most recent open first, a link never opened last.
    rows.sort((a, b) => String(b.last_viewed_at ?? '').localeCompare(String(a.last_viewed_at ?? '')));
  }
  return paged(
    [col('link', 'Investor'), col('expires', 'Expires'), col('views', 'Views'), col('time', 'Time on deck'), col('most_read', 'Most read')],
    rows.map((t) => ({
      id: t.id,
      cells: {
        link: investor(t),
        expires: expires(t),
        views: Number(t.view_count) || 0,
        time: `${Math.round((Number(t.seconds) || 0) / 60)} min`,
        most_read: t.top_slide == null ? null : `Slide ${Number(t.top_slide) + 1}`,
      },
    })),
    rq.page,
    {
      filters: [{ key: 'status', label: 'State', options: [{ value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }, { value: 'revoked', label: 'Revoked' }] }],
      sorts: [{ key: 'last_viewed', label: 'Last viewed' }, { key: 'newest', label: 'Newest' }, { key: 'views', label: 'Most views' }],
      add: deck ? { text: 'New link', href: addHref(ctx, 'pitch-deck') } : { text: 'Build your deck', href: TOOL_HREF.pitch },
    },
  );
}

// ---------------------------------------------------------------------------
// Data room — the diligence checklist
// ---------------------------------------------------------------------------

/** The diligence checklist a data-room file can answer. Fixed; `data_room_files.checklist_item` holds a key. */
export const DILIGENCE_CHECKLIST = [
  { key: 'incorporation', area: 'Company', label: 'Certificate of incorporation' },
  { key: 'board_consents', area: 'Company', label: 'Bylaws and board consents' },
  { key: 'financial_statements', area: 'Financials', label: 'Financial statements' },
  { key: 'financial_model', area: 'Financials', label: 'Financial model' },
  { key: 'ip_assignment', area: 'Legal', label: 'IP assignment agreements' },
  { key: 'material_contracts', area: 'Legal', label: 'Material contracts' },
  { key: 'customer_contracts', area: 'Customers', label: 'Customer contracts and LOIs' },
  { key: 'sales_pipeline', area: 'Customers', label: 'Sales pipeline' },
  { key: 'employment', area: 'Team', label: 'Employment and contractor agreements' },
  { key: 'option_plan', area: 'Team', label: 'Option plan and grants' },
  { key: 'product_overview', area: 'Product', label: 'Product overview and roadmap' },
  { key: 'security', area: 'Product', label: 'Security and privacy' },
] as const;
export const CHECKLIST_KEYS: Set<string> = new Set(DILIGENCE_CHECKLIST.map((c) => c.key));
export const CHECKLIST_AREAS: string[] = [...new Set(DILIGENCE_CHECKLIST.map((c) => c.area))];
export const checklistLabel = (k: string | null) => DILIGENCE_CHECKLIST.find((c) => c.key === k)?.label ?? null;

/** Each area's share of its checklist items that at least one file answers. */
export function checklistCoverage(mapped: Iterable<string>): Array<{ area: string; pct: number }> {
  const have = new Set([...mapped].filter((k) => CHECKLIST_KEYS.has(k)));
  return CHECKLIST_AREAS.map((area) => {
    const items = DILIGENCE_CHECKLIST.filter((c) => c.area === area);
    return { area, pct: Math.round((items.filter((c) => have.has(c.key)).length / items.length) * 100) };
  });
}

export async function dataRoomCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('data-room', 'Last 90 days', 'How much of each diligence area the files answer, and who opened the room.', 'Data room'), async (): Promise<CardBody> => {
    const files = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM data_room_files WHERE project_id = ?',
    ).bind(ctx.projectId).first<{ n: number }>();
    if (Number(files?.n ?? 0) === 0) {
      return { state: 'empty', series: null, next: { text: 'Upload', href: addHref(ctx, 'data-room') }, reason: 'No files yet. Coverage of the diligence checklist appears here.' };
    }
    const mapped = await ctx.env.DB.prepare(
      'SELECT DISTINCT checklist_item FROM data_room_files WHERE project_id = ? AND checklist_item IS NOT NULL',
    ).bind(ctx.projectId).all<{ checklist_item: string }>();
    const viewers = await ctx.env.DB.prepare(
      `SELECT l.user_id, u.name, COUNT(*) AS n FROM data_room_access_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.project_id = ? AND substr(l.created_at, 1, 10) > ?
        GROUP BY l.user_id ORDER BY n DESC, l.user_id LIMIT 6`,
    ).bind(ctx.projectId, daysBefore(ctx.today, 90)).all<{ user_id: number; name: string | null; n: number }>();
    const coverage = checklistCoverage((mapped.results || []).map((r) => r.checklist_item));
    const unmapped = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM data_room_files WHERE project_id = ? AND checklist_item IS NULL',
    ).bind(ctx.projectId).first<{ n: number }>();
    const v = viewers.results || [];
    const series = [
      { kind: 'progress', items: coverage.map((c) => ({ label: c.area, pct: c.pct })) },
      v.length
        ? { kind: 'rows', items: v.map((r) => ({ label: r.name ?? `User ${r.user_id}`, value: plural(Number(r.n), 'open', 'opens') })) }
        : { kind: 'rows', items: [{ label: 'Opens in the last 90 days', value: 0 }] },
    ];
    const open = Number(unmapped?.n ?? 0);
    const next = open > 0 ? { text: `Match ${plural(open, 'file', 'files')} to the diligence checklist`, href: href(ctx, 'data-room') } : null;
    return { state: 'ok', series, next, reason: null };
  });
}

/** Who outside the founder sees a file (migration 463, D691 decision 6). */
export const ACCESS_TIERS = [
  { value: 'invited', label: 'Invited investors' },
  { value: 'committed', label: 'Committed investors only' },
  { value: 'nobody', label: 'Nobody yet' },
] as const;
export const TIER_LABEL: Record<string, string> = Object.fromEntries(ACCESS_TIERS.map((t) => [t.value, t.label]));

/**
 * A file's Access cell: its stored tier, whether an NDA gates it, and the day
 * access ends. It says who may open the file, not how many do: counting them
 * is decision 6's shared predicate, which #1700 builds.
 */
export function accessText(f: { access_tier?: string | null; visibility?: string | null; access_expires_at?: string | null }): string {
  const tier = TIER_LABEL[String(f.access_tier ?? 'invited')] ?? TIER_LABEL.invited;
  const until = day(f.access_expires_at);
  return [tier, f.visibility === 'nda' ? 'NDA' : null, until ? `until ${until}` : null].filter(Boolean).join(' · ');
}

/**
 * The diligence requests the files name, by id: only a request of a case
 * about this venture (`subject_type 'project'`), so a foreign id names nothing.
 */
export async function requestTitles(ctx: Ctx, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const res = await ctx.env.DB.prepare(
    `SELECT r.id, r.title FROM dd_requests r JOIN dd_cases c ON c.id = r.case_id
      WHERE c.subject_type = 'project' AND c.subject_id = ? AND r.id IN (SELECT value FROM json_each(?))`,
  ).bind(ctx.projectId, JSON.stringify(ids)).all<{ id: number; title: string }>();
  for (const r of res.results || []) out.set(Number(r.id), String(r.title));
  return out;
}

async function dataRoomRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const res = await ctx.env.DB.prepare(
    `SELECT f.id, f.name, f.visibility, f.checklist_item, f.updated_at, f.folder_id, d.name AS folder,
            f.access_tier, f.access_expires_at, f.dd_request_id
       FROM data_room_files f LEFT JOIN data_room_folders d ON d.id = f.folder_id
      WHERE f.project_id = ? ORDER BY f.updated_at DESC, f.id DESC`,
  ).bind(ctx.projectId).all<any>();
  const all = res.results || [];
  const requested = [...new Set(all.map((f) => Number(f.dd_request_id)).filter((n) => Number.isInteger(n) && n > 0))];
  const titles = await requestTitles(ctx, requested);
  const answers = (f: any) => titles.get(Number(f.dd_request_id)) ?? checklistLabel(f.checklist_item);
  const answerKind = (f: any) => (titles.has(Number(f.dd_request_id)) ? 'request' : checklistLabel(f.checklist_item) ? 'checklist' : 'none');
  let rows = all.filter((f) => has(rq.q, f.name, f.folder));
  const fl = rq.filter;
  if (fl.folder) rows = rows.filter((f) => (fl.folder === 'top' ? f.folder_id == null : String(f.folder_id) === fl.folder));
  if (fl.access === 'nda') rows = rows.filter((f) => f.visibility === 'nda');
  else if (fl.access) rows = rows.filter((f) => String(f.access_tier ?? 'invited') === fl.access);
  if (fl.answers) rows = rows.filter((f) => answerKind(f) === fl.answers);
  if (fl.area) rows = rows.filter((f) => DILIGENCE_CHECKLIST.find((c) => c.key === f.checklist_item)?.area === fl.area);
  if (rq.sort === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const folders = new Map<string, string>();
  for (const f of all) if (f.folder_id != null) folders.set(String(f.folder_id), String(f.folder ?? 'Folder'));
  return paged(
    [col('file', 'File'), col('folder', 'Folder'), col('answers', 'Answers request'), col('access', 'Access'), col('updated', 'Updated')],
    rows.map((f) => ({
      id: f.id,
      cells: {
        file: f.name, folder: f.folder ?? 'Top level', answers: answers(f),
        access: accessText(f), updated: day(f.updated_at),
      },
    })),
    rq.page,
    {
      filters: [
        { key: 'folder', label: 'Folder', options: [{ value: 'top', label: 'Top level' }, ...[...folders].map(([value, label]) => ({ value, label }))] },
        { key: 'access', label: 'Access', options: [...ACCESS_TIERS, { value: 'nda', label: 'NDA required' }] },
        { key: 'answers', label: 'Answers', options: [{ value: 'request', label: 'A diligence request' }, { value: 'checklist', label: 'A checklist item' }, { value: 'none', label: 'Nothing yet' }] },
        { key: 'area', label: 'Area', options: CHECKLIST_AREAS.map((a) => ({ value: a, label: a })) },
      ],
      sorts: [{ key: 'updated', label: 'Updated' }, { key: 'name', label: 'Name' }],
      add: { text: 'Upload', href: addHref(ctx, 'data-room') },
    },
  );
}

// ---------------------------------------------------------------------------
// Cap table — before and after the planned round
// ---------------------------------------------------------------------------

export const HOLDER_GROUPS = ['Founders', 'Option pool', 'Investors'] as const;
export const groupOf = (type: string) => (type === 'founder' ? 'Founders' : type === 'option_pool' ? 'Option pool' : 'Investors');
const INSTRUMENT: Record<string, string> = { founder: 'Common', option_pool: 'Options', safe: 'SAFE', preferred: 'Preferred' };

type Holder = { holder: string; type: string; shares: number };
/** `type` is the simulator's ledger type, which `capIdOf` pairs with an `inputs_json` list. */
export type CapRow = { holder: string; type: string; group: string; instrument: string; before: number | null; after: number | null };

/** One row per holder with their percentage before and after the first planned round. */
export function capRows(before: Holder[], after: Holder[] | null): CapRow[] {
  const sum = (l: Holder[]) => l.reduce((a, h) => a + (Number(h.shares) || 0), 0);
  const tb = sum(before);
  const ta = after ? sum(after) : 0;
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 10000) / 100 : null);
  const keys = new Map<string, CapRow>();
  for (const h of before) keys.set(`${h.type}\u0000${h.holder}`, { holder: h.holder, type: h.type, group: groupOf(h.type), instrument: INSTRUMENT[h.type] ?? h.type, before: pct(Number(h.shares) || 0, tb), after: after ? 0 : null });
  for (const h of after || []) {
    const k = `${h.type}\u0000${h.holder}`;
    const row = keys.get(k) ?? { holder: h.holder, type: h.type, group: groupOf(h.type), instrument: INSTRUMENT[h.type] ?? h.type, before: 0, after: 0 };
    row.after = pct(Number(h.shares) || 0, ta);
    keys.set(k, row);
  }
  return [...keys.values()];
}

/** Each holder group's share, in `HOLDER_GROUPS` order. */
export function groupShares(rows: CapRow[], side: 'before' | 'after'): number[] {
  return HOLDER_GROUPS.map((g) => Math.round(rows.filter((r) => r.group === g).reduce((a, r) => a + (r[side] ?? 0), 0) * 100) / 100);
}

/** The planned round as `simulate` stored it: its pre-money and the lines saying how each instrument converted. */
export type PlannedRound = { name: string; preMoney: number | null; events: string[] };

export async function loadCap(ctx: Ctx): Promise<{ exists: boolean; computed: boolean; roundName: string | null; rows: CapRow[]; inputs: any; round: PlannedRound | null }> {
  const s = await ctx.env.DB.prepare(
    'SELECT inputs_json, result_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(ctx.projectId).first<{ inputs_json: string | null; result_json: string | null }>();
  if (!s) return { exists: false, computed: false, roundName: null, rows: [], inputs: null, round: null };
  let r: any = null;
  try { r = s.result_json ? JSON.parse(s.result_json) : null; } catch { r = null; }
  let inputs: any = null;
  try { inputs = s.inputs_json ? JSON.parse(s.inputs_json) : null; } catch { inputs = null; }
  const founding: Holder[] | null = Array.isArray(r?.founding) ? r.founding : null;
  if (!founding) return { exists: true, computed: false, roundName: null, rows: [], inputs, round: null };
  const round = Array.isArray(r?.rounds) && r.rounds.length ? r.rounds[0] : null;
  const after: Holder[] | null = round && Array.isArray(round.ledger) ? round.ledger : null;
  const planned = round ? {
    name: String(round.name ?? 'the round'), preMoney: num(round.pre_money),
    events: Array.isArray(round.events) ? round.events.map(String) : [],
  } : null;
  return { exists: true, computed: true, roundName: planned ? planned.name : null, rows: capRows(founding, after), inputs, round: planned };
}

const ENTRY_KEY = /^e-[1-9][0-9]{0,8}$/;
const entryName = (e: any) => String(e?.name ?? '').trim();

/** The `inputs_json` entry a ledger row comes from, matched the way `simulate` names the ledger. */
export function capEntryOf(row: { holder: string; type: string }, inputs: any): any | null {
  const holder = String(row.holder ?? '').trim();
  const list = row.type === 'founder' ? inputs?.founders : row.type === 'safe' ? inputs?.safes : row.type === 'preferred' ? inputs?.rounds : null;
  if (!Array.isArray(list)) return null;
  // A round's new investors are "<round> Investors" (`services/captable.ts`), matched in any case.
  return list.find((e: any) => (row.type === 'preferred'
    ? `${entryName(e)} investors`.toLowerCase() === holder.toLowerCase()
    : entryName(e) === holder)) ?? null;
}

/**
 * A cap-table row's id (D691 decision 4): `h-<holder_id>` for an entry that
 * carries a register row, its `e-<n>` key otherwise, and `pool` for the option
 * pool. A row of a scenario saved before keys has none: null, drawn plain, and
 * the read never writes one.
 */
export function capIdOf(row: { holder: string; type: string }, inputs: any): string | null {
  if (row.type === 'option_pool') return 'pool';
  const entry = capEntryOf(row, inputs);
  if (!entry) return null;
  const holderId = Number(entry.holder_id);
  if (Number.isInteger(holderId) && holderId > 0) return `h-${holderId}`;
  return typeof entry.key === 'string' && ENTRY_KEY.test(entry.key) ? entry.key : null;
}

/** The instrument filter's values, as Add holder's form names them (CO:321). */
const INSTRUMENTS = [
  { value: 'common', label: 'Common' }, { value: 'safe', label: 'SAFE' }, { value: 'note', label: 'Convertible note' },
  { value: 'options', label: 'Options' }, { value: 'preferred', label: 'Preferred' },
] as const;

/** A row's instrument key and its cell: a SAFE or a note says its cap when the entry has one. */
export function instrumentOf(row: CapRow, inputs: any): { key: string; text: string } {
  if (row.type === 'founder') return { key: 'common', text: 'Common' };
  if (row.type === 'option_pool') return { key: 'options', text: 'Options' };
  if (row.type === 'preferred') return { key: 'preferred', text: 'Preferred' };
  if (row.type !== 'safe') return { key: String(row.type), text: row.instrument };
  const entry = capEntryOf(row, inputs);
  const note = entry?.instrument === 'note';
  const cap = num(entry?.cap);
  const label = note ? 'Convertible note' : 'SAFE';
  return { key: note ? 'note' : 'safe', text: cap != null && cap > 0 ? `${label} · ${usd(cap)} cap` : label };
}

export async function capTableCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('cap-table', 'Planned round', 'Ownership by holder group, before and after the planned round.', 'Cap table'), async (): Promise<CardBody> => {
    const cap = await loadCap(ctx);
    if (!cap.exists) {
      return { state: 'empty', series: null, next: { text: 'Add holder', href: addHref(ctx, 'cap-table') }, reason: 'No holders yet. Ownership before and after the round appears here.' };
    }
    if (!cap.computed) {
      return { state: 'not_recorded', series: null, next: { text: 'Compute the cap table', href: TOOL_HREF.capTable }, reason: 'The cap table has not been computed yet.' };
    }
    const tones = ['v1', 'v2', 'v3'];
    const rows = [{ label: 'Before', parts: groupShares(cap.rows, 'before') }];
    if (cap.roundName) rows.push({ label: `After ${cap.roundName}`, parts: groupShares(cap.rows, 'after') });
    return {
      state: 'ok',
      series: [{ kind: 'stack', rows, tones, legend: HOLDER_GROUPS.map((g, i) => ({ label: g, tone: tones[i] })) }],
      next: cap.roundName ? null : { text: 'Plan the round in the cap table', href: TOOL_HREF.capTable },
      reason: null,
    };
  });
}

async function capRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const cap = await loadCap(ctx);
  let rows = cap.rows.map((r) => ({ r, inst: instrumentOf(r, cap.inputs) })).filter(({ r }) => has(rq.q, r.holder));
  if (rq.filter.group) rows = rows.filter(({ r }) => r.group === rq.filter.group);
  if (rq.filter.instrument) rows = rows.filter(({ inst }) => inst.key === rq.filter.instrument);
  // Ownership, the default: largest before the round, then largest after it.
  if (rq.sort === 'after') rows.sort((a, b) => (b.r.after ?? -1) - (a.r.after ?? -1));
  else rows.sort((a, b) => (b.r.before ?? -1) - (a.r.before ?? -1) || (b.r.after ?? -1) - (a.r.after ?? -1));
  return paged(
    [col('holder', 'Holder'), col('group', 'Group'), col('instrument', 'Instrument'), col('before', 'Before'), col('after', 'After round')],
    rows.map(({ r, inst }) => ({
      id: capIdOf(r, cap.inputs),
      cells: { holder: r.holder, group: r.group, instrument: inst.text, before: r.before, after: r.after },
    })),
    rq.page,
    {
      filters: [
        { key: 'group', label: 'Group', options: HOLDER_GROUPS.map((g) => ({ value: g, label: g })) },
        { key: 'instrument', label: 'Instrument', options: [...INSTRUMENTS] },
      ],
      sorts: [{ key: 'ownership', label: 'Ownership' }, { key: 'after', label: 'Largest after the round' }],
      add: { text: 'Add holder', href: addHref(ctx, 'cap-table') },
    },
  );
}

// ---------------------------------------------------------------------------
// Use of funds
// ---------------------------------------------------------------------------

/**
 * The Use of Funds page's five sections, the milestone bucket three of them
 * carry, and each one's key (D691 decision 9), the id every list, record and
 * write names. The deck maps the sections by label, so the labels stay.
 */
export const FUND_SECTIONS = [
  { key: 'product', label: 'Product & engineering', bucket: 'eng' },
  { key: 'go-to-market', label: 'GTM: sales and marketing', bucket: 'gtm' },
  { key: 'infrastructure', label: 'Infrastructure & data', bucket: null },
  { key: 'operations', label: 'Operations, legal & compliance', bucket: 'ops' },
  { key: 'reserve', label: 'Hiring / runway reserve', bucket: null },
] as const;
const FUND_TONES = ['v1', 'v2', 'v3', 'grey', 'muted'];

export function parseAllocation(raw: unknown): number[] | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('[')) return null;
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return null;
    const out = FUND_SECTIONS.map(() => 0);
    for (const x of arr) {
      const i = FUND_SECTIONS.findIndex((f) => f.label === String(x?.label ?? '').trim());
      if (i >= 0) out[i] = Math.max(0, Math.min(100, Math.round(Number(x?.pct) || 0)));
    }
    return out.some((p) => p > 0) ? out : null;
  } catch { return null; }
}

/** Cash at the end of each of the next `months` months, from cash now and a monthly burn. Null with either missing. */
export function cashPath(cash: number | null, burn: number | null, months = 18, extra = 0): number[] | null {
  if (cash == null || burn == null) return null;
  return Array.from({ length: months + 1 }, (_, m) => Math.max(0, Math.round(cash + extra - burn * m)));
}

export async function loadFunds(ctx: Ctx) {
  const p = await ctx.env.DB.prepare('SELECT use_of_funds, funding_needed, use_of_funds_meta FROM projects WHERE id = ?')
    .bind(ctx.projectId).first<{ use_of_funds: string | null; funding_needed: number | null; use_of_funds_meta: string | null }>();
  const m = await ctx.env.DB.prepare(
    `SELECT cash_balance, net_burn, snapshot_date FROM project_metrics
      WHERE project_id = ? AND cash_balance IS NOT NULL AND net_burn IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
  ).bind(ctx.projectId).first<{ cash_balance: number; net_burn: number; snapshot_date: string }>();
  let metaObj: any = {};
  try { metaObj = p?.use_of_funds_meta ? JSON.parse(p.use_of_funds_meta) : {}; } catch { metaObj = {}; }
  const costs: Record<string, { bucket?: string; cost?: unknown }> = metaObj && typeof metaObj.milestone_costs === 'object' && metaObj.milestone_costs ? metaObj.milestone_costs : {};
  // D691 decision 9: the runway the raise buys and each section's milestone, kept in the same meta.
  const runway = num(metaObj?.runway_months);
  const milestones: Record<string, { label?: unknown; by?: unknown }> = metaObj && typeof metaObj.milestones === 'object' && metaObj.milestones ? metaObj.milestones : {};
  return {
    alloc: parseAllocation(p?.use_of_funds), target: num(p?.funding_needed), costs, metrics: m ?? null,
    runway: runway != null && runway > 0 ? runway : null, milestones,
  };
}

export async function useOfFundsCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('use-of-funds', 'Next 18 months', 'The planned split of the raise, and cash over the next 18 months with and without it.', 'Use of funds'), async (): Promise<CardBody> => {
    const f = await loadFunds(ctx);
    if (!f.alloc) {
      return { state: 'empty', series: null, next: { text: 'Edit split', href: addHref(ctx, 'use-of-funds') }, reason: 'No split yet. The planned split and runway appear here.' };
    }
    const series: unknown[] = [{
      kind: 'stack', bare: true, rows: [{ label: 'Planned split', parts: f.alloc }], tones: FUND_TONES,
      legend: FUND_SECTIONS.map((s, i) => ({ label: s.label, tone: FUND_TONES[i] })),
    }];
    const burn = f.metrics ? Number(f.metrics.net_burn) : null;
    const path = f.metrics && burn != null && burn > 0 ? cashPath(Number(f.metrics.cash_balance), burn) : null;
    if (path) {
      const plan = f.target ? cashPath(Number(f.metrics!.cash_balance), burn, 18, f.target) : null;
      series.push({ kind: 'line', values: path, ...(plan ? { plan } : {}), labels: [{ at: 0, label: 'Now' }, { at: 18, label: '18 mo' }] });
    } else {
      series.push({ kind: 'rows', items: [{ label: 'Cash over 18 months', value: null }] });
    }
    const next = !f.target
      ? { text: 'Set the raise target', href: TOOL_HREF.model }
      : !path ? { text: 'Record cash and net burn in a metrics snapshot', href: TOOL_HREF.metrics } : null;
    return { state: 'ok', series, next, reason: null };
  });
}

/** "<label> by <date>" when the section's milestone is recorded (decision 9). */
export function milestoneText(m: { label?: unknown; by?: unknown } | undefined): string | null {
  const label = String(m?.label ?? '').trim();
  if (!label) return null;
  const by = String(m?.by ?? '').trim();
  return by ? `${label} by ${by}` : label;
}

/** One use-of-funds section's cells, read the same way by its list row and its record (decision 9). */
export function fundCells(f: Awaited<ReturnType<typeof loadFunds>>, i: number) {
  const s = FUND_SECTIONS[i];
  const pct = f.alloc ? f.alloc[i] : 0;
  const priced = s.bucket
    ? Object.values(f.costs).filter((c) => c?.bucket === s.bucket && c.cost != null && c.cost !== '' && Number.isFinite(Number(c.cost)))
    : [];
  const cost = priced.reduce((a, c) => a + Number(c.cost), 0);
  const amount = f.target != null ? Math.round((pct / 100) * f.target) : null;
  return {
    category: s.label, share: pct, amount,
    // The amount over the runway it buys; with no runway set, Not recorded.
    monthly: amount != null && f.runway != null ? Math.round(amount / f.runway) : null,
    milestone: milestoneText(f.milestones[s.key])
      ?? (priced.length ? `${plural(priced.length, 'milestone', 'milestones')} · ${usd(cost)}` : null),
  };
}

async function fundsRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const f = await loadFunds(ctx);
  let rows = (f.alloc ?? []).map((_pct, i) => ({ id: FUND_SECTIONS[i].key, cells: fundCells(f, i) }))
    .filter((r) => r.cells.share > 0 && has(rq.q, r.cells.category));
  if (rq.filter.category) rows = rows.filter((r) => r.id === rq.filter.category);
  // Share, largest first, is the default.
  if (rq.sort !== 'order') rows.sort((a, b) => b.cells.share - a.cells.share);
  return paged(
    [col('category', 'Category'), col('share', 'Share'), col('amount', 'Amount'), col('monthly', 'Monthly'), col('milestone', 'Milestone')],
    rows, rq.page,
    {
      filters: [{ key: 'category', label: 'Category', options: FUND_SECTIONS.map((s) => ({ value: s.key, label: s.label })) }],
      sorts: [{ key: 'share', label: 'Share' }, { key: 'order', label: 'Order' }],
      add: { text: 'Edit split', href: addHref(ctx, 'use-of-funds') },
    },
  );
}

// ---------------------------------------------------------------------------
// Capital relationships
// ---------------------------------------------------------------------------

export const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed'] as const;
const STAGE_LABEL: Record<string, string> = { to_contact: 'To contact', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed' };
/** The list names the first stage as the canvas does (D691 decision 10); the stored value stays `to_contact`. */
export const LIST_STAGE_LABEL: Record<string, string> = { ...STAGE_LABEL, to_contact: 'Identified' };
export const IN_CONVERSATION = ['contacted', 'meeting', 'diligence'];

export type ProspectRow = {
  id: number; name: string | null; firm: string | null; stage: string; contact_id: number | null;
  next_step: string | null; next_step_due: string | null; warm_path: string | null; last_contact: string | null; updated_at: string | null;
  commit_status: string | null;
  /** True when this investor responded to one of the venture's round calls (D653); always false with the flag off. */
  via_call: boolean;
};

/**
 * The project's prospects with their last contact, which is the stored
 * contact's `last_activity_at` and nothing else: a prospect with no contact,
 * or a contact with no activity, has no last contact.
 *
 * A CALL'S RESPONDERS ARE ALREADY PROSPECTS. `services/roundCalls.ts`
 * `respond()` upserts each response into `raise_prospects` in the same batch
 * that records it (`routes/contacts.ts` `roundCallPipelineStatements`), so
 * nothing here writes a second path into the pipeline. What this read adds is
 * which prospects came through a call: an investor whose verified account
 * (matched by email, as the call's audience is) responded to one of this
 * venture's calls. With `ROUND_CALLS_ENABLED` off the call tables are not
 * read at all, and no prospect is marked.
 */
export async function loadProspects(env: Env, projectId: number): Promise<ProspectRow[]> {
  const calls = roundCallsEnabled(env);
  const res = await env.DB.prepare(
    `SELECT p.id, p.name, p.firm, p.stage, p.contact_id, p.next_step, p.next_step_due, p.warm_path, p.updated_at, p.commit_status,
            c.last_activity_at AS last_contact,
            ${calls
    ? `EXISTS(SELECT 1 FROM round_call_recipients r JOIN round_calls rc ON rc.id = r.call_id JOIN users u ON u.id = r.investor_user_id
                       WHERE rc.project_id = p.project_id AND r.responded_at IS NOT NULL AND LOWER(u.email) = LOWER(p.email))`
    : '0'} AS via_call
       FROM raise_prospects p LEFT JOIN contacts c ON c.id = p.contact_id AND c.project_id = p.project_id
      WHERE p.project_id = ? ORDER BY p.id`,
  ).bind(projectId).all<Omit<ProspectRow, 'via_call'> & { via_call: number }>();
  return (res.results || []).map((r) => ({ ...r, via_call: Number(r.via_call) === 1 }));
}

/** What the venture's round calls brought into the pipeline: responders, and their soft commitments. */
export function callResponders(prospects: ProspectRow[]): { responders: number; soft: number } {
  const via = prospects.filter((p) => p.via_call);
  return { responders: via.length, soft: via.filter((p) => p.stage === 'committed' && p.commit_status === 'soft').length };
}

/** How many prospects reached each stage (passed ones excluded). */
export function funnelOf(prospects: Array<{ stage: string }>): Array<{ label: string; value: number }> {
  const idx = (s: string) => STAGES.indexOf(s as any);
  const live = prospects.filter((p) => idx(p.stage) >= 0);
  return STAGES.map((s, i) => ({ label: STAGE_LABEL[s], value: live.filter((p) => idx(p.stage) >= i).length }));
}

export function followUps(prospects: ProspectRow[], today: string): { overdue: number; due: number } {
  const soon = daysBefore(today, -7);
  let overdue = 0, due = 0;
  for (const p of prospects) {
    if (!p.next_step_due || p.stage === 'passed' || p.stage === 'committed') continue;
    if (p.next_step_due < today) overdue += 1;
    else if (p.next_step_due <= soon) due += 1;
  }
  return { overdue, due };
}

export async function capitalCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('capital-relationships', 'Current round', 'Investors by the furthest pipeline stage they reached, and the follow-ups due.', 'Raise pipeline'), async (): Promise<CardBody> => {
    const prospects = await loadProspects(ctx.env, ctx.projectId);
    if (prospects.length === 0) {
      return { state: 'empty', series: null, next: { text: 'Add investor', href: addHref(ctx, 'capital-relationships') }, reason: 'No investors yet. The pipeline by stage appears here.' };
    }
    const fu = followUps(prospects, ctx.today);
    const series = [
      { kind: 'funnel', steps: funnelOf(prospects) },
      { kind: 'rows', items: [{ label: 'Follow-ups overdue', value: fu.overdue, tone: fu.overdue ? 'bad' : 'ok' }, { label: 'Due in 7 days', value: fu.due }] },
    ];
    // Shown only while round calls are on: with the flag off no call can be
    // sent, so a "0 responders" row would describe a feature nobody has.
    if (roundCallsEnabled(ctx.env)) {
      const rc = callResponders(prospects);
      series.push({ kind: 'rows', items: [{ label: 'Responded to a round call', value: rc.responders }, { label: 'Soft commitments through a call', value: rc.soft, tone: rc.soft ? 'warn' : 'muted' }] } as any);
    }
    const noStep = prospects.filter((p) => IN_CONVERSATION.includes(p.stage) && !p.next_step).length;
    const next = fu.overdue
      ? { text: `Follow up with ${plural(fu.overdue, 'investor whose next step is', 'investors whose next step is')} overdue`, href: href(ctx, 'capital-relationships') }
      : noStep
        ? { text: `Set a next step for ${plural(noStep, 'investor', 'investors')} in conversation`, href: href(ctx, 'capital-relationships') }
        : null;
    return { state: 'ok', series, next, reason: null };
  });
}

/**
 * A prospect's stage, and how it came: "Committed · soft" for a commitment
 * made through a call (D653 writes those as `soft`, never signed), and
 * "· via call" for any responder. D752: a committed prospect with a confirmed
 * raise receipt reads "Committed · received <posted date>", which replaces
 * "· soft" because the bank line outranks the word.
 */
export function stageCell(p: ProspectRow, receivedOn: string | null = null): Cell {
  const label = LIST_STAGE_LABEL[p.stage] ?? p.stage;
  if (p.stage === 'committed' && receivedOn) return { text: `${label} · received ${receivedOn.slice(0, 10)}${p.via_call ? ' · via call' : ''}` };
  const soft = p.stage === 'committed' && p.commit_status === 'soft';
  const text = `${label}${soft ? ' · soft' : ''}${p.via_call ? ' · via call' : ''}`;
  return soft || p.via_call ? { text, tone: soft ? 'warn' : undefined } : label;
}

export type Fit = 'fits' | 'outside' | 'unclear';
export const FIT_LABEL: Record<Fit | 'not_recorded', string> = {
  fits: 'Fits', outside: 'Outside its focus', unclear: 'Unclear', not_recorded: 'Not recorded',
};

/**
 * A fund's thesis against the venture's sector (D691 decision 10), through the
 * Research crosswalk and never by substring: "Fits" when the two map to a
 * shared market or the fund is Generalist, "Outside its focus" when both map
 * and share none, "Unclear" when either maps to nothing.
 */
export function fundFit(focus: string | null | undefined, sector: string | null | undefined): Fit {
  if (focusTokens(focus).some((t) => normalizeLabel(t) === 'generalist')) return 'fits';
  const fund = mapFundFocus(focus).targets;
  const venture = mapCompanySector(sector).targets;
  if (fund.length === 0 || venture.length === 0) return 'unclear';
  return fund.some((m) => venture.includes(m)) ? 'fits' : 'outside';
}

/** A prospect's linked fund, as the directory serves it, and its Fit against the venture. */
export type ProspectFund = { fit: Fit; focus: string | null; fundSizeCents: number | null; sector: string | null };

/**
 * Each prospect's fund and Fit, by prospect id. Only a prospect linked to a
 * fund the directory still serves has one: the funds are read `FROM
 * SERVED_FUNDS`, so a list whose terms say 'not allowed' is never read. No
 * link, no Fit.
 */
export async function prospectFunds(ctx: Ctx): Promise<Map<number, ProspectFund>> {
  const out = new Map<number, ProspectFund>();
  const linked = await ctx.env.DB.prepare(
    'SELECT id, research_fund_uid FROM raise_prospects WHERE project_id = ? AND research_fund_uid IS NOT NULL',
  ).bind(ctx.projectId).all<{ id: number; research_fund_uid: string }>();
  const rows = linked.results || [];
  if (rows.length === 0) return out;
  const funds = await ctx.env.DB.prepare(
    `SELECT f.uid, f.sector_focus, f.fund_size_cents FROM ${SERVED_FUNDS} AS f WHERE f.uid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...new Set(rows.map((r) => r.research_fund_uid))])).all<{ uid: string; sector_focus: string | null; fund_size_cents: number | null }>();
  const served = new Map((funds.results || []).map((f) => [String(f.uid), f]));
  const p = await ctx.env.DB.prepare('SELECT sector FROM projects WHERE id = ?').bind(ctx.projectId).first<{ sector: string | null }>();
  for (const r of rows) {
    const f = served.get(r.research_fund_uid);
    if (f) out.set(Number(r.id), { fit: fundFit(f.sector_focus, p?.sector), focus: f.sector_focus, fundSizeCents: num(f.fund_size_cents), sector: p?.sector ?? null });
  }
  return out;
}

/** D752: each prospect's confirmed raise receipt, by its posted date. Stored matches only. */
export async function receivedDates(env: Env, projectId: number): Promise<Map<number, string>> {
  const rows = (await env.DB.prepare(
    `SELECT m.target_id, m.posted_on FROM mercury_personal_matches m JOIN raise_prospects p ON p.id = m.target_id
      WHERE m.target_kind = 'raise_prospect' AND m.state = 'confirmed' AND p.project_id = ?`,
  ).bind(projectId).all<{ target_id: number; posted_on: string }>()).results || [];
  return new Map(rows.map((r) => [Number(r.target_id), String(r.posted_on)]));
}

async function capitalRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const funds = await prospectFunds(ctx);
  const received = await receivedDates(ctx.env, ctx.projectId);
  const fitOf = (p: ProspectRow): Fit | 'not_recorded' => funds.get(Number(p.id))?.fit ?? 'not_recorded';
  let rows = (await loadProspects(ctx.env, ctx.projectId)).filter((p) => has(rq.q, p.name, p.firm, p.warm_path));
  if (rq.filter.stage) rows = rows.filter((p) => p.stage === rq.filter.stage);
  if (rq.filter.fit) rows = rows.filter((p) => fitOf(p) === rq.filter.fit);
  if (rq.filter.path === 'has') rows = rows.filter((p) => String(p.warm_path ?? '').trim() !== '');
  if (rq.filter.path === 'none') rows = rows.filter((p) => String(p.warm_path ?? '').trim() === '');
  const calls = roundCallsEnabled(ctx.env);
  if (calls && rq.filter.source === 'call') rows = rows.filter((p) => p.via_call);
  if (rq.sort === 'due') rows.sort((a, b) => String(a.next_step_due ?? '9999').localeCompare(String(b.next_step_due ?? '9999')));
  else if (rq.sort === 'name') rows.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  else if (rq.sort === 'recent') rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  else {
    // Last contact, the default: the most recent first, a prospect with none last.
    rows.sort((a, b) => String(b.last_contact ?? '').localeCompare(String(a.last_contact ?? ''))
      || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  }
  return paged(
    [col('investor', 'Investor'), col('stage', 'Stage'), col('last_contact', 'Last contact'), col('next_step', 'Next step'), col('warm_path', 'Warm path')],
    rows.map((p) => ({
      id: p.id,
      cells: {
        investor: [p.name, p.firm].filter(Boolean).join(' · ') || null,
        stage: stageCell(p, received.get(Number(p.id)) ?? null),
        last_contact: day(p.last_contact),
        next_step: p.next_step
          ? { text: p.next_step_due ? `${p.next_step} · ${p.next_step_due}` : p.next_step, tone: p.next_step_due && p.next_step_due < ctx.today ? 'bad' : undefined }
          : null,
        warm_path: p.warm_path,
      },
    })),
    rq.page,
    {
      filters: [
        { key: 'stage', label: 'Stage', options: [...STAGES, 'passed'].map((s) => ({ value: s, label: LIST_STAGE_LABEL[s] })) },
        { key: 'fit', label: 'Fit', options: (['fits', 'outside', 'unclear', 'not_recorded'] as const).map((f) => ({ value: f, label: FIT_LABEL[f] })) },
        { key: 'path', label: 'Path', options: [{ value: 'has', label: 'Has a warm path' }, { value: 'none', label: 'No path' }] },
        ...(calls ? [{ key: 'source', label: 'Source', options: [{ value: 'call', label: 'Responded to a call' }] }] : []),
      ],
      sorts: [{ key: 'last_contact', label: 'Last contact' }, { key: 'recent', label: 'Recently updated' }, { key: 'due', label: 'Next step due' }, { key: 'name', label: 'Name' }],
      add: { text: 'Add investor', href: addHref(ctx, 'capital-relationships') },
    },
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const sparkOrNone = (points: number[]) => (points.filter((p) => Number.isFinite(p)).length >= 3 ? points : []);

async function readinessFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'readiness_score', label: 'Readiness score', unit: 'score', source: 'readiness_scores' }, async () => {
    const { scores } = await loadReadiness(ctx);
    const latest = latestScores(scores);
    const coverage = { scored: latest.size, total: READINESS_ITEMS.length };
    const now = overallReadiness(latest.values());
    if (now == null) return { value: null, coverage, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No readiness item scored yet' };
    const cut = daysBefore(ctx.today, 30);
    const then = scores.some((s) => String(s.scored_at).slice(0, 10) <= cut) ? overallReadiness(latestScores(scores, cut).values()) : null;
    return {
      value: now, coverage, delta_30d: then == null ? null : now - then,
      spark: sparkOrNone(readinessHistory(scores).slice(-8).map((h) => h.score)), state: 'ok', as_of: ctx.today, reason: null,
    };
  });
}

async function committedFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'committed', label: 'Committed against target', unit: 'of', source: 'raise_prospects · raise_rounds' }, async () => {
    const c = await ctx.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt FROM raise_prospects WHERE project_id = ? AND stage = 'committed'`,
    ).bind(ctx.projectId).first<{ n: number; amt: number }>();
    const r = await ctx.env.DB.prepare(
      `SELECT target_amount FROM raise_rounds WHERE project_id = ? AND status = 'active' LIMIT 1`,
    ).bind(ctx.projectId).first<{ target_amount: number | null }>();
    const amt = Number(c?.amt ?? 0);
    const target = num(r?.target_amount);
    if (target == null || target <= 0) {
      if (Number(c?.n ?? 0) === 0) return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No active round and no commitment yet' };
      return { value: amt, unit: 'usd', delta_30d: null, spark: [], state: 'ok', as_of: ctx.today, reason: 'No active round target is recorded' };
    }
    return { value: [Math.round(amt), Math.round(target)] as any, delta_30d: null, spark: [], state: 'ok', as_of: ctx.today, reason: null };
  });
}

async function conversationFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'investors_in_conversation', label: 'Investors in conversation', unit: 'count', source: 'raise_prospects' }, async () => {
    const r = await ctx.env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN stage IN ('contacted', 'meeting', 'diligence') THEN 1 ELSE 0 END) AS live
         FROM raise_prospects WHERE project_id = ?`,
    ).bind(ctx.projectId).first<{ total: number; live: number | null }>();
    if (Number(r?.total ?? 0) === 0) return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No investor is in the pipeline yet' };
    // No stage history is stored, so the change over 30 days is not recorded.
    return { value: Number(r?.live ?? 0), delta_30d: null, spark: [], state: 'ok', as_of: ctx.today, reason: null };
  });
}

/** Months of runway: cash over monthly net burn. Null when either is missing or nothing burns. */
export function runwayMonths(cash: number | null, burn: number | null): number | null {
  if (cash == null || burn == null || !(burn > 0)) return null;
  return Math.round((cash / burn) * 10) / 10;
}

async function runwayFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'runway_months', label: 'Months of runway', unit: 'months', source: 'project_metrics' }, async () => {
    const res = await ctx.env.DB.prepare(
      `SELECT cash_balance, net_burn, snapshot_date FROM project_metrics
        WHERE project_id = ? AND cash_balance IS NOT NULL AND net_burn IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 8`,
    ).bind(ctx.projectId).all<{ cash_balance: number; net_burn: number; snapshot_date: string }>();
    const snaps = res.results || [];
    if (snaps.length === 0) return { value: null, delta_30d: null, spark: [], state: 'not_recorded', as_of: null, reason: 'No metrics snapshot records cash and net burn' };
    const now = runwayMonths(Number(snaps[0].cash_balance), Number(snaps[0].net_burn));
    if (now == null) return { value: null, delta_30d: null, spark: [], state: 'not_recorded', as_of: snaps[0].snapshot_date, reason: 'Net burn is zero or negative, so burn sets no runway' };
    const spark = snaps.map((s) => runwayMonths(Number(s.cash_balance), Number(s.net_burn))).filter((v): v is number => v != null).reverse();
    return { value: now, delta_30d: null, spark: sparkOrNone(spark), state: 'ok', as_of: snaps[0].snapshot_date, reason: null };
  });
}

export async function figures(ctx: Ctx): Promise<Figure[]> {
  return Promise.all([readinessFigure(ctx), committedFigure(ctx), conversationFigure(ctx), runwayFigure(ctx)]);
}

// ---------------------------------------------------------------------------
// Cards and records, by module
// ---------------------------------------------------------------------------

type CardBody = Omit<Card, 'slug' | 'name' | 'range' | 'caption'>;
const meta = (slug: ModuleSlug, range: string, caption: string, source: string) => ({
  slug, name: MODULES.find((m) => m.slug === slug)!.name, range, caption, source,
});

export async function cards(ctx: Ctx): Promise<Card[]> {
  return Promise.all(MODULES.map((m) => CARD_FOR[m.slug](ctx)));
}

export const CARD_FOR: Record<ModuleSlug, (ctx: Ctx) => Promise<Card>> = {
  'fundraising-readiness': readinessCard,
  'investor-narrative': narrativeCard,
  'pitch-deck': pitchDeckCard,
  'data-room': dataRoomCard,
  'cap-table': capTableCard,
  'use-of-funds': useOfFundsCard,
  'capital-relationships': capitalCard,
};

export type Cell = string | number | null | { text: string; tone?: string; href?: string };
export type Records = {
  cols: Array<{ key: string; label: string }>;
  /** Null only where decision 4 says so: a cap-table row of a scenario saved before keys. */
  rows: Array<{ id: number | string | null; cells: Record<string, Cell> }>;
  total: number; page: number; page_size: number;
  filters?: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
  sorts?: Array<{ key: string; label: string }>;
  add?: { text: string; href: string };
};

const col = (key: string, label: string) => ({ key, label });
const has = (q: string, ...vals: Array<unknown>) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q));

function paged(cols: Records['cols'], rows: Records['rows'], page: number, extra: Pick<Records, 'filters' | 'sorts' | 'add'> = {}): Records {
  const start = (page - 1) * PAGE_SIZE;
  return { cols, rows: rows.slice(start, start + PAGE_SIZE), total: rows.length, page, page_size: PAGE_SIZE, ...extra };
}

export const RECORDS_FOR: Record<ModuleSlug, (ctx: Ctx, rq: RecordQuery) => Promise<Records>> = {
  'fundraising-readiness': readinessRecords,
  'investor-narrative': narrativeRecords,
  'pitch-deck': pitchRecords,
  'data-room': dataRoomRecords,
  'cap-table': capRecords,
  'use-of-funds': fundsRecords,
  'capital-relationships': capitalRecords,
};

/** D686 #1594: the venture's Calls history, separate from the founder-only list route. */
export async function callsHistory(ctx: Ctx) {
  if (!roundCallsEnabled(ctx.env)) return {enabled:false};
  try {
    const rows = await ctx.env.DB.prepare(
      `SELECT c.uid,c.name,c.state,c.sent_at,c.target_close,c.amount_cents,
        (SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id) AS recipients,
        (SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id AND r.opened_at IS NOT NULL) AS opened,
        (SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id AND r.data_room_requested_at IS NOT NULL) AS data_room_requests,
        (SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id AND r.commitment_cents IS NOT NULL) AS commitments,
        (SELECT COALESCE(SUM(r.commitment_cents),0) FROM round_call_recipients r WHERE r.call_id=c.id) AS committed_cents,
        (SELECT COUNT(*) FROM round_call_recipients r WHERE r.call_id=c.id AND r.responded_at IS NOT NULL) AS responded,
        (SELECT COUNT(*) FROM round_call_questions q WHERE q.call_id=c.id AND q.answer IS NULL) AS unanswered_questions
       FROM round_calls c WHERE c.project_id=? ORDER BY c.created_at DESC,c.id DESC`,
    ).bind(ctx.projectId).all<{state:string;target_close:string} & Record<string,unknown>>();
    return {enabled:true,items:(rows.results || []).map(row=>({...row,
      effective_state:row.state==='sent'?(row.target_close>=ctx.today?'open':'expired'):row.state}))};
  } catch {
    return {state:'unreadable'};
  }
}
