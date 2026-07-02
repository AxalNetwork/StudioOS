/**
 * Task #19 — Best-Fit. Operating-partner fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the partner rubric in axalFit.ts plus
 * network/GTM skill axes and the 5 Axal values.
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeTraitRows } from './fitShared.ts';

export const FIT_PARTNER_BANK: Question[] = buildFitBank('partner', [
  // ---- strategic_alignment --------------------------------------------
  { key: 'strat_thesis', prompt: 'How closely does your own focus overlap with the kinds of companies the studio builds?', measures: { rubric_category: 'strategic_alignment' } },
  { key: 'strat_portfolio_fit', prompt: 'How well do you tailor your support to where a company actually is, rather than a one-size playbook?', measures: { rubric_category: 'strategic_alignment' } },
  // ---- trustworthiness ------------------------------------------------
  { key: 'trust_reliability', prompt: 'When you commit to a deliverable for a portfolio company, how reliably does it land on time?', measures: { rubric_category: 'trustworthiness', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'trust_confidentiality', prompt: 'How carefully do you protect sensitive information shared with you across companies?', measures: { rubric_category: 'trustworthiness', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- network_quality ------------------------------------------------
  { key: 'network_depth', prompt: 'How deep and relevant is the network you can open up for the companies you support?', measures: { rubric_category: 'network_quality', skill_axis: 'capital_network' } },
  { key: 'network_activation', prompt: 'How readily do you actually make warm introductions rather than just promising them?', measures: { rubric_category: 'network_quality' } },
  // ---- execution_support ----------------------------------------------
  { key: 'exec_hands_on', prompt: 'How willing are you to roll up your sleeves and do the work alongside a founder, not just advise?', measures: { rubric_category: 'execution_support', skill_axis: 'gtm_sales' } },
  { key: 'exec_bandwidth', prompt: 'How realistic is the bandwidth you can give each company you take on?', measures: { rubric_category: 'execution_support' } },
  // ---- collaboration_style --------------------------------------------
  { key: 'collab_style', prompt: 'How well do you collaborate without needing to be the most important person in the room?', measures: { rubric_category: 'collaboration_style', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
  { key: 'collab_founder_led', prompt: 'How comfortable are you letting the founder lead while you support from beside them?', hint: '0 = prefers clear structure, 5 = thrives in founder-led autonomy.', measures: { rubric_category: 'collaboration_style', value_dim: 'founder_autonomy_vs_structure' } },
  // ---- reputation -----------------------------------------------------
  { key: 'rep_track_record', prompt: 'How strong is your track record of companies that are glad they worked with you?', measures: { rubric_category: 'reputation' } },
  { key: 'rep_conduct', prompt: 'How consistently do you treat relationships as long-term rather than purely transactional?', measures: { rubric_category: 'reputation', red_flag: { key: 'transactional', at_or_below: 1 } } },
  // ---- skills breadth (service surface beyond network/GTM) ------------
  // Task #45 — partners deliver across product, ops, and legal too; broaden
  // the radar past capital_network / gtm_sales so it has real shape.
  { key: 'skill_product', prompt: 'How strong is your product and technical judgement when advising a company?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'product' } },
  { key: 'skill_finance_ops', prompt: 'How strong are you on the finance and operations side — planning, hiring, process?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'finance_ops' } },
  { key: 'skill_legal', prompt: 'How comfortable are you with the legal, compliance, and contractual side of the work?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'legal_compliance' } },
  // ---- work values (Schwartz dims for a rounded values wheel) ---------
  { key: 'val_benevolence', prompt: 'How much does genuinely helping the teams you work with drive you, beyond the engagement?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_benevolence' } },
  { key: 'val_self_direction', prompt: 'How much do you value the freedom to work in your own way rather than to a fixed brief?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_self_direction' } },
  { key: 'val_universalism', prompt: 'How much do fairness and broader impact shape which engagements you take on?', hint: '0 = not important to me, 5 = very important.', measures: { value_dim: 'schwartz_universalism' } },
  // ---- archetype traits ----------------------------------------------
  ...archetypeTraitRows(),
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
