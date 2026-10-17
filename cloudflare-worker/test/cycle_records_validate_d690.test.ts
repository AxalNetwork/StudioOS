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
import type { RecordContent, RecordRegistry } from '../src/services/records/types.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { MODULES, QUOTE_WITHHELD } from '../src/services/cycleValidate.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');
const KEY = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
const P = 1, OTHER_P = 2;
const roles: Record<number, string> = { 10: 'founder', 20: 'founder', 30: 'admin', 40: 'partner', 50: 'investor', 60: 'exploring', 70: 'advisor' };

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
  // D690 (#1692): Validate's record stores, and what the interview record reads.
  db.exec(migration('460_validate_record_stores.sql'));
  db.exec(migration('439_validate_proposals_structuring.sql'));
  db.exec(migration('446_interview_structure_receipts.sql'));
  db.exec(migration('228_research_company_directory.sql'));
  db.exec(migration('249_project_metrics.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null],
    [40, 'partner', null], [50, 'investor', null], [60, 'exploring', 1001], [70, 'advisor', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder, id === 60 ? 1 : 0);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002)");
  db.exec("INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Theme One'), (22, 2, 'Theme Two')");
  db.exec("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (31, 1, 'Fixture Person')");
  return db;
}

/** Every SQL text the route prepares, so a test can say which tables were never read. */
const prepared: string[] = [];
function recording(db: DatabaseSync) {
  const d1 = d1Over(db) as any;
  return new Proxy(d1, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { prepared.push(sql); return target.prepare(sql); };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

const spec = {
  read: 'read' as const, write: 'write' as const, store: 'pain_groups' as const,
  async record(_ctx: unknown, id: string): Promise<RecordContent> { return {
    title: `Theme ${id}`, sub: 'A discovered problem', pills: [], facts: [
      { label: 'Severity', value: null, reason: 'No severity recorded' },
      { label: 'Mentions', value: 0 },
      { label: 'Trend', value: null, reason: 'No timeline recorded' },
      { label: 'First heard', value: null, reason: 'No date recorded' },
    ],
  }; },
  sections: [
    { key: 'public', title: 'Public', async read() { return { rows: [{ a: 'Public fact' }] }; } },
    { key: 'writer', title: 'Writer', gate: 'write' as const, async read() { return { rows: [{ a: 'Private fact' }] }; } },
  ],
  async actions() { return [{ key: 'edit', label: 'Edit', kind: 'write' as const,
    async execute() { return { ok: true }; } }]; },
  async formOptions(_ctx: unknown, query: Record<string, string>) { return query; },
};
// Customer research's fixture reads its real store, so its record ids are interviews.
const registry: RecordRegistry = { validate: { 'problem-discovery': spec,
  'customer-research': { ...spec, store: 'discovery_interviews', formOptions: undefined } } };

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
  { DB: recording(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any);
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
  // A malformed id answers 404 before the project or the store is read.
  prepared.length = 0;
  const acme = await call(db, 10, 'GET', base + 'Acme%20Corp?project=1');
  assert.deepEqual([acme.status, acme.body.detail], [404, 'Record not found.']);
  assert.deepEqual(prepared.filter((sql) => /FROM projects|FROM pain_groups/.test(sql)), [],
    'a malformed id reached a project or store query');
  // Admin, founder and partner alike: a venture-B id under ?project=1 is "Record
  // not found.", the ownership refusal, never another route's 404.
  for (const who of [10, 30, 40]) {
    for (const suffix of ['22?project=1', '22/activity?project=1']) {
      const res = await call(db, who, 'GET', base + suffix);
      assert.deepEqual([res.status, res.body.detail], [404, 'Record not found.'], `${who} GET ${suffix}`);
    }
  }
  for (const [method, suffix] of [['POST', '22/actions/edit?project=1'], ['PATCH', '22?project=1'], ['DELETE', '22?project=1']] as const) {
    for (const who of [10, 30]) {
      const res = await call(db, who, method, base + suffix);
      assert.deepEqual([res.status, res.body.detail], [404, 'Record not found.'], `${who} ${method} ${suffix}`);
    }
    // A partner is below the write gate, which answers before ownership.
    assert.equal((await call(db, 40, method, base + suffix)).status, 403, `partner ${method}`);
  }
});

test('D690 every role gets decision 2\'s answer on a Customer research and a Problem discovery record', async () => {
  const db = fixture();
  for (const [slug, id] of [['problem-discovery', '11'], ['customer-research', '31']] as const) {
    const base = `/validate/modules/${slug}/records/${id}`;
    for (const who of [10, 60, 30]) {
      const read = await call(db, who, 'GET', `${base}?project=1`);
      assert.equal(read.status, 200, `${who} reads ${slug}`);
      assert.deepEqual(read.body.main.map((s: any) => s.key), ['public', 'writer'], `${who} ${slug}`);
      assert.deepEqual(read.body.actions.map((a: any) => a.key), ['edit'], `${who} ${slug}`);
      assert.equal((await call(db, who, 'GET', `${base}/activity?project=1`)).status, 200, `${who} activity ${slug}`);
      assert.equal((await call(db, who, 'GET', `/validate/modules/${slug}/form-options?project=1`)).status, 200, `${who} form-options ${slug}`);
    }
    const partner = await call(db, 40, 'GET', `${base}?project=1`);
    assert.equal(partner.status, 200);
    assert.deepEqual(partner.body.main.map((s: any) => s.key), ['public']);
    assert.deepEqual(partner.body.actions, []);
    assert.equal((await call(db, 40, 'GET', `${base}/activity?project=1`)).status, 200);
    assert.equal((await call(db, 40, 'GET', `/validate/modules/${slug}/form-options?project=1`)).status, 403);
    // An advisor, an investor and another venture's founder are refused all three.
    for (const who of [70, 50, 20]) {
      assert.equal((await call(db, who, 'GET', `${base}?project=1`)).status, 403, `${who} reads ${slug}`);
      assert.equal((await call(db, who, 'GET', `${base}/activity?project=1`)).status, 403, `${who} activity ${slug}`);
      assert.equal((await call(db, who, 'GET', `/validate/modules/${slug}/form-options?project=1`)).status, 403, `${who} form-options ${slug}`);
    }
  }
});

test('D690 Next for this record follows the canvas rule', async () => {
  const db = fixture();
  const record = spec.record;
  const at = (rows: any[], actions: any[], sectionAction?: string) => ({ validate: { 'problem-discovery': {
    ...spec, record,
    sections: [{ key: 'main', title: 'Section title', async read() { return { rows, action: sectionAction }; } }],
    async actions() { return actions.map((a) => ({ kind: 'write' as const, async execute() { return { ok: true }; }, ...a })); },
  } } }) as RecordRegistry;
  const next = async (registry: RecordRegistry, who = 10) =>
    (await call(db, who, 'GET', '/validate/modules/problem-discovery/records/11?project=1', undefined, registry)).body.next;
  const edit = { key: 'edit', label: 'Edit' };
  const primary = { key: 'log', label: 'Log interview', tone: 'primary' };
  const last = { key: 'archive', label: 'Archive' };
  // The status word may sit anywhere in the cell, and its row's second line follows a middle dot.
  assert.deepEqual(await next(at([{ a: 'Done row', c: 'Closed' }, { a: 'Call the buyer', b: 'Tuesday', c: 'Awaiting Pending reply', action: 'edit' }], [edit])),
    { text: 'Call the buyer · Tuesday', action: 'edit' });
  // Case-sensitive, as the canvas tests it: a lower-case "open" is not a status.
  assert.deepEqual(await next(at([{ a: 'Quiet row', c: 'open' }], [edit, primary, last])), { text: 'Log interview', action: 'log' });
  // The section fallback names the declared action's label, not the section.
  assert.deepEqual(await next(at([], [edit, primary], 'edit')), { text: 'Edit', action: 'edit' });
  // With no primary tone, the primary is the last declared action.
  assert.deepEqual(await next(at([], [edit, last])), { text: 'Archive', action: 'archive' });
  // Nothing applies: no next, rather than a sentence standing in for one.
  assert.equal(await next(at([], []), 40), null);
});

test('D690 an investor sign-up has no Demand record address on the record or activity route', async () => {
  const db = fixture();
  db.exec("INSERT INTO waitlist_signups (id, project_id, audience, email) VALUES (23, 1, 'investor', 'investor@example.test'), (24, 1, 'customer', 'customer@example.test')");
  const demand: RecordRegistry = { validate: { 'demand-signals': { ...spec, store: 'waitlist_signups' } } };
  for (const suffix of ['', '/activity']) {
    const investor = await call(db, 10, 'GET', `/validate/modules/demand-signals/records/waitlist-23${suffix}?project=1`, undefined, demand);
    assert.deepEqual([investor.status, investor.body.detail], [404, 'Record not found.'], `investor ${suffix}`);
    assert.equal((await call(db, 10, 'GET', `/validate/modules/demand-signals/records/waitlist-24${suffix}?project=1`, undefined, demand)).status, 200);
  }
});

test('D690 section, role, action and form-options gates share the module contract', async () => {
  const db = fixture();
  const base = '/validate/modules/problem-discovery/records/11?project=1';
  for (const who of [10, 30, 60]) {
    const read = await call(db, who, 'GET', base);
    assert.equal(read.status, 200);
    assert.equal(read.body.main.length, 2);
    assert.equal(read.body.actions[0].key, 'edit');
    assert.equal(read.body.actions[0].tone, 'default');
    assert.equal(read.body.facts.length, 4);
    assert.deepEqual(read.body.main.map((s: any) => s.gate), ['read', 'write']);
  }
  const partner = await call(db, 40, 'GET', base);
  assert.equal(partner.status, 200);
  assert.deepEqual(partner.body.main.map((s: any) => s.key), ['public']);
  assert.equal(partner.body.main[0].gate, 'read');
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
    form: { title: 'Attach evidence', fields: [{ key: 'proof', label: 'Proof', kind: 'T' as const, input: 'file' as const }] },
    confirm: 'Attach this evidence?',
    async execute(_ctx: unknown, _id: string, body: Record<string, unknown> | FormData) {
      return { ok: body instanceof FormData && body.get('proof') === 'fixture' };
    } }]; } };
  const activeRegistry: RecordRegistry = { validate: { 'problem-discovery': fileSpec } };
  const path = '/validate/modules/problem-discovery/records/11?project=1';
  const read = await call(db, 10, 'GET', path, undefined, activeRegistry);
  assert.equal(read.body.actions[0].multipart, true);
  assert.equal(read.body.actions[0].form.title, 'Attach evidence');
  assert.equal(read.body.actions[0].form.fields[0].input, 'file');
  assert.equal(read.body.actions[0].confirm, 'Attach this evidence?');
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
      // The ownership refusal itself: an undeclared DELETE would also be a 404, as "No such action".
      const res = await call(db, 10, method, `${base}${suffix}?project=1`, undefined, testRegistry);
      assert.deepEqual([res.status, res.body.detail], [404, 'Record not found.'],
        `${store} ${method} ${suffix} must refuse B's id`);
    }
  }
  assert.equal(await ownedRow(env, 'waitlist_signups', 'waitlist-23', P), false);
});

test('D690 8: Validate remains mounted and, with its service registered (#1692), reports rows as linkable', async () => {
  const db = fixture();
  const overview = await call(db, 10, 'GET', '/validate/overview?project=1');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.cycle, 'validate');
  const result = await call(db, 10, 'GET', '/validate/modules/problem-discovery?project=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.records.linkable, true);
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

// ---------------------------------------------------------------------------
// #1692 — Validate's six records, over its registered service
// ---------------------------------------------------------------------------

/** Venture A (project 1) with one record of each kind, and venture B's (project 2) beside it. */
function seeded() {
  const db = fixture();
  db.exec(`
    INSERT INTO customer_segments (id, project_id, name, name_norm, source, who_they_are, urgency, value_promised)
      VALUES (3, 1, 'Fleet ops leads', 'fleet ops leads', 'manual', 'Ops lead at a delivery fleet', 'high', 'Fewer missed jobs'),
             (22, 2, 'Their segment', 'their segment', 'manual', NULL, NULL, NULL);
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_role, interviewee_company, pains_json, quote_consent, icp_fit, segment_id, stage, done_at)
      VALUES (1, 1, 'Iris Example', 'Ops lead', 'Northwind Example', '["Theme One"]', 1, 'strong', 3, 'done', '2026-10-12 10:00:00'),
             (2, 1, 'Jon Example', NULL, NULL, '["Theme One"]', 0, NULL, NULL, 'done', '2026-10-09 10:00:00'),
             (22, 2, 'Bea Example', NULL, NULL, '["Theme Two"]', 1, NULL, NULL, 'done', '2026-10-09 10:00:00');
    INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (1, 'theme one', 'severe');
    INSERT INTO hypotheses (id, project_id, code, claim, sort_order, success_bar) VALUES
      (5, 1, 'H1', 'Fleets will pay for fewer missed jobs', 1, '5 of 8 interviewees'),
      (22, 2, 'H1', 'Their claim', 1, NULL);
    INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, strength) VALUES (6, 5, 11, 'supports', 'anecdote');
    INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title, method, target, status)
      VALUES (12, 'ex-a', 1, 5, 'Landing page', 'Landing page', '40 sign-ups', 'running'),
             (23, 'ex-b', 2, 22, 'Their test', NULL, NULL, 'planned');
    INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('analysis1', 10, 1), ('analysis22', 20, 2);
    INSERT INTO competitor_candidates (id, analysis_id, name, category) VALUES ('candidate1', 'analysis1', 'Routewise', 'direct'),
      ('candidate22', 'analysis22', 'Their Rival', 'direct');
    INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, project_id, amount_cents, currency, observed_on)
      VALUES ('sig-1', 'analysis1', 'candidate1', 'funding', 'Raised a seed round', 1, 120000000, 'usd', '2026-10-01'),
             ('sig-2', 'analysis1', 'candidate1', 'hiring', 'Hiring drivers', 1, NULL, NULL, '2026-10-02');
    INSERT INTO demand_signals (id, project_id, kind, who, amount_cents, currency, period, signal_date, status, source_kind)
      VALUES (7, 1, 'loi', 'Northwind Example', 1800000, 'usd', 'year', '2026-10-12', 'confirmed', 'manual'),
             (22, 2, 'loi', 'Theirs', NULL, NULL, NULL, '2026-10-01', 'confirmed', 'manual');
    INSERT INTO revenue_entries (id, uid, project_id, customer, amount_cents, revenue_type, received_on)
      VALUES (8, 'rev-a', 1, 'Pilot Customer', 50000, 'deposit', '2026-10-05');
    INSERT INTO waitlist_signups (id, project_id, audience, email, name) VALUES (9, 1, 'customer', 'w@example.test', 'Wren'),
      (23, 1, 'investor', 'investor@example.test', 'An investor');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, active_ms)
      VALUES (4, 'sess-a', 1, 1, 10, 'in_person', 'reviewed', 'given', 'verbal', 120000),
             (5, 'sess-b', 2, 1, 10, 'text', 'transcribed', 'not_recorded', NULL, 0);
    INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, start_ms) VALUES (4, 0, 'validate-audio/10/sess-a/0.webm', 'audio/webm', 100, 0);
    INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text)
      VALUES (4, 'final', 134000, 140000, 'Iris', 'We miss jobs every week.');
    INSERT INTO validate_proposals (project_id, kind, payload_json, status, session_id, run_id, cite_from, cite_to)
      VALUES (1, 'pain_severity', '{"phrase":"Theme One","severity":"severe"}', 'pending', 4, 'run-1', 133000, 141000);
    INSERT INTO interview_session_receipts (session_id, kind, model, cost_microusd, outcome) VALUES (4, 'final', 'whisper', 20000, 'ok');
  `);
  return db;
}

const RECORDS: Record<string, { a: string; b: string; main: string[]; side: string[] }> = {
  'problem-discovery': { a: '11', b: '22', main: ['Quotes', 'Hypotheses it feeds'], side: ['Segments'] },
  'customer-research': { a: '1', b: '22', main: ['Transcript', 'Eadwyn’s placements'], side: ['What it fed', 'Cost', 'Session'] },
  'ideal-customer-profile': { a: '3', b: '22', main: ['Five steps', 'Interviews scored against it'], side: ['Pain themes', 'Persona card'] },
  'market-intelligence': { a: 'candidate1', b: 'candidate22', main: ['Signals', 'Positioning'], side: ['Research › Companies', 'Watching for'] },
  'demand-signals': { a: 'signal-7', b: 'signal-22', main: ['Evidence', 'Feeds'], side: ['Who'] },
  experiments: { a: '5', b: '22', main: ['Evidence', 'Experiments'], side: ['Pain themes', 'What would prove this wrong'] },
};
const real = (db: DatabaseSync, who: number, method: string, path: string, body?: unknown) =>
  call(db, who, method, path, body, RECORD_SPECS);
const rec = (slug: string, id: string, suffix = '') => `/validate/modules/${slug}/records/${id}${suffix}?project=1`;

test('#1692 test 2: another venture\'s record answers 404 on the read, the activity, every action, PATCH and DELETE', async () => {
  const db = seeded();
  for (const [slug, r] of Object.entries(RECORDS)) {
    const mine = await real(db, 10, 'GET', rec(slug, r.a));
    assert.equal(mine.status, 200, `${slug} A`);
    for (const [method, suffix] of [['GET', ''], ['GET', '/activity'], ['PATCH', ''], ['DELETE', '']] as const) {
      assert.equal((await real(db, 10, method, rec(slug, r.b, suffix))).status, 404, `${slug} ${method}${suffix}`);
    }
    for (const a of mine.body.actions) {
      assert.equal((await real(db, 10, 'POST', rec(slug, r.b, `/actions/${a.key}`), {})).status, 404, `${slug} ${a.key}`);
    }
  }
  // An investor's sign-up is never a demand record.
  assert.equal((await real(db, 10, 'GET', rec('demand-signals', 'waitlist-23'))).status, 404);
  // Every id an action body names is proved first.
  for (const body of [{ kind: 'interview', ref_id: '22' }, { kind: 'signal', ref_id: 'signal-22' }, { kind: 'experiment', ref_id: '23' }, { kind: 'signal', ref_id: 'waitlist-23' }]) {
    assert.equal((await real(db, 10, 'POST', rec('experiments', '5', '/actions/add-evidence'), body)).status, 404, JSON.stringify(body));
  }
  assert.equal((await real(db, 10, 'POST', rec('experiments', '5', '/actions/experiment-status'), { experiment_id: 23, status: 'done' })).status, 404);
  assert.equal((await real(db, 10, 'POST', rec('demand-signals', 'signal-7', '/actions/attach'), { interview_id: 22 })).status, 404);
  assert.equal((await real(db, 10, 'POST', rec('problem-discovery', '11', '/actions/link'), { hypothesis_id: 22 })).status, 404);
  assert.equal((await real(db, 10, 'POST', rec('problem-discovery', '11', '/actions/attach-quote'), { quote: '22|Theme Two' })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hypothesis_evidence_links').get()!.n, 0);
});

test('#1692 test 3: roles — owners and admins get the writer sections and actions; a partner reads; others get 403', async () => {
  const db = seeded();
  for (const [slug, id] of [['customer-research', '1'], ['problem-discovery', '11']] as const) {
    for (const who of [10, 60, 30]) {
      const r = await real(db, who, 'GET', rec(slug, id));
      assert.equal(r.status, 200, `${slug} as ${who}`);
      assert.ok(r.body.actions.length > 0, `${slug} as ${who} has actions`);
    }
    const p = await real(db, 40, 'GET', rec(slug, id));
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.actions, []);
    assert.equal((await real(db, 40, 'POST', rec(slug, id, '/actions/edit'), {})).status, 403);
    for (const who of [20, 50]) assert.equal((await real(db, who, 'GET', rec(slug, id))).status, 403, `${slug} as ${who}`);
  }
  assert.ok((await real(db, 10, 'GET', rec('customer-research', '1'))).body.main.some((s: any) => s.key === 'transcript'));
});

test('#1692 test 4: a partner gets no session section, no withheld quote and no form-options', async () => {
  const db = seeded();
  const founder = await real(db, 10, 'GET', rec('customer-research', '1'));
  const partner = await real(db, 40, 'GET', rec('customer-research', '1'));
  assert.deepEqual(founder.body.side.map((s: any) => s.key), ['fed', 'cost', 'session']);
  assert.deepEqual(partner.body.main, []);
  assert.deepEqual(partner.body.side.map((s: any) => s.key), ['fed']);
  assert.deepEqual(partner.body.facts, founder.body.facts);
  assert.equal(JSON.stringify(partner.body).includes('We miss jobs'), false);
  assert.equal(founder.body.main[0].rows[0].b, '"We miss jobs every week."');
  assert.equal(founder.body.main[0].rows[0].c, '→ Theme One');
  const quotes = async (who: number) => (await real(db, who, 'GET', rec('problem-discovery', '11'))).body.main[0].rows.map((r: any) => r.a);
  assert.deepEqual((await quotes(10)).sort(), ['"Theme One"', '"Theme One"']);
  assert.deepEqual((await quotes(40)).sort(), ['"Theme One"', QUOTE_WITHHELD].sort());
  for (const slug of Object.keys(RECORDS)) {
    assert.equal((await real(db, 40, 'GET', `/validate/modules/${slug}/form-options?project=1`)).status, 403, slug);
    assert.equal((await real(db, 20, 'GET', `/validate/modules/${slug}/form-options?project=1`)).status, 403, slug);
  }
});

test('#1692 test 5: each record has its title, four facts, its sections in the canvas\'s order, and a next step', async () => {
  const db = seeded();
  for (const [slug, r] of Object.entries(RECORDS)) {
    const { body } = await real(db, 10, 'GET', rec(slug, r.a));
    assert.ok(body.title, slug);
    assert.equal(body.facts.length, 4, slug);
    for (const f of body.facts) assert.ok(f.value != null || f.reason, `${slug} ${f.label} is a value or a reason`);
    assert.deepEqual(body.main.map((s: any) => s.title), r.main, slug);
    assert.deepEqual(body.side.map((s: any) => s.title), r.side, slug);
    assert.ok(body.next && body.next.text, slug);
    assert.equal(JSON.stringify(body).includes('example.test'), false, `${slug} names no address`);
  }
  const theme = (await real(db, 10, 'GET', rec('problem-discovery', '11'))).body;
  assert.equal(theme.sub, 'Mentioned in 2 of 2 interviews');
  assert.deepEqual(theme.pills.map((p: any) => p.text), ['Severe', 'Frequent']);
  const iv = (await real(db, 10, 'GET', rec('customer-research', '1'))).body;
  assert.equal(iv.sub, 'Ops lead at Northwind Example · 12 Oct · 2 min');
  assert.deepEqual(iv.facts.map((f: any) => f.value), ['Recorded in StudioOS', 'Said yes out loud', 'Strong · Fleet ops leads', 'Yes']);
  const seg = (await real(db, 10, 'GET', rec('ideal-customer-profile', '3'))).body;
  assert.deepEqual(seg.main[0].rows.map((r: any) => r.c), ['Done', 'Missing', 'Missing', 'Done', 'Needs a source']);
  assert.deepEqual(seg.next, { text: 'Context', action: null });
  const comp = (await real(db, 10, 'GET', rec('market-intelligence', 'candidate1'))).body;
  assert.deepEqual(comp.facts.map((f: any) => f.value ?? f.reason), ['Raised a seed round · 1 Oct', '1,200,000 USD', 'No public figure found', 'No source recorded']);
  assert.deepEqual(comp.main[0].rows.map((r: any) => r.c), ['Funding'], 'Hires is off by default, so its signal is not drawn');
  db.exec("INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, project_id, amount_cents, currency, observed_on) VALUES ('sig-3', 'analysis1', 'candidate1', 'funding', 'Grant', 1, 5000000, 'eur', '2026-09-01')");
  const mixed = (await real(db, 10, 'GET', rec('market-intelligence', 'candidate1'))).body;
  assert.deepEqual(mixed.facts[1], { label: 'Funding to date', value: null, reason: 'Amounts are in more than one currency' });
  const sig = (await real(db, 10, 'GET', rec('demand-signals', 'signal-7'))).body;
  assert.equal(sig.title, 'Letter of intent · Northwind Example');
  assert.equal(sig.facts[3].reason, 'No bar is set for this kind');
  assert.deepEqual((await real(db, 10, 'GET', rec('demand-signals', 'revenue-8'))).body.actions, [], 'a ledger row is the ledger\'s');
  assert.deepEqual((await real(db, 10, 'GET', rec('demand-signals', 'waitlist-9'))).body.actions, [], 'a sign-up is the person\'s own');
  const attach = sig.actions.find((a: any) => a.key === 'attach');
  assert.equal(attach.multipart, true);
  const claim = (await real(db, 10, 'GET', rec('experiments', '5'))).body;
  assert.deepEqual(claim.facts.map((f: any) => f.value ?? f.reason), ['5 of 8 interviewees', 'No condition written', '0 for · 0 against', 'Anecdote']);
  assert.deepEqual(claim.main[1].rows.map((r: any) => [r.a, r.c]), [['Landing page', 'Running']]);
});

test('#1692 test 6: Record a decision is declared only while MODULES holds Verdict', async () => {
  const db = seeded();
  const keys = async () => (await real(db, 10, 'GET', rec('experiments', '5'))).body.actions.map((a: any) => a.key);
  assert.equal((await keys()).includes('record-decision'), false);
  (MODULES as any).push({ slug: 'verdict', name: 'Verdict', records_title: 'Decisions' });
  try {
    const { body } = await real(db, 10, 'GET', rec('experiments', '5'));
    const a = body.actions.find((x: any) => x.key === 'record-decision');
    assert.equal(a.href, '/validate/verdict/new?project=1&for=h-5');
  } finally {
    (MODULES as any).pop();
  }
});

test('#1692: record actions call the writers — Edit, Edit details, Stop and its effect, experiments, open recording', async () => {
  const db = seeded();
  assert.equal((await real(db, 10, 'PATCH', rec('problem-discovery', '11'), { title: 'Missed jobs' })).status, 200);
  assert.equal(db.prepare('SELECT title FROM pain_groups WHERE id = 11').get()!.title, 'Missed jobs');
  assert.equal((await real(db, 10, 'POST', rec('customer-research', '1', '/actions/edit-details'), { interviewee_name: 'Iris Renamed', interviewee_company: '' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT interviewee_name, interviewee_company, interviewee_role FROM discovery_interviews WHERE id = 1').get() },
    { interviewee_name: 'Iris Renamed', interviewee_company: null, interviewee_role: 'Ops lead' });
  // Stop takes the competitor off the list and out of the card's count (decision 8).
  assert.equal((await real(db, 10, 'POST', rec('market-intelligence', 'candidate1', '/actions/stop'), {})).status, 200);
  const list = await call(db, 10, 'GET', '/validate/modules/market-intelligence?project=1');
  assert.equal(list.body.records.rows.length, 0);
  assert.equal(list.body.card.series?.competitors_tracked ?? 0, 0);
  const stopped = await real(db, 10, 'GET', rec('market-intelligence', 'candidate1'));
  assert.deepEqual(stopped.body.pills.map((p: any) => p.text), ['Direct', 'Stopped']);
  assert.equal(stopped.body.actions.some((a: any) => a.key === 'stop'), false);
  assert.equal((await real(db, 10, 'POST', rec('experiments', '5', '/actions/add-experiment'), { title: 'Five interviews' })).status, 200);
  const ex = db.prepare("SELECT id FROM hypothesis_experiments WHERE title = 'Five interviews'").get()!.id;
  assert.equal((await real(db, 10, 'POST', rec('experiments', '5', '/actions/experiment-status'), { experiment_id: ex, status: 'done', result: '4 of 5' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM hypothesis_experiments WHERE id = ?').get(ex)!.status, 'done');
  assert.equal((await real(db, 10, 'POST', rec('experiments', '5', '/actions/add-evidence'), { kind: 'signal', ref_id: 'signal-7', direction: 'supports', strength: 'measured' })).status, 200);
  const feeds = (await real(db, 10, 'GET', rec('demand-signals', 'signal-7'))).body.main[1].rows;
  assert.deepEqual(feeds.map((r: any) => [r.a, r.b, r.c]), [['H1 · Fleets will pay for fewer missed jobs', 'Supporting', 'Measured']]);
  const open = await real(db, 10, 'POST', rec('customer-research', '1', '/actions/open-recording'), {});
  assert.equal(open.status, 200);
  assert.equal(open.body.open.parts.length, 1);
  assert.match(open.body.open.parts[0].url, /^\/api\/files\/dl\//);
  // An interview whose session recorded no audio (a pasted chat) declares no Open recording.
  assert.equal((await real(db, 10, 'GET', rec('customer-research', '2'))).body.actions.some((a: any) => a.key === 'open-recording'), false);
  const evidenceLinks = (await call(db, 10, 'GET', '/validate/modules/experiments?project=1')).body.records.rows[0].links;
  assert.deepEqual(evidenceLinks.map((l: any) => l.kind), ['pain', 'signal']);
});

test('#1692: form-options for each module, scoped to the venture and the caller', async () => {
  const db = seeded();
  db.exec("INSERT INTO research_company_directory (uid, name, website, country, source_url, as_of) VALUES ('dir-1', 'Routewise', 'https://routewise.example', 'NL', 'https://source.example/1', '2026-10-01'), ('dir-2', 'Fleetly', 'https://fleetly.example', 'DE', 'https://source.example/2', '2026-10-01')");
  db.exec("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('mine-elsewhere', 10, NULL)");
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('c-other', 'mine-elsewhere', 'Dispatchly'), ('c-dup', 'mine-elsewhere', 'routewise')");
  const pd = (await real(db, 10, 'GET', '/validate/modules/problem-discovery/form-options?project=1')).body;
  assert.equal(pd.unthemed_total, 0);
  assert.deepEqual(pd.hypotheses.map((h: any) => h.value), ['5']);
  const mi = (await real(db, 10, 'GET', '/validate/modules/market-intelligence/form-options?project=1&q=fleetly.example')).body;
  assert.deepEqual(mi.candidates.map((c: any) => c.label), ['Dispatchly'], 'the venture already tracks Routewise');
  assert.deepEqual(mi.directory.map((d: any) => d.value), ['dir-2']);
  assert.equal('directory' in (await real(db, 10, 'GET', '/validate/modules/market-intelligence/form-options?project=1')).body, false);
  const ds = (await real(db, 10, 'GET', '/validate/modules/demand-signals/form-options?project=1')).body;
  assert.deepEqual(ds.interviews.map((i: any) => i.value).sort(), ['1', '2']);
  // Someone who shares the founder group but does not own the venture is no owner (decision 12).
  db.exec("INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (70, 'investor', 'User 70', 'user70@example.test', 1, 1001, 0)");
  const ex = (await real(db, 10, 'GET', '/validate/modules/experiments/form-options?project=1')).body;
  assert.deepEqual(ex.themes.map((t: any) => t.value), ['11']);
  assert.deepEqual(ex.owners.map((o: any) => o.value), ['10', '60']);
  assert.deepEqual(new Set(ex.evidence.map((e: any) => e.value)), new Set(['1', '2', 'signal-7', 'revenue-8', 'waitlist-9', '12']));
  assert.deepEqual((await real(db, 10, 'GET', '/validate/modules/ideal-customer-profile/form-options?project=1')).body, {});
});
