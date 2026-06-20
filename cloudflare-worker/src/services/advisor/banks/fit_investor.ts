/**
 * Task #19 — Best-Fit. Investor fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the investor rubric in axalFit.ts plus
 * capital/network skill axes and the 5 Axal values. value_dim risk/growth
 * prompts are authored so 5 = the dimension's `pole_high`.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows } from './fitShared.ts';

export const FIT_INVESTOR_BANK: Question[] = buildFitBank('investor', [
  // ---- thesis_fit -----------------------------------------------------
  { key: 'thesis_focus', prompt: 'How sharply defined is the thesis you invest against — the kind of company you back over and over?', measures: { rubric_category: 'thesis_fit' } },
  { key: 'thesis_conviction', prompt: 'How willing are you to lead a round on conviction before the rest of the market agrees?', measures: { rubric_category: 'thesis_fit' } },
  // ---- capital_quality ------------------------------------------------
  { key: 'capital_dry_powder', prompt: 'How dependable is your capital — do you have the reserves to actually deploy when you commit?', measures: { rubric_category: 'capital_quality', skill_axis: 'capital_network' } },
  { key: 'capital_followon', prompt: 'How reliably do you support winners with follow-on capital in later rounds?', measures: { rubric_category: 'capital_quality', skill_axis: 'finance_ops' } },
  // ---- governance_style -----------------------------------------------
  { key: 'gov_board_value', prompt: 'How much real value do you add in the board room beyond the cheque?', measures: { rubric_category: 'governance_style' } },
  { key: 'gov_founder_respect', prompt: 'How well do you let founders run their company rather than steering from the back seat?', measures: { rubric_category: 'governance_style', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
  // ---- reputation -----------------------------------------------------
  { key: 'rep_references', prompt: 'If a founder called three people you backed who struggled, how strong would your reference be?', measures: { rubric_category: 'reputation' } },
  { key: 'rep_conduct', prompt: 'How consistently do you behave well when a deal goes sideways and incentives get tense?', measures: { rubric_category: 'reputation', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- decision_quality -----------------------------------------------
  { key: 'decision_diligence', prompt: 'How rigorous is your diligence — do you do the work to understand what you are backing?', measures: { rubric_category: 'decision_quality' } },
  { key: 'decision_consistency', prompt: 'How consistent are the reasons you give for a decision before and after the outcome is known?', measures: { rubric_category: 'decision_quality', red_flag: { key: 'inconsistent_stories', at_or_below: 1 } } },
  // ---- values_fit -----------------------------------------------------
  { key: 'values_alignment', prompt: 'How much do you optimise for the long-term health of the company over your own near-term return?', measures: { rubric_category: 'values_fit' } },
  { key: 'values_patience', prompt: 'How patient are you with durable, sustainable building versus pushing for aggressive growth?', hint: '0 = patient / sustainable, 5 = pushes hyper-growth.', measures: { rubric_category: 'values_fit', value_dim: 'founder_growth_vs_sustain' } },
  // ---- risk spectrum (5 = pole_high) ----------------------------------
  { key: 'lean_risk', prompt: 'How comfortable are you backing earlier, riskier bets versus waiting for more proof?', hint: '0 = risk-averse, 5 = risk-seeking.', measures: { value_dim: 'founder_risk_appetite' } },
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
