/**
 * D1530 (#3848, E4 of #3742) — role templates and the "team from a goal"
 * wizard. In code, no table.
 *
 * A TEMPLATE is a catalogue role plus a preset: a model tier, a suggested
 * monthly cap and its duty templates (the recurring runs E5 schedules). The
 * suggested cap is only a pre-filled value: the person adding the agent sets
 * the real cap on #3727's POST.
 *
 * THE WIZARD is rule-based: no model call, nothing charged to open it, and
 * nothing is created by the read. Its stage mapping is D1530's draft, for the
 * owner to review:
 *   idea, validate → Research analyst, CPO
 *   build          → CTO, CPO, COO
 *   launch         → CMO, Sales
 *   raise          → CFO, Investor relations, General counsel (assistant)
 *   grow           → CMO, Sales, Head of People
 *   a company      → CEO / Chief of staff, CFO, General counsel (assistant)
 * A role is also suggested when an open task's module is in its `works_in`.
 */
import { moduleOf, roleOf, ROLES, type Role } from './catalogue';
import { optionRowIn } from './agentRun';

export type ModelTier = 'fast' | 'balanced' | 'best';
export type Duty = { key: string; label: string; module: string; option: string; runs_per_month: number };
export type Template = { key: string; role_key: string; name: string; model_tier: ModelTier; suggested_cap_microusd: number; duties: Duty[] };

const USD = 1_000_000;
const duty = (key: string, label: string, module: string, option: string, runs_per_month: number): Duty => ({ key, label, module, option, runs_per_month });

/** One template per catalogue role. Each duty's option is in the role's own `may_propose` and offered in its module (the test checks it). */
const PRESETS: Record<string, { tier: ModelTier; cap_usd: number; duties: Duty[] }> = {
  ceo: { tier: 'best', cap_usd: 20, duties: [duty('weekly_plan', 'Draft the weekly plan', 'operating-systems', 'draft:build/this-week', 4), duty('monthly_update', 'Draft the monthly update', 'revenue-and-traction', 'draft:update', 1)] },
  cto: { tier: 'balanced', cap_usd: 15, duties: [duty('build_plan', 'Review the build plan', 'solution-design', 'draft:build/plan', 4), duty('roadmap', 'Refresh the roadmap', 'product-roadmap', 'draft:build/roadmap', 1)] },
  cpo: { tier: 'balanced', cap_usd: 10, duties: [duty('roadmap', 'Argue the roadmap ordering', 'product-roadmap', 'draft:build/roadmap', 2)] },
  cfo: { tier: 'balanced', cap_usd: 10, duties: [duty('runway', 'State the runway', 'use-of-funds', 'draft:raise/use-of-funds-runway', 1), duty('funds_check', 'Check the use of funds', 'use-of-funds', 'draft:raise/use-of-funds-check', 1)] },
  cmo: { tier: 'fast', cap_usd: 10, duties: [duty('customer_drafts', 'Draft customer outreach', 'distribution', 'draft:grow/customers', 4)] },
  sales: { tier: 'fast', cap_usd: 10, duties: [duty('outreach', 'Draft prospect outreach', 'distribution', 'draft:grow/customers', 4)] },
  coo: { tier: 'fast', cap_usd: 8, duties: [duty('weekly_plan', 'Draft the Monday plan', 'operating-systems', 'draft:build/this-week', 4), duty('kpis', 'Review the KPIs', 'operating-systems', 'draft:build/kpi', 1)] },
  general_counsel: { tier: 'best', cap_usd: 10, duties: [duty('data_room', 'Review the data room', 'fundraising-readiness', 'draft:raise/data-room', 1)] },
  people: { tier: 'balanced', cap_usd: 8, duties: [duty('talent', 'Describe the roles to hire', 'team-expansion', 'draft:grow/talent', 1)] },
  // No option a research analyst may propose is a text run yet, so it has no duty to schedule (and no estimate).
  research_analyst: { tier: 'balanced', cap_usd: 10, duties: [] },
  investor_relations: { tier: 'balanced', cap_usd: 10, duties: [duty('narrative', 'Sharpen the narrative', 'investor-narrative', 'draft:narrative-section', 1)] },
};

export const TEMPLATES: readonly Template[] = Object.freeze(ROLES.filter((r) => PRESETS[r.key]).map((r) => Object.freeze({
  key: `template:${r.key}`, role_key: r.key, name: r.name, model_tier: PRESETS[r.key].tier,
  suggested_cap_microusd: PRESETS[r.key].cap_usd * USD, duties: PRESETS[r.key].duties,
})));
export const templateOf = (roleKey: string): Template | null => TEMPLATES.find((t) => t.role_key === roleKey) ?? null;

/** The wizard's stage mapping (D1530, the owner reviews). `company` is a company scope, whatever its stage. */
export const STAGE_ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  idea: ['research_analyst', 'cpo'],
  validate: ['research_analyst', 'cpo'],
  build: ['cto', 'cpo', 'coo'],
  launch: ['cmo', 'sales'],
  raise: ['cfo', 'investor_relations', 'general_counsel'],
  grow: ['cmo', 'sales', 'people'],
  company: ['ceo', 'cfo', 'general_counsel'],
});

export type Estimate = { available: false } | { available: true; value: number };
/** What one duty run would hold, in micro-USD; null when it cannot be read (never 0). */
export type DutyQuote = (d: Duty, row: NonNullable<ReturnType<typeof optionRowIn>>) => Promise<number | null>;

/** A month of the template's duties: each duty's quote × its runs. Unknown when any quote is, or when there is no duty. */
export async function monthEstimate(t: Template, quote: DutyQuote): Promise<Estimate> {
  // No duty scheduled: nothing to estimate, which is not the same as costing 0.
  if (!t.duties.length) return { available: false };
  let total = 0;
  for (const d of t.duties) {
    const row = optionRowIn(d.module, d.option);
    if (!row) return { available: false };
    let q: number | null;
    try { q = await quote(d, row); } catch { q = null; }
    if (q == null || !Number.isFinite(q) || q < 0) return { available: false };
    total += q * d.runs_per_month;
  }
  return { available: true, value: total };
}

export type Suggestion = { role_key: string; why: string; template: Template | null; already_on_team: boolean; est_month_microusd: Estimate };

const STAGE_WORD: Record<string, string> = { idea: 'Idea', validate: 'Validate', build: 'Build', launch: 'Launch', raise: 'Raise', grow: 'Grow' };

/**
 * The roles to suggest: the stage's, then any role an open task's module
 * needs, each once, in the catalogue's order within each reason. Nothing is
 * read from a model and nothing is written.
 */
export function suggestRoles(input: { scopeKind: 'company' | 'project'; stage: string | null; openTaskModules: string[] }): Array<{ role_key: string; why: string }> {
  const out: Array<{ role_key: string; why: string }> = [];
  const seen = new Set<string>();
  const add = (key: string, why: string) => { if (!seen.has(key) && roleOf(key)) { seen.add(key); out.push({ role_key: key, why }); } };
  if (input.scopeKind === 'company') for (const k of STAGE_ROLES.company) add(k, 'Every company needs it');
  else if (input.stage && STAGE_ROLES[input.stage]) for (const k of STAGE_ROLES[input.stage]) add(k, `Suggested for the ${STAGE_WORD[input.stage] ?? input.stage} stage`);
  for (const m of new Set(input.openTaskModules)) {
    const mod = moduleOf(m);
    if (!mod) continue;
    for (const r of ROLES) if (r.default_rules.works_in.includes(m)) add(r.key, `An open task is in ${mod.label}`);
  }
  return out;
}

export const rolesOf = (keys: string[]): Role[] => keys.map((k) => roleOf(k)).filter((r): r is Role => !!r);
