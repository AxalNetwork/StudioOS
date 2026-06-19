/**
 * Axal Fit banks — the conversational scorecard, delivered through the Personal
 * Advisor. Every question is a 0..5 `scale` answer in a human, one-at-a-time
 * tone (not a survey grid). Each carries a `measures` tag so the write-router
 * fans the answer into the rubric scorecard (services/axalFit.ts), the 8-axis
 * skills radar, the 15-dim values lean, and the 5 Axal behavioral values.
 *
 * Hybrid methodology (structured score → human review): these self-ratings seed
 * the scorecard; the admin's consultation review is the second, human pass.
 */
import type { Question, Persona, FitMeasures } from '../questionBank';

interface FitSpec {
  key: string;            // unique within persona → id `fit.<persona>.<key>`
  prompt: string;
  hint?: string;
  measures: FitMeasures;
  importance?: Question['importance'];
}

const SCALE_HINT = 'Rate 0 (not at all) to 5 (completely) — answer honestly, there are no wrong answers.';

function fitBank(persona: Persona, specs: FitSpec[]): Question[] {
  return specs.map((s) => ({
    id: `fit.${persona}.${s.key}`,
    persona,
    section: 'FIT',
    prompt: s.prompt,
    hint: s.hint ?? SCALE_HINT,
    input_kind: 'scale' as const,
    validate: 'scale' as const,
    importance: s.importance ?? 'high',
    page_target: '/dashboard',
    doc_anchor: 'getting-started/personas',
    skip_allowed: true,
    measures: s.measures,
  }));
}

// ── Shared: the 5 Axal behavioral values (asked of every persona) ──────────
const VALUE_SPECS: FitSpec[] = [
  { key: 'value.integrity', prompt: 'When something goes wrong on your watch, how consistently do you own it openly rather than smooth it over?', measures: { axal_value: 'integrity', red_flag: { key: 'blame_shifting', at_or_below: 1 } } },
  { key: 'value.stewardship', prompt: 'How much do you weigh long-term consequences — for people, capital, and reputation — over the fastest near-term win?', measures: { axal_value: 'stewardship' } },
  { key: 'value.curiosity', prompt: 'How readily do you go looking for evidence that you might be wrong?', measures: { axal_value: 'curiosity' } },
  { key: 'value.resilience', prompt: 'After a real setback, how quickly do you recover your footing and keep moving?', measures: { axal_value: 'resilience' } },
  { key: 'value.collaboration', prompt: 'How naturally do you share credit and build trust with the people around you?', measures: { axal_value: 'collaboration', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
];

// ── Shared: 8 skill axes (populate the dashboard radar) ────────────────────
const SKILL_SPECS: FitSpec[] = [
  { key: 'skill.product', prompt: 'How strong is your product instinct — discovery, prioritization, knowing what to build?', measures: { skill_axis: 'product' }, importance: 'normal' },
  { key: 'skill.engineering', prompt: 'How strong are you technically — architecture, shipping, engineering judgment?', measures: { skill_axis: 'engineering' }, importance: 'normal' },
  { key: 'skill.design', prompt: 'How strong is your design sense — UX, craft, how things feel to use?', measures: { skill_axis: 'design' }, importance: 'normal' },
  { key: 'skill.gtm_sales', prompt: 'How strong are you at go-to-market and sales — pipeline, closing, channels?', measures: { skill_axis: 'gtm_sales' }, importance: 'normal' },
  { key: 'skill.marketing_brand', prompt: 'How strong are you at marketing and brand — narrative, demand, positioning?', measures: { skill_axis: 'marketing_brand' }, importance: 'normal' },
  { key: 'skill.finance_ops', prompt: 'How strong are you at finance and operations — models, runway, running the machine?', measures: { skill_axis: 'finance_ops' }, importance: 'normal' },
  { key: 'skill.legal_compliance', prompt: 'How comfortable are you with legal and compliance — structure, contracts, risk?', measures: { skill_axis: 'legal_compliance' }, importance: 'normal' },
  { key: 'skill.capital_network', prompt: 'How strong is your capital and network reach — fundraising, recruiting, relationships?', measures: { skill_axis: 'capital_network' }, importance: 'normal' },
];

// ── Shared: 5 founder value spectrums (the "where you lean" graph) ─────────
// 0..5 self-rating maps onto the −2..+2 dimension toward the "high" pole.
const LEAN_SPECS: FitSpec[] = [
  { key: 'lean.mission', prompt: 'How much does a mission you believe in drive you over pure financial return?', measures: { value_dim: 'founder_mission_vs_profit' }, importance: 'normal' },
  { key: 'lean.speed', prompt: 'When you must choose, how far do you lean toward shipping fast over polishing?', measures: { value_dim: 'founder_speed_vs_quality' }, importance: 'normal' },
  { key: 'lean.risk', prompt: 'How much appetite do you have for bold, uncertain bets over safe, known paths?', measures: { value_dim: 'founder_risk_appetite' }, importance: 'normal' },
  { key: 'lean.growth', prompt: 'How much do you lean toward hyper-growth over sustainable, durable building?', measures: { value_dim: 'founder_growth_vs_sustain' }, importance: 'normal' },
  { key: 'lean.autonomy', prompt: 'How much do you prefer autonomy and flexibility over process and structure?', measures: { value_dim: 'founder_autonomy_vs_structure' }, importance: 'normal' },
];

// ── Per-persona rubric questions ───────────────────────────────────────────
const FOUNDER_RUBRIC: FitSpec[] = [
  { key: 'rubric.vision_clarity', prompt: 'How clearly can you explain your mission and exactly why now is the moment for it?', measures: { rubric_category: 'vision_clarity' }, importance: 'critical' },
  { key: 'rubric.execution_ability', prompt: 'How consistently do you turn intent into shipped progress — speed, focus, follow-through?', measures: { rubric_category: 'execution_ability' }, importance: 'critical' },
  { key: 'rubric.domain_insight', prompt: 'How deeply do you understand the problem space — better than almost anyone else?', measures: { rubric_category: 'domain_insight' } },
  { key: 'rubric.coachability', prompt: 'How readily do you absorb hard feedback without losing your conviction?', measures: { rubric_category: 'coachability', red_flag: { key: 'overconfidence', at_or_below: 1 } } },
  { key: 'rubric.resilience', prompt: 'How well do you hold up under rejection, uncertainty, and setbacks?', measures: { rubric_category: 'resilience' } },
  { key: 'rubric.communication', prompt: 'How clear, concise, and honest are you when you communicate?', measures: { rubric_category: 'communication' } },
  { key: 'rubric.team_dynamics', prompt: 'How healthy is trust and decision-making within your team?', measures: { rubric_category: 'team_dynamics' } },
  { key: 'rubric.values_fit', prompt: 'How much do long-term thinking, stewardship, and integrity guide your choices?', measures: { rubric_category: 'values_fit' } },
];

const INVESTOR_RUBRIC: FitSpec[] = [
  { key: 'rubric.thesis_fit', prompt: 'How well does your thesis understand and support Axal’s mandate?', measures: { rubric_category: 'thesis_fit' }, importance: 'critical' },
  { key: 'rubric.capital_quality', prompt: 'How patient and strategically useful is the capital you bring?', measures: { rubric_category: 'capital_quality' } },
  { key: 'rubric.governance_style', prompt: 'How supportive (vs. controlling or noisy) are you once invested?', measures: { rubric_category: 'governance_style' } },
  { key: 'rubric.reputation', prompt: 'How strong is your reputation with the founders who know you best?', measures: { rubric_category: 'reputation' } },
  { key: 'rubric.decision_quality', prompt: 'How good is your judgment under real uncertainty?', measures: { rubric_category: 'decision_quality' } },
  { key: 'rubric.values_fit', prompt: 'How much do long-term orientation, stewardship, and fairness guide your investing?', measures: { rubric_category: 'values_fit' } },
];

const PARTNER_RUBRIC: FitSpec[] = [
  { key: 'rubric.strategic_alignment', prompt: 'How directly does what you do amplify Axal’s thesis?', measures: { rubric_category: 'strategic_alignment' }, importance: 'critical' },
  { key: 'rubric.trustworthiness', prompt: 'How reliable, transparent, and discreet are you in practice?', measures: { rubric_category: 'trustworthiness' } },
  { key: 'rubric.network_quality', prompt: 'How strong is your access to founders, capital, and operators?', measures: { rubric_category: 'network_quality' } },
  { key: 'rubric.execution_support', prompt: 'How much can you actually move deals and projects forward?', measures: { rubric_category: 'execution_support' } },
  { key: 'rubric.collaboration_style', prompt: 'How low-ego, responsive, and constructive are you to work with?', measures: { rubric_category: 'collaboration_style', red_flag: { key: 'ego_over_collaboration', at_or_below: 1 } } },
  { key: 'rubric.reputation', prompt: 'How consistent is your track record and what references say about you?', measures: { rubric_category: 'reputation' } },
];

const MENTOR_RUBRIC: FitSpec[] = [
  { key: 'rubric.domain_expertise', prompt: 'How relevant, current, and practical is your expertise for founders today?', measures: { rubric_category: 'domain_expertise' }, importance: 'critical' },
  { key: 'rubric.teaching_ability', prompt: 'How well do you translate complexity into action a founder can take?', measures: { rubric_category: 'teaching_ability' } },
  { key: 'rubric.listening', prompt: 'How much do you diagnose and listen before you advise?', measures: { rubric_category: 'listening' } },
  { key: 'rubric.founder_empathy', prompt: 'How balanced is your support — real, not performative?', measures: { rubric_category: 'founder_empathy' } },
  { key: 'rubric.reliability', prompt: 'How consistently do you show up, follow through, and respect boundaries?', measures: { rubric_category: 'reliability' } },
  { key: 'rubric.values_alignment', prompt: 'How ethical, constructive, and non-extractive is your approach?', measures: { rubric_category: 'values_alignment' } },
];

export const FIT_FOUNDER_BANK: Question[] = fitBank('founder', [...FOUNDER_RUBRIC, ...VALUE_SPECS, ...SKILL_SPECS, ...LEAN_SPECS]);
export const FIT_INVESTOR_BANK: Question[] = fitBank('investor', [...INVESTOR_RUBRIC, ...VALUE_SPECS, ...SKILL_SPECS, ...LEAN_SPECS]);
export const FIT_PARTNER_BANK: Question[] = fitBank('partner', [...PARTNER_RUBRIC, ...VALUE_SPECS, ...SKILL_SPECS, ...LEAN_SPECS]);
export const FIT_MENTOR_BANK: Question[] = fitBank('mentor', [...MENTOR_RUBRIC, ...VALUE_SPECS, ...SKILL_SPECS, ...LEAN_SPECS]);
