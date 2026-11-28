// #9184 — one JSON body reader: a malformed, null, array or scalar body is a
// 400 with a stable code, never the generic 500.
//
// Part one drives `readJsonObject` and `isMalformedJsonBody` through a bare
// Hono app. Part two sends `{bad`, `null`, `[]` and `"x"` to the public POST
// routes the fuzz named and to four signed-in writes, through `worker.fetch`
// on the fully migrated schema, and checks the `app.onError` backstop on a
// route that still reads its body bare.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/json_body_9184.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { readJsonObject, isMalformedJsonBody, BODY_NOT_OBJECT_MESSAGE, INVALID_JSON_MESSAGE } from '../src/util/jsonBody.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

// ---------------------------------------------------------------- the helper

const unit = new Hono();
unit.post('/read', async (c) => {
  const body = await readJsonObject(c);
  if (body instanceof Response) return body;
  return c.json({ got: body });
});
unit.post('/optional', async (c) => {
  const body = await readJsonObject(c, { allowEmpty: true });
  if (body instanceof Response) return body;
  return c.json({ got: body });
});
unit.all('/malformed', async (c) => c.json({ malformed: await isMalformedJsonBody(c) }));

const send = async (path: string, body: string | undefined, method = 'POST') => {
  const res = await unit.request(path, { method, headers: { 'content-type': 'application/json' }, body });
  return { status: res.status, json: await res.json() as any };
};

test('readJsonObject returns a plain object as it was sent', async () => {
  assert.deepEqual(await send('/read', '{"a":1,"b":{"c":[2]}}'), { status: 200, json: { got: { a: 1, b: { c: [2] } } } });
  assert.deepEqual(await send('/read', '{}'), { status: 200, json: { got: {} } });
});

test('readJsonObject refuses null, an array and each scalar with body_not_object', async () => {
  for (const raw of ['null', '[]', '[{"a":1}]', '"x"', '42', 'true', 'false']) {
    const r = await send('/read', raw);
    assert.equal(r.status, 400, raw);
    assert.deepEqual(r.json, { error: 'body_not_object', message: BODY_NOT_OBJECT_MESSAGE, detail: BODY_NOT_OBJECT_MESSAGE }, raw);
  }
});

test('readJsonObject refuses invalid JSON and an empty body with invalid_json', async () => {
  for (const raw of ['{bad', '{"a":', 'undefined', "{'a':1}", '', '   ']) {
    const r = await send('/read', raw);
    assert.equal(r.status, 400, JSON.stringify(raw));
    assert.deepEqual(r.json, { error: 'invalid_json', message: INVALID_JSON_MESSAGE, detail: INVALID_JSON_MESSAGE }, JSON.stringify(raw));
  }
  assert.equal((await send('/read', undefined)).json.error, 'invalid_json');
});

test('allowEmpty reads no body as {} and still refuses a bad one', async () => {
  assert.deepEqual(await send('/optional', undefined), { status: 200, json: { got: {} } });
  assert.deepEqual(await send('/optional', ''), { status: 200, json: { got: {} } });
  assert.equal((await send('/optional', '{bad')).json.error, 'invalid_json');
  assert.equal((await send('/optional', 'null')).json.error, 'body_not_object');
});

test('isMalformedJsonBody is true only for a write whose own body does not parse', async () => {
  assert.equal((await send('/malformed', '{bad')).json.malformed, true);
  assert.equal((await send('/malformed', '')).json.malformed, true);
  assert.equal((await send('/malformed', '{"a":1}')).json.malformed, false);
  assert.equal((await send('/malformed', 'null')).json.malformed, false);
  assert.equal((await send('/malformed', undefined, 'GET')).json.malformed, false);
});

// --------------------------------------------------------- the real Worker

const SECRET = 'json-body-9184-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const MEMBER = 2, PARTNER = 3;
let db: any, env: any;
const sessions: Record<number, string> = {};
const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
let realFetch: typeof fetch;

const jwt = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

async function call(path: string, raw: string, who?: number) {
  const res = await worker.fetch(new Request(`https://unit.test${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${sessions[who]}` } : {}) },
    body: raw,
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  await Promise.all(pending.splice(0));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, is_active) VALUES
    (${MEMBER},'u-mem','Body Member','member@example.test','founder',1),
    (${PARTNER},'u-ptr','Body Partner','partner@example.test','partner',1);`);
  env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(), APP_URL: 'https://unit.test' };
  for (const id of [MEMBER, PARTNER]) sessions[id] = await jwt({ user_id: id });
  // No route here should reach a provider; anything that tries gets a refusal, not the network.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 599 })) as unknown as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; removeMigratedDatabases(); });

const BAD: Array<[string, string]> = [['{bad', 'invalid_json'], ['null', 'body_not_object'], ['[]', 'body_not_object'], ['"x"', 'body_not_object']];

const PUBLIC_ROUTES = [
  '/api/contact',
  '/api/newsletter/subscribe',
  '/api/public/demo-request',
  '/api/public/events/no-such-event/register',
  '/api/public/invite/no-such-token/respond',
  '/api/public/jobs/no-such-job/apply',
  '/api/auth/resend-verification',
];
const SIGNED_IN_ROUTES = ['/api/deals', '/api/partners', '/api/legal/documents', '/api/advisory/ask'];

test('each public POST route answers a malformed or non-object body with 400, never 500', async () => {
  for (const path of PUBLIC_ROUTES) {
    for (const [raw, code] of BAD) {
      const r = await call(path, raw);
      assert.equal(r.status, 400, `${path} ${raw}: ${r.text}`);
      assert.equal(r.json?.error, code, `${path} ${raw}`);
    }
  }
});

test('each signed-in write answers a malformed or non-object body with 400, never 500', async () => {
  for (const path of SIGNED_IN_ROUTES) {
    for (const [raw, code] of BAD) {
      const r = await call(path, raw, MEMBER);
      assert.equal(r.status, 400, `${path} ${raw}: ${r.text}`);
      assert.equal(r.json?.error, code, `${path} ${raw}`);
    }
  }
});

test('the sign-in gate still comes before the body on a signed-in write', async () => {
  const r = await call('/api/deals', '{bad');
  assert.equal(r.status, 401);
});

test('app.onError answers a bare read of a malformed body with 400 invalid_json', async () => {
  // /api/scoring/generateMemo still reads `await c.req.json()` bare.
  const bad = await call('/api/scoring/generateMemo', '{bad', PARTNER);
  assert.equal(bad.status, 400, bad.text);
  assert.equal(bad.json?.error, 'invalid_json');
  assert.equal(bad.json?.message, INVALID_JSON_MESSAGE);
  const ok = await call('/api/scoring/generateMemo', '{"startup_name":"Body Co"}', PARTNER);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json?.startup_name, 'Body Co');
});

test('a valid public body still reaches the route', async () => {
  const r = await call('/api/contact', JSON.stringify({ hp: 'bot-filled' }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true });
});
