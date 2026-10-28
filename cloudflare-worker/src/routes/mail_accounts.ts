/**
 * D1340 (#3548, part 1 of #3547) — the member's own mailboxes and the send,
 * mounted at `/api/mail`. Mail always goes from the member's own mailbox,
 * never Axal's house token (`services/email.ts` stays for system mail).
 *
 *   GET    /accounts                       the member's mailboxes (never a credential) and the providers offered
 *   POST   /accounts/start/:provider       outlook | gmail → { authorize_url }; Gmail only behind MAIL_GMAIL_ENABLED
 *   GET    /accounts/oauth/callback        the provider's redirect: the one-use state, the code, the sealed refresh token
 *   POST   /accounts/imap                  verify (SMTP AUTH, IMAP LOGIN; nothing sent), then store. Port 25 is refused
 *   POST   /accounts/mcp                   D1343: { connection_uid, address, display_name? } a member's own MCP mail server
 *                                          (a D852 custom connector with an approved send tool); verified, nothing sent
 *   POST   /accounts/:uid/verify           checks the mailbox again; an expired token turns the row `expired`
 *   DELETE /accounts/:uid                  revoke at the provider where it can, forget the credentials; sent rows stay
 *   POST   /send/confirm                   { account_uid } → a one-use nonce for the composer's pressed Send
 *   POST   /send                           { account_uid, to, subject, body, draft_uid?, nonce } → one `mail_sent` row
 *
 * Another member's uid is 404, as one that does not exist. A support session
 * is refused: mail goes out in the member's own name. Rate limited per member.
 * Nothing credential-shaped is logged; a refusal is our sentence, never the
 * provider's text.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { ADAPTERS } from '../services/mail/adapters';
import { checkSettings } from '../services/mail/adapters/imap';
import { headerSafe } from '../services/mail/adapters/mime';
import { authorizeUrl, configured, exchangeCode, gmailEnabled, OUTLOOK_READ_SCOPE, type OAuthProvider } from '../services/mail/adapters/oauth';
import { AdapterError } from '../services/mail/adapters/types';
import {
  accountOf, accountView, forget, issueNonce, listAccounts, markError, markExpired, markUsed, openCreds, saveAccount,
  spendOauthState, spendSendNonce, type AccountRow,
} from '../services/mail/accounts';
import { indexHmac } from '../services/columnCipher';
import { configOf, customMcpEnabled, customRowFor, isConnectionUid } from '../integrations/customMcp';
import { refuse } from '../util/refusal';

const mailAccounts = new Hono<{ Bindings: Env }>();

export const SENDS_PER_HOUR = 20;
const EMAIL = /^[^\s@<>()",;:\\[\]]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const NOT_FOUND = 'Mailbox not found.';

async function member(c: Context<{ Bindings: Env }>): Promise<User | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot use a member’s mailbox.' });
  }
  return user;
}

const body = async (c: Context<any>): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

const redirectUri = (c: Context<{ Bindings: Env }>) => c.env.MAIL_OAUTH_REDIRECT_URI || `${new URL(c.req.url).origin}/api/mail/accounts/oauth/callback`;

function adapterRefusal(c: Context<any>, e: unknown): Response {
  if (e instanceof AdapterError) {
    const status = e.code === 'expired' ? 409 : e.code === 'unconfigured' ? 503 : e.code === 'unreachable' ? 502 : 400;
    return refuse(c, status, { code: `mailbox_${e.code}`, message: e.sentence });
  }
  return refuse(c, 503, { code: 'mailbox_unreadable', message: 'The mailbox could not be used. Try again.', raw: e instanceof Error ? e.name : 'error' });
}

/** Records what a use of the mailbox did to it: rotated credentials, or the provider's demand to reconnect. */
async function afterUse(env: Env, row: AccountRow, e: unknown) {
  if (e instanceof AdapterError && e.code === 'expired') await markExpired(env, row, e.sentence);
  else if (e instanceof AdapterError) await markError(env, row, e.sentence);
}

mailAccounts.get('/accounts', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  return c.json({
    accounts: await listAccounts(c.env, user),
    // D1343: `mcp` is offered where custom connectors are (a member's own MCP mail server).
    providers: { outlook: configured(c.env, 'outlook'), gmail: configured(c.env, 'gmail'), imap: true, mcp: customMcpEnabled(c.env) },
  });
});

mailAccounts.post('/accounts/start/:provider', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const p = c.req.param('provider');
  if (p !== 'outlook' && p !== 'gmail') return refuse(c, 404, { code: 'provider_unknown', message: 'That mailbox provider is not offered.' });
  if (p === 'gmail' && !gmailEnabled(c.env)) return refuse(c, 409, { code: 'gmail_not_offered', message: 'Gmail mailboxes are not offered yet. Connect Outlook, or any mailbox by IMAP and SMTP.' });
  const b = await body(c);
  try {
    const { nonce } = await issueNonce(c.env, user, 'oauth', b.read === true && p === 'outlook' ? 'outlook+read' : p);
    return c.json({ authorize_url: authorizeUrl(c.env, p as OAuthProvider, nonce, redirectUri(c), b.read === true) });
  } catch (e) { return adapterRefusal(c, e); }
});

// The provider's redirect: no Authorization header, so the one-use state is the authority.
mailAccounts.get('/accounts/oauth/callback', async (c) => {
  const back = (status: string) => c.redirect(`/connectors?mail=${status}`, 302);
  const spent = await spendOauthState(c.env, c.req.query('state'));
  if (!spent) return back('expired');
  const code = c.req.query('code');
  if (!code || c.req.query('error')) return back('declined');
  const provider = spent.provider.startsWith('outlook') ? 'outlook' : spent.provider === 'gmail' ? 'gmail' : null;
  if (!provider || (provider === 'gmail' && !gmailEnabled(c.env))) return back('failed');
  try {
    const got = await exchangeCode(c.env, provider, code, redirectUri(c));
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(spent.user_id).first<User>();
    if (!user) return back('failed');
    await saveAccount(c.env, user, {
      provider, address: got.address, display_name: got.name, scopes: got.scopes,
      can_read: provider === 'outlook' && got.scopes.split(/\s+/).some((s) => s.endsWith(OUTLOOK_READ_SCOPE)), creds: got.creds,
    });
    return back('connected');
  } catch (e) {
    console.warn('[mail] oauth callback failed:', e instanceof AdapterError ? e.code : 'error');
    return back('failed');
  }
});

mailAccounts.post('/accounts/imap', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const b = await body(c);
  const address = String(b.address ?? '').trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 320) return refuse(c, 400, { code: 'address_invalid', message: 'Give the mailbox’s email address.' });
  const name = typeof b.display_name === 'string' && b.display_name.trim() && headerSafe(b.display_name) ? b.display_name.trim().slice(0, 120) : null;
  try {
    const creds = checkSettings(b as any);
    await ADAPTERS.imap!.verify(c.env, creds);
    const account = await saveAccount(c.env, user, { provider: 'imap', address, display_name: name, scopes: '', can_read: false, creds });
    return c.json({ account }, 201);
  } catch (e) { return adapterRefusal(c, e); }
});

// D1343 (#3551): a member's own MCP mail server, chosen as a mailbox. Its send tool is the one the
// member approved on the connector (D852), pinned to its schema; every send still spends the composer's nonce.
mailAccounts.post('/accounts/mcp', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  if (!customMcpEnabled(c.env)) return refuse(c, 404, { code: 'provider_unknown', message: 'That mailbox provider is not offered.' });
  const b = await body(c);
  const address = String(b.address ?? '').trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 320) return refuse(c, 400, { code: 'address_invalid', message: 'Give the address your mail server sends from.' });
  const name = typeof b.display_name === 'string' && b.display_name.trim() && headerSafe(b.display_name) ? b.display_name.trim().slice(0, 120) : null;
  const uid = String(b.connection_uid ?? '');
  // Another member's connector is the same 404 as none.
  const row = isConnectionUid(uid) ? await customRowFor(c.env, user.id, uid) : null;
  if (!row) return refuse(c, 404, { code: 'connector_not_found', message: 'That connector was not found.' });
  if (!configOf(row)?.mail_send) return refuse(c, 409, { code: 'send_tool_not_approved', message: 'Choose the tool that sends your email on that connector first.' });
  const creds = { kind: 'mcp' as const, connection_uid: uid, user_id: Number(user.id) };
  try {
    await ADAPTERS.mcp!.verify(c.env, creds);
    const account = await saveAccount(c.env, user, { provider: 'mcp', address, display_name: name, scopes: '', can_read: false, creds });
    return c.json({ account }, 201);
  } catch (e) { return adapterRefusal(c, e); }
});

mailAccounts.post('/accounts/:uid/verify', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const row = await accountOf(c.env, user, c.req.param('uid'));
  if (!row) return refuse(c, 404, { code: 'not_found', message: NOT_FOUND });
  const adapter = ADAPTERS[row.provider];
  const creds = await openCreds(c.env, row);
  if (!adapter || !creds) {
    await markExpired(c.env, row, 'The mailbox’s saved access could not be opened. Connect it again.');
  } else {
    try { await markUsed(c.env, row, (await adapter.verify(c.env, creds)).creds); }
    catch (e) { await afterUse(c.env, row, e); }
  }
  return c.json({ account: accountView((await c.env.DB.prepare('SELECT * FROM mail_accounts WHERE id = ?').bind(row.id).first<AccountRow>())!) });
});

mailAccounts.delete('/accounts/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const row = await accountOf(c.env, user, c.req.param('uid'));
  if (!row) return refuse(c, 404, { code: 'not_found', message: NOT_FOUND });
  const creds = await openCreds(c.env, row);
  // Revoked at the provider where it can be; forgotten here either way.
  if (creds) { try { await ADAPTERS[row.provider]?.revoke(c.env, creds); } catch { /* forgotten below */ } }
  await forget(c.env, row);
  return c.json({ ok: true });
});

mailAccounts.post('/send/confirm', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const b = await body(c);
  if (!await accountOf(c.env, user, b.account_uid)) return refuse(c, 404, { code: 'not_found', message: NOT_FOUND });
  return c.json(await issueNonce(c.env, user, 'send'));
});

/** The refs a draft quoted (D1341), the member's own draft only. Null when there is no such draft. */
async function draftRefs(env: Env, user: User, uid: string): Promise<string[] | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  const row = await env.DB.prepare('SELECT refs_json FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(uid, user.id)
    .first<{ refs_json: string }>().catch(() => null);
  if (!row) return null;
  try { const refs = JSON.parse(row.refs_json); return Array.isArray(refs) ? refs.map((r: any) => String(r?.ref ?? '')).filter(Boolean) : []; } catch { return []; }
}

mailAccounts.post('/send', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const b = await body(c);
  const row = await accountOf(c.env, user, b.account_uid);
  if (!row) return refuse(c, 404, { code: 'not_found', message: NOT_FOUND });
  const to = String(b.to ?? '').trim().toLowerCase();
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  const text = typeof b.body === 'string' ? b.body : '';
  if (!EMAIL.test(to) || to.length > 320) return refuse(c, 400, { code: 'to_invalid', message: 'Give one recipient email address.' });
  if (!subject || subject.length > 200 || !headerSafe(subject)) return refuse(c, 400, { code: 'subject_invalid', message: 'Give a subject on one line, under 200 characters.' });
  if (!text.trim() || text.length > 20000) return refuse(c, 400, { code: 'body_invalid', message: 'Write the email before sending it.' });
  if (row.status !== 'active') return refuse(c, 409, { code: 'mailbox_expired', message: row.last_error || 'Reconnect this mailbox before sending from it.' });
  let refs: string[] = [];
  const draftUid = b.draft_uid == null || b.draft_uid === '' ? null : String(b.draft_uid);
  if (draftUid) {
    const got = await draftRefs(c.env, user, draftUid);
    if (!got) return refuse(c, 404, { code: 'draft_not_found', message: 'Draft not found.' });
    refs = got;
  }
  const since = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const sent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM mail_sent WHERE user_id = ? AND created_at > ?').bind(user.id, since).first<{ n: number }>();
  if (Number(sent?.n ?? 0) >= SENDS_PER_HOUR) return refuse(c, 429, { code: 'send_rate_limited', message: `You have sent ${SENDS_PER_HOUR} emails in the last hour. Try again later.` });
  // The composer's pressed Send: a one-use nonce, spent before anything goes out.
  if (!await spendSendNonce(c.env, user, b.nonce)) return refuse(c, 403, { code: 'confirmation_required', message: 'Press Send in the composer to send this email.' });

  const adapter = ADAPTERS[row.provider];
  const creds = await openCreds(c.env, row);
  const uid = crypto.randomUUID().replace(/-/g, '');
  const hash = await indexHmac(c.env, 'mail_sent', 'recipient', to);
  const log = (messageId: string | null, error: string | null) => c.env.DB.prepare(
    `INSERT INTO mail_sent (uid, user_id, account_id, recipient, recipient_hash, subject, provider_message_id, draft_uid, refs_json, sent_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, user.id, row.id, to, hash, subject, messageId, draftUid, JSON.stringify(refs), error ? null : new Date().toISOString(), error).run();
  if (!adapter || !creds) {
    const sentence = 'The mailbox’s saved access could not be opened. Connect it again.';
    await markExpired(c.env, row, sentence);
    await log(null, sentence);
    return refuse(c, 409, { code: 'mailbox_expired', message: sentence });
  }
  try {
    const out = await adapter.send(c.env, creds, { from: row.address, fromName: row.display_name, to, subject, body: text });
    await markUsed(c.env, row, out.creds);
    await log(out.messageId, null);
    return c.json({ sent: { uid, account_uid: row.uid, to, subject, provider_message_id: out.messageId, draft_uid: draftUid, refs } }, 201);
  } catch (e) {
    await afterUse(c.env, row, e);
    await log(null, e instanceof AdapterError ? e.sentence : 'The email could not be sent.');
    return adapterRefusal(c, e);
  }
});

export default mailAccounts;
