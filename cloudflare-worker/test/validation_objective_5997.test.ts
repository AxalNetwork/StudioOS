/**
 * D5997 (#5997) — the venture's validation objective ("Trying to learn:",
 * board V1) on real SQLite: migration 202611151331 over the baseline, the
 * route mounted on a bare Hono.
 *
 *   1. a founder writes, changes and clears it; the overview reads each, and
 *      empty reads Not recorded (text null), never an empty string;
 *   2. writers only, by `canWrite` (the gate every Validate write uses): a
 *      partner reads it and is refused the PUT; another founder and an
 *      investor reach neither; `can_write` on the read agrees with the PUT;
 *   3. the limit (280 characters, counted as characters), whitespace
 *      collapsed to one line, a missing or non-text value refused;
 *   4. each write logs one `validate.objective` row, module-level (no record
 *      id), with the actor, and the clear says so;
 *   5. V11: after a current Pivot, `restate` is true for a writer until the
 *      objective is written at or after the decision; never for a partner,
 *      never after Proceed;
 *   6. the objective's read failing alone is `unavailable`, and the rest of
 *      the overview still reads.
 *
 * Mutation checked (each broke the named test, then was restored):
 *   - the PUT gated on `canReadBoard`: 2 and 4 fail (a partner's save lands and logs);
 *   - the writer without the length check: 3 and 4 fail;
 *   - the upsert keeping the old text on a clear (`COALESCE`): 1 fails;
 *   - `restate` without the `written >= decided` test: 5 fails (restated stays true);
 *   - `restate` computed without `viewer.decisions`: 5 fails (a partner's read is flagged).
 *
 * Every name is made up. Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/validation_objective_5997.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { OBJECTIVE_MAX } from '../src/services/validateWriters.ts';
import { stampMs } from '../src/services/validateObjective.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applyAcceptRetryKeys } from './_accept_retry_keys.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50;
const P = 1, P_OTHER = 2;

function fixture({ objective = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validation_decisions',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  applyAcceptRetryKeys(db);
  db.exec(sqlOf('460_validate_record_stores.sql'));
  db.exec(sqlOf('464_verdict_decisions.sql'));
  if (objective) db.exec(sqlOf('202611151331_5997_validation_objective.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P_OTHER}, 'Beta', 1002)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor' };
async function call(db: any, who: number, method: string, path: string, body?: unknown, raw = false) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const objective = async (db: any, who = FOUNDER, pid = P) => {
  const o = await call(db, who, 'GET', `/overview?project=${pid}`);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return o.body.objective;
};
const put = (db: any, value: unknown, who = FOUNDER, pid = P) => call(db, who, 'PUT', `/objective?project=${pid}`, { value });
const logs = (db: any) => db.prepare("SELECT user_id, entity_type, entity_id, action, details, actor FROM activity_logs WHERE entity_type = 'validate.objective' ORDER BY id").all();

test('1: a founder writes, changes and clears the objective; empty reads Not recorded', async () => {
  const db = fixture();
  assert.deepEqual(await objective(db), { state: 'ok', text: null, updated_at: null, updated_by_name: null, restate: false });

  const w = await put(db, 'Do ops teams lose enough time on carrier invoices to pay for reconciliation?');
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.text, 'Do ops teams lose enough time on carrier invoices to pay for reconciliation?');
  let o = await objective(db);
  assert.equal(o.state, 'ok');
  assert.equal(o.text, 'Do ops teams lose enough time on carrier invoices to pay for reconciliation?');
  assert.equal(o.updated_by_name, 'Fay Founder');
  assert.ok(Number.isFinite(stampMs(o.updated_at)), 'a stored time');

  assert.equal((await put(db, 'Will finance leads pay for it?')).status, 200);
  assert.equal((await objective(db)).text, 'Will finance leads pay for it?');

  assert.equal((await put(db, null)).status, 200);
  o = await objective(db);
  assert.equal(o.text, null, 'cleared reads Not recorded');
  assert.equal(o.updated_by_name, 'Fay Founder', 'who cleared it stays recorded');
  const row = db.prepare('SELECT objective, updated_by FROM validation_objectives WHERE project_id = ?').get(P) as any;
  assert.deepEqual({ ...row }, { objective: null, updated_by: FOUNDER }, 'a clear keeps the row');

  assert.equal((await put(db, 'Again')).status, 200);
  assert.equal((await put(db, '   ')).status, 200, 'blank clears too');
  assert.equal((await objective(db)).text, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM validation_objectives').get() as any).n, 1, 'one row per venture');
});

test('2: writers only, by canWrite; a partner reads it and cannot edit; can_write agrees with the PUT', async () => {
  const db = fixture();
  assert.equal((await put(db, 'Who feels the pain most?')).status, 200);
  for (const [who, can] of [[FOUNDER, true], [ADMIN, true], [PARTNER, false]] as const) {
    const o = await call(db, who, 'GET', `/overview?project=${P}`);
    assert.equal(o.status, 200);
    assert.equal(o.body.can_write, can, `can_write, user ${who}`);
    assert.equal(o.body.objective.text, 'Who feels the pain most?', `user ${who} reads the objective`);
    assert.equal((await put(db, 'Changed by someone', who)).status, can ? 200 : 403, `PUT, user ${who}`);
    if (can) assert.equal((await put(db, 'Who feels the pain most?', who)).status, 200);
  }
  assert.equal((await put(db, null, PARTNER)).status, 403, 'a reader cannot clear it either');
  for (const who of [OTHER, INVESTOR]) {
    assert.equal((await call(db, who, 'GET', `/overview?project=${P}`)).status, 403, `overview, user ${who}`);
    assert.equal((await put(db, 'x', who)).status, 403, `PUT, user ${who}`);
  }
  assert.equal((await objective(db)).text, 'Who feels the pain most?', 'no refused write landed');
  assert.equal((await put(db, 'x', FOUNDER, 999)).status, 404);
  assert.equal((await call(db, FOUNDER, 'PUT', '/objective', { value: 'x' })).status, 400, 'no project');
});

test('3: the limit, one line, and a missing or non-text value refused', async () => {
  const db = fixture();
  assert.equal(OBJECTIVE_MAX, 280);
  const long = await put(db, 'a'.repeat(OBJECTIVE_MAX + 1));
  assert.equal(long.status, 400);
  assert.equal(long.body.detail, 'Keep what you are trying to learn to 280 characters');
  // Counted as characters, not UTF-16 units: 280 emoji fit.
  assert.equal((await put(db, '🚚'.repeat(OBJECTIVE_MAX))).status, 200);
  assert.equal((await put(db, `  Do they\n\n  pay?\t `)).status, 200);
  assert.equal((await objective(db)).text, 'Do they pay?', 'whitespace collapsed to one line');
  for (const value of [undefined, 42, true, ['a'], { a: 1 }]) {
    const r = await call(db, FOUNDER, 'PUT', `/objective?project=${P}`, value === undefined ? {} : { value });
    assert.equal(r.status, 400, `value ${JSON.stringify(value)}`);
    assert.equal(r.body.detail, 'What you are trying to learn is text');
  }
  assert.equal((await call(db, FOUNDER, 'PUT', `/objective?project=${P}`, 'not json', true)).status, 400);
  assert.equal((await objective(db)).text, 'Do they pay?', 'no refused write changed it');
});

test('4: each write logs one module-level validate.objective row with its actor', async () => {
  const db = fixture();
  await put(db, 'Will they switch?');
  await put(db, 'Will they switch?', ADMIN);
  await put(db, null);
  await put(db, 'a'.repeat(OBJECTIVE_MAX + 1));
  await put(db, 'x', PARTNER);
  assert.deepEqual(logs(db).map((r: any) => ({ ...r })), [
    { user_id: FOUNDER, entity_type: 'validate.objective', entity_id: null, action: 'objective_set', details: 'Trying to learn: Will they switch?', actor: `user:${FOUNDER}` },
    { user_id: ADMIN, entity_type: 'validate.objective', entity_id: null, action: 'objective_set', details: 'Trying to learn: Will they switch?', actor: `user:${ADMIN}` },
    { user_id: FOUNDER, entity_type: 'validate.objective', entity_id: null, action: 'objective_cleared', details: 'Trying to learn cleared', actor: `user:${FOUNDER}` },
  ]);
});

test('5: V11 — after a current Pivot a writer is asked to restate until the objective is written after it', async () => {
  const db = fixture();
  const decide = (decision: string, at: string) => db.prepare(
    `INSERT INTO validation_decisions (project_id, hypothesis_id, decision, reasoning, decided_by, state, decided_at)
     VALUES (?, NULL, ?, 'Because', ?, 'given', ?)`,
  ).run(P, decision, FOUNDER, at);
  db.exec(`INSERT INTO validation_objectives (project_id, objective, updated_by, updated_at) VALUES (${P}, 'Old question', ${FOUNDER}, '2026-11-01 09:00:00')`);
  assert.equal((await objective(db)).restate, false, 'no decision, nothing to restate');

  decide('proceed', '2026-11-02 09:00:00');
  assert.equal((await objective(db)).restate, false, 'Proceed asks for no restatement');

  db.exec("UPDATE validation_decisions SET superseded_at = '2026-11-03 09:00:00'");
  decide('pivot', '2026-11-03 09:00:00');
  assert.equal((await objective(db)).restate, true, 'an objective older than the Pivot');
  assert.equal((await objective(db, ADMIN)).restate, true, 'an admin writer too');
  const partner = await objective(db, PARTNER);
  assert.equal(partner.restate, false, 'a partner never reads decisions');
  assert.equal(partner.text, 'Old question');

  db.exec(`UPDATE validation_objectives SET objective = NULL WHERE project_id = ${P}`);
  db.exec(`UPDATE validation_objectives SET updated_at = '2026-11-04 09:00:00' WHERE project_id = ${P}`);
  assert.equal((await objective(db)).restate, true, 'a cleared objective after the Pivot is still unstated');

  assert.equal((await put(db, 'New question for the new customer')).status, 200);
  const o = await objective(db);
  assert.equal(o.text, 'New question for the new customer');
  assert.equal(o.restate, false, 'restated at or after the decision');
});

test('6: the objective failing alone is unavailable; the rest of the overview reads', async () => {
  const db = fixture({ objective: false });
  const o = await call(db, FOUNDER, 'GET', `/overview?project=${P}`);
  assert.equal(o.status, 200);
  assert.deepEqual(o.body.objective, { state: 'unavailable', reason: 'What you are trying to learn could not be read.' });
  assert.ok(Array.isArray(o.body.cards) && o.body.cards.length > 0, 'the cards still read');
  assert.equal((await put(db, 'x')).status, 500, 'a write to a missing store fails, never silently');
});

test('stampMs reads SQLite and ISO stamps alike', () => {
  assert.equal(stampMs('2026-11-03 09:00:00'), Date.parse('2026-11-03T09:00:00Z'));
  assert.equal(stampMs('2026-11-03T09:00:00.000Z'), Date.parse('2026-11-03T09:00:00Z'));
  assert.ok(Number.isNaN(stampMs(null)) && Number.isNaN(stampMs('')));
});
