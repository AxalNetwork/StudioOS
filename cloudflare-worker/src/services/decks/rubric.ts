/**
 * D1517 (#3769, deck v2 A6) — the code rubric for a generated deck's quality
 * floor. Pure: no env, no D1, no model. It scores what code can check, out of
 * 100, and names every deduction; the gate is 70 (`RUBRIC_GATE`) on the three
 * sample ventures (`cloudflare-worker/test/fixtures/pitchStoryFixtures.ts`).
 *
 *   fit         a block that overflows even at its smallest step     −15 each
 *   titles      a title line of one word the balance could not mend  −4 each
 *   headings    a card without a heading                             −8 each
 *   charts      a chart type `slideModel.ts` does not draw             −10 each
 *   variety     fewer distinct layouts than a third of the cards      −10
 *   gaps        a "Not recorded" line on a card                       −2 each, at most −20
 *
 * A gap is a record the venture has not made, not a fault of the deck; it
 * costs little so a sparse venture's honest deck still passes, and the
 * one-click bar (no placeholder at all) is measured apart by `placeholders`.
 * A theme's legibility is not scored here: every one of the six passes
 * `themeProblems` by test, so a deck in any of them reads.
 */
import { CHART_TYPES } from './slideModel';
import { fitProblems } from './designSystem';

export const RUBRIC_GATE = 70;
const NOT_RECORDED = /\bNot recorded\b/;

export type RubricCheck = { id: 'fit' | 'titles' | 'headings' | 'charts' | 'variety' | 'gaps'; penalty: number; detail: string };

/** How many "Not recorded" lines the deck's cards draw (the one-click bar wants none). */
export function placeholders(slides: unknown): number {
  let n = 0;
  for (const s of Array.isArray(slides) ? slides : []) {
    for (const b of Array.isArray((s as any)?.blocks) ? (s as any).blocks : []) {
      if (b?.kind === 'text' && NOT_RECORDED.test(String(b.text ?? ''))) n += 1;
      if (b?.kind === 'metric' && (b.value == null || b.value === '')) n += 1;
    }
  }
  return n;
}

/** The deck's score and every deduction, by code. Appendix cards are reference tables and are not scored. */
export function deckRubric(slides: unknown): { score: number; checks: RubricCheck[] } {
  const cards = (Array.isArray(slides) ? slides : []).filter((s: any) => !s?.appendix);
  const checks: RubricCheck[] = [];
  const problems = fitProblems(cards);
  const overflow = problems.filter((p) => p.kind !== 'single_word_line');
  if (overflow.length) checks.push({ id: 'fit', penalty: 15 * overflow.length, detail: overflow.map((p) => p.message).join(' ') });
  const orphans = problems.filter((p) => p.kind === 'single_word_line');
  if (orphans.length) checks.push({ id: 'titles', penalty: 4 * orphans.length, detail: `${orphans.length} title line(s) of one word.` });
  const headless = cards.filter((s: any) => !(s?.blocks ?? []).some((b: any) => b?.kind === 'text' && b.style === 'heading' && String(b.text ?? '').trim()));
  if (headless.length) checks.push({ id: 'headings', penalty: 8 * headless.length, detail: `${headless.length} card(s) without a heading.` });
  const badCharts = cards.flatMap((s: any) => (s?.blocks ?? []).filter((b: any) => b?.kind === 'chart' && !(CHART_TYPES as readonly string[]).includes(b.chart_type)));
  if (badCharts.length) checks.push({ id: 'charts', penalty: 10 * badCharts.length, detail: `${badCharts.length} chart(s) of a type the deck cannot draw.` });
  const layouts = new Set(cards.map((s: any) => s?.layout).filter(Boolean));
  if (cards.length >= 3 && layouts.size < Math.ceil(cards.length / 3)) checks.push({ id: 'variety', penalty: 10, detail: `${layouts.size} layout(s) across ${cards.length} cards.` });
  const gaps = placeholders(cards);
  if (gaps) checks.push({ id: 'gaps', penalty: Math.min(20, 2 * gaps), detail: `${gaps} figure(s) not recorded yet.` });
  const score = Math.max(0, 100 - checks.reduce((t, c) => t + c.penalty, 0));
  return { score, checks };
}
