/**
 * D1522 (#3774, deck v2 A23) — stage arcs: the order an investor at a stage
 * reads a deck in, why, and the proof each stage requires.
 *
 * Keyed by stage × investor type:
 *   - `ARCS[stage]` holds the stage's card order, a "why this order" line for
 *     each card, its weight, and the cards the stage requires with the proof
 *     that backs them;
 *   - the investor type (`AUDIENCE_EMPHASIS` in `decks/newDeck.ts`, D897 §9)
 *     lifts its lead cards to just after the title, as New deck already does.
 *
 * Proof is records, never a model and never a benchmark:
 *   - a card's deck sources (`CARD_CATALOGUE[].sources`, read by
 *     `readSources`): one recorded slot is proof;
 *   - or a pinned evidence item that backs the card (`raiseClaims.pinnedItems`
 *     with `EVIDENCE_RULES[].backs`, D1263/D1264).
 * A slot that is withheld or could not be read is "unchecked": the plan says
 * it could not check, and never calls the proof missing.
 *
 * A missing-proof warning needs no benchmark (D1589): it states what the deck
 * lacks, never how the venture compares with others.
 *
 * Everything here is pure. `stagePlan` in `decks/stagePlan.ts` reads the
 * records and calls `planFor`; the one-click run (#3768) calls the same
 * function and `cutUnproven` with no UI press.
 */
import { AUDIENCE_EMPHASIS, CARD_CATALOGUE, type Audience } from '../decks/newDeck';
import { STAGES, STAGE_LABELS, type Stage } from '../decks/stageNorms';
import type { SourceItem } from '../decks/sources';

export { STAGES, STAGE_LABELS, type Stage };

export type Arc = {
  /** Every card the stage reads, title first, in reading order. */
  order: string[];
  /** One plain line per card: why it sits where it does for this stage. */
  why: Record<string, string>;
  /** The cards this stage requires; a deck without one, or without its proof, is warned. */
  required: string[];
};

const ARC = (order: string[], why: Record<string, string>, required: string[]): Arc => Object.freeze({ order, why, required });

export const ARCS: Record<Stage, Arc> = Object.freeze({
  pre_seed: ARC(
    ['title', 'problem', 'why_now', 'solution', 'team', 'validation', 'market', 'product', 'round', 'use_of_funds'],
    {
      title: 'The venture and what it does, in a line.',
      problem: 'Pre-seed investors back a pain they believe first.',
      why_now: 'What changed that makes this the moment.',
      solution: 'What the product does about the pain.',
      team: 'At pre-seed the team is most of the bet.',
      validation: 'Interviews and letters of intent stand in for revenue.',
      market: 'How big the room is, once the pain is believed.',
      product: 'What exists today, however early.',
      round: 'What you are raising and on what instrument.',
      use_of_funds: 'Where the money goes before the next round.',
    },
    ['problem', 'team'],
  ),
  seed: ARC(
    ['title', 'problem', 'solution', 'traction', 'validation', 'product', 'market', 'why_now', 'team', 'unit_economics', 'round', 'use_of_funds'],
    {
      title: 'The venture and what it does, in a line.',
      problem: 'Seed investors look for evidence of pain first.',
      solution: 'What the product does about the pain.',
      traction: 'Seed investors expect early revenue or users.',
      validation: 'Interviews and letters of intent back the traction.',
      product: 'What shipped, and how fast.',
      market: 'Why the early traction can grow.',
      why_now: 'What changed that makes this the moment.',
      team: 'Who builds the next stage.',
      unit_economics: 'Runway, burn and churn as recorded.',
      round: 'What you are raising and on what instrument.',
      use_of_funds: 'Where the money goes before the next round.',
    },
    ['problem', 'traction', 'team'],
  ),
  series_a: ARC(
    ['title', 'traction', 'unit_economics', 'market', 'product', 'solution', 'problem', 'team', 'competition', 'roadmap', 'round', 'use_of_funds'],
    {
      title: 'The venture and what it does, in a line.',
      traction: 'Series A investors read growth first.',
      unit_economics: 'Growth only counts if each customer pays back.',
      market: 'How far the growth can run.',
      product: 'What shipped, and how fast.',
      solution: 'What the product does, for a reader who has seen the numbers.',
      problem: 'The pain, briefly: the numbers already prove it.',
      team: 'Who scales it.',
      competition: 'Who else is here, and why you win.',
      roadmap: 'The objectives this round pays for.',
      round: 'What you are raising and on what terms.',
      use_of_funds: 'Where the money goes, against the roadmap.',
    },
    ['traction', 'unit_economics', 'market', 'team'],
  ),
  series_b_plus: ARC(
    ['title', 'traction', 'unit_economics', 'market', 'competition', 'product', 'roadmap', 'team', 'cap_table', 'round', 'use_of_funds'],
    {
      title: 'The venture and what it does, in a line.',
      traction: 'Later-stage investors read growth and its quality first.',
      unit_economics: 'Margins and payback decide the round.',
      market: 'How large the business can become.',
      competition: 'Who else is here, and the position you hold.',
      product: 'What shipped, and how fast.',
      roadmap: 'The objectives this round pays for.',
      team: 'Who runs the company at scale.',
      cap_table: 'Who holds the company today.',
      round: 'What you are raising and on what terms.',
      use_of_funds: 'Where the money goes, against the roadmap.',
    },
    ['traction', 'unit_economics', 'market', 'team'],
  ),
});

/** The evidence a pinned item may give each card (`EVIDENCE_RULES[].backs`), besides the card's own deck sources. */
export const CARD_BACKS: Record<string, readonly string[]> = Object.freeze({
  problem: ['interviews', 'customer_evidence'],
  validation: ['interviews', 'customer_evidence', 'icp_fit', 'lois', 'waitlist', 'pilots', 'demand', 'experiments'],
  traction: ['revenue', 'traction_proof', 'mrr', 'arr', 'paying_customers', 'growth', 'revenue_growth'],
  unit_economics: ['runway', 'burn', 'churn', 'cac'],
  team: ['team'],
  product: ['product_delivery', 'releases', 'commits_90d'],
  market: ['demand'],
  round: ['safe'],
  use_of_funds: ['use_of_funds_actuals', 'hiring_plan'],
  cap_table: ['vesting', 'safe'],
  roadmap: ['milestones', 'releases'],
});

/** The investor type's own words, for a lifted card's why line. */
const READER: Record<Audience, string> = {
  angel: 'Angels', pre_seed_fund: 'Pre-seed funds', seed_fund: 'Seed funds', series_a_fund: 'Series A funds',
  strategic: 'Strategic investors', grant: 'Grant panels', other: 'This reader',
};

export const LEFT_OUT_LINE = 'Left out · add data to include';
export const UNCHECKED_LINE = 'Its records could not be checked here.';

const titleOf = (card: string) => CARD_CATALOGUE.find((c) => c.card === card)?.title ?? card;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The card a saved slide is: `spec_id: 'new:<card>'` (D897), else a slide titled as a catalogue card. */
export function cardOfSlide(slide: any): string | null {
  const spec = typeof slide?.spec_id === 'string' ? slide.spec_id : '';
  if (spec.startsWith('new:')) {
    const id = spec.slice(4);
    if (CARD_CATALOGUE.some((c) => c.card === id)) return id;
  }
  const t = String(slide?.title ?? '').trim().toLowerCase();
  if (!t) return null;
  return CARD_CATALOGUE.find((c) => c.title.toLowerCase() === t || c.card.replace(/_/g, ' ') === t)?.card ?? null;
}

/** A stage from a word: the four stages, and the words New deck and `projects.stage` use for them. */
export function stageFrom(v: unknown): Stage | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((STAGES as readonly string[]).includes(s)) return s as Stage;
  if (s === 'preseed' || s === 'early' || s === 'idea' || s === 'validate') return 'pre_seed';
  if (s === 'later' || s === 'growth' || /^series_[b-z](_plus)?$/.test(s)) return 'series_b_plus';
  return null;
}

/** The stage an audience implies, when the deck names no stage. */
export const AUDIENCE_STAGE: Partial<Record<Audience, Stage>> = Object.freeze({
  angel: 'pre_seed', pre_seed_fund: 'pre_seed', seed_fund: 'seed', series_a_fund: 'series_a',
});

export type Proof = 'recorded' | 'missing' | 'unchecked';

/** Whether a card's proof is on record: a recorded deck source or a pinned item that backs it. */
export function proofOf(card: string, items: readonly SourceItem[], pinnedBacks: ReadonlySet<string>): Proof {
  if ((CARD_BACKS[card] ?? []).some((b) => pinnedBacks.has(b))) return 'recorded';
  const keys = CARD_CATALOGUE.find((c) => c.card === card)?.sources ?? [];
  if (!keys.length) return 'recorded'; // the title, why now: words, not records
  const states = keys.map((k) => items.find((i) => i.source_key === k)?.state ?? 'not_recorded');
  if (states.includes('recorded')) return 'recorded';
  if (states.some((s) => s === 'withheld' || s === 'unreadable')) return 'unchecked';
  return 'missing';
}

export type PlanRow = {
  card: string; title: string; why: string; weight: number; required: boolean;
  /** The card's position in the deck today (0-based), or null when the deck does not have it. */
  in_deck: number | null;
  proof: Proof;
};
export type Warning = { card: string; code: 'missing_card' | 'missing_proof' | 'unchecked_proof'; message: string; action: string };
export type Plan = {
  stage: Stage; stage_label: string; investor_type: Audience | null;
  order: PlanRow[];
  warnings: Warning[];
  /** The deck's cards the arc does not place, kept after it in their own order. */
  extra: string[];
};

/**
 * The arc for a stage and investor type over one deck's cards. `cards` is the
 * deck's cards in their order today (`cardOfSlide`); `items` the venture's
 * deck sources; `pinnedBacks` what its pinned evidence backs.
 */
export function planFor(input: {
  stage: Stage; investorType?: Audience | null; cards: readonly (string | null)[];
  items: readonly SourceItem[]; pinnedBacks?: ReadonlySet<string>;
}): Plan {
  const arc = ARCS[input.stage];
  const investor = input.investorType ?? null;
  const lead = investor ? AUDIENCE_EMPHASIS[investor].lead.filter((c) => arc.order.includes(c)) : [];
  const order = ['title', ...lead, ...arc.order.filter((c) => c !== 'title' && !lead.includes(c))];
  const pinned = input.pinnedBacks ?? new Set<string>();
  const label = STAGE_LABELS[input.stage];
  const rows: PlanRow[] = order.map((card) => {
    const required = arc.required.includes(card);
    const lifted = lead.includes(card);
    const at = input.cards.indexOf(card);
    return {
      card, title: titleOf(card),
      why: lifted && investor ? `${READER[investor]} read ${lower(titleOf(card))} first.` : arc.why[card],
      weight: required ? 3 : lifted ? 2 : 1,
      required,
      in_deck: at >= 0 ? at : null,
      proof: proofOf(card, input.items, pinned),
    };
  });
  const warnings: Warning[] = [];
  for (const r of rows.filter((x) => x.required)) {
    if (r.in_deck === null) {
      warnings.push({ card: r.card, code: 'missing_card', message: `${label} deck with no ${lower(r.title)} slide`, action: `Add a ${lower(r.title)} slide` });
    } else if (r.proof === 'missing') {
      warnings.push({ card: r.card, code: 'missing_proof', message: `${r.title} has no recorded evidence`, action: 'Add a source' });
    } else if (r.proof === 'unchecked') {
      warnings.push({ card: r.card, code: 'unchecked_proof', message: `${r.title}: ${UNCHECKED_LINE}`, action: 'Open its sources' });
    }
  }
  const extra = input.cards.filter((c): c is string => !!c && !order.includes(c));
  return { stage: input.stage, stage_label: label, investor_type: investor, order: rows, warnings, extra: [...new Set(extra)] };
}

/**
 * The one-click run's missing-data cut (dk-auto): every card the arc places,
 * in its order, unless it has no recorded proof, in which case it is left out
 * with `LEFT_OUT_LINE`. A required card with no proof is left out too, so a
 * deck shown with zero edits never holds a stage-required card with no
 * evidence. "Unchecked" proof is kept: the run cannot say it is missing.
 */
export function cutUnproven(plan: Plan): { keep: string[]; left_out: Array<{ card: string; title: string; line: string }> } {
  const keep: string[] = [];
  const left_out: Array<{ card: string; title: string; line: string }> = [];
  for (const r of plan.order) {
    if (r.proof === 'missing') left_out.push({ card: r.card, title: r.title, line: LEFT_OUT_LINE });
    else keep.push(r.card);
  }
  return { keep, left_out };
}
