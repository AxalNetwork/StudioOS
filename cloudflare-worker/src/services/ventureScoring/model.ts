/**
 * D1255 (#3278, part 2 of #2428) — venture scorecard model v1, as data.
 *
 * #2428 § "The scoring model" defines eleven scopes. Product-market fit is
 * defined once, in `../scoring/pmf.ts` (D1143), and is reused unchanged: this
 * file holds the other ten. Each scope names its inputs, the weight of each
 * (they sum to 100), the rule that turns the collected figure into 0–100, and
 * which freshness window applies. The floor, the confidence cut-offs, the
 * bands and the grades are SCORING's one table, shared with PMF.
 *
 * The keys are D1253's (`frontend/src/components/scoring/scorecard/scorecardModel.js`).
 *
 * ONE INPUT, ONE SCOPE. Where #2428 names a store under two scopes, it feeds
 * one: commits are Technical's build activity (Team reads platform actions);
 * founder vesting is Governance's (Team reads commitment); risks tied to a
 * feature are Technical's, the others Risk's; a market's regulation score is
 * Political and regulatory's, its demand, partners and cost Geographic's.
 *
 * NO INPUT IS INVENTED. An input whose source is not on the platform yet (a
 * country index, Vercel's production health, a founder-agreement store) is in
 * the model with `source: null`: it applies, reads "Not recorded" with its
 * reason, and lowers confidence until a later model version reads it.
 */
import { GRADES, type GradeLabel } from '../scoring/pmf';

export { GRADES, type GradeLabel };

/** The ten scopes this engine scores; `pmf` is D1143's. Same keys as D1253. */
export const SCORED_SCOPES = [
  'team', 'market', 'technical', 'traction', 'financial', 'risk',
  'geographic', 'political', 'governance', 'legal_ip',
] as const;
export type ScopeKey = (typeof SCORED_SCOPES)[number];
/** The eleven, in D1253's one order. */
export const SCOPE_ORDER = [
  'team', 'market', 'pmf', 'technical', 'traction', 'financial', 'risk',
  'geographic', 'political', 'governance', 'legal_ip',
] as const;
export type AnyScopeKey = (typeof SCOPE_ORDER)[number];

/** How an input's figure becomes 0–100. */
export type Rule =
  | { kind: 'count'; full: number }                                    // n ÷ full, capped
  | { kind: 'share'; full: number }                                    // (n ÷ of) ÷ full, capped
  | { kind: 'steps'; steps: ReadonlyArray<readonly [number, number]> } // the highest step n reaches
  | { kind: 'scale'; zero: number; full: number }                      // n from `zero` (0) to `full` (100), either direction, capped
  | { kind: 'direct' };                                                // n is already 0–100

export type Freshness = 'records' | 'connector' | 'quarter';

export interface ModelInput {
  key: string;
  label: string;
  weight: number;
  rule: Rule;
  freshness: Freshness;
  /** What the input reads, in the method's words. */
  reads: string;
  /** The store it reads, or null when no source is on the platform yet. */
  source: string | null;
  /** Personal or team-only: part 3 shows it to investors as a band or "Counted, not shown". */
  personal?: boolean;
}

export interface ScopeModel {
  scope: ScopeKey;
  label: string;
  /** Owner question 11 A: the scope says "Not expected yet" at these lifecycle stages. */
  not_expected_at: readonly string[];
  inputs: readonly ModelInput[];
}

export interface VentureModel {
  version: string;
  published: string;
  floor: number;
  confidence: ReadonlyArray<readonly [number, 'High' | 'Medium' | 'Low']>;
  bands: ReadonlyArray<readonly [number, 'Strong' | 'Fair' | 'Weak']>;
  /** Days before an input's newest record makes it stale; past it, its grade halves. */
  freshness_days: Readonly<Record<Freshness, number>>;
  scopes: Readonly<Record<ScopeKey, ScopeModel>>;
}

/**
 * Never an input (#2428 bias guard 1). No collector statement names one of
 * these columns or tables; `test/venture_scoring_d1255.test.ts` scans them.
 */
export const NEVER_READ = Object.freeze([
  'kyc_data', 'date_of_birth', 'dob', 'birth', 'nationality', 'gender', 'ethnicity', 'religion',
  'photo', 'avatar', 'email', 'residence', 'wellbeing', 'health', 'school', 'employer',
]);

const BEFORE_BUILD = ['idea', 'validate'] as const;

export const VENTURE_MODEL_V1: VentureModel = Object.freeze<VentureModel>({
  version: '1.0',
  published: '2026-10-26',
  floor: 0.25,
  confidence: [[0.70, 'High'], [0.45, 'Medium'], [0.25, 'Low']],
  bands: [[70, 'Strong'], [40, 'Fair'], [0, 'Weak']],
  freshness_days: { records: 365, connector: 90, quarter: 120 },
  scopes: {
    team: {
      scope: 'team', label: 'Team', not_expected_at: [],
      inputs: [
        { key: 'function_coverage', label: 'Function coverage', weight: 30, rule: { kind: 'count', full: 8 }, freshness: 'records', personal: true,
          reads: 'The eight skill axes with platform evidence from the team, an axis held only by an advisor counting half.', source: 'skill_evidence, project_members' },
        { key: 'build_evidence', label: 'Build evidence', weight: 20, rule: { kind: 'steps', steps: [[1, 25], [10, 50], [40, 75], [100, 100]] }, freshness: 'records', personal: true,
          reads: 'Platform actions by the team in the evidence window, as one count.', source: 'skill_evidence' },
        { key: 'commitment', label: 'Commitment', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'records', personal: true,
          reads: 'The share of founders who say they are full time.', source: 'cofounder_profiles' },
        { key: 'experience', label: 'Experience as corroboration', weight: 10, rule: { kind: 'share', full: 1 }, freshness: 'records', personal: true,
          reads: 'The share of members whose listed experience sits beside a recorded skill. Years are never scored, and no school or employer is read.', source: 'user_profile_ext, user_skills' },
        { key: 'archetype_mix', label: 'Archetype mix', weight: 10, rule: { kind: 'steps', steps: [[1, 40], [2, 80], [3, 100]] }, freshness: 'records', personal: true,
          reads: 'Distinct published archetypes on the team. A mix, never a "good" archetype.', source: 'profile_archetypes, profile_archetype_publish' },
        { key: 'values_alignment', label: 'Co-founder values alignment', weight: 10, rule: { kind: 'direct' }, freshness: 'records', personal: true,
          reads: 'The co-founders’ alignment band, with every founder’s consent. No consent to share values is stored yet, so v1 reads none. A solo founder: not expected, never zero.', source: null },
      ],
    },
    market: {
      scope: 'market', label: 'Market', not_expected_at: [],
      inputs: [
        { key: 'sector_momentum', label: 'Sector momentum', weight: 40, rule: { kind: 'direct' }, freshness: 'connector',
          reads: 'The live composite index for the venture’s sector.', source: 'market_intel_indexes' },
        { key: 'competitors', label: 'Competitors tracked', weight: 30, rule: { kind: 'steps', steps: [[1, 40], [3, 70], [5, 100]] }, freshness: 'records',
          reads: 'Competitors tracked and not stopped; one with a source counts as Sourced.', source: 'competitor_tracking, market_sources' },
        { key: 'market_size', label: 'TAM and SAM', weight: 30, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'TAM and SAM recorded (each half). Sourced only with a cited sizing; typed alone is Stated.', source: 'projects, project_market_assumptions, markets' },
      ],
    },
    technical: {
      scope: 'technical', label: 'Technical', not_expected_at: [],
      inputs: [
        { key: 'must_haves', label: 'Must-haves done', weight: 25, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Must-have features in scope that are done; one merged through a pull request is Measured.', source: 'mvp_features' },
        { key: 'shipping_cadence', label: 'Shipping cadence', weight: 20, rule: { kind: 'steps', steps: [[1, 40], [3, 70], [6, 100]] }, freshness: 'connector',
          reads: 'Releases and roadmap items shipped in the last 90 days.', source: 'roadmap_releases, roadmap_okrs' },
        { key: 'build_activity', label: 'Build activity', weight: 15, rule: { kind: 'steps', steps: [[1, 25], [20, 50], [80, 75], [200, 100]] }, freshness: 'connector',
          reads: 'Commits in the last 90 days across the venture’s repositories, as one count.', source: 'github_contributors' },
        { key: 'technical_risks', label: 'Technical risks owned', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Open risks tied to a feature that have an owner and a mitigation.', source: 'venture_risks' },
        { key: 'production_health', label: 'Production health', weight: 15, rule: { kind: 'direct' }, freshness: 'connector',
          reads: 'Production health from Vercel (#2408), once a product is live.', source: null },
        { key: 'architecture', label: 'Architecture recorded', weight: 10, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Design notes and the stack recorded (each half).', source: 'solution_design_notes, solution_design_stack' },
      ],
    },
    traction: {
      scope: 'traction', label: 'Traction', not_expected_at: BEFORE_BUILD,
      inputs: [
        { key: 'revenue', label: 'Revenue (MRR)', weight: 35, rule: { kind: 'steps', steps: [[1, 20], [1_000, 40], [10_000, 70], [50_000, 100]] }, freshness: 'connector',
          reads: 'The latest MRR, from Stripe, then Mercury, then typed.', source: 'project_metrics' },
        { key: 'growth', label: 'Growth over 3 months', weight: 25, rule: { kind: 'scale', zero: 0, full: 60 }, freshness: 'connector',
          reads: 'MRR growth over about three months, same source: full at 60%.', source: 'project_metrics' },
        { key: 'retention', label: 'Retention', weight: 25, rule: { kind: 'scale', zero: 50, full: 110 }, freshness: 'connector',
          reads: 'Net revenue retention, 50% to 110%; else monthly churn, read as 100% less twelve months of it.', source: 'project_metrics' },
        { key: 'paying_customers', label: 'Paying customers', weight: 15, rule: { kind: 'steps', steps: [[1, 30], [10, 60], [50, 100]] }, freshness: 'connector',
          reads: 'Paying accounts, from the latest snapshot.', source: 'project_metrics' },
      ],
    },
    financial: {
      scope: 'financial', label: 'Financial', not_expected_at: BEFORE_BUILD,
      inputs: [
        { key: 'runway', label: 'Runway', weight: 30, rule: { kind: 'steps', steps: [[3, 20], [6, 50], [12, 80], [18, 100]] }, freshness: 'connector', personal: true,
          reads: 'Months of runway, from Mercury first, else typed.', source: 'mercury_raise_facts, projects' },
        { key: 'use_of_funds', label: 'Use of funds', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'A raise target and an allocation recorded (each half).', source: 'projects' },
        { key: 'raise_progress', label: 'Raise progress', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Committed against the target across the venture’s deals.', source: 'deals' },
        { key: 'narrative_match', label: 'Narrative figures match', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Checked narrative figures whose stated value matches the stored metric.', source: 'narrative_checks' },
        { key: 'burn_trend', label: 'Burn trend', weight: 15, rule: { kind: 'scale', zero: -50, full: 50 }, freshness: 'connector', personal: true,
          reads: 'Net burn now against about three months ago: down 50% is full, up 50% is zero.', source: 'project_metrics' },
        { key: 'capital_efficiency', label: 'Capital efficiency', weight: 10, rule: { kind: 'scale', zero: 0, full: 100 }, freshness: 'connector', personal: true,
          reads: 'MRR as a share of net burn, both measured: full at 100%.', source: 'project_metrics' },
      ],
    },
    risk: {
      scope: 'risk', label: 'Risk', not_expected_at: [],
      inputs: [
        { key: 'risk_register', label: 'Risk register kept', weight: 25, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'High risks with an owner and a mitigation. Recording a risk never lowers the score: a register with no high risk is full.', source: 'venture_risks' },
        { key: 'dd_band', label: 'Due diligence band', weight: 30, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'The band of the latest completed DD case with findings: green 100, yellow 70, amber 40, red 10.', source: 'dd_cases, dd_findings' },
        { key: 'analyst_layers', label: 'Analyst layer reviews', weight: 25, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'The mean analyst score across the venture-risk layers an analyst scored.', source: 'venture_risk_overrides' },
        { key: 'invalidated_claims', label: 'Invalidated claims answered', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Claims whose last verdict is invalidated, answered by a pivot or stop given since.', source: 'hypothesis_verdict_history, validation_decisions' },
      ],
    },
    geographic: {
      scope: 'geographic', label: 'Geographic', not_expected_at: [],
      inputs: [
        { key: 'market_readiness', label: 'Market readiness', weight: 40, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'Demand, partners and cost per market served, entering or considered, each sourced, averaged.', source: 'markets' },
        { key: 'country_environment', label: 'Country environment', weight: 60, rule: { kind: 'direct' }, freshness: 'quarter',
          reads: 'The external country index for each market (owner question 4). Facts only until the owner chooses one.', source: null },
      ],
    },
    political: {
      scope: 'political', label: 'Political and regulatory', not_expected_at: [],
      inputs: [
        { key: 'regulation_readiness', label: 'Regulation readiness', weight: 30, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'Regulation readiness per market, with its source, averaged.', source: 'markets' },
        { key: 'dd_compliance', label: 'DD compliance section', weight: 20, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'The completed compliance section of a completed DD case: pass 100, warn 50, fail 0.', source: 'dd_sections' },
        { key: 'high_risk_lists', label: 'High-risk jurisdiction lists', weight: 25, rule: { kind: 'direct' }, freshness: 'quarter',
          reads: 'Exposure to the FATF and EU high-risk lists (owner question 4). Not imported yet.', source: null },
        { key: 'stability', label: 'Political stability and regulatory quality', weight: 25, rule: { kind: 'direct' }, freshness: 'quarter',
          reads: 'The external governance indicators (owner question 4). Not imported yet.', source: null },
      ],
    },
    governance: {
      scope: 'governance', label: 'Governance', not_expected_at: [],
      inputs: [
        { key: 'cap_table', label: 'Cap table recorded', weight: 20, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'Holders recorded on the cap table; from Carta it is Measured.', source: 'cap_table_holders' },
        { key: 'founder_vesting', label: 'Founder vesting', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'records', personal: true,
          reads: 'Founder holders with a vesting schedule.', source: 'cap_table_holders, cap_table_vesting' },
        { key: 'filings', label: 'Filings on time', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Obligations already due that were filed by their date or waived.', source: 'entity_obligations' },
        { key: 'formation', label: 'Formation done with proof', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Formation steps done; one with proof is Measured.', source: 'formation_steps' },
        { key: 'data_room', label: 'Data-room checklist', weight: 15, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Diligence checklist items with a file.', source: 'data_room_files' },
        { key: 'operating_rhythm', label: 'Operating rhythm', weight: 10, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Rituals run of those due in the last 12 weeks.', source: 'ritual_runs' },
      ],
    },
    legal_ip: {
      scope: 'legal_ip', label: 'Legal and IP', not_expected_at: [],
      inputs: [
        { key: 'ip_assignment', label: 'IP assignment', weight: 30, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'IP assignment steps done; with proof or GitHub organisation evidence it is Measured.', source: 'formation_steps, formation_step_checks' },
        { key: 'code_held', label: 'Code held by the company', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'connector',
          reads: 'Repositories owned by an organisation, not a person.', source: 'github_repo_facts' },
        { key: 'founder_agreements', label: 'Founder agreements signed', weight: 20, rule: { kind: 'share', full: 1 }, freshness: 'records',
          reads: 'Signed founder agreements. No platform store links them to a venture yet.', source: null },
        { key: 'spinout_ip', label: 'Spin-out IP terms', weight: 20, rule: { kind: 'direct' }, freshness: 'records',
          reads: 'The spin-out’s IP terms recorded. Spin-Out ventures only.', source: 'projects' },
        { key: 'licences', label: 'Licence files', weight: 10, rule: { kind: 'share', full: 1 }, freshness: 'connector',
          reads: 'Repositories with a licence file.', source: 'github_repo_facts' },
      ],
    },
  },
});
