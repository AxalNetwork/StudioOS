/**
 * D1340 (#3548) — the two OAuth mailboxes: Outlook through Microsoft Graph,
 * and Gmail behind `MAIL_GMAIL_ENABLED` (#3547 Q1).
 *
 * OUTLOOK. Its own consent, `Mail.Send offline_access User.Read` (plus
 * `Mail.Read` only when the member asks to read replies). Microsoft rotates the
 * refresh token on each use, so every use hands the new one back to be sealed.
 * Microsoft has no call that revokes one app's refresh token, so a disconnect
 * forgets it here (`revoke` is a no-op) and says so (D1340 §4).
 *
 * GMAIL. A separate OAuth client, never the sign-in token and never the house
 * token (`GMAIL_CLIENT_ID`, `services/email.ts`): `MAIL_GMAIL_CLIENT_ID`. Its
 * scope is `gmail.send`, with `openid email` so the address can be read from
 * the token response: `gmail.send` alone cannot read the profile. Revoked at
 * Google on disconnect.
 *
 * A refresh the provider answers `invalid_grant` is `expired`, in a sentence;
 * any other failure is `unreachable`. Nothing a provider says is passed on.
 */
import type { Env } from '../../../types';
import { buildMime, b64url } from './mime';
import { AdapterError, type Creds, type MailAdapter, type OAuthCreds, type Outgoing } from './types';

export type OAuthProvider = 'outlook' | 'gmail';

const MS_AUTHORITY = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const OUTLOOK_SCOPES = ['Mail.Send', 'offline_access', 'User.Read'] as const;
export const OUTLOOK_READ_SCOPE = 'Mail.Read';
export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'] as const;

const NAME: Record<OAuthProvider, string> = { outlook: 'Outlook', gmail: 'Gmail' };
const expired = (p: OAuthProvider) => new AdapterError('expired', `${NAME[p]} asked for the mailbox to be connected again. Reconnect it to send.`);
const unreachable = (p: OAuthProvider) => new AdapterError('unreachable', `${NAME[p]} could not be reached. Try again.`);

export const gmailEnabled = (env: Env) => String(env.MAIL_GMAIL_ENABLED ?? '').toLowerCase() === 'true';
const msTenant = (env: Env) => env.MICROSOFT_TENANT_ID || 'common';

function client(env: Env, p: OAuthProvider): { id: string; secret: string } | null {
  const id = p === 'outlook' ? env.MAIL_MICROSOFT_CLIENT_ID || env.MICROSOFT_CLIENT_ID : env.MAIL_GMAIL_CLIENT_ID;
  const secret = p === 'outlook' ? env.MAIL_MICROSOFT_CLIENT_SECRET || env.MICROSOFT_CLIENT_SECRET : env.MAIL_GMAIL_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}
export const configured = (env: Env, p: OAuthProvider) => !!client(env, p) && (p === 'outlook' || gmailEnabled(env));

function need(env: Env, p: OAuthProvider) {
  const c = client(env, p);
  if (!c) throw new AdapterError('unconfigured', `${NAME[p]} is not set up for mailboxes yet.`);
  return c;
}

export function authorizeUrl(env: Env, p: OAuthProvider, state: string, redirectUri: string, read = false): string {
  const c = need(env, p);
  if (p === 'outlook') {
    const scope = [...OUTLOOK_SCOPES, ...(read ? [OUTLOOK_READ_SCOPE] : [])].join(' ');
    return `${MS_AUTHORITY}/${msTenant(env)}/oauth2/v2.0/authorize?${new URLSearchParams({
      client_id: c.id, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope, state, prompt: 'select_account',
    })}`;
  }
  return `${GOOGLE_AUTH}?${new URLSearchParams({
    client_id: c.id, response_type: 'code', redirect_uri: redirectUri, scope: GMAIL_SCOPES.join(' '), state,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
  })}`;
}

type Token = { access_token: string; refresh_token?: string; scope?: string; id_token?: string };

async function token(env: Env, p: OAuthProvider, body: Record<string, string>): Promise<Token> {
  const c = need(env, p);
  const url = p === 'outlook' ? `${MS_AUTHORITY}/${msTenant(env)}/oauth2/v2.0/token` : GOOGLE_TOKEN;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...body }) });
  } catch { throw unreachable(p); }
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    if (json?.error === 'invalid_grant') throw expired(p);
    throw unreachable(p);
  }
  return json as Token;
}

/** The code's tokens, the address they belong to and the scopes granted. */
export async function exchangeCode(env: Env, p: OAuthProvider, code: string, redirectUri: string) {
  const t = await token(env, p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!t.refresh_token) throw new AdapterError('refused', `${NAME[p]} gave no lasting access. Connect the mailbox again and allow offline access.`);
  let address: string | null = null;
  let name: string | null = null;
  if (p === 'outlook') {
    const me: any = await graph(t.access_token, '/me?$select=mail,userPrincipalName,displayName').catch(() => null);
    address = me?.mail || me?.userPrincipalName || null;
    name = me?.displayName || null;
  } else {
    // The id_token came straight from Google's token endpoint over TLS (OIDC code flow): its claims need no second check.
    try { address = JSON.parse(atob(String(t.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null; } catch { address = null; }
  }
  if (!address) throw new AdapterError('refused', `${NAME[p]} did not say which address this mailbox is.`);
  return { creds: { kind: 'oauth', refresh_token: t.refresh_token } as OAuthCreds, address: String(address).toLowerCase(), name, scopes: t.scope ?? '' };
}

async function refreshed(env: Env, p: OAuthProvider, creds: Creds): Promise<{ access: string; creds: OAuthCreds }> {
  if (creds.kind !== 'oauth') throw new AdapterError('refused', 'These are not OAuth credentials.');
  const body: Record<string, string> = { grant_type: 'refresh_token', refresh_token: creds.refresh_token };
  if (p === 'outlook') body.scope = OUTLOOK_SCOPES.join(' ');
  const t = await token(env, p, body);
  return { access: t.access_token, creds: { kind: 'oauth', refresh_token: t.refresh_token || creds.refresh_token } };
}

async function graph(access: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${GRAPH}${path}`, { ...init, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  if (res.status === 401) throw expired('outlook');
  if (!res.ok) throw unreachable('outlook');
  return res.status === 202 || res.status === 204 ? null : res.json();
}

export const outlookAdapter: MailAdapter = {
  async send(env, creds, msg: Outgoing) {
    const t = await refreshed(env, 'outlook', creds);
    // A draft first, then its send: `sendMail` alone returns no message id.
    const draft = await graph(t.access, '/me/messages', { method: 'POST', body: JSON.stringify({
      subject: msg.subject, body: { contentType: 'Text', content: msg.body }, toRecipients: [{ emailAddress: { address: msg.to } }],
    }) });
    await graph(t.access, `/me/messages/${encodeURIComponent(String(draft?.id))}/send`, { method: 'POST' });
    return { messageId: draft?.internetMessageId || draft?.id || null, creds: t.creds };
  },
  async verify(env, creds) {
    const t = await refreshed(env, 'outlook', creds);
    await graph(t.access, '/me?$select=id');
    return { creds: t.creds };
  },
  async revoke() { /* Microsoft has no per-app refresh-token revoke: the credentials are forgotten here. */ },
  async listThread(env, creds, threadId) {
    const t = await refreshed(env, 'outlook', creds);
    const filter = encodeURIComponent(`conversationId eq '${threadId.replace(/'/g, "''")}'`);
    const out = await graph(t.access, `/me/messages?$filter=${filter}&$select=from,subject,receivedDateTime,bodyPreview&$top=25`);
    return (out?.value || []).map((m: any) => ({ from: m.from?.emailAddress?.address ?? null, subject: m.subject ?? null, received_at: m.receivedDateTime ?? null, preview: m.bodyPreview ?? null }));
  },
};

export const gmailAdapter: MailAdapter = {
  async send(env, creds, msg) {
    const t = await refreshed(env, 'gmail', creds);
    const messageId = `${crypto.randomUUID()}@axal.vc`;
    let res: Response;
    try {
      res = await fetch(GMAIL_SEND, { method: 'POST', headers: { authorization: `Bearer ${t.access}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: b64url(buildMime(msg, messageId)) }) });
    } catch { throw unreachable('gmail'); }
    if (res.status === 401) throw expired('gmail');
    if (!res.ok) throw unreachable('gmail');
    const out: any = await res.json().catch(() => null);
    return { messageId: out?.id ?? messageId, creds: t.creds };
  },
  async verify(env, creds) {
    // `gmail.send` reads nothing, so a refresh that succeeds is the proof.
    return { creds: (await refreshed(env, 'gmail', creds)).creds };
  },
  async revoke(_env, creds) {
    if (creds.kind !== 'oauth') return;
    try { await fetch(`${GOOGLE_REVOKE}?${new URLSearchParams({ token: creds.refresh_token })}`, { method: 'POST' }); } catch { /* forgotten here either way */ }
  },
};
