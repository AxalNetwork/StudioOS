/**
 * Task #19 — Best-Fit. Mentor fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the shared mentor/coach rubric in
 * axalFit.ts plus a domain skill axis and the 5 Axal values.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows } from './fitShared.ts';

export const FIT_MENTOR_BANK: Question[] = buildFitBank('mentor', [
  // ---- domain_expertise -----------------------------------------------
  { key: 'domain_depth', prompt: 'How deep is your earned expertise in the areas founders come to you for?', measures: { rubric_category: 'domain_expertise' } },
  { key: 'domain_recency', prompt: 'How current is that expertise — are you close to how the work is done today, not a decade ago?', measures: { rubric_category: 'domain_expertise', skill_axis: 'product' } },
  // ---- teaching_ability -----------------------------------------------
  { key: 'teach_clarity', prompt: 'How well do you make a hard concept click for someone who is new to it?', measures: { rubric_category: 'teaching_ability' } },
  { key: 'teach_frameworks', prompt: 'How effectively do you give founders reusable frameworks rather than one-off answers?', measures: { rubric_category: 'teaching_ability' } },
  // ---- listening ------------------------------------------------------
  { key: 'listen_questions', prompt: 'How often do you ask questions to understand before offering your view?', measures: { rubric_category: 'listening' } },
  { key: 'listen_patience', prompt: 'How well do you resist jumping straight to your own answer before a founder finishes?', measures: { rubric_category: 'listening', red_flag: { key: 'overconfidence', at_or_below: 1 } } },
  // ---- founder_empathy ------------------------------------------------
  { key: 'empathy_walked', prompt: 'How well do you understand the emotional reality of building, not just the tactics?', measures: { rubric_category: 'founder_empathy' } },
  { key: 'empathy_pressure', prompt: 'How attuned are you to when a founder needs support versus a push?', measures: { rubric_category: 'founder_empathy' } },
  // ---- reliability ----------------------------------------------------
  { key: 'reliable_showup', prompt: 'How reliably do you show up for the sessions and commitments you make to founders?', measures: { rubric_category: 'reliability', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'reliable_prep', prompt: 'How well do you come prepared rather than winging each conversation?', measures: { rubric_category: 'reliability' } },
  // ---- values_alignment -----------------------------------------------
  { key: 'values_align', prompt: 'How much do you mentor to genuinely help the founder rather than to advance your own interests?', measures: { rubric_category: 'values_alignment' } },
  { key: 'values_conflicts', prompt: 'How openly do you flag conflicts of interest instead of letting them sit unsaid?', measures: { rubric_category: 'values_alignment', red_flag: { key: 'transactional', at_or_below: 1 } } },
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
