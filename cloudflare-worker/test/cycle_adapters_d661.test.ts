/**
 * D661 (#1474) — Validate's REAL read, through the page's adapter.
 *
 * S1's decision on #1474: the page adapts D659's read (`adapters/validate.js`)
 * and the Worker is not changed. This holds the two together: the Worker
 * routes run on real SQLite (the same fixture as cycle_validate_d659), every
 * module is seeded with real rows, and what comes back goes through the
 * adapter the page uses. If a read renames a field, this fails, not the page.
 *
 *   · every `ok` card yields at least one spec the page can draw;
 *   · every column the read lists gets a key, and every key a value source:
 *     some seeded row fills it;
 *   · the adapter's module list is the Worker's own;
 *   · every figure's unit is one the page can write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { MODULES as WORKER_MODULES, daysBefore } from '../src/services/cycleValidate.ts';
import { adaptModule, adaptOverview } from '../../frontend/src/pages/cycles/adapters/index.js';
import { MODULES as PAGE_MODULES, CARDS, RECORDS } from '../../frontend/src/pages/cycles/adapters/validate.js';
import { drawableSeries, cardView, figureValue } from '../../frontend/src/pages/cycles/cycleModel.js';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => daysBefore(TODAY, n);
const FOUNDER = 10, OTHER = 20;
const P = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

/** Every module given real rows, through the Worker's own writers where it has them. */
async function seeded() {
  const db = fixture();
  db.exec(`UPDATE projects SET tam = 4200000000, sam = 610000000, som = 38000000 WHERE id = ${P}`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Dispatch'), (2, ${P}, 'Invoicing')`);
  db.exec(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${P}, 1, 'slow dispatch', 'Slow dispatch'), (${P}, 2, 'late invoices', 'Late invoices')`);
  const seg = await call(db, 'POST', `/segments?project=${P}`, { name: 'Regional fleets' });
  assert.ok([200, 201].includes(seg.status), JSON.stringify(seg.body));
  const segId = Number(seg.body.id ?? seg.body.segment?.id ?? 1);
  const iv = db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interview_date, pains_json,
       hypotheses_json, icp_fit, quote_consent, stage, segment_id, channel)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?) RETURNING id`,
  );
  const sev = db.prepare('INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, ?, ?)');
  const fits = ['strong', 'partial', 'none', 'strong', null, 'strong'];
  for (let i = 0; i < 6; i += 1) {
    const r = iv.get(P, `Person ${i}`, i % 2 ? 'Fleetco' : null, ago(i * 8 + 1), JSON.stringify(i % 3 ? ['slow dispatch', 'late invoices'] : ['slow dispatch', 'no live tracking']),
      fits[i], i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : null, null, segId, i % 2 ? 'video' : 'in_person') as any;
    sev.run(Number(r.id), 'slow dispatch', i % 2 ? 'severe' : 'real');
  }
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, sprint) VALUES (1, ${P}, 'H1', 'Fleets pay', 'Sprint 3'), (2, ${P}, 'H2', 'Drivers text', NULL), (3, ${P}, 'H3', 'Owners decide', NULL)`);
  db.exec(`INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, created_at) VALUES (1, 1, 1, 'supports', '${ago(3)} 10:00:00'), (2, 2, 2, 'supports', '${ago(20)} 10:00:00')`);
  assert.equal((await call(db, 'PUT', `/evidence-links/1/strength?project=${P}`, { strength: 'pattern' })).status, 200);
  const plan = await call(db, 'PUT', `/hypotheses/1/plan?project=${P}`, { owner_user_id: FOUNDER });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const wl = db.prepare("INSERT INTO waitlist_signups (project_id, email, name, audience, created_at) VALUES (?, ?, ?, 'customer', ?)");
  for (let i = 0; i < 9; i += 1) wl.run(P, `w${i}@x.test`, i % 2 ? `Lead ${i}` : null, `${ago(i * 9)} 09:00:00`);
  assert.equal((await call(db, 'PUT', `/waitlist-target?project=${P}`, { value: 40 })).status, 200);
  assert.equal((await call(db, 'POST', `/demand-signals?project=${P}`, { kind: 'loi', who: 'Fleetco', amount_cents: 1800000, currency: 'usd', period: 'year', signal_date: ago(2) })).status, 201);
  db.prepare("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('an1', ?, ?)").run(OTHER, P);
  assert.equal((await call(db, 'POST', `/competitor-mentions?project=${P}`, { name: 'Haulr', category: 'adjacent', signal_type: 'funding', label: 'raised $12M', source_url: 'https://news.example/haulr', observed_on: ago(3) })).status, 201);
  return db;
}

test('D661: the adapter lists the Worker\'s own six modules, and has a card and a table for each', () => {
  assert.deepEqual(PAGE_MODULES.map((m) => [m.slug, m.name]), WORKER_MODULES.map((m) => [m.slug, m.name]));
  for (const m of WORKER_MODULES) {
    assert.equal(typeof CARDS[m.slug], 'function', `${m.slug} has no card adapter`);
    assert.ok(RECORDS[m.slug]?.keys?.length, `${m.slug} has no records adapter`);
  }
});

test('D661: every ok card from the real read draws through the page; every figure has a unit the page can write', async () => {
  const db = await seeded();
  const r = await call(db, 'GET', `/overview?project=${P}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = adaptOverview('validate', r.body);
  // Every module is seeded past its threshold, so every card adapter is used.
  assert.deepEqual(o.cards.map((c: any) => `${c.slug}=${c.state}`), WORKER_MODULES.map((m) => `${m.slug}=ok`));
  for (const c of o.cards) {
    const v = cardView(c);
    if (c.state === 'ok') {
      assert.equal(v.state, 'ok', `${c.slug}: an ok card read as ${v.state} (${v.reason})`);
      assert.ok(drawableSeries(c.series).length >= 1, `${c.slug} draws nothing`);
    }
  }
  for (const f of o.figures) {
    assert.ok(['usd', 'pct', 'score', 'of', 'count'].includes(f.unit), `${f.key}: unit ${f.unit}`);
    if (f.state === 'ok') assert.notEqual(figureValue(f), null, `${f.key} has a value the page cannot write`);
  }
  // The supported count keeps its denominator: "1 of 3", not "1".
  const sup = o.figures.find((f: any) => f.key === 'hypotheses_supported');
  assert.equal(sup.unit, 'of');
  assert.match(figureValue(sup), /^\d+ of 3$/);
});

test('D661: every module page from the real read — each column has a key and a value source', async () => {
  const db = await seeded();
  for (const m of WORKER_MODULES) {
    const r = await call(db, 'GET', `/modules/${m.slug}?project=${P}`);
    assert.equal(r.status, 200, `${m.slug}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.records.cols.length, RECORDS[m.slug].keys.length, `${m.slug}: the read lists ${r.body.records.cols.length} columns, the adapter keys ${RECORDS[m.slug].keys.length}`);
    const d = adaptModule('validate', m.slug, r.body);
    assert.ok(d.records.rows.length > 0, `${m.slug}: seeded rows came back empty`);
    for (const col of d.records.cols) {
      assert.equal(typeof col.key, 'string');
      assert.equal(col.label, r.body.records.cols[d.records.cols.indexOf(col)], `${m.slug}: a label moved`);
      const filled = d.records.rows.some((row: any) => row.cells[col.key] != null);
      assert.ok(filled, `${m.slug}: no row fills "${col.label}" (${col.key}); the read may have renamed its field`);
    }
    for (const row of d.records.rows) assert.ok(row.id != null, `${m.slug}: a row has no id`);
    if (d.card.state === 'ok') assert.ok(drawableSeries(d.card.series).length >= 1, `${m.slug}: the module card draws nothing`);
  }
});

test('D661: an empty venture draws every card as empty with its action, and nothing as 0', async () => {
  const db = fixture();
  const o = adaptOverview('validate', (await call(db, 'GET', `/overview?project=${P}`)).body);
  for (const c of o.cards) {
    assert.equal(cardView(c).state, 'empty', c.slug);
    assert.equal(c.series, null, `${c.slug}: an empty card gained a chart`);
  }
  for (const f of o.figures) assert.equal(figureValue(f), null, `${f.key} is written as a number with nothing recorded`);
});

// ---------------------------------------------------------------------------
// Raise (#1501, D663): already in D661's shape, so it passes through untouched.
// ---------------------------------------------------------------------------

import cycleRaise from '../src/routes/cycle_raise.ts';
import { MODULES as RAISE_WORKER_MODULES } from '../src/services/raiseCycle.ts';
import { MODULES as PAGE_CYCLE_MODULES } from '../../frontend/src/pages/cycles/modules.js';
import { CHART_KINDS, CARD_STATES as PAGE_STATES } from '../../frontend/src/pages/cycles/cycleModel.js';

function raiseFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens',
    'deck_share_views', 'data_room_folders', 'data_room_files', 'data_room_access_log', 'cap_table_scenarios',
    'raise_prospects', 'raise_rounds', 'contacts',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec('ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT');
  for (const [c, d] of [['amount', 'REAL'], ['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']]) {
    if (!cols('raise_prospects').has(c)) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${c} ${d}`);
  }
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001)`);
  return db;
}

const raiseApp = new Hono<any>();
raiseApp.route('/api/cycles/raise', cycleRaise);
raiseApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function raiseCall(db: any, path: string) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await raiseApp.request(`/api/cycles/raise${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

/** Three modules given real rows, as cycle_raise_d663 seeds them. */
function raiseSeeded() {
  const db = raiseFixture();
  const before = [{ holder: 'Fay', type: 'founder', shares: 8000 }, { holder: 'Option Pool', type: 'option_pool', shares: 2000 }];
  const after = [...before, { holder: 'Seed investors', type: 'preferred', shares: 2500 }];
  db.exec(`INSERT INTO cap_table_scenarios (owner_user_id, project_id, name, inputs_json, result_json) VALUES
           (${FOUNDER}, ${P}, 'Main', '{}', '${JSON.stringify({ founding: before, rounds: [{ name: 'Seed', ledger: after }] })}')`);
  db.exec(`UPDATE projects SET funding_needed = 1000000,
             use_of_funds = '[{"label":"Product & engineering","pct":60},{"label":"GTM: sales and marketing","pct":40}]'
           WHERE id = ${P}`);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, cash_balance, net_burn) VALUES (${P}, '2026-10-01', 300000, 50000)`);
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status) VALUES ('r1', ${P}, 'Seed', 1000000, 'active')`);
  db.exec(`INSERT INTO raise_prospects (uid, project_id, name, stage, amount) VALUES ('a', ${P}, 'A', 'committed', 250000), ('b', ${P}, 'B', 'meeting', 400000), ('c', ${P}, 'C', 'contacted', 100000)`);
  return db;
}

const isSpec = (s: any) => s && typeof s === 'object' && (CHART_KINDS as string[]).includes(s.kind);

test('D661: the page lists Raise\'s modules as the Worker does', () => {
  assert.deepEqual(PAGE_CYCLE_MODULES.raise.map((m: any) => [m.slug, m.name]), RAISE_WORKER_MODULES.map((m) => [m.slug, m.name]));
  assert.deepEqual(PAGE_CYCLE_MODULES.validate.map((m: any) => m.slug), WORKER_MODULES.map((m) => m.slug));
});

test('D661: Raise\'s real read passes through the page untouched, and its seeded cards draw', async () => {
  for (const db of [raiseFixture(), raiseSeeded()]) {
    const r = await raiseCall(db, `/overview?project=${P}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = adaptOverview('raise', r.body);
    assert.deepEqual(o.cards, r.body.cards, 'a read in D661\'s shape must pass through unchanged');
    for (const c of o.cards) {
      assert.ok((PAGE_STATES as string[]).includes(c.state), `${c.slug}: state ${c.state}`);
      assert.ok(c.series == null || (Array.isArray(c.series) && c.series.every(isSpec)), `${c.slug}: series is not a list of chart specs`);
      if (c.state === 'ok') assert.equal(cardView(c).state, 'ok', `${c.slug}: an ok card would read as ${cardView(c).state}`);
    }
    for (const f of o.figures) if (f.state === 'ok') assert.notEqual(figureValue(f), null, `${f.key} has a value the page cannot write`);
  }
  const seeded = adaptOverview('raise', (await raiseCall(raiseSeeded(), `/overview?project=${P}`)).body);
  for (const slug of ['cap-table', 'use-of-funds', 'capital-relationships']) {
    const c = seeded.cards.find((x: any) => x.slug === slug);
    assert.equal(c.state, 'ok', `${slug} should be ok when seeded`);
    assert.ok(drawableSeries(c.series).length >= 1, `${slug} draws nothing`);
  }
});

test('D661: every Raise module page\'s records are {key,label} columns and {id,cells} rows', async () => {
  const db = raiseSeeded();
  for (const m of RAISE_WORKER_MODULES) {
    const r = await raiseCall(db, `/modules/${m.slug}?project=${P}`);
    assert.equal(r.status, 200, `${m.slug}: ${JSON.stringify(r.body)}`);
    const d = adaptModule('raise', m.slug, r.body);
    assert.deepEqual(d.records, r.body.records, `${m.slug}: records changed on the way through`);
    const keys = new Set(d.records.cols.map((c: any) => c.key));
    assert.ok(keys.size > 0 && d.records.cols.every((c: any) => typeof c.key === 'string' && typeof c.label === 'string'), `${m.slug}: columns are not {key,label}`);
    for (const row of d.records.rows) {
      assert.ok(row.id != null && row.cells && typeof row.cells === 'object', `${m.slug}: a row is not {id,cells}`);
      for (const k of Object.keys(row.cells)) assert.ok(keys.has(k), `${m.slug}: a cell "${k}" has no column`);
    }
  }
});
