/** D1096: Vercel's only transport. No arbitrary URLs or deployment writes. */
export const VERCEL_API = 'https://api.vercel.com';
export const VERCEL_READ_SCOPES = ['read:project', 'read:deployment', 'read:domain'] as const;
export class VercelError extends Error {
  constructor(readonly code: string, readonly status = 502, readonly reset: number | null = null) { super(code); }
}
export interface VercelAuth { access_token: string; configuration_id: string; team_id: string | null }
export interface Installation { id: string; scopes: string[]; teamId?: string | null; projectSelection: 'all' | 'selected'; projects?: string[]; disabledAt?: number | null }
export interface VercelProject {
  id: string; name: string; framework?: string | null; nodeVersion?: string | null;
  productionBranch?: string | null; link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null;
  plan?: string | null; targets?: { production?: Deployment }; latestDeployments?: Deployment[];
}
export interface Deployment {
  id?: string; uid?: string; name?: string; target?: string | null; readyState?: string; state?: string;
  createdAt?: number; created?: number; buildingAt?: number; ready?: number; source?: string; errorCode?: string;
  meta?: Record<string, string>; url?: string; isRollbackCandidate?: boolean;
}
export interface Domain { name: string; verified?: boolean; expiresAt?: number | null; renew?: boolean; serviceType?: string }
export interface Page<T> { pagination?: { next?: number | null }; projects?: T[]; deployments?: T[]; domains?: T[] }
export interface RateLimit { limit: number | null; remaining: number | null; reset: number | null }
export interface VercelClientOptions { onRateLimit?: (rate: RateLimit) => void }
const key = (value: string) => {
  if (!/^[A-Za-z0-9_.@-]{1,253}$/.test(value)) throw new VercelError('vercel_invalid_identifier', 400);
  return encodeURIComponent(value);
};
const numericHeader = (r: Response, name: string) => {
  const v = r.headers.get(name); return v != null && /^\d+$/.test(v) ? Number(v) : null;
};
export function vercelClient(auth: VercelAuth, options: VercelClientOptions = {}) {
  async function request<T>(path: string, query: Record<string, string | number | undefined> = {}, method: 'GET' | 'DELETE' = 'GET'): Promise<T> {
    const url = new URL(path, VERCEL_API);
    if (auth.team_id) url.searchParams.set('teamId', auth.team_id);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    let r: Response;
    try { r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' } }); }
    catch { throw new VercelError('vercel_unreadable'); }
    const rate = { limit: numericHeader(r, 'x-ratelimit-limit'), remaining: numericHeader(r, 'x-ratelimit-remaining'), reset: numericHeader(r, 'x-ratelimit-reset') };
    options.onRateLimit?.(rate);
    if (!r.ok) {
      await r.body?.cancel();
      throw new VercelError(r.status === 429 ? 'vercel_rate_limited' : r.status === 401 || r.status === 403 ? 'vercel_reconnect_required' : 'vercel_api_failed', r.status, rate.reset);
    }
    if (method === 'DELETE' || r.status === 204) { await r.body?.cancel(); return undefined as T; }
    // Read a bounded body even when the provider omits Content-Length.
    const reader = r.body?.getReader(); if (!reader) throw new VercelError('vercel_invalid_response');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); throw new VercelError('vercel_response_too_large'); }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(body)) as T; } catch { throw new VercelError('vercel_invalid_response'); }
  }
  return {
    installation: () => request<Installation>(`/v1/integrations/configuration/${key(auth.configuration_id)}`),
    uninstall: () => request<void>(`/v1/integrations/configuration/${key(auth.configuration_id)}`, {}, 'DELETE'),
    projects: (until?: number) => request<Page<VercelProject>>('/v10/projects', { limit: 100, until }),
    project: (id: string) => request<VercelProject>(`/v9/projects/${key(id)}`),
    deployments: (projectId: string, until?: number) => request<Page<Deployment>>('/v7/deployments', { projectId, limit: 100, until }),
    deployment: (id: string) => request<Deployment>(`/v13/deployments/${key(id)}`),
    promotionAliases: (id: string) => request<{ aliases?: { alias: string }[] }>(`/v1/projects/${key(id)}/promote/aliases`),
    deploymentAliases: (id: string) => request<{ aliases?: { alias: string }[] }>(`/v2/deployments/${key(id)}/aliases`),
    projectDomains: (id: string, until?: number) => request<Page<Domain>>(`/v9/projects/${key(id)}/domains`, { limit: 100, until }),
    domainConfig: (name: string) => request<{ misconfigured?: boolean }>(`/v6/domains/${key(name)}/config`),
    domains: (until?: number) => request<Page<Domain>>('/v5/domains', { limit: 100, until }),
    deploymentEvents: (id: string) => request<unknown[]>(`/v3/deployments/${key(id)}/events`),
    runtimeLogs: (project: string, deployment: string) => request<unknown>(`/v1/projects/${key(project)}/deployments/${key(deployment)}/runtime-logs`),
    analyticsCount: (projectId: string) => request<unknown>('/v1/query/web-analytics/visits/count', { projectId }),
    analyticsAggregate: (projectId: string) => request<unknown>('/v1/query/web-analytics/visits/aggregate', { projectId }),
  };
}
/** OAuth is the sole POST; it exchanges a single-use code, never writes project data. */
export async function exchangeVercelCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<VercelAuth> {
  let r: Response;
  try { r = await fetch(`${VERCEL_API}/v2/oauth/access_token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }) }); }
  catch { throw new VercelError('vercel_token_exchange_failed'); }
  if (!r.ok) { await r.body?.cancel(); throw new VercelError('vercel_token_exchange_failed'); }
  let b: any; try { b = await r.json(); } catch { throw new VercelError('vercel_token_exchange_failed'); }
  if (typeof b.access_token !== 'string' || !b.access_token || typeof b.configuration_id !== 'string' || !b.configuration_id || (b.team_id != null && typeof b.team_id !== 'string')) throw new VercelError('vercel_token_exchange_failed');
  return { access_token: b.access_token, configuration_id: b.configuration_id, team_id: b.team_id || null };
}
