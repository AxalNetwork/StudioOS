/**
 * D652 (#1464) — connectors in an Eadwyn conversation.
 *
 * The three things the issue asks the tests to prove:
 *   1. a disabled (or disconnected) connector is never read;
 *   2. a run cannot write: there is no execution path without confirm;
 *   3. confirm runs exactly the payload that was shown.
 * Plus the edges around them: cancel sends nothing and is logged, a second
 * confirm sends nothing, an old action cannot be sent, the switches are the
 * conversation's own and start off, and nothing here is someone else's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_connectors_d652.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { createJWT } from '../src/auth.ts';
import { registerProvider } from '../src/integrations/registry.ts';
// The tables exactly as migration 444 creates them: the test reads the file.
const EADWYN_SCHEMA_SQL = readFileSync(new URL('../sql/migrations/444_eadwyn_conversations.sql', import.meta.url), 'utf8');
import {
  readableConnectors,
  validateSend,
  canonicalPayload,
  payloadHash,
  parseModelReply,
  normaliseConnectorKeys,
  isExpired,
  attentionReason,
  CONNECTOR_READERS,
} from '../src/services/eadwynConnectors.ts';
import eadwyn, { readForRun } from '../src/routes/eadwyn.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, OTHER = 3, COMPANY = 41, FOUNDER = 9;

// The fake HubSpot: its `push` records every call, so "no push happened" is
// an observed fact rather than an absence of errors.
const pushes: unknown[] = [];
let pushThrows = false;
registerProvider({
  key: 'hubspot',
  connect: async () => ({ credentials: {} as any }),
  push: async (_c: unknown, _u: unknown, _row: unknown, payload: unknown) => {
    pushes.push(payload);
    if (pushThrows) throw new Error('hubspot said no');
    return { summary: 'Updated HubSpot company', external_id: 'hs-1', http_status: 200 };
  },
} as any);

/**
 * A real SQLite database: the AI budget fixture (users 1..100, the router's
 * tables), plus sessions, projects, deals, the integrations tables and the
 * three D652 tables from migration 444 itself.
 */
function world(opts: { reply?: string } = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET subscription_tier = 'studio', founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME}), ('jti-${OTHER}', ${OTHER});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    INSERT INTO projects VALUES (5, 'Mine', ${FOUNDER}, ${COMPANY}), (6, 'Not mine', 77, ${COMPANY}), (8, 'Other company', ${FOUNDER}, 999);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, project_id INTEGER);
    INSERT INTO deals VALUES (50, 5);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT,
      status TEXT, auth_type TEXT, credentials_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, webhook_secret_enc TEXT,
      last_synced_at TEXT, last_error TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, status, last_synced_at) VALUES
      (1, 'i1', ${ME}, 'hubspot', 'active', '2026-10-09 10:00:00'),
      (2, 'i2', ${ME}, 'stripe', 'active', '2026-10-09 11:00:00'),
      (3, 'i3', ${ME}, 'calendly', 'error', NULL),
      (4, 'i4', ${OTHER}, 'hubspot', 'active', NULL);
    CREATE TABLE integration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      provider_key TEXT NOT NULL, direction TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL,
      http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT, payload_json TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integration_waitlist (id INTEGER PRIMARY KEY);
    CREATE TABLE project_members (id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
    CREATE TABLE user_company_links (user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES (${ME}, ${COMPANY});
  `);
  db.exec(EADWYN_SCHEMA_SQL);
  const modelCalls: any[] = [];
  const env: any = {
    JWT_SECRET,
    DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        modelCalls.push(input);
        return { response: opts.reply ?? '{"answer":"Nothing here records that.","send":null}' };
      },
    },
  };
  return { env, db, modelCalls };
}

async function auth(env: any, id = ME, role = 'founder') {
  const token = await createJWT(env, id, `u${id}@example.test`, role, undefined, `jti-${id}`);
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-company-id': String(COMPANY) };
}

async function call(env: any, method: string, path: string, body?: unknown, id = ME) {
  const res = await eadwyn.request(path, { method, headers: await auth(env, id), body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

async function startConversation(env: any) {
  const r = await call(env, 'POST', '/conversations', { workspace: 'Build' });
  assert.equal(r.status, 201);
  return r.json.conversation.uid as string;
}

const SEND_REPLY = JSON.stringify({
  answer: 'I can send that company to HubSpot.',
  send: { connector: 'hubspot', payload: { project_id: 5 }, summary: 'Company · Mine' },
});

// ── 1. a disabled connector is never read ───────────────────────────────────

test('the read gate: only switched-on AND active connections, in switch order', () => {
  const rows = [
    { provider_key: 'hubspot', status: 'active', last_error: null },
    { provider_key: 'stripe', status: 'active', last_error: null },
    { provider_key: 'calendly', status: 'error', last_error: 'token expired' },
  ];
  assert.deepEqual(readableConnectors([], rows), [], 'nothing switched on, yet something is readable');
  assert.deepEqual(readableConnectors(['stripe'], rows).map((r) => r.provider_key), ['stripe']);
  assert.deepEqual(
    readableConnectors(['stripe', 'hubspot'], rows).map((r) => r.provider_key), ['stripe', 'hubspot'],
  );
  assert.deepEqual(readableConnectors(['calendly'], rows), [], 'a connection in error is readable');
  assert.deepEqual(readableConnectors(['slack'], rows), [], 'a switch with no connection is readable');
});

test('a run calls the reader of an enabled connector and never of a disabled or broken one', async () => {
  const { env } = world();
  const called: string[] = [];
  const reader = (key: string) => async () => { called.push(key); return { facts: [`${key} fact`], as_of: '2026-10-09T11:00:00Z' }; };
  const readers = { hubspot: reader('hubspot'), stripe: reader('stripe'), calendly: reader('calendly') };
  const rows = (await env.DB.prepare('SELECT * FROM integrations WHERE user_id = ?').bind(ME).all()).results;

  const off = await readForRun(env, { id: ME } as any, [], rows, COMPANY, readers);
  assert.deepEqual(called, [], 'a reader ran with every switch off');
  assert.deepEqual(off.reads, []);

  const on = await readForRun(env, { id: ME } as any, ['calendly', 'stripe'], rows, COMPANY, readers);
  assert.deepEqual(called, ['stripe'], 'the disconnected connector was read, or the enabled one was not');
  assert.deepEqual(on.reads.map((r) => r.source), [{ key: 'stripe', name: 'Stripe', as_of: '2026-10-09T11:00:00Z' }]);
});

test('a new conversation starts with every switch off, and the switches are its own', async () => {
  const { env } = world();
  const a = await startConversation(env);
  const b = await startConversation(env);
  const got = await call(env, 'GET', `/conversations/${a}`);
  assert.deepEqual(got.json.conversation.connectors, []);

  const put = await call(env, 'PUT', `/conversations/${a}/connectors`, { keys: ['stripe', 'hubspot', 'stripe', 'nonsense', 'Robert;DROP'] });
  assert.deepEqual(put.json.connectors, ['hubspot', 'stripe'], 'unknown keys kept, or duplicates, or unsorted');
  assert.deepEqual((await call(env, 'GET', `/conversations/${b}`)).json.conversation.connectors, [], 'a switch leaked into another conversation');
  assert.deepEqual((await call(env, 'GET', `/conversations/${a}`)).json.conversation.connectors, ['hubspot', 'stripe'], 'the switches did not survive a reload');
});

test('someone else\'s conversation is not found, for reading, switching and asking', async () => {
  const { env } = world();
  const mine = await startConversation(env);
  assert.equal((await call(env, 'GET', `/conversations/${mine}`, undefined, OTHER)).status, 404);
  assert.equal((await call(env, 'PUT', `/conversations/${mine}/connectors`, { keys: ['stripe'] }, OTHER)).status, 404);
  assert.equal((await call(env, 'POST', `/conversations/${mine}/ask`, { question: 'hi' }, OTHER)).status, 404);
});

// ── 2. a run cannot write ───────────────────────────────────────────────────

test('a run that proposes a send creates a pending action and pushes nothing', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  pushes.length = 0;

  const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine to HubSpot' });
  assert.equal(r.status, 200);
  assert.deepEqual(pushes, [], 'the run itself pushed to the connector');
  assert.equal(r.json.action.status, 'pending');
  assert.deepEqual(r.json.action.payload, { project_id: 5 });
  assert.equal(r.json.action.connector_name, 'HubSpot');
  assert.equal(r.json.action.target, 'Company #5');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_logs WHERE event_type LIKE 'eadwyn%'").get().n, 0, 'a run logged a send');
});

test('no push is reachable from the ask handler: push appears in confirm and nowhere else', () => {
  const src = readFileSync(new URL('../src/routes/eadwyn.ts', import.meta.url), 'utf8');
  const confirmAt = src.indexOf("eadwyn.post('/actions/:uid/confirm'");
  const cancelAt = src.indexOf("eadwyn.post('/actions/:uid/cancel'");
  assert.ok(confirmAt > 0 && cancelAt > confirmAt);
  // `push(c`, `push!(c`, `push?.(c`: any call of a provider push, however it is spelled.
  const calls = [...src.matchAll(/\bpush\s*[!?]?\s*\.?\s*\(\s*c\b/g)].map((m) => m.index!);
  assert.equal(calls.length, 1, 'a provider push is called from more than one place');
  assert.ok(calls[0] > confirmAt && calls[0] < cancelAt, 'the provider push is called outside confirm');
});

test('a proposal is dropped when its connector is off, broken, cannot push, or names an unknown target', async () => {
  assert.equal(validateSend({ connector: 'hubspot', payload: { project_id: 5 } }, []), null, 'a send to a switched-off connector survived');
  assert.equal(validateSend({ connector: 'stripe', payload: { project_id: 5 } }, ['stripe']), null, 'a provider with no send targets got a send');
  assert.equal(validateSend({ connector: 'hubspot', payload: { contact_id: 5 } }, ['hubspot']), null);
  assert.equal(validateSend({ connector: 'hubspot', payload: { project_id: 5, deal_id: 50 } }, ['hubspot']), null);
  assert.equal(validateSend({ connector: 'hubspot', payload: { project_id: '5' } }, ['hubspot']), null);
  assert.equal(validateSend({ connector: 'hubspot', payload: { project_id: 0 } }, ['hubspot']), null);
  assert.deepEqual(
    validateSend({ connector: 'HubSpot', payload: { deal_id: 50 }, summary: ' x ' }, ['hubspot']),
    { connector: 'hubspot', field: 'deal_id', target_id: 50, summary: 'x' },
  );

  // And end to end: the same reply with HubSpot switched off makes no action.
  const { env } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine to HubSpot' });
  assert.equal(r.json.action, null, 'a send was proposed through a switched-off connector');
});

test('a proposal for a project that is not the member\'s, or not in the company, is dropped', async () => {
  for (const projectId of [6, 8, 404]) {
    const reply = JSON.stringify({ answer: 'ok', send: { connector: 'hubspot', payload: { project_id: projectId } } });
    const { env } = world({ reply });
    const conv = await startConversation(env);
    await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
    const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'send it' });
    assert.equal(r.json.action, null, `project ${projectId} became a pending action`);
  }
});

test('a reply that is not the JSON format is an answer and never a send', () => {
  assert.deepEqual(parseModelReply('Plain words.'), { answer: 'Plain words.', send: null });
  assert.deepEqual(parseModelReply('{"answer":"A","send":{"connector":"hubspot"}}'), { answer: 'A', send: { connector: 'hubspot' } });
  assert.deepEqual(parseModelReply('{"send":{"connector":"hubspot"}}').send, null, 'a send without an answer was kept');
});

// ── 3. confirm runs exactly the payload that was shown ──────────────────────

test('confirm sends the stored payload, ignores the request body, and logs it', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  pushes.length = 0;

  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`, { project_id: 6, payload: { project_id: 6 } });
  assert.equal(r.status, 200);
  assert.deepEqual(pushes, [shown.payload], 'confirm did not send exactly the payload the card showed');
  assert.equal(r.json.action.status, 'sent');
  const log = db.prepare("SELECT * FROM integration_logs WHERE event_type = 'eadwyn_send'").all();
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 'ok');
  assert.equal(log[0].payload_json, JSON.stringify(shown.payload));

  const again = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(again.status, 409, 'a second confirm was accepted');
  assert.equal(pushes.length, 1, 'a second confirm sent again');
});

test('two confirms racing send once', async () => {
  const { env } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  pushes.length = 0;
  const [a, b] = await Promise.all([
    call(env, 'POST', `/actions/${shown.uid}/confirm`),
    call(env, 'POST', `/actions/${shown.uid}/confirm`),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(pushes.length, 1, 'a double click sent twice');
});

test('a sent action says it was sent, even once it is old', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  db.prepare("UPDATE eadwyn_pending_actions SET created_at = datetime('now', '-2 days') WHERE uid = ?").run(shown.uid);
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.json.error, 'action_not_pending', 'an action already sent was reported as expired');
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/cancel`)).status, 409, 'a sent action could be cancelled');
  assert.equal(db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(shown.uid).status, 'sent');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_logs WHERE event_type = 'eadwyn_cancel'").get().n, 0);
});

test('a payload changed after it was shown is not sent', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  db.prepare("UPDATE eadwyn_pending_actions SET payload_json = '{\"project_id\":6}' WHERE uid = ?").run(shown.uid);
  pushes.length = 0;
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'action_changed');
  assert.deepEqual(pushes, [], 'a changed payload was sent');
});

test('the payload is hashed from its one serialisation', async () => {
  const json = canonicalPayload({ field: 'project_id', target_id: 5 });
  assert.equal(json, '{"project_id":5}');
  assert.equal(await payloadHash(json), await payloadHash('{"project_id":5}'));
  assert.notEqual(await payloadHash(json), await payloadHash('{"project_id":6}'));
  assert.match(await payloadHash(json), /^[0-9a-f]{64}$/);
});

test('cancel sends nothing, is logged, and leaves nothing to confirm', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  pushes.length = 0;
  const r = await call(env, 'POST', `/actions/${shown.uid}/cancel`);
  assert.equal(r.status, 200);
  assert.equal(r.json.action.status, 'cancelled');
  assert.deepEqual(pushes, []);
  const log = db.prepare("SELECT * FROM integration_logs WHERE event_type = 'eadwyn_cancel'").all();
  assert.equal(log.length, 1, 'a cancel was not logged');
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/confirm`)).status, 409, 'a cancelled action could still be sent');
  assert.deepEqual(pushes, []);
});

test('a failed send is recorded as failed and logged as an error', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  pushThrows = true;
  try {
    const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
    assert.equal(r.status, 502);
  } finally {
    pushThrows = false;
  }
  assert.equal(db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(shown.uid).status, 'failed');
  assert.equal(db.prepare("SELECT status FROM integration_logs WHERE event_type = 'eadwyn_send'").get().status, 'error');
});

test('an action older than a day, or someone else\'s, cannot be sent', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  pushes.length = 0;
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/confirm`, undefined, OTHER)).status, 404, 'another member confirmed my action');
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/cancel`, undefined, OTHER)).status, 404, 'another member cancelled my action');
  db.prepare("UPDATE eadwyn_pending_actions SET created_at = datetime('now', '-2 days') WHERE uid = ?").run(shown.uid);
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'action_expired');
  assert.deepEqual(pushes, []);
  assert.equal(isExpired('2026-10-09 10:00:00', Date.parse('2026-10-09T11:00:00Z')), false);
  assert.equal(isExpired('2026-10-08 10:00:00', Date.parse('2026-10-09T11:00:00Z')), true);
});

// ── the answer and its receipt ──────────────────────────────────────────────

test('an answer and its receipt name the connectors read; the conversation keeps both turns', async () => {
  const { env } = world();
  const conv = await startConversation(env);
  const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'What is MRR?' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sources, [], 'with nothing switched on, a source was claimed');
  assert.deepEqual(r.json.usage.connectors_read, []);
  const got = await call(env, 'GET', `/conversations/${conv}`);
  assert.deepEqual(got.json.messages.map((m: any) => m.role), ['user', 'assistant']);
  assert.equal(got.json.conversation.title, 'What is MRR?');
});

test('through the route: a switched-on connector is read, named under the answer and in the receipt; switched off, it is not read', async () => {
  const { env, modelCalls } = world();
  const reads: string[] = [];
  CONNECTOR_READERS.stripe = async () => { reads.push('stripe'); return { facts: ['MRR 38400 USD'], as_of: '2026-10-09T11:48:00Z' }; };
  try {
    const conv = await startConversation(env);
    const off = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'What is MRR?' });
    assert.deepEqual(reads, [], 'Stripe was read with its switch off');
    assert.deepEqual(off.json.usage.connectors_read, []);
    assert.doesNotMatch(modelCalls[0].messages[0].content, /MRR 38400/, 'Stripe data reached the model with its switch off');

    await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['stripe'] });
    const on = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'And now?' });
    assert.deepEqual(reads, ['stripe']);
    assert.deepEqual(on.json.sources, [{ key: 'stripe', name: 'Stripe', as_of: '2026-10-09T11:48:00Z' }]);
    assert.deepEqual(on.json.usage.connectors_read, ['stripe'], 'the receipt does not record the connector read');
    assert.match(modelCalls[1].messages[0].content, /\[Stripe\]\n- MRR 38400 USD/);
    const kept = (await call(env, 'GET', `/conversations/${conv}`)).json.messages;
    assert.deepEqual(kept[3].sources, on.json.sources, 'the stored answer lost its source line');
  } finally {
    delete CONNECTOR_READERS.stripe;
  }
});

test('deleting a conversation deletes its messages and actions', async () => {
  const { env, db } = world({ reply: SEND_REPLY });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' });
  assert.equal((await call(env, 'DELETE', `/conversations/${conv}`, undefined, OTHER)).status, 404);
  assert.equal((await call(env, 'DELETE', `/conversations/${conv}`)).status, 200);
  for (const t of ['eadwyn_conversations', 'eadwyn_messages', 'eadwyn_pending_actions']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, `${t} kept rows`);
  }
});

test('the connectors list is the member\'s own, one per provider, with the reason a row is greyed', async () => {
  const { env } = world();
  const mine = await call(env, 'GET', '/connectors');
  assert.deepEqual(mine.json.connectors, [
    { key: 'calendly', name: 'Calendly', reason: 'Needs attention' },
    { key: 'hubspot', name: 'HubSpot', reason: '' },
    { key: 'stripe', name: 'Stripe', reason: '' },
  ]);
  const theirs = await call(env, 'GET', '/connectors', undefined, OTHER);
  assert.deepEqual(theirs.json.connectors.map((x: any) => x.key), ['hubspot']);
});

test('switch keys are known registry keys only, and the reason a connection needs attention is in words', () => {
  assert.deepEqual(normaliseConnectorKeys('stripe'), []);
  assert.deepEqual(normaliseConnectorKeys(['STRIPE ', 'hubspot']), ['hubspot', 'stripe']);
  assert.equal(attentionReason({ status: 'active', last_error: null }), '');
  assert.equal(attentionReason({ status: 'error', last_error: 'invalid_grant: token expired' }), 'Sign-in expired');
  assert.equal(attentionReason({ status: 'error', last_error: 'rate limited' }), 'Needs attention');
  assert.equal(attentionReason({ status: 'disconnected', last_error: null }), 'Disconnected');
});
