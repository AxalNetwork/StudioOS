/**
 * D9189 (#9189): a client never reads the text of an exception it did not cause.
 *
 *   - POST /api/projects/submit refuses a body that is not a JSON object with a
 *     fixed sentence, keeps the score-integrity module's own reserved-field
 *     sentence.
 *   - POST /api/assistant/message: a tool that throws gives Eadwyn the code
 *     `tool_failed` (in the next model call and the stored `tool` row), a model
 *     call that throws ends the stream with a fixed code and sentence, and a
 *     provider's error body reaches an admin only, on `upstream`.
 *   - POST /api/advisor/explain: a model call that throws answers with a fixed
 *     sentence; the stream's own `error` event is built by `refusalBody`.
 *
 * Real SQLite (the migrated schema), a stubbed `fetch` for Anthropic and a
 * stubbed Workers AI binding; no live call is made.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raw_exception_text_9189.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import projects from '../src/routes/projects.ts';
import assistant, { ASSISTANT_FAILED, ASSISTANT_UPSTREAM_FAILED, TOOL_FAILED } from '../src/routes/assistant.ts';
import advisor, { EXPLAIN_UPSTREAM_FAILED } from '../src/routes/advisor.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { schemaPath, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import { withGuard } from './_guard_stub.mjs';

const MARKER = 'MARKER_9189_d1_said_no_such_table_secret_internals';
const FOUNDER = 1;
const ADMIN = 900;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'raw-exception-9189-'));
  const file = join(dir, 'fixture.sqlite');
  copyFileSync(schemaPath(), file);
  const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  const close = db.close.bind(db);
  db.close = () => { try { close(); } finally { rmSync(dir, { recursive: true, force: true }); } };
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
    (${FOUNDER},'founder','Synthetic Founder','founder@example.test',11,1,'studio'),
    (${ADMIN},'admin','Synthetic Admin','admin@example.test',NULL,1,'studio');
    INSERT INTO founders(id,name,email) VALUES (11,'Synthetic Founder','founder@example.test');`);
  return db;
}

/** A D1 whose `activity_logs` read (the `recentActivity` tool) throws the marker. */
function throwingToolDb(db: DatabaseSync) {
  const d1: any = d1Over(db);
  const prepare = d1.prepare.bind(d1);
  d1.prepare = (sql: string) => /FROM activity_logs WHERE user_id/.test(sql)
    ? { bind: () => ({ all: async () => { throw new Error(MARKER); } }) }
    : prepare(sql);
  return d1;
}

async function post(app: Hono<any>, path: string, body: string, env: any, as = ADMIN) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(as, as === ADMIN ? 'admin' : 'founder')}` },
    body,
  }, env);
}

// ── projects/submit ─────────────────────────────────────────────────────────

const submitApp = new Hono<any>().route('/api/projects', projects);
submitApp.onError((e, c) => c.json({ error: e.message }, 500));

test('D9189 projects/submit: a body that is not a JSON object answers 400 with our sentence, no engine text', async () => {
  const db = fixture(); try {
    const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
    for (const body of ['null', '[]', '42', '"text"', '{not json']) {
      const res = await post(submitApp, '/api/projects/submit', body, env);
      const json = await res.json() as any;
      assert.equal(res.status, 400, `${body}: ${JSON.stringify(json)}`);
      assert.deepEqual(json, { error: 'Send the intake as a JSON object.', code: 'invalid_body' }, body);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get()?.n, 0, 'nothing was created');
  } finally { db.close(); }
});

test('D9189 projects/submit: a reserved field still answers 400 reserved_field with its own sentence', async () => {
  const db = fixture(); try {
    const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
    const field = 'total_score';
    const res = await post(submitApp, '/api/projects/submit', JSON.stringify({ name: 'Synthetic', [field]: 99 }), env);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: `Field "${field}" is server-computed and may not be supplied by the client.`, field, code: 'reserved_field',
    });
  } finally { db.close(); }
});

// ── assistant/message ───────────────────────────────────────────────────────

const assistantApp = new Hono<any>().route('/api/assistant', assistant);
assistantApp.onError((e, c) => c.json({ error: e.message }, 500));

function sse(events: unknown[]): Response {
  const text = events.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const toolUseHop = () => sse([
  { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'recentActivity', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"limit":3}' } },
  { type: 'message_delta', usage: { output_tokens: 1 } },
]);

function frames(text: string): Array<{ event: string; data: any }> {
  return text.split('\n\n').filter(Boolean).map((f) => {
    const event = /^event: (.*)$/m.exec(f)?.[1] || '';
    const data = /^data: (.*)$/m.exec(f)?.[1];
    return { event, data: data ? JSON.parse(data) : null };
  });
}

async function withFetch<T>(stub: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => stub(String(url), init)) as any;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

function assistantEnv(db: DatabaseSync, d1 = d1Over(db)) {
  return { DB: d1, JWT_SECRET, ENVIRONMENT: 'development', ENABLE_ANTHROPIC_DEV: '1', ANTHROPIC_API_KEY: 'test-key-not-real' };
}

async function enableAssistant(db: DatabaseSync, env: any) {
  // The column is lazily added by the route's schema bootstrap; run it once, then enable.
  await post(assistantApp, '/api/assistant/message', '{}', env, FOUNDER);
  db.exec('UPDATE users SET assistant_enabled = 1');
}

test('D9189 assistant: a throwing tool gives Eadwyn `tool_failed`, a throwing model call ends with a fixed error, and the marker reaches neither the stream nor the stored rows', async () => {
  const db = fixture(); try {
    const env = assistantEnv(db, throwingToolDb(db));
    await enableAssistant(db, env);
    const sent: string[] = [];
    let call = 0;
    const res = await withFetch(async (_url, init) => {
      sent.push(String(init.body));
      call += 1;
      if (call === 1) return toolUseHop();
      throw new Error(`${MARKER} upstream socket`);
    }, async () => {
      const r = await post(assistantApp, '/api/assistant/message', JSON.stringify({ message: 'What did I do recently?' }), env, FOUNDER);
      return { status: r.status, text: await r.text() };
    });
    assert.equal(res.status, 200);
    assert.equal(call, 2, 'the tool ran and a second hop was asked for');
    assert.ok(!res.text.includes(MARKER), res.text);
    const evts = frames(res.text);
    assert.deepEqual(evts.find(e => e.event === 'tool_result')?.data, { name: 'recentActivity', ok: false });
    assert.deepEqual(evts.at(-1), { event: 'error', data: { error: 'assistant_failed', message: ASSISTANT_FAILED, detail: ASSISTANT_FAILED } });
    // What Eadwyn was given on the second hop, and what the conversation keeps.
    assert.ok(!sent[1].includes(MARKER), 'the tool result sent to the model carries no exception text');
    assert.match(sent[1], new RegExp(`<tool_result>\\{\\\\"error\\\\":\\\\"${TOOL_FAILED}\\\\"\\}</tool_result>`));
    const tool = db.prepare("SELECT content FROM assistant_messages WHERE role = 'tool'").all().map((r: any) => r.content);
    assert.deepEqual(tool, [JSON.stringify({ error: TOOL_FAILED })]);
    const all = JSON.stringify(db.prepare('SELECT * FROM assistant_messages').all());
    assert.ok(!all.includes(MARKER), 'no stored message carries the marker');
  } finally { db.close(); }
});

test('D9189 assistant: a provider error body reaches an admin on `upstream` only; a member reads our sentence', async () => {
  for (const as of [FOUNDER, ADMIN]) {
    const db = fixture(); try {
      const env = assistantEnv(db);
      await enableAssistant(db, env);
      const text = await withFetch(async () => new Response(`{"error":"${MARKER}"}`, { status: 529 }), async () => {
        const r = await post(assistantApp, '/api/assistant/message', JSON.stringify({ message: 'hello' }), env, as);
        return r.text();
      });
      const last = frames(text).at(-1)!;
      assert.equal(last.event, 'error');
      const want: any = { status: 529, error: 'assistant_upstream_failed', message: ASSISTANT_UPSTREAM_FAILED, detail: ASSISTANT_UPSTREAM_FAILED };
      if (as === ADMIN) want.upstream = `{"error":"${MARKER}"}`;
      assert.deepEqual(last.data, want, `as ${as}`);
      if (as === FOUNDER) assert.ok(!text.includes(MARKER), text);
    } finally { db.close(); }
  }
});

// ── advisor/explain ─────────────────────────────────────────────────────────

const advisorApp = new Hono<any>().route('/api/advisor', advisor);
advisorApp.onError((e, c) => c.json({ error: e.message }, 500));

test('D9189 advisor/explain: a model call that throws answers our sentence; only an admin sees the provider text', async () => {
  for (const as of [FOUNDER, ADMIN]) {
    const db = fixture(); try {
      // D783: an allowance to hold against, so the run reaches the model.
      db.exec(`INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status)
        VALUES ('sub_fixture_${as}',${as},'founder',20000,'usd','month',1,'active')`);
      const ai = withGuard({ run: async () => { throw new Error(MARKER); } });
      const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI: ai };
      const res = await post(advisorApp, '/api/advisor/explain', JSON.stringify({ topic: 'What is a SAFE?' }), env, as);
      const text = await res.text();
      const json = JSON.parse(text);
      assert.equal(json.error, EXPLAIN_UPSTREAM_FAILED, text);
      if (as === FOUNDER) assert.ok(!text.includes(MARKER), text);
      else assert.ok(String(json.upstream).includes(MARKER), text);
    } finally { db.close(); }
  }
});

test('D9189 advisor/explain: the stream\'s error event passes what was thrown only as `raw` to refusalBody', () => {
  const src = readFileSync(new URL('../src/routes/advisor.ts', import.meta.url), 'utf8');
  const at = src.indexOf("advisor.post('/explain'");
  const route = src.slice(at, src.indexOf('\nadvisor.', at + 1));
  const errors = route.match(/sseEvent\('error',[\s\S]*?\)\)\)/g) || [];
  assert.equal(errors.length, 1, 'one error event in /explain');
  assert.match(errors[0], /refusalBody\(\{\s*code: 'explain_failed', message: EXPLAIN_FAILED, raw: e,/);
  assert.doesNotMatch(errors[0], /\.message\b(?!:)/);
});
