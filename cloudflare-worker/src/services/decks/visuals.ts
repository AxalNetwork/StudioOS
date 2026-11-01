/**
 * D903 §10 (#3660) — the visuals a generated deck may carry, from records and
 * Cloudflare only: typed diagrams placed by records, the chart each bound
 * series reads best as, and the artwork plan for Workers AI illustrations.
 *
 * NOTHING HERE INVENTS A FIGURE.
 *   · A diagram's labels are record text (an objective, a competitor's name, a
 *     use-of-funds section); its items carry D896 bindings. No amount or
 *     percentage is written into one: those stay metrics and charts.
 *   · A chart is a bound series (`chartSeries.ts`); this file only chooses
 *     how to draw it.
 *   · An illustration is decoration: it is never asked for a figure, a chart,
 *     a logo, text or a real person (`images.ts`'s refusals still apply), and
 *     it is only ever proposed. The founder previews, crops, writes alt text
 *     and keeps or discards it through D903's existing image flow (PD12).
 *
 * CAPABILITY IS CHECKED, NEVER ASSUMED. `imageCapability` says whether this
 * Worker can draw at all (the `AI` binding, and the model in the Workers AI
 * catalogue as generally available). Without it the deck takes its no-image
 * layouts (D898 §8.3 `LAYOUT_NEEDS`), deterministically; no other provider is
 * ever called.
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import { CATALOGUE } from '../ai/catalogue';
import { IMAGE_MODEL, IMAGE_MODEL_LABEL, PALETTES, STYLES, type Style } from './images';
import type { Series } from './chartSeries';
import type { Diagram } from './diagramModel';
import { themeTokens, type BrandKit } from './designSystem';
import { snapshotHash } from './sources';

const all = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results || []) as T[];
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

async function itemBinding(source_key: string, record_ref: string, asOf: string | null, grade: string) {
  return { source_key, record_ref, as_of: asOf, grade, snapshot_hash: await snapshotHash(source_key, record_ref, [], asOf) };
}

// ───────────────────────────────────────────────────────────── diagrams

const KANBAN_ORDER: Record<string, number> = { now: 0, next: 1, later: 2 };
const KANBAN_WORD: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later' };

/**
 * The roadmap as a timeline: Build's objectives in the order the founder
 * works them (now, next, later, then their own order), each with its quarter
 * when one is recorded. Null with fewer than two, or when the read fails.
 */
export async function roadmapDiagram(env: Env, projectId: number): Promise<Diagram | null> {
  try {
    const rows = await all<{ id: number; objective: string; kanban_status: string | null; quarter: string | null; sort_order: number; updated_at: string | null }>(env,
      'SELECT id, objective, kanban_status, quarter, sort_order, updated_at FROM roadmap_okrs WHERE project_id = ? ORDER BY id', projectId);
    const live = rows.filter((r) => typeof r.objective === 'string' && r.objective.trim() && r.kanban_status !== 'done')
      .sort((a, b) => (KANBAN_ORDER[a.kanban_status ?? 'later'] ?? 3) - (KANBAN_ORDER[b.kanban_status ?? 'later'] ?? 3) || a.sort_order - b.sort_order || a.id - b.id)
      .slice(0, 6);
    if (live.length < 2) return null;
    const items = await Promise.all(live.map(async (r) => ({
      label: r.objective.trim().slice(0, 60),
      detail: [KANBAN_WORD[r.kanban_status ?? ''] ?? null, r.quarter ? String(r.quarter).slice(0, 20) : null].filter(Boolean).join(' · ') || undefined,
      binding: await itemBinding('build.roadmap', `roadmap_okrs:${r.id}`, day(r.updated_at), 'Stated'),
    })));
    return { v: 1, type: 'timeline', items: items.map((i) => (i.detail ? i : { label: i.label, binding: i.binding })) };
  } catch { return null; }
}

/**
 * Use of funds as a flow: the sections the founder recorded, largest share
 * first, by name only. The shares stay on the round card's figures; a diagram
 * carries no percentage. Null with fewer than two, or when the read fails.
 */
export async function useOfFundsDiagram(env: Env, projectId: number): Promise<Diagram | null> {
  try {
    const { parseUseOfFundsValue } = await import('../../util/useOfFunds');
    const p = await env.DB.prepare('SELECT use_of_funds, updated_at FROM projects WHERE id = ?').bind(projectId).first<{ use_of_funds: string | null; updated_at: string | null }>();
    const parsed = parseUseOfFundsValue(p?.use_of_funds ?? null).filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct);
    if (parsed.length < 2) return null;
    const binding = await itemBinding('raise.use_of_funds', `projects:${projectId}`, day(p?.updated_at), 'Stated');
    return { v: 1, type: 'flow', items: parsed.slice(0, 5).map((r) => ({ label: r.label.slice(0, 60), binding })) };
  } catch { return null; }
}

const PRICE_SIDE: Record<string, 'lower' | 'higher' | null> = { lower: 'lower', higher: 'higher', similar: null };
const DEPTH_SIDE: Record<string, 'narrower' | 'broader' | null> = { narrower: 'narrower', broader: 'broader', similar: null };
const QUADRANTS = [
  { price: 'lower', depth: 'broader', label: 'Cheaper and broader' },
  { price: 'higher', depth: 'broader', label: 'Pricier and broader' },
  { price: 'lower', depth: 'narrower', label: 'Cheaper and narrower' },
  { price: 'higher', depth: 'narrower', label: 'Pricier and narrower' },
] as const;

/**
 * The competitors as a 2 × 2 against the venture, from what the founder
 * recorded in Validate › Competitors: price (lower or higher than ours) and
 * depth (narrower or broader). A competitor marked "about the same" on either
 * axis, or with a position not recorded, is left off rather than guessed.
 * Null unless two or more are placed.
 */
export async function competitorMatrix(env: Env, projectId: number): Promise<{ diagram: Diagram; placed: number } | null> {
  try {
    const rows = await all<{ id: number; name_norm: string; name: string | null; price_position: string | null; depth_position: string | null; updated_at: string | null }>(env,
      `SELECT t.id, t.name_norm, t.price_position, t.depth_position, t.updated_at,
              (SELECT c.name FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
                WHERE a.project_id = t.project_id AND substr(lower(trim(c.name)), 1, 120) = t.name_norm ORDER BY c.id DESC LIMIT 1) AS name
         FROM competitor_tracking t WHERE t.project_id = ? AND t.stopped_at IS NULL ORDER BY t.id`, projectId);
    const placed = rows.map((r) => ({ r, price: PRICE_SIDE[String(r.price_position)] ?? null, depth: DEPTH_SIDE[String(r.depth_position)] ?? null }))
      .filter((x) => x.price && x.depth);
    if (placed.length < 2) return null;
    const newest = placed.map((x) => day(x.r.updated_at)).filter(Boolean).sort().pop() ?? null;
    const binding = await itemBinding('validate.competitors', `competitor_tracking:${placed.map((x) => x.r.id).join(',')}`.slice(0, 120), newest, 'Stated');
    const items = QUADRANTS.map((q) => {
      const names = placed.filter((x) => x.price === q.price && x.depth === q.depth).map((x) => (x.r.name || x.r.name_norm).trim());
      return { label: q.label, detail: names.length ? names.join(', ').slice(0, 140) : 'None recorded here', binding };
    });
    return { diagram: { v: 1, type: 'matrix', axes: { x: 'Price against ours', y: 'Depth against ours' }, items }, placed: placed.length };
  } catch { return null; }
}

/** Every diagram the venture's records place, keyed by the card that draws it. */
export async function recordDiagrams(env: Env, projectId: number): Promise<{ diagrams: Record<string, Diagram>; rows: Record<string, number> }> {
  const [roadmap, funds, matrix] = await Promise.all([roadmapDiagram(env, projectId), useOfFundsDiagram(env, projectId), competitorMatrix(env, projectId)]);
  const diagrams: Record<string, Diagram> = {};
  const rows: Record<string, number> = {};
  if (roadmap) diagrams.roadmap = roadmap;
  if (funds) diagrams.use_of_funds = funds;
  if (matrix) { diagrams.market = matrix.diagram; diagrams.competition = matrix.diagram; rows.market = matrix.placed; rows.competition = matrix.placed; }
  return { diagrams, rows };
}

// ───────────────────────────────────────────────────────────── charts

/** "2026-10" from a point's x ("2026-10", "2026-10-07"), or null: the frontend's `projectionOf` rule. */
const monthOf = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null);

/**
 * D1538 (#3787): TAM, SAM and SOM as a market, when the points are exactly
 * those three, each positive, with SOM ≤ SAM ≤ TAM. Null otherwise: a market
 * whose parts do not nest is not drawn as circles.
 */
export function marketShape(points: unknown): { tam: number; sam: number; som: number } | null {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const by = new Map<string, number>();
  for (const p of points as any[]) {
    const k = typeof p?.x === 'string' ? p.x.trim().toUpperCase() : '';
    if (!['TAM', 'SAM', 'SOM'].includes(k) || by.has(k) || typeof p?.y !== 'number' || !Number.isFinite(p.y) || p.y <= 0) return null;
    by.set(k, p.y);
  }
  const tam = by.get('TAM')!, sam = by.get('SAM')!, som = by.get('SOM')!;
  return som <= sam && sam <= tam ? { tam, sam, som } : null;
}

export type ChartPick = 'line' | 'columns' | 'market_circles' | 'projection';

/**
 * How a series reads best, from its shape alone, with no user edit (the
 * one-click path, D1538 / dk-auto gap c):
 *   - TAM, SAM and SOM that nest are market circles;
 *   - a series with a month after today's is a projection, drawn dashed
 *     past today with the "Projection" label and its footnote, so a zero-edit
 *     deck never shows a forecast as a result;
 *   - otherwise a trend of four points or more is a line, fewer is columns,
 *     and a weekly count is columns (each week is its own total).
 * Null when it cannot be drawn honestly (unrecorded, or one point).
 */
export function chartTypeFor(s: Pick<Series, 'state' | 'points' | 'cadence' | 'unit'> | null | undefined, today = new Date().toISOString().slice(0, 10)): ChartPick | null {
  if (!s || s.state !== 'recorded' || !Array.isArray(s.points)) return null;
  if (marketShape(s.points)) return 'market_circles';
  if (s.points.length < 2) return null;
  const now = monthOf(today);
  if (now && s.points.some((p) => { const m = monthOf(p?.x); return m != null && m > now; })) return 'projection';
  if (s.cadence === 'weekly' && s.unit === 'count') return 'columns';
  return s.points.length >= 4 ? 'line' : 'columns';
}

// ───────────────────────────────────────────────────────────── artwork

export type ImageCapability = { available: true; model: string; label: string } | { available: false; reason: string };

/** Whether this Worker can draw an illustration now; never a promise it cannot keep. */
export function imageCapability(env: Pick<Env, 'AI'> | null | undefined, catalogue: ReadonlyArray<{ id: string; status: string }> = CATALOGUE): ImageCapability {
  if (!env || !(env as any).AI || typeof (env as any).AI.run !== 'function') {
    return { available: false, reason: 'Image generation is not available on this deployment. The deck uses layouts without illustrations.' };
  }
  const entry = catalogue.find((m) => m.id === IMAGE_MODEL);
  if (!entry || entry.status !== 'ga') {
    return { available: false, reason: `${IMAGE_MODEL_LABEL} is not in the Workers AI catalogue as generally available. The deck uses layouts without illustrations.` };
  }
  return { available: true, model: IMAGE_MODEL, label: IMAGE_MODEL_LABEL };
}

/**
 * One art direction per deck, so every illustration in it belongs together:
 * one style, the theme's palette, and the same prompt suffix. A brand theme
 * draws in the brand's colours (only those that stay legible, D898 §8.2).
 */
export function artDirection(themeKind: unknown, kit: BrandKit | null = null): { style: Style; palette: typeof PALETTES[number]; colours: string[]; suffix: string } {
  const { tokens } = themeTokens(themeKind, kit);
  const style: Style = tokens.kind === 'neutral_dark' ? 'isometric' : 'flat';
  const palette = tokens.kind === 'brand' ? 'brand' : 'neutral';
  const colours = [tokens.colours.accent, tokens.chart[1], tokens.colours.ground];
  return {
    style, palette, colours,
    suffix: `Consistent ${style} illustration style across the deck, in a palette of ${colours.join(', ')}. No text, no numbers, no charts, no logos, no people.`,
  };
}

/** The cards an illustration helps, by role: words-only cards that read as a wall of text without one. */
export const ART_CARDS = ['title', 'solution', 'product', 'why_now'] as const;

/**
 * Which cards of a deck could take an illustration, with the description a
 * founder starts from (the card's own words, never a figure) and the deck's
 * art direction. A proposal only: nothing is generated until the founder asks
 * through the image dialog, which quotes its price first (D903 §3).
 */
export function imagePlan(slides: any[], themeKind: unknown, kit: BrandKit | null, capability: ImageCapability) {
  const direction = artDirection(themeKind, kit);
  const cards = (Array.isArray(slides) ? slides : []).map((s, index) => ({ s, index }))
    .filter(({ s }) => (ART_CARDS as readonly string[]).includes(String(s?.spec_id ?? '').replace(/^new:/, '')))
    .filter(({ s }) => !(s.blocks || []).some((b: any) => b.kind === 'image' && b.image_url))
    .map(({ s, index }) => {
      const heading = (s.blocks || []).find((b: any) => b.kind === 'text' && b.style === 'heading')?.text || s.title || '';
      return { index, card: String(s.spec_id).replace(/^new:/, ''), description: `An illustration for: ${String(heading).replace(/[\d%$€£¥]/g, '').trim()}`.slice(0, 400), style: direction.style, palette: direction.palette, use: 'card' as const };
    });
  return { capability, direction, cards: capability.available ? cards : [] };
}

export const STYLE_IDS = STYLES;
