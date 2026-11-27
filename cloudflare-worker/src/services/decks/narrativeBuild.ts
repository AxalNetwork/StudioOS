/**
 * D1516 (#3768, deck v2 A5) — New deck from the narrative: the stage's arc over
 * the venture's records, a grid plan per card, and the theme and template
 * picked by stage, so one build fans out per element under one hold.
 *
 *   narrativeWords  the narrative version the build binds (the latest
 *                   `narrative_version_meta` row, `narrative_version_meta:vN`)
 *                   and its `raise.narrative.<section>` and
 *                   `raise.positioning.<kind>` words, each sentence that names
 *                   a figure dropped: figures come only from records
 *   cardsFor        the stage's arc (`planFor`) cut to the cards with recorded
 *                   proof (`cutUnproven`); a card left out says why ("Problem
 *                   not evidenced")
 *   gridPlan        the `grid_plan` job: per card a structure, its areas and
 *                   the element each area runs (`GRID_PLAN_SCHEMA`). A code
 *                   job: it runs no model and costs nothing; each area's model
 *                   is resolved per element when the run is planned (D1503)
 *   pickTheme       Brand Kit first, else stage × audience × sector, with the
 *                   sentence "Picked … because …"
 *   plannedCards    the deck's v2 cards (deterministic uids, so a quote holds
 *                   across the outline and the build), each card's notes the
 *                   figure-free narrative words its text areas write from
 */
import type { Env } from '../../types';
import { ARCS, cutUnproven, planFor, STAGE_LABELS, type Stage } from '../narrative/arcs';
import { CARD_CATALOGUE, numberIn, type Audience } from './newDeck';
import { chartable } from './assist';
import { structureOf } from './structures';
import type { SourceItem } from './sources';
import { AUDIENCES } from './slideModel';

type ThemeKind = 'brand' | 'neutral_light' | 'neutral_dark' | 'sand' | 'ocean' | 'forest';

/** The `grid_plan` job's id, as the coverage table and D1516 name it. */
export const GRID_PLAN_JOB = 'grid_plan';

/** The job's output schema: a structure per card, its areas, and the element each area runs. */
export const GRID_PLAN_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['cards'],
  properties: {
    cards: {
      type: 'array', maxItems: 16,
      items: {
        type: 'object', additionalProperties: false, required: ['card', 'uid', 'title', 'structure', 'areas'],
        properties: {
          card: { type: 'string' }, uid: { type: 'string' }, title: { type: 'string' }, structure: { type: 'string' },
          areas: {
            type: 'array', minItems: 1, maxItems: 12,
            items: { type: 'object', additionalProperties: false, required: ['id', 'element'], properties: { id: { type: 'string' }, element: { type: 'string' } } },
          },
        },
      },
    },
  },
});

/**
 * Each catalogue card's structure and the element of each of its areas. A
 * chart or a records element is planned only where the records can fill it;
 * otherwise the area writes words (`fallback`), so no area is left empty.
 */
const GRID: Readonly<Record<string, { structure: string; elements: Record<string, string>; needs?: Record<string, string[]> }>> = Object.freeze({
  title: { structure: 'full', elements: { a1: 'title' } },
  problem: { structure: 'title_body', elements: { title: 'title', body: 'body' } },
  why_now: { structure: 'title_body', elements: { title: 'title', body: 'body' } },
  solution: { structure: 'title_body', elements: { title: 'title', body: 'bullets' } },
  traction: { structure: 'split_7_5', elements: { main: 'chart', side: 'body' } },
  validation: { structure: 'title_body', elements: { title: 'title', body: 'bullets' } },
  product: { structure: 'title_body', elements: { title: 'title', body: 'bullets' } },
  market: { structure: 'title_body', elements: { title: 'title', body: 'body' } },
  unit_economics: { structure: 'split_7_5', elements: { main: 'table', side: 'body' } },
  team: { structure: 'title_body', elements: { title: 'title', body: 'team_grid' }, needs: { team_grid: ['team.founders'] } },
  round: { structure: 'title_body', elements: { title: 'title', body: 'round_terms' }, needs: { round_terms: ['raise.round_terms', 'raise.round_target'] } },
  use_of_funds: { structure: 'title_body', elements: { title: 'title', body: 'use_of_funds' }, needs: { use_of_funds: ['raise.use_of_funds'] } },
  competition: { structure: 'title_body', elements: { title: 'title', body: 'bullets' } },
  roadmap: { structure: 'timeline_band', elements: { top: 'title', timeline: 'timeline', bottom: 'body' } },
  cap_table: { structure: 'title_body', elements: { title: 'title', body: 'cap_table' }, needs: { cap_table: ['raise.cap_table'] } },
});
const CHARTS = new Set(['chart', 'table', 'timeline']);
/** What an area writes when the records cannot fill what the plan wanted there. */
const fallback = (element: string) => (element === 'timeline' ? 'bullets' : 'body');

/** The card's catalogue title. */
const titleOf = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)?.title ?? card;

/** "Problem not evidenced": the line a card left out of the build carries. */
export const notEvidenced = (title: string) => `${title} not evidenced`;

// ---- the narrative ----------------------------------------------------------------

export type NarrativeWords = {
  /** The version the build binds, or null with why: a venture with no saved narrative version. */
  version: number | null;
  ref: string | null;
  reason: string | null;
  /** Figure-free words by slot key (`raise.narrative.problem`, `raise.positioning.one_liner`). */
  words: Record<string, string>;
  /** The sentences left out because they name a figure, by slot key. */
  dropped: Record<string, number>;
};

/** Every sentence of `text` that names no figure (`numberIn`, which catches number words too). */
export function figureFree(text: string): { kept: string; dropped: number } {
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => numberIn(s) == null);
  return { kept: kept.join(' '), dropped: sentences.length - kept.length };
}

/** The slot words of one narrative version, figure-free. Pure, so the route and the tests share it. */
export function wordsOf(version: number | null, sections: Array<{ key: string; body: string | null }>, positioning: Array<{ kind: string; text: string | null }>): NarrativeWords {
  const words: Record<string, string> = {};
  const dropped: Record<string, number> = {};
  const put = (key: string, text: string | null) => {
    if (!text || !text.trim()) return;
    const f = figureFree(text);
    if (f.dropped) dropped[key] = (dropped[key] ?? 0) + f.dropped;
    if (f.kept) words[key] = words[key] ? `${words[key]} ${f.kept}` : f.kept;
  };
  for (const s of sections) put(`raise.narrative.${s.key}`, s.body);
  for (const p of positioning) put(`raise.positioning.${p.kind}`, p.text);
  return {
    version, ref: version == null ? null : `narrative_version_meta:v${version}`,
    reason: version == null ? 'No narrative version is saved yet: the build writes from your records and card titles.' : null,
    words, dropped,
  };
}

/** The latest saved narrative version (`narrative_version_meta`) and its words. Unreadable is null with its reason, never v0. */
export async function narrativeWords(env: Env, projectId: number): Promise<NarrativeWords> {
  let version: number | null = null;
  try {
    const r = await env.DB.prepare('SELECT MAX(version) AS v FROM narrative_version_meta WHERE project_id = ?').bind(projectId).first<{ v: number | null }>();
    version = r?.v == null ? null : Number(r.v);
  } catch {
    return { version: null, ref: null, reason: 'Your investor narrative could not be read right now.', words: {}, dropped: {} };
  }
  if (version == null) return wordsOf(null, [], []);
  try {
    const { readNarrative } = await import('../narrative/store');
    const n = await readNarrative(env, projectId, version);
    const sections = n.sections.state === 'ok' ? (n.sections as any).items : [];
    const positioning = n.positioning.state === 'ok' ? (n.positioning as any).effective : [];
    return wordsOf(version, sections, positioning);
  } catch {
    return { version, ref: `narrative_version_meta:v${version}`, reason: 'Some of your narrative could not be read right now.', words: {}, dropped: {} };
  }
}

/** Which narrative slots each card writes from. */
const CARD_SLOTS: Readonly<Record<string, string[]>> = Object.freeze({
  title: ['raise.positioning.one_liner', 'raise.positioning.line', 'raise.positioning.category'],
  problem: ['raise.narrative.problem', 'raise.positioning.for_whom'],
  why_now: ['raise.narrative.why_now'],
  solution: ['raise.narrative.solution', 'raise.positioning.wedge', 'raise.positioning.instead_of'],
  traction: ['raise.narrative.traction'],
  validation: ['raise.narrative.traction'],
  product: ['raise.narrative.solution'],
  market: ['raise.narrative.market'],
  unit_economics: ['raise.narrative.business_model'],
  team: ['raise.narrative.team'],
  round: ['raise.narrative.ask'],
  use_of_funds: ['raise.narrative.ask'],
  competition: ['raise.narrative.competition', 'raise.positioning.instead_of'],
  roadmap: ['raise.narrative.closing'],
  cap_table: [],
});

// ---- the cards, the grid plan and the theme ----------------------------------------------------------------

export type CardPlan = { card: string; title: string; why: string; proof: string };
export type CardCut = { stage: Stage; stage_label: string; cards: CardPlan[]; left_out: Array<{ card: string; title: string; line: string }>; warnings: Array<{ card: string; message: string }> };

/** The stage's arc over the records, cut to the cards with recorded proof. */
export function cardsFor(stage: Stage, investorType: Audience | null, items: readonly SourceItem[]): CardCut {
  const plan = planFor({ stage, investorType, cards: [...ARCS[stage].order], items });
  const cut = cutUnproven(plan);
  const keep = new Set(cut.keep);
  return {
    stage, stage_label: STAGE_LABELS[stage],
    cards: plan.order.filter((r) => keep.has(r.card) && GRID[r.card]).map((r) => ({ card: r.card, title: r.title, why: r.why, proof: r.proof })),
    left_out: cut.left_out.map((l) => ({ card: l.card, title: l.title, line: notEvidenced(l.title) })),
    warnings: plan.warnings.filter((w) => w.code === 'missing_proof').map((w) => ({ card: w.card, message: notEvidenced(titleOf(w.card)) })),
  };
}

export type GridCard = { card: string; uid: string; title: string; structure: string; areas: Array<{ id: string; element: string }> };

/** `grid_plan`: each kept card's structure and the element of each area, filled only where the records can fill it. */
export function gridPlan(cards: readonly CardPlan[], items: readonly SourceItem[]): { cards: GridCard[] } {
  const recorded = new Set(items.filter((i) => i.state === 'recorded' && i.value != null).map((i) => i.source_key));
  const charts = chartable(items as SourceItem[]).length > 0;
  return {
    cards: cards.map((c) => {
      const g = GRID[c.card];
      const areas = structureOf(g.structure)!.areas.map((a) => {
        const want = g.elements[a.id] ?? 'body';
        const can = CHARTS.has(want) ? charts : g.needs?.[want] ? g.needs[want].some((k) => recorded.has(k)) : true;
        return { id: a.id, element: can ? want : fallback(want) };
      });
      return { card: c.card, uid: `nb-${c.card}`, title: c.title, structure: g.structure, areas };
    }),
  };
}

/** The v2 cards the build saves: the structure's areas, the title, and the figure-free narrative words as the card's notes. */
export function plannedCards(plan: { cards: GridCard[] }, words: NarrativeWords): any[] {
  return plan.cards.map((c) => {
    const s = structureOf(c.structure)!;
    const notes = (CARD_SLOTS[c.card] ?? []).map((k) => words.words[k]).filter(Boolean).join('\n');
    return {
      uid: c.uid, title: c.title, subtitle: null, body: '', bullets: [], image_url: null, spec_id: `narrative:${c.card}`,
      structure: c.structure, areas: s.areas.map((a) => ({ ...a })), blocks: [], notes,
    };
  });
}

/** The areas the run plans: every area of every card, with its element (the `deck_build` class's request). */
export function buildAreas(plan: { cards: GridCard[] }) {
  return plan.cards.flatMap((c) => {
    const s = structureOf(c.structure)!;
    return c.areas.map((a) => {
      const g = s.areas.find((x) => x.id === a.id)!;
      return { id: a.id, grid: { c1: g.c1, c2: g.c2, r1: g.r1, r2: g.r2 }, element: a.element, card: c.uid, action: 'rewrite' as const };
    });
  });
}

/** A theme per stage; a sector that reads as climate or health takes its own. */
const STAGE_THEME: Readonly<Record<Stage, ThemeKind>> = Object.freeze({ pre_seed: 'sand', seed: 'neutral_light', series_a: 'ocean', series_b_plus: 'neutral_dark' });
const THEME_LABEL: Readonly<Record<string, string>> = Object.freeze({ brand: 'Brand', neutral_light: 'Neutral light', neutral_dark: 'Neutral dark', sand: 'Sand', ocean: 'Ocean', forest: 'Forest' });
const AUDIENCE_LABEL: Readonly<Partial<Record<Audience, string>>> = Object.freeze({ angel: 'angels', pre_seed_fund: 'pre-seed funds', seed_fund: 'seed funds', series_a_fund: 'Series A funds', strategic: 'strategic investors', grant: 'a grant panel' });

/** Brand Kit first; else the stage's theme, with the sector's where it has one. */
export function pickTheme(q: { brandKit: boolean; stage: Stage; audience: Audience | null; sector: string | null }): { kind: ThemeKind; reason: string } {
  if (q.brandKit) return { kind: 'brand', reason: 'Picked Brand because your brand kit is set: it wins over the stage.' };
  const sector = (q.sector ?? '').toLowerCase();
  if (/climate|energy|sustainab|agri|carbon/.test(sector)) return { kind: 'forest', reason: `Picked Forest because it suits a ${STAGE_LABELS[q.stage]} deck in ${q.sector!.trim()}.` };
  const kind = STAGE_THEME[q.stage];
  const who = q.audience ? AUDIENCE_LABEL[q.audience] ?? q.audience.replace(/_/g, ' ') : null;
  return { kind, reason: `Picked ${THEME_LABEL[kind]} because it suits a ${STAGE_LABELS[q.stage]} deck${who ? ` for ${who}` : ''}.` };
}

export const isAudience = (v: unknown): v is Audience => typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v);
