/**
 * D5827 (#5827) — Typeform, read only: forms and responses of the one form a
 * founder binds to a venture (`routes/typeform.ts`).
 *
 * Ready only when the owner has set `TYPEFORM_APP_APPROVED=1` and the
 * developer app's client id and secret (env or HQ › Integration keys): the
 * app is the owner's to register in the approved pilot environment, with each
 * environment's exact callback.
 *
 * The member's data center (`typeform_region`, `us` or `eu`) is chosen at
 * sign-in, carried in the signed state, and stored with the credentials, so
 * every later request for the connection goes to that region's origin.
 */
import type { Env } from '../../types';
import { oauthCallbackUrl } from '../../util/url';
import { loadOauthCreds, oauthCredsReady } from '../../services/providerOauthKeys';
import { ConnectRefusal, registerProvider, type IntegrationRow, type ProviderImpl } from '../registry';
import { decryptCredentials, encryptCredentials } from '../secrets';
import { acquireRefreshLease } from '../refreshLease';
import {
  TYPEFORM_READ_SCOPES, TypeformError, exchangeTypeformCode, refreshTypeformToken, regionOf, typeformAuthorizeUrl,
  type TypeformRegion,
} from '../typeformOAuth';

export const TYPEFORM_KEY = 'typeform';

export function redirectUri(env: Env): string {
  return oauthCallbackUrl(env, TYPEFORM_KEY);
}

const unavailable = () => new ConnectRefusal(503, 'typeform_unavailable', 'Typeform is not available yet.');

async function appCredentials(env: Env) {
  const app = await loadOauthCreds(env, TYPEFORM_KEY);
  if (!app) throw unavailable();
  return app;
}

async function approvedApp(env: Env) {
  if (env.TYPEFORM_APP_APPROVED !== '1') throw unavailable();
  return appCredentials(env);
}

/** Typeform writes scopes space-separated; a token answer without `scope` reports none. */
const scopesOf = (scope: string | null) => (scope ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/**
 * `region` is where this connection's requests go. `recordedRegion` is the
 * data center actually stored with the grant (`us` or `eu`), or null when
 * the credentials carry none: the response importer (D5828 part 2) reads
 * only this one and never falls back to US.
 */
export interface TypeformSession { region: TypeformRegion; recordedRegion: TypeformRegion | null; accessToken: string }
const recorded = (value: unknown): TypeformRegion | null => (value === 'us' || value === 'eu' ? value : null);

/**
 * A current access token for this connection and its region. Typeform rotates
 * the refresh token on each refresh, so a refresh runs behind the lease and
 * re-reads the stored credentials inside it: a second caller sees the rotated
 * token, never the spent one.
 */
export async function typeformSession(env: Env, row: Pick<IntegrationRow, 'id' | 'uid'>): Promise<TypeformSession> {
  const read = async () => {
    const current = await env.DB.prepare("SELECT credentials_enc FROM integrations WHERE id = ? AND status = 'active'")
      .bind(row.id).first<{ credentials_enc: string }>();
    if (!current) throw new TypeformError('typeform_not_connected');
    const credentials = await decryptCredentials(env, row.uid, current.credentials_enc);
    if (!credentials?.access_token) throw new TypeformError('typeform_connection_unreadable');
    return credentials;
  };
  const fresh = (cr: Record<string, unknown>) => typeof cr.expires_at === 'number' && cr.expires_at > Date.now() + 60_000;
  const first = await read();
  if (fresh(first)) return { region: regionOf(first.region), recordedRegion: recorded(first.region), accessToken: String(first.access_token) };
  const lease = await acquireRefreshLease(env, TYPEFORM_KEY, row.uid);
  if (!lease.acquired) throw new TypeformError('typeform_refresh_busy');
  try {
    const credentials = await read();
    const region = regionOf(credentials.region);
    // Another caller refreshed while this one waited for the lease.
    if (fresh(credentials)) return { region, recordedRegion: recorded(credentials.region), accessToken: String(credentials.access_token) };
    if (!credentials.refresh_token) throw new TypeformError('typeform_grant_revoked');
    const tokens = await refreshTypeformToken(region, await appCredentials(env), String(credentials.refresh_token));
    const granted = scopesOf(tokens.scope);
    if (granted.length > 0 && granted.some((s) => !(TYPEFORM_READ_SCOPES as readonly string[]).includes(s))) {
      throw new TypeformError('typeform_grant_changed');
    }
    const next = await encryptCredentials(env, row.uid, {
      ...credentials,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? credentials.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').bind(next, row.id).run();
    return { region, recordedRegion: recorded(credentials.region), accessToken: tokens.access_token };
  } finally {
    await lease.release();
  }
}

const provider: ProviderImpl = {
  key: TYPEFORM_KEY,
  async ready(env) {
    return env.TYPEFORM_APP_APPROVED === '1' ? oauthCredsReady(env, TYPEFORM_KEY) : false;
  },
  async buildAuthorizeUrl(c, _user, state) {
    const app = await approvedApp(c.env);
    // The same query the start route stored in the signed state (`typeform_region`).
    return typeformAuthorizeUrl(regionOf(c.req.query('region')), app.id, redirectUri(c.env), state);
  },
  async connect(c, _user, input) {
    if (!input.oauth_code) throw new ConnectRefusal(400, 'typeform_code_required', 'Start the Typeform sign-in first.');
    // Never the callback's query string: the region the start signed into the state.
    const region = regionOf(input.config?.typeform_region);
    const tokens = await exchangeTypeformCode(region, await approvedApp(c.env), input.oauth_code, redirectUri(c.env));
    if (!tokens.refresh_token) {
      throw new ConnectRefusal(502, 'typeform_offline_refused', 'Typeform did not grant lasting access. Try signing in again.');
    }
    return {
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        region,
        expires_at: Date.now() + tokens.expires_in * 1000,
      },
      scopes: scopesOf(tokens.scope),
      external_account_name: region === 'eu' ? 'Typeform (EU data center)' : 'Typeform (US data center)',
    };
  },
  async disconnect(c, _user, row) {
    // Typeform documents no token revocation endpoint (UNVERIFIED, D5827): the
    // grant is deleted here, and the member removes the app at Typeform.
    await c.env.DB.prepare('DELETE FROM typeform_form_bindings WHERE integration_id = ?').bind(row.id).run();
  },
};

registerProvider(provider);
