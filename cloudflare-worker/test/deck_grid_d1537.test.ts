/**
 * D1537 (#3786, deck v2 B10) — the Grid's health for HQ.
 *
 *   1. the metrics per element and model, from the run steps: the error rate,
 *      p95 against its target, cost, fallbacks, the drift flag and the eval
 *      score as not recorded; outside the window and unfinished steps left out;
 *   2. the error budget (99% over 28 days) and its alert: a quarter burned in
 *      the last hour tells each active HQ admin once that hour; under a quarter
 *      tells no one;
 *   3. the KPIs: decks with 3+ generations, quote conversion by price band,
 *      the time from the first deck to the first share, and 4-week retention;
 *      nothing to count is null, never 0;
 *   4. the reads: HQ admins only (a founder and a branch refused), `days`
 *      checked, an unreadable figure null while the others answer.
 *
 * Real SQLite with the whole schema. Every venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_grid_d1537.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckGrid from '../src/routes/admin_deck_grid.ts';
import { PRICE_BANDS, drifted, errorBudget, funnelKpis, gridMetrics, noteErrorBudgetAlert, percentile } from '../src/services/decks/gridHealth.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-grid-1537-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-1537-only-not-a-real-credential'.repeat(2);
let n = 0;

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FLUX = '@cf/black-forest-labs/flux-1-schnell';
const GONE = '@cf/retired/no-such-model';
const ADMIN = 1, ADMIN2 = 2, OFF_ADMIN = 3, FOUNDER = 4;
const ago = (days: number) => `datetime('now', '-${days} days')`;
const agoMin = (min: number) => `datetime('now', '-${min} minutes')`;

function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const u = db.prepare('INSERT INTO users(id, uid, role, name, email, is_active) VALUES (?, ?, ?, ?, ?, ?)');
  u.run(ADMIN, 'u-a1', 'admin', 'Ada Admin', 'ada@example.invalid', 1);
  u.run(ADMIN2, 'u-a2', 'admin', 'Abe Admin', 'abe@example.invalid', 1);
  u.run(OFF_ADMIN, 'u-a3', 'admin', 'Old Admin', 'old@example.invalid', 0);
  u.run(FOUNDER, 'u-f', 'founder', 'Fay Founder', 'fay@example.invalid', 1);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return { db, env, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;

let batchN = 0;
function batch(f: F, opts: { project?: number; deck?: number; state?: string; created?: string; settled?: string | null }) {
  const uid = `b${++batchN}`;
  f.db.exec(`INSERT INTO deck_area_batches(uid, deck_id, project_id, state, quote_microusd, idem_key, created_by, created_at, settled_at)
    VALUES ('${uid}', ${opts.deck ?? 1}, ${opts.project ?? 1}, '${opts.state ?? 'done'}', 0, 'k-${uid}', ${FOUNDER}, ${opts.created ?? ago(1)}, ${opts.settled === undefined ? (opts.created ?? ago(1)) : opts.settled ?? 'NULL'})`);
  return uid;
}
let seq = 0;
function step(f: F, b: string, s: { element: string; kind: string; model: string | null; state: string; secs?: number; charged?: number; fallback?: 0 | 1 }) {
  f.db.prepare(`INSERT INTO deck_area_batch_steps(batch_uid, seq, card_uid, area_id, element, kind, model, model_used, state, charged_microusd, fallback_used, started_at, ended_at)
    VALUES (?, ?, 'c1', 'a1', ?, ?, ?, ?, ?, ?, ?, '2026-11-01 10:00:00', datetime('2026-11-01 10:00:00', ?))`)
    .run(b, ++seq, s.element, s.kind, s.model, s.model, s.state, s.charged ?? 0, s.fallback ?? 0, `+${s.secs ?? 1} seconds`);
}

test('1. the metrics per element and model: error rate, p95 against its target, cost, fallbacks, drift; eval not recorded', async () => {
  // Mutation checked: failed steps not counted → the error rate fails; the p95 taken as the mean → its value fails;
  // the target compare inverted → over_target fails; drift always false → the retired model's flag fails; the window ignored → the old step counts.
  const f = fixture();
  try {
    const b = batch(f, {});
    // Twenty text steps on Llama: 1..19 s done, one failed; the 95th percentile of the 19 done is 19 s.
    for (let i = 1; i <= 19; i += 1) step(f, b, { element: 'title', kind: 'text', model: LLAMA, state: 'done', secs: i, charged: 100 });
    step(f, b, { element: 'title', kind: 'text', model: LLAMA, state: 'failed', charged: 0, fallback: 1 });
    step(f, b, { element: 'title', kind: 'text', model: LLAMA, state: 'running' });
    step(f, b, { element: 'photo', kind: 'image', model: FLUX, state: 'done', secs: 4, charged: 2000 });
    step(f, b, { element: 'photo', kind: 'image', model: GONE, state: 'done', secs: 3 });
    const old = batch(f, { created: ago(40) });
    step(f, old, { element: 'title', kind: 'text', model: LLAMA, state: 'failed' });
    const { rows } = await gridMetrics(f.env, 30);
    const row = (m: string) => rows.find((r) => r.model === m)!;
    const t = row(LLAMA);
    assert.deepEqual([t.steps, t.done, t.failed, t.error_rate], [20, 19, 1, 0.05]);
    assert.deepEqual([t.p95_seconds, t.p95_target_seconds, t.p95_over_target], [19, 5, true]);
    assert.deepEqual([t.cost_microusd, t.fallbacks, t.drift], [1900, 1, false]);
    assert.deepEqual(t.eval_score, { available: false, reason: 'not_recorded' });
    assert.deepEqual([row(FLUX).p95_over_target, row(FLUX).p95_target_seconds, row(FLUX).cost_microusd], [false, 10, 2000]);
    assert.equal(row(GONE).drift, true, 'a model the catalogue no longer holds');
    assert.equal(drifted(null), false);
    assert.deepEqual([percentile([], 95), percentile([3, 1, 2], 50)], [null, 2]);
  } finally { f.close(); }
});

test('2. the error budget: a quarter burned in the last hour alerts each active HQ admin once; under a quarter, no one', async () => {
  // Mutation checked: the once-per-hour claim dropped → the second check notifies again; inactive admins not filtered → three notices;
  // the quarter threshold dropped → the quiet case alerts; cancelled batches counted as failed → the rates fail.
  const f = fixture();
  try {
    // 400 finished batches in 28 days: budget 4 failed. One failed a week ago, one in the last hour (a quarter).
    f.db.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 398)
      INSERT INTO deck_area_batches(uid, deck_id, project_id, state, quote_microusd, idem_key, created_by, created_at, settled_at)
      SELECT 'ok' || i, 1, 1, 'done', 0, 'k-ok' || i, ${FOUNDER}, ${ago(3)}, ${ago(3)} FROM c`);
    batch(f, { state: 'failed', created: ago(7) });
    batch(f, { state: 'cancelled', created: agoMin(20) });
    batch(f, { state: 'failed', created: agoMin(30) });
    batch(f, { state: 'failed', created: ago(40) });
    const b = await errorBudget(f.env);
    assert.deepEqual([b.finished, b.failed, b.budget_failures, b.last_hour_failed], [400, 2, 4, 1]);
    assert.equal(b.success_rate, 0.995);
    assert.deepEqual([b.used_fraction, b.last_hour_fraction, b.alerting], [0.5, 0.25, true]);
    assert.equal(await noteErrorBudgetAlert(f.env), true);
    assert.equal(await noteErrorBudgetAlert(f.env), false, 'once per hour');
    const sent = f.db.prepare("SELECT user_id, link FROM notifications_inbox WHERE type = 'deck_error_budget_alert' ORDER BY user_id").all() as any[];
    assert.deepEqual(sent.map((s) => s.user_id), [ADMIN, ADMIN2], 'active HQ admins only');
    assert.equal(sent[0].link, '/admin/platform/decks/grid');

    const quiet = fixture();
    try {
      quiet.db.exec(`WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM c WHERE i < 799)
        INSERT INTO deck_area_batches(uid, deck_id, project_id, state, quote_microusd, idem_key, created_by, created_at, settled_at)
        SELECT 'q' || i, 1, 1, 'done', 0, 'k-q' || i, ${FOUNDER}, ${ago(2)}, ${ago(2)} FROM c`);
      batch(quiet, { state: 'failed', created: agoMin(10) });
      const q = await errorBudget(quiet.env);
      assert.deepEqual([q.budget_failures, q.last_hour_fraction, q.alerting], [8, 0.125, false]);
      assert.equal(await noteErrorBudgetAlert(quiet.env), false);
    } finally { quiet.close(); }
    const empty = fixture();
    try {
      const e = await errorBudget(empty.env);
      assert.deepEqual([e.success_rate, e.budget_failures, e.used_fraction, e.alerting], [null, null, null, false], 'nothing finished is not a 0');
    } finally { empty.close(); }
  } finally { f.close(); }
});

test('3. the KPIs: 3+ generations, quote conversion by band, first share, 4-week retention; nothing to count is null', async () => {
  // Mutation checked: the 3-generation threshold at 2 → the count fails; a band boundary off by one band → the band counts fail;
  // retention without the 28-day gap → the cohort's retained count fails.
  const f = fixture();
  try {
    const prop = f.db.prepare(`INSERT INTO deck_area_proposals(uid, deck_id, project_id, card_uid, area_id, element, created_by, expires_at, created_at)
      VALUES (?, ?, ?, 'c1', 'a1', 'title', ${FOUNDER}, '2099-01-01', datetime('now', '-1 days'))`);
    for (let i = 0; i < 3; i += 1) prop.run(`p1-${i}`, 10, 1);
    for (let i = 0; i < 2; i += 1) prop.run(`p2-${i}`, 20, 2);
    const quote = f.db.prepare(`INSERT INTO deck_run_quotes(uid, user_id, project_id, step, hold_microusd, pricing_version, input_hash, expires_at, used_at)
      VALUES (?, ${FOUNDER}, 1, 'build', ?, 'v1', 'h', '2099-01-01', ?)`);
    quote.run('q1', 50_000, '2026-11-01'); quote.run('q2', 99_999, null); quote.run('q3', 100_000, '2026-11-01'); quote.run('q4', 2_500_000, null);
    f.db.exec(`INSERT INTO pitch_decks(id, project_id, version, slides, is_current, created_at) VALUES (10, 1, 1, '[]', 0, ${ago(10)}), (11, 1, 2, '[]', 1, ${ago(5)}), (20, 2, 1, '[]', 1, ${ago(10)})`);
    f.db.exec(`INSERT INTO pitch_deck_share_tokens(deck_id, token_hash, expires_at, created_at) VALUES (11, 'h1', '2099-01-01', datetime('now', '-10 days', '+12 hours'))`);
    // Retention cohort: two ventures first generated 40 days ago; one generated again 30 days after.
    batch(f, { project: 7, created: ago(40) }); batch(f, { project: 7, created: ago(10) });
    batch(f, { project: 8, created: ago(40) }); batch(f, { project: 8, created: ago(35) });
    batch(f, { project: 9, created: ago(5) });
    const k = await funnelKpis(f.env, 30);
    assert.deepEqual(k.generations, { decks_generating: 2, decks_three_plus: 1, rate: 0.5 });
    assert.deepEqual(k.quote_conversion!.map((b) => [b.label, b.shown, b.confirmed, b.conversion]), [
      [PRICE_BANDS[0].label, 2, 1, 0.5], [PRICE_BANDS[1].label, 1, 1, 1], [PRICE_BANDS[2].label, 0, 0, null], [PRICE_BANDS[3].label, 1, 0, 0],
    ]);
    assert.deepEqual(k.first_share, { ventures: 1, median_hours: 12 });
    assert.deepEqual(k.retention_4w, { cohort: 2, retained: 1, rate: 0.5 });
    assert.ok(Array.isArray(k.accept_rates));
    const none = fixture();
    try {
      const z = await funnelKpis(none.env, 30);
      assert.deepEqual([z.generations!.rate, z.first_share!.median_hours, z.retention_4w!.rate], [null, null, null]);
    } finally { none.close(); }
  } finally { f.close(); }
});

test('4. the reads: HQ admins only, days checked, an unreadable figure null while the others answer', async () => {
  // Mutation checked: requireHqAdmin removed → the founder reads; the metrics read not guarded → the unreadable case is a 500.
  const f = fixture();
  try {
    const app = new Hono<any>().route('/api/admin/ai/deck-grid', deckGrid);
    app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
    const get = async (who: number, path: string, extra: Record<string, unknown> = {}) => {
      const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res = await app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, { ...f.env, ...extra });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await get(FOUNDER, '/api/admin/ai/deck-grid')).status, 403);
    assert.ok((await get(ADMIN, '/api/admin/ai/deck-grid', { BRANCH_CODE: 'eu' })).status >= 400, 'a branch is refused');
    assert.equal((await get(ADMIN, '/api/admin/ai/deck-grid?days=0')).body.error, 'invalid_days');
    const ok = await get(ADMIN, '/api/admin/ai/deck-grid');
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.days, ok.body.rows, ok.body.budget.finished], [30, [], 0]);
    assert.equal((await get(ADMIN, '/api/admin/ai/deck-grid/funnel?days=7')).body.days, 7);
    f.db.exec('DROP TABLE deck_area_batch_steps');
    const broken = await get(ADMIN, '/api/admin/ai/deck-grid');
    assert.equal(broken.status, 200);
    assert.equal(broken.body.rows, null, 'unreadable, not an empty grid');
    assert.equal(broken.body.budget.finished, 0, 'the budget still answers');
  } finally { f.close(); }
});
