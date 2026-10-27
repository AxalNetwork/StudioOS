/**
 * D1096 (#2961, #2408 part 1) — Vercel, read-only, through a Vercel
 * Integration (a connectable account).
 *
 * SIGN-IN. `buildAuthorizeUrl` sends the member to the Integration's install
 * page with our signed state; Vercel returns a `code` to the shared OAuth
 * callback. `connect` exchanges it (`exchangeVercelCode`) and reads the
 * installation, whose `scopes` the route holds to the registry's three Read
 * scopes: anything wider is refused (403 `scope_overreach`) and
 * `revokeGranted` uninstalls it. The token is long-lived (UNVERIFIED) and has
 * no refresh: a 401 or 403 marks the connection Reconnect Vercel.
 *
 * PROJECTS PER VENTURE, like GitHub's repositories. The connection feeds one
 * venture (`project_id`, checked by `PATCH /:uid/config`) from the Vercel
 * projects the member chooses (`projects`). `action('projects')` lists what
 * the installation reaches and records it as `known_projects`, the only ids
 * `validateConfig` accepts.
 *
 * THE SYNC records the connection's installation (the webhook's lookup) and,
 * per chosen project, its facts in `vercel_projects`. It reads no deployment
 * list, no log and no analytics: parts 2-4 add their own reads. A 429 stops it
 * "Partly synced"; the next Sync starts over and only updates.
 *
 * `clearVercelRows` deletes every `vercel_*` row of a connection; parts 2-4
 * add their tables to it. The rows also cascade with the connection.
 *
 * IMPORTANT: imported once from index.ts so registerProvider() runs at boot.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { projectEnabled } from '../companyScope';
import { decryptCredentials } from '../secrets';
import { registerProvider, type ConnectInput, type ConnectResult, type IntegrationRow, type SyncResult } from '../registry';
import { VercelError, exchangeVercelCode, vercelClient, type Installation, type VercelAuth, type VercelProject, type Deployment, type Domain } from '../../services/vercel/api';

const PROVIDER_KEY = 'vercel';
/** The most Vercel projects one connection reads for a venture. */
export const MAX_PROJECTS = 50;
/** Pages of 100 read when listing what an installation reaches. */
const MAX_PAGES = 5;
export const PARTLY_SYNCED = 'Partly synced: Vercel asked Axal VC to slow down. Run Sync again to continue';

/** The callback URL registered with the Integration; HQ → Integration keys shows the same (D751). */
export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, PROVIDER_KEY);
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const c = await loadOauthCreds(env, 'vercel');
  if (!c) throw new Error('vercel_oauth_unconfigured: set VERCEL_CLIENT_ID/VERCEL_CLIENT_SECRET, or configure them in HQ → Integration keys.');
  return c;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** The Integration's install page; never inferred from a client id. */
export function vercelInstallUrl(env: Env): string | null {
  const slug = String(env.VERCEL_INTEGRATION_SLUG ?? '').trim();
  return SLUG.test(slug) ? `https://vercel.com/integrations/${slug}/new` : null;
}

// ───────────────────────────────────────────────────────────── config

export interface VercelConfig {
  account_kind?: 'personal' | 'team';
  project_id?: number | null;
  projects?: string[];
  known_projects?: string[];
}

export function configOf(row: Pick<IntegrationRow, 'config_json'>): VercelConfig {
  try {
    const v = JSON.parse(row.config_json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The member's choice, checked against what the installation reaches (`known_projects`). */
export function checkProjects(chosen: unknown, known: string[]):
  { ok: true; projects: string[] } | { ok: false; error: string } {
  if (!Array.isArray(chosen)) return { ok: false, error: 'projects_must_be_a_list' };
  if (chosen.length > MAX_PROJECTS) return { ok: false, error: 'too_many_projects' };
  const reach = new Set(known);
  const picked: string[] = [];
  for (const raw of chosen) {
    if (typeof raw !== 'string' || !reach.has(raw)) return { ok: false, error: 'project_not_accessible' };
    if (!picked.includes(raw)) picked.push(raw);
  }
  return { ok: true, projects: picked };
}

/** What `PATCH /:uid/config` may change: the venture and the chosen projects. The rest is the sync's. */
export function validateVercelConfig(patch: Record<string, unknown>, existing: Record<string, unknown>):
  { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  for (const k of Object.keys(patch)) {
    if (k !== 'projects' && k !== 'project_id') return { ok: false, error: 'read_only_field' };
  }
  if (!('projects' in patch)) return { ok: true, patch };
  const v = checkProjects(patch.projects, ids(existing.known_projects));
  if (!v.ok) return v;
  return { ok: true, patch: { ...patch, projects: v.projects } };
}

// ───────────────────────────────────────────────────────────── credentials

export async function authOf(env: Env, row: IntegrationRow): Promise<VercelAuth> {
  const creds = row.credentials_enc ? await decryptCredentials(env, row.uid, row.credentials_enc) : null;
  const token = typeof creds?.access_token === 'string' ? creds.access_token : '';
  const configuration = typeof creds?.configuration_id === 'string' ? creds.configuration_id : '';
  if (!token || !configuration) throw new VercelError('vercel_reconnect_required', 401);
  return { access_token: token, configuration_id: configuration, team_id: typeof creds?.team_id === 'string' && creds.team_id ? creds.team_id : null };
}

/** The webhook's lookup: one row per connection, keyed by Vercel's configuration id. */
export async function recordInstallation(env: Env, integrationId: number, auth: VercelAuth): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO vercel_installations (integration_id, configuration_id, team_id, account_kind) VALUES (?, ?, ?, ?)
     ON CONFLICT(integration_id) DO UPDATE SET configuration_id = excluded.configuration_id, team_id = excluded.team_id,
       account_kind = excluded.account_kind, updated_at = CURRENT_TIMESTAMP`,
  ).bind(integrationId, auth.configuration_id, auth.team_id, auth.team_id ? 'team' : 'personal').run();
}

/** Every `vercel_*` row of a connection. Parts 2-4 add the tables they own. */
export async function clearVercelRows(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vercel_projects WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM vercel_installations WHERE integration_id = ?').bind(integrationId),
  ]);
}

// ───────────────────────────────────────────────────────────── reads

export interface ProjectChoice { id: string; name: string; framework: string | null }

/** The projects the installation reaches: its chosen list when the member picked some at install, else every project. */
export async function reachableProjects(auth: VercelAuth): Promise<{ selection: 'all' | 'selected'; projects: ProjectChoice[] }> {
  const client = vercelClient(auth);
  const inst: Installation = await client.installation();
  const allowed = inst.projectSelection === 'selected' ? new Set(ids(inst.projects)) : null;
  const out: ProjectChoice[] = [];
  let until: number | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await client.projects(until);
    for (const p of body.projects ?? []) {
      if (typeof p?.id !== 'string' || typeof p?.name !== 'string') continue;
      if (allowed && !allowed.has(p.id)) continue;
      out.push({ id: p.id, name: p.name.slice(0, 200), framework: typeof p.framework === 'string' ? p.framework : null });
    }
    const next = body.pagination?.next;
    if (typeof next !== 'number') break;
    until = next;
  }
  return { selection: inst.projectSelection === 'selected' ? 'selected' : 'all', projects: out };
}

const iso = (ms: unknown): string | null => (typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/** Live, failing, building or not deployed, from the project's current production deployment. */
export function liveOf(prod: Deployment | undefined | null): { state: 'live' | 'failing' | 'building' | 'not_deployed'; since: string | null } {
  if (!prod) return { state: 'not_deployed', since: null };
  const s = String(prod.readyState ?? prod.state ?? '').toUpperCase();
  if (s === 'READY') return { state: 'live', since: iso(prod.ready) ?? iso(prod.createdAt ?? prod.created) };
  if (s === 'ERROR') return { state: 'failing', since: iso(prod.createdAt ?? prod.created) };
  if (s === 'BUILDING' || s === 'QUEUED' || s === 'INITIALIZING') return { state: 'building', since: iso(prod.buildingAt ?? prod.createdAt ?? prod.created) };
  return { state: 'not_deployed', since: null };
}

/** The production domain: the first verified custom domain, else the first verified one; never guessed. */
export function productionDomain(domains: Domain[]): string | null {
  const verified = domains.filter((d) => typeof d?.name === 'string' && d.verified === true).map((d) => d.name.toLowerCase());
  return verified.find((n) => !n.endsWith('.vercel.app')) ?? verified[0] ?? null;
}

/** `owner/repo` when the project is linked to a Git repository. */
export function repositoryOf(p: VercelProject): string | null {
  const org = p.link?.org, repo = p.link?.repo;
  return typeof org === 'string' && typeof repo === 'string' && org && repo ? `${org}/${repo}`.slice(0, 200) : null;
}

// ───────────────────────────────────────────────────────────── sync

const UPSERT_PROJECT = `INSERT INTO vercel_projects
  (integration_id, project_id, vercel_project_id, name, framework, node_version, production_branch, git_repository, production_domain, plan, live_state, live_since, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(integration_id, project_id, vercel_project_id) DO UPDATE SET
    name = excluded.name, framework = excluded.framework, node_version = excluded.node_version,
    production_branch = excluded.production_branch, git_repository = excluded.git_repository,
    production_domain = excluded.production_domain, plan = excluded.plan, live_state = excluded.live_state,
    live_since = excluded.live_since, synced_at = CURRENT_TIMESTAMP`;
// A project no longer chosen, or a venture the connection no longer feeds, leaves the directory.
const PRUNE_PROJECTS = `DELETE FROM vercel_projects WHERE integration_id = ?
  AND (project_id <> ? OR vercel_project_id NOT IN (SELECT value FROM json_each(?)))`;

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

export async function syncVercel(env: Env, row: IntegrationRow): Promise<SyncResult> {
  const cfg = configOf(row);
  const chosen = ids(cfg.projects).slice(0, MAX_PROJECTS);
  const projectId = Number(cfg.project_id);
  if (!chosen.length) throw new Error('vercel_no_projects: choose projects first.');
  if (!Number.isSafeInteger(projectId) || !(await projectEnabled(env, row.id, projectId))) {
    throw new Error('vercel_project_not_enabled: choose a project in a company this connection is enabled for.');
  }
  const auth = await authOf(env, row);
  await recordInstallation(env, row.id, auth);
  const client = vercelClient(auth);
  const inst = await client.installation();
  const allowed = inst.projectSelection === 'selected' ? new Set(ids(inst.projects)) : null;
  const counts: Record<string, number | boolean> = { projects: 0, not_reachable: 0 };
  const kept: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  let partial = false;
  for (const id of chosen) {
    if (allowed && !allowed.has(id)) { counts.not_reachable = Number(counts.not_reachable) + 1; continue; }
    try {
      const p = await client.project(id);
      const domains = (await client.projectDomains(id)).domains ?? [];
      const live = liveOf(p.targets?.production ?? null);
      stmts.push(env.DB.prepare(UPSERT_PROJECT).bind(
        row.id, projectId, id, text(p.name) ?? id, text(p.framework, 60), text(p.nodeVersion, 20),
        text(p.link?.productionBranch ?? p.productionBranch, 200), repositoryOf(p), productionDomain(domains),
        text(p.plan, 20), live.state, live.since,
      ));
      kept.push(id);
      counts.projects = Number(counts.projects) + 1;
    } catch (e) {
      if (e instanceof VercelError && e.code === 'vercel_rate_limited') { partial = true; break; }
      if (e instanceof VercelError && e.status === 404) { counts.not_reachable = Number(counts.not_reachable) + 1; continue; }
      throw e;
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  // A partly synced run keeps the rows it did not reach this time.
  if (!partial) await env.DB.prepare(PRUNE_PROJECTS).bind(row.id, projectId, JSON.stringify(kept)).run();
  if (partial) counts.partial = true;
  const n = Number(counts.projects);
  const what = `${n} ${n === 1 ? 'project' : 'projects'}`;
  return { summary: partial ? `${PARTLY_SYNCED}. Synced ${what} so far.` : `Synced ${what} from Vercel.`, counts };
}

// ───────────────────────────────────────────────────────────── impl

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) throw new Error('vercel_requires_oauth_code: complete the Vercel install first.');
  const { id, secret } = await ensureCreds(c.env);
  const auth = await exchangeVercelCode(id, secret, input.oauth_code, redirectUri(c.env));
  const inst = await vercelClient(auth).installation();
  return {
    credentials: { access_token: auth.access_token, configuration_id: auth.configuration_id, team_id: auth.team_id, token_type: 'Bearer' },
    // The route holds these to the registry's Read scopes; a wider grant is refused and uninstalled.
    scopes: ids(inst.scopes),
    external_account_id: auth.configuration_id,
    external_account_name: null,
    // Nothing is chosen at connect: the member picks the venture and its projects next.
    config: { account_kind: auth.team_id ? 'team' : 'personal', project_id: null, projects: [], known_projects: [] },
  };
}

/** Uninstalls a grant the route refused, before any row is saved. */
async function revokeGranted(_env: Env, result: ConnectResult): Promise<void> {
  const c = result.credentials;
  if (typeof c?.access_token !== 'string' || typeof c?.configuration_id !== 'string') return;
  await vercelClient({ access_token: c.access_token, configuration_id: c.configuration_id, team_id: typeof c.team_id === 'string' ? c.team_id : null }).uninstall();
}

// Disconnect uninstalls on Vercel, best effort, then removes the Vercel rows; they also cascade with the row.
async function disconnect(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow): Promise<void> {
  const local = await Promise.allSettled([clearVercelRows(c.env, row.id)]);
  if (local.some((r) => r.status === 'rejected')) console.warn('[vercel] disconnect: the Vercel rows were not deleted here; they cascade with the connection');
  await vercelClient(await authOf(c.env, row)).uninstall();
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  await ensureCreds(c.env);
  const url = vercelInstallUrl(c.env);
  if (!url) throw new Error('vercel_oauth_unconfigured: set VERCEL_INTEGRATION_SLUG to the Integration’s slug.');
  return `${url}?${new URLSearchParams({ state })}`;
}

/** `GET /:uid/action/projects`: what the installation reaches, recorded as the only ids the member may choose. */
async function action(c: Context<{ Bindings: Env }>, _user: User, row: IntegrationRow, name: string): Promise<unknown> {
  if (name !== 'projects') throw new Error('unknown_action');
  const auth = await authOf(c.env, row);
  await recordInstallation(c.env, row.id, auth);
  const reach = await reachableProjects(auth);
  const cfg = configOf(row);
  const known = reach.projects.map((p) => p.id);
  const merged = { ...cfg, known_projects: known };
  await c.env.DB.prepare('UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(JSON.stringify(merged), row.id).run();
  const selected = ids(cfg.projects).filter((p) => known.includes(p));
  return {
    selection: reach.selection,
    available: reach.projects.map((p) => ({ ...p, chosen: selected.includes(p.id) })),
    selected,
    project_id: Number.isSafeInteger(Number(cfg.project_id)) && Number(cfg.project_id) > 0 ? Number(cfg.project_id) : null,
    max: MAX_PROJECTS,
  };
}

registerProvider({
  key: PROVIDER_KEY,
  // D751: whether Axal holds the Integration's client and its slug, from the cache `ensureCreds` reads.
  ready: async (env) => {
    const held = await (await import('../../services/providerOauthKeys')).oauthCredsReady(env, 'vercel');
    return held === true && vercelInstallUrl(env) === null ? false : held;
  },
  connect,
  revokeGranted,
  disconnect,
  buildAuthorizeUrl,
  // The installation row is the webhook's lookup; it is written again by every sync and projects read.
  postConnect: async (c, _user, row) => { await recordInstallation(c.env, row.id, await authOf(c.env, row)); },
  sync: (c, _user, row) => syncVercel(c.env, row),
  action: (c, user, row, name) => action(c, user, row, name),
  validateConfig: validateVercelConfig,
});
