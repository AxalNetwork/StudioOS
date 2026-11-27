/** Read-only OAuth request construction for the managed TikTok web app (#5291). */
export const TIKTOK_READ_SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'] as const;
const API = 'https://open.tiktokapis.com';
const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';

export interface TikTokApp {
  id: string;
  secret: string;
}

interface TikTokTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
}

async function oauthPost(app: TikTokApp, endpoint: 'token' | 'revoke', fields: Record<string, string>) {
  const response = await fetch(`${API}/v2/oauth/${endpoint}/`, {
    method: 'POST',
    body: new URLSearchParams({ ...fields, client_key: app.id, client_secret: app.secret }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tiktok_${endpoint}_failed`);
  return response;
}

async function requestTokens(app: TikTokApp, fields: Record<string, string>): Promise<TikTokTokens> {
  const response = await oauthPost(app, 'token', fields);
  const data = await response.json() as Partial<TikTokTokens> | null;
  if (!data ||
      ![data.access_token, data.refresh_token, data.open_id, data.scope]
        .every(value => typeof value === 'string' && value.length > 0) ||
      ![data.expires_in, data.refresh_expires_in]
        .every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
    throw new Error('tiktok_token_invalid');
  }
  return data as TikTokTokens;
}

export function exchangeTikTokCode(app: TikTokApp, code: string, redirectUri: string) {
  return requestTokens(app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refreshTikTokToken(app: TikTokApp, refreshToken: string) {
  return requestTokens(app, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function revokeTikTokToken(app: TikTokApp, accessToken: string): Promise<void> {
  await oauthPost(app, 'revoke', { token: accessToken });
}

export function tiktokAuthorizeUrl(clientKey: string, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: TIKTOK_READ_SCOPES.join(','),
  }).toString();
  return url.toString();
}
