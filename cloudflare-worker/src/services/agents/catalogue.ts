/**
 * D1496 (#3840, part 1 of #3727) — the team agent catalogue: the modules an
 * agent can work in, the reads it can be given, the rail options it can
 * propose through, and the eleven roles with their default rule books.
 *
 * Pure: no binding. `routes/team_agents.ts` serves it, and `rulebook.ts`
 * validates a scope's rule book against it.
 *
 * WHERE THE KEYS COME FROM.
 *  - A module key is a cycle module slug that already exists: Validate's,
 *    Build's, Raise's and Grow's (`cycleValidate.ts`, `cycleActivity.ts`'s
 *    `BuildModuleSlug`, `raiseCycle.ts`, `growCycle.ts`), plus the three
 *    founder pages that are not a cycle (Studio, Research, Network). Written
 *    here rather than imported: the cycle services reach Stripe and the
 *    database, and this file must stay pure. `team_agents_d1496.test.ts`
 *    checks the four cycle lists against these.
 *  - An option key is a rail option a founder page registers
 *    (`frontend/src/lib/railOptions/*.js`, generated into
 *    `ai/railMatrix.json`, D764). A module's options are the ones on its own
 *    page and on its cycle's page ("Founder · Grow" is every Grow module's).
 *  - The read keys are owned here (#3742 correction 9). Most have no reader
 *    yet; part 2's run gives the model only the ones a rule book lists.
 */
import { railOptionRows } from '../ai/railMatrix';

export type ModuleDef = { key: string; label: string; cycle: 'validate' | 'build' | 'raise' | 'grow' | null; page: string };

const CYCLE_WORD = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' } as const;
const cycleModule = (cycle: keyof typeof CYCLE_WORD, key: string, label: string, pageLabel = label): ModuleDef =>
  ({ key, label, cycle, page: `Founder · ${CYCLE_WORD[cycle]} · ${pageLabel}` });

export const MODULES: readonly ModuleDef[] = Object.freeze([
  { key: 'studio', label: 'Studio', cycle: null, page: 'Founder · Studio' },
  cycleModule('validate', 'problem-discovery', 'Problem discovery'),
  cycleModule('validate', 'customer-research', 'Customer research'),
  cycleModule('validate', 'ideal-customer-profile', 'Ideal customer profile'),
  cycleModule('validate', 'market-intelligence', 'Market intelligence'),
  cycleModule('validate', 'demand-signals', 'Demand and urgency signals'),
  cycleModule('validate', 'experiments', 'Experiments and evidence'),
  cycleModule('validate', 'verdict', 'Verdict'),
  cycleModule('build', 'solution-design', 'Solution design'),
  cycleModule('build', 'prototype-mvp', 'Prototype / MVP'),
  cycleModule('build', 'product-roadmap', 'Product roadmap'),
  cycleModule('build', 'founding-team', 'Founding team'),
  cycleModule('build', 'company-creation', 'Company creation'),
  cycleModule('build', 'operating-systems', 'Operating systems'),
  cycleModule('raise', 'fundraising-readiness', 'Fundraising readiness'),
  cycleModule('raise', 'investor-narrative', 'Investor narrative'),
  cycleModule('raise', 'pitch-deck', 'Pitch deck'),
  cycleModule('raise', 'data-room', 'Data room'),
  cycleModule('raise', 'cap-table', 'Cap table'),
  cycleModule('raise', 'use-of-funds', 'Use of funds'),
  cycleModule('raise', 'capital-relationships', 'Capital relationships'),
  cycleModule('grow', 'product-improvement', 'Product improvement'),
  cycleModule('grow', 'distribution', 'Distribution'),
  cycleModule('grow', 'revenue-and-traction', 'Revenue and traction'),
  cycleModule('grow', 'team-expansion', 'Team expansion'),
  cycleModule('grow', 'partner-network', 'Partner network'),
  cycleModule('grow', 'market-expansion', 'Market expansion'),
  cycleModule('grow', 'durable-company-building', 'Durable company-building'),
  { key: 'research', label: 'Research', cycle: null, page: 'Founder · Research' },
  { key: 'network', label: 'Network', cycle: null, page: 'Founder · Network' },
]);
const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
export const moduleOf = (key: string): ModuleDef | null => MODULE_BY_KEY.get(key) ?? null;

/** The rail option keys a module's pages register. A page-less module (no options yet) answers []. */
export function optionsIn(moduleKey: string): string[] {
  const m = moduleOf(moduleKey);
  if (!m) return [];
  const cyclePage = m.cycle ? `Founder · ${CYCLE_WORD[m.cycle]}` : null;
  const keys = new Set<string>();
  for (const o of railOptionRows()) {
    const on = o.pageKey === m.page || o.pageKey === cyclePage || (!m.cycle && o.pageKey.startsWith(`${m.page} · `));
    if (on) keys.add(o.optionKey);
  }
  return [...keys];
}

/** Every option key a founder module offers: what `may_propose` may name. */
export function optionKeys(): Set<string> {
  const all = new Set<string>();
  for (const m of MODULES) for (const k of optionsIn(m.key)) all.add(k);
  return all;
}

/**
 * The reads a rule book may grant (#3742 correction 9: owned here). A key
 * without a reader yet is still a valid grant; part 2 passes the model only
 * the reads that exist and the rule book lists.
 */
export const READ_KEYS = Object.freeze([
  'project.summary', 'company.profile', 'team.roster',
  'validate.records', 'build.records', 'raise.records', 'grow.records',
  'cap_table.read', 'data_room.index', 'research.library', 'network.relationships',
  'compliance.calendar', 'mercury.balances', 'stripe.revenue',
  'github.repos', 'vercel.deployments',
] as const);

/**
 * The hard floor (D1496): what an agent always asks a person for. Written in
 * code; a rule book that drops one is refused `rule_floor`.
 */
export const ALWAYS_ASKS_FLOOR = Object.freeze([
  'payment', 'sign', 'file', 'cap_table_write', 'send_email', 'send_post', 'invite_person',
] as const);
/** What `always_asks_human` may name: the floor plus the asks a scope may add. */
export const ASK_KEYS = Object.freeze([...ALWAYS_ASKS_FLOOR, 'share_outside', 'delete_record', 'change_plan'] as const);

export type Rules = {
  mission: string;
  works_in: string[];
  reads: string[];
  may_propose: string[];
  may_do_automatically: string[];
  always_asks_human: string[];
  escalates_when: string[];
  kpis: string[];
  tone: string;
};

export type Role = {
  key: string;
  name: string;
  mission: string;
  /** General counsel only: the key of a disclaimer whose wording is the owner's or counsel's. No text is stored here. */
  disclaimer_key?: string;
  default_rules: Rules;
};

const role = (key: string, name: string, r: Omit<Rules, 'may_do_automatically' | 'always_asks_human'> & { asks?: string[] }, extra: Partial<Role> = {}): Role => {
  const { asks = [], ...rest } = r;
  return Object.freeze({
    key, name, mission: r.mission, ...extra,
    default_rules: Object.freeze({ ...rest, may_do_automatically: [], always_asks_human: [...ALWAYS_ASKS_FLOOR, ...asks] }) as Rules,
  });
};

/**
 * The eleven roles of #3727's table. S1 drafted the defaults; the owner
 * reviews them in D1496. Each `may_propose` option is offered in one of the
 * role's `works_in` modules (the test checks it), so every default passes
 * the validator a scope's own edit must pass.
 */
export const ROLES: readonly Role[] = Object.freeze([
  role('ceo', 'CEO / Chief of staff', {
    mission: 'Keep the studio pointed at this quarter’s priorities: the weekly plan, and drafts of board and investor updates.',
    works_in: ['studio', 'operating-systems', 'product-roadmap', 'revenue-and-traction'],
    reads: ['project.summary', 'company.profile', 'team.roster', 'build.records', 'grow.records'],
    may_propose: ['draft:build/plan', 'draft:build/this-week', 'draft:build/retro', 'draft:update'],
    escalates_when: ['A priority slips two weeks in a row', 'An update would go to investors'],
    kpis: ['Weekly plan agreed each Monday', 'Updates drafted on time'],
    tone: 'Direct and brief',
  }),
  role('cto', 'CTO', {
    mission: 'Turn validated problems into a buildable solution, a roadmap and a working prototype.',
    works_in: ['solution-design', 'prototype-mvp', 'product-roadmap'],
    reads: ['project.summary', 'build.records', 'github.repos', 'vercel.deployments'],
    may_propose: ['draft:build/plan', 'draft:build/roadmap'],
    escalates_when: ['A must-have has no owner', 'A technical due diligence question has no evidence'],
    kpis: ['Must-haves shipped against the plan', 'Roadmap reviewed every month'],
    tone: 'Precise and plain',
  }),
  role('cpo', 'CPO / Product', {
    mission: 'Find the problem worth solving and the customer who has it, and test it before it is built.',
    works_in: ['problem-discovery', 'customer-research', 'ideal-customer-profile', 'experiments', 'product-roadmap'],
    reads: ['project.summary', 'validate.records', 'build.records'],
    may_propose: ['fill:pain_tag', 'structure:transcript', 'summarise:session', 'fill:hypothesis', 'draft:build/roadmap'],
    escalates_when: ['An experiment contradicts the plan', 'Fewer than three interviews back a decision'],
    kpis: ['Interviews logged each week', 'Hypotheses with evidence'],
    tone: 'Curious and evidence-first',
  }),
  role('cfo', 'CFO', {
    mission: 'Keep the money honest: use of funds, runway, the financial model and cap table scenarios, all as proposals.',
    works_in: ['use-of-funds', 'cap-table', 'fundraising-readiness', 'company-creation'],
    reads: ['project.summary', 'raise.records', 'cap_table.read', 'mercury.balances', 'stripe.revenue', 'compliance.calendar'],
    may_propose: ['draft:raise/use-of-funds-runway', 'draft:raise/use-of-funds-check', 'draft:raise/capital', 'draft:raise/liquidity'],
    escalates_when: ['Runway falls under six months', 'A filing is due within thirty days'],
    kpis: ['Runway stated every month', 'Use of funds matches the raise'],
    tone: 'Careful and numerate',
  }),
  role('cmo', 'CMO / Growth', {
    mission: 'Draft the campaigns, posts, newsletters and ads that bring the right customers in.',
    works_in: ['distribution', 'revenue-and-traction'],
    reads: ['project.summary', 'grow.records'],
    may_propose: ['draft:grow/customers', 'draft:taglines', 'form:landing', 'draft:update'],
    escalates_when: ['A post would go out under the company’s name', 'A campaign has no measure'],
    kpis: ['Drafts ready for each campaign', 'Channels with a measured result'],
    tone: 'Clear and warm',
  }),
  role('sales', 'Head of Sales / BD', {
    mission: 'Find and warm up prospects and partners, and draft the sequences that reach them.',
    works_in: ['distribution', 'partner-network', 'network'],
    reads: ['project.summary', 'grow.records', 'network.relationships'],
    may_propose: ['draft:grow/customers', 'draft:network/intro-email', 'draft:network/re-engagement'],
    escalates_when: ['A prospect asks for terms', 'An introduction would go out'],
    kpis: ['Prospects in the pipeline', 'Introductions asked for'],
    tone: 'Friendly and to the point',
  }),
  role('coo', 'COO / Operations', {
    mission: 'Set up and run the company: formation, operating systems, compliance and the calendar.',
    works_in: ['company-creation', 'operating-systems'],
    reads: ['project.summary', 'company.profile', 'build.records', 'compliance.calendar'],
    may_propose: ['draft:build/this-week', 'draft:build/kpi', 'draft:build/retro'],
    escalates_when: ['A formation step is blocked', 'A compliance date is missed'],
    kpis: ['Formation steps done', 'Weekly reviews held'],
    tone: 'Orderly and calm',
  }),
  role('general_counsel', 'General counsel (assistant)', {
    mission: 'Prepare the data room and legal readiness. It never gives legal advice as final, and always escalates.',
    works_in: ['data-room', 'fundraising-readiness', 'company-creation'],
    reads: ['project.summary', 'company.profile', 'data_room.index', 'raise.records'],
    may_propose: ['draft:raise/legal', 'draft:raise/data-room'],
    escalates_when: ['Always: every draft goes to a person and to counsel'],
    kpis: ['Data room sections complete', 'Open legal questions listed'],
    tone: 'Formal and cautious',
    asks: ['share_outside'],
  }, { disclaimer_key: 'agents.general_counsel.disclaimer' }),
  role('people', 'Head of People', {
    mission: 'Shape the founding team, the roles to hire and the equity plan, as proposals.',
    works_in: ['founding-team', 'team-expansion'],
    reads: ['project.summary', 'team.roster', 'cap_table.read'],
    may_propose: ['draft:grow/talent'],
    escalates_when: ['An offer or an equity grant would be made', 'A founder’s vesting changes'],
    kpis: ['Open roles described', 'Equity plan reviewed'],
    tone: 'Considerate and fair',
  }),
  role('research_analyst', 'Research analyst', {
    mission: 'Read the market and the competitors, and keep the research library current.',
    works_in: ['research', 'market-intelligence'],
    reads: ['project.summary', 'research.library', 'validate.records'],
    may_propose: ['draft:research/ask', 'analyse:competitors', 'draft:research/library'],
    escalates_when: ['A source cannot be verified', 'A competitor changes the plan'],
    kpis: ['Competitors tracked', 'Sources cited per brief'],
    tone: 'Neutral and sourced',
  }),
  role('investor_relations', 'Investor relations', {
    mission: 'Keep investor relationships warm and the narrative sharp, and answer data room questions.',
    works_in: ['capital-relationships', 'investor-narrative', 'data-room'],
    reads: ['project.summary', 'raise.records', 'data_room.index', 'network.relationships'],
    may_propose: ['draft:narrative-section', 'draft:narrative-positioning', 'draft:narrative-objection', 'draft:raise/narrative-fix'],
    escalates_when: ['An investor asks for terms', 'A data room answer would be shared'],
    kpis: ['Investors updated each month', 'Questions answered within a week'],
    tone: 'Confident and exact',
  }),
]);
const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));
export const roleOf = (key: string): Role | null => ROLE_BY_KEY.get(key) ?? null;
