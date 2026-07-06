/**
 * Task #19 — Best-Fit. Advisor fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the shared advisor/coach rubric in
 * axalFit.ts plus a domain skill axis and the 5 Axal values.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeTraitRows } from './fitShared.ts';

export const FIT_ADVISOR_BANK: Question[] = buildFitBank('advisor', [
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
  { key: 'values_align', prompt: 'How much do you advisor to genuinely help the founder rather than to advance your own interests?', measures: { rubric_category: 'values_alignment' } },
  { key: 'values_conflicts', prompt: 'How openly do you flag conflicts of interest instead of letting them sit unsaid?', measures: { rubric_category: 'values_alignment', red_flag: { key: 'transactional', at_or_below: 1 } } },
  // ---- skills breadth (the domains founders come to you for) ----------
  // Task #45 — advisors advise across the whole company, not just product; these
  // give the radar signal across ≥5 axes (domain_recency above covers product).
  { key: 'skill_gtm', prompt: 'How strong is your guidance on go-to-market and sales for the founders you help?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'gtm_sales' } },
  { key: 'skill_marketing', prompt: 'How strong is your guidance on marketing, positioning, and brand?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'marketing_brand' } },
  { key: 'skill_finance_ops', prompt: 'How strong is your guidance on finance, fundraising strategy, and operations?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'finance_ops' } },
  { key: 'skill_capital', prompt: 'How strong is your ability to open your network and capital doors for founders?', hint: '0 = not my area, 5 = a real strength.', measures: { skill_axis: 'capital_network' } },
  // ---- work values (Schwartz dims for a rounded values wheel) ---------
  { key: 'val_benevolence', prompt: 'How much is helping founders grow, for its own sake, a core motivation for you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_benevolence' } },
  { key: 'val_universalism', prompt: 'How much do fairness and the wider impact of the companies you help matter to you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_universalism' } },
  { key: 'val_self_direction', prompt: 'How much do you value advisoring on your own terms rather than to a set curriculum?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_self_direction' } },
  { key: 'val_achievement', prompt: 'How much does seeing the founders you back succeed measurably drive you?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_achievement' } },
  // ---- archetype traits ----------------------------------------------
  ...archetypeTraitRows(),
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
