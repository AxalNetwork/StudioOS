/**
 * #3935 (D1478 task 1, part 2): the drawn covers, EV2 (an event) and LE8 (a
 * course). Synthetic data, the mounted Worker routes and the real migrated
 * schema in memory; `env.AI` is a stub, R2 is a map and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cover_draws_3935.test.ts
 *
 *   · each cover runs its job's Default with the gate on and its fallback with
 *     the gate off, and the answer names the model that drew;
 *   · a face in the drawn image is refused with REAL_PERSON_MESSAGE and nothing
 *     is stored; a face word in the description is refused before any model;
 *   · one quote holds the draw and its three checks;
 *   · only the host (or an admin) draws an event's cover, only a Super Admin a
 *     course's; the press writes nothing, and a draft's cover is not public.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import adminLearning from '../src/routes/admin_learning.ts';
import learning from '../src/routes/learning.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { REAL_PERSON_MESSAGE } from '../src/services/aiImages.ts';
import { FACE_MODEL } from '../src/services/ai/postDraw.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-3935-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const HOST = 2, OTHER = 3, ADMIN = 9;
const COURSE = 'crs_synthetic_1';

async function fixture({ face = 'NO', screen = 'NO', partner = false } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role] of [[HOST, 'founder'], [OTHER, 'founder'], [ADMIN, 'admin']] as const) insert.run(id, role, null, `Synthetic ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  // The Super Admin pays a plan (C (b): a partner model runs on a paid plan only); the host does not.
  db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES ('sub_test_3935b', ?, 'founder', 4900, 'usd', 'month', 1, 'active')`).run(ADMIN);
  db.prepare("INSERT INTO events(id, slug, host_user_id, title, starts_at, status, visibility) VALUES (1, 'synthetic-meetup', ?, 'Synthetic meetup', '2026-12-01T18:00:00Z', 'draft', 'private')").run(HOST);
  db.prepare("INSERT INTO learning_courses(uid, slug, title, status, created_by) VALUES (?, 'synthetic-course', 'Synthetic course', 'draft', ?)").run(COURSE, ADMIN);
  for (const u of [HOST, OTHER, ADMIN]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(u, 5_000_000);
  for (const key of ['founder:free', 'founder:studio', 'admin:free', 'admin:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const calls: Array<{ model: string; what: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const text = JSON.stringify(input ?? {});
      if (model === FACE_MODEL) { calls.push({ model, what: 'face' }); return { answer: face }; }
      if (model === SCOUT) {
        const what = /nudity/.test(text) ? 'screen' : 'alt';
        calls.push({ model, what });
        return { response: what === 'screen' ? screen : 'A harbour at dawn in warm colours.', usage: { prompt_tokens: 40, completion_tokens: 8 } };
      }
      calls.push({ model, what: 'draw' });
      return { image: PNG };
    },
  });
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES, ...(partner ? { AI_PARTNER_MODELS: 'on' } : {}) };
  const app = new Hono<any>().route('/api/events', events).route('/api/admin/learning', adminLearning).route('/api/learning', learning);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, task FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const holds = () => (db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status IN ('pending','review')").get() as any).n as number;
  return { db, env, app, calls, r2, runs, holds, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number | null, path: string, json?: unknown) {
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await token(who)}` } : {};
  if (json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: json !== undefined ? 'POST' : 'GET', headers, body: json !== undefined ? JSON.stringify(json) : undefined }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())) as any, headers: res.headers };
}
const ASK = { prompt: 'A harbour at dawn, warm colours' };

test('EV2: the host prices a cover in one quote, draws it on the fallback with the gate off, and the checks run in order', async () => {
  const f = await fixture();
  try {
    const q = await call(f, HOST, '/api/events/1/cover/quote', ASK);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual([q.body.model, q.body.model_label], [SCHNELL, 'FLUX.1 Schnell']);
    assert.ok(q.body.draw_microusd > 0 && q.body.checks_microusd > 0, 'the draw and the checks are both held');
    assert.equal(q.body.hold_microusd, q.body.draw_microusd + q.body.checks_microusd, 'one figure');
    assert.equal(q.body.draw.source, 'fallback', 'Klein 9B is held by Legal and the gate is off');
    assert.deepEqual(f.calls, [], 'a quote runs nothing');
    const r = await call(f, HOST, '/api/events/1/cover/draw', ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(f.calls.map((c) => c.what), ['draw', 'face', 'screen', 'alt']);
    assert.equal(f.calls[0].model, SCHNELL);
    assert.equal(r.body.model_label, 'FLUX.1 Schnell', 'the receipt names the model that drew');
    assert.equal(r.body.alt, 'A harbour at dawn in warm colours.');
    assert.match(r.body.url, /^https:\/\/axal\.vc\/api\/events\/1\/cover\/cover-[0-9a-f-]{36}\.png$/);
    assert.equal(r.body.key, undefined, 'the R2 key is not answered');
    assert.deepEqual([...f.r2.keys()].map((k) => k.replace(/cover-.*$/, 'cover-*')), ['events/1/covers/cover-*']);
    assert.deepEqual(f.runs().map((x) => `${x.user_id}:${x.task}`), [`${HOST}:event_cover`, `${HOST}:module_vision`, `${HOST}:image_screen`, `${HOST}:image_alt_text`], 'each run is the host\'s');
    assert.equal(f.holds(), 0, 'every hold settled');
    assert.equal((f.db.prepare('SELECT cover_url FROM events WHERE id = 1').get() as any).cover_url, null, 'the press writes nothing; Save does');
    // The cover reads back for the host, never for someone who cannot see the draft.
    const path = new URL(r.body.url).pathname;
    assert.equal((await call(f, HOST, path)).status, 200);
    assert.equal((await call(f, null, path)).status, 404);
    assert.equal((await call(f, OTHER, path)).status, 404);
    assert.equal((await call(f, HOST, '/api/events/1/cover/..%2F..%2Fsecret.png')).status, 404, 'only a cover\'s own name is read');
  } finally { f.close(); }
});

test('a face in the drawn image is refused with REAL_PERSON_MESSAGE, and nothing is stored', async () => {
  const f = await fixture({ face: 'Yes' });
  try {
    const r = await call(f, HOST, '/api/events/1/cover/draw', ASK);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.error, 'real_person');
    assert.equal(r.body.message, REAL_PERSON_MESSAGE);
    assert.deepEqual(f.calls.map((c) => c.what), ['draw', 'face'], 'nothing runs after the face');
    assert.equal(f.r2.size, 0, 'nothing is stored');
  } finally { f.close(); }
  const flagged = await fixture({ screen: 'YES' });
  try {
    const r = await call(flagged, HOST, '/api/events/1/cover/draw', ASK);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'image_blocked');
    assert.equal(flagged.r2.size, 0);
  } finally { flagged.close(); }
});

test('a face word in the description, or a member who is not the host, is refused before any model', async () => {
  const f = await fixture();
  try {
    const face = await call(f, HOST, '/api/events/1/cover/draw', { prompt: 'A portrait of our founders on stage' });
    assert.equal(face.status, 422);
    assert.equal(face.body.message, REAL_PERSON_MESSAGE);
    assert.equal((await call(f, OTHER, '/api/events/1/cover/draw', ASK)).status, 403);
    assert.equal((await call(f, OTHER, '/api/events/1/cover/quote', ASK)).status, 403);
    assert.equal((await call(f, HOST, '/api/events/1/cover/draw', { prompt: '' })).status, 400);
    assert.deepEqual(f.calls, []);
    assert.equal(f.holds(), 0);
  } finally { f.close(); }
});

test('LE8: with the gate on, a paying Super Admin\'s course cover runs its Default, Klein 4B, and the gate off falls back to Schnell', async () => {
  const f = await fixture({ partner: true });
  try {
    const q = await call(f, ADMIN, `/api/admin/learning/courses/${COURSE}/cover/quote`, ASK);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual([q.body.model, q.body.draw.source], [KLEIN4, 'default']);
    const r = await call(f, ADMIN, `/api/admin/learning/courses/${COURSE}/cover/draw`, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.calls[0].model, KLEIN4);
    assert.equal(r.body.model_label, 'FLUX.2 Klein 4B');
    assert.match(r.body.url, new RegExp(`/api/learning/courses/${COURSE}/cover/cover-`));
    assert.equal((f.db.prepare('SELECT cover_url FROM learning_courses WHERE uid = ?').get(COURSE) as any).cover_url, null);
    const path = new URL(r.body.url).pathname;
    assert.equal((await call(f, null, path)).status, 404, 'a draft course\'s cover is not public');
    assert.equal((await call(f, ADMIN, path)).status, 200);
    f.db.prepare("UPDATE learning_courses SET status = 'published' WHERE uid = ?").run(COURSE);
    const pub = await call(f, null, path);
    assert.equal(pub.status, 200, 'a published course\'s cover is');
    assert.equal(pub.headers.get('content-type'), 'image/png');
    // Only a Super Admin draws a course's cover.
    assert.notEqual((await call(f, HOST, `/api/admin/learning/courses/${COURSE}/cover/draw`, ASK)).status, 200);
  } finally { f.close(); }
  // The gate off: the course cover falls back to Schnell.
  const off = await fixture();
  try {
    const r = await call(off, ADMIN, `/api/admin/learning/courses/${COURSE}/cover/draw`, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(off.calls[0].model, SCHNELL);
    assert.equal(r.body.draw.source, 'fallback');
  } finally { off.close(); }
});

test('both covers are drawn wide: the press asks for 16:9, which is a true size on Klein', async () => {
  const { COURSE_COVER, EVENT_COVER, coverRunOptions } = await import('../src/services/coverDraws.ts');
  const { drawRequest } = await import('../src/services/ai/shapes.ts');
  for (const kind of [EVENT_COVER, COURSE_COVER]) {
    const opts = coverRunOptions(kind, 2, 'A harbour at dawn');
    assert.equal(opts.draw?.aspect, '16:9', kind.job);
    assert.deepEqual([opts.drawJob, opts.task], [kind.job, kind.task]);
    assert.match(opts.text ?? '', /no identifiable people\.$/, 'the prompt asks for no people');
    const sent = drawRequest(KLEIN4, opts.text ?? '', opts.draw!)!.sent;
    assert.deepEqual([sent.width, sent.height], [1024, 576]);
  }
});
