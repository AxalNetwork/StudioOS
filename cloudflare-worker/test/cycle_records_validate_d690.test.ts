import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { ownedRow } from '../src/services/records/owned.ts';
import type { RecordRegistry } from '../src/services/records/types.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');
const KEY = 'fixture-key-for-d690-tests';
const P = 1, OTHER_P = 2;
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 30: 'admin', 40: 'partner', 50: 'investor', 60: 'exploring' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
    'discovery_interviews', 'hypothesis_pain_links', 'competitor_analyses', 'competitor_candidates', 'competitor_signals',
    'waitlist_signups', 'metric_targets', 'interview_pain_severities', 'pain_group_aliases', 'competitor_sources',
    'validate_proposals']) {
    db.exec(tableFromBaseline(BASE, t));
  }
  db.exec(migration('311_revenue_entries.sql'));
  db.exec(migration('440_validate_cycle_stores.sql'));
  db.exec(migration('438_interview_sessions.sql'));
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null],
    [40, 'partner', null], [50, 'investor', null], [60, 'exploring', 1001]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder, id === 60 ? 1 : 0);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002)");
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Theme One'), (22, 2, 'Theme Two')");
  return db;
}

const spec = {
  read: 'read' as const, write: 'write' as const, store: 'pain_groups' as const,
  async record(_ctx: unknown, id: string) { return { title: `Theme ${id}`, facts: [{ label: 'Severity', value: null, reason: 'Not recorded' }] }; },
  sections: [
    { key: 'public', title: 'Public', async read() { return { rows: [{ a: 'Public fact' }] }; } },
    { key: 'writer', title: 'Writer', gate: 'write' as const, async read() { return { rows: [{ a: 'Private fact' }] }; } },
  ],
  async actions() { return [{ key: 'edit', label: 'Edit', kind: 'write' as const,
    async execute() { return { ok: true }; } }]; },
  async formOptions(_ctx: unknown, query: Record<string, string>) { return query; },
};
const registry: RecordRegistry = { validate: { 'problem-discovery': spec,
  'customer-research': { ...spec, formOptions: undefined } } };

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown,
  activeRegistry: RecordRegistry = registry) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(activeRegistry));
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((error: Error, c) => c.json({ detail: error.message }, 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await app.request(`/api/cycles${path}`, { method, headers: {
    Authorization: `Bearer ${token}`,
    ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
  }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) },
  { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D690 record contract refuses unknown cycles and foreign or malformed IDs before record reads', async () => {
  const db = fixture();
  const base = '/validate/modules/problem-discovery/records/';
  assert.equal((await call(db, 10, 'GET', '/unknown/modules/problem-discovery/records/11?project=1')).status, 404);
  assert.match((await call(db, 10, 'GET', '/build/modules/problem-discovery/records/11?project=1')).body.detail, /not built yet/);
  for (const suffix of ['22?project=1', 'Acme%20Corp?project=1']) {
    assert.equal((await call(db, 10, 'GET', base + suffix)).status, 404);
  }
  assert.equal((await call(db, 10, 'GET', base + '22/activity?project=1')).status, 404);
  assert.equal((await call(db, 10, 'POST', base + '22/actions/edit?project=1')).status, 404);
  assert.equal((await call(db, 10, 'PATCH', base + '22?project=1')).status, 404);
  assert.equal((await call(db, 10, 'DELETE', base + '22?project=1')).status, 404);
});

test('D690 section, role, action and form-options gates share the module contract', async () => {
  const db = fixture();
  const base = '/validate/modules/problem-discovery/records/11?project=1';
  for (const who of [10, 30, 60]) {
    const read = await call(db, who, 'GET', base);
    assert.equal(read.status, 200);
    assert.equal(read.body.main.length, 2);
    assert.equal(read.body.actions[0].key, 'edit');
  }
  const partner = await call(db, 40, 'GET', base);
  assert.equal(partner.status, 200);
  assert.deepEqual(partner.body.main.map((s: any) => s.key), ['public']);
  assert.deepEqual(partner.body.actions, []);
  assert.equal((await call(db, 40, 'POST', base.replace('?project=', '/actions/edit?project='))).status, 403);
  for (const who of [20, 50]) assert.equal((await call(db, who, 'GET', base)).status, 403);
  assert.equal((await call(db, 10, 'POST', base.replace('?project=', '/actions/undeclared?project='))).status, 404);
  assert.equal((await call(db, 10, 'POST', base.replace('?project=', '/actions/edit?project='))).status, 200);
  const opts = await call(db, 10, 'GET', '/validate/modules/problem-discovery/form-options?project=1&q=two%20words&filter=kind%3Aone');
  assert.deepEqual(opts.body, { q: 'two words', filter: 'kind:one' });
  assert.deepEqual((await call(db, 10, 'GET', '/validate/modules/customer-research/form-options?project=1')).body, {});
  assert.equal((await call(db, 40, 'GET', '/validate/modules/problem-discovery/form-options?project=1')).status, 403);
});

test('D690 a file field declares multipart and the action receives the form body', async () => {
  const db = fixture();
  const fileSpec = { ...spec, async actions() { return [{ key: 'attach', label: 'Attach', kind: 'form' as const,
    fields: [{ key: 'proof', label: 'Proof', kind: 'T' as const, input: 'file' as const }],
    async execute(_ctx: unknown, _id: string, body: Record<string, unknown> | FormData) {
      return { ok: body instanceof FormData && body.get('proof') === 'fixture' };
    } }]; } };
  const activeRegistry: RecordRegistry = { validate: { 'problem-discovery': fileSpec } };
  const path = '/validate/modules/problem-discovery/records/11?project=1';
  const read = await call(db, 10, 'GET', path, undefined, activeRegistry);
  assert.equal(read.body.actions[0].multipart, true);
  const form = new FormData();
  form.set('proof', 'fixture');
  const result = await call(db, 10, 'POST', path.replace('?project=', '/actions/attach?project='), form, activeRegistry);
  assert.deepEqual(result.body, { ok: true });
});

test('D690 action references are owned before a writer runs', async () => {
  const db = fixture();
  let writes = 0;
  const linked = { ...spec, async actions() { return [{ key: 'link', label: 'Link', kind: 'write' as const,
    references(body: Record<string, unknown> | FormData) {
      return [{ store: 'pain_groups' as const, id: String(body instanceof FormData ? body.get('group_id') : body.group_id) }];
    },
    async execute() { writes += 1; return { ok: true }; } }]; } };
  const activeRegistry: RecordRegistry = { validate: { 'problem-discovery': linked } };
  const path = '/validate/modules/problem-discovery/records/11/actions/link?project=1';
  assert.equal((await call(db, 10, 'POST', path, { group_id: '22' }, activeRegistry)).status, 404);
  assert.equal(writes, 0);
  assert.equal((await call(db, 10, 'POST', path, { group_id: '11' }, activeRegistry)).status, 200);
  assert.equal(writes, 1);
});

test('D690 ownedRow binds every existing Validate store to one venture', async () => {
  const db = fixture();
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (22, 2, 'Fixture Person')");
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (22, 2, 'H22', 'Fixture claim')");
  db.exec("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction) VALUES (22, 22, 22, 'supports')");
  db.exec("INSERT INTO customer_segments (id, project_id, name, name_norm, source) VALUES (22, 2, 'Fixture Segment', 'fixture segment', 'manual')");
  db.exec("INSERT INTO demand_signals (id, project_id, kind, signal_date, status, source_kind) VALUES (22, 2, 'loi', '2026-10-01', 'confirmed', 'manual')");
  db.exec("INSERT INTO revenue_entries (id, uid, project_id, customer, amount_cents, revenue_type, received_on) VALUES (22, 'other-revenue', 2, 'Fixture Customer', 100, 'deposit', '2026-10-01')");
  db.exec("INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel) VALUES (22, 'other-session', 22, 2, 20, 'video')");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis22', 20, 2)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('candidate22', 'analysis22', 'Fixture Rival')");
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (22, 2, 'customer', 'fixture@example.test'), (23, 1, 'investor', 'investor@example.test')");
  const env = { DB: d1Over(db) } as any;
  for (const [store, id] of [['pain_groups', '22'], ['discovery_interviews', '22'], ['customer_segments', '22'],
    ['competitor_candidates', 'candidate22'], ['demand_signals', 'signal-22'], ['hypotheses', '22'],
    ['hypothesis_pain_links', '22'], ['waitlist_signups', 'waitlist-22'], ['revenue_entries', 'revenue-22'],
    ['interview_sessions', '22']] as const) {
    assert.equal(await ownedRow(env, store, id, OTHER_P), true, `${store} belongs to B`);
    assert.equal(await ownedRow(env, store, id, P), false, `${store} cannot be read as A`);
    const testRegistry: RecordRegistry = { validate: { 'problem-discovery': { ...spec, store } } };
    const base = `/validate/modules/problem-discovery/records/${id}`;
    for (const [method, suffix] of [['GET', ''], ['GET', '/activity'], ['POST', '/actions/edit'],
      ['PATCH', ''], ['DELETE', '']] as const) {
      assert.equal((await call(db, 10, method, `${base}${suffix}?project=1`, undefined, testRegistry)).status, 404,
        `${store} ${method} ${suffix} must refuse B's id`);
    }
  }
  assert.equal(await ownedRow(env, 'waitlist_signups', 'waitlist-23', P), false);
});

test('D690 Validate remains mounted and reports rows as unlinkable until its service is registered', async () => {
  const db = fixture();
  const overview = await call(db, 10, 'GET', '/validate/overview?project=1');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.cycle, 'validate');
  const result = await call(db, 10, 'GET', '/validate/modules/problem-discovery?project=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.records.linkable, false);
});

test('D690 Validate rows use group, prefixed demand and validated candidate IDs', async () => {
  const db = fixture();
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name, pains_json) VALUES (1, 1, 'Fixture Person', '[\"Theme One\",\"Ungrouped phrase\"]')");
  db.exec("INSERT INTO demand_signals (id, project_id, kind, signal_date, status, source_kind) VALUES (7, 1, 'loi', '2026-10-01', 'confirmed', 'manual')");
  db.exec("INSERT INTO revenue_entries (id, uid, project_id, customer, amount_cents, revenue_type, received_on) VALUES (8, 'fixture-revenue', 1, 'Fixture Customer', 100, 'deposit', '2026-10-01')");
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (9, 1, 'customer', 'signup@example.test')");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis1', 10, 1)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('candidate1', 'analysis1', 'Valid Rival'), ('Acme Corp', 'analysis1', 'Invalid Rival')");
  const problem = await call(db, 10, 'GET', '/validate/modules/problem-discovery?project=1');
  assert.equal(problem.status, 200);
  assert.equal(problem.body.records.rows.find((r: any) => r.theme === 'Theme One').id, 11);
  assert.equal(problem.body.records.rows.find((r: any) => r.theme === 'Ungrouped phrase').id, null);
  const demand = await call(db, 10, 'GET', '/validate/modules/demand-signals?project=1');
  assert.equal(demand.status, 200);
  assert.deepEqual(new Set(demand.body.records.rows.map((r: any) => r.id)), new Set(['signal-7', 'revenue-8', 'waitlist-9']));
  const market = await call(db, 10, 'GET', '/validate/modules/market-intelligence?project=1');
  assert.equal(market.status, 200);
  assert.equal(market.body.records.rows.find((r: any) => r.company === 'Valid Rival').id, 'candidate1');
  assert.equal(market.body.records.rows.find((r: any) => r.company === 'Invalid Rival').id, null);
  assert.equal(JSON.stringify([problem.body.records.rows, market.body.records.rows]).includes('Fixture Person'), false);
});
