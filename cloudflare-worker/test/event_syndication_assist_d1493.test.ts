/**
 * D1493 (#3906, SY8) — Ask proposes a channel's title and description. Over
 * the migrated schema, the real routes, a stub model and a fake adapter whose
 * limits are small enough to cut. Every person, event and account is made up.
 *
 *   · each press is quoted first, and the quote holds and writes nothing;
 *   · a run leaves one ai_rail_proposals row per field asked for, each cut to
 *     the channel's limit, with { account_uid, channel, field, value, source };
 *   · a private or unlisted event is refused in Part A's sentence before any
 *     quote, hold or run; a non-manager gets 404; a support session 403;
 *   · nothing in the run writes event_syndications, and Accept writes none either;
 *   · out of tokens is 402, AI off is 403.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/event_syndication_assist_d1493.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { fakeAdapter } from './_syndication_fake.ts';
import eventSyndication from '../src/routes/event_syndication.ts';
import eventSyndicationAssist from '../src/routes/event_syndication_assist.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { AI_SURFACE } from '../src/services/aiSurfaces.ts';
import { clearSyndicationChannelsForTest } from '../src/services/eventSyndication/channels.ts';
import { SKIP } from '../src/services/eventSyndication/eligibility.ts';
import { channelLimits, cutTo, eventsPage, fieldsOf, messageOf, payloadsOf, SYNDICATION_COPY_OPTION } from '../src/services/eventSyndication/copyAssist.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'synthetic-event-syndication-assist-'.repeat(2);
const ADMIN = 2, HOST = 3, OTHER = 4;
const EVENT = 10;
const FUTURE = '2099-03-01T18:00:00Z';
const LONG_TITLE = 'Founders evening in the old print hall with demos and a long name';
const LONG_TEXT = `${'Bring a demo and meet other founders. '.repeat(12)}The end.`;

async function fixture({ answer = () => JSON.stringify({ title: LONG_TITLE, description: LONG_TEXT }) } = {}) {
  __resetForTest();
  clearSyndicationChannelsForTest();
  fakeAdapter('luma', { title_limit: 30, text_limit: 120 });
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users (id, name, email, role, is_active, subscription_tier) VALUES
      (${ADMIN}, 'Abe Made-up', 'abe@example.test', 'admin', 1, 'studio'),
      (${HOST}, 'Hana Made-up', 'hana@example.test', 'founder', 1, 'studio'),
      (${OTHER}, 'Otto Made-up', 'otto@example.test', 'founder', 1, 'studio');
    INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES
      (${ADMIN}, 'jti-${ADMIN}', 'totp', 'totp'), (${HOST}, 'jti-${HOST}', 'password', 'password'), (${OTHER}, 'jti-${OTHER}', 'password', 'password');
    INSERT INTO events (id, slug, host_user_id, type, title, summary, description, starts_at, visibility, status, created_at)
      VALUES (${EVENT}, 'founders-evening', ${HOST}, 'meetup', 'Founders evening', 'Drinks and demos', 'Bring a demo; meet founders.',
              '${FUTURE}', 'public', 'pending_review', '2026-10-01T00:00:00Z');
    INSERT INTO event_channel_accounts (uid, channel, owner_kind, owner_user_id, external_account_id, display_name, credentials_enc, connected_by)
      VALUES ('acc-luma', 'luma', 'hq', NULL, 'ext-luma', 'Axal on Luma', 'x', ${ADMIN});
  `);
  for (const id of [ADMIN, HOST, OTHER]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(id);
  for (const key of ['founder:free', 'founder:studio', 'admin:studio']) {
    db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  }
  const prompts: string[] = [];
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      const prompt = (input?.messages || []).filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      prompts.push(prompt);
      return { response: answer(), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', AI };
  const app = new Hono<any>()
    .route('/api/events', eventSyndication)
    .route('/api/events', eventSyndicationAssist)
    .route('/api/ai/rail/proposals', railProposals);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  async function call(who: number, method: string, path: string, body?: unknown, claims: Record<string, unknown> = {}) {
    const jwt = await new SignJWT({ user_id: who, jti: `jti-${who}`, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request('https://axal.vc' + path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, text };
  }
  const runs = () => db.prepare("SELECT user_id, task, rail_page, rail_option, record_ref, surface FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => (db.prepare('SELECT uid, user_id, rail_page, rail_option, record_ref, kind, status, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[])
    .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  const holds = () => (db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n as number;
  const syndications = () => db.prepare('SELECT * FROM event_syndications').all() as any[];
  return { db, call, runs, proposals, holds, syndications, prompts, close: () => {
    clearSyndicationChannelsForTest();
    const file = db.location();
    db.close();
    // Each case's copy goes as soon as it closes, so a run needs one template's room, not nine.
    if (file) rmSync(file, { force: true });
  } };
}

const ASSIST = `/api/events/${EVENT}/syndication/assist`;
const QUOTE = `${ASSIST}/quote`;
const BOTH = { account_uid: 'acc-luma' };

test('the pure parts: fields, limits, the prompt names the channel, a value is cut on a word', () => {
  assert.deepEqual(fieldsOf(undefined), ['title', 'description']);
  assert.deepEqual(fieldsOf(['description', 'title']), ['title', 'description']);
  assert.deepEqual(fieldsOf(['title']), ['title']);
  assert.equal(fieldsOf([]), null);
  assert.equal(fieldsOf(['price']), null);
  assert.equal(fieldsOf('title'), null);
  clearSyndicationChannelsForTest();
  assert.deepEqual(channelLimits('luma'), { title: 200, description: 5000 }, "Part A's defaults with no adapter");
  fakeAdapter('luma', { title_limit: 30, text_limit: 120 });
  assert.deepEqual(channelLimits('luma'), { title: 30, description: 120 });
  const m = messageOf({ title: 'Founders evening', description: 'Bring a demo.' }, 'luma', ['title']);
  assert.match(m.user, /for Luma/);
  assert.match(m.user, /at most 30 characters/);
  assert.doesNotMatch(m.user, /"description"/);
  assert.equal(cutTo('alpha beta gamma delta', 20), 'alpha beta gamma', 'cut back to the last word');
  assert.equal(cutTo('onetwothreefour', 8), 'onetwoth', 'no space near: a hard cut');
  assert.deepEqual(payloadsOf('not json', 'acc', 'luma', ['title']), []);
  assert.deepEqual(payloadsOf('{"title": "  "}', 'acc', 'luma', ['title']), []);
  assert.deepEqual(payloadsOf('```json\n{"title": "Hi", "description": "Ignored"}\n```', 'acc', 'luma', ['title']).map((p) => [p.field, p.value]), [['title', 'Hi']]);
  assert.equal(eventsPage('founder'), 'Founder · Events');
  assert.equal(eventsPage('admin'), 'Admin · Events');
  clearSyndicationChannelsForTest();
});

test('the quote comes first: it names a hold and a model, and holds, runs and proposes nothing', async () => {
  const f = await fixture();
  try {
    const q = await f.call(HOST, 'POST', QUOTE, BOTH);
    assert.equal(q.status, 200, q.text);
    assert.equal(q.body.ai, true);
    assert.equal(q.body.option, SYNDICATION_COPY_OPTION);
    assert.ok(Number(q.body.hold_microusd) > 0, 'a hold to show ("Holds up to $x")');
    assert.ok(q.body.model);
    assert.deepEqual([f.runs(), f.proposals(), f.holds(), f.prompts], [[], [], 0, []]);
  } finally { f.close(); }
});

test('a run leaves one proposal per field, cut to the channel limit, filed on the event, and writes no override', async () => {
  const f = await fixture();
  try {
    const r = await f.call(HOST, 'POST', ASSIST, BOTH);
    assert.equal(r.status, 200, r.text);
    const rows = f.proposals();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual([row.user_id, row.rail_page, row.rail_option, row.record_ref, row.kind, row.status],
        [HOST, 'Founder · Events', SYNDICATION_COPY_OPTION, `events:${EVENT}`, 'proposal', 'proposed']);
      assert.deepEqual(Object.keys(row.payload).sort(), ['account_uid', 'channel', 'field', 'source', 'value']);
      assert.deepEqual([row.payload.account_uid, row.payload.channel], ['acc-luma', 'luma']);
    }
    const [title, description] = rows.map((x) => x.payload);
    assert.deepEqual([title.field, description.field], ['title', 'description']);
    assert.ok(title.value.length <= 30 && title.value.length > 0, title.value);
    assert.ok(description.value.length <= 120 && description.value.length > 0, description.value);
    assert.ok(LONG_TITLE.startsWith(title.value), 'cut, not rewritten');
    assert.match(f.prompts[0], /Bring a demo; meet founders\./, 'the model reads the event');
    const [run] = f.runs();
    assert.deepEqual([run.user_id, run.task, run.rail_page, run.rail_option, run.record_ref, run.surface],
      [HOST, 'rail_write', 'Founder · Events', SYNDICATION_COPY_OPTION, `events:${EVENT}`, AI_SURFACE.eventSyndication]);
    assert.equal(r.body.proposals.length, 2);
    assert.deepEqual(f.syndications(), [], 'the run writes no override and no listing');
    // Accept is the rail's decide, and it writes no override either: the page's PUT does.
    const accept = await f.call(HOST, 'POST', `/api/ai/rail/proposals/${rows[0].uid}/decide`, { decision: 'accept' });
    assert.equal(accept.status, 200, accept.text);
    assert.deepEqual(f.syndications(), []);
  } finally { f.close(); }
});

test('one field asked, one proposal; an answer with nothing usable proposes nothing', async () => {
  const f = await fixture();
  try {
    const r = await f.call(HOST, 'POST', ASSIST, { ...BOTH, fields: ['description'] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(f.proposals().map((p) => p.payload.field), ['description']);
    assert.equal((await f.call(HOST, 'POST', ASSIST, { ...BOTH, fields: ['price'] })).status, 400);
  } finally { f.close(); }
  const g = await fixture({ answer: () => 'I cannot help with that.' });
  try {
    const r = await g.call(HOST, 'POST', ASSIST, BOTH);
    assert.deepEqual([r.status, r.body.error], [422, 'nothing_proposed']);
    assert.deepEqual(g.proposals(), []);
  } finally { g.close(); }
});

test('a private or unlisted event is refused in Part A sentence before any quote, hold or run', async () => {
  for (const visibility of ['private', 'unlisted']) {
    const f = await fixture();
    try {
      f.db.prepare('UPDATE events SET visibility = ? WHERE id = ?').run(visibility, EVENT);
      for (const path of [QUOTE, ASSIST]) {
        const r = await f.call(HOST, 'POST', path, BOTH);
        assert.deepEqual([r.status, r.body.error, r.body.message], [409, 'not_public', SKIP.private], `${visibility} ${path}`);
      }
      assert.deepEqual([f.runs(), f.proposals(), f.holds(), f.prompts], [[], [], 0, []]);
    } finally { f.close(); }
  }
});

test('the gate: host and admin pass; another member gets 404; a support session 403; an account the event cannot use 404', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call(ADMIN, 'POST', QUOTE, BOTH)).status, 200);
    for (const path of [QUOTE, ASSIST]) {
      const other = await f.call(OTHER, 'POST', path, BOTH);
      assert.deepEqual([other.status, other.body.error], [404, 'not_found'], path);
    }
    assert.equal((await f.call(OTHER, 'POST', `/api/events/999/syndication/assist`, BOTH)).status, 404, 'a missing event reads the same');
    const support = await f.call(HOST, 'POST', ASSIST, BOTH, { impersonated_by: ADMIN });
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
    const stranger = await f.call(HOST, 'POST', ASSIST, { account_uid: 'acc-nope' });
    assert.deepEqual([stranger.status, stranger.body.error], [404, 'account_not_found']);
    assert.deepEqual([f.runs(), f.proposals(), f.holds()], [[], [], 0]);
  } finally { f.close(); }
});

test('out of tokens is 402 with no proposal; AI off is 403 and the quote says ai:false', async () => {
  const f = await fixture();
  try {
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = ?').run(HOST);
    const r = await f.call(HOST, 'POST', ASSIST, BOTH);
    assert.equal(r.status, 402, r.text);
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
  const g = await fixture();
  try {
    g.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run('off-host', HOST, 'founder · events');
    const q = await g.call(HOST, 'POST', QUOTE, BOTH);
    assert.deepEqual([q.status, q.body.ai, q.body.reason], [200, false, 'assist_off']);
    const r = await g.call(HOST, 'POST', ASSIST, BOTH);
    assert.deepEqual([r.status, r.body.error], [403, 'assist_off']);
    assert.deepEqual([g.runs(), g.proposals()], [[], []]);
  } finally { g.close(); }
});
