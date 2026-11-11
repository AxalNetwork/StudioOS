/** D4491 (#4491) — Distribution Results: venture-scoped attribution, windows, Mercury precedence and no write. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { mount } from '../src/routes/grow_results.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const OTHER = 6; const PA = 7; const PB = 8;
const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

let pristine: DatabaseSync | undefined;
function build(): DatabaseSync {
  if (pristine) { pristine.exec('ROLLBACK TO results_fixture'); return pristine; }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of newer) db.exec(readFileSync(resolve(M, name), 'utf8'));
  db.exec('SAVEPOINT results_fixture');
  pristine = db;
  return db;
}

/** Two ventures. Kestrel (7) holds three campaigns, two channels and tagged contacts; Heron (8) carries look-alike rows. */
function fixture() {
  const db = build();
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10), (${OTHER}, 'other@example.test', 'Oli Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO growth_channels (id, uid, project_id, name, utm_source) VALUES (1, 'google-ch', ${PA}, 'Google Search ad', 'google'), (2, 'linkedin-ch', ${PA}, 'LinkedIn posts', 'linkedin'), (3, 'heron-google', ${PB}, 'Heron Google', 'google'), (4, 'x-ch', ${PA}, 'X', 'x');
    INSERT INTO grow_campaigns (id, uid, project_id, name, goal, status, starts_on, ends_on, utm_campaign) VALUES
      (1, 'spring', ${PA}, 'Spring demo push', 'demos', 'active', '2026-03-01', '2026-05-31', 'spring'),
      (2, 'waitlist', ${PA}, 'Waitlist sign-ups', 'signups', 'active', '2026-03-01', '2026-04-30', NULL),
      (3, 'ops', ${PA}, 'Ops leads outreach', 'demos', 'active', '2026-03-01', '2026-04-30', 'ops'),
      (4, 'heron', ${PB}, 'Heron push', 'demos', 'active', '2026-03-01', '2026-05-31', 'spring');
    INSERT INTO grow_campaign_channels (campaign_id, channel_id) VALUES (1, 1), (2, 2), (3, 4), (4, 3);
    INSERT INTO channel_spend (channel_id, month, spend_cents) VALUES (1, '2026-03', 20000), (1, '2026-04', 5000), (2, '2026-03', 41000), (3, '2026-03', 99900);`);
  // Mercury wins April on Google; May is Mercury-only. Heron's fact must never reach Kestrel.
  const fact = db.prepare("INSERT INTO mercury_grow_facts (integration_id, project_id, module, kind, period, subject, amount_cents, as_of) VALUES (1, ?, 'distribution', 'channel_spend', ?, ?, ?, '2026-06-01')");
  fact.run(PA, '2026-04', 'google-ch', 30000); fact.run(PA, '2026-05', 'google-ch', 12000); fact.run(PB, '2026-04', 'heron-google', 77700);
  const contact = db.prepare("INSERT INTO contacts (uid, project_id, audience, email, status, source, utm_json, created_at) VALUES (?, ?, 'customer', ?, ?, ?, ?, ?)");
  const rows: [string, number, string, string | null, string | null, string][] = [
    ['s1', PA, 'new', 'landing', '{"utm_campaign":"spring","utm_source":"google"}', '2026-03-05 10:00:00'],
    ['s2', PA, 'qualified', 'landing', '{"utm_campaign":" Spring ","utm_source":"Google"}', '2026-03-20 10:00:00'],
    ['s3', PA, 'active', 'landing', '{"utm_campaign":"spring","utm_source":"google"}', '2026-04-10 10:00:00'],
    ['s4', PA, 'passed', 'landing', '{"utm_campaign":"spring","utm_source":"linkedin"}', '2026-05-15 10:00:00'],
    ['o1', PA, 'qualified', 'landing', '{"utm_campaign":"ops","utm_source":"newsletter"}', '2026-03-12 10:00:00'],
    ['bad', PA, 'active', 'landing', 'not json', '2026-03-12 10:00:00'],
    ['hand', PA, 'active', 'manual', null, '2026-03-14 10:00:00'],
    ['heron', PB, 'active', 'landing', '{"utm_campaign":"spring","utm_source":"google"}', '2026-03-05 10:00:00'],
  ];
  for (const [uid, pid, status, source, utm, at] of rows) contact.run(uid, pid, `${uid}@example.test`, status, source, utm, at);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (${PA}, '2026-03-31', 1200);`);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route(mount.path, mount.router);
async function get(f: { env: any }, query: string, who = FOUNDER) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/grow/results${query}`, { headers: { Authorization: `Bearer ${token}` } }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json() as any };
}
const byUid = (rows: any[], uid: string) => rows.find((r) => r.uid === uid);
const byKey = (rows: any[], key: string) => rows.find((r) => r.key === key);
const count = (f: any, sql: string) => (f.db.prepare(sql).get() as any).n;

test('lifetime: counts by utm_campaign, Mercury precedence, null reasons and the lifetime label', async () => {
  const f = fixture();
  const r = await get(f, `?project=${PA}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.window, null); assert.equal(r.body.scope.kind, 'lifetime'); assert.match(r.body.scope.label, /^Lifetime/);
  const spring = byUid(r.body.campaigns, 'spring');
  assert.deepEqual([spring.leads, spring.demos, spring.customers], [4, 2, 1]);
  // March manual 200, April Mercury 300 over manual 50, May Mercury 120.
  assert.equal(spring.spend_cents, 62000); assert.equal(spring.spend_source, 'mixed');
  assert.equal(spring.cost_per_lead_cents, 15500); assert.deepEqual(spring.cost_per_lead_sources, ['mercury', 'manual', 'attributed']);
  const waitlist = byUid(r.body.campaigns, 'waitlist');
  for (const k of ['leads', 'demos', 'customers']) { assert.equal(waitlist[k], null); assert.equal(waitlist[`${k}_reason`], 'Not recorded: no UTM tag'); }
  assert.equal(waitlist.spend_cents, 41000); assert.equal(waitlist.spend_source, 'manual');
  assert.equal(waitlist.cost_per_lead_cents, null); assert.equal(waitlist.cost_per_lead_reason, 'Not recorded: no UTM tag');
  const ops = byUid(r.body.campaigns, 'ops');
  assert.deepEqual([ops.leads, ops.demos, ops.customers], [1, 1, 0]);
  assert.equal(ops.spend_cents, null); assert.equal(ops.spend_reason, 'Not recorded: no spend entered');
  assert.equal(ops.cost_per_lead_cents, null); assert.equal(ops.cost_per_lead_reason, 'Not recorded: no spend entered');
  assert.equal(byUid(r.body.campaigns, 'heron'), undefined);
  const google = byUid(r.body.channels, 'google-ch');
  assert.equal(google.spend_cents, 62000); assert.deepEqual(google.spend_sources, ['mercury', 'manual']);
  const x = byUid(r.body.channels, 'x-ch');
  assert.equal(x.spend_cents, null); assert.equal(x.spend_reason, 'Not recorded: no spend entered');
  assert.equal(byUid(r.body.channels, 'heron-google'), undefined);
});

test('counts by utm_source map to channels; malformed utm_json is skipped; another venture is excluded; hand-added is manual', async () => {
  const f = fixture();
  const { body } = await get(f, `?project=${PA}`);
  const google = byKey(body.sources, 'channel:google-ch');
  assert.deepEqual([google.leads, google.demos, google.customers, google.figure_source], [3, 2, 1, 'attributed']);
  const linkedin = byKey(body.sources, 'channel:linkedin-ch');
  assert.deepEqual([linkedin.leads, linkedin.demos, linkedin.customers], [1, 0, 0]);
  const x = byKey(body.sources, 'channel:x-ch');
  assert.deepEqual([x.leads, x.demos, x.customers], [0, 0, 0], 'a channel scanned with no contacts is a counted zero');
  const unmapped = byKey(body.sources, 'utm:newsletter');
  assert.equal(unmapped.channel_uid, null); assert.equal(unmapped.leads, 1);
  const hand = byKey(body.sources, 'manual');
  assert.deepEqual([hand.name, hand.leads, hand.customers, hand.figure_source], ['Added by hand', 1, 1, 'manual']);
  const total = body.sources.reduce((n: number, s: any) => n + s.leads, 0);
  assert.equal(total, 6, 'the malformed contact and Heron’s contact are not counted');
  // The other venture sees only its own rows.
  const heron = await get(f, `?project=${PB}`, OTHER);
  assert.deepEqual(byKey(heron.body.sources, 'channel:heron-google').leads, 1);
  assert.equal(byUid(heron.body.campaigns, 'heron').leads, 1);
  assert.equal((await get(f, `?project=${PB}`)).status, 403);
});

test('a window excludes contacts and spend months outside it; cost per lead uses the same window', async () => {
  const f = fixture();
  const r = await get(f, `?project=${PA}&from=2026-03-01&to=2026-03-31`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.window, { from: '2026-03-01', to: '2026-03-31' }); assert.equal(r.body.scope.kind, 'window');
  const spring = byUid(r.body.campaigns, 'spring');
  assert.deepEqual([spring.leads, spring.demos, spring.customers], [2, 1, 0]);
  assert.equal(spring.spend_cents, 20000); assert.equal(spring.spend_source, 'manual'); assert.equal(spring.cost_per_lead_cents, 10000);
  assert.equal(byUid(r.body.channels, 'google-ch').spend_cents, 20000);
  assert.equal(byKey(r.body.sources, 'channel:google-ch').leads, 2);
  assert.equal(byKey(r.body.sources, 'channel:linkedin-ch').leads, 0);
  const april = await get(f, `?project=${PA}&from=2026-04-01&to=2026-04-30`);
  const g = byUid(april.body.campaigns, 'spring');
  assert.equal(g.spend_cents, 30000, 'Mercury wins April over the manual row'); assert.equal(g.spend_source, 'mercury');
  assert.equal(g.leads, 1);
  const june = await get(f, `?project=${PA}&from=2026-06-01&to=2026-06-30`);
  const later = byUid(june.body.campaigns, 'spring');
  assert.equal(later.leads, 0);
  assert.equal(later.spend_cents, null); assert.equal(later.spend_reason, 'Not recorded: no campaign months in this window');
  assert.equal(later.cost_per_lead_cents, null);
  assert.equal(byUid(june.body.channels, 'google-ch').spend_cents, null, 'a month with no rows is not 0');
});

test('a bad window is refused with our own sentence', async () => {
  const f = fixture();
  for (const [q, field] of [['&from=2026-04-01&to=2026-03-01', 'from'], ['&from=2026-02-30&to=2026-03-01', 'from'], ['&from=2026-03-01&to=soon', 'to'], ['&from=2026-03-01', 'to']] as const) {
    const r = await get(f, `?project=${PA}${q}`);
    assert.equal(r.status, 400, q); assert.equal(r.body.field, field); assert.match(r.body.detail, /^(from|to|A reporting window)/);
  }
  assert.equal((await get(f, '?project=abc')).status, 400);
});

test('Results is read only: project_metrics, revenue and every store keep their row counts', async () => {
  const f = fixture();
  const tables = ['project_metrics', 'contacts', 'channel_spend', 'mercury_grow_facts', 'grow_campaigns', 'activity_logs'];
  const before = tables.map((t) => count(f, `SELECT COUNT(*) AS n FROM ${t}`));
  const mrr = (f.db.prepare('SELECT mrr FROM project_metrics WHERE project_id = ?').get(PA) as any).mrr;
  await get(f, `?project=${PA}`); await get(f, `?project=${PA}&from=2026-03-01&to=2026-03-31`);
  assert.deepEqual(tables.map((t) => count(f, `SELECT COUNT(*) AS n FROM ${t}`)), before);
  assert.equal((f.db.prepare('SELECT mrr FROM project_metrics WHERE project_id = ?').get(PA) as any).mrr, mrr);
});

test('an unreadable store is a 503 with a fixed sentence, never the raw error', async () => {
  const f = fixture();
  f.db.exec('ALTER TABLE grow_campaigns RENAME TO grow_campaigns_gone');
  const r = await get(f, `?project=${PA}`);
  assert.equal(r.status, 503); assert.equal(r.body.detail, 'Results are unreadable. Try again.');
  assert.doesNotMatch(JSON.stringify(r.body), /no such table|SQLITE/i);
});
