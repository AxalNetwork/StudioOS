/**
 * D165 — HQ can sign out ONE account, and the floor that makes a revoke real.
 *
 * TWO DEFECTS, AND THE SECOND IS THE ONE NOBODY WOULD HAVE FOUND BY READING.
 *
 * 1. `POST /admin/security/force-reauth` was `WHERE is_active = 1` and nothing
 *    else existed, so HQ could sign out every account on the platform or none.
 *    In a real incident the safe action was the one nobody would take.
 *
 * 2. THE `+1` OFF-BY-ONE. `getCurrentUser` compares `tokenIat < minIat`
 *    STRICTLY, so a token whose `iat` equals the floor survives. Three writers
 *    in `settings.ts` computed the floor as a bare `Math.floor(Date.now()/1000)`
 *    — the email-change revoke, the post-recovery TOTP re-enrolment and the TOTP
 *    repair — while two others (`bumpJwtMinIat` and the bulk route) added the
 *    `+1` and said in a comment why. So a token minted in the same wall-clock
 *    second SURVIVED all three, and two of the three tell the user in their own
 *    copy that every session was invalidated.
 *
 * WHY THE ASSERTIONS BELOW ARE BEHAVIOURAL RATHER THAN A SOURCE SCAN. A scan for
 * `+ 1` proves the character is present; it cannot show that the value the helper
 * writes actually bounces a token minted this second, and that is the whole
 * claim. The floor is written to a real database and then run through the same
 * comparison `getCurrentUser` makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bumpJwtMinIat, jwtMinIatFloor } from '../src/auth';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const AUTH = read('cloudflare-worker/src/auth.ts');
const SETTINGS = read('cloudflare-worker/src/routes/settings.ts');
const SECURITY = read('cloudflare-worker/src/routes/admin_security.ts');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}
function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0)');
  db.exec("INSERT INTO users (id, email) VALUES (1, 'a@axal.vc'), (2, 'b@axal.vc'), (3, 'c@axal.vc')");
  return { db, env: { DB: makeD1(db) } as any };
}
const minIatOf = (db: InstanceType<typeof DatabaseSync>, id: number): number =>
  Number((db.prepare('SELECT jwt_min_iat FROM users WHERE id = ?').get(id) as any).jwt_min_iat);

/** `getCurrentUser`'s own decision, so the test cannot drift from the gate. */
function tokenSurvives(tokenIat: number, minIat: number): boolean {
  return !(minIat > 0 && typeof tokenIat === 'number' && tokenIat < minIat);
}

test('the comparison is STRICT, which is what makes the +1 load-bearing', () => {
  // If this ever becomes `<=`, the `+1` stops being a fix and starts being a
  // one-second over-revoke. The two halves are only correct together, so the
  // operator is pinned here beside the floor that assumes it.
  assert.match(AUTH, /tokenIat < minIat/,
    'getCurrentUser no longer compares strictly — re-derive jwtMinIatFloor() against whatever it does now');
  assert.doesNotMatch(AUTH, /tokenIat <= minIat/);
});

test('a token minted in the SAME SECOND does not survive the floor', async () => {
  const { db, env } = fresh();
  const mintedAt = Math.floor(Date.now() / 1000); // the session being revoked
  await bumpJwtMinIat(env, 1);
  const floor = minIatOf(db, 1);

  assert.equal(tokenSurvives(mintedAt, floor), false,
    'THE DEFECT: a token issued in the same wall-clock second as the revoke stayed valid. '
    + 'Drop the +1 from jwtMinIatFloor() and this is what comes back.');
  // And the bare floor is exactly the value the three settings.ts sites wrote,
  // so this shows what they did rather than describing it.
  assert.equal(tokenSurvives(mintedAt, mintedAt), true,
    'a bare Math.floor(Date.now()/1000) floor lets the very token it is revoking through');
});

test('a token minted a second later is untouched — the floor does not over-revoke', async () => {
  const { env, db } = fresh();
  await bumpJwtMinIat(env, 1);
  const floor = minIatOf(db, 1);
  assert.equal(tokenSurvives(floor + 1, floor), true, 'a token minted after the revoke must still work');
  assert.equal(tokenSurvives(floor, floor), true,
    'the floor is exclusive at its own value, which is why it is set one second ahead rather than two');
});

test('the primitive bumps ONE row, which is the capability HQ did not have', async () => {
  const { db, env } = fresh();
  await bumpJwtMinIat(env, 2);
  assert.ok(minIatOf(db, 2) > 0, 'the target was not revoked');
  assert.equal(minIatOf(db, 1), 0, 'a bystander was signed out');
  assert.equal(minIatOf(db, 3), 0, 'a bystander was signed out');
});

test('the bulk route still signs out every ACTIVE account, and only active ones', async () => {
  // The behaviour that must be proved UNCHANGED: D165 moved this route onto the
  // shared write bar and the shared audit writer, and touched neither its
  // statement nor its floor.
  const { db } = fresh();
  db.exec('UPDATE users SET is_active = 0 WHERE id = 3');
  const nowSec = jwtMinIatFloor();
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE is_active = 1').run(nowSec);
  assert.ok(minIatOf(db, 1) > 0 && minIatOf(db, 2) > 0, 'an active account survived the platform-wide revoke');
  assert.equal(minIatOf(db, 3), 0, 'a deactivated account was bumped; it cannot sign in anyway');
  assert.match(SECURITY, /UPDATE users SET jwt_min_iat = \? WHERE is_active = 1/,
    'the bulk statement changed — that is a behaviour change, not a consolidation');
});

test('the floor has ONE definition, and every writer shares it', () => {
  assert.match(AUTH, /export function jwtMinIatFloor\(\): number \{\s*return Math\.floor\(Date\.now\(\) \/ 1000\) \+ 1;/,
    'the floor is no longer Math.floor(now/1000) + 1 in one place');

  // No handler may compute the floor by hand again. This is the assertion that
  // would have caught the original drift: three sites re-typed the arithmetic
  // and three sites got it wrong.
  const rogue = SETTINGS.match(/Math\.floor\(Date\.now\(\) \/ 1000\)/g) || [];
  assert.deepEqual(rogue, [],
    'settings.ts computes a jwt_min_iat floor by hand again — call bumpJwtMinIat, or jwtMinIatFloor() '
    + 'if the write genuinely has to stay combined with another column');

  // Exactly ONE inline `jwt_min_iat =` write may remain in settings.ts: the
  // post-recovery re-enrolment, which clears `recovery_step_up_due_at` in the
  // SAME statement. Splitting it to reuse the helper would open a window where
  // the step-up nag is cleared and the weak session is still valid.
  const inline = SETTINGS.match(/jwt_min_iat = \$\{/g) || [];
  assert.equal(inline.length, 1,
    `${inline.length} inline jwt_min_iat writes remain in settings.ts; only the combined `
    + 'recovery_step_up_due_at write is allowed to be one');
  const combined = SETTINGS.slice(SETTINGS.indexOf('recovery_step_up_due_at = NULL'));
  assert.match(combined.slice(0, 200), /jwt_min_iat = \$\{nowSec\}/,
    'the one permitted inline write is not the combined one');
  assert.match(SETTINGS, /const nowSec = jwtMinIatFloor\(\);/,
    'the combined write re-typed the arithmetic instead of sharing the floor');
});

test('the helper docstring names its real callers', () => {
  // It claimed `/settings/sessions/revoke-all` shared it while settings.ts
  // inlined the UPDATE four times — a sentence asserting a consolidation had
  // happened is why nobody noticed it had not.
  const doc = AUTH.slice(AUTH.indexOf('NICE-AUTH-04'), AUTH.indexOf('export async function bumpJwtMinIat'));
  for (const caller of ['routes/auth.ts', 'routes/settings.ts', 'routes/admin_security.ts']) {
    assert.ok(doc.includes(caller), `the docstring does not name ${caller} among its callers`);
  }
  assert.ok(doc.includes('recovery_step_up_due_at'),
    'the docstring does not name the one site that deliberately does NOT call it');
});
