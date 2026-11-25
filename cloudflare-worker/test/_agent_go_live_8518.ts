/**
 * D8518 (#8518): the synthetic world the CFO and General Counsel go-live cases run in. Every value is invented
 * (`example.test`, `example.invalid`); nothing is read from a provider, a network or production, and the model is a
 * stub that records what it was sent.
 *
 * TWO companies, each with a small ledger, a cap table and two contracts:
 *   · Kestrel (project 7, founder user 10), the company the agents under test work for;
 *   · Harbor (project 8, founder user 11), another company. Each of its figures and clauses carries a marker that
 *     appears nowhere in Kestrel's world, so a leak is a string match, never a judgement.
 * The ledger is both native records (balances, burn) and an approved MCP ledger server per company (budget lines and
 * spend by category), whose answers are served from `LEDGERS` by the connection's own uid.
 */
import { readFileSync } from 'node:fs';
import { AGENT, COMPANY, MEMBER, PROJECT, SPONSOR, ADMIN, world, type World } from './_agent_engine_fixture.ts';
import { AI_FIXTURE_PLANS } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun, type AgentRunInput } from '../src/services/agents/agentRun.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { ROLE_PERSONA } from '../src/services/agents/personas.ts';
import { readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';

export const RUN_MODEL = '@cf/openai/gpt-oss-120b';
export const GUARD = '@cf/meta/llama-guard-3-8b';
export const KESTREL = PROJECT, HARBOR = 8;
export const HARBOR_USER = MEMBER;
export const SRV_KESTREL = 'c'.repeat(32), SRV_HARBOR = 'd'.repeat(32);
/** Contract file uids: two per company. */
export const FILES = {
  kestrelMsa: '1'.repeat(32), kestrelNda: '2'.repeat(32),
  harborMsa: '3'.repeat(32), harborNda: '4'.repeat(32),
} as const;
export const KESTREL_CLAUSE = 'Kestrel liability under this agreement shall not exceed the fees paid in the prior twelve months. KESTREL-CLAUSE-91';
export const HARBOR_CLAUSE = 'Harbor may terminate for convenience on ninety days notice. HARBOR-CLAUSE-77';

/** The approved MCP ledger each company's connection answers from. Amounts are whole invented dollars. */
export const LEDGERS: Record<string, { grow: unknown; mercury: unknown }> = {
  [SRV_KESTREL]: {
    // `legal` has a budget and no recorded spend: the one figure that is not recorded.
    grow: { month: '2026-10', currency: 'USD', budget_lines: [{ category: 'payroll', budget: 120000 }, { category: 'marketing', budget: 20000 }, { category: 'legal', budget: 8000 }] },
    mercury: { month: '2026-10', currency: 'USD', spend: [{ category: 'payroll', actual: 118500 }, { category: 'marketing', actual: 26000 }] },
  },
  [SRV_HARBOR]: {
    grow: { month: '2026-10', currency: 'USD', budget_lines: [{ category: 'payroll', budget: 777701 }, { category: 'research', budget: 313131 }] },
    mercury: { month: '2026-10', currency: 'USD', spend: [{ category: 'payroll', actual: 424242 }, { category: 'research', actual: 656565 }] },
  },
};
/** Strings that exist only in Harbor's world. */
export const HARBOR_MARKERS = ['777701', '424242', '656565', '313131', 'HARBOR-CLAUSE-77', 'Harbor Example', '3'.repeat(32)];

const libraryStepsOf = (slug: string): string[] =>
  (readLibrarySkill(readFileSync(new URL(`../src/services/agents/skills/${slug}.md`, import.meta.url), 'utf8')) as { steps: string[] }).steps;

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); // clock-ok: relative

export type AgentWorld = ReturnType<typeof agentWorld>;
export const SKILL_UID = { 'budget-vs-actual': 'a'.repeat(32), 'cash-runway-snapshot': 'b'.repeat(32), 'contract-clause-extraction': 'e'.repeat(32) } as const;
type Slug = keyof typeof SKILL_UID;

/**
 * One agent of `role` for Kestrel, sponsored by Kestrel's founder, on a stubbed model, with the real library skill
 * `slug` pinned. `budget-vs-actual` reads through Kestrel's own approved ledger server; the other two read native records.
 */
export function agentWorld(role: 'cfo' | 'general_counsel', slug: Slug, o: { burn?: boolean; forgedHarborGrant?: boolean } = {}) {
  __resetForTest();
  const w = world({ engine: 'off' });
  w.agent(AGENT, role, { sponsor: SPONSOR });
  w.db.prepare('UPDATE team_agents SET persona_key = ?, model_id = ? WHERE id = ?').run(ROLE_PERSONA[role], RUN_MODEL, AGENT);
  w.db.exec(AI_FIXTURE_PLANS);
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE id IN (?, ?)").run(SPONSOR, HARBOR_USER);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES ('founder:growth', 0, 0, 1), ('admin', 0, 0, 1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, 50000000)').run(SPONSOR);

  // Company B, apart from company A: its own company profile, project and founder.
  w.db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (2, 'co-2', 'Harbor Example');
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (${HARBOR}, 'p8', 'Harbor Example', 101, 2);
  `);
  w.db.prepare("UPDATE company_profiles SET company_name = 'Kestrel Example' WHERE id = ?").run(COMPANY);

  // The rule book reads what the role's skills need.
  const reads = role === 'cfo'
    ? ['project.summary', 'mercury.balances', 'grow.burn', 'cap_table.read']
    : ['project.summary', 'company.profile', 'data_room.index'];
  const rules = { ...roleOf(role)!.default_rules, reads };
  w.db.prepare(`INSERT INTO team_rulebooks (uid, scope_kind, project_id, role_key, version, rules_json, created_by)
    VALUES ('book-8518', 'project', ?, ?, 1, ?, ?)`).run(KESTREL, role, JSON.stringify(rules), SPONSOR);

  // The real library skill, pinned. Its steps are the library file's; the MCP tools are only those the file declares.
  const tools = slug === 'budget-vs-actual' ? ['grow.read', 'mercury.read'] : [];
  const steps = libraryStepsOf(slug);
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (1, ?, 'hq', ?, ?, 'Library skill.', ?, ?, 'brief', 'published', 1, ?)`).run(SKILL_UID[slug], slug, slug, JSON.stringify(steps), JSON.stringify(tools), ADMIN);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (1, 1, 'md', ?, 'Library skill.', ?, ?, 'brief', '[]', ?, ?)`).run(slug, JSON.stringify(steps), JSON.stringify(tools), JSON.stringify([role]), ADMIN);
  w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, 1, 1, ?)').run(AGENT, SPONSOR);

  // Approved MCP ledger servers, one per company, each owned by its own founder.
  w.env.CUSTOM_MCP_ENABLED = 'true';
  const server = (uid: string, owner: number, label: string) => {
    const cfg = { pattern: 'mcp', url: `https://${label}.example.test/mcp`, hosts: [`${label}.example.test`], accepted_scopes: [], approved: { 'grow.read': 'f'.repeat(64), 'mercury.read': 'f'.repeat(64) }, drift: [] };
    w.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, config_json, capabilities_json, scopes_json)
      VALUES (?, ?, ?, ?, 'active', 'mcp_oauth', ?, '[]', '[]')`).run(uid, owner, `custom:${uid}`, `${label} ledger`, JSON.stringify(cfg));
  };
  server(SRV_KESTREL, SPONSOR, 'kestrel');
  server(SRV_HARBOR, HARBOR_USER, 'harbor');
  const grants = (uid: string) => ['grow.read', 'mercury.read'].map((tool) => ({ integration_uid: uid, tool }));
  const granted = slug === 'budget-vs-actual' ? [...grants(SRV_KESTREL), ...(o.forgedHarborGrant ? grants(SRV_HARBOR) : [])] : [];
  w.db.prepare('UPDATE team_agents SET tool_grants_json = ? WHERE id = ?').run(JSON.stringify(granted), AGENT);

  // Native ledger: cash and three months of burn per company.
  const cash = w.db.prepare("INSERT INTO mercury_grow_facts(integration_id, project_id, module, kind, period, amount_cents, as_of) VALUES (1, ?, 'durable_company_building', 'cash', 'current', ?, ?)");
  cash.run(KESTREL, 7_654_321, day(1));
  cash.run(HARBOR, 424_242_00, day(1));
  const burn = w.db.prepare('INSERT INTO project_metrics(project_id, snapshot_date, net_burn, source) VALUES (?, ?, ?, ?)');
  if (o.burn !== false) for (const m of [0, 30, 60]) burn.run(KESTREL, day(2 + m), 41000 + m, 'typed');
  for (const m of [0, 30, 60]) burn.run(HARBOR, day(2 + m), 777701 + m, 'typed');

  // Cap tables: Kestrel's holder and Harbor's, each with one class and one founding issuance.
  w.db.exec(`
    INSERT INTO cap_table_share_classes(id, project_id, name, kind, authorized_shares) VALUES (1, ${KESTREL}, 'Common', 'common', 10000000), (2, ${HARBOR}, 'Common', 'common', 9000000);
    INSERT INTO cap_table_issuances(project_id, kind, holder_name, class_id, shares, issued_on, source, status, origin) VALUES
      (${KESTREL}, 'founding', 'Kestrel Holder', 1, 8000000, '2026-01-01', 'typed', 'recorded', 'owner'),
      (${HARBOR}, 'founding', 'Harbor Holder', 2, 6543210, '2026-01-01', 'typed', 'recorded', 'owner');
  `);

  // Contracts: two per company, each with indexed text.
  const file = (id: number, uid: string, project: number, name: string, passages: string[]) => {
    w.db.prepare('INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, 10, ?)')
      .run(id, uid, project, name, `data-room/p${project}/${id}`, 'application/pdf', '2026-11-01 09:00:00');
    w.db.prepare("INSERT INTO data_room_search_state (file_id, project_id, status, passages, indexed_at) VALUES (?, ?, 'indexed', ?, '2026-11-01 10:00:00')").run(id, project, passages.length);
    passages.forEach((text, seq) => w.db.prepare('INSERT INTO data_room_passages (project_id, file_id, seq, text, vector_id) VALUES (?, ?, ?, ?, ?)').run(project, id, seq, text, `drf:${id}:${seq}`));
  };
  file(70, FILES.kestrelMsa, KESTREL, 'Kestrel services agreement.pdf', ['Services agreement (invented).', `9.1 ${KESTREL_CLAUSE}`]);
  file(71, FILES.kestrelNda, KESTREL, 'Kestrel mutual nda.pdf', ['Mutual non-disclosure agreement (invented).', '2.1 Confidential information lasts three years.']);
  file(72, FILES.harborMsa, HARBOR, 'Harbor services agreement.pdf', ['Services agreement (invented).', `7.2 ${HARBOR_CLAUSE}`]);
  file(73, FILES.harborNda, HARBOR, 'Harbor mutual nda.pdf', ['Mutual non-disclosure agreement (invented).', '2.1 Harbor confidential information lasts seven years.']);

  // The stubbed model: records what it was sent, answers a fixed line. No wording is asserted on.
  const prompts: string[] = [];
  const modelCalls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string, input: any) => {
    if (model !== GUARD) { modelCalls.push(model); prompts.push(JSON.stringify(input.messages ?? input)); }
    return { response: 'stub answer', usage: { prompt_tokens: 40, completion_tokens: 10 } };
  } });

  // The MCP stub: answers from `LEDGERS` by the connection's own uid, and records every call.
  const toolCalls: Array<{ server: string; tool: string; arguments: unknown }> = [];
  const toolDeps = { call: (async (_env: unknown, row: { uid: string }, name: string, args: unknown) => {
    toolCalls.push({ server: row.uid, tool: name, arguments: args });
    const ledger = LEDGERS[row.uid];
    return { untrusted: true, data: name === 'grow.read' ? ledger?.grow : ledger?.mercury };
  }) as any };

  const agentRow = () => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
  const count = (sql: string) => (w.db.prepare(sql).get() as any).n as number;
  const STEPS = role === 'cfo'
    ? { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway' }
    : { module: 'fundraising-readiness', option: 'draft:raise/legal' };
  const run = (prompt: string, over: Partial<AgentRunInput> = {}) =>
    agentRun(w.env, { agent: agentRow(), ...STEPS, prompt, skill: SKILL_UID[slug], toolDeps, ...over });
  return { w, role, prompts, modelCalls, toolCalls, toolDeps, agentRow, count, run, ctxFor: (project: number) => ({
    scope: { kind: 'project', id: project, name: project === KESTREL ? 'Kestrel Example' : 'Harbor Example', founder_id: project === KESTREL ? 100 : 101, company_id: project === KESTREL ? COMPANY : 2 } as any,
    agent: agentRow(), projectId: project,
  }) };
}
export type { World };
