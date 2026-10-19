/**
 * D782 (#2115) — GitHub feeds Build › Company creation: where the code sits.
 *
 * Per chosen repository, `GET /repos/{o}/{r}` (Metadata read, no new
 * permission) gives its owner's kind and its licence. Those are facts, written
 * to `github_repo_facts`:
 *   - **a personal account owns it:** GitHub proposes one formation step, "Move
 *     the code into the company's GitHub organisation", with its reason (the
 *     IP belongs to the company). The founder accepts it (it becomes a
 *     formation step, with its ledger row, `'company_creation', 'ip_step'`) or
 *     dismisses it. It is proposed once per repository: a re-sync never brings
 *     a decided one back, and a pending one is withdrawn when the repository
 *     moves to an organisation;
 *   - **an organisation owns it:** that is recorded as evidence on the IP
 *     assignment step, if the venture has one: a `formation_step_checks` row,
 *     `github_org:<owner>/<repo>`. The IP assignment step is a formation step
 *     whose title names IP (or intellectual property) assignment; no step is
 *     made for it;
 *   - **no licence file:** said as a fact ("No licence file"), never advice.
 *
 * Nothing but facts and the proposal is written without the founder's Accept.
 *
 * A personal account's login is personal data: only the project's members
 * read it, and it goes with the connection (`deleteFactsOf`).
 *
 * NO SIDE EFFECTS, AND NO IMPORT OF `../github`, as `solutionDesign.ts`.
 */
import type { Env } from '../../../types';
import type { GithubGet } from './solutionDesign';
import type { DecideOutcome } from './solutionDesign';

export const MOVE_STEP_TITLE = 'Move the code into the company’s GitHub organisation';
export const MOVE_STEP_REASON = 'The code is the company’s IP, so it belongs in an organisation the company owns, not in a personal account.';
// A repository's cost: its read and its batch.
const REPO_COST = 2;

/** Whether a formation step is the IP assignment step: its title names IP (or intellectual property) assignment. */
export function isIpAssignmentStep(title: unknown): boolean {
  const t = String(title ?? '');
  return /\b(ip|intellectual property)\b[^.]*\bassign/i.test(t) || /\bassign\w*\b[^.]*\b(ip|intellectual property)\b/i.test(t);
}

/** A repository's facts from its `GET /repos/{o}/{r}`, or null when GitHub did not say who owns it. */
export function repoFacts(meta: any): { owner_kind: 'personal' | 'organisation'; owner_login: string; licence: string | null } | null {
  const login = typeof meta?.owner?.login === 'string' ? meta.owner.login : null;
  if (!login) return null;
  const spdx = typeof meta?.license?.spdx_id === 'string' && meta.license.spdx_id ? meta.license.spdx_id : null;
  return { owner_kind: meta.owner.type === 'Organization' ? 'organisation' : 'personal', owner_login: login, licence: spdx };
}

// ───────────────────────────────────────────────────────────── the sync

const UPSERT_FACTS = `INSERT INTO github_repo_facts (integration_id, project_id, repository, owner_kind, owner_login, licence)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, repository) DO UPDATE SET
       owner_kind = excluded.owner_kind, owner_login = excluded.owner_login, licence = excluded.licence, updated_at = CURRENT_TIMESTAMP`;
// Once per repository: a decided proposal is never proposed again.
const PROPOSE_MOVE = `INSERT INTO company_creation_proposals (integration_id, project_id, repository, kind)
     VALUES (?, ?, ?, 'move_to_org') ON CONFLICT(integration_id, project_id, repository, kind) DO NOTHING`;
const WITHDRAW_MOVE = `DELETE FROM company_creation_proposals
     WHERE integration_id = ? AND project_id = ? AND repository = ? AND kind = 'move_to_org' AND status = 'pending'`;
const EVIDENCE = `INSERT INTO formation_step_checks (step_id, key, done_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(step_id, key) DO NOTHING`;

/**
 * Reads each chosen repository's owner and licence within `budget`
 * subrequests. Returns `ip_proposals` (steps newly proposed) and `partial`
 * when the budget stopped it.
 */
export async function syncCompany(
  env: Env, integrationId: number, projectId: number, get: GithubGet, repos: string[], budget: number,
): Promise<Record<string, number | boolean>> {
  const counts: Record<string, number | boolean> = { ip_proposals: 0 };
  let left = budget - 1;
  // The IP assignment steps, read once, when the first organisation's repository needs them.
  let ipSteps: { id: number; title: string }[] | null = null;
  const stepsOfIp = async () => ipSteps ??= ((await env.DB.prepare('SELECT id, title FROM formation_steps WHERE project_id = ?').bind(projectId)
    .all<{ id: number; title: string }>()).results || []).filter((s) => isIpAssignmentStep(s.title));
  for (const repo of repos) {
    if (left < REPO_COST) { counts.partial = true; break; }
    left -= REPO_COST;
    const res = await get(`/repos/${repo.split('/').map(encodeURIComponent).join('/')}`);
    // A repository GitHub no longer serves says nothing about where the code sits.
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`github_api_failed: ${res.status} /repos`);
    const facts = repoFacts(await res.json());
    if (!facts) continue;
    const stmts = [env.DB.prepare(UPSERT_FACTS).bind(integrationId, projectId, repo, facts.owner_kind, facts.owner_login, facts.licence)];
    if (facts.owner_kind === 'personal') stmts.push(env.DB.prepare(PROPOSE_MOVE).bind(integrationId, projectId, repo));
    else {
      stmts.push(env.DB.prepare(WITHDRAW_MOVE).bind(integrationId, projectId, repo));
      for (const s of await stepsOfIp()) stmts.push(env.DB.prepare(EVIDENCE).bind(s.id, `github_org:${repo}`));
    }
    const out = await env.DB.batch(stmts);
    if (facts.owner_kind === 'personal' && out[1]?.meta?.changes) counts.ip_proposals = Number(counts.ip_proposals) + 1;
  }
  return counts;
}

/** The disconnect: a connection's facts (an owner's login among them) and its pending proposals go with it. */
export async function deleteFactsOf(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM github_repo_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare(`DELETE FROM company_creation_proposals WHERE integration_id = ? AND status = 'pending'`).bind(integrationId),
  ]);
}

// ───────────────────────────────────────────────────────────── the module

/**
 * What Company creation shows from code: each repository's owner kind and
 * licence, the proposals waiting for Accept or Dismiss, and the evidence on
 * the IP assignment step. A member reads the repositories and an owner's
 * login; anyone else reads how many repositories, never one.
 */
export async function companyFromCode(env: Env, projectId: number, member: boolean) {
  const facts = (await env.DB.prepare(
    `SELECT f.repository, f.owner_kind, f.owner_login, f.licence, f.updated_at
       FROM github_repo_facts f JOIN integrations i ON i.id = f.integration_id
      WHERE f.project_id = ? ORDER BY f.repository`,
  ).bind(projectId).all<any>()).results || [];
  if (!member) return { members_only: true, repositories_total: facts.length, repositories: [], proposals: [], evidence: [] };
  const proposals = (await env.DB.prepare(
    `SELECT id, repository FROM company_creation_proposals WHERE project_id = ? AND status = 'pending' ORDER BY id`,
  ).bind(projectId).all<{ id: number; repository: string }>()).results || [];
  const evidence = (await env.DB.prepare(
    `SELECT s.id AS step_id, s.title, substr(k.key, 12) AS repository
       FROM formation_step_checks k JOIN formation_steps s ON s.id = k.step_id
      WHERE s.project_id = ? AND k.key LIKE 'github_org:%' ORDER BY s.id, k.key`,
  ).bind(projectId).all<{ step_id: number; title: string; repository: string }>()).results || [];
  return {
    members_only: false,
    repositories_total: facts.length,
    repositories: facts.map((f) => ({
      repository: f.repository,
      owner_kind: f.owner_kind,
      owner: f.owner_login,
      licence: f.licence ?? null,
      licence_note: f.licence ? null : 'No licence file',
      updated_at: f.updated_at,
    })),
    proposals: proposals.map((p) => ({ id: p.id, repository: p.repository, title: MOVE_STEP_TITLE, reason: MOVE_STEP_REASON })),
    evidence: evidence.map((e) => ({ record_id: `step-${e.step_id}`, step: e.title, repository: e.repository })),
  };
}

async function outcomeOf(env: Env, projectId: number, id: number): Promise<DecideOutcome> {
  const row = await env.DB.prepare('SELECT status FROM company_creation_proposals WHERE id = ? AND project_id = ?').bind(id, projectId).first();
  return row ? 'decided' : 'not_found';
}

/**
 * Accept: the proposal is claimed (pending → accepted, once), then its
 * formation step, the step's id on the proposal and the step's ledger row are
 * written in one batch with `extra` (the activity line). A failed batch hands
 * the claim back.
 */
export async function acceptCompanyProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const claim = await env.DB.prepare(
    `UPDATE company_creation_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!claim.meta?.changes) return outcomeOf(env, projectId, id);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO formation_steps (project_id, title, state, kind, sort_order, created_by)
          VALUES (?, ?, 'todo', 'other', (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM formation_steps WHERE project_id = ?), ?)`)
        .bind(projectId, MOVE_STEP_TITLE, projectId, userId),
      env.DB.prepare('UPDATE company_creation_proposals SET step_id = last_insert_rowid() WHERE id = ?').bind(id),
      env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
          SELECT integration_id, project_id, 'company_creation', 'ip_step', 'ip_step:' || project_id || ':' || repository, 'formation_steps', step_id
            FROM (SELECT integration_id, project_id, repository, step_id FROM company_creation_proposals WHERE id = ?) p WHERE 1
          ON CONFLICT(integration_id, external_id) DO UPDATE SET
            last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`).bind(id),
      ...extra,
    ]);
  } catch (e) {
    await env.DB.prepare(`UPDATE company_creation_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ? AND status = 'accepted' AND step_id IS NULL`).bind(id).run();
    throw e;
  }
  return 'ok';
}

/** Dismiss: pending → dismissed, once. A re-sync never proposes it again. */
export async function dismissCompanyProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const r = await env.DB.prepare(
    `UPDATE company_creation_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (!r.meta?.changes) return outcomeOf(env, projectId, id);
  if (extra.length) await env.DB.batch(extra);
  return 'ok';
}
