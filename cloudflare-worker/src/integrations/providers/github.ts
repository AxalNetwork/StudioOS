/**
 * D655 (#1467) — the GitHub connector.
 *
 * A GitHub App's user authorization, read-only. An OAuth App cannot be
 * read-only on private repositories: its only scope for them, `repo`, also
 * grants write. A GitHub App's permissions are fine-grained, so the App is
 * registered with issues, pull requests, contents (releases) and metadata, all
 * `read`. The member installs it on the repositories GitHub lets them pick, and
 * then chooses, inside StudioOS, which of those to sync.
 *
 * WHAT IS GRANTED IS READ, NOT ASSUMED. A user token carries no scope string,
 * so `grantedPermissions` reads each installation's `permissions` and returns
 * them as `name:level`. The route layer compares them with the registry's
 * `oauth_scopes` (`hasScopeOverreach`): any `write` or `admin` is refused, at
 * the callback and again whenever repositories are chosen.
 *
 * WHERE THE DATA LANDS (`connector_fed_items`, migration 445):
 *   - an issue becomes a Product roadmap item (`roadmap_okrs`);
 *   - a pull request becomes a Prototype / MVP must-have (`mvp_features`);
 *   - a release has no store in the founder workspace, so it is recorded as
 *     arrived with no local row, and the fed count says so.
 * A re-sync finds each item's row through the ledger and updates it.
 *
 * IMPORTANT: imported once from index.ts so registerProvider() runs at boot.
 */
import type { Context } from 'hono';
import { callbackBase } from '../../util/url';
import type { Env, User } from '../../types';
import { projectEnabled } from '../companyScope';
import {
  registerProvider,
  type ConnectInput,
  type ConnectResult,
  type IntegrationRow,
  type SyncResult,
} from '../registry';
import { decryptCredentials, type CredentialBlob } from '../secrets';

const PROVIDER_KEY = 'github';
const API = 'https://api.github.com';
const MAX_PAGES = 5;
const PER_PAGE = 100;
export const MAX_REPOSITORIES = 50;

export interface GithubRepository { full_name: string; private: boolean; updated_at: string | null; installation_id: number }
export interface SyncProgress { state: 'running' | 'done' | 'failed'; pct: number; reading: string; updated_at: string }

function redirectUri(env: Env): string {
  return `${callbackBase(env)}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

async function ensureCreds(env: Env): Promise<{ id: string; secret: string }> {
  const { loadOauthCreds } = await import('../../services/providerOauthKeys');
  const c = await loadOauthCreds(env, 'github');
  if (!c) throw new Error('github_oauth_unconfigured: set GITHUB_APP_CLIENT_ID/GITHUB_APP_CLIENT_SECRET, or configure them in Admin → Integration Keys.');
  return c;
}

async function gh(token: string, path: string): Promise<Response> {
  return fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'StudioOS-Connectors',
    },
  });
}

async function ghJson<T>(token: string, path: string): Promise<T> {
  const res = await gh(token, path);
  if (!res.ok) throw new Error(`github_api_failed: ${res.status} ${path.split('?')[0]}`);
  return await res.json() as T;
}

/** Every page of a list endpoint, up to MAX_PAGES. */
async function ghPages<T>(token: string, path: string, pick: (body: any) => T[] = (b) => b as T[]): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = pick(await ghJson<any>(token, `${path}${sep}per_page=${PER_PAGE}&page=${page}`)) || [];
    out.push(...items);
    if (items.length < PER_PAGE) break;
  }
  return out;
}

export async function accessToken(env: Env, row: IntegrationRow): Promise<string> {
  const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
  const at = typeof creds?.access_token === 'string' ? creds.access_token : '';
  if (!at) throw new Error('github_credentials_missing');
  return at;
}

/**
 * What the member's installations actually grant, as `name:level`, e.g.
 * `issues:read`. Compared with the registry's requested list by the route.
 */
export async function grantedPermissions(token: string): Promise<{ scopes: string[]; installations: number[] }> {
  const installs = await ghPages<any>(token, '/user/installations', (b) => b?.installations);
  const scopes = new Set<string>();
  for (const inst of installs) {
    for (const [name, level] of Object.entries(inst?.permissions || {})) scopes.add(`${name}:${String(level)}`);
  }
  return { scopes: [...scopes].sort(), installations: installs.map((i) => Number(i.id)).filter(Number.isSafeInteger) };
}

/** The repositories the installations reach — the only ones a member may choose. */
export async function accessibleRepositories(token: string, installations: number[]): Promise<GithubRepository[]> {
  const out: GithubRepository[] = [];
  for (const id of installations) {
    const repos = await ghPages<any>(token, `/user/installations/${id}/repositories`, (b) => b?.repositories);
    for (const r of repos) {
      if (typeof r?.full_name !== 'string') continue;
      out.push({ full_name: r.full_name, private: !!r.private, updated_at: r.updated_at ?? null, installation_id: id });
    }
  }
  return out;
}

/** The member's choice, checked against what the installations reach. */
export function checkChoice(chosen: unknown, available: GithubRepository[]):
  { ok: true; repositories: string[] } | { ok: false; error: string; repository?: string } {
  if (!Array.isArray(chosen) || chosen.length === 0) return { ok: false, error: 'repositories_required' };
  if (chosen.length > MAX_REPOSITORIES) return { ok: false, error: 'too_many_repositories' };
  const reach = new Map(available.map((r) => [r.full_name.toLowerCase(), r.full_name]));
  const picked: string[] = [];
  for (const raw of chosen) {
    const name = typeof raw === 'string' ? reach.get(raw.trim().toLowerCase()) : undefined;
    if (!name) return { ok: false, error: 'repository_not_accessible', repository: String(raw).slice(0, 140) };
    if (!picked.includes(name)) picked.push(name);
  }
  return { ok: true, repositories: picked };
}

// ───────────────────────────────────────────────────────────── progress

const progressKey = (uid: string) => `connector-sync:${uid}`;

export async function writeProgress(env: Env, uid: string, p: Omit<SyncProgress, 'updated_at'>): Promise<void> {
  try {
    await env.RATE_LIMITS.put(progressKey(uid), JSON.stringify({ ...p, updated_at: new Date().toISOString() }), { expirationTtl: 3600 });
  } catch { /* progress is a convenience; the sync itself is unaffected */ }
}

export async function readProgress(env: Env, uid: string): Promise<SyncProgress | null> {
  try {
    const raw = await env.RATE_LIMITS.get(progressKey(uid));
    return raw ? JSON.parse(raw) as SyncProgress : null;
  } catch { return null; }
}

// ───────────────────────────────────────────────────────────── landing

/** A pull request's delivery state, in `mvp_features`' words. */
export function prDeliveryStatus(pr: any): string {
  if (pr?.merged_at) return 'Done';
  if (pr?.state === 'closed') return 'Blocked';
  return pr?.draft ? 'In Progress' : 'Review';
}

async function ledgerRow(env: Env, integrationId: number, externalId: string): Promise<{ local_id: number | null } | null> {
  return await env.DB.prepare('SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(integrationId, externalId).first<{ local_id: number | null }>() ?? null;
}

async function record(env: Env, row: IntegrationRow, projectId: number, module: string, kind: string, externalId: string,
  localTable: string | null, localId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`,
  ).bind(row.id, projectId, module, kind, externalId, localTable, localId).run();
}

async function landIssue(env: Env, row: IntegrationRow, projectId: number, repo: string, issue: any): Promise<boolean> {
  const externalId = `issue:${repo}#${issue.number}`;
  const title = String(issue.title || '').slice(0, 300) || `${repo}#${issue.number}`;
  const prior = await ledgerRow(env, row.id, externalId);
  if (prior?.local_id) {
    // Only the title and a close are GitHub's; the founder's lane is theirs.
    await env.DB.prepare(
      `UPDATE roadmap_okrs SET objective = ?, kanban_status = CASE WHEN ? = 'closed' THEN 'done' ELSE kanban_status END,
              updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
    ).bind(title, String(issue.state), prior.local_id, projectId).run();
    await record(env, row, projectId, 'product_roadmap', 'issue', externalId, 'roadmap_okrs', prior.local_id);
    return false;
  }
  const ins = await env.DB.prepare(
    'INSERT INTO roadmap_okrs (project_id, objective, kanban_status) VALUES (?, ?, ?)',
  ).bind(projectId, title, issue.state === 'closed' ? 'done' : 'next').run();
  await record(env, row, projectId, 'product_roadmap', 'issue', externalId, 'roadmap_okrs', Number(ins.meta?.last_row_id));
  return true;
}

async function landPull(env: Env, row: IntegrationRow, projectId: number, repo: string, pr: any): Promise<boolean> {
  const externalId = `pull:${repo}#${pr.number}`;
  const title = String(pr.title || '').slice(0, 300) || `${repo}#${pr.number}`;
  const prior = await ledgerRow(env, row.id, externalId);
  if (prior?.local_id) {
    await env.DB.prepare(
      'UPDATE mvp_features SET title = ?, delivery_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
    ).bind(title, prDeliveryStatus(pr), prior.local_id, projectId).run();
    await record(env, row, projectId, 'prototype_mvp', 'pull_request', externalId, 'mvp_features', prior.local_id);
    return false;
  }
  const ins = await env.DB.prepare(
    'INSERT INTO mvp_features (project_id, title, delivery_status) VALUES (?, ?, ?)',
  ).bind(projectId, title, prDeliveryStatus(pr)).run();
  await record(env, row, projectId, 'prototype_mvp', 'pull_request', externalId, 'mvp_features', Number(ins.meta?.last_row_id));
  return true;
}

// ───────────────────────────────────────────────────────────── impl

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) throw new Error('github_requires_oauth_code: complete the GitHub authorization first.');
  const { id, secret } = await ensureCreds(c.env);
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code: input.oauth_code, redirect_uri: redirectUri(c.env) }),
  });
  const tok: any = await res.json().catch(() => ({}));
  if (!res.ok || !tok?.access_token) throw new Error(`github_token_exchange_failed: ${tok?.error || res.status}`);
  const token = String(tok.access_token);
  const me = await ghJson<any>(token, '/user');
  const granted = await grantedPermissions(token);
  const credentials: CredentialBlob = {
    access_token: token,
    refresh_token: tok.refresh_token || null,
    token_type: 'Bearer',
    issued_at: Date.now(),
    expires_in: tok.expires_in || null,
  };
  return {
    credentials,
    scopes: granted.scopes,
    external_account_id: me?.id != null ? String(me.id) : null,
    external_account_name: typeof me?.login === 'string' ? me.login : null,
    // Nothing is chosen at connect: the member picks repositories next.
    config: { repositories: [], installations: granted.installations },
  };
}

async function revokeGranted(env: Env, result: ConnectResult): Promise<void> {
  const token = typeof result.credentials?.access_token === 'string' ? result.credentials.access_token : '';
  if (!token) return;
  const { id, secret } = await ensureCreds(env);
  await fetch(`${API}/applications/${encodeURIComponent(id)}/grant`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, Accept: 'application/vnd.github+json', 'User-Agent': 'StudioOS-Connectors' },
    body: JSON.stringify({ access_token: token }),
  });
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = await ensureCreds(c.env);
  // A GitHub App takes no `scope`: its permissions are fixed on the App and
  // read back from each installation at the callback.
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(c.env), state });
  return `https://github.com/login/oauth/authorize?${q}`;
}

export async function syncGithub(env: Env, row: IntegrationRow): Promise<SyncResult> {
  const cfg = (() => { try { return JSON.parse(row.config_json || '{}'); } catch { return {}; } })();
  const repos: string[] = Array.isArray(cfg.repositories) ? cfg.repositories.filter((r: unknown) => typeof r === 'string') : [];
  const projectId = Number(cfg.project_id);
  if (!repos.length) throw new Error('github_no_repositories: choose repositories first.');
  if (!Number.isSafeInteger(projectId) || !(await projectEnabled(env, row.id, projectId))) {
    throw new Error('github_project_not_enabled: choose a project in a company this connection is enabled for.');
  }
  const token = await accessToken(env, row);
  const counts = { issues: 0, pull_requests: 0, releases: 0, roadmap_items_created: 0, must_haves_created: 0 };
  const steps = repos.length * 3;
  let done = 0;
  const step = async (reading: string) => {
    await writeProgress(env, row.uid, { state: 'running', pct: Math.round((done / steps) * 100), reading });
    done += 1;
  };
  try {
    for (const repo of repos) {
      const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
      await step(`Issues in ${repo}`);
      for (const issue of await ghPages<any>(token, `${path}/issues?state=all`)) {
        if (issue?.pull_request) continue; // the issues endpoint lists pull requests too
        counts.issues += 1;
        if (await landIssue(env, row, projectId, repo, issue)) counts.roadmap_items_created += 1;
      }
      await step(`Pull requests in ${repo}`);
      for (const pr of await ghPages<any>(token, `${path}/pulls?state=all`)) {
        counts.pull_requests += 1;
        if (await landPull(env, row, projectId, repo, pr)) counts.must_haves_created += 1;
      }
      await step(`Releases in ${repo}`);
      for (const rel of await ghPages<any>(token, `${path}/releases`)) {
        counts.releases += 1;
        await record(env, row, projectId, 'product_roadmap', 'release', `release:${repo}@${rel.id}`, null, null);
      }
    }
  } catch (e) {
    await writeProgress(env, row.uid, { state: 'failed', pct: Math.round((done / steps) * 100), reading: 'Stopped' });
    throw e;
  }
  await writeProgress(env, row.uid, { state: 'done', pct: 100, reading: 'Done' });
  return {
    summary: `Synced ${counts.issues} issues, ${counts.pull_requests} pull requests and ${counts.releases} releases from ${repos.length} repositories.`,
    counts,
  };
}

registerProvider({
  key: PROVIDER_KEY,
  // D751: whether Axal holds the OAuth client, from the cache `ensureCreds` reads.
  ready: async (env) => (await import('../../services/providerOauthKeys')).oauthCredsReady(env, 'github'),
  connect,
  revokeGranted,
  buildAuthorizeUrl,
  sync: (c, _user, row) => syncGithub(c.env, row),
  // The repository choice has its own route (`PUT /:uid/repositories`), which
  // re-reads the grant; a config patch may not set it around that check.
  validateConfig(patch) {
    if ('repositories' in patch || 'installations' in patch) return { ok: false, error: 'use_repositories_route' };
    return { ok: true, patch };
  },
});
