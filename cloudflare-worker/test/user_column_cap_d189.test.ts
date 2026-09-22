/**
 * D189 — `users` is FULL, and account recovery returned a 500 because of it.
 *
 * THE DEFECT, in one sentence: `060_auth_recovery.sql:53,57` declared
 * `recovery_cooling_off_until` and `recovery_step_up_due_at` as columns on
 * `users`; `users` is at D1's hard 100-column cap, so neither could ever
 * land; 060 sits below BASELINE_CUTOFF so `migrate-d1 --bootstrap` MARKED it
 * applied without running it; and `setCoolOffAndAssurance`'s UPDATE names
 * both, unguarded, at every call site that mints a recovery session. An
 * UPDATE naming a missing column THROWS — which is why this one is a 500
 * where D187's and D188's defects were silent, those being `SELECT *`.
 *
 * WHAT THIS FILE ASSERTS, and what it deliberately does not.
 *
 * Two layers are driven END TO END against a real node:sqlite database built
 * from `schema_baseline.sql` plus every post-cutoff migration — POST
 * /backup-code and GET /email/verify. CORRECTED: an earlier draft of this
 * note called them "the two branches of `setCoolOffAndAssurance`'s only
 * varying argument". There are no branches. The helper took an `assurance`
 * argument that appeared only in its signature and its comments and was
 * never read, and a mutation written against that belief changed a call site
 * and changed nothing — which is how the dead parameter was found. It is
 * gone now. What the pair genuinely gives is two INDEPENDENT call sites
 * exercised whole, one of which (backup-code) also spends a single-use code
 * on the way.
 *
 * /sms/verify needs a live GCIP phone verification and /claim a co-signed
 * ticket, so neither is drivable here; they are covered by the STRUCTURAL
 * assertion that all four call sites invoke that one helper with a bare
 * `await`. That assertion is what extends the two behavioural proofs to
 * four, and this note says so rather than claiming four.
 *
 * THE REPRODUCTION IS PAIRED. Every behavioural test runs twice: once against
 * a build WITHOUT migration 277, where it must fail the way production did,
 * and once with it, where it must complete. Without that pairing this change
 * is a refactor sold as a fix.
 *
 * THE DURABLE ASSERTION is the runtime-ALTER sweep near the bottom.
 * `check-migration-declarations` (D188) reads `sql/migrations/` only, so an
 * `ALTER TABLE users ADD COLUMN` issued at RUNTIME is invisible to it — which
 * is exactly how `notifications.ts`'s marketing unsubscribe went on failing
 * silently for a year. Nothing covered that until now.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import recover from '../src/routes/auth_recover.ts';
import notifications from '../src/routes/notifications.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '../sql');
const SRC_DIR = resolve(HERE, '../src');
const MIGRATIONS = resolve(SQL_DIR, 'migrations');
const JWT_SECRET = 'd189-test-secret-at-least-32-bytes-long!!';

const migrationNames = () =>
  readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations);

/**
 * A freshly provisioned database, exactly as `migrate-d1 --bootstrap` leaves
 * one: the baseline, then every migration ABOVE the cutoff. `skip` drops a
 * migration by filename so the same builder produces the before-half.
 * Statements are applied error-tolerantly because that is what the runner's
 * own fresh build does.
 */
function freshDb(skip: string[] = []) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL_DIR, 'schema_baseline.sql'), 'utf8'));
  for (const name of migrationNames()) {
    if (migrationNumber(name) <= BASELINE_CUTOFF || skip.includes(name)) continue;
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* error-tolerant, as the runner is */ }
    }
  }
  return db;
}

const M277 = '277_user_recovery_state.sql';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}

function app(db: InstanceType<typeof DatabaseSync>) {
  const env = {
    DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(),
    JWT_SECRET, APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    ENVIRONMENT: 'development',
  };
  const a = new Hono<any>();
  a.route('/api/auth/recover', recover);
  // The worker's own onError shape: an unhandled throw from a handler is a
  // 500, which is exactly the state this file exists to reproduce.
  a.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));
  return async (path: string, init: RequestInit = {}) => {
    const res = await a.request(`/api/auth/recover${path}`, {
      headers: { 'Content-Type': 'application/json' }, ...init,
    }, env);
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CODE = 'ABCD-EFGH-JKLM';

async function seedUser(db: InstanceType<typeof DatabaseSync>) {
  const hash = await sha256Hex(CODE);
  db.prepare(
    `INSERT INTO users (id, email, name, role, is_active, email_verified, totp_recovery_codes)
     VALUES (1, 'lost@axal.vc', 'Lost Authenticator', 'founder', 1, 1, ?)`,
  ).run(JSON.stringify([hash]));
  return hash;
}

/** The email-magic layer's precondition: an open ticket carrying the hash. */
async function seedEmailTicket(db: InstanceType<typeof DatabaseSync>, token: string) {
  const state = JSON.stringify({
    token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  db.prepare(
    `INSERT INTO auth_recovery_tickets (id, user_id, layer, status, state_json)
     VALUES (900, 1, 'email_magic', 'open', ?)`,
  ).run(state);
}

const recoveryRow = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT cooling_off_until, step_up_due_at FROM user_recovery_state WHERE user_id = 1').get();

// ── 1 · the cap itself ────────────────────────────────────────────────────

test('users sits at D1\'s 100-column cap on a fresh build, so no ADD COLUMN can land', () => {
  const db = freshDb();
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[];
  assert.ok(cols.length <= 100,
    `users has ${cols.length} columns on a fresh build. D1 refuses the 101st, so an `
    + 'ALTER TABLE users ADD COLUMN in any migration will fail the deploy AND — the runner '
    + 'being forward-only and ordered — strand every migration after it, which is what '
    + 'migration 199 did on 2026-09-03 (#413). Move the fact to a side table keyed by user_id.');
  assert.equal(cols.length, 100,
    'users is no longer at exactly 100 columns. If it SHRANK the cap argument in migration '
    + '277\'s header, in three ledger reasons and in schemaBootstrap.ts is stale and should '
    + 'be re-measured, not left standing.');
  const names = cols.map((c) => c.name);
  for (const dead of ['recovery_cooling_off_until', 'recovery_step_up_due_at', 'marketing_unsubscribed_at']) {
    assert.equal(names.includes(dead), false,
      `users.${dead} reached a fresh build. It is declared by a sub-cutoff migration that `
      + 'can never run and can never succeed at the cap; if it is genuinely here now, the '
      + 'side table 277 created is a second home for one fact and one of them must go.');
  }
});

// ── 2 · the reproduction, paired ──────────────────────────────────────────

test('BEFORE 277: the backup-code layer 500s, and the single-use code is spent anyway', async () => {
  const db = freshDb([M277]);
  await seedUser(db);
  const call = app(db);

  const r = await call('/backup-code', {
    method: 'POST', body: JSON.stringify({ email: 'lost@axal.vc', code: CODE }),
  });

  assert.equal(r.status, 500,
    'the backup-code layer did not 500 on a build without 277. That is the production state '
    + 'this change fixes, and a fix whose before-half cannot be reproduced is a refactor.');
  assert.match(String(r.body?.detail || ''), /recovery_cooling_off_until|no such column|no such table/,
    'it failed for some other reason than the missing recovery columns, so this test is not '
    + 'reproducing the defect it names');

  const after: any = db.prepare('SELECT totp_recovery_codes FROM users WHERE id = 1').get();
  assert.equal(after.totp_recovery_codes, '[]',
    'the recovery code was NOT consumed before the throw. It is — consumption happens at '
    + 'auth_recover.ts:409, the throw at :292 — so the user loses a single-use code AND gets '
    + 'no session. If that stops being true this assertion should be re-aimed, not deleted.');
});

test('AFTER 277: the backup-code layer completes and the cool-off is readable', async () => {
  const db = freshDb();
  await seedUser(db);
  const call = app(db);

  const r = await call('/backup-code', {
    method: 'POST', body: JSON.stringify({ email: 'lost@axal.vc', code: CODE }),
  });

  assert.equal(r.status, 200, `the backup-code layer did not complete: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.assurance_level, 'full');
  assert.ok(r.body.token, 'no session was minted');

  const row: any = recoveryRow(db);
  assert.ok(row, 'no user_recovery_state row was written — the cool-off was not recorded, which '
    + 'is the state the unguarded write exists to prevent');
  assert.ok(row.cooling_off_until, 'cooling_off_until is empty, so middleware/recoveryCoolOff.ts '
    + 'would let the recovered session straight through to the sensitive surfaces');
  assert.ok(row.step_up_due_at, 'step_up_due_at is empty, so the 7-day auto-relock can never fire');
  assert.ok(new Date(row.cooling_off_until).getTime() > Date.now(),
    'the cool-off is already in the past, so it gates nothing. recoveryCoolOff.ts compares it '
    + 'with new Date(...).getTime() > Date.now(), so this is the readable-afterwards property.');
});

test('BEFORE 277: the email-magic layer 500s too', async () => {
  const db = freshDb([M277]);
  await seedUser(db);
  await seedEmailTicket(db, 'tok-email-1');
  const call = app(db);

  const r = await call('/email/verify?token=tok-email-1&ticket=900');
  assert.equal(r.status, 500,
    'the email-magic layer did not 500 without 277. It shares setCoolOffAndAssurance with the '
    + 'other three, so if this one survives the missing columns the helper is not shared.');
});

test('AFTER 277: the email-magic layer completes at email_only assurance', async () => {
  const db = freshDb();
  await seedUser(db);
  await seedEmailTicket(db, 'tok-email-2');
  const call = app(db);

  const r = await call('/email/verify?token=tok-email-2&ticket=900');
  assert.equal(r.status, 200, `the email-magic layer did not complete: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.assurance_level, 'email_only',
    'the email layer stopped reporting email_only assurance. This is the route\'s OWN literal, '
    + 'not something setCoolOffAndAssurance decides — the helper reads no assurance argument, '
    + 'which is a fact this file established by mutation and the helper\'s docblock now records.');

  const row: any = recoveryRow(db);
  assert.ok(row?.step_up_due_at,
    'email_only is the assurance level the 7-day step-up deadline exists for, and it was not '
    + 'recorded');
});

// ── 3 · the structural half, which extends the two proofs to four ─────────

test('all four recovery layers reach the same helper, and none of them guards it', () => {
  const src = readFileSync(resolve(SRC_DIR, 'routes/auth_recover.ts'), 'utf8');
  const lines = src.split('\n');
  const callSites = lines
    .map((l, i) => ({ line: l, n: i + 1 }))
    .filter(({ line }) => /setCoolOffAndAssurance\s*\(/.test(line) && !/^async function/.test(line.trim()));

  assert.equal(callSites.length, 4,
    `expected four call sites and found ${callSites.length}. This count is what lets the two `
    + 'behavioural tests above stand for every layer that mints a recovery session — if a '
    + 'fifth layer was added, drive it or say why it cannot be driven.');

  for (const { line, n } of callSites) {
    assert.match(line, /^\s*await setCoolOffAndAssurance\(/,
      `auth_recover.ts:${n} no longer calls setCoolOffAndAssurance as a bare await. The write is `
      + 'unguarded ON PURPOSE (277\'s header says why): a recovery session that silently skips '
      + 'its own 24-hour cool-off is worse than a 500, because the caller is about to mint full '
      + 'assurance on the strength of it. Wrapping it in a try/catch is the thing this refuses.');
  }
});

test('the helper writes the side table and names `users` nowhere', () => {
  const src = readFileSync(resolve(SRC_DIR, 'routes/auth_recover.ts'), 'utf8');
  const start = src.indexOf('async function setCoolOffAndAssurance');
  assert.ok(start > 0, 'setCoolOffAndAssurance is gone; re-aim this test rather than deleting it');
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);

  assert.match(body, /INSERT INTO user_recovery_state/,
    'the helper stopped writing user_recovery_state');
  assert.doesNotMatch(body, /UPDATE\s+users\b/,
    'the helper writes `users` again. Those columns cannot exist — the table is at D1\'s '
    + '100-column cap — so the statement throws and every recovery layer 500s.');
});

// ── 3b · the hydration, which is what keeps three readers unchanged ──────

test('getCurrentUser hydrates the side table under the OLD property names', async () => {
  // THE LOAD-BEARING LINK, and a mutation is why it has a test. Blanking
  // `recovery_step_up_due_at` in the hydration ESCAPED the first mutation
  // run: every other assertion here reads the STORED ROW, and the row was
  // still correct. But three readers ask the USER OBJECT for these two —
  // middleware/recoveryCoolOff.ts, the step-up check in auth.ts, and
  // routes/auth.ts's /me payload — and they are unchanged by this PR only
  // because the hydration puts the values back under their old names. If it
  // silently stopped, the cool-off would stop being enforced and nothing
  // would notice, which is precisely the bug D189 exists to fix, restored one
  // layer up.
  const db = freshDb();
  await seedUser(db);
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const later = new Date(Date.now() + 7 * 86400_000).toISOString();
  db.prepare(
    `INSERT INTO user_recovery_state (user_id, cooling_off_until, step_up_due_at, updated_at)
     VALUES (1, ?, ?, datetime('now'))`,
  ).run(soon, later);

  const { getCurrentUser } = await import('../src/auth.ts');
  const token = await new SignJWT({ user_id: 1, role: 'founder', email: 'lost@axal.vc' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const env = {
    DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(), JWT_SECRET,
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    ENVIRONMENT: 'development',
  };
  let seen: any = null;
  const a = new Hono<any>();
  a.get('/probe', async (c) => { seen = await getCurrentUser(c); return c.json({ ok: true }); });
  await a.request('/probe', { headers: { Authorization: `Bearer ${token}` } }, env);

  assert.ok(seen, 'getCurrentUser returned no user, so this test asserts nothing');
  assert.equal((seen as any).recovery_cooling_off_until, soon,
    'the cool-off is not on the user object under its old name, so '
    + 'middleware/recoveryCoolOff.ts reads undefined and lets every recovered session '
    + 'straight through to the sensitive surfaces');
  assert.equal((seen as any).recovery_step_up_due_at, later,
    'the step-up deadline is not on the user object under its old name, so the auto-relock '
    + 'in getCurrentUser can never fire and routes/auth.ts reports null on /me');
});

test('a database without 277 leaves the hydration undefined rather than 500ing', async () => {
  // The best-effort property, and it is the reason the hydration is wrapped.
  // getCurrentUser runs on EVERY authenticated request; a throw here would
  // take the whole platform down on any environment that had not applied 277.
  const db = freshDb([M277]);
  await seedUser(db);
  const { getCurrentUser } = await import('../src/auth.ts');
  const token = await new SignJWT({ user_id: 1, role: 'founder', email: 'lost@axal.vc' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env = {
    DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(), JWT_SECRET,
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    ENVIRONMENT: 'development',
  };
  let seen: any = null;
  const a = new Hono<any>();
  a.get('/probe', async (c) => { seen = await getCurrentUser(c); return c.json({ ok: true }); });
  const res = await a.request('/probe', { headers: { Authorization: `Bearer ${token}` } }, env);

  assert.equal(res.status, 200,
    'an authenticated request 500d on a database without 277. The hydration must stay '
    + 'best-effort: it runs on every request, so a throw is a platform outage, and degrading '
    + 'to undefined is exactly the behaviour that shipped before this PR.');
  assert.ok(seen, 'the user was not resolved at all');
  // `undefined`, not `null`: the catch fires before the assignment, so the
  // property is never set. That is the RIGHT degraded value and worth being
  // precise about — it is byte-for-byte what the three readers saw before
  // this PR, when they read the name off a `SELECT *` of a table that had no
  // such column. So a database without 277 behaves exactly as production did
  // this morning: the cool-off does not fire and the session-scoped deadline
  // carries the step-up. Falsy is the property; which falsy value is the
  // evidence that nothing invented one.
  assert.equal((seen as any).recovery_cooling_off_until, undefined,
    'the hydration assigned a value on a database that cannot have one — either the read '
    + 'did not fail where it should, or a default was invented for a fact nobody recorded');
  assert.equal((seen as any).recovery_step_up_due_at, undefined,
    'same for the step-up deadline');
});

// ── 4 · the durable one: runtime ALTERs the migration guard cannot see ────

test('no worker source runs ALTER TABLE users ADD COLUMN for a column a fresh build lacks', () => {
  const db = freshDb();
  const have = new Set(
    (db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[])
      .map((c) => c.name.toLowerCase()),
  );

  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(SRC_DIR);

  // A runtime ALTER is a string literal the migration guard never reads —
  // `check-migration-declarations` (D188) walks `sql/migrations/` and nothing
  // else — which is the blind spot that let the marketing-unsubscribe ALTER
  // fail silently for a year.
  //
  // COMMENTS ARE STRIPPED FIRST, and the first run of this test is why. It
  // flagged `routes/notifications.ts` for an ALTER that lives in the docblock
  // EXPLAINING why the ALTER was removed — the rule quoting its own
  // violation. That is the fourth time in this programme a lexical scan has
  // been unable to tell a rule from the thing it forbids, and the failure
  // mode is the dangerous direction: a guard that fires on its own
  // documentation gets loosened, and the loosening is what lets the real
  // instance through.
  const ALTER = /ALTER\s+TABLE\s+["'`]?users["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)/gi;
  const offenders: string[] = [];
  for (const f of files) {
    const text = codeOnly(readFileSync(f, 'utf8'));
    for (const m of text.matchAll(ALTER)) {
      const col = m[1].toLowerCase();
      if (col === 'if') continue; // `ADD COLUMN IF NOT EXISTS` — D188's parser finding
      if (!have.has(col)) offenders.push(`${f.slice(SRC_DIR.length + 1)} → users.${col}`);
    }
  }

  assert.deepEqual(offenders, [],
    'a runtime ALTER names a column a fresh build does not have, and `users` is at D1\'s '
    + '100-column cap, so it CANNOT succeed — SQLite checks the column-count limit in '
    + 'sqlite3AddColumn() BEFORE the duplicate-name check, so the failure is "too many '
    + 'columns" whatever the column\'s state. Whatever runs after it reads a column that is '
    + 'not there. Put the fact in a side table keyed by user_id (super_admins, 199/D35; '
    + 'user_advisor_extras, 276/D188; user_recovery_state and user_marketing_prefs, 277/D189). '
    + `Offenders: ${offenders.join(', ')}`);

  assert.ok(files.length > 100,
    `only ${files.length} source files were walked, so this sweep is not covering the worker `
    + 'and would pass vacuously');
});

// ── 5 · the marketing half ────────────────────────────────────────────────

test('the marketing unsubscribe writes user_marketing_prefs, with no lazy ALTER left', () => {
  const src = readFileSync(resolve(SRC_DIR, 'routes/notifications.ts'), 'utf8');
  const start = src.indexOf('async function applyMarketingUnsub');
  assert.ok(start > 0, 'applyMarketingUnsub is gone; re-aim this test rather than deleting it');
  const body = src.slice(start, src.indexOf('\n}', start));

  assert.match(body, /INSERT INTO user_marketing_prefs/, 'it stopped writing the side table');
  assert.doesNotMatch(body, /ALTER\s+TABLE/,
    'the lazy ALTER is back. It can never succeed at the column cap, its own catch swallows '
    + 'that, and the write after it then fails too — so an unsubscribe records nothing while '
    + 'answering the reader as though it worked. That is compliance-adjacent, not cosmetic.');
  assert.doesNotMatch(body, /UPDATE\s+users\b/, 'it writes `users` again');
});

test('the first unsubscribe timestamp sticks, as the old WHERE ... IS NULL made it', async () => {
  // THIS TEST USED TO RE-IMPLEMENT THE UPSERT INLINE AND SO PROVED NOTHING.
  // A mutation that removed the COALESCE from routes/notifications.ts ESCAPED,
  // because the assertion was running its own copy of the statement rather
  // than the shipped one — a test that restates the code tests the test. It
  // drives the real unsubscribe route now, HMAC token and all.
  const db = freshDb();
  await seedUser(db);
  db.prepare(
    `INSERT INTO user_marketing_prefs (user_id, unsubscribed_at, updated_at)
     VALUES (1, '2020-01-01 00:00:00', datetime('now'))`,
  ).run();

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = `1.${exp}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const env = {
    DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(), JWT_SECRET,
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    ENVIRONMENT: 'development',
  };
  const a = new Hono<any>();
  a.route('/api/notifications', notifications);
  const res = await a.request(`/api/notifications/unsubscribe?token=${payload}.${sigHex}`, {}, env);
  assert.equal(res.status, 200, 'the unsubscribe link did not resolve');

  const row: any = db.prepare('SELECT unsubscribed_at FROM user_marketing_prefs WHERE user_id = 1').get();
  assert.equal(row.unsubscribed_at, '2020-01-01 00:00:00',
    'a second unsubscribe overwrote the first timestamp. The statement this replaced carried '
    + '`AND marketing_unsubscribed_at IS NULL`, so the FIRST unsubscribe is the recorded one, '
    + 'and the COALESCE in the upsert is what preserves that.');
});

test('an unsubscribe with no prior row records one', async () => {
  // The other half, and the one that would have stayed true even while the
  // route recorded nothing at all: without it, a handler that wrote no row
  // would pass the stickiness test above by doing nothing.
  const db = freshDb();
  await seedUser(db);

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = `1.${exp}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const env = {
    DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(), JWT_SECRET,
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    ENVIRONMENT: 'development',
  };
  const a = new Hono<any>();
  a.route('/api/notifications', notifications);
  const res = await a.request(`/api/notifications/unsubscribe?token=${payload}.${sigHex}`, {}, env);
  assert.equal(res.status, 200);

  const row: any = db.prepare('SELECT unsubscribed_at FROM user_marketing_prefs WHERE user_id = 1').get();
  assert.ok(row?.unsubscribed_at,
    'the unsubscribe recorded NOTHING. That is the production state D189 fixes: the lazy ALTER '
    + 'could not succeed at the column cap, the UPDATE after it failed, and the outer catch '
    + 'swallowed both while the reader was told it worked.');
});
