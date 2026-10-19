/**
 * D690 (S18-B, #1693) — Build's six lists as the canvas draws them (CO:617-622),
 * with stable, name-free ids, each row's `keys` and `edit`, and migration 461.
 *
 * #1693 ships tests 11 and 12 here, and #1694 adds the one-record reads
 * (tests 1-5, 10 and 11's linkable).
 * Test 10 (the logging of today's writes) lives in build_writes_d690.test.ts
 * and ships with #1693's closing PR, once D690 (S18-A, #1690) has merged.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, as migrations_fresh_build.test.ts builds one, so no table is
 * hand-written. It is built once and its schema replayed for each test. The
 * venture, founder and fund names are made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_records_build_d690.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { hasRecords } from '../src/services/records/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { declarationsFor } from '../../scripts/check-migration-declarations.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { editFor, initialValues } from '../../frontend/src/pages/cycles/forms.js';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const FILE_461 = FILES.find((f) => migrationNumber(f) === 461) as string;
const SQL_461 = readFileSync(resolve(MIGRATIONS, FILE_461), 'utf8');

const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;
const FOUNDER = 10, TEAMMATE = 11, ADMIN = 30;
const P = 1, P_OTHER = 2, COMPANY = 5, ENTITY = 7;
/** Every name seeded below, lower-cased: none may reach an id. */
const NAMES = ['wren', 'okafor', 'tomas', 'reyes', 'kestrel', 'harbour'];

/** The baseline, then every post-cutoff migration in order: a new environment's database. */
function freshBuild(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return db;
}
const BUILT_DDL = (freshBuild().prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', 1, 1001),
    (${TEAMMATE}, 'founder', 'Tomas Reyes', 'tomas@example.test', 1, NULL),
    (12, 'founder', 'Kai Okafor', 'kai@example.test', 1, NULL), (20, 'founder', 'Other Founder', 'other@example.test', 1, 1002),
    (${ADMIN}, 'admin', 'Ada Admin', 'ada@example.test', 1, NULL)`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id, entity_id) VALUES
    (${P}, 'Kestrel Works', 1001, ${COMPANY}, ${ENTITY}), (${P_OTHER}, 'Harbour Labs', 1002, 6, NULL)`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${COMPANY}), ('l2', ${TEAMMATE}, ${COMPANY})`);
  return db;
}

const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

/** Every module given rows that exercise each cell and key. */
function seeded() {
  const db = fixture();
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Manual reconciliation')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (1, ${P}, 'H1', 'Finance teams pay to skip month-end'), (2, ${P}, 'H2', 'Auditors want an export')`);
  // Impact High, Low, Medium, High; Effort S, XL, M, L. Feature 3 links to nothing.
  db.exec(`INSERT INTO mvp_features (id, project_id, title, added_value, effort, delivery_status, is_must_have, pain_group_id, hypothesis_id, due_date, sort_order, description, scope) VALUES
    (1, ${P}, 'Bank feed import', 'High', 'S', 'Done', 1, 1, 1, '${day(10)}', 1, 'Pull statements nightly', 'core'),
    (2, ${P}, 'Audit export', 'Low', 'XL', 'Review', 1, NULL, 2, NULL, 2, NULL, NULL),
    (3, ${P}, 'Exceptions queue', 'Medium', 'M', 'Blocked', 1, NULL, NULL, '${day(3)}', 3, NULL, NULL),
    (4, ${P}, 'Approval rules', 'High', 'L', 'Backlog', 1, 1, NULL, NULL, 4, NULL, 'out'),
    (5, ${P_OTHER}, 'Their feature', 'High', 'S', 'Backlog', 1, NULL, NULL, NULL, 1, NULL, NULL)`);
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status, sort_order, kpi_key, feedback_theme, target_date) VALUES
    (1, ${P}, 'Ship reconciliation', 'done', 1, 'mrr', 'Speed', '${day(-5)}'),
    (2, ${P}, 'Approval rules v1', 'later', 2, NULL, 'Control', NULL),
    (3, ${P}, 'Bank coverage', 'now', 3, 'activation', NULL, NULL),
    (4, ${P}, 'Pricing page', 'next', 4, NULL, NULL, NULL)`);
  // Holder 1: 60% with a cliff; 2: 40%, no cliff; 3: equity not recorded. 9: the other venture's.
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES
    (1, ${FOUNDER}, ${P}, 'Ana Wren', 600, 60, 'CEO'), (2, ${TEAMMATE}, ${P}, 'Tomas Reyes', 400, 40, 'CTO'),
    (3, 12, ${P}, 'Kai Okafor', NULL, NULL, 'Advisor'), (9, 20, ${P_OTHER}, 'Other Founder', 100, 100, 'CEO')`);
  db.exec(`INSERT INTO cap_table_vesting (id, user_id, holder_id, start_date, cliff_months, total_months, vested_shares) VALUES
    (1, ${FOUNDER}, 1, '2026-03-12', 12, 48, 0), (2, ${TEAMMATE}, 2, '2025-01-31', 0, 36, 100)`);
  db.exec(`INSERT INTO documents (id, project_id, status, template_name, created_at, title) VALUES
    (1, ${P}, 'signed', 'cofounder_agreement', '2026-10-01', 'Agreement'), (2, ${P}, 'generated', 'cofounder_agreement', '2026-10-02', 'Agreement')`);
  db.exec(`INSERT INTO cofounder_agreement_parties (document_id, party_index, name, user_id) VALUES (1, 0, 'Ana Wren', ${FOUNDER}), (2, 0, 'Tomas Reyes', ${TEAMMATE})`);
  db.exec(`INSERT INTO cap_table_scenarios (id, project_id, owner_user_id, name, is_variant, inputs_json, updated_at) VALUES
    (1, ${P}, ${FOUNDER}, 'Base', 0, '{"option_pool_pct":12.5}', '2026-10-01 00:00:00'),
    (2, ${P}, ${FOUNDER}, 'Bigger pool', 1, '{"option_pool_pct":20}', '2026-10-05 00:00:00')`);
  // Steps: an EIN done, an 83(b) due in 10 days, one overdue, one undated, and one with a stored proof.
  db.exec(`INSERT INTO formation_steps (id, project_id, title, due_date, state, proof_file_key, kind, jurisdiction, for_holder_id, sort_order, created_by) VALUES
    (1, ${P}, 'EIN', '${day(-20)}', 'done', NULL, 'ein', 'US', NULL, 1, ${FOUNDER}),
    (2, ${P}, '83(b) election · Ana Wren', '${day(10)}', 'todo', NULL, '83b', 'US', 1, 2, ${FOUNDER}),
    (3, ${P}, 'Annual report', '${day(-2)}', 'doing', 'typed-key-123', 'annual_report', 'DE', NULL, 3, ${FOUNDER}),
    (4, ${P}, 'Register for payroll', NULL, 'todo', NULL, NULL, NULL, NULL, 4, ${FOUNDER}),
    (5, ${P}, 'Formation', '${day(60)}', 'todo', 'build-proof/1/formation.pdf', 'formation', 'DE', NULL, 5, ${FOUNDER})`);
  db.exec(`INSERT INTO entities (id, name, entity_type, jurisdiction) VALUES (${ENTITY}, 'Kestrel Works Inc', 'project', 'DE')`);
  db.exec(`INSERT INTO entity_obligations (id, uid, entity_id, title, due_date, status, kind, cadence) VALUES (1, 'o1', ${ENTITY}, 'Franchise tax', '${day(5)}', 'open', 'franchise_tax', 'annual')`);
  // CRM: the founder's connection, hourly. Bank: a teammate's failing one. Payroll: a waiting choice and Feeds.
  db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, display_name, status, last_synced_at, last_error_at, config_json) VALUES
    (11, 'own-crm', ${FOUNDER}, 'hubspot', 'oauth2', 'HubSpot', 'active', '2026-10-10 08:00:00', NULL, '{"sync_frequency":"hourly"}'),
    (12, 'team-bank', ${TEAMMATE}, 'mercury', 'api_key', 'Mercury', 'error', NULL, '2026-10-09 08:00:00', '{}')`);
  db.exec(`INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (11, ${COMPANY}, 1), (12, ${COMPANY}, 1)`);
  db.exec(`INSERT INTO project_core_systems (project_id, kind, integration_id, used_by, updated_by, feeds_json, sync_request, sync_request_by) VALUES
    (${P}, 'crm', 11, 'Sales', ${FOUNDER}, '["kpis"]', NULL, NULL),
    (${P}, 'bank', 12, NULL, ${TEAMMATE}, '["use_of_funds"]', NULL, NULL),
    (${P}, 'payroll', NULL, NULL, ${FOUNDER}, '["team","kpis"]', 'daily', ${FOUNDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function read(db: DatabaseSync, slug: string, query = '', user = FOUNDER) {
  const token = await new SignJWT({ user_id: user, role: user === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(`/api/cycles/build/modules/${slug}?project=${P}${query}`, { headers: { Authorization: `Bearer ${token}` } },
    { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);
  return { status: r.status, body: await r.json() as any };
}
const text = (cell: any) => (cell && typeof cell === 'object' ? cell.text : cell);
const column = (body: any, key: string) => body.records.rows.map((r: any) => text(r.cells[key]));

const SLUGS = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'];
/** CO:617-622: each list's title, columns, filters and default sort. */
const CANVAS: Record<string, { title: string; name: string; cols: string[]; filters: string[]; sort: string }> = {
  'solution-design': { title: 'Features', name: 'Solution design', cols: ['Feature', 'Pain theme', 'Hypothesis', 'Impact', 'Effort'], filters: ['Linked', 'Impact', 'Effort'], sort: 'Impact' },
  'prototype-mvp': { title: 'Must-haves', name: 'Prototype / MVP', cols: ['Must-have', 'Tests', 'State', 'Owner', 'Due'], filters: ['State', 'Hypothesis'], sort: 'State' },
  'product-roadmap': { title: 'Roadmap items', name: 'Product roadmap', cols: ['Item', 'Column', 'Moves', 'Owner', 'Date'], filters: ['Column', 'Theme', 'KPI'], sort: 'Column' },
  'founding-team': { title: 'Founders', name: 'Founding team', cols: ['Founder', 'Role', 'Equity', 'Vesting', 'Agreement'], filters: ['Role'], sort: 'Equity' },
  'company-creation': { title: 'Filings', name: 'Company creation', cols: ['Filing', 'Jurisdiction', 'Due', 'State', 'Proof'], filters: ['State', 'Due'], sort: 'Due' },
  'operating-systems': { title: 'Systems', name: 'Operating systems', cols: ['System', 'Provider', 'State', 'Last sync', 'Used by'], filters: ['State'], sort: 'State' },
};

test('test 11: each list carries the canvas title, columns, filters and default sort', async () => {
  const db = seeded();
  for (const slug of SLUGS) {
    const r = await read(db, slug);
    assert.equal(r.status, 200, slug);
    const want = CANVAS[slug];
    assert.deepEqual(r.body.module, { slug, name: want.name, records_title: want.title }, slug);
    assert.deepEqual(r.body.records.cols.map((c: any) => c.label), want.cols, slug);
    assert.deepEqual(r.body.records.filters.map((f: any) => f.label), want.filters, slug);
    assert.equal(r.body.records.sorts[0].label, want.sort, slug);
    assert.equal(new Set(r.body.records.sorts.map((s: any) => s.key)).size, r.body.records.sorts.length, `${slug}: a sort is listed twice`);
    for (const f of r.body.records.filters) for (const o of f.options) assert.doesNotMatch(o.value, /[:,]/, `${slug}: ${f.key} option`);
  }
  db.close();
});

test('test 11: sorts[0] is applied when no sort is sent, ordinal by the canvas and never by the alphabet', async () => {
  const db = seeded();
  assert.deepEqual(column((await read(db, 'solution-design')).body, 'impact'), ['High', 'High', 'Medium', 'Low']);
  assert.deepEqual(column((await read(db, 'solution-design', '&sort=-impact')).body, 'impact'), ['Low', 'Medium', 'High', 'High']);
  // Ties keep the read's order: Bank feed import (1) before Approval rules (4).
  assert.deepEqual(column((await read(db, 'solution-design')).body, 'feature').slice(0, 2), ['Bank feed import', 'Approval rules']);
  assert.deepEqual(column((await read(db, 'solution-design', '&sort=effort')).body, 'effort'), ['Low', 'Medium', 'High', 'High']);
  assert.deepEqual(column((await read(db, 'prototype-mvp')).body, 'state'), ['Blocked', 'In progress', 'Not started', 'Done']);
  assert.deepEqual(column((await read(db, 'product-roadmap')).body, 'column'), ['now', 'next', 'later', 'done']);
  assert.deepEqual(column((await read(db, 'founding-team')).body, 'equity'), ['60%', '40%', null]);
  assert.deepEqual(column((await read(db, 'founding-team', '&sort=equity')).body, 'equity'), ['40%', '60%', null], 'unrecorded stays last');
  const filings = (await read(db, 'company-creation')).body.records.rows;
  assert.deepEqual(filings.map((r: any) => r.cells.due), [day(-20), day(-2), day(5), day(10), day(60), null]);
  // Failing, Connected, Not connected; ties in the read's order (Accounting, Payroll, Workspace).
  assert.deepEqual((await read(db, 'operating-systems')).body.records.rows.map((r: any) => [r.id, r.cells.state]),
    [['bank', 'Failing'], ['crm', 'Connected'], ['accounting', 'Not connected'], ['payroll', 'Not connected'], ['workspace', 'Not connected']]);
  // All tied: the read's order (build_systems_d686 pins it), not the ids' alphabet.
  db.exec(`DELETE FROM project_core_systems WHERE project_id = ${P}`);
  assert.deepEqual((await read(db, 'operating-systems')).body.records.rows.map((r: any) => r.id), ['bank', 'accounting', 'payroll', 'crm', 'workspace']);
  db.close();
});

test('test 11: filters read each row\'s keys, never a hidden cell', async () => {
  const db = seeded();
  const ids = async (slug: string, filter: string) => (await read(db, slug, `&filter=${encodeURIComponent(filter)}`)).body.records.rows.map((r: any) => r.id);
  // In the default sort: Impact, High first.
  assert.deepEqual(await ids('solution-design', 'linked:no'), [3, 2]);
  assert.deepEqual(await ids('solution-design', 'impact:high'), [1, 4]);
  assert.deepEqual(await ids('solution-design', 'effort:high'), [4, 2], 'an old XL is High');
  assert.deepEqual(await ids('prototype-mvp', 'state:in_progress'), [2], 'an old Review is In progress');
  assert.deepEqual(await ids('prototype-mvp', 'hypothesis:1'), [1]);
  assert.deepEqual(await ids('prototype-mvp', 'hypothesis:none'), [3, 4]);
  assert.deepEqual(await ids('product-roadmap', 'theme:control'), [2]);
  assert.deepEqual(await ids('product-roadmap', 'kpi:mrr'), [1]);
  assert.deepEqual(await ids('founding-team', 'role:cto'), ['h-2']);
  assert.deepEqual(await ids('company-creation', 'state:overdue'), ['step-3']);
  assert.deepEqual(await ids('company-creation', 'due_window:next_30'), ['obligation-1', 'step-2']);
  assert.deepEqual(await ids('company-creation', 'due_window:none'), ['step-4']);
  assert.deepEqual(await ids('operating-systems', 'state:connected'), ['crm']);
  db.close();
});

test('test 11: cells read the canvas\'s words', async () => {
  const db = seeded();
  const solution = (await read(db, 'solution-design')).body.records.rows;
  const byId = (rows: any[], id: unknown) => rows.find((r: any) => r.id === id);
  assert.deepEqual(byId(solution, 3).cells.pain_theme, { text: 'Links to nothing', tone: 'bad' });
  assert.equal(byId(solution, 2).cells.pain_theme, null, 'a hypothesis is a link: not "Links to nothing"');
  assert.equal(byId(solution, 1).cells.pain_theme, 'Manual reconciliation');
  const roadmap = (await read(db, 'product-roadmap')).body.records.rows;
  assert.deepEqual(roadmap.map((r: any) => [r.id, r.cells.moves]), [[3, 'activation'], [4, null], [2, 'Control'], [1, 'Speed · mrr']]);
  const founders = (await read(db, 'founding-team')).body.records.rows;
  assert.deepEqual(founders.map((r: any) => [r.id, r.cells.vesting, r.cells.agreement]),
    [['h-1', '4y · cliff 12 Mar 2027', 'Signed'], ['h-2', '3y · no cliff', 'Awaiting'], ['h-3', null, null]]);
  const filings = (await read(db, 'company-creation')).body.records.rows;
  assert.deepEqual(filings.map((r: any) => [r.id, r.cells.state, r.cells.proof, r.cells.jurisdiction]), [
    ['step-1', 'Issued', 'Missing', 'US'], ['step-3', 'Overdue', 'Key recorded', 'DE'], ['obligation-1', 'Due in 5 days', 'Missing', 'DE'],
    ['step-2', 'Due in 10 days', 'Missing', 'US'], ['step-5', 'Upcoming', 'Stored', 'DE'], ['step-4', 'Upcoming', '—', null],
  ]);
  const systems = (await read(db, 'operating-systems')).body.records.rows;
  assert.deepEqual(systems.map((r: any) => [r.id, r.cells.used_by]),
    [['bank', 'Use of funds'], ['crm', 'Sales'], ['accounting', null], ['payroll', 'Team · KPIs'], ['workspace', null]]);
  db.close();
});

test('test 11: no cell lacks a column, and no id fails the pattern or holds a name', async () => {
  const db = seeded();
  for (const slug of SLUGS) {
    const { records } = (await read(db, slug)).body;
    const keys = new Set(records.cols.map((c: any) => c.key));
    assert.ok(records.rows.length > 0, `${slug} has rows`);
    for (const row of records.rows) {
      for (const k of Object.keys(row.cells)) assert.ok(keys.has(k), `${slug}: a cell "${k}" has no column`);
      assert.match(String(row.id), RECORD_ID, `${slug}: ${row.id}`);
      for (const name of NAMES) assert.ok(!String(row.id).toLowerCase().includes(name), `${slug}: ${row.id} holds a name`);
      assert.equal(typeof row.keys, 'object', `${slug}: ${row.id} has keys`);
      assert.equal(typeof row.edit, 'object', `${slug}: ${row.id} has edit`);
    }
  }
  db.close();
});

test('test 11: each row\'s edit holds its stored values, and the Build Edit forms read them (D695 #1656 PR 3b)', async () => {
  const db = seeded();
  const step = (await read(db, 'company-creation')).body.records.rows.find((r: any) => r.id === 'step-2');
  assert.deepEqual(step.edit, { title: '83(b) election · Ana Wren', due_date: day(10), state: 'todo', kind: '83b', jurisdiction: 'US', for_holder_id: 1 });
  const stepForm = editFor('build', 'company-creation');
  // Edit filing (#1656 PR 3b): the stored state and holder id read as the form's words; the title is not a field.
  assert.deepEqual(stepForm.valuesOf(step), { due_date: day(10), state: 'upcoming', kind: '83b', jurisdiction: 'US', for_holder_id: 'h-1' }, 'the form reads every value edit carries');

  const must = (await read(db, 'prototype-mvp')).body.records.rows.find((r: any) => r.id === 3);
  assert.deepEqual(must.edit, { due_date: day(3) });
  const mustForm = editFor('build', 'prototype-mvp');
  assert.deepEqual(mustForm.valuesOf(must), { due_date: day(3) }, 'Edit must-have reads the due date edit carries');

  const systems = (await read(db, 'operating-systems')).body.records.rows;
  const edit = (id: string) => systems.find((r: any) => r.id === id).edit;
  assert.deepEqual(edit('crm'), { used_by: 'Sales', feeds: ['kpis'], sync: 'hourly' }, "the caller's own connection's setting");
  assert.deepEqual(edit('bank'), { used_by: null, feeds: ['use_of_funds'] }, "another member's connection: no sync");
  assert.deepEqual(edit('payroll'), { used_by: null, feeds: ['team', 'kpis'], sync: 'daily' }, 'the choice waiting for a connection');
  assert.deepEqual(edit('accounting'), { used_by: null, feeds: [], sync: null });
  assert.deepEqual(edit('workspace'), { used_by: null, feeds: [] }, 'Workspace has no connection to set');
  const systemForm = editFor('build', 'operating-systems');
  const payroll = systems.find((r: any) => r.id === 'payroll');
  assert.equal(payroll.cells.used_by, 'Team · KPIs');
  assert.deepEqual(initialValues(systemForm, systemForm.valuesOf(payroll)), { choice: '', used_by: '' }, 'a Feeds text never reaches Used by');
  const crm = systems.find((r: any) => r.id === 'crm');
  assert.deepEqual(initialValues(systemForm, systemForm.valuesOf(crm)), { choice: '', used_by: 'Sales' });

  const feature = (await read(db, 'solution-design')).body.records.rows.find((r: any) => r.id === 1);
  assert.deepEqual(feature.edit, { title: 'Bank feed import', description: 'Pull statements nightly', pain_group_id: 1, hypothesis_id: 1, added_value: 'High', effort: 'S', scope: 'core' });
  const founder = (await read(db, 'founding-team')).body.records.rows.find((r: any) => r.id === 'h-1');
  assert.deepEqual(founder.edit, { role: 'CEO', ownership_pct: 60 });
  db.close();
});

test('test 11: the option pool is the base scenario\'s, and null with no base scenario (decision 14)', async () => {
  const db = seeded();
  const facts = async () => (await read(db, 'founding-team')).body.facts;
  assert.equal((await facts()).option_pool_pct, 12.5, 'the variant\'s bigger pool is not read');
  assert.ok(!(await read(db, 'founding-team')).body.records.rows.some((r: any) => /pool/i.test(String(r.cells.founder))), 'the pool is not a row');
  db.exec(`UPDATE cap_table_scenarios SET inputs_json = '{"pre_money":1000000}' WHERE id = 1`);
  assert.equal((await facts()).option_pool_pct, null, 'no value is null, never 0');
  db.exec('DELETE FROM cap_table_scenarios WHERE id = 1');
  assert.equal((await facts()).option_pool_pct, null, 'only a variant: null');
  db.close();
});

test('test 11: keys.linked matches the chart\'s linked count, and keys.state and keys.due give the earliest open filing', async () => {
  const db = seeded();
  const solution = (await read(db, 'solution-design')).body;
  const [linked, unlinked] = solution.card.series[0].rows[0].parts;
  assert.equal(solution.records.rows.filter((r: any) => r.keys.linked === 'yes').length, linked);
  assert.equal(solution.records.rows.filter((r: any) => r.keys.linked === 'no').length, unlinked);
  const filings = (await read(db, 'company-creation')).body.records.rows;
  const open = filings.filter((r: any) => r.keys.state !== 'filed' && r.keys.due).sort((a: any, b: any) => a.keys.due.localeCompare(b.keys.due));
  assert.deepEqual([open[0].id, open[0].keys], ['step-3', { state: 'overdue', due: day(-2), due_window: 'overdue' }]);
  assert.deepEqual(filings.find((r: any) => r.id === 'step-1').keys.state, 'filed');
  db.close();
});

// ── Test 12: migration 461 ───────────────────────────────────────────────────

const MINE = declarationsFor(SQL_461);
const NEW_TABLES = ['mvp_test_sessions', 'mvp_test_findings', 'mvp_feature_links', 'mvp_release_checks', 'founder_contributions', 'formation_step_checks'];
const NEW_COLUMNS = [
  'mvp_features.description', 'mvp_features.scope', 'venture_risks.feature_id', 'roadmap_okrs.feature_id', 'roadmap_okrs.feedback_theme',
  'formation_steps.kind', 'formation_steps.jurisdiction', 'formation_steps.for_holder_id',
  'project_core_systems.feeds_json', 'project_core_systems.sync_request', 'project_core_systems.sync_request_by',
];
const EARLIER = FILES.filter((f) => migrationNumber(f) < 461);
const columnsOf = (db: DatabaseSync, table: string) => new Set((db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as any[]).map((r) => r.name));

test('test 12: 461 declares exactly the issue\'s columns and tables, and none it rules out', () => {
  assert.ok(FILE_461, 'a migration numbered 461 exists');
  assert.deepEqual(MINE.alters.map((a: any) => `${a.table}.${a.column}`).sort(), [...NEW_COLUMNS].sort());
  assert.deepEqual([...MINE.tables.keys()].sort(), [...NEW_TABLES].sort());
  assert.ok(!/roadmap_dependencies|sync_frequency\s+TEXT/i.test(SQL_461.replace(/^\s*--.*$/gm, '')), 'no second dependency store and no second sync setting');
  assert.ok(!/^\s*(BEGIN|COMMIT|UPDATE|DELETE|INSERT|DROP)\b/im.test(SQL_461.replace(/^\s*--.*$/gm, '')), 'additive: no transaction, no row rewritten and nothing dropped');
});

test('test 12, grep first (D-t): no column 461 adds is on its table in the baseline or an earlier migration, and no table it creates exists', () => {
  const earlier = new Map<string, Set<string>>();
  const note = (t: string, c: string) => { if (!earlier.has(t)) earlier.set(t, new Set()); earlier.get(t)!.add(c); };
  for (const sql of [BASELINE, ...EARLIER.map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))]) {
    const d = declarationsFor(sql);
    for (const [t, cols] of d.tables) { if (!earlier.has(t)) earlier.set(t, new Set()); for (const c of cols) note(t, c); }
    for (const a of d.alters) note(a.table, a.column);
  }
  for (const a of MINE.alters) {
    assert.ok(earlier.has(a.table), `${a.table} exists before 461`);
    assert.ok(!earlier.get(a.table)!.has(a.column), `${a.table}.${a.column} is new`);
  }
  for (const t of MINE.tables.keys()) assert.ok(!earlier.has(t), `${t} is new`);
  // The stores 461 reuses rather than adds.
  assert.ok(earlier.get('formation_steps')?.has('state') && earlier.get('formation_steps')?.has('proof_file_key'));
  assert.ok(earlier.has('okr_dependencies'));
});

test('test 12: 461 applies whole over a database that predates it, and its rows keep their shape', () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of EARLIER.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  db.exec(`INSERT INTO projects (id, name) VALUES (1, 'Kestrel Works')`);
  db.exec(`INSERT INTO mvp_features (id, project_id, title, added_value, effort) VALUES (1, 1, 'Old feature', 'Low', 'XL')`);
  db.exec(SQL_461);
  for (const pair of NEW_COLUMNS) { const [t, c] = pair.split('.'); assert.ok(columnsOf(db, t).has(c), `${pair} exists`); }
  for (const t of NEW_TABLES) for (const c of ['id', 'uid', 'created_at', 'updated_at']) assert.ok(columnsOf(db, t).has(c), `${t}.${c}`);
  assert.deepEqual({ ...(db.prepare('SELECT added_value, effort, scope, description FROM mvp_features WHERE id = 1').get() as any) },
    { added_value: 'Low', effort: 'XL', scope: null, description: null }, 'an old row is not rewritten');
  const refused = (sql: string) => assert.throws(() => db.exec(sql), /CHECK constraint failed/, sql);
  refused(`UPDATE mvp_features SET scope = 'v2' WHERE id = 1`);
  refused(`INSERT INTO formation_steps (project_id, title, kind, created_by) VALUES (1, 'x', 'trademark', 1)`);
  refused(`INSERT INTO project_core_systems (project_id, kind, sync_request, updated_by) VALUES (1, 'crm', 'weekly', 1)`);
  db.exec(`INSERT INTO mvp_test_sessions (project_id, feature_id, title) VALUES (1, 1, 'Pilot with two teams')`);
  refused(`INSERT INTO mvp_test_findings (session_id, text, direction) VALUES (1, 'Liked it', 'neutral')`);
  db.exec(`INSERT INTO mvp_feature_links (feature_id, kind, url) VALUES (1, 'github', 'https://github.com/example/repo/issues/1')`);
  assert.throws(() => db.exec(`INSERT INTO mvp_feature_links (feature_id, kind, url) VALUES (1, 'github', 'https://github.com/example/repo/issues/1')`), /UNIQUE/);
  const uid = (db.prepare('SELECT uid FROM mvp_test_sessions').get() as any).uid;
  assert.match(uid, /^[0-9a-f]{32}$/);
  assert.equal((db.prepare('SELECT status FROM mvp_test_sessions').get() as any).status, 'planned');
  db.close();
});

// ── #1694: the six one-record reads (tests 1-5, 10, 11 and 13) ───────────────

const PARTNER = 40, INVESTOR = 50, ADVISOR = 60, OTHER_FOUNDER = 20;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [TEAMMATE]: 'founder', 12: 'founder', [OTHER_FOUNDER]: 'founder',
  [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor', [ADVISOR]: 'advisor' };

/** seeded(), plus the stores 461 added, the outside viewers and the rows each record reads. */
function recorded() {
  const db = seeded();
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
    (${PARTNER}, 'partner', 'Pat Partner', 'pat@example.test', 1), (${INVESTOR}, 'investor', 'Ivy Investor', 'ivy@example.test', 1),
    (${ADVISOR}, 'advisor', 'Avi Advisor', 'avi@example.test', 1)`);
  db.exec(`INSERT INTO venture_risks (id, project_id, title, severity, owner_user_id, feature_id, created_by) VALUES
    (1, ${P}, 'Bank API rate limits', 'high', ${TEAMMATE}, 1, ${FOUNDER}), (2, ${P}, 'Unowned risk', 'medium', NULL, NULL, ${FOUNDER})`);
  db.exec(`UPDATE roadmap_okrs SET feature_id = 1, owner_user_id = ${FOUNDER} WHERE id = 3`);
  db.exec(`INSERT INTO okr_dependencies (project_id, okr_id, blocks_okr_id) VALUES (${P}, 4, 3), (${P}, 3, 2)`);
  db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, from_name, from_email, theme, roadmap_item_ref, status) VALUES
    ('fb1', ${P}, 'Please add more banks', 'customer', 'A customer', 'customer@example.test', 'Coverage', '3', 'open'),
    ('fb2', ${P}, 'Unrelated', 'customer', 'Someone', 'someone@example.test', NULL, '4', 'open')`);
  db.exec(`INSERT INTO mvp_test_sessions (id, project_id, feature_id, title, held_on, status) VALUES
    (1, ${P}, 1, 'Pilot with two teams', '2026-10-12', 'done'), (2, ${P}, 1, 'Second pilot', '${day(3)}', 'planned')`);
  db.exec(`INSERT INTO mvp_test_findings (session_id, text, hypothesis_id, direction, kept) VALUES
    (1, 'They skipped the manual step', 1, 'supports', 1), (1, 'One team still exports', 1, 'contradicts', 0)`);
  db.exec(`INSERT INTO mvp_feature_links (feature_id, kind, url, external_ref) VALUES
    (1, 'figma', 'https://www.figma.com/file/example', NULL),
    (1, 'github', 'https://github.com/example/app/issues/7', 'issue:example/app#7'),
    (1, 'github', 'https://github.com/example/app/issues/8', 'issue:example/app#8')`);
  db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id, last_seen_at) VALUES
    (13, ${P}, 'product_roadmap', 'issue', 'issue:example/app#7', 'roadmap_okrs', 3, '2026-10-12 08:00:00'),
    (13, ${P}, 'prototype_mvp', 'pull_request', 'pull:example/app#9', 'mvp_features', 1, '2026-10-11 08:00:00'),
    (13, ${P_OTHER}, 'product_roadmap', 'issue', 'issue:example/app#8', 'roadmap_okrs', 99, '2026-10-12 08:00:00')`);
  db.exec(`INSERT INTO mvp_release_checks (feature_id, label, done_at) VALUES (1, 'Copy reviewed', '2026-10-10'), (1, 'Load tested', NULL)`);
  db.exec(`INSERT INTO founder_contributions (project_id, holder_id, text, on_date) VALUES (${P}, 1, 'Closed the first pilot', '2026-10-09')`);
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES (4, ${FOUNDER}, ${P}, 'Seed fund', 50, 5, NULL)`);
  db.exec(`INSERT INTO formation_step_checks (step_id, key, done_at) VALUES (2, 'fill', '2026-10-10')`);
  db.exec(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, packet_ready_at, filed_on) VALUES
    (8, ${FOUNDER}, ${P}, 'DE', 'Kestrel Works Inc', 50000, 'filed', '2026-09-01', '2026-09-05', NULL)`);
  // The founder's HubSpot is enabled for this company, one the founder is also in, and one the founder is not in.
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (${COMPANY}, 'c5', 'Kestrel Works'), (98, 'c98', 'Wren Holdings'), (99, 'c99', 'Okafor Ventures')`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l3', ${FOUNDER}, 98), ('l4', 12, 99)`);
  db.exec(`INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (11, 98, 0), (11, 99, 1)`);
  db.exec(`UPDATE integrations SET created_at = '2026-08-03 10:00:00' WHERE id = 11`);
  db.exec(`UPDATE integrations SET display_name = 'Tomas private treasury', scopes_json = NULL WHERE id = 12`);
  db.exec(`UPDATE integrations SET scopes_json = '${JSON.stringify(['oauth', 'crm.objects.deals.read', 'crm.objects.deals.write', 'crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.companies.read', 'crm.objects.companies.write', 'crm.schemas.deals.read'])}' WHERE id = 11`);
  db.exec(`INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, request_summary, response_summary, payload_json, created_at) VALUES
    (11, ${FOUNDER}, 'hubspot', 'pull', 'sync', 'ok', 'REQUEST-SUMMARY-SECRET', 'RESPONSE-SUMMARY-SECRET', '{"secret":"PAYLOAD-SECRET"}', '2026-10-10 08:00:00'),
    (11, ${FOUNDER}, 'hubspot', 'pull', 'sync', 'error', NULL, NULL, NULL, '2026-10-11 09:41:00')`);
  return db;
}

const records = new Hono<any>();
records.route('/api/cycles', cycleRecords);
records.route('/api/cycles/build', build);
records.onError((e, c) => c.json({ error: e.message }, 500));
async function call(db: DatabaseSync, path: string, user = FOUNDER, init: { method?: string; body?: unknown } = {}) {
  const token = await new SignJWT({ user_id: user, role: ROLE[user] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await records.request(path, { method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
  { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const one = (db: DatabaseSync, slug: string, id: string | number, user = FOUNDER, project = P) =>
  call(db, `/api/cycles/build/modules/${slug}/records/${id}?project=${project}`, user);
const activityOf = (db: DatabaseSync, slug: string, id: string | number, user = FOUNDER, project = P) =>
  call(db, `/api/cycles/build/modules/${slug}/records/${id}/activity?project=${project}`, user);
const section = (body: any, key: string) => [...body.main, ...body.side].find((s: any) => s.key === key);
const factOf = (body: any, label: string) => body.facts.find((f: any) => f.label === label);
const pillText = (body: any) => body.pills.map((p: any) => (typeof p === 'string' ? p : p.text));

/** CO:369-374: each record's four facts, and its main and side section titles. */
const RECORD_CANVAS: Record<string, { id: string | number; facts: string[]; main: string[]; side: string[] }> = {
  'solution-design': { id: 1, facts: ['Pain theme', 'Hypothesis', 'Impact', 'Effort'], main: ['Description', 'Risks'], side: ['Appears in', 'Brief'] },
  'prototype-mvp': { id: 1, facts: ['Owner', 'Due', 'Hypothesis', 'Tests run'], main: ['Test sessions', 'Findings'], side: ['Linked', 'Release checklist'] },
  'product-roadmap': { id: 3, facts: ['Column', 'Moves', 'Answers', 'Date'], main: ['Dependencies', 'Feedback it answers'], side: ['GitHub', 'Public roadmap'] },
  'founding-team': { id: 'h-1', facts: ['Role', 'Equity', 'Vesting', 'Vested today'], main: ['Vesting timeline', 'Contributions'], side: ['Documents', 'Cap table'] },
  'company-creation': { id: 'step-2', facts: ['Filing', 'Jurisdiction', 'Due', 'Proof'], main: ['Steps', 'Reminders'], side: ['Linked'] },
  'operating-systems': { id: 'crm', facts: ['State', 'Last sync', 'Sync', 'Feeds'], main: ['Sync log', 'Permissions'], side: ['Companies'] },
};

test('test 1: each of the six records returns its canvas title, sub, four facts and section titles', async () => {
  const db = recorded();
  for (const [slug, want] of Object.entries(RECORD_CANVAS)) {
    const r = await one(db, slug, want.id);
    assert.equal(r.status, 200, `${slug}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body.facts.map((f: any) => f.label), want.facts, slug);
    assert.deepEqual(r.body.main.map((s: any) => s.title), want.main, slug);
    assert.deepEqual(r.body.side.map((s: any) => s.title), want.side, slug);
    for (const f of r.body.facts) assert.ok(f.value != null || (f.value === null && typeof f.reason === 'string' && f.reason), `${slug}: ${f.label}`);
  }
  const titles = async (slug: string, id: string | number) => { const b = (await one(db, slug, id)).body; return [b.title, b.sub]; };
  assert.deepEqual(await titles('solution-design', 1), ['Bank feed import', 'Answers Manual reconciliation · tests Finance teams pay to skip month-end']);
  assert.deepEqual(await titles('solution-design', 3), ['Exceptions queue', 'Links to nothing']);
  assert.deepEqual(await titles('prototype-mvp', 2), ['Audit export', 'Tests Auditors want an export']);
  assert.deepEqual(await titles('product-roadmap', 3), ['Bank coverage', 'Now · moves activation · owner Ana Wren']);
  assert.deepEqual(await titles('founding-team', 'h-1'), ['Ana Wren', 'CEO · 60% · vesting since 12 Mar 2026']);
  assert.deepEqual(await titles('operating-systems', 'crm'), ['CRM · HubSpot', 'Connected 3 Aug 2026 · last good sync 10 Oct 2026']);
  assert.deepEqual(await titles('operating-systems', 'accounting'), ['Accounting · Not connected', 'Not connected yet']);
  // A missing fact is { value: null, reason }.
  assert.deepEqual(factOf((await one(db, 'solution-design', 3)).body, 'Pain theme'), { label: 'Pain theme', value: null, reason: 'Not linked to a pain theme.' });
  const solution = (await one(db, 'solution-design', 1)).body;
  assert.deepEqual(pillText(solution), ['High impact', 'Low effort']);
  assert.deepEqual(pillText((await one(db, 'solution-design', 2)).body), ['Low impact', 'High effort', 'Out of scope'], 'a NULL scope with Low impact reads Out of scope');
  assert.deepEqual(section(solution, 'risks').rows, [{ a: 'Bank API rate limits', b: 'Tomas Reyes', c: 'High', tone: 'bad' }]);
  assert.deepEqual(section(solution, 'appears_in').rows.map((r: any) => [r.a, r.b, r.href]), [
    ['Prototype / MVP', 'Must-have', `/build/prototype-mvp/1?project=${P}`], ['Roadmap', 'Bank coverage · Now', `/build/product-roadmap/3?project=${P}`]]);
  assert.equal(section(solution, 'brief').rows[0].a, 'Not recorded');
  const must = (await one(db, 'prototype-mvp', 1)).body;
  assert.deepEqual(factOf(must, 'Tests run').value, 1, 'one done session');
  assert.deepEqual(section(must, 'sessions').rows.map((r: any) => [r.b, r.c]), [['2 findings', 'Done'], ['0 findings', 'Planned']]);
  assert.deepEqual(section(must, 'findings').rows.map((r: any) => [r.b, r.c]), [
    ['supports Finance teams pay to skip month-end', 'Kept'], ['contradicts Finance teams pay to skip month-end', 'Flagged']]);
  assert.deepEqual(section(must, 'linked').rows.map((r: any) => [r.a, r.b]), [
    ['Figma', 'Sync not recorded: Figma’s connector is not built'], ['GitHub', 'issue #7 · synced 12 Oct 2026'],
    ['GitHub', 'issue #8 · Not synced'], ['GitHub', 'pull request #9 · synced 11 Oct 2026']], 'another venture\'s ledger row never reads synced');
  assert.deepEqual(section(must, 'release').rows[0], { a: 'Done', b: '1 of 2' });
  assert.equal(factOf((await one(db, 'prototype-mvp', 3)).body, 'Tests run').value, null);
  const item = (await one(db, 'product-roadmap', 3)).body;
  assert.deepEqual(section(item, 'dependencies').rows.map((r: any) => [r.a, r.b, r.c]), [
    ['Waits on Pricing page', 'Next', 'Open'], ['Blocks Approval rules v1', 'Later', undefined]]);
  assert.deepEqual(section(item, 'feedback').rows, [{ a: '“Please add more banks”', b: `A customer · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date())}`, c: 'Coverage', tone: 'vio' }]);
  assert.doesNotMatch(JSON.stringify(item), /customer@example\.test/, 'never the sender\'s email');
  // D782 (#2111): the panel also names the issue's milestone and the release that shipped the item.
  assert.deepEqual(section(item, 'github').rows.map((r: any) => [r.a, r.b]), [['Issue #7', 'synced 12 Oct 2026'], ['State', 'Not recorded: the sync stores no issue state.'],
    ['Milestone', 'In no milestone'], ['Shipped', 'Not shipped: no release names it or closes it.']]);
  assert.equal(section(item, 'public').rows[0].a, 'Not recorded');
  db.close();
});

test('test 2: filings read decision 8, and a lab- or obligation- row declares no write', async () => {
  const db = recorded();
  assert.deepEqual(factOf((await one(db, 'company-creation', 'step-4')).body, 'Proof'), { label: 'Proof', value: null, reason: 'Not filed yet' });
  assert.equal(factOf((await one(db, 'company-creation', 'step-5')).body, 'Proof').value, 'Stored');
  assert.deepEqual(pillText((await one(db, 'company-creation', 'step-1')).body), ['Issued'], 'a done EIN reads Issued');
  db.exec(`UPDATE formation_steps SET state = 'done' WHERE id = 5`);
  assert.deepEqual(pillText((await one(db, 'company-creation', 'step-5')).body), ['Filed']);
  const soon = (await one(db, 'company-creation', 'step-2')).body;
  assert.deepEqual(pillText(soon), ['Due in 10 days']);
  assert.match(soon.sub, /· 10 days left$/);
  assert.deepEqual(pillText((await one(db, 'company-creation', 'step-3')).body), ['Overdue']);
  assert.deepEqual(section(soon, 'steps').rows.map((r: any) => [r.a, r.c]), [
    ['Fill the election', 'Done'], ['Mail by certified post', 'Open'], ['Upload proof of mailing', 'Open']]);
  assert.deepEqual(section(soon, 'reminders').rows, [{ a: 'Not recorded', b: 'No reminder is sent for filings.', tone: 'grey' }]);
  assert.deepEqual(section(soon, 'linked').rows.find((r: any) => r.a === 'Founder stock'), { a: 'Founder stock', b: 'Ana Wren', href: `/build/founding-team/h-1?project=${P}` });
  assert.deepEqual(section((await one(db, 'company-creation', 'step-1')).body, 'steps').rows.map((r: any) => r.a), ['Apply for the EIN', 'Upload the EIN letter']);
  const obligation = await one(db, 'company-creation', 'obligation-1');
  assert.equal(obligation.status, 200);
  assert.ok(!obligation.body.actions.some((a: any) => a.key === 'mark-filed'), 'filing an entity obligation is HQ\'s');
  const lab = await one(db, 'company-creation', 'lab-8-1');
  assert.equal(lab.status, 200);
  assert.deepEqual(lab.body.actions, [], 'a lab- row declares no action');
  assert.deepEqual(pillText(lab.body), ['Filed']);
  assert.deepEqual(pillText((await one(db, 'company-creation', 'lab-8-2')).body), ['Upcoming'], 'a step with no date is Upcoming');
  assert.deepEqual(section(lab.body, 'linked').rows[0], { a: 'Incorporation', b: 'Open in the Legal engine', href: '/raise/legal-engine/incorporation' });
  assert.equal((await one(db, 'company-creation', 'lab-8-3')).status, 404, 'a lab step is 0 to 2');
  db.close();
});

test('test 3: systems read their sync, show writers their log and permissions, and never another member\'s data', async () => {
  const db = recorded();
  assert.equal(factOf((await one(db, 'operating-systems', 'crm')).body, 'Sync').value, 'Hourly');
  db.exec(`UPDATE integrations SET config_json = '{}' WHERE id = 11`);
  assert.equal(factOf((await one(db, 'operating-systems', 'crm')).body, 'Sync').value, 'Live', 'live when unset');
  assert.deepEqual(factOf((await one(db, 'operating-systems', 'payroll')).body, 'Sync'), { label: 'Sync', value: null, reason: 'Not connected yet.' });
  assert.equal(factOf((await one(db, 'operating-systems', 'payroll')).body, 'Feeds').value, 'Team · KPIs');

  const founder = (await one(db, 'operating-systems', 'crm')).body;
  assert.deepEqual(section(founder, 'sync_log').rows, [
    { a: '11 Oct 2026 · 09:41', b: 'sync', c: 'Failed', tone: 'bad' }, { a: '10 Oct 2026 · 08:00', b: 'sync', c: 'OK', tone: 'ok' }]);
  assert.doesNotMatch(JSON.stringify(founder), /SUMMARY-SECRET|PAYLOAD-SECRET/, 'never a summary or payload');
  assert.equal(section(founder, 'permissions').rows[0].c, 'Granted');
  assert.equal(section(founder, 'permissions').rows.length, 8);
  const partner = await one(db, 'operating-systems', 'crm', PARTNER);
  assert.equal(partner.status, 200);
  assert.equal(section(partner.body, 'sync_log'), undefined, 'a partner gets no Sync log');
  assert.equal(section(partner.body, 'permissions'), undefined, 'a partner gets no Permissions');

  assert.deepEqual(section(founder, 'companies').rows, [{ a: 'Kestrel Works', b: 'on' }, { a: 'Wren Holdings', b: 'off' }]);
  assert.deepEqual(section(partner.body, 'companies').rows, [{ a: 'Kestrel Works', b: 'on' }]);
  assert.doesNotMatch(JSON.stringify(founder) + JSON.stringify(partner.body), /Okafor Ventures/, 'never a company the viewer is not in');

  const bank = (await one(db, 'operating-systems', 'bank')).body;
  // D710 (#1775): Mercury is in the catalogue now, so its catalogue name reads.
  assert.equal(bank.title, 'Bank · Mercury', 'the catalogue name, not the member\'s own');
  assert.doesNotMatch(JSON.stringify(bank), /private treasury/);
  assert.deepEqual(section(bank, 'permissions').rows[0].b, 'The connector stored no granted scopes.');
  db.exec(`UPDATE integrations SET scopes_json = '["oauth"]' WHERE id = 11`);
  assert.deepEqual(section((await one(db, 'operating-systems', 'crm')).body, 'permissions').rows[0].b, 'Some requested scopes were not granted.');

  const workspace = (await one(db, 'operating-systems', 'workspace')).body;
  for (const label of ['Last sync', 'Sync']) assert.equal(factOf(workspace, label).value, null, label);
  for (const key of ['sync_log', 'permissions']) assert.equal(section(workspace, key).rows[0].a, 'Not recorded', key);
  db.close();
});

test('test 4: a founder record gates Documents, needs a founder role, and vests nothing before the cliff', async () => {
  const db = recorded();
  db.exec(`INSERT INTO formation_steps (id, project_id, title, due_date, state, kind, for_holder_id, created_by) VALUES (9, ${P}, '83(b) election · Tomas Reyes', '${day(20)}', 'todo', '83b', 2, ${FOUNDER})`);
  const founder = (await one(db, 'founding-team', 'h-2')).body;
  assert.deepEqual(section(founder, 'documents').rows.map((r: any) => r.a), ['Co-founder agreement', '83(b)']);
  assert.equal(section(founder, 'documents').rows[1].href, `/build/company-creation/step-9?project=${P}`);
  assert.equal(section(founder, 'documents').gate, 'write');
  const partner = await one(db, 'founding-team', 'h-2', PARTNER);
  assert.equal(partner.status, 200);
  assert.equal(section(partner.body, 'documents'), undefined, 'a partner gets no Documents');
  assert.deepEqual(partner.body.actions, [], 'nor any action');
  assert.equal((await one(db, 'founding-team', 'h-4')).status, 404, 'a holder without a founder role is no founder record');
  assert.equal((await one(db, 'founding-team', 'h-9')).status, 404, 'another venture\'s founder');

  const ana = (await one(db, 'founding-team', 'h-1')).body;
  assert.equal(factOf(ana, 'Vested today').value, '0%', 'the stored 0 shares');
  assert.equal(factOf(ana, 'Vesting').value, '4 years · cliff 12 Mar 2027');
  db.exec('UPDATE cap_table_vesting SET vested_shares = NULL WHERE id = 1');
  assert.equal(factOf((await one(db, 'founding-team', 'h-1')).body, 'Vested today').value, '0%', 'before the cliff, from the schedule');
  assert.deepEqual(section(ana, 'timeline').rows.map((r: any) => [r.a, r.b, r.c]), [['Cliff', '12 Mar 2027', 'Upcoming'], ['Fully vested', '12 Mar 2030', 'Upcoming']]);
  assert.deepEqual(section(ana, 'contributions').rows, [{ a: 'Closed the first pilot', b: '9 Oct 2026' }]);
  assert.deepEqual(section(ana, 'cap_table').rows, [{ a: 'Shares', b: '600 shares' }]);
  // #1695 adds the writes after it (Log, Edit); Edit split stays the cap table's link.
  assert.deepEqual(ana.actions.map((a: any) => [a.key, a.kind, a.href])[0], ['edit-split', 'link', '/raise/capital/cap-table']);
  assert.equal(factOf((await one(db, 'founding-team', 'h-2')).body, 'Vested today').value, '25%', 'stored vested shares over shares');
  db.close();
});

test('test 5: the role table, for the read and its writer-only sections, and a foreign id is 404', async () => {
  const db = recorded();
  const writerOnly = (body: any) => ['sync_log', 'permissions'].map((key) => !!section(body, key));
  for (const user of [FOUNDER, ADMIN]) {
    const r = await one(db, 'operating-systems', 'crm', user);
    assert.equal(r.status, 200, `user ${user}`);
    assert.deepEqual(writerOnly(r.body), [true, true], `user ${user}`);
    // #1695 adds Choose connector and Disconnect after it; Reconnect stays the tool's link.
    assert.deepEqual(r.body.actions.map((a: any) => [a.key, a.href])[0], ['reconnect', `/build/connect?tool=hubspot&project_id=${P}`]);
  }
  const partner = await one(db, 'operating-systems', 'crm', PARTNER);
  assert.equal(partner.status, 200);
  assert.deepEqual(writerOnly(partner.body), [false, false]);
  assert.deepEqual(partner.body.actions, []);
  for (const user of [ADVISOR, INVESTOR]) assert.equal((await one(db, 'operating-systems', 'crm', user)).status, 403, `user ${user}`);
  assert.equal((await one(db, 'solution-design', 1, OTHER_FOUNDER)).status, 403, 'another founder, with ?project= this venture');
  assert.equal((await one(db, 'solution-design', 1, OTHER_FOUNDER, P_OTHER)).status, 404, 'this venture\'s id under their own project');
  assert.equal((await activityOf(db, 'solution-design', 1, OTHER_FOUNDER, P_OTHER)).status, 404);
  assert.equal((await one(db, 'solution-design', 5, OTHER_FOUNDER, P_OTHER)).status, 200, 'their own feature answers');
  // A venture-B id with ?project=A is 404, while venture A's own id is 200.
  for (const [slug, own, foreign] of [['solution-design', 1, 5], ['prototype-mvp', 1, 5], ['founding-team', 'h-1', 'h-9']] as const) {
    assert.equal((await one(db, slug, own)).status, 200, slug);
    assert.equal((await activityOf(db, slug, own)).status, 200, slug);
    assert.equal((await one(db, slug, foreign)).status, 404, slug);
    assert.equal((await activityOf(db, slug, foreign)).status, 404, slug);
  }
  db.exec(`INSERT INTO mvp_features (id, project_id, title, is_must_have) VALUES (6, ${P}, 'Nice to have', 0)`);
  assert.equal((await one(db, 'solution-design', 6)).status, 200);
  assert.equal((await one(db, 'prototype-mvp', 6)).status, 404, 'a feature that is not a must-have has no Prototype / MVP record');
  assert.equal((await one(db, 'operating-systems', 'phone')).status, 404, 'one of the five kinds only');
  assert.equal((await one(db, 'company-creation', 'step-1', ADMIN)).status, 200);
  assert.equal((await one(db, 'company-creation', 'step-1', ADMIN, P_OTHER)).status, 404, 'scoped by its project, even for an admin who reads both');
  db.close();
});

test('test 10: a must-have\'s write reads on both feature records, old JSON rows read on theirs, and the IP copy on none', async () => {
  const db = recorded();
  const write = await call(db, `/api/cycles/build/features/1?project=${P}`, FOUNDER, { method: 'PATCH', body: { due_date: day(12) } });
  assert.equal(write.status, 200, JSON.stringify(write.body));
  // The creator line read from a store's own column is not a log row.
  const actions = async (slug: string, id: string | number) => (await activityOf(db, slug, id)).body.items
    .map((i: any) => i.action).filter((a: string) => a !== 'created');
  assert.ok((await actions('solution-design', 1)).includes('build_feature_details_changed'));
  assert.ok((await actions('prototype-mvp', 1)).includes('build_feature_details_changed'), 'one history for a feature and its must-have');
  assert.ok(!(await actions('solution-design', 2)).includes('build_feature_details_changed'));

  // Rows written before #1693, with no entity, and another writer's free text.
  db.exec(`INSERT INTO activity_logs (project_id, user_id, action, details, created_at) VALUES
    (${P}, ${FOUNDER}, 'build_feature_details_changed', '{"id":2}', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_feature_details_changed', 'not json at all', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_founder_role_changed', '{"id":1}', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_roadmap_details_changed', '{"id":4}', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_formation_step_changed', '{"id":1}', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_obligation_proof_changed', '{"id":1}', '2026-09-01 00:00:00'),
    (${P}, ${FOUNDER}, 'build_system_mapping_changed', '{"id":"crm"}', '2026-09-01 00:00:00'),
    (${P_OTHER}, ${OTHER_FOUNDER}, 'build_feature_details_changed', '{"id":1}', '2026-09-01 00:00:00')`);
  assert.deepEqual(await actions('solution-design', 2), ['build_feature_details_changed']);
  assert.deepEqual(await actions('prototype-mvp', 2), ['build_feature_details_changed']);
  assert.deepEqual(await actions('founding-team', 'h-1'), ['build_founder_role_changed']);
  assert.deepEqual(await actions('product-roadmap', 4), ['build_roadmap_details_changed']);
  assert.deepEqual(await actions('company-creation', 'step-1'), ['build_formation_step_changed']);
  assert.deepEqual(await actions('company-creation', 'obligation-1'), [], 'an old obligation-proof row reads on no record');
  assert.deepEqual(await actions('operating-systems', 'crm'), ['build_system_mapping_changed']);
  assert.equal((await one(db, 'solution-design', 2)).status, 200, 'free text in details does not break the read');
  assert.equal((await actions('solution-design', 1)).filter((a: string) => a === 'build_feature_details_changed').length, 1, 'another venture\'s old row is not read');

  db.exec(`INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details) VALUES
    (${P}, ${FOUNDER}, 'build.company-creation', 'project', 'build_ip_copied', 'IP details copied from an accepted application')`);
  for (const id of ['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'obligation-1', 'lab-8-0', 'lab-8-1', 'lab-8-2']) {
    assert.ok(!(await actions('company-creation', id)).includes('build_ip_copied'), id);
  }
  db.close();
});

test('test 11: records.linkable is false until Build registers, then true on every list', async () => {
  assert.equal(hasRecords('build', {}), false);
  assert.equal(hasRecords('build'), true);
  const db = recorded();
  for (const slug of SLUGS) assert.equal((await read(db, slug)).body.records.linkable, true, slug);
  db.close();
});
