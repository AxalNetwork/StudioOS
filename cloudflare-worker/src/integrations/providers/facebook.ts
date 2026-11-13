import type { Env } from '../../types';
import { selectJwt } from '../../auth';
import { oauthCallbackUrl } from '../../util/url';
import { metaApp } from '../../services/meta/app';
import { providerJson } from '../../services/channels/providerHttp';
import { ConnectRefusal, registerProvider, type IntegrationRow } from '../registry';
import { decryptCredentials } from '../secrets';
import { FACEBOOK_READ_SCOPES } from '../facebookScopes';
import { activeCompanyFor } from '../../middleware/activeCompany';
import { companyEnabled } from '../companyScope';

const GRAPH = 'https://graph.facebook.com/v26.0';
const AUTHORIZE = 'https://www.facebook.com/v26.0/dialog/oauth';
const isId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,32}$/.test(value);
const unavailable = () => new ConnectRefusal(503, 'facebook_unavailable', 'Facebook is not available yet.');
export const redirectUri = (env: Env) => oauthCallbackUrl(env, 'facebook');

export function facebookReady(env: Env): boolean {
  const { appId, appSecret } = metaApp(env);
  return env.FACEBOOK_APP_APPROVED === '1' && isId(env.FACEBOOK_LOGIN_CONFIG_ID?.trim()) && !!appId && !!appSecret;
}

async function graph(path: string, token?: string, method = 'GET') {
  const { res, data } = await providerJson(GRAPH + path, { method, redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok || !data || data.error) {
    if (data?.error?.code === 190) throw new ConnectRefusal(401, 'facebook_reconnect', 'Reconnect with Facebook to continue.');
    if (res.status === 429 || [4, 17, 32, 613].includes(data?.error?.code)) {
      throw new ConnectRefusal(429, 'facebook_rate_limited', 'Facebook is limiting requests. Try again later.');
    }
    throw new ConnectRefusal(502, 'facebook_unreadable', 'Facebook could not complete the request.');
  }
  return data;
}

async function collection(path: string, token: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const data = await graph(path + (after ? `&after=${encodeURIComponent(after)}` : ''), token);
    if (!Array.isArray(data.data)) break;
    rows.push(...data.data);
    if (!data.paging?.next) return rows;
    const cursor = data.paging?.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursor === after || cursor.length > 2048) break;
    after = cursor;
  }
  throw new ConnectRefusal(502, 'facebook_directory_incomplete', 'Facebook did not return the complete directory.');
}

async function permissions(token: string): Promise<string[]> {
  const rows = await collection('/me/permissions?limit=100', token);
  return rows.flatMap(value => {
    const r = value as { status?: unknown; permission?: unknown } | null;
    return r?.status === 'granted' && typeof r.permission === 'string' ? [r.permission] : [];
  });
}

function requireReadGrant(granted: string[]) {
  const allowed = new Set<string>([...FACEBOOK_READ_SCOPES, 'public_profile']);
  if (granted.some(scope => !allowed.has(scope))) throw new ConnectRefusal(403, 'scope_overreach', 'Facebook granted permissions beyond read access.');
  if (FACEBOOK_READ_SCOPES.some(scope => !granted.includes(scope))) {
    throw new ConnectRefusal(403, 'facebook_permissions_missing', 'Facebook did not grant all the required read permissions.');
  }
}

async function revoke(token: string, account = 'me') {
  for (const scope of FACEBOOK_READ_SCOPES) {
    try { await graph(`/${account}/permissions/${scope}`, token, 'DELETE'); }
    catch (e) {
      if (e instanceof ConnectRefusal && e.code === 'facebook_reconnect') return;
      throw e;
    }
  }
}

export async function listFacebookPages(env: Env, row: IntegrationRow) {
  if (!facebookReady(env)) throw unavailable();
  const credentials = await decryptCredentials(env, row.uid, row.credentials_enc);
  const token = credentials?.access_token;
  if (typeof token !== 'string' || !token) throw new ConnectRefusal(401, 'facebook_reconnect', 'Reconnect with Facebook to continue.');
  requireReadGrant(await permissions(token));
  const pages = await collection('/me/accounts?fields=id,name&limit=100', token);
  return pages.flatMap(value => {
    const page = value as { id?: unknown; name?: unknown } | null;
    return isId(page?.id) && typeof page?.name === 'string' ? [{ id: page.id, name: page.name.slice(0, 200) }] : [];
  });
}

registerProvider({
  key: 'facebook',
  ready: async env => facebookReady(env),
  async buildAuthorizeUrl(c, _user, state) {
    if ((await selectJwt(c))?.payload.impersonated_by) throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect Facebook.');
    if (!facebookReady(c.env)) throw unavailable();
    const query = new URLSearchParams({
      client_id: metaApp(c.env).appId, config_id: c.env.FACEBOOK_LOGIN_CONFIG_ID!.trim(),
      redirect_uri: redirectUri(c.env), state, response_type: 'code', override_default_response_type: 'true',
    });
    return `${AUTHORIZE}?${query}`;
  },
  async connect(c, _user, input) {
    if ((await selectJwt(c))?.payload.impersonated_by) throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect Facebook.');
    if (!facebookReady(c.env)) throw unavailable();
    if (!input.oauth_code) throw new ConnectRefusal(400, 'facebook_code_required', 'Start Facebook sign-in first.');
    const { appId, appSecret } = metaApp(c.env);
    const app = { client_id: appId, client_secret: appSecret };
    const short = await graph(`/oauth/access_token?${new URLSearchParams({ ...app, code: input.oauth_code, redirect_uri: redirectUri(c.env) })}`);
    if (typeof short.access_token !== 'string' || !short.access_token) throw unavailable();
    let token = short.access_token;
    try {
      const long = await graph(`/oauth/access_token?${new URLSearchParams({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: token })}`);
      if (typeof long.access_token !== 'string' || !long.access_token) throw unavailable();
      token = long.access_token;
      const scopes = await permissions(token);
      requireReadGrant(scopes);
      const account = await graph('/me?fields=id', token);
      if (!isId(account.id)) throw unavailable();
      return { credentials: { access_token: token }, scopes: scopes.filter(s => s !== 'public_profile'), external_account_id: account.id, config: { pages_by_company: {} } };
    } catch (error) {
      try { await revoke(token); } catch { /* The failed grant remains unpersisted. */ }
      throw error;
    }
  },
  async revokeGranted(_env, result) {
    if (typeof result.credentials.access_token === 'string') await revoke(result.credentials.access_token);
  },
  async disconnect(c, _user, row) {
    const credentials = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    if (typeof credentials?.access_token === 'string') await revoke(credentials.access_token, isId(row.external_account_id) ? row.external_account_id : 'me');
  },
  async action(c, user, row, name, body) {
    if ((await selectJwt(c))?.payload.impersonated_by) throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot manage Facebook Pages.');
    const company = await activeCompanyFor(c, user);
    if (!company || !(await companyEnabled(c.env, row.id, company))) throw new ConnectRefusal(403, 'company_not_enabled', 'Enable the connection for this company first.');
    if (row.status !== 'active') throw new ConnectRefusal(409, 'facebook_connection_inactive', 'Reconnect with Facebook to continue.');
    if (name === 'list_pages' && c.req.method === 'GET') {
      const pages = await listFacebookPages(c.env, row);
      const config = JSON.parse(row.config_json ?? '{}');
      const saved = config.pages_by_company?.[company];
      return { available: pages, selected: pages.filter(page => Array.isArray(saved) && saved.includes(page.id)).map(page => page.id) };
    }
    if (name !== 'choose_pages' || c.req.method !== 'POST') throw new ConnectRefusal(422, 'action_not_supported', 'This Facebook action is unavailable.');
    const ids = (body as { page_ids?: unknown } | null)?.page_ids;
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(isId)) throw new ConnectRefusal(400, 'invalid_page_selection', 'Choose up to 100 Facebook Pages.');
    const pages = await listFacebookPages(c.env, row);
    const selected = [...new Set(ids)];
    if (selected.some(id => !pages.some(page => page.id === id))) throw new ConnectRefusal(403, 'facebook_page_not_granted', 'Facebook did not grant one of the selected Pages.');
    const config = JSON.parse(row.config_json ?? '{}');
    const updated = await c.env.DB.prepare(
      "UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND provider_key = 'facebook' AND status = 'active' AND config_json IS ? AND credentials_enc IS ?",
    ).bind(JSON.stringify({ ...config, pages_by_company: { ...config.pages_by_company, [company]: selected } }), row.id, row.config_json, row.credentials_enc).run();
    if (!updated.meta.changes) throw new ConnectRefusal(409, 'facebook_connection_changed', 'The connection changed. Reload the Pages and try again.');
    return { selected };
  },
  validateConfig(patch) {
    return Object.keys(patch).length
      ? { ok: false, error: 'Choose Facebook Pages through the Page picker.' }
      : { ok: true, patch };
  },
});
