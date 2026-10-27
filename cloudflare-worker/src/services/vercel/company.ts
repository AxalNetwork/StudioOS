/**
 * D1099 (#2964, Vercel part 4) — Vercel feeds Build › Company creation: where
 * production runs.
 *
 * Per chosen Vercel project, `GET /v9/projects/{id}` and the installation's
 * `teamId` give the account production runs on (a personal account or a team)
 * and its plan. Those are facts, written to `vercel_company_facts`:
 *   - **the Hobby plan:** Vercel's facts propose one formation step, "Move the
 *     production project to the company's Vercel team on a paid plan", with
 *     Vercel's reason (Hobby is for personal, non-commercial use). The founder
 *     accepts it (it becomes a formation step, with its ledger row,
 *     `'company_creation', 'hosting_step'`) or dismisses it. It is proposed once
 *     per project: a re-sync never brings a decided one back, and a pending one
 *     is withdrawn when the project leaves the Hobby plan;
 *   - **a Pro or Enterprise team:** recorded as a fact, and nothing proposed;
 *   - **a plan Vercel did not give:** "Not recorded", and nothing proposed.
 *
 * Accept changes nothing on Vercel: no request but the read above is made.
 *
 * WHO CALLS THE SYNC. `syncVercelCompany` is the hook Vercel part 1's sync
 * (D1096, #2961: the stored connection and the chosen projects) calls once per
 * chosen project, and `deleteVercelCompanyOf` belongs in its disconnect. Until
 * that sync lands, nothing writes these rows, and Company creation's Vercel
 * part reads as not connected.
 */
import type { Env } from '../../types';
import type { DecideOutcome } from '../../integrations/providers/github/solutionDesign';
import type { Installation, VercelProject } from './api';

export const MOVE_STEP_TITLE = 'Move the production project to the company’s Vercel team on a paid plan';
export const MOVE_STEP_REASON = 'Vercel’s Hobby plan is for personal, non-commercial use.';
export const PLANS = ['hobby', 'pro', 'enterprise'] as const;
export type Plan = typeof PLANS[number];
export type AccountKind = 'personal' | 'team';
export type CompanyFacts = { account_kind: AccountKind; plan: Plan | null; plan_source: 'project' | 'personal_account' | 'none' };

/**
 * A project's facts: the account from the installation's `teamId` (none is a
 * personal account), the plan from the project when Vercel gives one, else
 * Hobby for a personal account (Vercel's rule: a personal account is on Hobby;
 * UNVERIFIED until the owner's first live connection), else not recorded.
 */
export function projectFacts(project: Pick<VercelProject, 'plan'> | null | undefined, installation: Pick<Installation, 'teamId'> | null | undefined): CompanyFacts {
  const account_kind: AccountKind = installation?.teamId ? 'team' : 'personal';
  const said = String(project?.plan ?? '').toLowerCase();
  if ((PLANS as readonly string[]).includes(said)) return { account_kind, plan: said as Plan, plan_source: 'project' };
  if (account_kind === 'personal') return { account_kind, plan: 'hobby', plan_source: 'personal_account' };
  return { account_kind, plan: null, plan_source: 'none' };
}

/** What the sync needs from the Vercel client: one project read. */
export type ProjectReader = { project: (id: string) => Promise<VercelProject> };

const UPSERT_FACTS = `INSERT INTO vercel_company_facts (integration_id, project_id, vercel_project_id, project_name, account_kind, plan, plan_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, vercel_project_id) DO UPDATE SET
       project_name = excluded.project_name, account_kind = excluded.account_kind, plan = excluded.plan,
       plan_source = excluded.plan_source, updated_at = CURRENT_TIMESTAMP`;
// Once per project: a decided proposal is never proposed again.
const PROPOSE_MOVE = `INSERT INTO vercel_company_proposals (integration_id, project_id, vercel_project_id, kind)
     VALUES (?, ?, ?, 'move_to_team') ON CONFLICT(integration_id, project_id, vercel_project_id, kind) DO NOTHING`;
const WITHDRAW_MOVE = `DELETE FROM vercel_company_proposals
     WHERE integration_id = ? AND project_id = ? AND vercel_project_id = ? AND kind = 'move_to_team' AND status = 'pending'`;

/**
 * Reads one chosen project and writes its facts, proposing the move when it is
 * on Hobby and withdrawing a pending one when it is not. Returns whether a
 * proposal was newly made. A failed read throws the client's static code.
 */
export async function syncVercelCompany(
  env: Env, integrationId: number, projectId: number, client: ProjectReader, vercelProjectId: string, installation: Pick<Installation, 'teamId'> | null,
): Promise<{ proposed: boolean; facts: CompanyFacts }> {
  const project = await client.project(vercelProjectId);
  const facts = projectFacts(project, installation);
  const name = typeof project?.name === 'string' && project.name ? project.name.slice(0, 200) : null;
  const stmts = [
    env.DB.prepare(UPSERT_FACTS).bind(integrationId, projectId, vercelProjectId, name, facts.account_kind, facts.plan, facts.plan_source),
    facts.plan === 'hobby'
      ? env.DB.prepare(PROPOSE_MOVE).bind(integrationId, projectId, vercelProjectId)
      : env.DB.prepare(WITHDRAW_MOVE).bind(integrationId, projectId, vercelProjectId),
  ];
  const out = await env.DB.batch(stmts);
  return { proposed: facts.plan === 'hobby' && Boolean(out[1]?.meta?.changes), facts };
}

/** The disconnect: a connection's facts and its pending proposals go with it; decided ones stay as history. */
export async function deleteVercelCompanyOf(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vercel_company_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare(`DELETE FROM vercel_company_proposals WHERE integration_id = ? AND status = 'pending'`).bind(integrationId),
  ]);
}

const ACCOUNT_WORD: Record<AccountKind, string> = { personal: 'Personal Vercel account', team: 'Vercel team' };
const PLAN_WORD: Record<Plan, string> = { hobby: 'Hobby', pro: 'Pro', enterprise: 'Enterprise' };

/**
 * What Company creation shows from Vercel (VC4b): each project's account and
 * plan, and the proposals waiting for Accept or Dismiss. A member reads the
 * projects; anyone else reads how many, never one.
 */
export async function companyFromVercel(env: Env, projectId: number, member: boolean) {
  const facts = (await env.DB.prepare(
    `SELECT f.vercel_project_id, f.project_name, f.account_kind, f.plan, f.updated_at
       FROM vercel_company_facts f JOIN integrations i ON i.id = f.integration_id
      WHERE f.project_id = ? ORDER BY f.project_name, f.vercel_project_id`,
  ).bind(projectId).all<any>()).results || [];
  if (!member) return { members_only: true, projects_total: facts.length, projects: [], proposals: [] };
  const proposals = (await env.DB.prepare(
    `SELECT p.id, p.vercel_project_id, f.project_name
       FROM vercel_company_proposals p
       LEFT JOIN vercel_company_facts f ON f.integration_id = p.integration_id AND f.project_id = p.project_id AND f.vercel_project_id = p.vercel_project_id
      WHERE p.project_id = ? AND p.status = 'pending' ORDER BY p.id`,
  ).bind(projectId).all<{ id: number; vercel_project_id: string; project_name: string | null }>()).results || [];
  return {
    members_only: false,
    projects_total: facts.length,
    projects: facts.map((f) => ({
      vercel_project_id: f.vercel_project_id,
      project: f.project_name ?? null,
      account_kind: f.account_kind,
      account: ACCOUNT_WORD[f.account_kind as AccountKind] ?? 'Not recorded',
      plan: f.plan ?? null,
      plan_word: f.plan ? PLAN_WORD[f.plan as Plan] : null,
      plan_note: f.plan ? null : 'Not recorded: Vercel did not give this team’s plan.',
      updated_at: f.updated_at,
    })),
    proposals: proposals.map((p) => ({ id: p.id, project: p.project_name ?? null, title: MOVE_STEP_TITLE, reason: MOVE_STEP_REASON })),
  };
}

async function outcomeOf(env: Env, projectId: number, id: number): Promise<DecideOutcome> {
  const row = await env.DB.prepare('SELECT status FROM vercel_company_proposals WHERE id = ? AND project_id = ?').bind(id, projectId).first();
  return row ? 'decided' : 'not_found';
}

/**
 * Accept: the proposal is claimed (pending → accepted, once), then its
 * formation step (`todo`, kind `other`), the step's id on the proposal, the
 * step's ledger row and `extra` (the activity line) are written in one batch.
 * A failed batch hands the claim back. Nothing is sent to Vercel.
 */
export async function acceptVercelProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const claim = await env.DB.prepare(
    `UPDATE vercel_company_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!claim.meta?.changes) return outcomeOf(env, projectId, id);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO formation_steps (project_id, title, state, kind, sort_order, created_by)
          VALUES (?, ?, 'todo', 'other', (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM formation_steps WHERE project_id = ?), ?)`)
        .bind(projectId, MOVE_STEP_TITLE, projectId, userId),
      env.DB.prepare('UPDATE vercel_company_proposals SET step_id = last_insert_rowid() WHERE id = ?').bind(id),
      env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
          SELECT integration_id, project_id, 'company_creation', 'hosting_step', 'hosting_step:' || project_id || ':' || vercel_project_id, 'formation_steps', step_id
            FROM (SELECT integration_id, project_id, vercel_project_id, step_id FROM vercel_company_proposals WHERE id = ?) p WHERE 1
          ON CONFLICT(integration_id, external_id) DO UPDATE SET
            last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`).bind(id),
      ...extra,
    ]);
  } catch (e) {
    await env.DB.prepare(`UPDATE vercel_company_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ? AND status = 'accepted' AND step_id IS NULL`).bind(id).run();
    throw e;
  }
  return 'ok';
}

/** Dismiss: pending → dismissed, once. A re-sync never proposes it again. */
export async function dismissVercelProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const r = await env.DB.prepare(
    `UPDATE vercel_company_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!r.meta?.changes) return outcomeOf(env, projectId, id);
  if (extra.length) await env.DB.batch(extra);
  return 'ok';
}
