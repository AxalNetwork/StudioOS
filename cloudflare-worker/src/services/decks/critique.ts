/**
 * D1552 (#3799, deck v2 C4) — the design critic: what is wrong with each card,
 * a score, and the fixes, as proposals the founder accepts.
 *
 *   codeFindings      free checks by code on every card: density (more
 *                     words than its role should hold, `DENSITY_MAX`), fit (a
 *                     text within that which overflows even at its smallest
 *                     step) and the theme's contrast (ink on ground, 4.5:1)
 *   visionFindings    the vision pass on each rendered card (DK9, "Slide
 *                     design feedback": `rail_vision`), read as at most three
 *                     notes per card; what it cannot read is no finding
 *   styleFindings     image-style drift: a picture on the deck drawn in
 *                     another style than the deck's art direction, with
 *                     "Match deck style"
 *   critiqueScore     the score: rubric v0 (D1517's `deckRubric`, the panel
 *                     D1518 names) less what the critic adds, so with no
 *                     added finding it is the rubric, never more than 5 off
 *   pickCritic        the vision model: DK9's, never of the writer's family
 *                     (#3804's rule); a model of the same family is passed over
 *   autoCritique      AUTO-5, the one-click run's in-run critic: shorten what
 *                     overflows, score again, at most `MAX_PASSES`, stop at the
 *                     threshold, and never spend past the quote
 *
 * Nothing here writes: the route keeps each fix as a rail proposal on the
 * deck (`deck:shorten`), the same shape a card's Shorten leaves, so the Ask's
 * "Waiting for you" sheet offers it with Accept and Accept all.
 */
import { DENSITY_MAX, fitText, textCapacity, typeRoleOf, type TypeRole } from './designSystem';
import { deckRubric } from './rubric';
import { criticModelFor } from './critic';
import { parseJsonLoose } from './autofill';
import type { Grid } from './slideModel';
import { jobStep, offerable } from '../ai/modelUseCases';

export const CRITIQUE_JOB = 'DK9';
/**
 * DK9's models ("Slide design feedback", the "Vision and checks" group), read from `ai/modelUseCases.ts` (D760's
 * catalogue), never listed here: its default, alternative and deeper, then its other choices, each one HQ offers.
 */
const dk9 = jobStep(CRITIQUE_JOB);
export const CRITIC_MODELS: readonly string[] = Object.freeze(
  dk9 ? [...new Set([dk9.default, dk9.alternative, dk9.deeper, ...dk9.more].filter((id): id is string => !!id && offerable(id)))] : [],
);
export const QUALITY_THRESHOLD = 75;
export const MAX_PASSES = 2;
export const VISION_NOTES_PER_CARD = 3;
export const NOTE_MAX = 160;
/** What each kind of finding costs the score, beyond what rubric v0 already counts. */
export const PENALTY = Object.freeze({ density: 3, contrast: 10, vision: 4, style: 3 });
export const CAP = Object.freeze({ vision: 20, style: 15 });

export type DeckAspect = '16:9' | '4:3';
export type Check = 'fit' | 'density' | 'contrast' | 'vision' | 'style';
export type Finding = {
  card: number; card_uid: string | null; block_id: string | null; check: Check;
  detail: string; fix: 'shorten' | 'match_style' | null;
  /** What a shorten fix works from: the block's words, the most it should say, and where it sits. */
  before?: string; limit?: number; grid?: Grid; role?: TypeRole;
};

const cardsOf = (slides: unknown): any[] => (Array.isArray(slides) ? slides : []);
const isAppendix = (c: any) => Boolean(c?.appendix);
const gridOf = (g: any): Grid | null => (g && ['c1', 'c2', 'r1', 'r2'].every((k) => Number.isInteger(g[k])) ? g : null);

/** Fit and density on every text block, and the theme's contrast once for the deck. Appendix cards are reference tables and are not checked. */
export function codeFindings(slides: unknown, opts: { aspect: DeckAspect; contrastAa: boolean | null }): Finding[] {
  const out: Finding[] = [];
  cardsOf(slides).forEach((card, i) => {
    if (isAppendix(card)) return;
    for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
      if (b?.kind !== 'text') continue;
      const grid = gridOf(b.grid);
      const text = String(b.text ?? '').trim();
      if (!grid || !text) continue;
      const role: TypeRole = typeRoleOf(b.style, card?.layout ?? null);
      const limit = Math.max(8, Math.min(textCapacity(grid, role, opts.aspect).chars, DENSITY_MAX[role]));
      const base = { card: i, card_uid: typeof card?.uid === 'string' ? card.uid : null, block_id: b.id != null ? String(b.id) : null, before: text, limit, grid, role };
      // A text over its role's most is density, whatever the space (fit caps a range at that most too, so it is read first);
      // otherwise one that does not fit even at its smallest step overflows.
      if (text.length > DENSITY_MAX[role]) out.push({ ...base, check: 'density', detail: `${text.length} characters where a ${role} should say at most ${DENSITY_MAX[role]}.`, fix: 'shorten' });
      else if (!fitText(grid, role, text, opts.aspect).fits) out.push({ ...base, check: 'fit', detail: `Overflows its area by about ${Math.max(1, text.length - limit)} characters.`, fix: 'shorten' });
    }
  });
  if (opts.contrastAa === false) out.push({ card: -1, card_uid: null, block_id: null, check: 'contrast', detail: "The theme's text on its background is below 4.5:1. Pick a theme with more contrast.", fix: null });
  return out;
}

/** The vision pass's question, and its answer read as at most three short notes. */
export const VISION_QUESTION = 'You review one pitch-deck slide for layout only. List at most three problems a designer would fix: crowding, alignment, hierarchy, contrast or legibility. Answer only JSON: {"issues":[{"kind":"crowding|alignment|hierarchy|contrast|legibility","note":"one short sentence"}]}. If the slide is clean, answer {"issues":[]}. Never comment on the words or the numbers.';
const VISION_KINDS = new Set(['crowding', 'alignment', 'hierarchy', 'contrast', 'legibility']);
export function visionFindings(card: number, cardUid: string | null, answer: unknown): Finding[] | null {
  const parsed = parseJsonLoose<any>(typeof answer === 'string' ? answer : '');
  if (!parsed || !Array.isArray(parsed.issues)) return null;
  return parsed.issues
    .filter((x: any) => VISION_KINDS.has(String(x?.kind)) && typeof x?.note === 'string' && x.note.trim())
    .slice(0, VISION_NOTES_PER_CARD)
    .map((x: any) => ({ card, card_uid: cardUid, block_id: null, check: 'vision' as const, detail: `${x.kind[0].toUpperCase()}${x.kind.slice(1)}: ${String(x.note).trim().slice(0, NOTE_MAX)}`, fix: null }));
}

/** Image-style drift: a picture on a card drawn in another style than the deck's art direction. */
export function styleFindings(slides: unknown, images: ReadonlyArray<{ uid: string; style: string | null }>, deckStyle: string | null): Finding[] {
  if (!deckStyle) return [];
  const byUid = new Map(images.map((x) => [x.uid, x.style]));
  const out: Finding[] = [];
  cardsOf(slides).forEach((card, i) => {
    for (const b of Array.isArray(card?.blocks) ? card.blocks : []) {
      if (b?.kind !== 'image' || typeof b.image_id !== 'string') continue;
      const style = byUid.get(b.image_id);
      if (style && style !== deckStyle) {
        out.push({ card: i, card_uid: typeof card?.uid === 'string' ? card.uid : null, block_id: b.id != null ? String(b.id) : null, check: 'style', detail: `Drawn as ${style}; the deck's art direction is ${deckStyle}. Match deck style.`, fix: 'match_style' });
      }
    }
  });
  return out;
}

/** The deck's score out of 100: rubric v0 less what the critic adds, and each card's own. */
export function critiqueScore(slides: unknown, findings: readonly Finding[]): { score: number; rubric: number; cards: Array<{ card: number; score: number }> } {
  const rubric = deckRubric(slides).score;
  const n = (c: Check) => findings.filter((f) => f.check === c).length;
  const added = n('density') * PENALTY.density + n('contrast') * PENALTY.contrast
    + Math.min(CAP.vision, n('vision') * PENALTY.vision) + Math.min(CAP.style, n('style') * PENALTY.style);
  const score = Math.max(0, Math.min(100, rubric - added));
  const cards = cardsOf(slides).map((_, i) => {
    const mine = findings.filter((f) => f.card === i);
    const p = mine.reduce((s, f) => s + (f.check === 'fit' ? 15 : PENALTY[f.check as keyof typeof PENALTY] ?? 0), 0);
    return { card: i, score: Math.max(0, 100 - p) };
  });
  return { score, rubric, cards };
}

/** DK9's first model whose family is not the writer's (#3804's rule, `criticModelFor`); null when none, or the writer is unknown. */
export const pickCritic = (writerModel: string | null | undefined): string | null => criticModelFor(CRITIC_MODELS, writerModel);

/** Why a finding no shortening fixes is left for the founder, or null for a vision note (shown as a note). */
export function leftReason(f: Finding): string | null {
  if (f.check === 'contrast') return 'Change it in Theme.';
  if (f.check === 'style') return 'Open the picture and choose Match deck style.';
  return null;
}

/** "What we fixed": one line per applied fix. */
export const fixedLine = (f: Finding) => `Card ${f.card + 1}: ${f.check === 'fit' ? 'shortened to fit its area' : 'shortened to read in seconds'}`;

// ---- AUTO-5: the one-click run's in-run critic ---------------------------------

export type AutoDeps = {
  /** Shortens a block's words to at most `limit` characters under the run's hold; null when it could not (refused, failed, or still too long). */
  shorten: (f: Finding) => Promise<{ after: string; charged_microusd: number } | null>;
  /** What one shorten run holds at most, from its quote. */
  perFixMicrousd: number;
  /** What the critic may spend in all, from the run's one quote. */
  budgetMicrousd: number;
  threshold?: number;
  maxPasses?: number;
  aspect: DeckAspect;
  contrastAa: boolean | null;
};
export type AutoResult = {
  slides: any[]; score: number; before: number; passes: number; met: boolean;
  /** What was fixed, and every finding still on the deck, met or not. */
  fixed: string[]; reported: Finding[]; charged_microusd: number;
};

function applyText(slides: any[], f: Finding, after: string): any[] {
  return slides.map((card, i) => (i !== f.card ? card : {
    ...card,
    blocks: (card.blocks || []).map((b: any) => (String(b?.id) === f.block_id && b?.kind === 'text' && String(b.text ?? '').trim() === f.before ? { ...b, text: after } : b)),
  }));
}

/**
 * Score the deck; while it is under the threshold, shorten what overflows or
 * crowds, at most `maxPasses` times, and only while the next fix fits in what
 * is left of the budget, so a pass never spends past the quote. Returns the
 * fixed slides (new arrays: nothing is changed in place or saved here), the
 * final score, what was fixed, and what is left to report.
 */
export async function autoCritique(slides0: unknown, deps: AutoDeps): Promise<AutoResult> {
  const threshold = deps.threshold ?? QUALITY_THRESHOLD;
  const maxPasses = Math.max(0, Math.min(MAX_PASSES, deps.maxPasses ?? MAX_PASSES));
  let slides = cardsOf(slides0);
  const opts = { aspect: deps.aspect, contrastAa: deps.contrastAa };
  let findings = codeFindings(slides, opts);
  const before = critiqueScore(slides, findings).score;
  let score = before;
  let charged = 0;
  let passes = 0;
  const fixed: string[] = [];
  while (score < threshold && passes < maxPasses) {
    const todo = findings.filter((f) => f.fix === 'shorten');
    if (!todo.length) break;
    passes += 1;
    let changed = false;
    for (const f of todo) {
      if (charged + deps.perFixMicrousd > deps.budgetMicrousd) break;
      const r = await deps.shorten(f);
      if (!r) continue;
      charged += Math.min(deps.perFixMicrousd, Math.max(0, r.charged_microusd));
      slides = applyText(slides, f, r.after);
      fixed.push(fixedLine(f));
      changed = true;
    }
    findings = codeFindings(slides, opts);
    score = critiqueScore(slides, findings).score;
    if (!changed) break;
  }
  return { slides, score, before, passes, met: score >= threshold, fixed, reported: findings, charged_microusd: charged };
}
