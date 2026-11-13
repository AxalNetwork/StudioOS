/**
 * D1551 (#3798, deck v2 C3) — text ensembles on the generation runtime.
 *
 * A text area is written one of three ways:
 *   single        one call per variant (today's areas, D1512);
 *   draft_refine  each variant is drafted, then refined by the same model
 *                 #3754 routes the element to: a second call that reads the
 *                 draft (the one-click build's default, AUTO-1);
 *   best_of_n     n drafts (2 or 3), then B7's judge (`judge.ts`, D1525)
 *                 ranks them blind under the family rule and names the best.
 *
 * ONE QUOTE, ONE HOLD (AUTO-6). An ensemble is not a second run. Every call it
 * makes is a line of the run's plan, priced at its run's maximum when the run
 * is quoted, so the quote, and the run's one parent hold, already holds the
 * refine or the judge. Nothing an ensemble does takes a hold of its own.
 *
 * ORDER. A refine line names its draft and a judge line its drafts (`after`,
 * the steps' sequence numbers in the run); the runtime claims a line only
 * once every line it is after has ended (`genRuntime.ts`). A refine whose
 * draft failed fails too, and the draft's failure stands; a judge with fewer
 * than two drafts to compare is refused, and every draft stays acceptable.
 *
 * No model id is named here: the refine runs the draft's model, and the judge
 * the first `decide` model outside the drafts' families (D1525).
 */
import { untrustedBlock, withUntrustedRule } from '../ai/untrusted';

export const ENSEMBLE_MODES = ['single', 'draft_refine', 'best_of_n'] as const;
export type EnsembleMode = (typeof ENSEMBLE_MODES)[number];
/** best-of-n writes this many drafts (B7's judge compares at most three). */
export const BEST_OF_N = 3;

/** The ensemble a request asks for; a whole-deck build refines by default, an areas run writes once. */
export function ensembleOf(value: unknown, cls: 'areas' | 'deck_build'): EnsembleMode {
  if (typeof value === 'string' && (ENSEMBLE_MODES as readonly string[]).includes(value)) return value as EnsembleMode;
  return cls === 'deck_build' ? 'draft_refine' : 'single';
}

/** A step's ensemble role, as a run's progress rows name it. */
export type StepRole = 'draft' | 'refine' | 'judge' | 'variant';
export function roleOf(kind: string, input: Record<string, unknown> | null): StepRole {
  if (kind === 'refine') return 'refine';
  if (kind === 'judge') return 'judge';
  return input && typeof input.ensemble === 'string' && input.ensemble !== 'single' ? 'draft' : 'variant';
}

/** The refine call: the draft as data, the card's own words as data, and the same limit. */
export function refineMessages(opts: { label: string; limit: number; voice: string; card: string }, draft: string): { systemPrompt: string; user: string } {
  const systemPrompt = withUntrustedRule(`${opts.voice} You improve one draft ${opts.label} for a pitch-deck card. Make it clearer, more specific and tighter, at most ${opts.limit} characters. Keep only facts, names and figures the card or the draft already contains; add none, and never add a number. Answer with the improved words only.`);
  const user = `Card:\n${untrustedBlock('deck_import', opts.card)}\n\nDraft:\n${untrustedBlock('deck_import', draft)}`;
  return { systemPrompt, user };
}

/** A filler of `chars` characters, so a refine or judge line is quoted at the most its input can be. */
export const filler = (chars: number) => 'x'.repeat(Math.max(0, Math.floor(chars)));

/** What a done text step wrote, from its stored result; null when it wrote no words. */
export function wordsOf(result: string | null | undefined): string | null {
  if (!result) return null;
  try { const r = JSON.parse(result); const t = typeof r?.text === 'string' ? r.text.trim() : ''; return t || null; } catch { return null; }
}

/** The `after` sequence numbers a step's input names (its draft, or its drafts). */
export function afterOf(input: Record<string, unknown> | null | undefined): number[] {
  const a = input?.after;
  return Array.isArray(a) ? a.map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0) : [];
}

/**
 * Resolve each line's `after_back` (how many lines before it, within its area)
 * into `after`, the run's sequence numbers: the runtime numbers lines by their
 * place in the plan (`admit`), so a whole plan's offsets become absolute here.
 */
export function resolveAfter<T extends { input?: Record<string, unknown> | null }>(lines: T[]): T[] {
  return lines.map((l, i) => {
    const back = l.input?.after_back;
    if (!Array.isArray(back)) return l;
    const after = back.map(Number).filter((b) => Number.isSafeInteger(b) && b > 0 && i - b >= 0).map((b) => i - b);
    const { after_back: _drop, ...rest } = l.input as Record<string, unknown>;
    return { ...l, input: { ...rest, after } };
  });
}
