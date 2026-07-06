/**
 * Task #19 — Best-Fit. Founder fit bank.
 *
 * Behavioral self-ratings (0–5) feeding the founder rubric in axalFit.ts plus
 * skill axes, the 5 bipolar founder value spectrums, and the 5 Axal values.
 * value_dim prompts are authored so 5 = the dimension's `pole_high`
 * (Mission-First / Speed-First / Risk-Seeking / Hyper-Growth / Autonomy).
 */
import type { Question } from '../questionBank.ts';
import { buildFitBank, axalValueRows, archetypeTraitRows } from './fitShared.ts';

export const FIT_FOUNDER_BANK: Question[] = buildFitBank('founder', [
  // ---- vision_clarity -------------------------------------------------
  { key: 'vision_north_star', prompt: 'How clearly can you state, in one sentence, the future your company is trying to create?', measures: { rubric_category: 'vision_clarity' } },
  { key: 'vision_why_now', prompt: 'How well can you explain why now is the right moment for this — not five years ago, not five years from now?', measures: { rubric_category: 'vision_clarity' } },
  // ---- execution_ability ----------------------------------------------
  { key: 'exec_ship_rate', prompt: 'Over the last month, how consistently did you turn plans into shipped, visible progress?', measures: { rubric_category: 'execution_ability', skill_axis: 'product', red_flag: { key: 'poor_follow_through', at_or_below: 1 } } },
  { key: 'exec_prioritization', prompt: 'How disciplined are you at cutting good ideas to protect the one that matters most this week?', measures: { rubric_category: 'execution_ability' } },
  // ---- domain_insight -------------------------------------------------
  { key: 'domain_edge', prompt: 'How much non-obvious, earned insight do you have about this specific market?', measures: { rubric_category: 'domain_insight' } },
  { key: 'domain_customer_proximity', prompt: 'How close are you to the people who feel this problem most acutely?', measures: { rubric_category: 'domain_insight', skill_axis: 'gtm_sales' } },
  // ---- coachability ---------------------------------------------------
  { key: 'coach_feedback', prompt: 'When someone challenges your plan with a strong argument, how readily do you change course?', measures: { rubric_category: 'coachability', red_flag: { key: 'overconfidence', at_or_below: 1 } } },
  { key: 'coach_seek_help', prompt: 'How proactively do you seek out advisors and advisors for the things you are weakest at?', measures: { rubric_category: 'coachability' } },
  // ---- resilience -----------------------------------------------------
  { key: 'resilience_setbacks', prompt: 'How well do you keep the team steady and moving when a launch or a raise falls through?', measures: { rubric_category: 'resilience' } },
  { key: 'resilience_stamina', prompt: 'How sustainable is your pace — could you hold this intensity for years, not just months?', measures: { rubric_category: 'resilience' } },
  // ---- communication --------------------------------------------------
  { key: 'comm_clarity', prompt: 'How clearly do you get a complex idea across to someone hearing it for the first time?', measures: { rubric_category: 'communication', skill_axis: 'marketing_brand' } },
  { key: 'comm_persuasion', prompt: 'How effectively do you get talented people to say yes — to join, to invest, or to partner?', measures: { rubric_category: 'communication', skill_axis: 'capital_network' } },
  // ---- team_dynamics --------------------------------------------------
  { key: 'team_attract', prompt: 'How strong is your track record of attracting people who are better than you at their craft?', measures: { rubric_category: 'team_dynamics' } },
  { key: 'team_conflict', prompt: 'How well do you handle hard disagreements with a co-founder or a key early hire?', measures: { rubric_category: 'team_dynamics' } },
  // ---- values_fit -----------------------------------------------------
  { key: 'values_mission', prompt: 'How much is this driven by a mission you would pursue even if the financial upside were smaller?', measures: { rubric_category: 'values_fit', value_dim: 'founder_mission_vs_profit' } },
  { key: 'values_ethics', prompt: 'Under real pressure to hit a number, how firmly do you hold an ethical line?', measures: { rubric_category: 'values_fit', red_flag: { key: 'weak_ethics', at_or_below: 1 } } },
  // ---- founder value spectrums (5 = pole_high) ------------------------
  { key: 'lean_speed', prompt: 'How strongly do you favour shipping fast and learning in the wild over polishing before release?', hint: '0 = quality-first, 5 = speed-first.', measures: { value_dim: 'founder_speed_vs_quality' } },
  { key: 'lean_risk', prompt: 'How comfortable are you making big, hard-to-reverse bets under real uncertainty?', hint: '0 = risk-averse, 5 = risk-seeking.', measures: { value_dim: 'founder_risk_appetite' } },
  { key: 'lean_growth', prompt: 'How much do you bias toward aggressive growth over durable, sustainable building?', hint: '0 = sustainable, 5 = hyper-growth.', measures: { value_dim: 'founder_growth_vs_sustain' } },
  { key: 'lean_autonomy', prompt: 'How much do you prefer flexible autonomy over defined process and structure?', hint: '0 = process & structure, 5 = autonomy & flex.', measures: { value_dim: 'founder_autonomy_vs_structure' } },
  // ---- skills breadth (radar axes not already covered above) ----------
  // Task #45 — the radar needs signal across ≥5 of the 8 axes; the rubric
  // questions above only touch product/gtm_sales/marketing_brand/capital_network,
  // so these broaden coverage to engineering / design / finance_ops.
  { key: 'skill_engineering', prompt: 'How strong is your own hands-on engineering — could you build or credibly lead the build of the product?', hint: '0 = not my strength, 5 = deep engineering strength.', measures: { skill_axis: 'engineering' } },
  { key: 'skill_design', prompt: 'How strong is your product/design sense — shaping something people find intuitive and want to use?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'design' } },
  { key: 'skill_finance_ops', prompt: 'How comfortable are you running the numbers and operations — budgets, runway, hiring plans, cadence?', hint: '0 = not my strength, 5 = a real strength.', measures: { skill_axis: 'finance_ops' } },
  // ---- archetype traits ----------------------------------------------
  ...archetypeTraitRows(),
  // ---- Axal values ----------------------------------------------------
  ...axalValueRows(),
]);
