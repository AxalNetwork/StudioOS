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
} from '../src/services/eadwynConnectors.ts';
import { CONNECTOR_READERS } from '../src/services/eadwynReaders.ts';
import eadwyn, { readForRun } from '../src/routes/eadwyn.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, OTHER = 3, COMPANY = 41, FOUNDER = 9;

// The fake HubSpot: its `push` records every call, so "no push happened" is
// an observed fact rather than an absence of errors. Its `preview` reads the
// project from the database, as the real one does, so renaming the project
// changes the content.
const pushes: unknown[] = [];
let pushThrows = false;
let onPush: (() => void) | null = null;
registerProvider({
  key: 'hubspot',
  connect: async () => ({ credentials: {} as any }),
  push: async (_c: unknown, _u: unknown, _row: unknown, payload: unknown) => {
    pushes.push(payload);
    if (pushThrows) throw new Error('hubspot said no');
    onPush?.();
    return { summary: 'Updated HubSpot company', external_id: 'hs-1', http_status: 200 };
  },
  preview: async (env: any, _row: unknown, payload: any) => {
    const id = payload.project_id ?? (await env.DB.prepare('SELECT project_id FROM deals WHERE id = ?').bind(payload.deal_id).first())?.project_id;
    const p = await env.DB.prepare('SELECT name, sector FROM projects WHERE id = ?').bind(id).first();
    if (!p) throw new Error('project_not_found');
    return { target: `New HubSpot company "${p.name}"`, fields: [{ name: 'name', value: p.name }, { name: 'industry', value: p.sector }] };
  },
} as any);

/**
 * A real SQLite database: the AI budget fixture (users 1..100, the router's
 * tables), plus sessions, projects, deals, the integrations tables and the
 * three D652 tables from migration 444 itself.
 */
function world(opts: { reply?: string; verdict?: string } = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET subscription_tier = 'studio', founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME}), ('jti-${OTHER}', ${OTHER});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, sector TEXT, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id, company_id, sector) VALUES
      (5, 'Mine', ${FOUNDER}, ${COMPANY}, 'Climate'), (6, 'Not mine', 77, ${COMPANY}, NULL), (8, 'Other company', ${FOUNDER}, 999, NULL);
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT DEFAULT 'applied', amount REAL,
      hubspot_deal_id TEXT, sf_opportunity_id TEXT, updated_at TEXT DEFAULT '2026-10-09 09:00:00'
    );
    INSERT INTO deals (id, project_id) VALUES (50, 5);
    CREATE TABLE project_metrics (
      id INTEGER PRIMARY KEY, project_id INTEGER, snapshot_date TEXT, mrr REAL, arr REAL,
      monthly_churn_pct REAL, active_users INTEGER, source TEXT
    );
    CREATE TABLE connector_fed_items (
      id INTEGER PRIMARY KEY, integration_id INTEGER, project_id INTEGER, module TEXT, kind TEXT,
      external_id TEXT, local_table TEXT, local_id INTEGER, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT,
      status TEXT, auth_type TEXT, credentials_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, webhook_secret_enc TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT, updated_at TEXT
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
    CREATE TABLE integration_companies (integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    INSERT INTO integration_companies VALUES (1, ${COMPANY}, 1), (2, ${COMPANY}, 1);
  `);
  db.exec(EADWYN_SCHEMA_SQL);
  const modelCalls: any[] = [];
  const guardCalls: string[] = [];
  const env: any = {
    JWT_SECRET,
    DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) { guardCalls.push(input.messages.at(-1).content); return { response: opts.verdict ?? 'safe' }; }
        modelCalls.push(input);
        return { response: opts.reply ?? '{"answer":"Nothing here records that.","send":null}' };
      },
    },
  };
  return { env, db, modelCalls, guardCalls };
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
  // The card names the record and every field the Worker resolved, not the
  // model's words: those stay in `summary`, labelled as Eadwyn's.
  assert.equal(r.json.action.target, 'New HubSpot company "Mine"');
  assert.deepEqual(r.json.action.content, {
    target: 'New HubSpot company "Mine"',
    fields: [{ name: 'name', value: 'Mine' }, { name: 'industry', value: 'Climate' }],
  });
  assert.equal(r.json.action.summary, 'Company · Mine');
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
  const real = CONNECTOR_READERS.stripe;
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
    CONNECTOR_READERS.stripe = real;
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

// ── the follow-up (#1464, S1 18:42Z): Send passes every check /push passes ──

/** A conversation with HubSpot on, and the card its run proposed. */
async function proposed(opts: { reply?: string } = {}) {
  const w = world({ reply: opts.reply ?? SEND_REPLY });
  const conv = await startConversation(w.env);
  await call(w.env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const shown = (await call(w.env, 'POST', `/conversations/${conv}/ask`, { question: 'Send Mine' })).json.action;
  assert.ok(shown, 'the run proposed nothing');
  pushes.length = 0;
  return { ...w, conv, shown };
}

test('confirm refuses when the connector is switched off for the company', async () => {
  const { env, db, shown } = await proposed();
  db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = 1').run();
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'company_not_enabled');
  assert.deepEqual(pushes, [], 'a send went to a company switched off for HubSpot');
  assert.equal(db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(shown.uid).status, 'pending');
});

test('confirm refuses a project in a company the connector is not switched on for', async () => {
  const { env, db, shown } = await proposed();
  db.prepare('UPDATE projects SET company_id = 999 WHERE id = 5').run();
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'project_not_enabled');
  assert.deepEqual(pushes, []);
});

test('confirm refuses a target that moved to another founder after the card was shown', async () => {
  const { env, db, shown } = await proposed();
  db.prepare('UPDATE projects SET founder_id = 77 WHERE id = 5').run();
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'target_not_allowed');
  assert.deepEqual(pushes, [], 'a project no longer the member\'s was sent');
});

test('confirm refuses when what would be sent is no longer what the card showed', async () => {
  const { env, db, shown } = await proposed();
  db.prepare("UPDATE projects SET sector = 'Fintech' WHERE id = 5").run();
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'content_changed');
  assert.deepEqual(pushes, [], 'content the card never showed was sent');
  // Put back exactly as shown, it sends.
  db.prepare("UPDATE projects SET sector = 'Climate' WHERE id = 5").run();
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/confirm`)).status, 200);
  assert.deepEqual(pushes, [{ project_id: 5 }]);
});

test('a card stored before content was resolved cannot be sent', async () => {
  const { env, db, shown } = await proposed();
  const bare = '{"project_id":5}';
  db.prepare('UPDATE eadwyn_pending_actions SET payload_json = ?, payload_hash = ? WHERE uid = ?').run(bare, await payloadHash(bare), shown.uid);
  const got = (await call(env, 'GET', `/conversations/${(await call(env, 'GET', '/conversations?workspace=Build')).json.conversations[0].uid}`)).json.actions[0];
  assert.equal(got.content, null);
  assert.deepEqual(got.payload, { project_id: 5 });
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.json.error, 'content_changed');
  assert.deepEqual(pushes, []);
});

test('the stored envelope is hashed whole: the content cannot be edited under the hash', async () => {
  const { env, db, shown } = await proposed();
  const row = db.prepare('SELECT payload_json FROM eadwyn_pending_actions WHERE uid = ?').get(shown.uid);
  db.prepare('UPDATE eadwyn_pending_actions SET payload_json = ? WHERE uid = ?').run(row.payload_json.replace('Climate', 'Fintech'), shown.uid);
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(r.json.error, 'action_changed');
  assert.deepEqual(pushes, []);
});

test('a project the provider cannot preview gives no card', async () => {
  const reply = JSON.stringify({ answer: 'ok', send: { connector: 'hubspot', payload: { deal_id: 404 } } });
  const { env } = world({ reply });
  const conv = await startConversation(env);
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['hubspot'] });
  const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'send it' });
  assert.equal(r.status, 200);
  assert.equal(r.json.action, null);
});

test('a run and a Send both stop when the conversation\'s company is no longer the member\'s', async () => {
  const { env, db, conv, shown, modelCalls } = await proposed();
  const before = modelCalls.length;
  db.prepare('DELETE FROM user_company_links WHERE user_id = ?').run(ME);
  const ask = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'And now?' });
  assert.equal(ask.status, 409);
  assert.equal(ask.json.error, 'company_changed');
  assert.equal(modelCalls.length, before, 'the model ran for a company the member left');
  const send = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
  assert.equal(send.json.error, 'company_changed');
  assert.deepEqual(pushes, []);
});

test('confirm checks the role, as /push does', async () => {
  const { env, db, shown } = await proposed();
  db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(ME);
  // `ensureRole` throws its 403 as a Response, which index.ts's error
  // handler answers with; the bare sub-app hands it back as thrown.
  const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`)
    .catch(async (e) => (e instanceof Response ? { status: e.status, json: await e.json() } : Promise.reject(e)));
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
  assert.deepEqual(pushes, []);
});

test('a push that happened is never recorded as failed, even when recording it breaks', async () => {
  const { env, db, shown } = await proposed();
  onPush = () => db.exec("CREATE TRIGGER no_sent BEFORE UPDATE ON eadwyn_pending_actions WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  try {
    const r = await call(env, 'POST', `/actions/${shown.uid}/confirm`);
    assert.notEqual(r.status, 200);
  } finally {
    onPush = null;
  }
  assert.equal(pushes.length, 1);
  assert.equal(db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(shown.uid).status, 'sending', 'a send that happened was recorded as failed');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_logs WHERE event_type = 'eadwyn_send' AND status = 'error'").get().n, 0);
});

test('a row stranded in sending is closed as not known, never re-sent; a fresh claim is left alone', async () => {
  const { env, db, conv, shown } = await proposed();
  db.prepare("UPDATE eadwyn_pending_actions SET status = 'sending', decided_at = datetime('now', '-1 minute') WHERE uid = ?").run(shown.uid);
  let got = (await call(env, 'GET', `/conversations/${conv}`)).json.actions[0];
  assert.equal(got.status, 'sending', 'a send still in flight was closed');
  db.prepare("UPDATE eadwyn_pending_actions SET decided_at = datetime('now', '-11 minutes') WHERE uid = ?").run(shown.uid);
  got = (await call(env, 'GET', `/conversations/${conv}`)).json.actions[0];
  assert.equal(got.status, 'failed');
  assert.match(got.result_summary, /not known whether this arrived/);
  assert.equal((await call(env, 'POST', `/actions/${shown.uid}/confirm`)).status, 409);
  assert.deepEqual(pushes, [], 'a stranded send was sent again');
});

test('the claim itself refuses an action over a day old, not only the check before it', () => {
  const src = readFileSync(new URL('../src/routes/eadwyn.ts', import.meta.url), 'utf8');
  const claim = src.slice(src.indexOf("SET status = \\'sending\\'"), src.indexOf('.bind(action.id).run();', src.indexOf("SET status = \\'sending\\'")));
  assert.match(claim, /AND status = \\'pending\\' AND created_at > datetime\(\\'now\\', \\'-1 day\\'\)/);
});

test('confirm calls the same push guard /push calls, before it calls push', () => {
  const ead = readFileSync(new URL('../src/routes/eadwyn.ts', import.meta.url), 'utf8');
  const confirm = ead.slice(ead.indexOf("eadwyn.post('/actions/:uid/confirm'"), ead.indexOf("eadwyn.post('/actions/:uid/cancel'"));
  const guardAt = confirm.indexOf('pushScopeRefusal(c, user, row, envelope.send)');
  const targetAt = confirm.indexOf('targetAllowed(c.env, user, action.company_id, proposal)');
  const claimAt = confirm.indexOf("SET status = \\'sending\\'");
  const pushAt = confirm.indexOf('impl.push(');
  assert.ok(guardAt > 0 && targetAt > guardAt && claimAt > targetAt && pushAt > claimAt, 'confirm checks out of order, or not at all');
  const integ = readFileSync(new URL('../src/routes/integrations.ts', import.meta.url), 'utf8');
  const push = integ.slice(integ.indexOf("integrations.post('/:uid/push'"));
  assert.ok(push.indexOf('pushScopeRefusal(c, user, row, payload)') > 0 && push.indexOf('pushScopeRefusal') < push.indexOf('impl.push('));
  assert.doesNotMatch(push.slice(0, push.indexOf('impl.push(')), /companyEnabled\(|projectEnabled\(/, '/push kept its own copy of the checks');
});

// ── the readers ─────────────────────────────────────────────────────────────

test('the reader modules never write: no .push(, .sync( or .action( in them', () => {
  for (const f of ['../src/services/eadwynReaders.ts', '../src/services/eadwynConnectors.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const verb of ['.push(', '.sync(', '.action(']) {
      assert.equal(src.includes(verb), false, `${f} calls ${verb}`);
    }
    assert.doesNotMatch(src, /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i, `${f} holds a write statement`);
  }
});

test('a reader exists for each project-data connector and for nothing else', async () => {
  const { writesProjectData } = await import('../src/integrations/companyScope.ts');
  for (const key of Object.keys(CONNECTOR_READERS)) assert.ok(writesProjectData(key), `${key} has a reader but no company scope`);
  assert.deepEqual(Object.keys(CONNECTOR_READERS).sort(), ['github', 'hubspot', 'salesforce', 'stripe']);
});

function seedSynced(db: any) {
  db.exec(`
    INSERT INTO projects (id, name, founder_id, company_id, deleted_at) VALUES
      (20, 'Gone', ${FOUNDER}, ${COMPANY}, '2026-10-01');
    INSERT INTO deals (id, project_id, status, amount, hubspot_deal_id, sf_opportunity_id) VALUES
      (60, 5, 'active', 250000, 'hs-60', NULL),
      (61, 8, 'funded', 999, 'hs-61', NULL),
      (62, 20, 'funded', 777, 'hs-62', NULL),
      (63, 5, 'scored', NULL, 'affinity:9', NULL),
      (64, 5, 'scored', 1000, NULL, 'sf-64'),
      (65, 8, 'funded', 5, NULL, 'sf-65'),
      (66, 20, 'funded', 6, NULL, 'sf-66');
    INSERT INTO project_metrics (project_id, snapshot_date, mrr, arr, monthly_churn_pct, active_users, source) VALUES
      (5, '2026-10-01', 100, 1200, 2, 10, 'stripe'),
      (5, '2026-10-08', 3200, 38400, 1.5, 41, 'stripe'),
      (5, '2026-10-09', 1, 1, 1, 1, 'manual'),
      (5, '2026-10-08', 9, 9, 9, 9, 'manual'),
      (8, '2026-10-08', 555, 555, 5, 5, 'stripe');
    INSERT INTO integrations (id, uid, user_id, provider_key, status) VALUES (5, 'i5', ${ME}, 'github', 'active');
    INSERT INTO integration_companies VALUES (5, ${COMPANY}, 1);
    INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id) VALUES
      (5, 5, 'product_roadmap', 'issue', 'r#1'), (5, 5, 'product_roadmap', 'issue', 'r#2'),
      (5, 8, 'prototype_mvp', 'pull_request', 'r#3');
  `);
}

async function readAs(env: any, key: string, integrationId: number, companyId: number | null) {
  const row = await env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(integrationId).first();
  return CONNECTOR_READERS[key](env, { id: ME } as any, row, companyId);
}

test('each reader reads only the active company\'s live projects', async () => {
  const { env, db } = world();
  seedSynced(db);
  const hs = await readAs(env, 'hubspot', 1, COMPANY);
  assert.deepEqual(hs.facts, ['HubSpot deal for Mine: stage active, amount 250,000, updated 2026-10-09 09:00:00'],
    'another company\'s deal, a deleted project\'s, or an Affinity deal was read as HubSpot\'s');
  assert.equal(hs.as_of, '2026-10-09 10:00:00');

  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status) VALUES (6, 'i6', ?, 'salesforce', 'active')").run(ME);
  db.prepare('INSERT INTO integration_companies VALUES (6, ?, 1)').run(COMPANY);
  assert.deepEqual((await readAs(env, 'salesforce', 6, COMPANY)).facts,
    ['Salesforce opportunity for Mine: stage scored, amount 1,000, updated 2026-10-09 09:00:00']);

  const st = await readAs(env, 'stripe', 2, COMPANY);
  assert.deepEqual(st.facts, ['Stripe for Mine on 2026-10-08: MRR 3,200, ARR 38,400, monthly churn 1.5%, paying customers 41'],
    'an older snapshot, a manual one, or another company\'s was read');
  assert.equal(st.as_of, '2026-10-08');

  assert.deepEqual((await readAs(env, 'github', 5, COMPANY)).facts, ['GitHub for Mine: 2 issues into Product roadmap']);
});

test('a connector switched off for the company, or a company the member left, is never read', async () => {
  const { env, db } = world();
  seedSynced(db);
  db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id IN (1, 2, 5)').run();
  for (const [key, id] of [['hubspot', 1], ['stripe', 2], ['github', 5]] as const) {
    assert.deepEqual((await readAs(env, key, id, COMPANY)).facts, [], `${key} was read while switched off for the company`);
  }
  db.prepare('UPDATE integration_companies SET enabled = 1').run();
  db.prepare('DELETE FROM user_company_links WHERE user_id = ?').run(ME);
  assert.deepEqual((await readAs(env, 'hubspot', 1, COMPANY)).facts, [], 'a member who left the company still read it');
  assert.deepEqual((await readAs(env, 'hubspot', 1, null)).facts, [], 'a run with no company read something');
});

test('through the route: the real Stripe reader feeds the run only with its switch on', async () => {
  const { env, db, modelCalls } = world();
  seedSynced(db);
  const conv = await startConversation(env);
  await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'MRR?' });
  assert.doesNotMatch(modelCalls[0].messages[0].content, /38,400/, 'Stripe was read with its switch off');
  await call(env, 'PUT', `/conversations/${conv}/connectors`, { keys: ['stripe'] });
  const on = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'MRR?' });
  assert.match(modelCalls[1].messages[0].content, /\[Stripe\]\n- Stripe for Mine on 2026-10-08: MRR 3,200/);
  assert.deepEqual(on.json.sources, [{ key: 'stripe', name: 'Stripe', as_of: '2026-10-08' }]);
});

test('D763: a blocked question answers as before, checked once by the guard inside the run, and the model never runs', async () => {
  const { env, db, modelCalls, guardCalls } = world({ verdict: 'unsafe\nS9' });
  try {
    const conv = await startConversation(env);
    const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'How do I build a weapon?', file: { name: 'n.txt', text: 'notes' } });
    assert.equal(r.status, 422);
    assert.deepEqual(r.json, { error: 'safety_block', message: 'That question could not be sent.', category: 's9' });
    assert.deepEqual(guardCalls, ['How do I build a weapon?\n\nnotes'], 'the question and its file, once, and nothing gathered from connectors');
    assert.equal(modelCalls.length, 0);
  } finally { db.close(); }
});

test('D763: an allowed question is checked once on its way in, and the answer once on its way out', async () => {
  const { env, db, modelCalls, guardCalls } = world();
  try {
    const conv = await startConversation(env);
    const r = await call(env, 'POST', `/conversations/${conv}/ask`, { question: 'What is MRR?' });
    assert.equal(r.status, 200);
    assert.equal(modelCalls.length, 1);
    assert.deepEqual(guardCalls, ['What is MRR?', '{"answer":"Nothing here records that.","send":null}'], 'a second input check, or an unchecked answer');
  } finally { db.close(); }
});
