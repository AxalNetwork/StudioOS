/**
 * D443 — the studio glance on both tiers.
 *
 * HQ does not count its own user table as a subsidiary's seats. A branch
 * counts the seats in its own database. Run on node:sqlite. No live branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import glance from '../src/routes/admin_studio_glance.ts';
import { HQ_SEATS_REASON } from '../src/services/studioGlance.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d443-0123456789-abcdef';
const ADMIN_ID = 7;
const FOUNDER_ID = 9;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('users'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test', 1);
  u.run(FOUNDER_ID, 'founder', 'Founder One', 'founder@example.test', 1);
  u.run(10, 'founder', 'Founder Two', 'founder2@example.test', 1);
  u.run(11, 'investor', 'Quiet', 'quiet@example.test', 0);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
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

async function call(db: InstanceType<typeof DatabaseSync>, userId: number, branch: string | null) {
  const jwt = await new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env: Record<string, unknown> = {
    JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
  };
  if (branch) env.BRANCH_CODE = branch;
  const res = await glance.fetch(
    new Request('http://x/glance', { headers: { Authorization: `Bearer ${jwt}` } }),
    env as any,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

test('on HQ the per-subsidiary figures stay unrecorded, and the user table is not a seat count', async () => {
  const db = freshDb();
  db.exec(`CREATE TABLE legal_templates (
    id INTEGER PRIMARY KEY, slug TEXT, category TEXT, title TEXT, is_active INTEGER
  )`);
  db.prepare('INSERT INTO legal_templates (slug, category, title, is_active) VALUES (?, ?, ?, ?)').run('msa', 'legal', 'MSA', 1);
  db.prepare('INSERT INTO legal_templates (slug, category, title, is_active) VALUES (?, ?, ?, ?)').run('old', 'legal', 'Old', 0);
  const r = await call(db, ADMIN_ID, null);
  assert.equal(r.status, 200);
  assert.equal(r.body.tier, 'hq');
  assert.equal(r.body.branch, null);
  assert.equal(r.body.seats.recorded, false);
  assert.match(HQ_SEATS_REASON, /U1/);
  assert.match(HQ_SEATS_REASON, /not shown as zero/);
  assert.equal(r.body.seats.reason, HQ_SEATS_REASON);
  assert.equal(r.body.seats.seats_used_by_type, undefined);
  assert.equal(r.body.approvals.recorded, false);
  assert.match(r.body.approvals.reason, /U1/);
  assert.equal(r.body.agreements.recorded, true, 'agreements are this database\'s, not a U1 refusal');
  assert.equal(r.body.agreements.expiring, null, 'a missing agreement table is unreadable, not zero');
  assert.doesNotMatch(String(r.body.agreements.reason || ''), /U1/);
  assert.equal(r.body.insights.recorded, false);
  assert.equal(r.body.insights.reason, 'HQ pushes the median and keeps no copy.');
  assert.equal(r.body.revenue.recorded, false);
  assert.match(r.body.revenue.reason, /U1/);
  assert.equal(r.body.licence.recorded, false);
  assert.match(r.body.licence.reason, /U1/);
  assert.equal(r.body.programme.recorded, true);
  assert.equal(r.body.programme.zone, 'America/New_York');
  assert.equal(r.body.programme.pending_accounts, null);
  assert.equal(r.body.templates.available, true);
  assert.deepEqual(r.body.templates.items.map((row: { slug: string }) => row.slug), ['msa']);
  assert.doesNotMatch(r.text, /no such column|no such table|SQLITE/i);
  assert.doesNotMatch(JSON.stringify(r.body.seats), /founder/);
});

test('on a branch, seats are this database\'s active seat roles, and a measured zero stays zero', async () => {
  const db = freshDb();
  db.exec(`CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY,
    licence_uid TEXT, licence_ref TEXT, legal_entity TEXT, brand_name TEXT, territory TEXT,
    status TEXT, seats_json TEXT, revenue_share_bps INTEGER, token_split_bps INTEGER,
    annual_fee_cents INTEGER, currency TEXT, term_start TEXT, term_end TEXT, renewal_at TEXT,
    template_version TEXT, suspended_at TEXT, suspended_note TEXT, registered_address TEXT,
    signatory_name TEXT, signatory_title TEXT, term_years INTEGER, terminated_at TEXT,
    kind TEXT, pushed_at TEXT
  )`);
  db.prepare(
    `INSERT INTO branch_licence
       (id, licence_uid, territory, status, seats_json, revenue_share_bps, kind, pushed_at)
     VALUES (1, 'lic', 'FR', 'active', ?, 3500, 'subsidiary', '2026-09-01T00:00:00Z')`,
  ).run('{"founder":10,"investor":4,"advisor":2,"partner":2}');
  const r = await call(db, ADMIN_ID, 'fr');
  assert.equal(r.status, 200);
  assert.equal(r.body.tier, 'branch');
  assert.equal(r.body.branch, 'fr');
  assert.equal(r.body.seats.recorded, true);
  assert.equal(r.body.seats.seats_used_by_type.founder, 2);
  assert.equal(r.body.seats.seats_used_by_type.investor, 0);
  assert.equal(r.body.seats.seats.founder, 10);
  assert.equal(r.body.licence.recorded, true);
  assert.equal(r.body.licence.revenue_share_bps, 3500);
  assert.equal(r.body.approvals.recorded, true);
  assert.ok(Array.isArray(r.body.approvals.lanes));
  assert.equal(r.body.programme.recorded, true);
  assert.equal(r.body.programme.zone, 'America/New_York');
  assert.doesNotMatch(r.body.seats.reason || '', /U1/);
  assert.doesNotMatch(r.text, /no such column|no such table|SQLITE/i);
});

test('a non-admin is refused, and the refusal is not the database talking', async () => {
  const db = freshDb();
  const r = await call(db, FOUNDER_ID, null);
  assert.equal(r.status, 403);
  assert.equal(r.body.detail, 'Admin required');
  assert.doesNotMatch(r.text, /no such column|no such table|SQLITE/i);
});

test('the HQ glance does not count users, and the route is not branch-only', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/studioGlance.ts'), 'utf8');
  const hq = src.slice(src.indexOf('async function hqGlance'), src.indexOf('async function branchGlance'));
  assert.ok(hq.includes('hqPerSubsidiary'), 'the HQ refusal moved');
  assert.doesNotMatch(hq, /FROM users|laneCounts|branchHome\(|branch_benchmarks/, 'HQ counts a subsidiary figure, or reads the benchmark copy it never writes');
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_studio_glance.ts'), 'utf8');
  assert.match(route, /requireAdmin/);
  assert.doesNotMatch(route, /requireBranchTier/);
  const index = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  const glanceAt = index.indexOf("app.route('/api/admin/studio', adminStudioGlance)");
  const catchAll = index.indexOf("app.route('/api/admin', admin)");
  assert.ok(glanceAt > 0 && glanceAt < catchAll, 'the glance is not mounted before the admin catch-all');
});
