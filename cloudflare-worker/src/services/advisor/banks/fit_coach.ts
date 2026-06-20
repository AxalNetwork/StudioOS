/**
 * Task #19 — Best-Fit. Coach fit bank.
 *
 * Coach has no advisor role of its own, so these questions are delivered inside
 * the mentor conversation (Question.persona = 'mentor') but keep the
 * `fit.coach.*` id prefix so axalFit.ts scores them against the coach rubric
 * (shared with mentor). Behavioral self-ratings (0–5) + the 5 Axal values.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows } from './fitShared.ts';

export const FIT_COACH_BANK: Question[] = buildFitBank('coach', [
  // ---- domain_expertise -----------------------------------------------
  { key: 'domain_method', prompt: 'How well-developed is your coaching method — a repeatable way you help people grow?', measures: { rubric_category: 'domain_expertise' } },
  { key: 'domain_breadth', prompt: 'How broad is the range of founder situations you can coach across with confidence?', measures: { rubric_category: 'domain_expertise' } },
  // ---- teaching_ability -----------------------------------------------
  { key: 'teach_actionable', prompt: 'How consistently do founders leave a session with something concrete they can act on?', measures: { rubric_category: 'teaching_ability' } },
  { key: 'teach_accountability', prompt: 'How effectively do you hold founders accountable to what they said they would do?', measures: { rubric_category: 'teaching_ability' } },
  // ---- listening ------------------------------------------------------
  { key: 'listen_deep', prompt: 'How well do you hear what a founder is not saying, not just their words?', measures: { rubric_category: 'listening' } },
  { key: 'listen_nonjudgmental', prompt: 'How safe do founders feel being honest with you about what is really going wrong?', measures: { rubric_category: 'listening' } },
  // ---- founder_empathy ------------------------------------------------
  { key: 'empathy_founder', prompt: 'How deeply do you understand the isolation and pressure of being a founder?', measures: { rubric_category: 'founder_empathy' } },
  { key: 'empathy_holding', prompt: 'How well do you hold space for a founder in a genuinely hard moment?', measures: { rubric_category: 'founder_empathy' } },
  // ---- reliability ----------------------------------------------------
  { key: 'reliable_consistency', prompt: 'How consistent and dependable is the cadence you keep with the people you coach?', measures: { rubric_category: 'reliability', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'reliable_boundaries', prompt: 'How well do you keep clear, healthy boundaries while still being available?', measures: { rubric_category: 'reliability' } },
  // ---- values_alignment -----------------------------------------------
  { key: 'values_align', prompt: 'How much do you coach toward the founder’s own goals rather than the outcome you would pick?', measures: { rubric_category: 'values_alignment' } },
  { key: 'values_ethics', prompt: 'How firmly do you keep the coaching relationship ethical and free of hidden agendas?', measures: { rubric_category: 'values_alignment', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
