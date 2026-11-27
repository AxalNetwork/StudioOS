/**
 * D1591 (#3858) — GET /api/account/slug-check on real SQLite: the baseline's
 * tables, migrations 597 and 685 over them, and the router mounted at `/api`
 * as `index.ts` mounts it. Every person and company below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/slug_check_d1591.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import slugCheck from '../src/routes/slug_check.ts';
import { nextFreeSlug } from '../src/services/slugs.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M119 = readFileSync(new URL('../sql/migrations/119_project_membership.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');

// Ada belongs to Northwind (slug `northwind`); Dee belongs to Southwind (no slug).
// Ada founded a standalone venture (#20) and Northwind holds project #10.
const ADA = 1, DEE = 4;
const NORTH = 1, SOUTH = 2;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M119);
  db.exec(M597);
  db.exec(M685);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', ?, ?, 1)");
  u.run(ADA, 'Ada Made-up', 'ada@example.test'); u.run(DEE, 'Dee Made-up', 'dee@example.test');
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind Labs', 'northwind'); c.run(SOUTH, 'co-south', 'Southwind Made-up', null);
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, 'Admin', 1, '2026-01-01')");
  l.run('l-1', NORTH, ADA); l.run('l-2', SOUTH, DEE);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id, slug) VALUES (?, ?, ?, ?, ?)');
  p.run(10, 'Ledger in Northwind', ADA, NORTH, 'ledgerline');
  p.run(11, 'Ledger in Southwind', DEE, SOUTH, 'harbor');
  p.run(20, 'Ada standalone', ADA, null, 'solo');
  p.run(21, 'Dee standalone', DEE, null, 'dee-solo');
  return db;
}

const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function check(env: any, who: number | null, query: Record<string, string>) {
  const app = new Hono();
  app.route('/api', slugCheck);
  const headers: Record<string, string> = {};
  if (who != null) {
    const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/account/slug-check?${new URLSearchParams(query)}`, { headers }, env);
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

test('a free company slug is available, with its /c/ path and no suggestion', async () => {
  const env = envOf(fixture());
  const r = await check(env, DEE, { kind: 'company', slug: '  Harbor-Ledger ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { slug: 'harbor-ledger', available: true, reason: null, suggestion: null, path: '/c/harbor-ledger' });
});

test('a company slug held by a company the caller is not in is taken, with a suggestion, and names nobody', async () => {
  // Mutation checked: returning the holder's name (the body then carries "Northwind").
  const env = envOf(fixture());
  const r = await check(env, DEE, { kind: 'company', slug: 'northwind' });
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.equal(r.body.reason, 'slug_taken');
  assert.equal(r.body.suggestion, 'northwind-2');
  for (const leak of ['Northwind Labs', 'co-north', 'Ada', '"id"', 'count']) assert.ok(!r.text.includes(leak), `no ${leak} in the answer`);
});

test('project slugs are scoped: free in one company while taken in another, and taken among standalone projects', async () => {
  // Mutation checked: checking the project slug globally (harbor then reads taken in Northwind).
  const env = envOf(fixture());
  const inNorth = await check(env, ADA, { kind: 'project', slug: 'harbor', company: 'co-north' });
  assert.equal(inNorth.body.available, true, 'Southwind holding "harbor" does not take it in Northwind');
  assert.equal(inNorth.body.path, '/c/northwind/p/harbor');
  const taken = await check(env, ADA, { kind: 'project', slug: 'ledgerline', company: 'co-north' });
  assert.deepEqual([taken.body.available, taken.body.reason, taken.body.suggestion], [false, 'slug_taken', 'ledgerline-2']);
  const standalone = await check(env, ADA, { kind: 'project', slug: 'dee-solo' });
  assert.deepEqual([standalone.body.available, standalone.body.reason], [false, 'slug_taken']);
  assert.equal((await check(env, ADA, { kind: 'project', slug: 'ledgerline' })).body.available, true, 'a company project does not take a standalone slug');
  assert.equal((await check(env, DEE, { kind: 'project', slug: 'harbor', company: 'co-south' })).body.path, '/c/co-south/p/harbor', 'a company with no slug is addressed by uid');
});

test('a retired slug is taken for others and available with target set to its holder', async () => {
  // Mutations checked: ignoring slug_history (retired reads free for Dee); dropping the target exception.
  const db = fixture(); const env = envOf(db);
  db.prepare("INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by) VALUES ('company', NULL, 'oldnorth', ?, ?)").run(NORTH, ADA);
  db.prepare("INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by) VALUES ('project', NULL, 'oldsolo', 20, ?)").run(ADA);
  assert.equal((await check(env, DEE, { kind: 'company', slug: 'oldnorth' })).body.reason, 'slug_taken');
  assert.equal((await check(env, ADA, { kind: 'company', slug: 'oldnorth', target: 'co-north' })).body.available, true);
  assert.equal((await check(env, ADA, { kind: 'company', slug: 'northwind', target: 'co-north' })).body.available, true, 'its current slug too');
  assert.equal((await check(env, DEE, { kind: 'project', slug: 'oldsolo' })).body.available, false);
  assert.equal((await check(env, ADA, { kind: 'project', slug: 'oldsolo', target: '20' })).body.available, true);
  assert.equal((await check(env, ADA, { kind: 'project', slug: 'ledgerline', company: 'co-north', target: '10' })).body.available, true);
});

test('target counts only when the caller may reach it, so it cannot probe who holds a slug', async () => {
  const env = envOf(fixture());
  assert.equal((await check(env, DEE, { kind: 'company', slug: 'northwind', target: 'co-north' })).body.available, false, 'not a member of the target company');
  assert.equal((await check(env, DEE, { kind: 'project', slug: 'solo', target: '20' })).body.available, false, 'not the founder or a seat');
  assert.equal((await check(env, ADA, { kind: 'project', slug: 'ledgerline', company: 'co-north', target: '20' })).body.available, false, 'a target in another scope is ignored');
  assert.equal((await check(env, ADA, { kind: 'project', slug: 'ledgerline', company: 'co-north', target: '10x' })).body.available, false, 'a malformed target is ignored');
});

test('a project that left a company keeps its retired slug there, and a member of that company cannot claim it through target', async () => {
  // Mutation checked: the target's scope not compared (Dee's project then counts as Ada's target inside Northwind).
  const db = fixture(); const env = envOf(db);
  db.prepare("INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by) VALUES ('project', ?, 'gone-north', 21, ?)").run(NORTH, DEE);
  const r = await check(env, ADA, { kind: 'project', slug: 'gone-north', company: 'co-north', target: '21' });
  assert.deepEqual([r.body.available, r.body.reason], [false, 'slug_taken']);
});

test('a reserved word and a bad shape are 200s with their reason, no suggestion and no path', async () => {
  const env = envOf(fixture());
  assert.deepEqual((await check(env, ADA, { kind: 'company', slug: 'Settings' })).body,
    { slug: 'settings', available: false, reason: 'slug_reserved', suggestion: null, path: null });
  for (const bad of ['-lead', 'has space', 'a'.repeat(51), '']) {
    const r = await check(env, ADA, { kind: 'company', slug: bad });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.available, r.body.reason, r.body.suggestion], [false, 'slug_invalid', null], `"${bad}"`);
  }
});

test('the suggestion skips a taken -2 and gives -3; it is null when -2 to -20 are all taken', async () => {
  const db = fixture(); const env = envOf(db);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, slug, created_at, updated_at) VALUES (3, 'co-3', 'X', 'northwind-2', '2026-01-01', '2026-01-01')").run();
  assert.equal((await check(env, DEE, { kind: 'company', slug: 'northwind' })).body.suggestion, 'northwind-3');
  const ins = db.prepare("INSERT INTO company_profiles (id, uid, company_name, slug, created_at, updated_at) VALUES (?, ?, 'X', ?, '2026-01-01', '2026-01-01')");
  for (let n = 3; n <= 20; n += 1) ins.run(100 + n, `co-x${n}`, `northwind-${n}`);
  assert.equal((await check(env, DEE, { kind: 'company', slug: 'northwind' })).body.suggestion, null);
  assert.equal(await nextFreeSlug(env, 'company', 'a'.repeat(49)), null, 'a base too long for -2 has no suggestion');
});

test('company scope is the caller’s own: a non-member’s company and an unknown uid give the same 404 body', async () => {
  // Mutation checked: answering 403 for a non-member's company.
  const env = envOf(fixture());
  const other = await check(env, DEE, { kind: 'project', slug: 'x', company: 'co-north' });
  const unknown = await check(env, DEE, { kind: 'project', slug: 'x', company: 'co-nowhere' });
  assert.equal(other.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(other.text, unknown.text);
});

test('kind is required, and signed out is 401', async () => {
  const env = envOf(fixture());
  const bad = await check(env, ADA, { kind: 'fund', slug: 'x' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'kind_invalid');
  assert.equal((await check(env, null, { kind: 'company', slug: 'x' })).status, 401);
});
