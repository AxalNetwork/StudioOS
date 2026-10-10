/**
 * D663 follow-up (#1524 item 3) — Eadwyn phrases the fix for one narrative
 * mismatch, on request: the `raise/narrative-fix` draft band on Investor
 * narrative.
 *
 * THE CHECK IS COMPUTED AND STAYS COMPUTED. `consistencyCheck` (D663 part 2)
 * finds each figure the narrative states differently from the stored metrics
 * and stores it in `narrative_checks` with both values and both sources. This
 * file only hands ONE of those rows to the model and holds what comes back to
 * it, so the wording can never be wider than the check:
 *
 * - the material is the row and nothing else — no other figure, no project
 *   name, no narrative text the check did not read;
 * - `unfoundFigures` refuses a draft that quotes any figure the row does not
 *   carry, so a model that "helpfully" rounds, projects or invents a third
 *   number writes no draft at all;
 * - `finishNarrativeFix` ends every kept draft with the check's own sentence,
 *   so both figures and both sources are cited whatever the model wrote.
 *
 * NEITHER SIDE IS PICKED. The stored metric is not presumed right: a narrative
 * written last week can be newer than a snapshot from last quarter. The
 * instruction offers both corrections and says which record each one changes.
 */
import type { Env } from '../types';
import { agrees, FIGURE_LABEL, fmtFigure, mismatchSentence, type FigureKey, type Mismatch } from './raiseCycle';

export const NARRATIVE_FIX_INSTRUCTION = [
  'Phrase the fix for the one mismatch below, between what the founder\'s narrative states and what the stored metrics hold.',
  'Name both figures and both sources exactly as given.',
  'Do not say or imply which figure is right: give one wording that brings the narrative to the stored figure, and say that if the narrative\'s figure is the current one, the stored metric is the record to correct instead.',
  'Quote no other figure, date or number. Nothing else was checked.',
].join(' ');

/**
 * The first mismatch the check stored for the project's newest narrative
 * version — the version the Investor narrative card reads — or null when that
 * version has none. Another project's rows are never read: the caller passes a
 * project the ownership check already resolved.
 */
export async function narrativeMismatch(env: Env, projectId: number): Promise<Mismatch | null> {
  const row = await env.DB.prepare(
    `SELECT c.figure, c.stated_value, c.stated_source, c.metric_value, c.metric_source
       FROM narrative_checks c
      WHERE c.project_id = ?
        AND c.version = (SELECT MAX(o.version) FROM spinout_deck_overrides o WHERE o.project_id = ? AND o.version > 0)
      ORDER BY c.id ASC LIMIT 1`,
  ).bind(projectId, projectId).first<Mismatch>();
  if (!row || !Object.hasOwn(FIGURE_LABEL, row.figure)) return null;
  return {
    figure: row.figure as FigureKey,
    stated_value: Number(row.stated_value), stated_source: String(row.stated_source),
    metric_value: Number(row.metric_value), metric_source: String(row.metric_source),
  };
}

/** The lines the model reads: the row, and that it is all there is. */
export function narrativeFixMaterial(m: Mismatch): string[] {
  return [
    `Figure: ${FIGURE_LABEL[m.figure]}`,
    `The narrative states ${fmtFigure(m.figure, m.stated_value)} (source: ${m.stated_source}).`,
    `The stored metrics hold ${fmtFigure(m.figure, m.metric_value)} (source: ${m.metric_source}).`,
    'Nothing records which of the two is current.',
  ];
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\b/gi;

/**
 * Every number the drafted text states that the check did not find. A number
 * is found when, read with its scale, it agrees with either figure, or when
 * its digits appear in either source (a snapshot's date is part of its
 * source). Empty means the draft quotes only what the check found.
 */
export function unfoundFigures(text: string, m: Mismatch): string[] {
  const sources = `${m.stated_source} ${m.metric_source}`;
  const out: string[] = [];
  for (const [whole, digits, scale] of String(text ?? '').matchAll(NUMBER)) {
    const n = Number(digits.replace(/,/g, '')) * (scale ? SCALE[scale.toLowerCase()] ?? 1 : 1);
    if (Number.isFinite(n) && (agrees(n, m.stated_value) || agrees(n, m.metric_value))) continue;
    if (!scale && sources.includes(digits)) continue;
    out.push(whole.trim());
  }
  return out;
}

/**
 * What is stored for a drafted fix: the model's wording followed by the
 * check's own sentence, or null — no draft — when the wording quotes a figure
 * the check did not find.
 */
export function finishNarrativeFix(text: string, m: Mismatch): string | null {
  if (unfoundFigures(text, m).length) return null;
  return `${text.trim()}\n\nAs the check found them: ${mismatchSentence(m)}.`;
}
