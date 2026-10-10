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
 */
import type { Env } from '../types';
import { safeCard, safeFigure, countState, PAGE_SIZE, type Card, type Figure } from './cycleCards';
import { daysBefore, recordQuery, type RecordQuery } from './cycleValidate';
import { roundCallsEnabled } from './roundCallPolicy';

export { recordQuery };
export type { RecordQuery };

export const CYCLE = 'raise';
export const QUESTION = 'What resources does this venture need?';

export const MODULES = [
  { slug: 'fundraising-readiness', name: 'Fundraising readiness' },
  { slug: 'investor-narrative', name: 'Investor narrative' },
  { slug: 'pitch-deck', name: 'Pitch deck' },
  { slug: 'data-room', name: 'Data room' },
  { slug: 'cap-table', name: 'Cap table' },
  { slug: 'use-of-funds', name: 'Use of funds' },
  { slug: 'capital-relationships', name: 'Capital relationships' },
] as const;
export type ModuleSlug = (typeof MODULES)[number]['slug'];

export type Ctx = { env: Env; projectId: number; today: string };

const href = (ctx: Ctx, slug: string) => `/raise/${slug}?project=${ctx.projectId}`;
/** The full tools the module pages summarise; the pages link to them. */
export const TOOL_HREF = {
  pitch: '/raise/pitch',
  dataRoom: '/raise/data-room',
  capTable: '/raise/capital/cap-table',
  pipeline: '/raise/capital/pipeline',
  model: '/raise/capital/model',
  metrics: '/build/metrics',
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

async function loadReadiness(ctx: Ctx): Promise<{ items: ItemRow[]; scores: ScoreRow[] }> {
  const items = await ctx.env.DB.prepare(
    `SELECT id, item_key, label, position FROM readiness_items WHERE project_id = ? ORDER BY position, id`,
  ).bind(ctx.projectId).all<ItemRow>();
  const scores = await ctx.env.DB.prepare(
    `SELECT s.item_id, i.item_key, s.score, s.evidence, s.missing, s.source, s.scored_at
       FROM readiness_scores s JOIN readiness_items i ON i.id = s.item_id
      WHERE s.project_id = ? ORDER BY s.scored_at, s.id`,
  ).bind(ctx.projectId).all<ScoreRow>();
  return { items: items.results || [], scores: scores.results || [] };
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

export type ComputedScore = { key: ReadinessKey; score: number; evidence: 'measured'; missing: string | null };

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

  const out: ComputedScore[] = [];
  const hasDeck = Number(decks?.n ?? 0) > 0;
  out.push({ key: 'deck', score: hasDeck ? 10 : 0, evidence: 'measured', missing: hasDeck ? null : 'Build the pitch deck.' });

  const hasAlloc = String(p?.use_of_funds ?? '').trim().startsWith('[');
  const hasTarget = (num(p?.funding_needed) ?? 0) > 0;
  out.push({
    key: 'use_of_funds', score: hasAlloc && hasTarget ? 10 : hasAlloc || hasTarget ? 5 : 0, evidence: 'measured',
    missing: hasAlloc && hasTarget ? null : 'Set a raise target and a 100% allocation.',
  });

  const hasCap = Number(scen?.n ?? 0) > 0;
  out.push({ key: 'cap_table', score: hasCap ? 10 : 0, evidence: 'measured', missing: hasCap ? null : 'Set up the cap table.' });

  const traction = (num(p?.revenue) ?? 0) > 0 || (num(p?.mrr) ?? 0) > 0 || (num(p?.paying_customers) ?? 0) > 0;
  out.push({ key: 'traction', score: traction ? 10 : 0, evidence: 'measured', missing: traction ? null : 'Log revenue or update your proof fields.' });

  const known = new Set((mapped.results || []).map((r) => r.checklist_item).filter((k) => CHECKLIST_KEYS.has(k)));
  const open = DILIGENCE_CHECKLIST.length - known.size;
  out.push({
    key: 'data_room', score: Math.round((known.size / DILIGENCE_CHECKLIST.length) * 10), evidence: 'measured',
    missing: open === 0 ? null : `${plural(open, 'checklist item has', 'checklist items have')} no file.`,
  });

  const v = num(latestVersion?.v);
  if (v == null) {
    out.push({ key: 'narrative', score: 0, evidence: 'measured', missing: 'Save an investor narrative version.' });
  } else {
    const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM narrative_checks WHERE project_id = ? AND version = ?')
      .bind(projectId, v).first<{ n: number }>();
    const mismatches = Number(m?.n ?? 0);
    out.push({
      key: 'narrative', score: Math.max(0, 10 - 2 * mismatches), evidence: 'measured',
      missing: mismatches === 0 ? null : `${plural(mismatches, 'figure differs', 'figures differ')} from the stored metrics.`,
    });
  }
  return out;
}

export async function readinessCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('fundraising-readiness', 'All time', 'Each readiness item by its score out of 10, shaded by evidence; the overall score over time.', 'Readiness scores'), async (): Promise<CardBody> => {
    const { items, scores } = await loadReadiness(ctx);
    if (items.length === 0) {
      return {
        state: 'empty', series: null,
        next: { text: 'Score fundraising readiness', href: href(ctx, 'fundraising-readiness') },
        reason: 'No readiness item scored yet.',
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

async function readinessRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const { items, scores } = await loadReadiness(ctx);
  const latest = latestScores(scores);
  let rows = items.map((i) => ({ i, s: latest.get(Number(i.id)) ?? null })).filter(({ i }) => has(rq.q, i.label));
  if (rq.filter.evidence) rows = rows.filter(({ s }) => (rq.filter.evidence === 'not_recorded' ? s == null : s?.evidence === rq.filter.evidence));
  if (rq.sort === 'score') rows.sort((a, b) => (a.s?.score ?? -1) - (b.s?.score ?? -1));
  return paged(
    [col('item', 'Item'), col('score', 'Score /10'), col('evidence', 'Evidence'), col('missing', 'Missing'), col('updated', 'Updated')],
    rows.map(({ i, s }) => ({
      id: i.id,
      cells: {
        item: i.label, score: s ? Number(s.score) : null, evidence: s?.evidence ?? null,
        missing: s ? s.missing ?? '' : null, updated: s ? day(s.scored_at) : null,
      },
    })),
    rq.page,
    {
      filters: [{ key: 'evidence', label: 'Evidence', options: [...EVIDENCE.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) })), { value: 'not_recorded', label: 'Not scored' }] }],
      sorts: [{ key: 'order', label: 'Order' }, { key: 'score', label: 'Lowest score' }],
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

type VersionRow = { version: number; investor_type: string | null; deck_version: number | null; saved_at: string; mismatches: number };

async function loadVersions(ctx: Ctx): Promise<VersionRow[]> {
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
      return { state: 'empty', series: null, next: { text: 'Save your first narrative version', href: href(ctx, 'investor-narrative') }, reason: 'No narrative version saved yet.' };
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
        deck: v.deck_version != null ? `Deck v${v.deck_version}` : null,
        mismatches: { text: String(Number(v.mismatches)), tone: Number(v.mismatches) ? 'warn' : 'ok' },
        date: day(v.saved_at),
      },
    })),
    rq.page,
    {
      filters: [{ key: 'investor_type', label: 'Investor type', options: INVESTOR_TYPES.map((t) => ({ value: t, label: INVESTOR_TYPE_LABEL[t] })) }],
      sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }],
      add: { text: 'Save a version', href: href(ctx, 'investor-narrative') },
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
    const total = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM deck_share_views v JOIN pitch_decks d ON d.id = v.deck_id WHERE d.project_id = ?',
    ).bind(ctx.projectId).first<{ n: number }>();
    if (Number(total?.n ?? 0) === 0) {
      return { state: 'empty', series: null, next: { text: 'Share the deck with an investor', href: TOOL_HREF.pitch }, reason: 'No one has opened a deck link yet.' };
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

async function pitchRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const res = await ctx.env.DB.prepare(
    `SELECT t.id, t.created_at, t.expires_at, t.revoked_at, t.view_count,
            (SELECT COALESCE(SUM(v.read_seconds), 0) FROM deck_share_views v WHERE v.share_token_id = t.id) AS seconds,
            (SELECT s.slide_index FROM deck_view_slides s JOIN deck_share_views v ON v.id = s.view_id
              WHERE v.share_token_id = t.id GROUP BY s.slide_index HAVING SUM(s.seconds) > 0
              ORDER BY SUM(s.seconds) DESC, s.slide_index LIMIT 1) AS top_slide
       FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id
      WHERE d.project_id = ? ORDER BY t.created_at DESC, t.id DESC`,
  ).bind(ctx.projectId).all<any>();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const status = (t: any) => (t.revoked_at ? 'revoked' : String(t.expires_at) < now ? 'expired' : 'active');
  let rows = (res.results || []).filter((t) => has(rq.q, `link ${t.id}`, day(t.created_at)));
  if (rq.filter.status) rows = rows.filter((t) => status(t) === rq.filter.status);
  if (rq.sort === 'views') rows.sort((a, b) => Number(b.view_count) - Number(a.view_count));
  return paged(
    [col('link', 'Investor link'), col('expires', 'Expires'), col('views', 'Views'), col('time', 'Time on deck'), col('most_read', 'Most read')],
    rows.map((t) => ({
      id: t.id,
      cells: {
        // A share link records no investor name, so the link is named by its creation day.
        link: `Link created ${day(t.created_at) ?? 'on an unrecorded day'}`,
        expires: { text: day(t.expires_at) ?? '', tone: status(t) === 'active' ? 'ok' : 'muted' },
        views: Number(t.view_count) || 0,
        time: `${Math.round((Number(t.seconds) || 0) / 60)} min`,
        most_read: t.top_slide == null ? null : `Slide ${Number(t.top_slide) + 1}`,
      },
    })),
    rq.page,
    {
      filters: [{ key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'expired', label: 'Expired' }, { value: 'revoked', label: 'Revoked' }] }],
      sorts: [{ key: 'newest', label: 'Newest' }, { key: 'views', label: 'Most views' }],
      add: { text: 'Create a share link', href: TOOL_HREF.pitch },
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
const checklistLabel = (k: string | null) => DILIGENCE_CHECKLIST.find((c) => c.key === k)?.label ?? null;

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
      return { state: 'empty', series: null, next: { text: 'Upload the first data-room file', href: TOOL_HREF.dataRoom }, reason: 'The data room holds no file yet.' };
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

async function dataRoomRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const res = await ctx.env.DB.prepare(
    `SELECT f.id, f.name, f.visibility, f.checklist_item, f.updated_at, d.name AS folder
       FROM data_room_files f LEFT JOIN data_room_folders d ON d.id = f.folder_id
      WHERE f.project_id = ? ORDER BY f.updated_at DESC, f.id DESC`,
  ).bind(ctx.projectId).all<any>();
  let rows = (res.results || []).filter((f) => has(rq.q, f.name, f.folder));
  if (rq.filter.mapped === 'yes') rows = rows.filter((f) => f.checklist_item != null);
  if (rq.filter.mapped === 'no') rows = rows.filter((f) => f.checklist_item == null);
  if (rq.filter.area) rows = rows.filter((f) => DILIGENCE_CHECKLIST.find((c) => c.key === f.checklist_item)?.area === rq.filter.area);
  if (rq.sort === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return paged(
    [col('file', 'File'), col('folder', 'Folder'), col('answers', 'Answers request'), col('access', 'Access'), col('updated', 'Updated')],
    rows.map((f) => ({
      id: f.id,
      cells: {
        file: f.name, folder: f.folder ?? 'Top level', answers: checklistLabel(f.checklist_item),
        access: f.visibility === 'nda' ? 'NDA' : 'Open', updated: day(f.updated_at),
      },
    })),
    rq.page,
    {
      filters: [
        { key: 'mapped', label: 'Checklist', options: [{ value: 'yes', label: 'Matched' }, { value: 'no', label: 'Not matched' }] },
        { key: 'area', label: 'Area', options: CHECKLIST_AREAS.map((a) => ({ value: a, label: a })) },
      ],
      sorts: [{ key: 'updated', label: 'Recently updated' }, { key: 'name', label: 'Name' }],
      add: { text: 'Upload a file', href: TOOL_HREF.dataRoom },
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
export type CapRow = { holder: string; group: string; instrument: string; before: number | null; after: number | null };

/** One row per holder with their percentage before and after the first planned round. */
export function capRows(before: Holder[], after: Holder[] | null): CapRow[] {
  const sum = (l: Holder[]) => l.reduce((a, h) => a + (Number(h.shares) || 0), 0);
  const tb = sum(before);
  const ta = after ? sum(after) : 0;
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 10000) / 100 : null);
  const keys = new Map<string, CapRow>();
  for (const h of before) keys.set(`${h.type}\u0000${h.holder}`, { holder: h.holder, group: groupOf(h.type), instrument: INSTRUMENT[h.type] ?? h.type, before: pct(Number(h.shares) || 0, tb), after: after ? 0 : null });
  for (const h of after || []) {
    const k = `${h.type}\u0000${h.holder}`;
    const row = keys.get(k) ?? { holder: h.holder, group: groupOf(h.type), instrument: INSTRUMENT[h.type] ?? h.type, before: 0, after: 0 };
    row.after = pct(Number(h.shares) || 0, ta);
    keys.set(k, row);
  }
  return [...keys.values()];
}

/** Each holder group's share, in `HOLDER_GROUPS` order. */
export function groupShares(rows: CapRow[], side: 'before' | 'after'): number[] {
  return HOLDER_GROUPS.map((g) => Math.round(rows.filter((r) => r.group === g).reduce((a, r) => a + (r[side] ?? 0), 0) * 100) / 100);
}

async function loadCap(ctx: Ctx): Promise<{ exists: boolean; computed: boolean; roundName: string | null; rows: CapRow[] }> {
  const s = await ctx.env.DB.prepare(
    'SELECT result_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(ctx.projectId).first<{ result_json: string | null }>();
  if (!s) return { exists: false, computed: false, roundName: null, rows: [] };
  let r: any = null;
  try { r = s.result_json ? JSON.parse(s.result_json) : null; } catch { r = null; }
  const founding: Holder[] | null = Array.isArray(r?.founding) ? r.founding : null;
  if (!founding) return { exists: true, computed: false, roundName: null, rows: [] };
  const round = Array.isArray(r?.rounds) && r.rounds.length ? r.rounds[0] : null;
  const after: Holder[] | null = round && Array.isArray(round.ledger) ? round.ledger : null;
  return { exists: true, computed: true, roundName: round ? String(round.name ?? 'the round') : null, rows: capRows(founding, after) };
}

export async function capTableCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('cap-table', 'Planned round', 'Ownership by holder group, before and after the planned round.', 'Cap table'), async (): Promise<CardBody> => {
    const cap = await loadCap(ctx);
    if (!cap.exists) {
      return { state: 'empty', series: null, next: { text: 'Set up the cap table', href: TOOL_HREF.capTable }, reason: 'No cap table is set up yet.' };
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
  let rows = cap.rows.filter((r) => has(rq.q, r.holder));
  if (rq.filter.group) rows = rows.filter((r) => r.group === rq.filter.group);
  if (rq.sort === 'after') rows.sort((a, b) => (b.after ?? -1) - (a.after ?? -1));
  else rows.sort((a, b) => (b.before ?? -1) - (a.before ?? -1));
  return paged(
    [col('holder', 'Holder'), col('group', 'Group'), col('instrument', 'Instrument'), col('before', 'Before %'), col('after', 'After %')],
    rows.map((r, i) => ({ id: `${r.group}:${r.holder}:${i}`, cells: { holder: r.holder, group: r.group, instrument: r.instrument, before: r.before, after: r.after } })),
    rq.page,
    {
      filters: [{ key: 'group', label: 'Group', options: HOLDER_GROUPS.map((g) => ({ value: g, label: g })) }],
      sorts: [{ key: 'before', label: 'Largest before' }, { key: 'after', label: 'Largest after' }],
      add: { text: 'Open the cap table', href: TOOL_HREF.capTable },
    },
  );
}

// ---------------------------------------------------------------------------
// Use of funds
// ---------------------------------------------------------------------------

/** The Use of Funds page's five sections and the milestone bucket three of them carry. */
export const FUND_SECTIONS = [
  { label: 'Product & engineering', bucket: 'eng' },
  { label: 'GTM: sales and marketing', bucket: 'gtm' },
  { label: 'Infrastructure & data', bucket: null },
  { label: 'Operations, legal & compliance', bucket: 'ops' },
  { label: 'Hiring / runway reserve', bucket: null },
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

async function loadFunds(ctx: Ctx) {
  const p = await ctx.env.DB.prepare('SELECT use_of_funds, funding_needed, use_of_funds_meta FROM projects WHERE id = ?')
    .bind(ctx.projectId).first<{ use_of_funds: string | null; funding_needed: number | null; use_of_funds_meta: string | null }>();
  const m = await ctx.env.DB.prepare(
    `SELECT cash_balance, net_burn, snapshot_date FROM project_metrics
      WHERE project_id = ? AND cash_balance IS NOT NULL AND net_burn IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
  ).bind(ctx.projectId).first<{ cash_balance: number; net_burn: number; snapshot_date: string }>();
  let metaObj: any = {};
  try { metaObj = p?.use_of_funds_meta ? JSON.parse(p.use_of_funds_meta) : {}; } catch { metaObj = {}; }
  const costs: Record<string, { bucket?: string; cost?: unknown }> = metaObj && typeof metaObj.milestone_costs === 'object' && metaObj.milestone_costs ? metaObj.milestone_costs : {};
  return { alloc: parseAllocation(p?.use_of_funds), target: num(p?.funding_needed), costs, metrics: m ?? null };
}

export async function useOfFundsCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('use-of-funds', 'Next 18 months', 'The planned split of the raise, and cash over the next 18 months with and without it.', 'Use of funds'), async (): Promise<CardBody> => {
    const f = await loadFunds(ctx);
    if (!f.alloc) {
      return { state: 'empty', series: null, next: { text: 'Set the use of funds', href: TOOL_HREF.model }, reason: 'No allocation is set yet.' };
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

async function fundsRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const f = await loadFunds(ctx);
  const rows = (f.alloc ?? []).map((pct, i) => {
    const s = FUND_SECTIONS[i];
    const priced = s.bucket
      ? Object.values(f.costs).filter((c) => c?.bucket === s.bucket && c.cost != null && c.cost !== '' && Number.isFinite(Number(c.cost)))
      : [];
    const cost = priced.reduce((a, c) => a + Number(c.cost), 0);
    return {
      id: s.label,
      cells: {
        category: s.label, share: pct,
        amount: f.target != null ? Math.round((pct / 100) * f.target) : null,
        // No store splits monthly burn by category.
        monthly: null,
        milestone: priced.length ? `${plural(priced.length, 'milestone', 'milestones')} · ${usd(cost)}` : null,
      },
    };
  }).filter((r) => r.cells.share > 0 && has(rq.q, r.cells.category));
  if (rq.sort === 'share') rows.sort((a, b) => b.cells.share - a.cells.share);
  return paged(
    [col('category', 'Category'), col('share', 'Share %'), col('amount', 'Amount'), col('monthly', 'Monthly'), col('milestone', 'Milestone')],
    rows, rq.page,
    { sorts: [{ key: 'order', label: 'Order' }, { key: 'share', label: 'Largest share' }], add: { text: 'Edit the allocation', href: TOOL_HREF.model } },
  );
}

// ---------------------------------------------------------------------------
// Capital relationships
// ---------------------------------------------------------------------------

export const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed'] as const;
const STAGE_LABEL: Record<string, string> = { to_contact: 'To contact', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed' };
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
      return { state: 'empty', series: null, next: { text: 'Add the first investor to the pipeline', href: TOOL_HREF.pipeline }, reason: 'No investor is in the pipeline yet.' };
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
 * "· via call" for any responder.
 */
export function stageCell(p: ProspectRow): Cell {
  const label = STAGE_LABEL[p.stage] ?? p.stage;
  const soft = p.stage === 'committed' && p.commit_status === 'soft';
  const text = `${label}${soft ? ' · soft' : ''}${p.via_call ? ' · via call' : ''}`;
  return soft || p.via_call ? { text, tone: soft ? 'warn' : undefined } : label;
}

async function capitalRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  let rows = (await loadProspects(ctx.env, ctx.projectId)).filter((p) => has(rq.q, p.name, p.firm, p.warm_path));
  if (rq.filter.stage) rows = rows.filter((p) => p.stage === rq.filter.stage);
  const calls = roundCallsEnabled(ctx.env);
  if (calls && rq.filter.source === 'call') rows = rows.filter((p) => p.via_call);
  if (rq.sort === 'due') rows.sort((a, b) => String(a.next_step_due ?? '9999').localeCompare(String(b.next_step_due ?? '9999')));
  else if (rq.sort === 'name') rows.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  else rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  return paged(
    [col('investor', 'Investor'), col('stage', 'Stage'), col('last_contact', 'Last contact'), col('next_step', 'Next step'), col('warm_path', 'Warm path')],
    rows.map((p) => ({
      id: p.id,
      cells: {
        investor: [p.name, p.firm].filter(Boolean).join(' · ') || null,
        stage: stageCell(p),
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
        { key: 'stage', label: 'Stage', options: [...STAGES, 'passed'].map((s) => ({ value: s, label: STAGE_LABEL[s] })) },
        ...(calls ? [{ key: 'source', label: 'Source', options: [{ value: 'call', label: 'Responded to a call' }] }] : []),
      ],
      sorts: [{ key: 'recent', label: 'Recently updated' }, { key: 'due', label: 'Next step due' }, { key: 'name', label: 'Name' }],
      add: { text: 'Add an investor', href: TOOL_HREF.pipeline },
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
    const now = overallReadiness(latestScores(scores).values());
    if (now == null) return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No readiness item scored yet' };
    const cut = daysBefore(ctx.today, 30);
    const then = scores.some((s) => String(s.scored_at).slice(0, 10) <= cut) ? overallReadiness(latestScores(scores, cut).values()) : null;
    return {
      value: now, delta_30d: then == null ? null : now - then,
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
  rows: Array<{ id: number | string; cells: Record<string, Cell> }>;
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
