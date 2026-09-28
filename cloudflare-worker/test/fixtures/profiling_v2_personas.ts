/**
 * Profiling v2 personas — the targets Sessions 7 and 9–12 test against.
 *
 * These are not answers. The v2 banks do not exist yet, so a persona cannot
 * name question ids. Each row is the profile those banks must reproduce.
 * The rule that turns a target into answers is in
 * documentation/architecture/PROFILING_V2.md, section "From a target to answers".
 *
 * Trait vectors for the 16 archetypes are the centroids in
 * archetypeScoring.ts on main 8e2120b4e3, copied here as literals so this
 * file does not import the classifier it is supposed to pin.
 * A blend is 0.75 of its primary centroid and 0.25 of its secondary, rounded
 * to two decimals. The exact midpoint of every closest pair classifies with
 * margin 0 (a tie, broken only by array order), so a midpoint is not a blend.
 *
 * People and addresses are synthetic.
 */
export const TRAITS = ['builder', 'visionary', 'connector', 'operator'] as const;
export type TraitName = (typeof TRAITS)[number];
export type TraitVector = Record<TraitName, number>;

export const ROLES = ['founder', 'investor', 'partner', 'advisor'] as const;
export type ProfilingRole = (typeof ROLES)[number];

export const RADAR_AXES = [
  'product', 'engineering', 'design', 'gtm_sales',
  'marketing_brand', 'finance_ops', 'legal_compliance', 'capital_network',
] as const;
export type RadarAxis = (typeof RADAR_AXES)[number];
export type SkillLevels = Record<RadarAxis, number>;

export const AXAL_VALUES = [
  'integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition',
] as const;
export type AxalValue = (typeof AXAL_VALUES)[number];
export type AxalLevels = Record<AxalValue, number>;

/** Value slugs each role's bank already asks. Session 14 matches on these. */
export const VALUE_KEYS_BY_ROLE = {
  founder: [
    'founder_mission_vs_profit', 'founder_speed_vs_quality', 'founder_risk_appetite',
    'founder_growth_vs_sustain', 'founder_autonomy_vs_structure',
  ],
  investor: [
    'founder_growth_vs_sustain', 'founder_risk_appetite',
    'schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism',
  ],
  partner: [
    'founder_autonomy_vs_structure',
    'schwartz_benevolence', 'schwartz_self_direction', 'schwartz_universalism',
  ],
  advisor: [
    'schwartz_benevolence', 'schwartz_universalism', 'schwartz_self_direction', 'schwartz_achievement',
  ],
} as const;

export const ARCHETYPE_SLUGS_BY_ROLE = {
  founder: ['fo_missionary', 'fo_rocketeer', 'fo_architect', 'fo_maverick'],
  investor: ['inv_thesis_backer', 'inv_network_amplifier', 'inv_hands_on_partner', 'inv_disciplined_allocator'],
  partner: ['pt_strategic_connector', 'pt_embedded_operator', 'pt_growth_catalyst', 'pt_systems_builder'],
  advisor: ['mt_sage_guide', 'mt_hands_on_coach', 'mt_accountability_anchor', 'mt_craft_master'],
} as const;

/**
 * Pairs each bank must separate. `distance` is raw Euclidean over the four
 * centroids (not the normalized margin classifyArchetype returns).
 * `separating_items` is 5 when that distance is under 2, otherwise 3.
 */
export const CLOSE_PAIRS = [
  { role: 'partner', a: 'pt_embedded_operator', b: 'pt_systems_builder', distance: 1.73, separating_items: 5 },
  { role: 'investor', a: 'inv_thesis_backer', b: 'inv_disciplined_allocator', distance: 2.45, separating_items: 3 },
  { role: 'partner', a: 'pt_strategic_connector', b: 'pt_growth_catalyst', distance: 2.45, separating_items: 3 },
  { role: 'advisor', a: 'mt_hands_on_coach', b: 'mt_accountability_anchor', distance: 2.45, separating_items: 3 },
  { role: 'founder', a: 'fo_missionary', b: 'fo_rocketeer', distance: 2.65, separating_items: 3 },
  { role: 'investor', a: 'inv_network_amplifier', b: 'inv_hands_on_partner', distance: 3, separating_items: 3 },
  { role: 'founder', a: 'fo_rocketeer', b: 'fo_maverick', distance: 3.16, separating_items: 3 },
] as const;

export interface ProfilingPersona {
  id: string;
  role: ProfilingRole;
  kind: 'archetype' | 'blend';
  name: string;
  email: string;
  expected_slug: string;
  /** Set only on a blend. The other archetype of the same role. */
  secondary_slug: string | null;
  traits: TraitVector;
  /** 0–5 self-rating targets, one per radar axis. */
  skills: SkillLevels;
  /** 0–5 targets, keys from VALUE_KEYS_BY_ROLE for this role. 5 is pole_high. */
  values: Record<string, number>;
  /** 0–5 targets. The store divides by 5; the fixture stays on the answer scale. */
  axal: AxalLevels;
}

const skills = (
  product: number, engineering: number, design: number, gtm_sales: number,
  marketing_brand: number, finance_ops: number, legal_compliance: number, capital_network: number,
): SkillLevels => ({
  product, engineering, design, gtm_sales, marketing_brand, finance_ops, legal_compliance, capital_network,
});

const axal = (
  integrity: number, stewardship: number, curiosity: number,
  resilience: number, collaboration: number, ambition: number,
): AxalLevels => ({ integrity, stewardship, curiosity, resilience, collaboration, ambition });

export const PROFILING_V2_PERSONAS: readonly ProfilingPersona[] = [
  {
    id: 'founder.missionary', role: 'founder', kind: 'archetype',
    name: 'Mira Founder', email: 'mira.founder@example.test',
    expected_slug: 'fo_missionary', secondary_slug: null,
    traits: { builder: 2, visionary: 5, connector: 5, operator: 3 },
    skills: skills(3, 2, 3, 3, 4, 3, 2, 4),
    values: { founder_mission_vs_profit: 5, founder_speed_vs_quality: 2, founder_risk_appetite: 2, founder_growth_vs_sustain: 2, founder_autonomy_vs_structure: 3 },
    axal: axal(5, 5, 4, 4, 5, 4),
  },
  {
    id: 'founder.rocketeer', role: 'founder', kind: 'archetype',
    name: 'Rio Founder', email: 'rio.founder@example.test',
    expected_slug: 'fo_rocketeer', secondary_slug: null,
    traits: { builder: 4, visionary: 4, connector: 4, operator: 2 },
    skills: skills(4, 3, 3, 5, 4, 2, 2, 5),
    values: { founder_mission_vs_profit: 3, founder_speed_vs_quality: 5, founder_risk_appetite: 5, founder_growth_vs_sustain: 5, founder_autonomy_vs_structure: 4 },
    axal: axal(4, 3, 4, 5, 3, 5),
  },
  {
    id: 'founder.architect', role: 'founder', kind: 'archetype',
    name: 'Ari Founder', email: 'ari.founder@example.test',
    expected_slug: 'fo_architect', secondary_slug: null,
    traits: { builder: 5, visionary: 2, connector: 2, operator: 5 },
    skills: skills(5, 5, 4, 2, 2, 4, 3, 2),
    values: { founder_mission_vs_profit: 3, founder_speed_vs_quality: 1, founder_risk_appetite: 2, founder_growth_vs_sustain: 2, founder_autonomy_vs_structure: 1 },
    axal: axal(5, 4, 3, 4, 3, 3),
  },
  {
    id: 'founder.maverick', role: 'founder', kind: 'archetype',
    name: 'Max Founder', email: 'max.founder@example.test',
    expected_slug: 'fo_maverick', secondary_slug: null,
    traits: { builder: 5, visionary: 4, connector: 1, operator: 2 },
    skills: skills(5, 4, 3, 4, 3, 2, 1, 3),
    values: { founder_mission_vs_profit: 2, founder_speed_vs_quality: 4, founder_risk_appetite: 5, founder_growth_vs_sustain: 4, founder_autonomy_vs_structure: 5 },
    axal: axal(4, 3, 5, 4, 2, 5),
  },
  {
    id: 'founder.blend', role: 'founder', kind: 'blend',
    name: 'Nia Founder', email: 'nia.founder@example.test',
    expected_slug: 'fo_missionary', secondary_slug: 'fo_rocketeer',
    traits: { builder: 2.5, visionary: 4.75, connector: 4.75, operator: 2.75 },
    skills: skills(3, 2, 3, 4, 4, 3, 2, 4),
    values: { founder_mission_vs_profit: 5, founder_speed_vs_quality: 3, founder_risk_appetite: 3, founder_growth_vs_sustain: 3, founder_autonomy_vs_structure: 3 },
    axal: axal(5, 5, 4, 4, 5, 4),
  },
  {
    id: 'investor.thesis', role: 'investor', kind: 'archetype',
    name: 'Theo Investor', email: 'theo.investor@example.test',
    expected_slug: 'inv_thesis_backer', secondary_slug: null,
    traits: { builder: 2, visionary: 5, connector: 2, operator: 4 },
    skills: skills(4, 2, 2, 3, 2, 4, 4, 4),
    values: { founder_growth_vs_sustain: 2, founder_risk_appetite: 3, schwartz_achievement: 4, schwartz_benevolence: 4, schwartz_universalism: 4 },
    axal: axal(5, 5, 4, 4, 4, 4),
  },
  {
    id: 'investor.network', role: 'investor', kind: 'archetype',
    name: 'Ned Investor', email: 'ned.investor@example.test',
    expected_slug: 'inv_network_amplifier', secondary_slug: null,
    traits: { builder: 2, visionary: 3, connector: 5, operator: 2 },
    skills: skills(2, 1, 2, 4, 3, 3, 2, 5),
    values: { founder_growth_vs_sustain: 3, founder_risk_appetite: 3, schwartz_achievement: 3, schwartz_benevolence: 4, schwartz_universalism: 3 },
    axal: axal(4, 3, 4, 3, 5, 4),
  },
  {
    id: 'investor.hands_on', role: 'investor', kind: 'archetype',
    name: 'Hana Investor', email: 'hana.investor@example.test',
    expected_slug: 'inv_hands_on_partner', secondary_slug: null,
    traits: { builder: 4, visionary: 3, connector: 4, operator: 4 },
    skills: skills(4, 3, 3, 4, 3, 3, 3, 4),
    values: { founder_growth_vs_sustain: 3, founder_risk_appetite: 4, schwartz_achievement: 4, schwartz_benevolence: 5, schwartz_universalism: 3 },
    axal: axal(5, 4, 3, 4, 5, 4),
  },
  {
    id: 'investor.allocator', role: 'investor', kind: 'archetype',
    name: 'Ada Investor', email: 'ada.investor@example.test',
    expected_slug: 'inv_disciplined_allocator', secondary_slug: null,
    traits: { builder: 1, visionary: 3, connector: 2, operator: 5 },
    skills: skills(3, 2, 2, 2, 2, 5, 5, 4),
    values: { founder_growth_vs_sustain: 1, founder_risk_appetite: 1, schwartz_achievement: 4, schwartz_benevolence: 3, schwartz_universalism: 4 },
    axal: axal(5, 5, 3, 4, 3, 3),
  },
  {
    id: 'investor.blend', role: 'investor', kind: 'blend',
    name: 'Bea Investor', email: 'bea.investor@example.test',
    expected_slug: 'inv_thesis_backer', secondary_slug: 'inv_disciplined_allocator',
    traits: { builder: 1.75, visionary: 4.5, connector: 2, operator: 4.25 },
    skills: skills(4, 2, 2, 3, 2, 4, 4, 4),
    values: { founder_growth_vs_sustain: 2, founder_risk_appetite: 3, schwartz_achievement: 4, schwartz_benevolence: 4, schwartz_universalism: 4 },
    axal: axal(5, 5, 4, 4, 4, 4),
  },
  {
    id: 'partner.connector', role: 'partner', kind: 'archetype',
    name: 'Pia Partner', email: 'pia.partner@example.test',
    expected_slug: 'pt_strategic_connector', secondary_slug: null,
    traits: { builder: 2, visionary: 4, connector: 5, operator: 3 },
    skills: skills(3, 2, 3, 4, 4, 3, 3, 5),
    values: { founder_autonomy_vs_structure: 4, schwartz_benevolence: 4, schwartz_self_direction: 4, schwartz_universalism: 4 },
    axal: axal(5, 4, 4, 3, 5, 4),
  },
  {
    id: 'partner.embedded', role: 'partner', kind: 'archetype',
    name: 'Eli Partner', email: 'eli.partner@example.test',
    expected_slug: 'pt_embedded_operator', secondary_slug: null,
    traits: { builder: 5, visionary: 2, connector: 3, operator: 4 },
    skills: skills(4, 3, 2, 4, 2, 4, 3, 3),
    values: { founder_autonomy_vs_structure: 2, schwartz_benevolence: 4, schwartz_self_direction: 3, schwartz_universalism: 3 },
    axal: axal(5, 4, 3, 5, 4, 3),
  },
  {
    id: 'partner.growth', role: 'partner', kind: 'archetype',
    name: 'Gia Partner', email: 'gia.partner@example.test',
    expected_slug: 'pt_growth_catalyst', secondary_slug: null,
    traits: { builder: 4, visionary: 4, connector: 4, operator: 2 },
    skills: skills(3, 2, 3, 5, 4, 3, 2, 4),
    values: { founder_autonomy_vs_structure: 4, schwartz_benevolence: 3, schwartz_self_direction: 4, schwartz_universalism: 3 },
    axal: axal(4, 3, 4, 4, 4, 5),
  },
  {
    id: 'partner.systems', role: 'partner', kind: 'archetype',
    name: 'Sam Partner', email: 'sam.partner@example.test',
    expected_slug: 'pt_systems_builder', secondary_slug: null,
    traits: { builder: 4, visionary: 2, connector: 2, operator: 5 },
    skills: skills(4, 3, 2, 2, 2, 5, 4, 2),
    values: { founder_autonomy_vs_structure: 1, schwartz_benevolence: 3, schwartz_self_direction: 2, schwartz_universalism: 3 },
    axal: axal(5, 4, 3, 4, 3, 3),
  },
  {
    id: 'partner.blend', role: 'partner', kind: 'blend',
    name: 'Bo Partner', email: 'bo.partner@example.test',
    expected_slug: 'pt_embedded_operator', secondary_slug: 'pt_systems_builder',
    traits: { builder: 4.75, visionary: 2, connector: 2.75, operator: 4.25 },
    skills: skills(4, 3, 2, 4, 2, 4, 3, 3),
    values: { founder_autonomy_vs_structure: 2, schwartz_benevolence: 4, schwartz_self_direction: 3, schwartz_universalism: 3 },
    axal: axal(5, 4, 3, 5, 4, 3),
  },
  {
    id: 'advisor.sage', role: 'advisor', kind: 'archetype',
    name: 'Sage Advisor', email: 'sage.advisor@example.test',
    expected_slug: 'mt_sage_guide', secondary_slug: null,
    traits: { builder: 2, visionary: 5, connector: 4, operator: 3 },
    skills: skills(3, 2, 3, 2, 3, 3, 2, 3),
    values: { schwartz_benevolence: 4, schwartz_universalism: 5, schwartz_self_direction: 4, schwartz_achievement: 3 },
    axal: axal(5, 4, 5, 3, 4, 3),
  },
  {
    id: 'advisor.coach', role: 'advisor', kind: 'archetype',
    name: 'Cam Advisor', email: 'cam.advisor@example.test',
    expected_slug: 'mt_hands_on_coach', secondary_slug: null,
    traits: { builder: 4, visionary: 2, connector: 5, operator: 3 },
    skills: skills(3, 2, 4, 4, 3, 3, 2, 4),
    values: { schwartz_benevolence: 5, schwartz_universalism: 3, schwartz_self_direction: 3, schwartz_achievement: 4 },
    axal: axal(5, 4, 4, 4, 5, 4),
  },
  {
    id: 'advisor.anchor', role: 'advisor', kind: 'archetype',
    name: 'Ana Advisor', email: 'ana.advisor@example.test',
    expected_slug: 'mt_accountability_anchor', secondary_slug: null,
    traits: { builder: 3, visionary: 2, connector: 4, operator: 5 },
    skills: skills(2, 2, 2, 3, 2, 4, 4, 3),
    values: { schwartz_benevolence: 3, schwartz_universalism: 4, schwartz_self_direction: 2, schwartz_achievement: 4 },
    axal: axal(5, 5, 3, 4, 3, 3),
  },
  {
    id: 'advisor.craft', role: 'advisor', kind: 'archetype',
    name: 'Craft Advisor', email: 'craft.advisor@example.test',
    expected_slug: 'mt_craft_master', secondary_slug: null,
    traits: { builder: 5, visionary: 3, connector: 2, operator: 4 },
    skills: skills(4, 3, 5, 2, 2, 3, 2, 2),
    values: { schwartz_benevolence: 3, schwartz_universalism: 3, schwartz_self_direction: 4, schwartz_achievement: 5 },
    axal: axal(5, 4, 4, 4, 3, 4),
  },
  {
    id: 'advisor.blend', role: 'advisor', kind: 'blend',
    name: 'Blair Advisor', email: 'blair.advisor@example.test',
    expected_slug: 'mt_hands_on_coach', secondary_slug: 'mt_accountability_anchor',
    traits: { builder: 3.75, visionary: 2, connector: 4.75, operator: 3.5 },
    skills: skills(3, 2, 4, 4, 3, 3, 3, 4),
    values: { schwartz_benevolence: 5, schwartz_universalism: 3, schwartz_self_direction: 3, schwartz_achievement: 4 },
    axal: axal(5, 4, 4, 4, 5, 4),
  },
];
