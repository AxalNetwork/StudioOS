/**
 * Fit v2 — role templates (pure config, no DB).
 *
 * A role template says what a given engagement context weighs: which of the
 * 10 priority skills matter (and which are must-haves vs trainable), which v2
 * rubric categories the role add-on questions probe, and which archetypes
 * historically thrive (narrative only — archetype NEVER gates an outcome).
 *
 * Role contexts are decoupled from users.role: any user can assess against
 * any context, and two contexts (internal_hire / portfolio_talent) have no
 * v1 FitPersona at all — they exist only in the staged flow.
 *
 * The value/trait key arrays are deliberately LITERALS, not spreads of the v1
 * constants, so this module never participates in the questionBank/axalFit
 * import cycle. test/fitDecision.test.ts pins them to
 * axalFit.AXAL_VALUES + 'ambition' and archetypeScoring.ARCHETYPE_TRAITS +
 * scout/steward — if v1 ever renames a key, that test fails loudly.
 */
import type { FitPersona } from './advisor/questionBank.ts';
import type { FitRoleContext } from './advisor/questionBank.ts';

export type { FitRoleContext } from './advisor/questionBank.ts';

// The 6 v2 values: the 5 v1 Axal values (axal_values rows, axalFit VALUE_SPECS)
// plus `ambition` — compounding ambition, absent from the v1 five. v1 keeps
// scoring its 5; only the v2 culture score reads all 6.
export const FIT_V2_VALUES = [
  'integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition',
] as const;
export type FitV2ValueKey = (typeof FIT_V2_VALUES)[number];

export const FIT_V2_VALUE_SPECS: Record<FitV2ValueKey, { label: string; description: string }> = {
  integrity: {
    label: 'Integrity',
    description: 'Does what they said they would; owns mistakes instead of shifting blame.',
  },
  stewardship: {
    label: 'Stewardship',
    description: "Treats capital, people, and reputation as a trust to protect, not extract.",
  },
  curiosity: {
    label: 'Curiosity',
    description: 'Seeks out what they do not know; updates beliefs on new evidence.',
  },
  resilience: {
    label: 'Resilience',
    description: 'Recovers from setbacks and keeps execution moving under pressure.',
  },
  collaboration: {
    label: 'Collaboration',
    description: 'Builds with others; shares credit; puts the mission ahead of ego.',
  },
  ambition: {
    label: 'Compounding Ambition',
    description: 'Plays long games at high standards; chooses durable advantage over quick optics.',
  },
};

// The 6 v2 operating archetypes: the 4 v1 trait axes plus scout + steward.
// Scored as preference (how someone operates), never as better/worse.
export const FIT_V2_TRAITS = [
  'builder', 'visionary', 'connector', 'operator', 'scout', 'steward',
] as const;
export type FitV2Trait = (typeof FIT_V2_TRAITS)[number];

export const FIT_V2_TRAIT_SPECS: Record<FitV2Trait, { label: string; tagline: string; risk: string }> = {
  builder: {
    label: 'Builder',
    tagline: 'Creates from zero; bias to ship; prototype-first reasoning.',
    risk: 'Breadth over finish; allergic to process that would protect the work.',
  },
  visionary: {
    label: 'Visionary',
    tagline: 'Frames the future; sees leverage points and sequencing others miss.',
    risk: 'Analysis and narrative can outrun action; bored by maintenance.',
  },
  connector: {
    label: 'Connector',
    tagline: 'Mobilizes people and momentum; sells the future; unblocks socially.',
    risk: 'Can overpromise; follow-through depends on others.',
  },
  operator: {
    label: 'Operator',
    tagline: 'Systematizes and scales; cadence, accountability, reliability.',
    risk: 'Over-process in ambiguity; optimizes the known at the cost of the new.',
  },
  scout: {
    label: 'Scout',
    tagline: 'Finds signal early; explores frontiers; synthesizes across domains.',
    risk: 'Novelty-chasing; weak at exploiting what has already been found.',
  },
  steward: {
    label: 'Steward',
    tagline: 'Protects quality, trust, and downside; craft and durability first.',
    risk: 'Over-caution; veto energy can stall momentum.',
  },
};

// The 10 priority skills (fitv2_* rows seeded by migration 151).
export const FIT_V2_SKILLS = [
  'fitv2_fundraising_narrative',
  'fitv2_market_research',
  'fitv2_analytical_judgment',
  'fitv2_product_thinking',
  'fitv2_sales_relationships',
  'fitv2_hiring',
  'fitv2_execution_management',
  'fitv2_communication',
  'fitv2_diligence',
  'fitv2_strategic_synthesis',
] as const;
export type FitV2SkillSlug = (typeof FIT_V2_SKILLS)[number];

export const FIT_V2_SKILL_LABELS: Record<FitV2SkillSlug, string> = {
  fitv2_fundraising_narrative: 'Fundraising & Capital Narrative',
  fitv2_market_research: 'Market Research',
  fitv2_analytical_judgment: 'Analytical Judgment',
  fitv2_product_thinking: 'Product Thinking',
  fitv2_sales_relationships: 'Sales & Relationship Building',
  fitv2_hiring: 'Hiring',
  fitv2_execution_management: 'Execution Management',
  fitv2_communication: 'Communication',
  fitv2_diligence: 'Diligence',
  fitv2_strategic_synthesis: 'Strategic Synthesis',
};

export interface FitRoleTemplate {
  key: FitRoleContext;
  label: string;
  description: string;
  /** v1 persona whose conversational fit bank / rubric this context maps to.
   *  null = staged-only context with no v1 counterpart. */
  fitPersona: FitPersona | null;
  /** Relative weights over the 10 priority skills (v1 scoreRubric convention:
   *  weights need not sum to anything — normalized over answered at score time). */
  skillWeights: Record<FitV2SkillSlug, number>;
  /** Skills that must reach 3/5 (validated) before High Fit; below that they
   *  are enumerated as gaps. Everything else is treated as trainable. */
  mustHaveSkills: FitV2SkillSlug[];
  /** Relative weights over the v2 rubric categories probed by this role's
   *  add-on questions. */
  rubricWeights: Record<string, number>;
  /** Narrative-only: archetypes that historically thrive / strain in this
   *  context. Never gates an outcome. */
  archetypeAffinity: Partial<Record<FitV2Trait, number>>;
}

export const FIT_ROLE_TEMPLATES: Record<FitRoleContext, FitRoleTemplate> = {
  founder: {
    key: 'founder',
    label: 'Founder',
    description: 'Building a company from zero: vision, execution, capital, team.',
    fitPersona: 'founder',
    skillWeights: {
      fitv2_fundraising_narrative: 2,
      fitv2_market_research: 1,
      fitv2_analytical_judgment: 1,
      fitv2_product_thinking: 2,
      fitv2_sales_relationships: 1.5,
      fitv2_hiring: 1.5,
      fitv2_execution_management: 2,
      fitv2_communication: 1.5,
      fitv2_diligence: 0.5,
      fitv2_strategic_synthesis: 1,
    },
    mustHaveSkills: ['fitv2_execution_management', 'fitv2_product_thinking', 'fitv2_fundraising_narrative'],
    rubricWeights: { vision_clarity: 1.5, execution_ability: 2, team_leadership: 1.5, customer_insight: 1.5 },
    archetypeAffinity: { builder: 1, visionary: 0.8, connector: 0.5, operator: 0.5, scout: 0.4, steward: 0.3 },
  },
  investor: {
    key: 'investor',
    label: 'Investor',
    description: 'Sourcing, judging, and supporting companies with capital and conviction.',
    fitPersona: 'investor',
    skillWeights: {
      fitv2_fundraising_narrative: 1,
      fitv2_market_research: 1.5,
      fitv2_analytical_judgment: 2,
      fitv2_product_thinking: 1,
      fitv2_sales_relationships: 1.5,
      fitv2_hiring: 0.5,
      fitv2_execution_management: 0.5,
      fitv2_communication: 1,
      fitv2_diligence: 2,
      fitv2_strategic_synthesis: 2,
    },
    mustHaveSkills: ['fitv2_diligence', 'fitv2_analytical_judgment', 'fitv2_strategic_synthesis'],
    rubricWeights: { thesis_quality: 1.5, judgment_consistency: 2, founder_support: 1.5, reputation: 1.5 },
    archetypeAffinity: { scout: 1, steward: 0.8, visionary: 0.6, connector: 0.5, operator: 0.4, builder: 0.3 },
  },
  operator: {
    key: 'operator',
    label: 'Operator / Operating Partner',
    description: 'Hands-on execution support across portfolio companies.',
    fitPersona: 'partner',
    skillWeights: {
      fitv2_fundraising_narrative: 0.5,
      fitv2_market_research: 1,
      fitv2_analytical_judgment: 1,
      fitv2_product_thinking: 1,
      fitv2_sales_relationships: 2,
      fitv2_hiring: 1.5,
      fitv2_execution_management: 2,
      fitv2_communication: 1.5,
      fitv2_diligence: 0.5,
      fitv2_strategic_synthesis: 1,
    },
    mustHaveSkills: ['fitv2_execution_management', 'fitv2_sales_relationships'],
    rubricWeights: { reliability: 2, hands_on_support: 1.5, network_activation: 1.5, strategic_alignment: 1 },
    archetypeAffinity: { operator: 1, steward: 0.6, connector: 0.6, builder: 0.5, scout: 0.3, visionary: 0.3 },
  },
  advisor: {
    key: 'advisor',
    label: 'Advisor',
    description: 'Guiding founders with expertise, frameworks, and accountability.',
    fitPersona: 'advisor',
    skillWeights: {
      fitv2_fundraising_narrative: 1,
      fitv2_market_research: 1,
      fitv2_analytical_judgment: 1,
      fitv2_product_thinking: 1.5,
      fitv2_sales_relationships: 1.5,
      fitv2_hiring: 1,
      fitv2_execution_management: 0.5,
      fitv2_communication: 2,
      fitv2_diligence: 0.5,
      fitv2_strategic_synthesis: 2,
    },
    mustHaveSkills: ['fitv2_communication', 'fitv2_strategic_synthesis'],
    rubricWeights: { teaching_ability: 2, listening: 1.5, reliability: 1.5, founder_empathy: 1 },
    archetypeAffinity: { connector: 0.8, steward: 0.8, visionary: 0.6, scout: 0.5, operator: 0.4, builder: 0.3 },
  },
  internal_hire: {
    key: 'internal_hire',
    label: 'Internal Hire',
    description: 'Joining the Axal studio team itself: ownership inside the machine.',
    fitPersona: null,
    skillWeights: {
      fitv2_fundraising_narrative: 0.5,
      fitv2_market_research: 1,
      fitv2_analytical_judgment: 1.5,
      fitv2_product_thinking: 1,
      fitv2_sales_relationships: 0.5,
      fitv2_hiring: 1,
      fitv2_execution_management: 2,
      fitv2_communication: 1.5,
      fitv2_diligence: 1,
      fitv2_strategic_synthesis: 1,
    },
    mustHaveSkills: ['fitv2_execution_management', 'fitv2_communication'],
    rubricWeights: { ownership_scope: 2, cadence: 1.5, collaboration_fit: 1.5, learning_speed: 1 },
    archetypeAffinity: { operator: 0.9, builder: 0.6, steward: 0.6, connector: 0.4, scout: 0.4, visionary: 0.3 },
  },
  portfolio_talent: {
    key: 'portfolio_talent',
    label: 'Portfolio Support Talent',
    description: 'Embedded or fractional talent placed into portfolio companies.',
    fitPersona: null,
    skillWeights: {
      fitv2_fundraising_narrative: 0.5,
      fitv2_market_research: 1,
      fitv2_analytical_judgment: 1,
      fitv2_product_thinking: 1.5,
      fitv2_sales_relationships: 1.5,
      fitv2_hiring: 1,
      fitv2_execution_management: 2,
      fitv2_communication: 1.5,
      fitv2_diligence: 0.5,
      fitv2_strategic_synthesis: 0.5,
    },
    mustHaveSkills: ['fitv2_execution_management'],
    rubricWeights: { engagement_reliability: 2, context_adaptation: 1.5, outcome_focus: 1.5, founder_trust: 1 },
    archetypeAffinity: { operator: 0.8, connector: 0.7, builder: 0.6, steward: 0.5, scout: 0.3, visionary: 0.3 },
  },
};

export const FIT_ROLE_CONTEXTS = Object.keys(FIT_ROLE_TEMPLATES) as FitRoleContext[];

export function isFitRoleContext(x: string): x is FitRoleContext {
  return Object.prototype.hasOwnProperty.call(FIT_ROLE_TEMPLATES, x);
}

/** Default role context for a platform role. Total — unknown roles assess as founder. */
export function roleContextForUser(role: string | null | undefined): FitRoleContext {
  switch (role) {
    case 'founder': return 'founder';
    case 'investor': return 'investor';
    case 'partner': return 'operator';
    case 'advisor': return 'advisor';
    default: return 'founder';
  }
}
