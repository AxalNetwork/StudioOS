/**
 * D1097 (#2962) — Operating systems › Tools' Hosting block (VC1): Vercel as
 * the Hosting system, read from each Vercel connection enabled for the
 * venture's company, beside GitHub's Code system (D782). It is never written
 * into `project_core_systems`.
 *
 * What it reads, each connection on its own:
 *   - its state, last sync and owner, and Sync again for the owner alone (the
 *     connector sync route takes only the owner's connection);
 *   - the venture's projects from part 1's `vercel_projects` (D1096): name,
 *     domain, framework, runtime, branch, repository, plan and live state;
 *   - the venture's health events (migration 590), open ones and those closed
 *     in the last 30 days, never a dismissed one;
 *   - "Production runs on a personal Vercel account, Hobby plan." when a
 *     project is on Hobby, linking to Company creation's proposal (D1099);
 *   - when the sign-in expired, which project's figures are as of when.
 *
 * Vercel's sync lines are the connections' sync and webhook log rows, newest
 * first: "Synced: 1 project, 14 deployments, 2 health events".
 *
 * `vercelRuntime` is Solution design's "Runs on" (VC4a): framework, runtime,
 * hosting, domain, branch and repository per project, beside GitHub's "Built
 * with", never merged into `solution_design_stack`.
 *
 * THE TOOLS RULE: the owner and the company's members read the projects'
 * names, domains, plan and each event's subject; anyone else reads counts.
 */
import type { Env } from '../../types';
import type { HealthKind } from './health';

export const CLOSED_SHOWN_DAYS = 30;
/** How many sync lines the Hosting block shows, newest first. */
export const VERCEL_SYNC_LINES = 10;
export const EMPTY = 'Vercel has not brought anything to this venture yet.';
export const NO_PROJECTS = 'No Vercel project is chosen for this venture yet.';
export const NO_SYNC = 'No Vercel sync yet.';
export const UNREADABLE = 'Unreadable: Vercel could not be read. The rest of this page is current.';

/** An event in words. The subject is drawn beside it, for those who may read it. */
export const HEALTH_WORDS: Record<HealthKind, string> = Object.freeze({
  production_failed: 'Production deploy failed',
  rollback: 'Production was rolled back',
  domain_misconfigured: 'Domain is misconfigured',
  domain_unverified: 'Domain is unverified',
  certificate_failed: 'Certificate renewal failed',
  domain_expiring: 'Domain registration expires soon',
});

const LIVE_WORDS: Record<string, string> = Object.freeze({ live: 'Live', failing: 'Failing', building: 'Building', not_deployed: 'Not deployed' });
const PLAN_WORDS: Record<string, string> = Object.freeze({ hobby: 'Hobby', pro: 'Pro', enterprise: 'Enterprise' });

type Viewer = { id: number };
type Connection = { id: number; uid: string; user_id: number; status: string; last_synced_at: string | null; last_error: string | null; last_error_at: string | null; owner_name: string | null };

async function connections(env: Env, companyId: number): Promise<Connection[]> {
  return (await env.DB.prepare(
    `SELECT i.id, i.uid, i.user_id, i.status, i.last_synced_at, i.last_error, i.last_error_at, u.name AS owner_name
       FROM integrations i
       JOIN integration_companies ic ON ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1
       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
       LEFT JOIN users u ON u.id = i.user_id
      WHERE i.provider_key = 'vercel' ORDER BY i.id`,
  ).bind(companyId).all<Connection>()).results || [];
}

type ProjectRow = { integration_id: number; name: string; framework: string | null; node_version: string | null; production_branch: string | null;
  git_repository: string | null; production_domain: string | null; plan: string | null; live_state: string; live_since: string | null; synced_at: string | null };

async function projectsOf(env: Env, projectId: number, ids: number[]): Promise<ProjectRow[]> {
  return (await env.DB.prepare(
    `SELECT integration_id, name, framework, node_version, production_branch, git_repository, production_domain, plan, live_state, live_since, synced_at
       FROM vercel_projects WHERE project_id = ? AND integration_id IN (SELECT value FROM json_each(?)) ORDER BY name, id`,
  ).bind(projectId, JSON.stringify(ids)).all<ProjectRow>()).results || [];
}

/** "Node 20.x" from Vercel's `20.x`; a value it did not give stays null. */
export const runtimeOf = (v: string | null) => (v ? (/^\d/.test(v) ? `Node ${v}` : v) : null);

/** One project's facts, in VC1's order. A missing one is null: the page says Not recorded, never empty. */
export function factsOf(r: ProjectRow) {
  return {
    project: r.name, domain: r.production_domain, framework: r.framework, runtime: runtimeOf(r.node_version),
    branch: r.production_branch, repository: r.git_repository,
    plan: r.plan ? PLAN_WORDS[String(r.plan).toLowerCase()] ?? r.plan : null,
    live: { state: r.live_state, words: LIVE_WORDS[r.live_state] ?? 'Not recorded', since: r.live_since },
  };
}

const REAUTH = /^(vercel_reconnect_required|vercel_removed)\b/;

/** What a sync line says, from its own log row's counts; a failure in our words, never the stored message. */
export function vercelSyncText(status: string, summary: string | null, payload: Record<string, unknown> | null): { state: 'done' | 'partial' | 'failed'; text: string } {
  if (status !== 'ok') {
    const code = String(summary || '').split(/[:\s]/).find((w) => w.startsWith('vercel_')) ?? '';
    return { state: 'failed', text: REAUTH.test(code) ? 'Vercel’s sign-in expired. Reconnect Vercel.' : code === 'vercel_rate_limited' ? 'Vercel asked Axal VC to slow down.' : 'The sync did not complete.' };
  }
  const n = (k: string) => (Number.isSafeInteger(payload?.[k]) ? Number(payload![k]) : null);
  const parts = [[n('projects'), 'project', 'projects'], [n('deployments'), 'deployment', 'deployments'], [n('health_events'), 'health event', 'health events']]
    .filter(([v]) => v !== null).map(([v, one, many]) => `${v} ${v === 1 ? one : many}`);
  return { state: payload?.partial === true ? 'partial' : 'done', text: parts.length ? `${payload?.partial === true ? 'Partly synced' : 'Synced'}: ${parts.join(', ')}` : 'Synced' };
}

const parsed = (raw: string | null): Record<string, unknown> | null => {
  try { const v = JSON.parse(raw || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

async function syncLines(env: Env, ids: number[]) {
  try {
    const logs = (await env.DB.prepare(
      `SELECT id, integration_id, event_type, status, response_summary, payload_json, created_at FROM integration_logs
        WHERE event_type IN ('sync', 'webhook') AND integration_id IN (SELECT value FROM json_each(?))
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(JSON.stringify(ids), VERCEL_SYNC_LINES).all<any>()).results || [];
    const rows = logs.map((l) => {
      const t = vercelSyncText(l.status, l.response_summary, parsed(l.payload_json));
      return { id: `vercel-sync-${l.id}`, at: l.created_at ?? null, provider: 'Vercel', by: l.event_type === 'webhook' ? 'webhook' : 'sync', state: t.state, text: t.state === 'failed' ? null : t.text, error: t.state === 'failed' ? t.text : null };
    });
    return { state: rows.length ? 'ok' : 'empty', rows, reason: rows.length ? null : NO_SYNC };
  } catch {
    return { state: 'unreadable', rows: [], reason: 'The sync history could not be read.' };
  }
}

export async function hostingSystems(env: Env, p: { id: number; company_id: number | null }, viewer: Viewer, viewerMember: boolean, href: string) {
  if (p.company_id == null) return { state: 'not_recorded', systems: [], reason: 'This project has no company scope for connectors.', syncs: { state: 'not_recorded', rows: [], reason: null } };
  const vercel = await connections(env, p.company_id);
  if (!vercel.length) return { state: 'empty', systems: [], reason: EMPTY, syncs: { state: 'empty', rows: [], reason: NO_SYNC } };
  const ids = vercel.map((v) => Number(v.id));
  const [events, projects, kinds] = await Promise.all([
    env.DB.prepare(
      `SELECT id, integration_id, kind, subject, opened_at, closed_at, source FROM vercel_health_events
        WHERE project_id = ? AND integration_id IN (SELECT value FROM json_each(?)) AND dismissed_at IS NULL
          AND (closed_at IS NULL OR closed_at >= ?)
        ORDER BY (closed_at IS NULL) DESC, opened_at DESC, id DESC`,
    ).bind(p.id, JSON.stringify(ids), new Date(Date.now() - CLOSED_SHOWN_DAYS * 86_400_000).toISOString())
      .all<{ id: number; integration_id: number; kind: HealthKind; subject: string; opened_at: string; closed_at: string | null; source: string }>()
      .then((r) => r.results || []),
    projectsOf(env, p.id, ids),
    env.DB.prepare('SELECT integration_id, account_kind FROM vercel_installations WHERE integration_id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(ids)).all<{ integration_id: number; account_kind: string }>().then((r) => r.results || []),
  ]);
  const sees = (userId: number) => userId === viewer.id || viewerMember;
  const systems = vercel.map((v) => {
    const mine = events.filter((e) => Number(e.integration_id) === Number(v.id));
    const theirs = projects.filter((r) => Number(r.integration_id) === Number(v.id));
    const visible = sees(Number(v.user_id));
    const account = kinds.find((k) => Number(k.integration_id) === Number(v.id))?.account_kind ?? null;
    const reauth = v.status === 'error' && REAUTH.test(String(v.last_error || ''));
    const hobby = theirs.some((r) => String(r.plan || '').toLowerCase() === 'hobby');
    return {
      kind: 'hosting', system: 'Hosting', provider: 'Vercel', source: 'connection', source_label: 'From the Vercel connection',
      state: v.status === 'active' ? 'Connected' : reauth ? 'Reconnect' : v.status === 'error' ? 'Failing' : 'Not connected',
      last_sync: v.last_synced_at ?? null, failed_at: v.last_error_at ?? null,
      owner: Number(v.user_id) === viewer.id ? 'You' : viewerMember ? v.owner_name ?? null : null,
      // The connector's sync route syncs the owner's own connection only.
      sync_uid: Number(v.user_id) === viewer.id ? v.uid : null,
      action: { text: 'Open', href },
      // The Tools rule: names, domains and the plan for those who may read them; a count for anyone else.
      projects: visible ? theirs.map(factsOf) : null,
      projects_total: theirs.length,
      projects_reason: theirs.length ? null : NO_PROJECTS,
      hobby: visible && hobby ? {
        text: `Production runs on a ${account === 'team' ? 'Vercel team' : 'personal Vercel account'}, Hobby plan.`,
        link: { text: 'See the proposal in Company creation', href: `/build/company-creation?project_id=${p.id}#from-vercel` },
      } : null,
      reconnect: reauth ? {
        project: visible ? theirs[0]?.name ?? null : null, expired_at: v.last_error_at ?? null, as_of: v.last_synced_at ?? null,
      } : null,
      health: {
        open: mine.filter((e) => !e.closed_at).length,
        closed: mine.filter((e) => e.closed_at).length,
        items: visible ? mine.map((e) => ({
          id: Number(e.id), kind: e.kind, words: HEALTH_WORDS[e.kind] ?? 'Health event', subject: e.subject,
          state: e.closed_at ? 'closed' : 'open', opened_at: e.opened_at, closed_at: e.closed_at, source: e.source,
        })) : null,
      },
    };
  });
  return { state: 'ok', systems, reason: null, syncs: await syncLines(env, ids) };
}

/**
 * D1097: Solution design's "Runs on" (VC4a), each chosen project's runtime
 * facts, beside GitHub's "Built with". Its own read, Unreadable on its own.
 */
export async function vercelRuntime(env: Env, p: { id: number; company_id: number | null }, viewer: Viewer, viewerMember: boolean) {
  if (p.company_id == null) return { state: 'not_recorded', items: [], reason: 'This project has no company scope for connectors.' };
  const vercel = await connections(env, p.company_id);
  if (!vercel.length) return { state: 'empty', items: [], reason: EMPTY };
  const rows = await projectsOf(env, p.id, vercel.map((v) => Number(v.id)));
  if (!rows.length) return { state: 'empty', items: [], reason: NO_PROJECTS };
  const owner = new Map(vercel.map((v) => [Number(v.id), Number(v.user_id)]));
  const sees = (r: ProjectRow) => owner.get(Number(r.integration_id)) === viewer.id || viewerMember;
  const visible = rows.filter(sees);
  const asOf = rows.map((r) => r.synced_at).filter(Boolean).sort().at(-1) ?? null;
  return {
    state: 'ok', reason: null, as_of: asOf, total: rows.length,
    // Anyone outside the company reads how many projects, never their names or domains.
    items: visible.length === rows.length ? visible.map((r) => {
      const f = factsOf(r);
      return { project: f.project, framework: f.framework, runtime: f.runtime, hosting: 'Vercel', domain: f.domain, branch: f.branch, repository: f.repository };
    }) : null,
  };
}
