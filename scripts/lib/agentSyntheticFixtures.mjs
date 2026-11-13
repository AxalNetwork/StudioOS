/**
 * #4566 (Agent capacity A0) — synthetic-only fixtures for agent execution
 * validation: seed and clean up founders, users, companies, projects,
 * agents and tasks for ONE run id, with nothing of any real tenant in them.
 * Pure: it returns statements; the caller applies them (a test's D1 over
 * node:sqlite, or the owner's `wrangler d1 execute --file` against the
 * throwaway preview database, after the isolation preflight passes).
 *
 * WHAT MARKS A ROW SYNTHETIC. Every row carries the run id in its uid
 * (`syn-<run>-…`) and every person an address at `synthetic.invalid` (RFC 2606:
 * it can never be delivered). Cleanup selects by those marks only, so it can
 * never touch a row it did not make. A run id is 6–20 lowercase letters and
 * digits: no wildcard, quote or space can reach a LIKE pattern.
 *
 * CEILINGS (#4566 §4). At most 10 tenants, 3 agents a tenant, 5 tasks an
 * agent, and synthetic money in integer microusd: a $1.00 monthly cap per
 * agent and a $1.00 top-up per person. A request over a ceiling is refused,
 * not trimmed.
 *
 * CLEANUP is idempotent and safe after a partial seed or a failed run: it
 * deletes children before parents, each statement scoped by the marks, and a
 * second run deletes nothing. `ai_credit_ledger` is append-only (its triggers
 * refuse UPDATE and DELETE), so a synthetic person whose run wrote ledger rows
 * cannot be deleted: cleanup deactivates them instead and `residual` names
 * them. A hosted preview's real teardown is deleting its throwaway database
 * (the runbook, documentation/operations/AGENT_EXECUTION_VALIDATION.md).
 */

export const RUN_ID_RE = /^[a-z0-9]{6,20}$/;
export const SYNTHETIC_DOMAIN = 'synthetic.invalid';
export const CEILINGS = Object.freeze({ tenants: 10, agentsPerTenant: 3 /* SYNTHETIC_ROLES.length */, tasksPerAgent: 5, monthlyCapMicrousd: 1_000_000, topupMicrousd: 1_000_000 });
/** The model a synthetic agent names; inference is the stub in every mode, so it is never called. */
export const SYNTHETIC_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const SYNTHETIC_MODULE = 'product-roadmap';
export const SYNTHETIC_OPTION = 'draft:build/plan';
/** One live agent per role in a scope (`idx_team_agents_live_role`): a tenant's agents take these roles in turn, so the ceiling is their count. */
export const SYNTHETIC_ROLES = Object.freeze(['ceo', 'cto', 'cpo']);

/** A run id, or a thrown refusal. */
export function runId(raw) {
  const id = String(raw ?? '');
  if (!RUN_ID_RE.test(id)) throw new Error(`run id must match ${RUN_ID_RE}: 6–20 lowercase letters and digits`);
  return id;
}

const uid = (run, part) => `syn-${run}-${part}`;
const email = (run, part) => `${uid(run, part)}@${SYNTHETIC_DOMAIN}`;

/** The plan a seed makes, after its ceilings: `{ run, tenants: [{ t, agents: [{ a, tasks: [k...] }] }] }`. */
export function plan({ run, tenants = 1, agentsPerTenant = 1, tasksPerAgent = 1 } = {}) {
  const r = runId(run);
  for (const [k, v, max] of [['tenants', tenants, CEILINGS.tenants], ['agentsPerTenant', agentsPerTenant, CEILINGS.agentsPerTenant], ['tasksPerAgent', tasksPerAgent, CEILINGS.tasksPerAgent]]) {
    if (!Number.isSafeInteger(v) || v < 1 || v > max) throw new Error(`${k} must be 1 to ${max}; ${v} is over the synthetic ceiling`);
  }
  return {
    run: r,
    tenants: Array.from({ length: tenants }, (_, t) => ({
      t, agents: Array.from({ length: agentsPerTenant }, (_, a) => ({ a, tasks: Array.from({ length: tasksPerAgent }, (_, k) => k) })),
    })),
  };
}

/**
 * The seed, as bound statements `{ sql, args }`. Ids are never written: each
 * row finds its parent by the parent's synthetic uid or address, so a seed
 * lands beside whatever the database already holds.
 */
export function seedStatements(opts) {
  const p = plan(opts);
  const run = p.run;
  const out = [];
  const s = (sql, ...args) => out.push({ sql, args });
  for (const { t, agents } of p.tenants) {
    const person = `t${t}`;
    s('INSERT INTO founders (name, email) VALUES (?, ?)', `Synthetic founder ${t}`, email(run, person));
    s(`INSERT INTO users (uid, email, name, role, founder_id, is_active)
       VALUES (?, ?, ?, 'founder', (SELECT id FROM founders WHERE email = ?), 1)`, uid(run, `${person}-user`), email(run, person), `Synthetic sponsor ${t}`, email(run, person));
    s(`INSERT INTO ai_topup_accounts (user_id, balance_microusd)
       VALUES ((SELECT id FROM users WHERE email = ?), ?)`, email(run, person), CEILINGS.topupMicrousd);
    s('INSERT INTO company_profiles (uid, company_name) VALUES (?, ?)', uid(run, `${person}-co`), `Synthetic company ${t}`);
    s(`INSERT INTO projects (uid, name, founder_id, company_id, description)
       VALUES (?, ?, (SELECT id FROM founders WHERE email = ?), (SELECT id FROM company_profiles WHERE uid = ?), 'Synthetic venture for agent validation.')`,
      uid(run, `${person}-p`), `Synthetic venture ${t}`, email(run, person), uid(run, `${person}-co`));
    for (const { a, tasks } of agents) {
      const agentUid = uid(run, `${person}-a${a}`);
      s(`INSERT INTO team_agents (uid, scope_kind, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, created_by, status)
         VALUES (?, 'project', (SELECT id FROM projects WHERE uid = ?), ?, ?, ?, (SELECT id FROM users WHERE email = ?), ?, (SELECT id FROM users WHERE email = ?), 'active')`,
        agentUid, uid(run, `${person}-p`), SYNTHETIC_ROLES[a], `Synthetic${a}`, SYNTHETIC_MODEL, email(run, person), CEILINGS.monthlyCapMicrousd, email(run, person));
      for (const k of tasks) {
        s(`INSERT INTO scope_tasks (uid, scope_kind, project_id, title, module, option, assignee_kind, assignee_agent_id, status, board_column, created_by_user_id)
           VALUES (?, 'project', (SELECT id FROM projects WHERE uid = ?), ?, ?, ?, 'agent', (SELECT id FROM team_agents WHERE uid = ?), 'open', 'ready', (SELECT id FROM users WHERE email = ?))`,
          uid(run, `${person}-a${a}-k${k}`), uid(run, `${person}-p`), `Synthetic task ${t}.${a}.${k}`, SYNTHETIC_MODULE, SYNTHETIC_OPTION, agentUid, email(run, person));
      }
    }
  }
  return out;
}

/** The run's marks as SQL fragments; `run` has passed `RUN_ID_RE`, so it carries no wildcard. */
const marks = (run) => ({ uidLike: `syn-${runId(run)}-%`, emailLike: `syn-${runId(run)}-%@${SYNTHETIC_DOMAIN}` });
const USERS = '(SELECT id FROM users WHERE email LIKE ?)';
const PROJECTS = '(SELECT id FROM projects WHERE uid LIKE ?)';
const AGENTS = '(SELECT id FROM team_agents WHERE uid LIKE ?)';
const TASKS = '(SELECT id FROM scope_tasks WHERE uid LIKE ?)';

/**
 * Cleanup, children first. Each statement removes only rows that belong to a
 * synthetic task, agent, project or person of this run, so on a database with
 * no such rows every statement deletes nothing.
 */
export function cleanupStatements(run) {
  const { uidLike, emailLike } = marks(run);
  const out = [];
  const s = (sql, ...args) => out.push({ sql, args });
  s(`DELETE FROM scope_task_events WHERE task_id IN ${TASKS}`, uidLike);
  s(`DELETE FROM task_comments WHERE task_id IN ${TASKS}`, uidLike);
  s(`DELETE FROM ai_rail_proposals WHERE agent_id IN ${AGENTS} OR task_id IN ${TASKS} OR user_id IN ${USERS}`, uidLike, uidLike, emailLike);
  s(`DELETE FROM agent_task_runs WHERE agent_id IN ${AGENTS}`, uidLike);
  s(`DELETE FROM scope_tasks WHERE uid LIKE ?`, uidLike);
  s(`DELETE FROM team_agent_events WHERE agent_id IN ${AGENTS}`, uidLike);
  s(`DELETE FROM agent_skill_links WHERE agent_id IN ${AGENTS}`, uidLike);
  s(`DELETE FROM team_agents WHERE uid LIKE ?`, uidLike);
  s(`DELETE FROM project_members WHERE project_id IN ${PROJECTS} OR user_id IN ${USERS}`, uidLike, emailLike);
  s(`DELETE FROM activity_logs WHERE user_id IN ${USERS} OR project_id IN ${PROJECTS}`, emailLike, uidLike);
  s(`DELETE FROM ai_usage_logs WHERE user_id IN ${USERS}`, emailLike);
  s(`DELETE FROM ai_budget_reservations WHERE user_id IN ${USERS}`, emailLike);
  s(`DELETE FROM projects WHERE uid LIKE ?`, uidLike);
  s(`DELETE FROM company_profiles WHERE uid LIKE ?`, uidLike);
  // The ledger is append-only: a person with ledger rows stays, switched off.
  s(`UPDATE users SET is_active = 0 WHERE email LIKE ? AND id IN (SELECT user_id FROM ai_credit_ledger)`, emailLike);
  s(`DELETE FROM ai_topup_accounts WHERE user_id IN ${USERS} AND user_id NOT IN (SELECT user_id FROM ai_credit_ledger)`, emailLike);
  s(`DELETE FROM users WHERE email LIKE ? AND id NOT IN (SELECT user_id FROM ai_credit_ledger)`, emailLike);
  s(`DELETE FROM founders WHERE email LIKE ? AND id NOT IN (SELECT founder_id FROM users WHERE founder_id IS NOT NULL)`, emailLike);
  return out;
}

/** What a cleanup left, by table: zero everywhere except people kept for their ledger rows. */
export function residualStatements(run) {
  const { uidLike, emailLike } = marks(run);
  return [
    ['scope_tasks', 'SELECT COUNT(*) AS n FROM scope_tasks WHERE uid LIKE ?', uidLike],
    ['team_agents', 'SELECT COUNT(*) AS n FROM team_agents WHERE uid LIKE ?', uidLike],
    ['projects', 'SELECT COUNT(*) AS n FROM projects WHERE uid LIKE ?', uidLike],
    ['company_profiles', 'SELECT COUNT(*) AS n FROM company_profiles WHERE uid LIKE ?', uidLike],
    ['users_active', 'SELECT COUNT(*) AS n FROM users WHERE email LIKE ? AND is_active = 1', emailLike],
    ['users_kept_for_ledger', 'SELECT COUNT(*) AS n FROM users WHERE email LIKE ? AND is_active = 0', emailLike],
  ].map(([table, sql, arg]) => ({ table, sql, args: [arg] }));
}

/**
 * The statements as one SQL file for `wrangler d1 execute --file`, each bound
 * value written as a quoted literal. Every value is synthetic and built here
 * from a validated run id and fixed words, so no outside text reaches it.
 */
export function toSqlFile(statements) {
  const lit = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return `${statements.map(({ sql, args }) => {
    let i = 0;
    const text = sql.replace(/\?/g, () => lit(args[i++]));
    if (i !== args.length) throw new Error('statement and arguments disagree');
    return `${text.replace(/\s+/g, ' ').trim()};`;
  }).join('\n')}\n`;
}
