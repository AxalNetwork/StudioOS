/**
 * D1547 (#3792, deck v2 B16) — the acceptance fixtures for the operator
 * runbook `documentation/operations/DECK_GRID.md`.
 *
 * The runbook's SQL is read out of the file and run here, so an edit to the
 * runbook is an edit to what is tested:
 *
 *   1. Every ```sql block prepares on the real schema (every table and column
 *      it names exists), with its named placeholders bound.
 *   2. Unstick, step 2: a run left `cancelling` by an orphaned `running` step
 *      stays stuck on Stop; after the runbook's two statements, Stop closes it
 *      `cancelled` at what its finished steps charged, settles the hold once,
 *      and the deck admits a new run.
 *   3. Unstick, step 3: closing by hand ends the run `failed`, frees the
 *      deck, and the hold is released at zero on the member's next budget
 *      read after it expires.
 *   4. Purge: the runbook's reads find the deck that names the image and the
 *      copy under another uid; its write makes the file route answer 404;
 *      its undo serves it again.
 *   5. The routes, refusal codes and constants the runbook cites are the
 *      code's.
 *
 * Every person, venture and image here is invented. The staging run of each
 * step is recorded on #3792, not here.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grid_runbook_d1547.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { D1GenRuntime, stepRecordRef, type PlanLine, type StepExecutor } from '../src/services/decks/genRuntime.ts';
import { HOLD_TTL_MS, loadAiBudget } from '../src/services/aiBudget.ts';
import { MAX_SLICES } from '../src/services/decks/queueRuntime.ts';
import { REASON_MIN, NOTE_MAX, REQUIRED_MODELS } from '../src/services/ai/modelPolicy.ts';
import deckImages from '../src/routes/deck_images.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const RUNBOOK = readFileSync(new URL('../../documentation/operations/DECK_GRID.md', import.meta.url), 'utf8');
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** Every ```sql block of the runbook, in order. */
const SQL = [...RUNBOOK.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1].trim());
/** The one block that contains `marker`. */
function block(marker: string): string {
  const hits = SQL.filter((s) => s.includes(marker));
  assert.equal(hits.length, 1, `exactly one runbook SQL block holds ${JSON.stringify(marker)}`);
  return hits[0];
}
/** Its named placeholders, bound from `values` (each must be given). */
function binds(sql: string, values: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [, name] of sql.matchAll(/:([a-z_0-9]+)/g)) {
    assert.ok(name in values, `a value for :${name}`);
    out[name] = values[name];
  }
  return out;
}

const FOUNDER = 10, P = 1, OTHER_P = 2, DECK = 1;
const LINE = 1000;
const MODEL = '@cf/synthetic/primary';

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001)").run(FOUNDER);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${OTHER_P}, 'Heron Works', 1002)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, P, 'Synthetic deck', '[]');
  db.exec('DELETE FROM member_subscription_amounts');
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?)').run(FOUNDER, 50_000_000);
  return db;
}
const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;

test('1. every SQL block in the runbook prepares on the real schema, its placeholders bound', () => {
  const db = world();
  assert.ok(SQL.length >= 12, `the runbook holds its SQL (${SQL.length} blocks)`);
  const values = { model_id: MODEL, batch_uid: 'b', reservation_uid: 'r', image_uid: 'i', sha256: 'a'.repeat(64) };
  for (const sql of SQL) {
    assert.doesNotThrow(() => db.prepare(sql).all(binds(sql, values)), `runs: ${sql.slice(0, 80)}`);
  }
});

/** A run whose driver died: step 0 done, step 1 answered but left running, step 2 started with no answer, 3–5 waiting. */
async function crashedRun(db: DatabaseSync) {
  const ran: number[] = [];
  const execute: StepExecutor = async (step) => { ran.push(step.seq); return { ok: true, charged_microusd: 0 }; };
  const rt = new D1GenRuntime({ DB: d1Over(db) } as any, execute);
  const lines: PlanLine[] = Array.from({ length: 6 }, (_, i) => ({ card_uid: `c${i}`, area_id: `a${i}`, element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: LINE, input: { text: `synthetic ${i}` } }));
  const a = await rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: 'runbook-run-0001', lines });
  if (!a.ok) throw new Error(JSON.stringify(a));
  const hold = one(db, 'SELECT reservation_uid FROM deck_area_batches WHERE uid = ?', a.uid).reservation_uid as string;
  const usage = db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, 'rail_write', ?, ?, ?, ?)");
  usage.run(FOUNDER, MODEL, LINE, hold, stepRecordRef(a.uid, 0));
  usage.run(FOUNDER, MODEL, 700, hold, stepRecordRef(a.uid, 1));
  db.prepare("UPDATE deck_area_batches SET state = 'running', started_at = datetime('now') WHERE uid = ?").run(a.uid);
  db.prepare("UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = ?, ended_at = datetime('now') WHERE batch_uid = ? AND seq = 0").run(LINE, a.uid);
  db.prepare("UPDATE deck_area_batch_steps SET state = 'running', started_at = datetime('now') WHERE batch_uid = ? AND seq IN (1, 2)").run(a.uid);
  return { rt, uid: a.uid, hold, ran };
}
const stepStates = (db: DatabaseSync, uid: string) => (db.prepare('SELECT state FROM deck_area_batch_steps WHERE batch_uid = ? ORDER BY seq').all(uid) as any[]).map((r) => r.state);
const admitAgain = (rt: D1GenRuntime, key: string) => rt.admit({ deckId: DECK, projectId: P, userId: FOUNDER, cls: 'areas', idemKey: key, lines: [{ card_uid: 'c0', area_id: 'a0', element: 'body', kind: 'text', task: 'rail_write', model: MODEL, quote_microusd: LINE, input: { text: 'again' } }] });

test('2. unstick step 2: the orphaned step is settled the way rebuild does, then Stop closes the run once', async () => {
  const db = world();
  const { rt, uid, hold } = await crashedRun(db);
  assert.equal((await rt.cancel(uid, FOUNDER))?.state, 'cancelling', 'Stop alone leaves it stuck: a step is still running');
  const busy = await admitAgain(rt, 'runbook-run-0002');
  assert.equal(busy.ok, false, 'the deck is busy while it is stuck');
  assert.equal((busy as any).refusal, 'deck_busy');

  // The runbook's two statements, as written.
  for (const marker of ["SET state = 'done', charged_microusd = MIN(", "SET state = 'waiting', started_at = NULL"]) {
    const sql = block(marker);
    db.prepare(sql).run(binds(sql, { batch_uid: uid }));
  }
  assert.deepEqual(stepStates(db, uid), ['done', 'done', 'waiting', 'waiting', 'waiting', 'waiting'], 'the answered step is done, the unanswered one waits');
  assert.equal(one(db, 'SELECT charged_microusd AS n FROM deck_area_batch_steps WHERE batch_uid = ? AND seq = 1', uid).n, 700, 'at what it charged');

  const st = await rt.cancel(uid, FOUNDER);
  assert.equal(st?.state, 'cancelled');
  assert.deepEqual(stepStates(db, uid), ['done', 'done', 'stopped', 'stopped', 'stopped', 'stopped']);
  assert.equal(st?.charged_microusd, LINE + 700, 'charged only what the finished steps charged');
  assert.equal(one(db, 'SELECT status FROM ai_budget_reservations WHERE uid = ?', hold).status, 'settled', 'the hold is settled once');
  assert.equal((await admitAgain(rt, 'runbook-run-0003')).ok, true, 'the deck admits a new run');
});

test('2b. the answered-step statement caps the charge at the step quote', async () => {
  const db = world();
  const { uid, hold } = await crashedRun(db);
  db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, charged_microusd, reservation_uid, record_ref) VALUES (?, 'rail_write', ?, ?, ?, ?)").run(FOUNDER, MODEL, 5000, hold, stepRecordRef(uid, 1));
  const sql = block("SET state = 'done', charged_microusd = MIN(");
  db.prepare(sql).run(binds(sql, { batch_uid: uid }));
  assert.equal(one(db, 'SELECT charged_microusd AS n FROM deck_area_batch_steps WHERE batch_uid = ? AND seq = 1', uid).n, LINE);
});

test('3. unstick step 3: closed by hand, the deck is free and the hold is released at zero once it expires', async () => {
  const db = world();
  const { rt, uid, hold } = await crashedRun(db);
  const before = await loadAiBudget({ DB: d1Over(db) } as any, FOUNDER);
  for (const marker of ["SET state = 'done', charged_microusd = MIN(", "SET state = 'stopped', ended_at", "SET state = 'failed', charged_microusd"]) {
    const sql = block(marker);
    db.prepare(sql).run(binds(sql, { batch_uid: uid }));
  }
  const b = one(db, 'SELECT state, charged_microusd, settled_at FROM deck_area_batches WHERE uid = ?', uid);
  assert.equal(b.state, 'failed');
  assert.equal(b.charged_microusd, LINE + 700, "the run's own record keeps what its steps charged");
  assert.ok(b.settled_at);
  assert.deepEqual(stepStates(db, uid), ['done', 'done', 'stopped', 'stopped', 'stopped', 'stopped']);
  const find = block("WHERE state IN ('queued', 'running', 'cancelling') AND created_at <");
  db.prepare("UPDATE deck_area_batches SET created_at = datetime('now', '-2 hours') WHERE uid = ?").run(uid);
  assert.equal(db.prepare(find).all().length, 0, '"Find stuck runs" no longer lists it');
  assert.equal((await admitAgain(rt, 'runbook-run-0004')).ok, true, 'the deck admits a new run');

  assert.equal(one(db, 'SELECT status FROM ai_budget_reservations WHERE uid = ?', hold).status, 'pending', 'the hold is left to expire');
  await loadAiBudget({ DB: d1Over(db) } as any, FOUNDER, new Date(Date.now() + HOLD_TTL_MS + 60_000));
  assert.equal(one(db, 'SELECT status FROM ai_budget_reservations WHERE uid = ?', hold).status, 'refunded', 'released at zero on the next budget read');
  assert.ok(before, 'the budget read works on this schema');
});

/** A kept image named by a deck, its file in a fake R2, and a copy of the same bytes in another venture. */
function imageWorld() {
  const db = world();
  const UID = '0f6c2a54-1b9e-4c7d-9a31-5e8f2d7b6c40', COPY = '7d2e9b13-4a6f-4e08-b5c1-93a7f0c4d218';
  const SHA = 'c'.repeat(64);
  const add = db.prepare("INSERT INTO deck_images (uid, project_id, deck_id, r2_key, mime, source, use, state, model, sha256) VALUES (?, ?, ?, ?, 'image/png', ?, 'content', 'kept', ?, ?)");
  add.run(UID, P, DECK, `deck-images/${P}/${UID}.png`, 'generated', MODEL, SHA);
  add.run(COPY, OTHER_P, null, `deck-images/${OTHER_P}/${COPY}.png`, 'upload', null, SHA);
  db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = ?').run(JSON.stringify([{ uid: 'c1', blocks: [{ kind: 'image', image_id: UID, image_url: `/api/decks/images/${UID}/file` }] }]), DECK);
  const objects = new Map([[`deck-images/${P}/${UID}.png`, new Uint8Array([137, 80, 78, 71])]]);
  const env: any = { DB: d1Over(db), JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', ENVIRONMENT: 'development',
    FILES: { get: async (k: string) => (objects.has(k) ? { body: objects.get(k) } : null) } };
  const app = new Hono<any>().route('/api/decks', deckImages);
  const file = (uid: string) => app.request(`/api/decks/images/${uid}/file`, {}, env);
  return { db, UID, COPY, SHA, file };
}

test('4. purge: the reads find the deck and the copy; the write stops serving it; the undo serves it again', async () => {
  const { db, UID, COPY, SHA, file } = imageWorld();
  const before = await file(UID);
  assert.equal(before.status, 200);
  assert.match(before.headers.get('cache-control') ?? '', /public, max-age=31536000, immutable/, 'the runbook says a kept image is cached for a year');

  const row = block('FROM deck_images WHERE uid = :image_uid;');
  assert.equal(db.prepare(row).get(binds(row, { image_uid: UID }))?.r2_key, `deck-images/${P}/${UID}.png`, 'the read gives the r2_key wrangler deletes');
  const decks = block('SELECT d.id AS deck_id');
  assert.deepEqual(db.prepare(decks).all(binds(decks, { image_uid: UID })).map((r: any) => r.deck_id), [DECK], 'the deck that names it');
  const copies = block('sha256 = :sha256');
  assert.deepEqual(db.prepare(copies).all(binds(copies, { image_uid: UID, sha256: SHA })).map((r: any) => r.uid), [COPY], 'the same bytes under another uid');

  const purge = block("SET state = 'discarded', discarded_at = datetime('now') WHERE uid = :image_uid;");
  db.prepare(purge).run(binds(purge, { image_uid: UID }));
  assert.equal((await file(UID)).status, 404, 'the file route stops serving it at once');
  assert.equal((await file(COPY)).status, 404, 'the copy has no file in this fake R2 (untouched by the purge row write)');
  assert.equal(one(db, 'SELECT state FROM deck_images WHERE uid = ?', COPY).state, 'kept', 'the purge touched one uid only');

  const undo = block("SET state = 'kept', discarded_at = NULL");
  db.prepare(undo).run(binds(undo, { image_uid: UID }));
  assert.equal((await file(UID)).status, 200, 'the undo serves it while the R2 file exists');
});

test('5. the routes, refusal codes and constants the runbook cites are the code\'s', () => {
  const has = (text: string, what: string) => assert.ok(RUNBOOK.includes(what), `the runbook cites ${what}`) || assert.ok(text.includes(what.replace(/`/g, '')), `the code has ${what}`);
  // §1
  const policy = src('services/ai/modelPolicy.ts');
  for (const code of ['unknown_model', 'invalid_enabled', 'invalid_plan_min', 'invalid_note', 'reason_required', 'model_required']) has(policy, code);
  assert.equal(REASON_MIN, 10); assert.ok(RUNBOOK.includes('10 to 500 characters'));
  assert.equal(NOTE_MAX, 500); assert.ok(RUNBOOK.includes('up to 500 characters'));
  assert.deepEqual([...REQUIRED_MODELS], ['@cf/meta/llama-guard-3-8b']);
  assert.ok(RUNBOOK.includes('`@cf/meta/llama-guard-3-8b`'));
  assert.match(src('routes/admin_ai_element_models.ts'), /r\.put\('\/'[\s\S]*requireSuperAdmin[\s\S]*'ai_model_policy_set'/);
  assert.ok(RUNBOOK.includes('`PUT /api/admin/ai/element-models`'));
  assert.ok(!src('routes/admin_feature_flags.ts').includes('REQUIRED_MODELS'), 'the flag route still lacks the safety-model check: when it gains one, update "Known gaps"');
  assert.ok(RUNBOOK.includes('/admin/platform/decks/models'));
  assert.ok(readFileSync(new URL('../../frontend/src/routes/hqDecks.jsx', import.meta.url), 'utf8').includes('models'));
  // §2
  const budget = src('routes/ai_budget.ts');
  assert.match(budget, /\/reviews\/:uid\/\$\{action\}/); assert.match(budget, /\/members\/:userId\/adjustments/);
  assert.ok(RUNBOOK.includes('`POST /api/ai-budget/reviews/:uid/refund`'));
  assert.ok(RUNBOOK.includes('`POST /api/ai-budget/members/:userId/adjustments`'));
  // §3
  assert.equal(HOLD_TTL_MS, 300_000); assert.ok(RUNBOOK.includes('5 minutes'));
  assert.equal(MAX_SLICES, 500); assert.ok(RUNBOOK.includes('`MAX_SLICES` (500)'));
  const batches = src('routes/deck_batches.ts');
  has(batches, 'not_your_run');
  assert.ok(batches.includes('/areas/batches/:uid${UID}/cancel') && RUNBOOK.includes('`POST /api/decks/areas/batches/:uid/cancel`'));
  assert.ok(src('services/decks/genRuntime.ts').includes("refusal: 'deck_busy'") && RUNBOOK.includes('409 deck_busy'));
  // §4
  const images = src('routes/deck_images.ts');
  has(images, 'image_kept');
  assert.ok(images.includes("'public, max-age=31536000, immutable'"));
  assert.ok(images.includes('deck-images/${deck.projectId}/${uid}.'));
  assert.match(readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8'), /\[\[env\.production\.r2_buckets\]\]\nbinding\s+= "FILES"\nbucket_name = "studioos-files"/);
  assert.ok(RUNBOOK.includes('studioos-files/<r2_key>'));
});
