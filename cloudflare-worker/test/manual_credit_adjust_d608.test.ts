/**
 * D608 (#1308) — a manual grant or deduction goes through the grant service:
 * the Super Admin only, with a typed reason, one ledger line, one audit row,
 * one inbox notice, idempotent on its source, and never below zero. The
 * Super Admin's grants list shows it, marked manual.
 *
 * The schema is the Perks harness's (migrations 186, 198, 228, 322 and 381,
 * read off disk). `POST /perks/admin/credits` and `GET /admin/credit-rules/grants`
 * run through their real routers with real JWTs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/manual_credit_adjust_d608.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { JWT_SECRET, freshDb, makeD1, FOUNDER, ADMIN, balance } from './_perks_harness.ts';
import { grantCredits, revokeGrant, manualAdjust } from '../src/services/creditGrants.ts';
import creditRules from '../src/routes/admin_credit_rules.ts';
import perks from '../src/routes/perks.ts';

const SUPER = 30;
const REASON = 'Goodwill for the outage on 3 October';

function setup() {
  const db = freshDb();
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'admin', 'super@example.test')`).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const DB: any = makeD1(db, { beforeBatch: null });
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB } as any };
}
async function tok(id: number, role: string) {
  return new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const ROLES: Record<number, string> = { [SUPER]: 'admin', [ADMIN]: 'admin', [FOUNDER]: 'founder' };
async function call(router: any, env: any, method: string, path: string, who: number, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await tok(who, ROLES[who] || 'founder')}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await router.request(path, init, env);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const adjust = (env: any, who: number, body: unknown) => call(perks, env, 'POST', '/admin/credits', who, body);
const ledger = (db: any, userId: number) =>
  db.prepare('SELECT id, delta, kind, source_ref, note, rule_key FROM perk_credit_ledger WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x }));
const inbox = (db: any, userId: number) =>
  db.prepare('SELECT type, title, body FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x }));
const audit = (db: any) =>
  db.prepare("SELECT details FROM activity_logs WHERE action = 'credit_manual_adjust' ORDER BY id").all().map((x: any) => JSON.parse(x.details));
const rowCounts = (db: any) => [
  (db.prepare('SELECT COUNT(*) AS n FROM perk_credit_ledger').get() as any).n,
  (db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'credit_manual_adjust'").get() as any).n,
  inboxCount(db),
];
// The inbox table is created by the first notice, so before one it holds none.
function inboxCount(db: any) {
  try { return (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n; } catch { return 0; }
}

test('only the Super Admin adjusts: a plain admin and a founder are refused, and nothing is written', async () => {
  const { db, env } = setup();
  for (const who of [ADMIN, FOUNDER]) {
    const r = await adjust(env, who, { user_id: FOUNDER, delta: 50, reason: REASON });
    assert.equal(r.status, 403, `user ${who}`);
  }
  assert.deepEqual(rowCounts(db), [0, 0, 0]);
});

test('a grant writes one ledger line, one audit row with the reason, and one inbox notice', async () => {
  const { db, env } = setup();
  const r = await adjust(env, SUPER, { user_id: FOUNDER, delta: 50, reason: REASON, note: 'Thanks for your patience' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'recorded');
  assert.equal(r.body.balance, 50);
  assert.equal(r.body.notified, true);
  assert.match(r.body.source_ref, new RegExp(`^admin:${SUPER}:\\d{4}-\\d{2}-\\d{2}T`), 'the default source names the admin and the time');
  assert.deepEqual(ledger(db, FOUNDER).map((l: any) => [l.id, l.delta, l.kind, l.note, l.rule_key]),
    [[r.body.ledger_id, 50, 'grant', 'Thanks for your patience', 'manual']]);
  const a = audit(db);
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].target_user_id, a[0].delta, a[0].ledger_id, a[0].reason, a[0].source_ref],
    [FOUNDER, 50, r.body.ledger_id, REASON, r.body.source_ref]);
  const n = inbox(db, FOUNDER);
  assert.deepEqual(n.map((x: any) => [x.type, x.title]), [['credit_manual_adjust', '50 credits added to your account']]);
  assert.match(n[0].body, /^Thanks for your patience\. Credits have no cash value/);
  assert.doesNotMatch(n[0].body, /outage/, 'the reason is the audit\'s, not the member\'s');
});

test('a deduction writes an admin_adjust line, audits it and tells the member', async () => {
  const { db, env } = setup();
  await adjust(env, SUPER, { user_id: FOUNDER, delta: 80, reason: REASON, source_ref: 'seed' });
  const r = await adjust(env, SUPER, { user_id: FOUNDER, delta: -30, reason: 'Duplicate goodwill grant, reversed' });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 50);
  assert.equal(balance(db, FOUNDER), 50);
  const last = ledger(db, FOUNDER).at(-1);
  assert.deepEqual([last.delta, last.kind, last.rule_key, last.note], [-30, 'admin_adjust', 'manual', 'Credits deducted by the Axal team']);
  assert.equal(audit(db).at(-1).delta, -30);
  assert.equal(inbox(db, FOUNDER).at(-1).title, '30 credits deducted from your account');
  assert.deepEqual(rowCounts(db), [2, 2, 2]);
});

test('the reason is required: missing or under ten characters is refused, and nothing is written', async () => {
  const { db, env } = setup();
  for (const reason of [undefined, '', '   too short  ', '123456789']) {
    const r = await adjust(env, SUPER, { user_id: FOUNDER, delta: 10, reason });
    assert.equal(r.status, 400, String(reason));
    assert.equal(r.body.error, 'reason_too_short');
  }
  assert.equal((await adjust(env, SUPER, { user_id: FOUNDER, delta: 10, reason: '1234567890' })).status, 200, 'ten characters is enough');
  assert.deepEqual(rowCounts(db), [1, 1, 1]);
});

test('the change is a non-zero whole number within the bound, and the note at most 500 characters', async () => {
  const { db, env } = setup();
  for (const delta of [0, 1.5, '10', 100_001, -100_001, null]) {
    const r = await adjust(env, SUPER, { user_id: FOUNDER, delta, reason: REASON });
    assert.equal(r.status, 400, String(delta));
    assert.equal(r.body.error, 'invalid_delta');
  }
  assert.equal((await adjust(env, SUPER, { user_id: FOUNDER, delta: 100_000, reason: REASON })).status, 200, 'the bound itself is allowed');
  const long = await adjust(env, SUPER, { user_id: FOUNDER, delta: 1, reason: REASON, note: 'x'.repeat(501) });
  assert.deepEqual([long.status, long.body.error], [400, 'note_too_long']);
  assert.equal((await adjust(env, SUPER, { user_id: FOUNDER, delta: 1, reason: REASON, note: 'x'.repeat(500) })).status, 200);
  const ref = await adjust(env, SUPER, { user_id: FOUNDER, delta: 1, reason: REASON, source_ref: 'r'.repeat(121) });
  assert.deepEqual([ref.status, ref.body.error], [400, 'invalid_source_ref']);
  const nobody = await adjust(env, SUPER, { user_id: 9999, delta: 1, reason: REASON });
  assert.deepEqual([nobody.status, nobody.body.error], [404, 'user_not_found']);
  const bad = await adjust(env, SUPER, { user_id: 'x', delta: 1, reason: REASON });
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_user']);
  assert.deepEqual(rowCounts(db), [2, 2, 2]);
});

test('a repeated source_ref is a 409 naming the existing row, of either sign, and writes nothing', async () => {
  const { db, env } = setup();
  const first = await adjust(env, SUPER, { user_id: FOUNDER, delta: 40, reason: REASON, source_ref: 'support:812' });
  assert.equal(first.status, 200);
  for (const delta of [40, -10]) {
    const again = await adjust(env, SUPER, { user_id: FOUNDER, delta, reason: REASON, source_ref: 'support:812' });
    assert.equal(again.status, 409, `delta ${delta}`);
    assert.equal(again.body.error, 'already_recorded');
    assert.equal(again.body.ledger_id, first.body.ledger_id);
    assert.doesNotMatch(JSON.stringify(again.body), /UNIQUE|constraint|SQLITE/i);
  }
  // A rule grant's source is held too: a manual line never doubles it.
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:9', actor: { kind: 'system', source: 'test' } });
  const dup = await adjust(env, SUPER, { user_id: FOUNDER, delta: 5, reason: REASON, source_ref: 'ticket:9' });
  assert.deepEqual([dup.status, dup.body.ledger_id], [409, (g as any).ledger_id]);
  assert.deepEqual(rowCounts(db), [2, 1, 2]);
});

test('a deduction past the balance is refused with the balance, and writes nothing', async () => {
  const { db, env } = setup();
  await adjust(env, SUPER, { user_id: FOUNDER, delta: 20, reason: REASON });
  const r = await adjust(env, SUPER, { user_id: FOUNDER, delta: -21, reason: REASON });
  assert.deepEqual([r.status, r.body.error, r.body.balance], [400, 'would_overdraw', 20]);
  assert.equal((await adjust(env, SUPER, { user_id: FOUNDER, delta: -20, reason: REASON })).body.balance, 0, 'down to zero is allowed');
  assert.deepEqual(rowCounts(db), [2, 2, 2]);
});

test('two deductions racing cannot both pass the balance: the check is inside the insert', async () => {
  const { db, env } = setup();
  await manualAdjust(env, { userId: FOUNDER, delta: 30, reason: REASON, actor: { id: SUPER, email: 'super@example.test' } });
  const actor = { id: SUPER, email: 'super@example.test' };
  const [a, b] = await Promise.all([
    manualAdjust(env, { userId: FOUNDER, delta: -20, reason: REASON, sourceRef: 'race:a', actor }),
    manualAdjust(env, { userId: FOUNDER, delta: -20, reason: REASON, sourceRef: 'race:b', actor }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['recorded', 'refused']);
  assert.equal(balance(db, FOUNDER), 10);
});

test('the Super Admin\'s grants list shows manual lines beside rule grants, marked manual, and not a revoke line', async () => {
  const { env } = setup();
  const rule = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:1', actor: { kind: 'system', source: 'test' } });
  const plus = await adjust(env, SUPER, { user_id: FOUNDER, delta: 50, reason: REASON });
  const minus = await adjust(env, SUPER, { user_id: FOUNDER, delta: -5, reason: REASON });
  await revokeGrant(env, { ledgerId: plus.body.ledger_id, actor: { id: SUPER, email: 'super@example.test' }, reason: 'Granted to the wrong account' });
  for (const path of ['/grants', `/grants?user_id=${FOUNDER}`]) {
    const list = await call(creditRules, env, 'GET', path, SUPER);
    assert.equal(list.status, 200);
    const rows = list.body.grants.map((g: any) => [g.id, g.credits, g.rule_key, g.manual, g.revoked]).sort((x: any, y: any) => x[0] - y[0]);
    assert.deepEqual(rows, [
      [(rule as any).ledger_id, 20, 'bug_low', false, false],
      [plus.body.ledger_id, 50, 'manual', true, true],
      [minus.body.ledger_id, -5, 'manual', true, false],
    ], path);
  }
});
