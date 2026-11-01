/**
 * D1524 (#3776, deck v2 A25) — the AIRail's plain usage meter for one deck:
 * `GET /api/decks/:id/usage` (`routes/deck_usage.ts`, `services/decks/usage.ts`).
 *
 *   · the estimate equals #3754's quote lines (`estimateDeck`, the same lines
 *     `GET …/element-models` prices), and a 12-card Balanced deck is at most
 *     $0.40 (owner decision D, S1's pick B);
 *   · spent is the ledger's charges on this venture's deck, with guard rows;
 *     an unrecorded charge is "Could not be read", never $0.00;
 *   · the rail renders no action or prompt control (frontend case, in
 *     `frontend/test/deck_usage_d1524.test.mjs`).
 *
 * The real migrated schema in memory (no file copies); `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_usage_d1524.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckUsage from '../src/routes/deck_usage.ts';
import deckElementModels from '../src/routes/deck_element_models.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { estimateDeck } from '../src/services/decks/elementModels.ts';
import { deckCounts, deckEstimate } from '../src/services/decks/usage.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const PAGE = 'Founder · Raise · Pitch deck';
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1524-only-not-a-real-credential'.repeat(2);

/** A Balanced 12-card deck: a title band and a body on every card, a picture on three. */
function balanced(): any[] {
  return Array.from({ length: 12 }, (_, i) => ({
    structure: 'title_body', title: `Card ${i + 1}`,
    areas: [{ id: 'title', c1: 1, c2: 12, r1: 1, r2: 1, order: 1, inset: 0, align: 'start', role: 'title' }, { id: 'body', c1: 1, c2: 12, r1: 2, r2: 6, order: 2, inset: 0, align: 'start' }],
    blocks: i % 4 === 1 ? [{ kind: 'image', grid: { c1: 1, c2: 12, r1: 2, r2: 6 } }] : [{ kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 6 }, paras: [] }],
  }));
}

async function fixture(slides: any[] = balanced()) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[2, 'founder', 100, 'studio'], [4, 'founder', 400, 'studio']] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(4,'Synthetic other venture',400)");
  db.prepare("INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current) VALUES (7,1,2,?,'Synthetic deck',1),(6,1,1,'[]','Older version',0),(9,4,1,'[]','Other',1)").run(JSON.stringify(slides));
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES: {} };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckElementModels).route('/api/decks', deckUsage);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  return { db, env, app, close: () => { globalThis.fetch = real; db.close(); } };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function call(f: F, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}
const charge = (f: F, o: { record: string | null; page?: string | null; micro: number | null; guardFor?: number | null }) => Number(f.db.prepare(
  "INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, rail_page, rail_option, record_ref, guard_for) VALUES (2, 'rail_write', ?, ?, ?, 'deck:rewrite', ?, ?)",
).run(LLAMA, o.micro, o.page === undefined ? PAGE : o.page, o.record, o.guardFor ?? null).lastInsertRowid);

test('the counts: a title band is a title, a text or empty area a body, an image a photo; metrics and links run no model', () => {
  // Mutation checked: an empty area counted as nothing → the body count fails (the run writes into it).
  const counts = deckCounts([
    ...balanced().slice(0, 2),
    { title: 'Metrics', areas: [{ id: 'a1', c1: 1, c2: 6, r1: 1, r2: 6, order: 1, inset: 0, align: 'start' }, { id: 'a2', c1: 7, c2: 12, r1: 1, r2: 6, order: 2, inset: 0, align: 'start' }],
      blocks: [{ kind: 'metric', grid: { c1: 1, c2: 6, r1: 1, r2: 6 } }], notes: 'Say the number slowly.' },
  ]);
  assert.deepEqual(counts, { title: 3, body: 2, photo: 1, speaker_notes: 1 });
});

test('the estimate equals the quote lines, and a 12-card Balanced deck is at most $0.40 (owner decision D)', async () => {
  // Mutation checked: the route pricing its own sum (per_run × count from GET element-models, ignoring free lines) is
  // equal today, so the mutation checked is a second multiplier: multiplierFor replaced by 1 → the equality with the
  // element-models quote fails for a member whose multiplier is not 1.
  const f = await fixture();
  try {
    const r = await call(f, 2, '/api/decks/7/usage');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.estimated.available, true);
    const models = await call(f, 2, '/api/decks/7/element-models');
    const per = Object.fromEntries(models.body.elements.map((e: any) => [e.element, e.per_run_microusd]));
    // Each line is the element-models quote line times its count: one pricing path.
    for (const line of r.body.estimated.lines) assert.equal(line.per_microusd, per[line.element], `${line.element}: the same quote line`);
    assert.equal(r.body.estimated.value_microusd, r.body.estimated.lines.reduce((s: number, l: any) => s + l.microusd, 0));
    const mine = deckEstimate(balanced(), Object.fromEntries(models.body.elements.map((e: any) => [e.element, e.resolved.model])), 1.25);
    assert.equal(r.body.estimated.value_microusd, mine.total_microusd);
    assert.ok(r.body.estimated.value_microusd <= 400_000, `a 12-card Balanced deck quotes $${r.body.estimated.value_microusd / 1e6}, over $0.40`);
    assert.equal(r.body.units.text_area_microusd, per.body);
    assert.equal(r.body.units.image_microusd, per.photo);
  } finally { f.close(); }
});

test('spent: the ledger\'s charges on this venture\'s deck, any version, with guard rows; unrecorded is "Could not be read"', async () => {
  // Mutations checked: the guard rows dropped → the 1500 assert fails; an unrecorded charge read as 0 → the unavailable
  // assert fails; project rows from another page counted → the 1500 assert fails.
  const f = await fixture();
  try {
    assert.deepEqual((await call(f, 2, '/api/decks/7/usage')).body.spent, { available: true, value_microusd: 0, runs: 0 }, 'a deck with no runs has spent nothing, recorded');
    const run = charge(f, { record: 'deck:7', micro: 1000 });
    charge(f, { record: null, micro: 100, page: null, guardFor: run }); // a guard row names its run, not the record
    charge(f, { record: 'deck:6', micro: 300 });
    charge(f, { record: 'project:1', micro: 100 });
    charge(f, { record: 'project:1', micro: 9000, page: 'Founder · Raise · Cap table' });
    charge(f, { record: 'deck:9', micro: 7000 });
    const r = await call(f, 2, '/api/decks/7/usage');
    assert.deepEqual(r.body.spent, { available: true, value_microusd: 1500, runs: 4 });
    charge(f, { record: 'deck:7', micro: null });
    assert.deepEqual((await call(f, 2, '/api/decks/7/usage')).body.spent, { available: false, reason: 'Could not be read' });
    assert.equal((await call(f, 4, '/api/decks/7/usage')).status, 403, 'another venture\'s founder');
    assert.ok(!r.text.includes('example.invalid'), 'no email');
  } finally { f.close(); }
});

test('an unpriced line makes the total unknown, and a stale pick never zeroes the deck\'s estimate', async () => {
  // The route maps a null total to { available: false, reason: 'Could not be read' } (deck_usage.ts); a resolvable
  // unpriced model cannot be built from the catalogue, so that mapping is held by estimateDeck's null below.
  const f = await fixture();
  try {
    f.db.exec("INSERT INTO deck_model_picks(scope, scope_id, key, model, locked, plan_min, set_by) VALUES ('deck', '1', 'body', '@cf/synthetic/unpriced-model', 0, NULL, 2)");
    const r = await call(f, 2, '/api/decks/7/usage');
    assert.equal(r.status, 200, r.text);
    // The stale pick is cleared and the default runs; the estimate is priced from it. With the default priced, it is available.
    assert.equal(r.body.estimated.available, true);
    const forced = estimateDeck({ body: 2 }, { body: '@cf/synthetic/unpriced-model' }, 1);
    assert.equal(forced.total_microusd, null, 'an unpriced line makes the total unknown');
  } finally { f.close(); }
});
