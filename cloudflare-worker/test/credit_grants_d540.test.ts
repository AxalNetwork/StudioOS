/**
 * D540 — reward rules and the one grant service on the perk credit ledger.
 *
 * The schema is the Perks harness's (migrations 186, 198, 228, 322 and 381
 * itself, read off disk), so the rules, the seeded amounts and the
 * `rule_key` column are the ones production gets. `grantCredits` and
 * `revokeGrant` run for real, and the Super Admin routes and `GET /perks/mine`
 * are driven through their real routers with real JWTs.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/credit_grants_d540.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { JWT_SECRET, freshDb, makeD1, FOUNDER, FOUNDER_B, PARTNER, ADMIN, INVESTOR, balance } from './_perks_harness.ts';
import { grantCredits, revokeGrant, monthStart, isBountyRule } from '../src/services/creditGrants.ts';
import creditRules from '../src/routes/admin_credit_rules.ts';
import perks, { ledgerSource } from '../src/routes/perks.ts';

const SUPER = 30;
const SYSTEM = { kind: 'system' as const, source: 'test' };
const REASON = 'Paid in error on a duplicate report';

function setup() {
  const db = freshDb();
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'admin', 'super@example.test')`).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const hooks = { beforeBatch: null };
  const DB: any = makeD1(db, hooks);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB };
  return { db, env };
}

async function tok(id: number, role: string) {
  return new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const ROLES: Record<number, string> = { [SUPER]: 'admin', [ADMIN]: 'admin', [FOUNDER]: 'founder', [PARTNER]: 'partner' };
async function call(router: any, env: any, method: string, path: string, who: number, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await tok(who, ROLES[who] || 'founder')}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await router.request(path, init, env);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const ledger = (db: any, userId: number) =>
  db.prepare('SELECT id, delta, kind, source_ref, note, rule_key FROM perk_credit_ledger WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x }));
const inbox = (db: any, userId: number) => {
  try { return db.prepare('SELECT type, title, body FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x })); }
  catch { return []; }
};
const logs = (db: any, action: string) =>
  db.prepare('SELECT action, details, actor, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action).map((x: any) => ({ ...x }));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

// ---- the rule table --------------------------------------------------------

test('migration 381 seeds the #1102 amounts, at US$1 a credit, and the cap', () => {
  const { db } = setup();
  const amt = (k: string) => db.prepare('SELECT credits, usd_value_cents, active FROM credit_reward_rules WHERE key = ?').get(k) as any;
  assert.deepEqual({ ...amt('bug_high') }, { credits: 150, usd_value_cents: 15000, active: 1 });
  assert.equal(amt('bug_medium').credits, 60);
  assert.equal(amt('bug_low').credits, 20);
  assert.equal(amt('task_approved').credits, 10);
  assert.equal(amt('cap:bounty_monthly').credits, 500);
  const required = ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted', 'scoring_run_completed',
    'advisor_meeting_booked', 'incorporation_completed', 'graduation'];
  assert.equal(required.reduce((a, k) => a + amt(`lab:${k}`).credits, 0), 1000, 'the required path totals 1,000');
  assert.equal(amt('lab:data_room_built').credits, 10, 'an optional milestone is 10');
  assert.equal(amt('lab:project_created'), undefined, 'week 1 pays nothing');
  const off = db.prepare('SELECT COUNT(*) AS n FROM credit_reward_rules WHERE usd_value_cents <> credits * 100').get() as any;
  assert.equal(off.n, 0);
});

// ---- grantCredits ----------------------------------------------------------

test('a grant is idempotent: the same source pays once, and the user is told once', async () => {
  const { db, env } = setup();
  const a = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:7', actor: SYSTEM });
  assert.equal(a.status, 'granted');
  assert.equal((a as any).credits, 150);
  const b = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:7', actor: SYSTEM });
  assert.equal(b.status, 'already_granted');
  assert.equal((b as any).ledger_id, (a as any).ledger_id);
  assert.deepEqual(ledger(db, FOUNDER).map((l: any) => [l.delta, l.kind, l.source_ref, l.rule_key]), [[150, 'grant', 'ticket:7', 'bug_high']]);
  assert.equal(balance(db, FOUNDER), 150);
  const notes = inbox(db, FOUNDER);
  assert.equal(notes.length, 1, 'one notice, not two');
  assert.match(notes[0].title, /150 credits \(US\$150\)/);
  assert.match(notes[0].body, /A bug you reported was confirmed and fixed \(high impact\)/);
  const audit = logs(db, 'credit_grant');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, 'system:test', 'a system grant names its source as the actor');
  assert.equal(JSON.parse(audit[0].details).rule_key, 'bug_high');
});

test('the amount is the rule\'s, read at grant time; an inactive or unknown rule pays nothing', async () => {
  const { db, env } = setup();
  db.prepare("UPDATE credit_reward_rules SET credits = 75, usd_value_cents = 7500 WHERE key = 'bug_medium'").run();
  const a = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_medium', sourceRef: 'ticket:1', actor: SYSTEM });
  assert.equal((a as any).credits, 75);
  db.prepare("UPDATE credit_reward_rules SET active = 0 WHERE key = 'bug_low'").run();
  const off = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:2', actor: SYSTEM });
  assert.equal(off.status, 'refused');
  assert.equal((off as any).code, 'rule_inactive');
  const none = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_critical', sourceRef: 'ticket:3', actor: SYSTEM });
  assert.equal((none as any).code, 'rule_unknown');
  const cap = await grantCredits(env, { userId: FOUNDER, ruleKey: 'cap:bounty_monthly', sourceRef: 'x', actor: SYSTEM });
  assert.equal((cap as any).code, 'invalid_request', 'the cap is never paid as a reward');
  assert.equal(balance(db, FOUNDER), 75);
});

test('a paid source answers already_granted even after its rule is switched off or the recipient changes role', async () => {
  const { db, env } = setup();
  const a = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:50', actor: SYSTEM }) as any;
  assert.equal(a.status, 'granted');
  db.prepare("UPDATE credit_reward_rules SET active = 0 WHERE key = 'bug_low'").run();
  const off = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:50', actor: SYSTEM }) as any;
  assert.deepEqual([off.status, off.ledger_id], ['already_granted', a.ledger_id], 'a retry of a paid event is not a failure');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(FOUNDER);
  const staff = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:50', actor: SYSTEM }) as any;
  assert.equal(staff.status, 'already_granted');
  const fresh = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:51', actor: SYSTEM }) as any;
  assert.equal(fresh.code, 'rule_inactive', 'a new source still meets the rule as it stands');
  assert.equal(ledger(db, FOUNDER).length, 1);
});

test('staff and admin accounts are refused; the role is read, not trusted', async () => {
  const { db, env } = setup();
  for (const id of [ADMIN, SUPER, PARTNER]) {
    const r = await grantCredits(env, { userId: id, ruleKey: 'bug_high', sourceRef: `ticket:${id}`, actor: SYSTEM });
    assert.equal(r.status, 'refused', String(id));
    assert.equal((r as any).code, 'not_eligible', String(id));
    assert.deepEqual(ledger(db, id), [], 'nothing written');
    assert.deepEqual(inbox(db, id), [], 'nobody told');
  }
  const inv = await grantCredits(env, { userId: INVESTOR, ruleKey: 'task_approved', sourceRef: 'task:1', actor: SYSTEM });
  assert.equal(inv.status, 'granted', 'a non-staff account earns');
  const ghost = await grantCredits(env, { userId: 999, ruleKey: 'bug_low', sourceRef: 'ticket:9', actor: SYSTEM });
  assert.equal((ghost as any).code, 'user_not_found');
});

test('the monthly bounty cap: a grant that would cross it is refused whole; Lab milestones are not bounties', async () => {
  const { db, env } = setup();
  for (const n of [1, 2, 3]) {
    assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: `ticket:${n}`, actor: SYSTEM })).status, 'granted');
  }
  const over = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_medium', sourceRef: 'ticket:4', actor: SYSTEM });
  assert.equal(over.status, 'refused');
  assert.equal((over as any).code, 'cap_reached');
  assert.deepEqual((over as any).cap, { limit: 500, used: 450 });
  assert.match((over as any).message, /500 credits bounty limit for the month \(450 credits granted so far\)/);
  // Exactly up to the cap is allowed.
  db.prepare("UPDATE credit_reward_rules SET credits = 50 WHERE key = 'bug_low'").run();
  assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:5', actor: SYSTEM })).status, 'granted');
  assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'task_approved', sourceRef: 'task:1', actor: SYSTEM }) as any).code, 'cap_reached');
  const lab = await grantCredits(env, { userId: FOUNDER, ruleKey: 'lab:incorporation_completed', sourceRef: `lab:${FOUNDER}:incorporation_completed`, actor: SYSTEM });
  assert.equal(lab.status, 'granted', 'a milestone is not capped');
  // Another user's bounties are theirs alone, and their Lab credits do not
  // eat into their bounty room: 400 from a milestone, then 450 of bounties.
  assert.equal((await grantCredits(env, { userId: FOUNDER_B, ruleKey: 'lab:incorporation_completed', sourceRef: `lab:${FOUNDER_B}:incorporation_completed`, actor: SYSTEM })).status, 'granted');
  for (const n of [6, 7, 8]) {
    assert.equal((await grantCredits(env, { userId: FOUNDER_B, ruleKey: 'bug_high', sourceRef: `ticket:${n}`, actor: SYSTEM })).status, 'granted', `ticket ${n}`);
  }
  assert.equal(balance(db, FOUNDER_B), 850);
  assert.equal(balance(db, FOUNDER), 900);
});

test('the cap counts this calendar month only, and a revoked grant frees its room', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, rule_key, created_at)
              VALUES (?, 500, 'grant', 'ticket:old', 'bug_high', '2000-01-15T00:00:00.000Z')`).run(FOUNDER);
  const a = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:1', actor: SYSTEM });
  assert.equal(a.status, 'granted', 'last month\'s bounties do not count');
  for (const n of [2, 3]) await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: `ticket:${n}`, actor: SYSTEM });
  assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:4', actor: SYSTEM }) as any).code, 'cap_reached');
  const rv = await revokeGrant(env, { ledgerId: (a as any).ledger_id, actor: { id: SUPER, email: 'super@example.test' }, reason: REASON });
  assert.equal(rv.status, 'revoked');
  assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:4', actor: SYSTEM })).status, 'granted');
  assert.match(monthStart(new Date('2026-10-31T23:59:59Z')), /^2026-10-01$/);
  assert.equal(isBountyRule('lab:graduation'), false);
  assert.equal(isBountyRule('feature_shipped_low'), true);
});

test('an admin grant is recorded through logAdminAction with the admin as actor', async () => {
  const { db, env } = setup();
  const r = await grantCredits(env, { userId: FOUNDER, ruleKey: 'task_approved', sourceRef: 'task:3', actor: { kind: 'admin', id: SUPER, email: 'super@example.test' }, note: 'Your onboarding checklist task' });
  assert.equal(r.status, 'granted');
  const audit = logs(db, 'credit_grant');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, SUPER);
  assert.equal(JSON.parse(audit[0].details).target_user_id, FOUNDER);
  assert.equal(ledger(db, FOUNDER)[0].note, 'Your onboarding checklist task');
});

// ---- revoke ------------------------------------------------------------------

test('a revoke writes admin_adjust with the reason and the Super Admin as actor, once', async () => {
  const { db, env } = setup();
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_medium', sourceRef: 'ticket:11', actor: SYSTEM }) as any;
  const r = await call(creditRules, env, 'POST', `/grants/${g.ledger_id}/revoke`, SUPER, { reason: REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'revoked');
  const rows = ledger(db, FOUNDER);
  assert.deepEqual(rows.map((l: any) => [l.delta, l.kind, l.source_ref, l.note, l.rule_key]), [
    [60, 'grant', 'ticket:11', 'A bug you reported was confirmed and fixed (medium impact)', 'bug_medium'],
    [-60, 'admin_adjust', `revoke:${g.ledger_id}`, REASON, 'bug_medium'],
  ]);
  const audit = logs(db, 'credit_grant_revoke');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, SUPER, 'the actor is the Super Admin');
  assert.equal(JSON.parse(audit[0].details).reason, REASON);
  assert.equal(JSON.parse(audit[0].details).grant_ledger_id, g.ledger_id);
  assert.match(inbox(db, FOUNDER).at(-1).body, /Paid in error on a duplicate report/);
  const listed = await call(creditRules, env, 'GET', `/grants?user_id=${FOUNDER}`, SUPER);
  assert.deepEqual(listed.body.grants.map((x: any) => [x.id, x.revoked, x.revoke_reason]), [[g.ledger_id, true, REASON]],
    'the grant list shows it revoked, with why; the revoke line is not itself listed as a grant');
  const again = await call(creditRules, env, 'POST', `/grants/${g.ledger_id}/revoke`, SUPER, { reason: REASON });
  assert.equal(again.body.status, 'already_revoked');
  assert.equal(ledger(db, FOUNDER).length, 2, 'the second revoke wrote nothing');
  assert.equal(balance(db, FOUNDER), 0);
});

test('a revoke needs a typed reason, a real grant, and credits still unspent', async () => {
  const { db, env } = setup();
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:12', actor: SYSTEM }) as any;
  const short = await call(creditRules, env, 'POST', `/grants/${g.ledger_id}/revoke`, SUPER, { reason: 'oops' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_too_short');
  const missing = await call(creditRules, env, 'POST', '/grants/9999/revoke', SUPER, { reason: REASON });
  assert.equal(missing.status, 404);
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref) VALUES (?, -15, 'spend', 'perk:c1')`).run(FOUNDER);
  const spent = await call(creditRules, env, 'POST', `/grants/${g.ledger_id}/revoke`, SUPER, { reason: REASON });
  assert.equal(spent.status, 409);
  assert.equal(spent.body.error, 'would_overdraw');
  assert.equal(spent.body.balance, 5);
  assert.equal(ledger(db, FOUNDER).filter((l: any) => l.kind === 'admin_adjust').length, 0);
  assert.equal(logs(db, 'credit_grant_revoke').length, 0);
});

// ---- the Super Admin gate and rule edits --------------------------------------

test('every credit-rules route is the Super Admin\'s: a plain admin and a founder are refused', async () => {
  const { db, env } = setup();
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:13', actor: SYSTEM }) as any;
  for (const who of [ADMIN, FOUNDER]) {
    for (const [m, p, b] of [['GET', '/'], ['GET', '/grants'], ['PUT', '/bug_low', { credits: 1, reason: REASON }],
      ['POST', `/grants/${g.ledger_id}/revoke`, { reason: REASON }]] as const) {
      const r = await quiet(() => call(creditRules, env, m, p, who, b));
      assert.equal(r.status, 403, `${who} ${m} ${p}`);
    }
  }
  assert.equal((db.prepare("SELECT credits FROM credit_reward_rules WHERE key = 'bug_low'").get() as any).credits, 20);
  assert.equal(ledger(db, FOUNDER).length, 1);
  const ok = await call(creditRules, env, 'GET', '/', SUPER);
  assert.equal(ok.status, 200);
  const byKey = Object.fromEntries(ok.body.rules.map((x: any) => [x.key, x]));
  assert.equal(byKey.bug_high.kind, 'bounty');
  assert.equal(byKey['cap:bounty_monthly'].kind, 'cap');
  assert.equal(byKey['lab:graduation'].kind, 'lab');
  const grants = await call(creditRules, env, 'GET', `/grants?user_id=${FOUNDER}`, SUPER);
  assert.deepEqual(grants.body.grants.map((x: any) => [x.rule_key, x.credits, x.revoked]), [['bug_low', 20, false]]);
});

test('a rule edit takes a reason, is logged from and to, and is the amount the next grant pays', async () => {
  const { db, env } = setup();
  const noReason = await call(creditRules, env, 'PUT', '/bug_high', SUPER, { credits: 200 });
  assert.equal(noReason.status, 400);
  assert.equal((db.prepare("SELECT credits FROM credit_reward_rules WHERE key = 'bug_high'").get() as any).credits, 150);
  for (const credits of [-5, 100_001, 1.5, 'ten']) {
    const bad = await call(creditRules, env, 'PUT', '/bug_high', SUPER, { credits, reason: REASON });
    assert.equal(bad.status, 400, String(credits));
    assert.equal(bad.body.error, 'invalid_credits', String(credits));
  }
  assert.equal((db.prepare("SELECT credits FROM credit_reward_rules WHERE key = 'bug_high'").get() as any).credits, 150);
  const priced = await call(creditRules, env, 'PUT', '/bug_high', SUPER, { credits: 200, usd_value_cents: 15000, reason: REASON });
  assert.equal(priced.status, 400, 'a dollar value that is not credits x US$1 is refused');
  assert.equal(priced.body.error, 'usd_value_fixed');
  assert.deepEqual({ ...(db.prepare("SELECT credits, usd_value_cents FROM credit_reward_rules WHERE key = 'bug_high'").get() as any) }, { credits: 150, usd_value_cents: 15000 });
  const matched = await call(creditRules, env, 'PUT', '/bug_low', SUPER, { credits: 30, usd_value_cents: 3000, reason: REASON });
  assert.equal(matched.status, 200, 'a matching value is accepted');
  const unknown = await call(creditRules, env, 'PUT', '/bug_critical', SUPER, { credits: 5, reason: REASON });
  assert.equal(unknown.status, 404);
  const r = await call(creditRules, env, 'PUT', `/${encodeURIComponent('lab:graduation')}`, SUPER, { credits: 300, reason: 'Owner raised the graduation bonus' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.rule.credits, r.body.rule.usd_value_cents, r.body.rule.updated_by], [300, 30000, SUPER]);
  const audit = logs(db, 'credit_rule_update').filter((l: any) => JSON.parse(l.details).rule_key === 'lab:graduation');
  assert.equal(audit.length, 1);
  const d = JSON.parse(audit[0].details);
  assert.deepEqual([d.rule_key, d.from.credits, d.to.credits, d.reason], ['lab:graduation', 250, 300, 'Owner raised the graduation bonus']);
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'lab:graduation', sourceRef: `lab:${FOUNDER}:graduation`, actor: SYSTEM });
  assert.equal((g as any).credits, 300);
  const off = await call(creditRules, env, 'PUT', '/bug_high', SUPER, { active: false, reason: REASON });
  assert.equal(off.body.rule.active, false);
  assert.equal((await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_high', sourceRef: 'ticket:20', actor: SYSTEM }) as any).code, 'rule_inactive');
});

// ---- the user's balance on /perks/mine ----------------------------------------

test('/perks/mine shows each grant\'s reason and source, and a revoked grant as revoked', async () => {
  const { env } = setup();
  const g = await grantCredits(env, { userId: FOUNDER, ruleKey: 'lab:okrs_created', sourceRef: `lab:${FOUNDER}:okrs_created`, actor: SYSTEM }) as any;
  await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:31', actor: SYSTEM });
  await revokeGrant(env, { ledgerId: g.ledger_id, actor: { id: SUPER, email: 'super@example.test' }, reason: REASON });
  const r = await call(perks, env, 'GET', '/mine', FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balance, 20);
  assert.equal(r.body.credit_usd_cents, 100);
  const byRef = Object.fromEntries(r.body.ledger.map((l: any) => [l.source_ref, l]));
  assert.equal(byRef[`lab:${FOUNDER}:okrs_created`].reason, 'Spin-Out Lab milestone completed: okrs created');
  assert.equal(byRef[`lab:${FOUNDER}:okrs_created`].source, 'Spin-Out Lab: okrs created');
  assert.equal(byRef[`lab:${FOUNDER}:okrs_created`].revoked, true);
  assert.equal(byRef['ticket:31'].revoked, false);
  assert.equal(byRef['ticket:31'].source, 'Support ticket #31');
  assert.equal(byRef[`revoke:${g.ledger_id}`].reason, REASON);
  assert.equal(byRef[`revoke:${g.ledger_id}`].revoked, false, 'only a grant can be revoked');
  assert.equal(ledgerSource('something-else'), null);
});

test('/perks/mine: a rule grant with no note still says why, from its rule', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, rule_key)
              VALUES (?, 10, 'grant', 'task:5', NULL, 'task_approved')`).run(FOUNDER);
  const r = await call(perks, env, 'GET', '/mine', FOUNDER);
  assert.equal(r.body.ledger[0].reason, 'A task you suggested was approved for the community task list');
  assert.equal(r.body.ledger[0].source, 'Suggested task #5');
});

test('/perks/mine: a balance read that fails is a refusal, never a balance of 0', async () => {
  const { env } = setup();
  await grantCredits(env, { userId: FOUNDER, ruleKey: 'bug_low', sourceRef: 'ticket:41', actor: SYSTEM });
  const prepare = env.DB.prepare;
  env.DB.prepare = (sql: string) => {
    if (/SELECT COALESCE\(SUM\(delta\), 0\) AS bal FROM perk_credit_ledger WHERE user_id = \?/.test(sql)) {
      return { bind: () => ({ first: async () => { throw new Error('D1_ERROR: disk I/O error'); } }) };
    }
    return prepare(sql);
  };
  const r = await quiet(() => call(perks, env, 'GET', '/mine', FOUNDER));
  assert.equal(r.status, 500);
  assert.equal('balance' in (r.body || {}), false, 'no balance rides on a failed read');
  assert.doesNotMatch(JSON.stringify(r.body), /disk I\/O/);
});
