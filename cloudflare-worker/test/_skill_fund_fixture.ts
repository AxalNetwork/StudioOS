/**
 * D4667-p4 (#4667): the synthetic fund world `skill_fund_evidence_4667` and `skill_mcp_evidence_4667` share. Every row
 * is made up; the model is a stub.
 */
import { ADMIN, AGENT, COMPANY, MEMBER, PROJECT, SPONSOR, world, type World } from './_agent_engine_fixture.ts';
import { AI_FIXTURE_PLANS } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun, type AgentRunInput } from '../src/services/agents/agentRun.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { READERS, coverageOf, readOne, type ReadContext } from '../src/services/agents/reads.ts';
import { preflight } from '../src/services/agents/skillInputs.ts';

export const RUN_MODEL = '@cf/openai/gpt-oss-120b';
export const GUARD = '@cf/meta/llama-guard-3-8b';
export const SKILL_UID = 'f'.repeat(32);
export const SLUG = 'lp-quarterly-letter-draft';
export const STEP = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', prompt: 'Draft the Q3 letter.' };
export const SCOPE = { kind: 'project', id: PROJECT, name: 'Kestrel', founder_id: 100, company_id: COMPANY } as any;
export const READS = ['project.summary', 'fund.performance', 'grow.records'];
export const FUND = 5, OTHER_GP = 6, NO_COMPANY = 7, OTHER_COMPANY = 9;
export const NOW = Date.parse('2026-11-19T12:00:00Z');
export const TO = '2026-11-19';
/** Growth context answers complete and fresh, so the fund's performance is the only input in question. */
export const withGrowth = {
  ...READERS,
  'grow.records': async () => ({ records: [{ ref: 'activity:grow-1', at: '2026-11-10 10:00:00' }], coverage: coverageOf(1, 1) }),
} as any;

/**
 * A project agent with the LP letter pinned, its rule book reading `fund.performance`, its sponsor an institutional
 * investor who is the GP of record of fund 5 under the venture's company. Fund 5 in 2026-Q3: two positions marked on
 * 2026-09-30 (and one later mark that is not the quarter's), a numbered call and a legacy LP line issued in the
 * quarter, one paid distribution and one pending.
 */
export function fundWorld(o: { sponsor?: number; skillTools?: string[] } = {}) {
  __resetForTest();
  const w = world();
  const sponsor = o.sponsor ?? SPONSOR;
  w.agent(AGENT, 'cfo', { sponsor });
  w.db.exec(AI_FIXTURE_PLANS);
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id = ?").run(sponsor);
  if (sponsor !== ADMIN) w.db.prepare("INSERT INTO account_licences (user_id, licence, source) VALUES (?, 'investor', 'synthetic')").run(sponsor);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES ('founder:growth', 0, 0, 1), ('investor:institutional', 0, 0, 1), ('admin', 0, 0, 1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, 50000000)').run(sponsor);
  w.db.prepare('UPDATE team_agents SET model_id = ? WHERE id = ?').run(RUN_MODEL, AGENT);
  const rules = { ...roleOf('cfo')!.default_rules, reads: READS };
  w.db.prepare(`INSERT INTO team_rulebooks (uid, scope_kind, project_id, role_key, version, rules_json, created_by)
    VALUES ('book-4667-p4', 'project', ?, 'cfo', 1, ?, ?)`).run(PROJECT, JSON.stringify(rules), SPONSOR);
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (1, ?, 'hq', ?, 'LP quarterly letter', 'The quarter for LPs.', '["Read the quarter"]', ?, 'draft', 'published', 1, ?)`).run(SKILL_UID, SLUG, JSON.stringify(o.skillTools ?? []), ADMIN);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (1, 1, 'md', 'LP quarterly letter', 'The quarter for LPs.', '["Read the quarter"]', ?, 'draft', '[]', '["cfo"]', ?)`).run(JSON.stringify(o.skillTools ?? []), ADMIN);
  w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, 1, 1, ?)').run(AGENT, sponsor);
  w.db.exec(`
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (8, 'p8', 'Tidepool Health', 101, 1);
    INSERT INTO vc_funds (id, name, vintage_year, status, gp_user_id, company_id) VALUES
      (${FUND}, 'Synthetic Fund I', 2025, 'investing', ${SPONSOR}, ${COMPANY}),
      (${OTHER_GP}, 'Another GP fund', 2025, 'investing', ${MEMBER}, ${COMPANY}),
      (${NO_COMPANY}, 'Synthetic Fund II', 2026, 'fundraising', ${SPONSOR}, NULL),
      (${OTHER_COMPANY}, 'Elsewhere fund', 2024, 'investing', ${SPONSOR}, 2);
    INSERT INTO limited_partners (id, fund_id, commitment_amount, name) VALUES (1, ${FUND}, 10000000, 'Synthetic LP');
    INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, line_count, created_at) VALUES
      (1, 'call-2025-1', ${FUND}, 1, 300000000, 1, '2025-03-01 09:00:00'),
      (2, 'call-2026-2', ${FUND}, 2, 250000000, 1, '2026-08-15 09:00:00'),
      (3, 'call-2026-3', ${FUND}, 3, 100000000, 1, '2026-10-20 09:00:00');
    INSERT INTO capital_calls (uid, limited_partner_id, amount, status, created_at) VALUES ('legacy-line-1', 1, 1000.5, 'paid', '2026-07-10 09:00:00');
    INSERT INTO portfolio_positions (id, uid, fund_id, project_id, round_name, invested_amount, position_date) VALUES
      (21, 'pos-kestrel', ${FUND}, ${PROJECT}, 'Seed', 2000000, '2025-04-01'),
      (22, 'pos-tidepool', ${FUND}, 8, 'Pre-Seed', 1000000, '2025-05-01');
    INSERT INTO fund_position_valuations (uid, position_id, valuation_date, value_cents, source, recorded_by) VALUES
      ('mark-kestrel-q3', 21, '2026-09-30', 420000000, 'Synthetic board pack', ${SPONSOR}),
      ('mark-kestrel-q4', 21, '2026-10-31', 999000000, 'Synthetic later round', ${SPONSOR}),
      ('mark-tidepool-q3', 22, '2026-09-30', 180000000, 'Synthetic board pack', ${SPONSOR});
    INSERT INTO fund_distributions (id, fund_id, lp_id, amount_cents, distribution_type, status, distributed_at) VALUES
      (31, ${FUND}, 1, 5000000, 'profit_share', 'paid', '2026-09-01 12:00:00'),
      (32, ${FUND}, 1, 7000000, 'profit_share', 'pending', '2026-09-15 12:00:00');
  `);
  const prompts: string[] = [];
  const calls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string, input: any) => {
    calls.push(model);
    if (model !== GUARD) prompts.push(JSON.stringify(input.messages ?? input));
    return { response: '## Quarter in brief\n- Called once.', usage: { prompt_tokens: 40, completion_tokens: 10 } };
  } });
  return { w, prompts, calls };
}
export const agentOf = (w: World) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
export const ctx = (w: World, fund: string | null = null, scope = SCOPE, to: string | null = TO): ReadContext => ({ scope, agent: agentOf(w), projectId: PROJECT, fund, page: { to } });
export const read = async (w: World, fund: string | null = null, scope = SCOPE, to: string | null = TO) => (await readOne(w.env, 'fund.performance', ctx(w, fund, scope, to))).data as any;
export const count = (w: World, sql: string) => (w.db.prepare(sql).get() as any).n as number;
export const modelCalls = (calls: string[]) => calls.filter((m) => m !== GUARD).length;
export const manual = (w: World, over: Partial<AgentRunInput> = {}) => agentRun(w.env, { agent: agentOf(w), ...STEP, skill: SKILL_UID, ...over });
export const letter = async (w: World, fund: string | null, readers = withGrowth) =>
  (await preflight(w.env, SLUG, ctx(w, fund), readers, NOW, undefined, {}, { granted: READS }))!;
export const fundInput = (p: Awaited<ReturnType<typeof letter>>) => p.inputs.find((i) => i.read === 'fund.performance')!;
