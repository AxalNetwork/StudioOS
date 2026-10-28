/**
 * D1343 (#3551, part 4 of #3547): a member's own MCP mail server as a
 * mailbox. A D852 custom connector against the fake notes server, with a send
 * tool added; the custom connector and mail routes mounted.
 *
 *   · the send tool is designated on the connector, pinned to its schema; a
 *     destructive tool, a read tool, or one without { to, subject, body } is refused;
 *   · the mailbox is chosen as a `mail_accounts` row with provider `mcp`, verified, nothing sent;
 *   · every send still needs the composer's confirmation nonce: without it the
 *     tool is never called;
 *   · an unapproved send tool (never designated, withdrawn, or changed since)
 *     is refused before the tool is called;
 *   · the designated tool is never callable as a read tool, nor without the ticket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import custom, { CSRF_COOKIE, customDepsFor } from '../src/routes/connectors_custom.ts';
import mailAccounts from '../src/routes/mail_accounts.ts';
import { callCustomTool, CustomMcpError, customRowFor, mailSendShape } from '../src/integrations/customMcp.ts';
import { mcpMailDeps } from '../src/services/mail/adapters/memberMcp.ts';
import { personalFixture } from './_mercury_personal_d713.ts';
import { NOTES_MCP, defaultNotesTools, notesFake } from './_mcp_fake.mjs';

const SEND = 'send_email';
const SEND_SCHEMA = { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] };
const TOOLS = () => [
  ...defaultNotesTools(),
  { name: SEND, inputSchema: SEND_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'post_anything', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: false } },
  // A read tool shaped like a send: approvable as a read tool, never as the send tool.
  { name: 'preview_email', inputSchema: SEND_SCHEMA, annotations: { readOnlyHint: true } },
];

const app = new Hono<any>();
app.route('/api/connectors/custom', custom);
app.route('/api/mail', mailAccounts);
app.onError((e: any, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] || 500));

const ROLES: Record<number, string> = { 10: 'founder', 20: 'partner', 30: 'investor', 1: 'admin' };
const PUBLIC = '93.184.216.34';

function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

async function setup(opts: { flag?: string | null; dns?: Record<string, string[]>; tools?: any[] } = {}) {
  const { db, env } = await personalFixture();
  db.exec('CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT)');
  env.RATE_LIMITS = memoryKv();
  if (opts.flag !== null) env.CUSTOM_MCP_ENABLED = opts.flag ?? 'true';
  const fake = notesFake({ tools: opts.tools ?? TOOLS(), answer: (name: string, args: any) => (name === SEND ? { id: 'synthetic-message-1', echoed: args } : { tool: name, arguments: args }) });
  const dns: Record<string, string[]> = { 'mcp.notes.example': [PUBLIC], 'auth.notes.example': [PUBLIC], ...opts.dns };
  const lookups: string[] = [];
  const resolve = async (host: string) => { lookups.push(host); if (!(host in dns)) throw new Error('nxdomain'); return dns[host]; };
  customDepsFor.current = () => ({ resolve, fetcher: fake.fetch, log: () => {} });
  mcpMailDeps.current = () => ({ resolve, fetcher: fake.fetch, log: () => {} });
  db.exec(readFileSync('cloudflare-worker/sql/migrations/647_mail_accounts.sql', 'utf8'));
  env.KEK_PII = 'synthetic-kek-d1343-'.repeat(3);
  return { db, env, fake, dns, lookups };
}

async function req(env: any, who: number, path: string, opts: { method?: string; cookie?: string; body?: unknown; impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: who, role: ROLES[who], ...(opts.impersonated ? { impersonated_by: 1 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await app.request(path, { method: opts.method ?? 'GET', headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) }, env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a redirect */ }
  return { status: res.status, body, text, location: res.headers.get('Location'), setCookie: res.headers.get('Set-Cookie') };
}

/** The member's browser: configure, the server's consent, and the callback with the cookie. */
async function connect(env: any, fake: any, url = NOTES_MCP) {
  const start = await req(env, 10, '/api/connectors/custom/start', { method: 'POST', body: { url } });
  assert.equal(start.status, 200, start.text);
  const p = Object.fromEntries(new URL(start.body.authorize_url).searchParams);
  const cookie = /__Host-axal_custom_mcp=([^;]+)/.exec(start.setCookie || '')![1];
  const { code } = fake.authorize({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge });
  const cb = await req(env, 10, `/api/connectors/custom/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(p.state)}`, { cookie: `${CSRF_COOKIE}=${cookie}` });
  return { start, params: p, cb, uid: start.body.uid as string };
}

const sends = (fake: any) => fake.calls.filter((c: any) => c.tool === SEND).length;

/** Connected, with the send tool designated: the mailbox can be chosen. */
async function ready(opts: { tools?: any[] } = {}) {
  const s = await setup(opts);
  const { uid } = await connect(s.env, s.fake);
  return { ...s, uid };
}
async function chooseMailbox(env: any, uid: string) {
  return req(env, 10, '/api/mail/accounts/mcp', { method: 'POST', body: { connection_uid: uid, address: 'Member@Example.invalid', display_name: 'Synthetic Member' } });
}
async function sendOne(env: any, accountUid: string, withNonce = true) {
  const nonce = withNonce ? (await req(env, 10, '/api/mail/send/confirm', { method: 'POST', body: { account_uid: accountUid } })).body.nonce : undefined;
  return req(env, 10, '/api/mail/send', { method: 'POST', body: { account_uid: accountUid, to: 'Someone@Example.invalid', subject: 'Synthetic hello', body: 'Synthetic body.', nonce } });
}

test('a send tool takes { to, subject, body }, each a string, and nothing else required', () => {
  assert.equal(mailSendShape(SEND_SCHEMA), true);
  assert.equal(mailSendShape({ type: 'object', properties: { ...SEND_SCHEMA.properties, cc: { type: 'string' } }, required: ['to'] }), true, 'an optional extra is fine');
  assert.equal(mailSendShape({ type: 'object', properties: { ...SEND_SCHEMA.properties, cc: { type: 'string' } }, required: ['cc'] }), false, 'a required extra is not');
  assert.equal(mailSendShape({ type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' } } }), false);
  assert.equal(mailSendShape({ type: 'object', properties: { ...SEND_SCHEMA.properties, body: { type: 'object' } } }), false);
  assert.equal(mailSendShape(null), false);
});

test('the send tool is designated on the connector, pinned; a destructive tool, a read tool or the wrong shape is refused', async () => {
  const { env, uid } = await ready();
  for (const [name, code] of [['delete_all_notes', 'custom_mcp_tool_destructive'], ['post_anything', 'custom_mcp_tool_shape'], ['missing', 'custom_mcp_tool_not_listed']] as const) {
    const r = await req(env, 10, `/api/connectors/custom/${uid}/tools/${name}/mail-send`, { method: 'POST' });
    assert.equal(r.body?.error, code, name);
  }
  assert.equal((await req(env, 10, `/api/connectors/custom/${uid}/tools/preview_email/approve`, { method: 'POST' })).status, 200);
  // Mutation checked: drop the read-tool check → an approved read tool, shaped like a send, becomes the send tool.
  assert.equal((await req(env, 10, `/api/connectors/custom/${uid}/tools/preview_email/mail-send`, { method: 'POST' })).body?.error, 'custom_mcp_tool_shape', 'an approved read tool is never the send tool');
  const ok = await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' });
  assert.deepEqual(ok.body, { ok: true, mail_send: SEND });
  const listed = (await req(env, 10, `/api/connectors/custom/${uid}/tools`)).body.tools.find((t: any) => t.name === SEND);
  assert.deepEqual([listed.mail_send, listed.mail_send_changed, listed.approved, listed.read_only], [true, false, false, false]);
  // Another member's connector: 404, as none.
  assert.equal((await req(env, 1, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' })).status, 404);
});

test('the mailbox is chosen, verified with nothing sent; every send needs the nonce, and goes through the designated tool once', async () => {
  const { env, fake, uid } = await ready();
  // Mutation checked: drop the designation check → a mailbox with no send tool.
  const early = await chooseMailbox(env, uid);
  assert.deepEqual([early.status, early.body?.error], [409, 'send_tool_not_approved']);
  await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' });
  const chosen = await chooseMailbox(env, uid);
  assert.equal(chosen.status, 201, chosen.text);
  assert.deepEqual([chosen.body.account.provider, chosen.body.account.address, chosen.body.account.status], ['mcp', 'member@example.invalid', 'active']);
  assert.equal(sends(fake), 0, 'choosing it sends nothing');
  assert.doesNotMatch(chosen.text, /fake-(access|refresh)/, 'no credential in the reply');
  const account = chosen.body.account.uid;
  // Mutation checked: skip the nonce → the tool is called without the composer's press.
  const bare = await sendOne(env, account, false);
  assert.deepEqual([bare.status, bare.body?.error], [403, 'confirmation_required']);
  assert.equal(sends(fake), 0, 'no nonce, no tool call');
  const sent = await sendOne(env, account);
  assert.equal(sent.status, 201, sent.text);
  assert.equal(sent.body.sent.provider_message_id, 'synthetic-message-1');
  assert.equal(sends(fake), 1);
  const call = fake.calls.find((c: any) => c.tool === SEND);
  assert.ok(call, 'the designated tool was called');
  // Another member cannot choose this connector.
  const other = await req(env, 1, '/api/mail/accounts/mcp', { method: 'POST', body: { connection_uid: uid, address: 'x@example.invalid' } });
  assert.equal(other.status, 404);
});

test('an unapproved send tool is refused before it is called: withdrawn, or changed since it was approved', async () => {
  const { env, fake, uid, db } = await ready();
  await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' });
  const account = (await chooseMailbox(env, uid)).body.account.uid;
  // Changed since: the server's schema moved. Mutation checked: drop the pin → the changed tool is called.
  fake.state.tools = fake.state.tools.map((t: any) => (t.name === SEND ? { ...t, inputSchema: { ...SEND_SCHEMA, properties: { ...SEND_SCHEMA.properties, bcc: { type: 'string' } } } } : t));
  const changed = await sendOne(env, account);
  assert.deepEqual([changed.status, changed.body?.error], [409, 'mailbox_expired']);
  assert.equal(sends(fake), 0, 'a changed tool is never called');
  assert.equal(db.prepare('SELECT status FROM mail_accounts WHERE uid = ?').get(account).status, 'expired');
  // Approved again, then withdrawn.
  fake.state.tools = TOOLS();
  await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' });
  db.prepare("UPDATE mail_accounts SET status = 'active' WHERE uid = ?").run(account);
  assert.equal((await sendOne(env, account)).status, 201);
  assert.equal((await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'DELETE' })).status, 200);
  const withdrawn = await sendOne(env, account);
  assert.deepEqual([withdrawn.status, withdrawn.body?.error], [409, 'mailbox_expired']);
  assert.equal(sends(fake), 1, 'only the approved send went out');
});

test('the designated tool is never callable as a read tool, nor through the session without the ticket', async () => {
  const { env, fake, uid } = await ready();
  await req(env, 10, `/api/connectors/custom/${uid}/tools/${SEND}/mail-send`, { method: 'POST' });
  const row = await customRowFor(env, 10, uid);
  // Mutation checked: list the send tool among the read tools → callCustomTool sends.
  await assert.rejects(callCustomTool(env, row!, SEND, { to: 'a@example.invalid', subject: 's', body: 'b' }, customDepsFor.current({} as any)),
    (e: any) => e instanceof CustomMcpError && e.code === 'tool_not_approved');
  assert.equal(sends(fake), 0);
});
