/**
 * D1503 (#3754, deck v2 A10) — what each grid element's output may hold.
 * Pure. Split from `elementModels.ts` because it reads `newDeck.ts`
 * (`numberIn`, `figureRefusal`), which `railMatrix.ts` must not import.
 *
 * A figure comes from a record or not at all: a request that states one is
 * refused before any run (`inputRefusal`), words the model wrote that name
 * one are refused, and a value is placed only with its record's binding
 * (`outputProblems`). An image places no figure.
 */
import { ROUTED_ELEMENTS, SHAPE_OF, isRouted, type Shape } from './elementModels';
import { figureRefusal, numberIn, type FigureRefusal } from './newDeck';

// ---------------------------------------------------------------------------
// Output rules: a figure comes from a record, or not at all
// ---------------------------------------------------------------------------

export type OutputRule = {
  /** `records_only`: every figure is a bound record value, never words the model wrote; `none`: the output carries no figure. */
  figures: 'records_only' | 'none';
  /** The longest text the element places, in characters; null for a picture. */
  maxChars: number | null;
  maxItems: number | null;
  /** What the model returns: words, labelled rows or steps, or a picture. */
  output: 'text' | 'rows' | 'steps' | 'image';
};

const RULE_OF: Readonly<Record<Shape, OutputRule>> = Object.freeze({
  line: { figures: 'records_only', maxChars: 90, maxItems: 1, output: 'text' },
  paragraph: { figures: 'records_only', maxChars: 600, maxItems: 1, output: 'text' },
  list: { figures: 'records_only', maxChars: 400, maxItems: 6, output: 'text' },
  notes: { figures: 'records_only', maxChars: 1500, maxItems: 1, output: 'text' },
  data: { figures: 'records_only', maxChars: 1200, maxItems: 12, output: 'rows' },
  diagram: { figures: 'records_only', maxChars: 600, maxItems: 8, output: 'steps' },
  venture: { figures: 'records_only', maxChars: 900, maxItems: 10, output: 'rows' },
  image: { figures: 'none', maxChars: null, maxItems: null, output: 'image' },
  edit: { figures: 'none', maxChars: null, maxItems: null, output: 'image' },
});

/** Every routed element's rules. */
export const OUTPUT_RULES: Readonly<Record<string, OutputRule>> = Object.freeze(Object.fromEntries(ROUTED_ELEMENTS.map((id) => [id, RULE_OF[SHAPE_OF[id]]])));

/** What a request for the element may not say: a figure (D897: a prompt is never a source). */
export function inputRefusal(element: string, text: unknown, projectId: number): FigureRefusal | null {
  if (!isRouted(element)) return null;
  return figureRefusal(text, projectId, OUTPUT_RULES[element].output === 'image' ? 'an image description' : 'the prompt');
}

/** One piece of what a run returned: text the model wrote, or a value code placed with its record's binding. */
export type OutputPiece = { text?: string | null; value?: unknown; binding?: { grade?: string; snapshot_hash?: string } | null };

/**
 * Why an element's output may not be placed, as problems; empty when it may.
 * A figure in text the model wrote is refused for every element; a value is
 * kept only with a binding to a record (`records_only`), and an image element
 * places no text at all beyond its alt text, which carries no figure.
 */
export function outputProblems(element: string, pieces: readonly OutputPiece[]): string[] {
  const rule = OUTPUT_RULES[element];
  if (!rule) return [`${element} runs no model`];
  const out: string[] = [];
  const bound = (p: OutputPiece) => !!p.binding && p.binding.grade !== 'Not recorded' && !!p.binding.snapshot_hash;
  if (rule.maxItems != null && pieces.length > rule.maxItems) out.push(`${element}: at most ${rule.maxItems} items`);
  for (const p of pieces) {
    const fig = numberIn(p.text ?? null);
    if (fig) out.push(`${element}: "${fig}" is a figure in words the model wrote`);
    if (rule.maxChars != null && typeof p.text === 'string' && p.text.length > rule.maxChars) out.push(`${element}: longer than ${rule.maxChars} characters`);
    if (p.value != null) {
      if (rule.figures === 'none') out.push(`${element}: places no figure`);
      else if (!bound(p)) out.push(`${element}: a figure with no record behind it`);
    }
  }
  return out;
}

