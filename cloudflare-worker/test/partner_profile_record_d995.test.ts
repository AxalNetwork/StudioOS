/**
 * D995 (#2806) — Partner profiles part 6 on the Worker: the by-reference read
 * says whether Unbind applies, by POST /:ref/unbind's own rule, so PRF5f is
 * offered only when the write would take it. Real routes on `node:sqlite`.
 * Every person is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/partner_profile_record_d995.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import partnerProfiles from '../src/routes/admin_partner_profiles.ts';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 900, OLD = 910, NEW = 911, SAME = 912;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATIONS = ['275_partner_profiles_columns.sql', '556_partner_profiles_ref.sql', '557_partner_profile_review.sql']
  .map((f) => read(`cloudflare-worker/sql/migrations/${f}`));

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return { prepare: stmt, async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; } };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partner_profiles', 'user_role_review', 'activity_logs', 'esign_envelopes', 'esign_recipients', 'esign_audit_events']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIGRATIONS[0]);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  u.run(OLD, 'partner', 'Otto Old', 'otto.renamed@example.test');
  u.run(NEW, 'investor', 'Nell New', 'moved@example.test');
  u.run(SAME, 'partner', 'Sid Same', 'sid@example.test');
  const p = db.prepare("INSERT INTO partner_profiles (email, user_id, chat_history, persona, admin_status) VALUES (?, ?, '[1]', 'Advisor', 'pending')");
  p.run('moved@example.test', OLD);   // written for Otto; the address now belongs to Nell
  p.run('gone@example.test', OLD);    // written for Otto; no account holds the address now
  p.run('sid@example.test', SAME);    // still the holder's own
  p.run('free@example.test', null);   // never bound
  db.exec(MIGRATIONS[1]);
  db.exec(MIGRATIONS[2]);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any };
}

async function token(who: number, role: string) {
  return new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const APP = new Hono<any>().route('/', partnerProfiles);
APP.onError((err: any, c: any) => c.json({ error: String(err?.message || '') }, 500));
const refOf = (f: any, email: string) => (f.db.prepare('SELECT ref FROM partner_profiles WHERE email = ?').get(email) as any).ref;
async function readProfile(f: any, email: string) {
  const res = await APP.fetch(new Request(`http://x/${refOf(f, email)}`, { headers: { Authorization: `Bearer ${await token(ADMIN, 'admin')}` } }), f.env);
  return { status: res.status, body: await res.json() as any };
}

test('the profile read says whether Unbind applies, by the unbind route\'s own rule', async () => {
  const f = fixture();
  const moved = await readProfile(f, 'moved@example.test');
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body.unbind, { eligible: true, reason: null, holder: { user_id: NEW, name: 'Nell New' } }, 'the address now belongs to another account');
  assert.deepEqual((await readProfile(f, 'gone@example.test')).body.unbind, { eligible: true, reason: null, holder: null }, 'no account holds the address now');
  assert.deepEqual((await readProfile(f, 'sid@example.test')).body.unbind, { eligible: false, reason: 'address_still_theirs', holder: null });
  assert.deepEqual((await readProfile(f, 'free@example.test')).body.unbind, { eligible: false, reason: 'not_bound', holder: null });
  assert.equal(moved.body.ein, undefined, 'the tax ID still leaves masked');
});

test('an address matched in another case is the same holder, as the unbind route matches it', async () => {
  const f = fixture();
  f.db.prepare("UPDATE users SET email = 'SID@Example.TEST' WHERE id = ?").run(SAME);
  assert.equal((await readProfile(f, 'sid@example.test')).body.unbind.eligible, false);
});
