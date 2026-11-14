/**
 * THE SECOND HALF OF THE TIMESTAMP AUDIT — the windows that are not access
 * gates (D125). D124 fixed the thirteen comparisons that decide whether a door
 * is open; these decide what a figure says, what a feed lists, and — in one
 * case — whether a PURCHASED feature is still granted.
 *
 * The defect is the one D124 records: SQLite compares timestamps as TEXT, and
 * `'T'` (0x54) beats `' '` (0x20) at position 10, so while the date halves
 * match an ISO string is always greater than `datetime('now')`. The fix is to
 * normalise the STORED COLUMN — rewriting only the right-hand side is the
 * plausible move and changes nothing, which D124's own tests demonstrate.
 *
 * WHY THIS FILE HAD TO EXIST BEFORE THE FIX COULD SHIP. The D125 source change
 * was written first and mutation-checked before being committed: reverting the
 * fix on featureUnlocks, referralAttribution, assistant and branchOps each left
 * `npm run test:drift` at exit 0 with ZERO failures. Four correct fixes that
 * nothing could catch. An assertion that cannot fail is decoration, and a fix
 * nothing can catch is the same thing one layer down — so the fix waited for
 * these.
 *
 * TWO OF THESE RUN THE OPPOSITE WAY FROM A TTL, which is why they are worth
 * having rather than assuming the class is understood:
 *   - `calendar_events.start_at >= now` listed every meeting EARLIER THE SAME
 *     DAY as upcoming. The comment above that query says its catch exists so a
 *     failure does not turn "every answer into 'no upcoming meetings'"; the
 *     real defect was the reverse.
 *   - `ai_usage_logs.created_at >= ?` is the mirror image again: a SQL-format
 *     column against ISO bounds, so every row dated on the quarter's FIRST DAY
 *     was dropped from the branch's reported AI cost (D.8 statements).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { sqlAround, expiredIso, LIVE_ISO } from './_timeFixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const src = (rel: string) => read(`cloudflare-worker/src/${rel}`);

/**
 * Tables come from the baseline, foreign keys stripped — `stripForeignKeys`'s
 * own note is that D1 ignores `PRAGMA foreign_keys` inside a batch, so
 * production is not relying on them either and a fixture need not stand up
 * every parent table to exercise one predicate.
 */
function db(...tables: string[]) {
  const d = new DatabaseSync(':memory:');
  for (const t of tables) d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  return d;
}

test('a PAID feature unlock that expired today stops being granted', () => {
  // The row carries source_payment_intent_id, so this is purchased product.
  // Getting it wrong gives it away for up to a day past the term.
  const d = db('feature_unlocks');
  const sql = sqlAround(src('services/featureUnlocks.ts'), 'SELECT 1 FROM feature_unlocks', 'featureUnlocks.ts');
  const ins = d.prepare('INSERT INTO feature_unlocks (user_id, feature_key, expires_at) VALUES (?, ?, ?)');
  ins.run(1, 'spent', expiredIso(d));
  ins.run(1, 'live', LIVE_ISO);
  ins.run(1, 'perpetual', null);   // no expiry must keep meaning "never expires"

  assert.equal(d.prepare(sql).get(1, 'spent'), undefined, 'an expired paid unlock was still granted');
  assert.ok(d.prepare(sql).get(1, 'live'), 'a live unlock stopped being granted');
  assert.ok(d.prepare(sql).get(1, 'perpetual'), 'a perpetual unlock was treated as expired');
});

test('the unlock list agrees with the unlock check', () => {
  // Two predicates, one question. They drifted apart once already in this
  // repo's history for deck categories (#207); here they must move together.
  const d = db('feature_unlocks');
  const list = sqlAround(src('services/featureUnlocks.ts'), 'SELECT feature_key, expires_at FROM feature_unlocks', 'featureUnlocks.ts');
  const ins = d.prepare('INSERT INTO feature_unlocks (user_id, feature_key, expires_at) VALUES (?, ?, ?)');
  ins.run(1, 'spent', expiredIso(d));
  ins.run(1, 'live', LIVE_ISO);

  const keys = (d.prepare(list).all(1) as Array<{ feature_key: string }>).map((r) => r.feature_key);
  assert.deepEqual(keys, ['live'], 'the list and the check disagree about what is active');
});

test('a referral attribution window that ended today no longer credits', () => {
  // The DDL is a runtime bootstrap in the service, not the baseline — so it is
  // sliced from the same source the production path runs.
  const service = src('services/referralAttribution.ts');
  const d = new DatabaseSync(':memory:');
  d.exec(sqlAround(service, 'CREATE TABLE IF NOT EXISTS referral_attributions', 'referralAttribution.ts'));
  const sql = sqlAround(service, 'SELECT referral_code, referrer_user_id', 'referralAttribution.ts');
  const ins = d.prepare(
    'INSERT INTO referral_attributions (user_id, referral_code, referrer_user_id, expires_at) VALUES (?, ?, ?, ?)',
  );
  ins.run(1, 'CODE1', 99, expiredIso(d));
  ins.run(2, 'CODE2', 99, LIVE_ISO);

  // Two binds: the buyer, and the referrer the query refuses to self-credit.
  assert.equal(d.prepare(sql).get(1, 0), undefined, 'a lapsed attribution still credited the referrer');
  assert.ok(d.prepare(sql).get(2, 0), 'a live attribution stopped crediting');
});

test('a cap-table share link expires as well as revokes', () => {
  // THE MIXED-WRITER CASE. Revoking writes SQL format (captable.ts:682) and
  // genuinely killed a link; minting writes ISO (shareLink.ts:90) and did not.
  // One column, two writers, and only one of them was being read correctly.
  const d = db('captable_share_tokens');
  // The statement is `UPDATE ${table}` — a runtime interpolation whose SOLE call
  // site passes this literal (routes/captable.ts:712). Resolving it here keeps the
  // test on the real SQL; the assertion below pins that call site so the
  // substitution cannot quietly become a fiction.
  const sql = sqlAround(src('services/shareLink.ts'), 'UPDATE ${table}', 'shareLink.ts')
    .replace('${table}', 'captable_share_tokens');
  assert.match(src('routes/captable.ts'), /captable_share_tokens/, 'the share-link table name moved');
  const ins = d.prepare(
    "INSERT INTO captable_share_tokens (scenario_uid, audience, token_hash, expires_at, view_limit, view_count) VALUES ('s', 'a', ?, ?, 10, 0)",
  );
  ins.run('h-spent', expiredIso(d));
  ins.run('h-live', LIVE_ISO);
  d.exec("INSERT INTO captable_share_tokens (scenario_uid, audience, token_hash, expires_at, view_limit, view_count) VALUES ('s','a','h-revoked', datetime('now'), 10, 0)");

  const claim = (h: string) => (d.prepare(sql).run(h) as any).changes;
  assert.equal(claim('h-spent'), 0, 'a minted link outlived its own expiry');
  assert.equal(claim('h-live'), 1, 'a live link stopped opening');
  assert.equal(claim('h-revoked'), 0, 'a revoked link came back');
});

test('a meeting that started earlier today is not "upcoming"', () => {
  // The OPPOSITE direction from a TTL: an ISO start_at sorts ABOVE
  // datetime('now'), so a bare comparison over-selects rather than under-.
  const d = db('calendar_events');
  const sql = sqlAround(src('routes/assistant.ts'), 'SELECT title, start_at, end_at, location_kind', 'assistant.ts');
  const ins = d.prepare(
    "INSERT INTO calendar_events (uid, user_id, source, external_uri, title, start_at, end_at) VALUES (?, 1, 'x', ?, ?, ?, ?)",
  );
  ins.run('u1', 'uri-1', 'started earlier today', expiredIso(d), LIVE_ISO);
  ins.run('u2', 'uri-2', 'still to come', LIVE_ISO, LIVE_ISO);

  const titles = (d.prepare(sql).all(1) as Array<{ title: string }>).map((r) => r.title);
  assert.deepEqual(titles, ['still to come'], 'a finished meeting was listed as upcoming');
});

test('the public feed puts a finished event in the archive, not the upcoming lane', () => {
  // Both halves of the ternary, because they are one decision written twice —
  // and `services/eventReminders.ts:159-160` already read this column the
  // normalised way, so the column was being read two ways at once.
  const d = db('events');
  const pub = src('routes/events_public.ts');
  const upcoming = sqlAround(pub, "datetime(COALESCE(ends_at, starts_at)) >= datetime('now')", 'events_public.ts');
  const past = sqlAround(pub, "datetime(COALESCE(ends_at, starts_at)) < datetime('now')", 'events_public.ts');
  const ins = d.prepare(
    "INSERT INTO events (slug, host_user_id, type, title, starts_at, ends_at, status) VALUES (?, 1, 'x', ?, ?, ?, 'published')",
  );
  const done = expiredIso(d);
  ins.run('finished', 'finished', done, done);
  ins.run('ahead', 'ahead', LIVE_ISO, LIVE_ISO);

  const run = (pred: string) =>
    (d.prepare(`SELECT title FROM events WHERE ${pred}`).all() as Array<{ title: string }>).map((r) => r.title);
  assert.deepEqual(run(upcoming), ['ahead'], 'a finished event was still in the upcoming feed');
  assert.deepEqual(run(past), ['finished'], "the archive missed today's finished event");
});

test("the branch's quarterly AI cost counts the quarter's first day", () => {
  // THE REVERSE DIRECTION: a SQL-format column (DEFAULT datetime('now')) against
  // ISO bounds from quarterBounds. Every row dated on the first day of the
  // quarter was silently dropped from the figure HQ's statements read (D.8).
  const d = db('ai_usage_logs');
  const branchOps = src('rpc/branchOps.ts');
  const sql = sqlAround(branchOps, 'SELECT COALESCE(SUM(est_cost_usd), 0) AS cost', 'branchOps.ts');
  // Written the way production writes it: the INSERT omits created_at, so every
  // row takes the SQL-format DEFAULT.
  for (const ts of ['2026-07-01 00:30:00', '2026-07-01 12:00:00', '2026-08-15 09:00:00', '2026-06-30 23:59:59'])
    d.prepare('INSERT INTO ai_usage_logs (task, model, est_cost_usd, created_at) VALUES (?, ?, ?, ?)')
      .run('t', 'm', 1, ts);

  // The bounds quarterBounds actually produces, in the format it produces them.
  const lo = new Date(Date.UTC(2026, 6, 1)).toISOString();
  const hi = new Date(Date.UTC(2026, 9, 1)).toISOString();
  const row = d.prepare(sql).get(lo, hi) as { calls: number };
  assert.equal(row.calls, 3, "the quarter's first day was dropped from the reported cost");
});

test('quarterBounds still produces the ISO bounds these tests bind', () => {
  // The test above is only meaningful while the bounds are ISO. If quarterBounds
  // is ever changed to emit SQL format, this says so rather than letting the
  // fixture quietly stop exercising the mismatch it exists for.
  const fn = src('rpc/branchOps.ts');
  const at = fn.indexOf('function quarterBounds');
  assert.ok(at > 0, 'quarterBounds moved');
  assert.match(fn.slice(at, at + 400), /\.toISOString\(\)/,
    'quarterBounds no longer emits ISO — re-point the quarter test at the new format');
});
