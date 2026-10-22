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
import { adaptCard, adaptModule, adaptOverview, adaptRecords, fnOf, toFnMap } from '../../frontend/src/pages/cycles/adapters/index.js';
import { MODULES as PAGE_MODULES, CARDS, RECORDS } from '../../frontend/src/pages/cycles/adapters/validate.js';
import { drawableSeries, cardView, figureValue } from '../../frontend/src/pages/cycles/cycleModel.js';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { personalMatchTables } from './_mercury_d713.ts';
import { recordFill } from '../src/services/fills/provenance.ts';

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
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validation_decisions',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  // D690 decision 9: an interview's state reads its latest session. 447's
  // `validate_proposals` column is left out: the tests that read proposals
  // create that table themselves.
  db.exec(sqlOf('438_interview_sessions.sql'));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec(sqlOf('447_assistant_interviews.sql').replace(/ALTER TABLE validate_proposals[^;]*;/, ''));
  db.exec(sqlOf('453_interview_processing.sql'));
  // D690 (#1692): the tracked list and Experiments' links read 460's stores.
  db.exec(sqlOf('460_validate_record_stores.sql'));
  // D693 (#1704): Verdict, the seventh module, over migration 464's decisions.
  db.exec(sqlOf('464_verdict_decisions.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, method: string, path: string, body?: unknown, binding?: any) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: binding ?? d1Over(db) } as any);
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
  // Eadwyn's mark (#1523), written by the accept path's own writer: H1 taken
  // as Eadwyn wrote it, H2 corrected before accepting, H3 the founder's own.
  const fillEnv = { DB: d1Over(db) } as any;
  const fill = (rowId: number, proposed: string, written: string) => recordFill(fillEnv, {
    target: { table: 'hypotheses', rowId, column: 'claim' }, proposalId: null, fillClass: 'synthesis',
    proposedValue: proposed, writtenValue: written, citation: null, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    task: 'validate_draft_hypotheses', decidedBy: FOUNDER,
  } as any);
  await fill(1, 'Fleets pay', 'Fleets pay');
  await fill(2, 'Drivers send texts', 'Drivers text');
  assert.equal((await call(db, 'PUT', `/evidence-links/1/strength?project=${P}`, { strength: 'pattern' })).status, 200);
  const plan = await call(db, 'PUT', `/hypotheses/1/plan?project=${P}`, { owner_user_id: FOUNDER });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  const wl = db.prepare("INSERT INTO waitlist_signups (project_id, email, name, audience, created_at) VALUES (?, ?, ?, 'customer', ?)");
  for (let i = 0; i < 9; i += 1) wl.run(P, `w${i}@x.test`, i % 2 ? `Lead ${i}` : null, `${ago(i * 9)} 09:00:00`);
  assert.equal((await call(db, 'PUT', `/waitlist-target?project=${P}`, { value: 40 })).status, 200);
  assert.equal((await call(db, 'POST', `/demand-signals?project=${P}`, { kind: 'loi', who: 'Fleetco', amount_cents: 1800000, currency: 'usd', period: 'year', signal_date: ago(2) })).status, 201);
  db.prepare("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('an1', ?, ?)").run(OTHER, P);
  assert.equal((await call(db, 'POST', `/competitor-mentions?project=${P}`, { name: 'Haulr', category: 'adjacent', signal_type: 'funding', label: 'raised $12M', source_url: 'https://news.example/haulr', observed_on: ago(3) })).status, 201);
  // D693 (#1704): one given decision for the venture, with its reasoning and
  // the five pieces of evidence it rests on.
  const d = db.prepare(
    "INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, decided_at, state) VALUES (?, 'proceed', ?, ?, ?, 'given') RETURNING id",
  ).get(P, 'Three fleets paid for the pilot.\nThe rest follows.', FOUNDER, `${ago(2)} 10:00:00`) as any;
  const ev = db.prepare(
    "INSERT INTO validation_decision_evidence (uid, decision_id, kind, ref_id, label, strength, direction, on_date) VALUES (?, ?, 'hypothesis_evidence', ?, ?, 'measured', 'supports', ?)",
  );
  for (let i = 1; i <= 5; i += 1) ev.run(`ev-${i}`, Number(d.id), `evidence-${i}`, `Pilot invoice ${i} · H1`, ago(3));
  return db;
}

test('D661: the adapter lists the Worker\'s own seven modules, and has a card and a table for each', () => {
  assert.equal(WORKER_MODULES.length, 7);
  assert.equal(WORKER_MODULES[6].slug, 'verdict');
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
import { MODULES as RAISE_WORKER_MODULES, stageCell } from '../src/services/raiseCycle.ts';
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
  personalMatchTables(db); // D752: Capital relationships reads a raise receipt's posted date
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001)`);
  return db;
}

const raiseApp = new Hono<any>();
raiseApp.route('/api/cycles/raise', cycleRaise);
raiseApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function raiseCall(db: any, path: string, flags: Record<string, string> = {}) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await raiseApp.request(`/api/cycles/raise${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...flags } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

/** Three modules given real rows, as cycle_raise_d663 seeds them. */
function raiseSeeded() {
  const db = raiseFixture();
  const before = [{ holder: 'Fay', type: 'founder', shares: 8000 }, { holder: 'Option Pool', type: 'option_pool', shares: 2000 }];
  const after = [...before, { holder: 'Seed investors', type: 'preferred', shares: 2500 }];
  // Saved with the entry keys every save now gives (D691, #1699); a scenario without them reads id: null.
  const inputs = { founders: [{ name: 'Fay', shares: 8000, key: 'e-1' }], option_pool_pct: 20, rounds: [{ name: 'Seed', pre_money: 8000, investment: 2500, key: 'e-2' }], entry_key_seq: 2 };
  db.exec(`INSERT INTO cap_table_scenarios (owner_user_id, project_id, name, inputs_json, result_json) VALUES
           (${FOUNDER}, ${P}, 'Main', '${JSON.stringify(inputs)}', '${JSON.stringify({ founding: before, rounds: [{ name: 'Seed', ledger: after }] })}')`);
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

test('D663: a round call\'s responders, with the flag on, draw through the page as a toned cell and a rows chart', async () => {
  const { cellView } = await import('../../frontend/src/pages/cycles/cycleModel.js');
  const db = raiseSeeded();
  db.exec(sqlOf('436_round_calls.sql'));
  db.exec("INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (71, 'investor', 'Rhea', 'rhea@example.test', 1, 'approved')");
  db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
           VALUES (1, 'c1', ${P}, 'Seed call', 100000000, 'safe', 'SAFE', 2500000, '2999-01-01', 'sent', 'h', ${FOUNDER})`);
  db.exec("INSERT INTO round_call_recipients (call_id, investor_user_id, origin, commitment_cents, responded_at) VALUES (1, 71, 'chosen', 5000000, '2026-10-09T10:00:00Z')");
  db.exec(`INSERT INTO raise_prospects (uid, project_id, name, email, stage, amount, commit_status) VALUES ('r', ${P}, 'Rhea', 'rhea@example.test', 'committed', 50000, 'soft')`);
  const flags = { ROUND_CALLS_ENABLED: 'true' };
  const m = adaptModule('raise', 'capital-relationships', (await raiseCall(db, `/modules/capital-relationships?project=${P}&filter=source:call`, flags)).body);
  assert.equal(m.records.rows.length, 1);
  const v = cellView(m.records.rows[0].cells.stage);
  assert.equal(v.text, 'Committed · soft · via call');
  assert.equal(v.tone, 'warn');
  const c = adaptOverview('raise', (await raiseCall(db, `/overview?project=${P}`, flags)).body).cards.find((x: any) => x.slug === 'capital-relationships');
  const drawn = drawableSeries(c.series);
  assert.ok(drawn.some((s: any) => s.kind === 'rows' && s.items.some((i: any) => i.label === 'Responded to a round call' && i.value === 1)), 'the responders row is drawn');
});

test('D752: stageCell reads a received date for a committed prospect, with or without a call, and nothing for any other stage', () => {
  const p = (over: any = {}) => ({ stage: 'committed', commit_status: 'soft', via_call: false, ...over }) as any;
  assert.deepEqual(stageCell(p(), '2026-10-02'), { text: 'Committed · received 2026-10-02' });
  assert.deepEqual(stageCell(p({ via_call: true }), '2026-10-02T12:00:00Z'), { text: 'Committed · received 2026-10-02 · via call' });
  assert.deepEqual(stageCell(p()), { text: 'Committed · soft', tone: 'warn' }, 'no date: as today');
  assert.equal(stageCell(p({ stage: 'meeting', commit_status: null }), '2026-10-02'), stageCell(p({ stage: 'meeting', commit_status: null })), 'a date never changes another stage');
});

test('D661: a slug from a read or a URL reaches only the adapter\'s own functions, never an inherited one', () => {
  for (const slug of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const c = adaptCard('validate', { slug, state: 'ok', series: { themes: [{ theme: 'x', mentions: 3 }] } });
    assert.equal(c.series, null, `${slug}: an inherited method was called as a card adapter`);
    assert.deepEqual(adaptRecords('validate', slug, { cols: ['A'], rows: [{ a: 1 }] }).rows, [], `${slug}: an inherited value was used as a records adapter`);
    assert.equal(fnOf(toFnMap({ a: () => 1 }), slug), null, `${slug}: fnOf returned an inherited value`);
  }
  assert.equal(adaptCard('constructor', { slug: 'x', state: 'ok', series: { a: 1 } }).series, null, 'an inherited cycle name reached an adapter');
  assert.equal(typeof fnOf(toFnMap({ a: () => 1 }), 'a'), 'function');
  assert.equal(fnOf(toFnMap({ a: 1 }), 'a'), null, 'a non-function is never put in the table');
  assert.equal(fnOf({ a: () => 1 }, 'a'), null, 'a plain object is never looked up by name');
  assert.equal(fnOf(new Map([['a', 1]]), 'a'), null, 'a Map entry that is not a function is not callable');
});


// ── Grow (#1488, D664): its own shapes, through `adapters/grow.js` ─────────

import { readdirSync } from 'node:fs';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { GROW_MODULES } from '../src/services/growCycle.ts';
import { recomputeRevenueMovements } from '../src/services/revenueMovements.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { CARDS as GROW_CARDS, RECORDS as GROW_RECORDS } from '../../frontend/src/pages/cycles/adapters/grow.js';

const MIG = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const migFile = (p: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const migDdl = (p: string) => migFile(p).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');
const GP = 7;

/** The stores cycle_grow_d664 builds its fixture from. */
async function growFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, project_id INTEGER, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT, actor TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  db.exec(tableFromBaseline(BASELINE, 'entities'));
  db.exec(tableFromBaseline(BASELINE, 'compliance_events'));
  for (const p of ['034', '119', '127', '132', '326']) db.exec(migDdl(p));
  db.exec(migFile('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(migDdl('125')); db.exec(migFile('437'));
  db.exec(migFile('443'));
  db.exec(migFile('462'));
  db.exec(migFile('507'));
  db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)').run(FOUNDER, 'founder', 1001, 'Fay', 'fay@example.test');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, 'p7', 'Venture', 1001, 70)`).run(GP);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  return { db, env };
}

const growApp = new Hono<any>();
growApp.route('/api/cycles/grow', cycleGrow);
growApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function growCall(f: { env: any }, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await growApp.fetch(new Request(`http://t/api/cycles/grow${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const monthAgo = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10); };
const dayFrom = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Every module given real rows, written through Grow's own routes where it has them. */
async function growSeeded() {
  const f = await growFixture();
  const { db } = f;
  const post = async (path: string, body: any, want = 201) => {
    const r = await growCall(f, path.startsWith('PUT ') ? 'PUT' : 'POST', path.replace(/^PUT /, ''), { project: GP, ...body });
    assert.equal(r.status, want, `${path}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  // Product improvement
  await post('/feedback', { body: 'Export to CSV', source: 'customer', theme: 'Exports', from_name: 'Ana', from_email: 'ana@x.example' });
  await post('/feedback', { body: 'Bulk export', source: 'customer', theme: 'Exports', status: 'planned', roadmap_item_label: 'CSV export' });
  await post('/feedback', { body: 'Onboarding is long', source: 'team', theme: 'Onboarding', status: 'shipped', roadmap_item_label: 'Short onboarding' });
  // Distribution: two channels with spend this month, customers by UTM, sign-ups and a paying count.
  const month = new Date().toISOString().slice(0, 7);
  for (const [name, utm, spend] of [['LinkedIn', 'linkedin', 120000], ['Search ads', 'google', 30000]] as const) {
    const ch = await post('/channels', { name, utm_source: utm });
    await post(`PUT /channels/${ch.uid}/spend/${month}`, { spend_cents: spend }, 200);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const contact = db.prepare(`INSERT INTO contacts (uid, project_id, audience, email, utm_json, created_at) VALUES (?, ${GP}, 'customer', ?, ?, ?)`);
  contact.run('c1', 'a@x.example', '{"utm_source":"linkedin"}', now);
  contact.run('c2', 'b@x.example', '{"utm_source":"linkedin"}', now);
  contact.run('c3', 'c@x.example', '{"utm_source":"google"}', now);
  for (const e of ['w1@x.example', 'w2@x.example', 'w3@x.example']) db.prepare(`INSERT INTO waitlist_signups (project_id, email) VALUES (${GP}, ?)`).run(e);
  // Revenue: snapshots for the figures, and four billed months on the ledger.
  const snap = db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (?, ?, ?, ?, ?)');
  snap.run(GP, dayFrom(-62), 3000, 20, null); snap.run(GP, dayFrom(-31), 3400, 24, null); snap.run(GP, dayFrom(-1), 3840, 26, 'stripe');
  const bill = db.prepare(`INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, verification)
                           VALUES (?, ${GP}, ?, ?, 'recurring', ?, 'manual', 'manual')`);
  let n = 0;
  for (const [customer, cents, ago_] of [['Acme', 100000, 3], ['Beta', 50000, 3], ['Acme', 120000, 2], ['Beta', 50000, 2],
    ['Acme', 140000, 1], ['Cyan', 30000, 1], ['Acme', 140000, 0], ['Cyan', 30000, 0]] as const) {
    bill.run(`e${n += 1}`, customer, cents, monthAgo(ago_));
  }
  await recomputeRevenueMovements(f.env, GP);
  // Team expansion: a roster, a plan and an open role with applicants.
  const person = db.prepare(`INSERT INTO company_people (uid, company_id, name, start_date, created_by) VALUES (?, 70, ?, ?, ${FOUNDER})`);
  person.run('p1', 'Fay', dayFrom(-200)); person.run('p2', 'Gus', dayFrom(-90)); person.run('p3', 'Hal', dayFrom(-20));
  const plan = db.prepare(`INSERT INTO company_headcount_plan (uid, company_id, period_label, target_headcount, updated_by) VALUES (?, 70, ?, ?, ${FOUNDER})`);
  plan.run('h1', monthAgo(1).slice(0, 7), 3); plan.run('h2', monthAgo(0).slice(0, 7), 4);
  db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status, team, target_start) VALUES (5, 'eng', ${FOUNDER}, ${GP}, 'Engineer', 'published', 'Engineering', '2027-01')`);
  db.exec(`INSERT INTO job_applications (id, posting_id, email) VALUES (1, 5, 'a@x.example'), (2, 5, 'b@x.example'), (3, 5, 'c@x.example')`);
  assert.equal((await growCall(f, 'PATCH', '/applications/1/stage', { project: GP, stage: 'interview' })).status, 200);
  // Partner network
  const np = await post('/partners', { name: 'Northwind', type: 'integration', stage: 'signed', terms: '20% rev share' });
  await post('/partners', { name: 'Globex', type: 'reseller', stage: 'terms' });
  await post(`PUT /partners/${np.uid}/revenue/${monthAgo(1).slice(0, 7)}`, { amount_cents: 80000 }, 200);
  await post(`PUT /partners/${np.uid}/revenue/${month}`, { amount_cents: 120000 }, 200);
  // Market expansion: one fully scored, one with a gap; one decided.
  const es = await post('/markets', { name: 'Spain', demand_score: 8, demand_source: 'Survey of 40 buyers', regulation_score: 6, regulation_source: 'Counsel memo',
    partners_score: 5, partners_source: 'Two resellers', cost_score: 4, cost_source: 'Agency quote' });
  assert.equal((await growCall(f, 'PATCH', `/markets/${es.uid}`, { project: GP, decision: 'enter' })).status, 200);
  await post('/markets', { name: 'France', demand_score: 7, demand_source: 'Waitlist by country' });
  // Durable company-building: obligations in the next 90 days and a ticked item.
  await post('/obligations', { title: 'Board meeting', kind: 'governance', due_at: dayFrom(10), owner_name: 'Fay' });
  await post('/obligations', { title: 'Annual filing', kind: 'compliance', due_at: dayFrom(40) });
  await post('/obligations', { title: 'Insurance renewal', kind: 'risk', due_at: dayFrom(70), owner_name: 'Gus' });
  await post('PUT /checklist/key_person_cover', { done: true }, 200);
  return f;
}

test('D661: the page lists Grow\'s modules as the Worker does, and adapts every one', () => {
  assert.deepEqual(PAGE_CYCLE_MODULES.grow.map((m: any) => [m.slug, m.name]), GROW_MODULES.map((m) => [m.slug, m.name]));
  for (const m of GROW_MODULES) {
    assert.equal(typeof (GROW_CARDS as any)[m.slug], 'function', `${m.slug} has no card adapter`);
    assert.ok((GROW_RECORDS as any)[m.slug], `${m.slug} has no records adapter`);
  }
});

test('D661: Grow\'s real read, seeded in every module: all seven cards are ok and each draws the canvas\'s charts', async () => {
  const f = await growSeeded();
  const r = await growCall(f, 'GET', `/overview?project=${GP}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.cards.map((c: any) => `${c.slug}=${c.state}`), GROW_MODULES.map((m) => `${m.slug}=ok`), 'every module seeded reads ok');
  const o = adaptOverview('grow', r.body);
  const kinds: Record<string, string[]> = {};
  for (const c of o.cards) {
    const view = cardView(c);
    assert.equal(view.state, 'ok', `${c.slug}: an ok card would read as ${view.state} (${view.reason})`);
    kinds[c.slug] = view.charts.map((s: any) => s.kind);
  }
  // The canvas's helper for each card (`D.Grow.cards`).
  assert.deepEqual(kinds, {
    'product-improvement': ['stack'],
    distribution: ['hbar', 'funnel', 'rows'],
    'revenue-and-traction': ['vstack', 'vbars', 'heat'],
    'team-expansion': ['line', 'funnel'],
    'partner-network': ['hbar', 'vbars'],
    'market-expansion': ['stack', 'rows'],
    'durable-company-building': ['timeline', 'progress'],
  });
  const card = (slug: string) => o.cards.find((c: any) => c.slug === slug);
  // Money is dollars, labelled as such; a missing step is not a bar.
  const cac = card('distribution').series[0];
  assert.equal(cac.unit, 'usd');
  assert.deepEqual(cac.items.map((i: any) => [i.label, i.value]), [['LinkedIn', 600], ['Search ads', 300]], 'CAC = spend / customers, in dollars');
  assert.deepEqual(card('distribution').series[2].items, [{ label: 'Visit', value: 'Not recorded: no page-visit store yet' }], 'visits are not recorded, and say why');
  assert.deepEqual(card('distribution').series[1].steps.map((s: any) => s.label), ['Sign-up', 'Paying']);
  const mrr = card('revenue-and-traction').series[0];
  assert.equal(mrr.rows.length, 3, 'three movement months');
  assert.deepEqual(mrr.rows[0], [0, 200], 'Acme grew by $200 in the first compared month');
  assert.ok(card('revenue-and-traction').series[1].values.some((v: any) => v === 500), 'Beta\'s $500 churn is drawn');
  assert.ok(card('revenue-and-traction').series[2].rows.every((row: any) => row.cells.every((v: any) => v == null || (v >= 0 && v <= 1))), 'retention is a share');
  assert.deepEqual(card('partner-network').series[0].items.map((i: any) => [i.label, i.value]), [['Talking', 0], ['Terms', 1], ['Signed', 1]]);
  assert.deepEqual(card('partner-network').series[1].values.slice(-2), [800, 1200], 'partner revenue in dollars, last two months');
  assert.deepEqual(card('market-expansion').series[1].items, [{ label: 'France', value: 'Regulation, Partners, Cost to enter not scored', tone: 'warn' }]);
  assert.equal(card('durable-company-building').series[0].steps.length, 3);
  assert.match(card('durable-company-building').series[1].items[0].label, /^Checklist · 1 of \d+$/);
  for (const fig of o.figures) {
    assert.ok(['usd', 'pct', 'score', 'of', 'count'].includes(fig.unit), `${fig.key}: unit ${fig.unit}`);
    if (fig.state === 'ok') assert.notEqual(figureValue(fig), null, `${fig.key} has a value the page cannot write`);
  }
  assert.equal(figureValue(o.figures.find((x: any) => x.key === 'mrr')), '$3,840', 'MRR is in dollars on the snapshot, written as such');
});

test('D661: every Grow table has a value source for each column, and its filter and sorts name real fields', async () => {
  const f = await growSeeded();
  for (const m of GROW_MODULES) {
    const r = await growCall(f, 'GET', `/modules/${m.slug}?project=${GP}`);
    assert.equal(r.status, 200, `${m.slug}: ${JSON.stringify(r.body)}`);
    const d = adaptModule('grow', m.slug, r.body);
    assert.equal(d.card.state, 'ok', m.slug);
    assert.equal(d.records.cols.length, r.body.records.cols.length, `${m.slug}: a column was dropped`);
    assert.ok(d.records.rows.length > 0, `${m.slug}: no seeded row`);
    for (const c of d.records.cols) {
      assert.ok(d.records.rows.some((row: any) => row.cells[c.key] != null), `${m.slug}: the "${c.label}" column has no value in any seeded row`);
    }
    assert.equal(new Set(d.records.rows.map((row: any) => String(row.id))).size, d.records.rows.length, `${m.slug}: row ids repeat`);
    // D664's records filter and sort on row fields; since D691 (#1697) the read sends the filters, and each applies.
    const raw = new Set(r.body.records.rows.flatMap((row: any) => Object.keys(row)));
    for (const fl of d.records.filters) {
      assert.ok(raw.has(fl.key), `${m.slug}: filter "${fl.key}" is not a field of the read's rows`);
      const v = fl.options[0].value;
      const narrowed = await growCall(f, 'GET', `/modules/${m.slug}?project=${GP}&filter=${encodeURIComponent(`${fl.key}:${v}`)}`);
      assert.ok(narrowed.body.records.rows.every((row: any) => String(row[fl.key]).toLowerCase() === String(v).toLowerCase()), `${m.slug}: filter ${fl.key}:${v} did not narrow`);
    }
    for (const s of d.records.sorts) assert.ok(raw.has(s.key.replace(/^-/, '')), `${m.slug}: sort "${s.key}" is not a field of the read's rows`);
  }
  // Each label's cell holds that label's value, not a neighbour's.
  const rowBy = async (slug: string, pick: (cells: Record<string, any>) => boolean) => {
    const d = adaptModule('grow', slug, (await growCall(f, 'GET', `/modules/${slug}?project=${GP}`)).body);
    const row = d.records.rows.find((x: any) => pick(x.cells));
    assert.ok(row, `${slug}: the seeded row is missing`);
    return Object.fromEntries(d.records.cols.map((c: any) => [c.label, row.cells[c.key]]));
  };
  assert.deepEqual(await rowBy('distribution', (c) => c.channel === 'LinkedIn'),
    { Channel: 'LinkedIn', State: { text: 'Active', tone: 'ok' }, 'Spend · 30 d': '$1,200 · typed', Customers: 2, CAC: '$600' });
  assert.deepEqual(await rowBy('product-improvement', (c) => c.feedback === 'Onboarding is long'),
    { Feedback: 'Onboarding is long', Source: 'Team', Theme: 'Onboarding', 'Roadmap item': 'Short onboarding', Status: { text: 'Shipped', tone: 'ok' } });
  assert.deepEqual(await rowBy('revenue-and-traction', (c) => c.kpi === 'MRR'),
    { KPI: 'MRR', Value: '$3,840', 'Change · 30 d': '▲ $440', Source: 'stripe', 'As of': dayFrom(-1) });
  assert.deepEqual(await rowBy('team-expansion', (c) => c.team === 'Engineering'),
    { Role: { text: 'Engineer', href: '/jobs/5/manage' }, Team: 'Engineering', Applicants: 3, 'In interview': 1, 'Target start': '2027-01' });
  assert.deepEqual(await rowBy('partner-network', (c) => c.partner === 'Northwind'),
    { Partner: 'Northwind', Type: 'Integration', Stage: { text: 'Signed', tone: 'ok' }, Terms: '20% rev share', 'Revenue sourced': '$2,000 · typed' });
  const spain = await rowBy('market-expansion', (c) => c.market === 'Spain');
  assert.deepEqual([spain.Readiness, spain['Weakest part'], spain.State], ['23 / 40', 'Cost to enter', 'Considering']);
  assert.match(String(spain.Decision), /^Enter · \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual((await rowBy('market-expansion', (c) => c.market === 'France')).Readiness,
    { text: 'Not recorded: Regulation, Partners, Cost to enter not scored', tone: 'muted' });
  assert.deepEqual(await rowBy('durable-company-building', (c) => c.obligation === 'Annual filing'),
    { Obligation: 'Annual filing', Kind: 'Compliance', Due: dayFrom(40), Owner: { text: 'No owner', tone: 'warn' }, State: { text: 'Upcoming', tone: 'v3' } });
  const durable = adaptModule('grow', 'durable-company-building', (await growCall(f, 'GET', `/modules/durable-company-building?project=${GP}`)).body);
  assert.ok(Array.isArray(durable.parts?.checklist) && durable.parts.checklist.some((i: any) => i.key === 'key_person_cover' && i.done), 'the checklist part comes through');
});

test('D661: an empty Grow venture draws nothing as 0, and a table that cannot be read says so', async () => {
  const f = await growFixture();
  const o = adaptOverview('grow', (await growCall(f, 'GET', `/overview?project=${GP}`)).body);
  for (const c of o.cards) assert.notEqual(cardView(c).state, 'ok', `${c.slug} drew from nothing`);
  for (const fig of o.figures) assert.equal(figureValue(fig), null, `${fig.key} is written from nothing`);
  f.db.exec('DROP TABLE growth_partners');
  const d = adaptModule('grow', 'partner-network', (await growCall(f, 'GET', `/modules/partner-network?project=${GP}`)).body);
  assert.equal(d.card.state, 'unreadable');
  assert.equal(d.records.state, 'unreadable');
  assert.match(d.records.reason, /could not be read/);
});

// ── Build (#1475, D662): already in D661's shape, so it passes through ─────

import cycleBuild from '../src/routes/cycle_build.ts';

const BP = 101;

/** The tables cycle_build_d662 builds its fixture from, plus migration 441. */
function buildFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0);
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', priority_reason TEXT, delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT, last_synced_at TEXT, last_error_at TEXT, config_json TEXT);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name) VALUES (${FOUNDER}, 'founder', 11, 'Fay');
    INSERT INTO projects(id, founder_id, company_id, entity_id) VALUES (${BP}, 11, 10, 501);
    INSERT INTO user_company_links VALUES (${FOUNDER}, 10);
    INSERT INTO entities VALUES (501, 'DE');
  `);
  db.exec(sqlOf('441_build_cycle_stores.sql'));
  db.exec(sqlOf('455_core_systems_workspace.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('461_build_record_stores.sql'));
  db.exec('CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY)');
  return db;
}

/** All six modules given real rows. */
function buildSeeded() {
  const db = buildFixture();
  const month = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 3)).toISOString().slice(0, 10); };
  db.exec(`
    INSERT INTO pain_groups(id, project_id, title) VALUES (1, ${BP}, 'Manual reconciliation');
    INSERT INTO hypotheses(id, project_id, claim) VALUES (1, ${BP}, 'Finance leads will pay to skip reconciliation');
    INSERT INTO mvp_features(id, project_id, title, pain_group_id, hypothesis_id, is_must_have, delivery_status, done_at, owner_user_id, due_date) VALUES
      (1, ${BP}, 'Bank sync', 1, 1, 1, 'Done', '${month(3)}', ${FOUNDER}, '${month(3)}'),
      (2, ${BP}, 'Match rules', 1, NULL, 1, 'Done', '${month(2)}', ${FOUNDER}, '${month(2)}'),
      (3, ${BP}, 'Exceptions queue', NULL, NULL, 1, 'Done', '${month(1)}', ${FOUNDER}, '${month(1)}'),
      (4, ${BP}, 'Audit export', NULL, NULL, 1, 'Backlog', NULL, NULL, NULL);
    UPDATE projects SET mvp_target_date = '${month(-2)}' WHERE id = ${BP};
    INSERT INTO venture_risks(project_id, title, severity, state, created_by) VALUES (${BP}, 'Bank API access', 'high', 'open', ${FOUNDER}), (${BP}, 'Hiring', 'low', 'open', ${FOUNDER});
    INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status, owner_user_id, target_date, kpi_key) VALUES
      (5, ${BP}, 'Self-serve onboarding', 'now', ${FOUNDER}, '${month(-1)}', 'activation'),
      (6, ${BP}, 'Second bank', 'next', NULL, NULL, NULL),
      (7, ${BP}, 'SOC 2', 'later', NULL, NULL, NULL),
      (8, ${BP}, 'Pilot shipped', 'done', ${FOUNDER}, '${month(1)}', 'pilots');
    INSERT INTO okr_column_moves(project_id, okr_id, to_status, moved_at) VALUES (${BP}, 8, 'done', '${month(1)} 10:00:00');
    INSERT INTO cap_table_holders(id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES
      (9, ${FOUNDER}, ${BP}, 'Fay', 6000, 60, 'CEO'), (10, 2, ${BP}, 'Gus', 4000, 40, 'CTO');
    INSERT INTO cap_table_vesting(user_id, holder_id, start_date, cliff_months, total_months, vested_shares) VALUES (${FOUNDER}, 9, '${month(6)}', 12, 48, 750);
    INSERT INTO formation_steps(project_id, title, due_date, state, created_by) VALUES (${BP}, 'File certificate', '${month(-1)}', 'doing', ${FOUNDER}), (${BP}, 'Get EIN', NULL, 'todo', ${FOUNDER});
    INSERT INTO entity_obligations(id, entity_id, title, due_date, status, kind) VALUES (1, 501, 'Delaware franchise tax', '${month(-4)}', 'open', 'tax');
    INSERT INTO integrations(id, user_id, provider_key, display_name, status, last_synced_at) VALUES (1, ${FOUNDER}, 'stripe', 'Stripe', 'active', '${month(0)}');
    INSERT INTO integration_companies VALUES (1, 10, 1);
    INSERT INTO project_core_systems(project_id, kind, integration_id, used_by, updated_by) VALUES (${BP}, 'crm', 1, 'Sales', ${FOUNDER});
    INSERT INTO ritual_runs(project_id, run_date, state) VALUES (${BP}, date('now', '-14 days'), 'done'), (${BP}, date('now', '-7 days'), 'skipped');
  `);
  return db;
}

const buildApp = new Hono<any>();
buildApp.route('/api/cycles/build', cycleBuild);
buildApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function buildCall(db: any, path: string) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await buildApp.request(`/api/cycles/build${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

test('D661: the page lists Build\'s modules as the Worker does', async () => {
  const r = await buildCall(buildFixture(), `/overview?project=${BP}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(PAGE_CYCLE_MODULES.build.map((m: any) => [m.slug, m.name]), r.body.cards.map((c: any) => [c.slug, c.name]));
});

test('D661: Build\'s real read passes through untouched, and all six seeded cards draw', async () => {
  for (const db of [buildFixture(), buildSeeded()]) {
    const r = await buildCall(db, `/overview?project=${BP}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = adaptOverview('build', r.body);
    assert.deepEqual(o.cards, r.body.cards, 'a read in D661\'s shape must pass through unchanged');
    for (const c of o.cards) {
      assert.ok((PAGE_STATES as string[]).includes(c.state), `${c.slug}: state ${c.state}`);
      assert.ok(Array.isArray(c.series) && c.series.every(isSpec), `${c.slug}: series is not a list of chart specs`);
    }
  }
  const seeded = adaptOverview('build', (await buildCall(buildSeeded(), `/overview?project=${BP}`)).body);
  assert.deepEqual(seeded.cards.map((c: any) => `${c.slug}=${cardView(c).state}`), PAGE_CYCLE_MODULES.build.map((m: any) => `${m.slug}=ok`),
    'every seeded Build card draws');
  for (const f of seeded.figures) if (f.state === 'ok') assert.notEqual(figureValue(f), null, `${f.key} has a value the page cannot write`);
  assert.equal(figureValue(seeded.figures.find((f: any) => f.key === 'must_haves_done')), '3 of 4');
});

test('D661: every Build module page\'s records are {key,label} columns and {id,cells} rows, each column filled', async () => {
  const db = buildSeeded();
  for (const m of PAGE_CYCLE_MODULES.build) {
    const r = await buildCall(db, `/modules/${m.slug}?project=${BP}`);
    assert.equal(r.status, 200, `${m.slug}: ${JSON.stringify(r.body)}`);
    const d = adaptModule('build', m.slug, r.body);
    assert.deepEqual(d.records, r.body.records, `${m.slug}: records changed on the way through`);
    const keys = d.records.cols.map((c: any) => c.key);
    assert.ok(keys.length > 0 && d.records.cols.every((c: any) => typeof c.key === 'string' && typeof c.label === 'string'), `${m.slug}: columns are not {key,label}`);
    assert.ok(d.records.rows.length > 0, `${m.slug}: no seeded row`);
    for (const row of d.records.rows) {
      assert.ok(row.id != null && row.cells && typeof row.cells === 'object', `${m.slug}: a row is not {id,cells}`);
      for (const k of Object.keys(row.cells)) assert.ok(keys.includes(k), `${m.slug}: a cell "${k}" has no column`);
    }
  }
});

// ── The Add forms (forms.js), through the real Worker routes ───────────────

import { EDITS, FORMS, editFor, formFor, initialValues, validate, toCents, toScore, thisMonth } from '../../frontend/src/pages/cycles/forms.js';
import { makeCycleWrites } from '../../frontend/src/lib/api/cycleWrites.js';
import progress from '../src/routes/progress.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

// MVP scope (`progress.ts`) adds the feature a must-have marks.
const progressApp = new Hono<any>();
progressApp.route('/api/progress', progress);
progressApp.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Forbidden' ? 403 : 500));

/** The app's `request`, answered by the Grow and Build routes on SQLite: a refusal throws like the app's does. */
function routeRequest(grow: any, buildDb: any) {
  return async (path: string, opts: any) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    let r: { status: number; body: any };
    if (path.startsWith('/cycles/grow/')) r = await growCall(grow, opts.method, path.slice('/cycles/grow'.length), body);
    else if (path.startsWith('/cycles/build/')) {
      const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res = await buildApp.request(`/api${path}`, { method: opts.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: opts.body },
        { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(buildDb) } as any);
      r = { status: res.status, body: await res.json().catch(() => null) };
    } else if (path.startsWith('/progress/')) {
      const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res = await progressApp.request(`/api${path}`, { method: opts.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: opts.body },
        { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(buildDb) } as any);
      r = { status: res.status, body: await res.json().catch(() => null) };
    } else throw new Error(`no route for ${path}`);
    if (r.status >= 400) { const e: any = new Error(r.body?.detail || `HTTP ${r.status}`); e.status = r.status; e.field = r.body?.field ?? null; throw e; }
    return r.body;
  };
}

// D695 (#1657): Grow's canvas forms. A form's values are text, or a list for a CK field.
const SAMPLES: Record<string, Record<string, Record<string, unknown>>> = {
  grow: {
    'product-improvement': { body: 'Needs single sign-on', source: 'customer', from_name: 'Ana', from_company: 'Acme Test', theme_choice: 'new', theme: 'Security', from_email: 'ana@x.example' },
    distribution: { kind: 'paid_social', name: 'Podcasts', state: 'testing', spend: '1,250.50', bar: '200' },
    'revenue-and-traction': { kpi: 'mrr', value: '38,400', as_of: dayFrom(0), note: 'Typed from the bank statement' },
    'team-expansion': { title: 'Founding engineer', team: 'Engineering', type: 'fractional', target_start: dayFrom(60), band: '90,000–120,000', equity: '0.5', post_to: [] },
    'partner-network': { name: 'Initech', type: 'agency', stage: 'terms', terms_kind: 'rev_share', amount: '20%' },
    'market-expansion': { name: 'Portugal', state: 'considering', parts: ['demand'], demand_score: '7', demand_source: 'Waitlist by country' },
    'durable-company-building': { title: 'Annual report', kind: 'compliance', due_at: dayFrom(20), owner_name: 'Fay' },
  },
};
// Build's canvas forms (D695 #1656 PR 3b) need #1792's stores, so their bodies,
// choices and Edits run in `cycle_forms_d695.test.ts`, on the baseline plus
// every migration, through the same routes.

test('D661: every Add form sends a body its Worker route accepts, and the row reads back on the module\'s table', async () => {
  const grow = await growFixture();
  const buildDb = buildFixture();
  const w = makeCycleWrites(routeRequest(grow, buildDb));
  const now = new Date();
  for (const cycle of ['grow'] as const) {
    for (const slug of Object.keys(FORMS[cycle])) {
      const form = formFor(cycle, slug)!;
      const values = { ...initialValues(form), ...SAMPLES[cycle][slug] };
      assert.deepEqual(validate(form, values), {}, `${cycle}/${slug}: the sample is valid`);
      await form.submit(w, GP, values, now);
    }
  }
  const growRow = async (slug: string, pick: (r: any) => boolean) => {
    const r = await growCall(grow, 'GET', `/modules/${slug}?project=${GP}`);
    return r.body.records.rows.find(pick);
  };
  assert.deepEqual(Object.fromEntries(Object.entries(await growRow('product-improvement', (r) => r.body === 'Needs single sign-on')).filter(([k]) => ['source', 'theme', 'status'].includes(k))),
    { source: 'customer', theme: 'Security', status: 'open' });
  assert.deepEqual({ ...grow.db.prepare('SELECT from_company, from_email, notify_on_ship FROM product_feedback WHERE body = ?').get('Needs single sign-on') as any },
    { from_company: 'Acme Test', from_email: 'ana@x.example', notify_on_ship: 1 }, 'Tell them when it ships is checked, so their email is kept');
  const podcasts = await growRow('distribution', (r) => r.name === 'Podcasts');
  assert.deepEqual([podcasts.utm_source, podcasts.state, podcasts.spend_cents, podcasts.spend_source], ['podcasts', 'testing', 125050, 'manual'], 'the UTM source from the name, and dollars to cents this month, in the one POST');
  assert.deepEqual({ ...grow.db.prepare("SELECT kind, cac_bar_cents, bar_currency FROM growth_channels WHERE name = 'Podcasts'").get() as any }, { kind: 'paid_social', cac_bar_cents: 20000, bar_currency: 'usd' });
  assert.deepEqual({ ...grow.db.prepare('SELECT mrr, source, notes FROM project_metrics WHERE project_id = ? AND snapshot_date = ?').get(GP, dayFrom(0)) as any },
    { mrr: 38400, source: 'manual', notes: 'Typed from the bank statement' }, 'MRR in US dollars, as a hand entry');
  assert.deepEqual({ ...grow.db.prepare("SELECT team, employment_type, comp_min_cents, comp_max_cents, comp_currency, equity_pct, status FROM job_postings WHERE title = 'Founding engineer'").get() as any },
    { team: 'Engineering', employment_type: 'fractional', comp_min_cents: 9000000, comp_max_cents: 12000000, comp_currency: 'usd', equity_pct: 0.5, status: 'draft' });
  const initech = await growRow('partner-network', (r) => r.name === 'Initech');
  assert.deepEqual([initech.type, initech.stage], ['agency', 'terms']);
  assert.deepEqual({ ...grow.db.prepare("SELECT terms_kind, terms_pct, terms_amount_cents, terms_currency FROM growth_partners WHERE name = 'Initech'").get() as any },
    { terms_kind: 'rev_share', terms_pct: 20, terms_amount_cents: null, terms_currency: null }, 'a percentage, and no currency without an amount');
  const portugal = await growRow('market-expansion', (r) => r.name === 'Portugal');
  assert.deepEqual([portugal.demand_score, portugal.demand_source, portugal.regulation_score, portugal.readiness], [7, 'Waitlist by country', null, null], 'an unscored part stays null, never 0');
  const annual = await growRow('durable-company-building', (r) => r.title === 'Annual report');
  assert.deepEqual([annual.kind, annual.owner_name, annual.status, String(annual.due_at).slice(0, 10)], ['compliance', 'Fay', 'upcoming', dayFrom(20)]);
  // The checklist tick, and its undo.
  await w.grow.checklist(GP, 'board_cadence', true);
  let parts = (await growCall(grow, 'GET', `/modules/durable-company-building?project=${GP}`)).body.parts.checklist;
  assert.deepEqual(parts.find((i: any) => i.key === 'board_cadence').source, 'manual');
  await w.grow.checklist(GP, 'board_cadence', false);
  parts = (await growCall(grow, 'GET', `/modules/durable-company-building?project=${GP}`)).body.parts.checklist;
  assert.equal(parts.find((i: any) => i.key === 'board_cadence').done, false);
  assert.equal(thisMonth(now), now.toISOString().slice(0, 7));
});

test('D661: every choice a form offers is one its Worker route accepts', async () => {
  const grow = await growFixture();
  const buildDb = buildFixture();
  const w = makeCycleWrites(routeRequest(grow, buildDb));
  let n = 0;
  for (const cycle of ['grow'] as const) {
    for (const slug of Object.keys(FORMS[cycle])) {
      const form = formFor(cycle, slug)!;
      // Today's selects and the canvas's CH chips (D695): a disabled chip is never sent.
      for (const field of form.fields.filter((f: any) => f.type === 'select' || f.kind === 'CH')) {
        for (const option of (field.options ?? field.opts).filter((o: any) => !o.disabled)) {
          n += 1;
          // Unique names, so a channel's derived UTM source, a market's name or an obligation's date never collides.
          const values = { ...initialValues(form), ...SAMPLES[cycle][slug], [field.name]: option.value,
            ...(slug === 'distribution' ? { name: `Channel ${n}`, spend: '' } : {}), ...(slug === 'market-expansion' ? { name: `Market ${n}` } : {}),
            ...(slug === 'revenue-and-traction' ? { label: `Custom ${n}`, value: '12' } : {}),
            ...(slug === 'durable-company-building' ? { due_at: new Date(Date.UTC(2099, 0, n)).toISOString().slice(0, 10) } : {}) };
          await assert.doesNotReject(form.submit(w, GP, values), `${cycle}/${slug}: ${field.name}=${option.value} was refused`);
        }
      }
    }
  }
  // Grow's choices; Build's moved to cycle_forms_d695.test.ts with its canvas forms (#1656 PR 3b).
  assert.ok(n >= 57, `${n} choices checked`);
});

test('D661: the forms refuse what the Worker would, and show the Worker\'s own sentence on its field', async () => {
  const market = formFor('grow', 'market-expansion');
  assert.deepEqual(validate(market, { ...initialValues(market), name: 'Spain', parts: ['regulation'], regulation_score: '6' }),
    { regulation_source: 'The regulation score needs its source.' }, 'a score needs its source');
  assert.match(validate(market, { ...initialValues(market), name: 'Spain', parts: ['cost'], cost_score: '11', cost_source: 'x' }).cost_score, /0 to 10/);
  const channel = formFor('grow', 'distribution');
  assert.deepEqual(Object.keys(validate(channel, initialValues(channel))).sort(), ['name'], 'required fields: no UTM source is typed (#1697 derives it)');
  assert.match(validate(channel, { ...initialValues(channel), name: 'X', spend: 'lots' }).spend, /US dollars/);
  const obligation = formFor('grow', 'durable-company-building');
  assert.equal(validate(obligation, { ...initialValues(obligation), title: 'Board meeting' }).due_at, 'Due is required.', 'the route refuses an obligation without a date');
  assert.deepEqual([toCents('1,250.50'), toCents(''), toCents('-3')], [125050, null, Number.NaN]);
  assert.deepEqual([toScore('7'), toScore(''), toScore('7.5'), toScore('11')], [7, null, Number.NaN, Number.NaN]);
  for (const slug of ['constructor', 'toString', '__proto__']) assert.equal(formFor('grow', slug), null, `${slug} reached an inherited value`);
  assert.equal(formFor('constructor', 'x'), null);
  // A refusal the form cannot foresee: the Worker's sentence, on the field it names.
  const grow = await growFixture();
  const w = makeCycleWrites(routeRequest(grow, buildFixture()));
  // A second channel of the same name gets a suffixed UTM source, never a clash (#1697).
  const values = { ...initialValues(channel), name: 'LinkedIn' };
  assert.equal((await channel.submit(w, GP, values)).utm_source, 'linkedin');
  assert.equal((await channel.submit(w, GP, values)).utm_source, 'linkedin-2');
  const due = { ...initialValues(obligation), title: 'Board meeting', kind: 'governance', due_at: dayFrom(9) };
  await obligation.submit(w, GP, due);
  await assert.rejects(obligation.submit(w, GP, due), (e: any) => e.status === 409 && e.field === 'due_at' && /already due on/.test(e.message));
});

// ── Edit a row (forms.js EDITS), through the real Worker routes ────────────

/** What each Grow edit changes, on the row its Add form made. */
const EDITED: Record<string, Record<string, string>> = {
  'product-improvement': { status: 'shipped', theme: 'Identity', roadmap_item_label: '' },
  distribution: { name: 'Podcasts (paused)', state: 'paused' },
  // A KPI keeps its history: Enter by hand posts a new value for the row's KPI.
  'revenue-and-traction': { value: '40,000', as_of: dayFrom(0) },
  'team-expansion': { team: 'Product' },
  'partner-network': { stage: 'signed', type: 'reseller', terms: 'Net 30' },
  'market-expansion': { decision: 'enter', regulation_score: '5', regulation_source: 'Counsel memo' },
  'durable-company-building': { status: 'done', owner_name: 'Gus', due_at: dayFrom(5) },
};

test('D661: every Grow Edit form starts from its row, and the change reads back with nothing else moved', async () => {
  const grow = await growFixture();
  const w = makeCycleWrites(routeRequest(grow, buildFixture()));
  const now = new Date();
  for (const slug of Object.keys(FORMS.grow)) {
    const form = formFor('grow', slug)!;
    await form.submit(w, GP, { ...initialValues(form), ...SAMPLES.grow[slug] }, now);
  }
  const read = async (slug: string) => (await growCall(grow, 'GET', `/modules/${slug}?project=${GP}`)).body;
  assert.deepEqual(Object.keys(EDITED).sort(), Object.keys(EDITS.grow).sort(), 'a Grow Edit form has no case here');
  for (const [slug, change] of Object.entries(EDITED)) {
    const edit = editFor('grow', slug);
    const rows = adaptModule('grow', slug, await read(slug)).records.rows;
    const row = rows.find((r: any) => edit.idOf(r) != null);
    assert.ok(row, `${slug}: no row offers Edit`);
    const current = initialValues(edit, edit.valuesOf(row));
    if (slug === 'revenue-and-traction') assert.deepEqual(Object.keys(validate(edit, current)).sort(), ['as_of', 'value'], 'a new value is typed');
    else assert.deepEqual(validate(edit, current), {}, `${slug}: the row's own values do not pass its form`);
    await edit.submit(w, GP, edit.idOf(row), { ...current, ...change });
  }
  const raw = async (slug: string) => (await read(slug)).records.rows[0];
  const fb = await raw('product-improvement');
  assert.deepEqual([fb.status, fb.theme, fb.roadmap_item_label, fb.body, fb.source], ['shipped', 'Identity', null, 'Needs single sign-on', 'customer'],
    'an emptied field is cleared, and what the form does not hold is left as logged');
  const ch = await raw('distribution');
  assert.deepEqual([ch.name, ch.state, ch.utm_source, ch.spend_cents], ['Podcasts (paused)', 'paused', 'podcasts', 125050], 'a spend not typed is not rewritten');
  assert.deepEqual({ ...grow.db.prepare("SELECT kind, cac_bar_cents FROM growth_channels WHERE utm_source = 'podcasts'").get() as any }, { kind: 'paid_social', cac_bar_cents: 20000 }, 'a field the row does not carry is left as it was');
  assert.equal((grow.db.prepare('SELECT mrr FROM project_metrics WHERE project_id = ? AND snapshot_date = ? AND source = ?').get(GP, dayFrom(0), 'manual') as any).mrr, 40000);
  assert.deepEqual({ ...grow.db.prepare("SELECT title, team, employment_type, comp_min_cents FROM job_postings WHERE title = 'Founding engineer'").get() as any },
    { title: 'Founding engineer', team: 'Product', employment_type: 'fractional', comp_min_cents: 9000000 }, 'only the team is sent');
  const pa = await raw('partner-network');
  assert.deepEqual([pa.name, pa.type, pa.stage], ['Initech', 'reseller', 'signed']);
  assert.deepEqual({ ...grow.db.prepare("SELECT terms, terms_kind, terms_pct FROM growth_partners WHERE name = 'Initech'").get() as any },
    { terms: 'Net 30', terms_kind: 'rev_share', terms_pct: 20 }, 'the notes change; the terms the Edit did not touch stay');
  const mk = await raw('market-expansion');
  assert.deepEqual([mk.decision, mk.demand_score, mk.demand_source, mk.regulation_score, mk.regulation_source, mk.partners_score],
    ['enter', 7, 'Waitlist by country', 5, 'Counsel memo', null], 'a scored part keeps its score; an unscored one stays null');
  const ob = await raw('durable-company-building');
  assert.deepEqual([ob.title, ob.status, ob.owner_name, String(ob.due_at).slice(0, 10)], ['Annual report', 'done', 'Gus', dayFrom(5)]);
});

// Build's Edits (D695 #1656 PR 3b) open from their records; `cycle_forms_d695.test.ts` runs them.

test('D661: an Edit is refused for a row the venture does not hold, and the slug never reaches an inherited form', async () => {
  const grow = await growFixture();
  const buildDb = buildSeeded();
  const w = makeCycleWrites(routeRequest(grow, buildDb));
  const channel = editFor('grow', 'distribution');
  await assert.rejects(channel.submit(w, GP, 'no-such-uid', { name: 'X', state: 'active' }), (e: any) => e.status === 404);
  const step = editFor('build', 'company-creation');
  await assert.rejects(step.submit(w, BP, 9999, { title: 'X', due_date: '', state: 'todo' }), (e: any) => e.status === 404);
  for (const slug of ['constructor', 'toString', '__proto__']) assert.equal(editFor('grow', slug), null);
  assert.equal(editFor('constructor', 'x'), null);
  // A Grow row the read gave no store id offers no Edit: the adapter gives it no `edit`.
  const read = { module: 'distribution', card: null, records: { cols: ['Channel', 'State', 'Spend · 30 d', 'Customers', 'CAC'],
    rows: [{ name: 'No id', state: 'active' }, { uid: 'g1', name: 'Has id', state: 'paused' }], total: 2, page: 1, page_size: 25 } };
  const rows = adaptModule('grow', 'distribution', read).records.rows;
  assert.deepEqual(rows.map((r: any) => [r.edit, channel.idOf(r)]), [[null, null], [{ uid: 'g1', name: 'Has id', state: 'paused' }, 'g1']]);
});

// ── #1523: Eadwyn's mark on accepted hypotheses, on Experiments (D424 §3) ──

test('#1523: Experiments marks each claim through the real route and the adapter: Eadwyn, Eadwyn edited, the founder\'s own', async () => {
  const db = await seeded();
  const r = await call(db, 'GET', `/modules/experiments?project=${P}&sort=code`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.records.fills_recorded, true);
  assert.deepEqual(r.body.records.rows.map((x: any) => [x.hypothesis, x.provenance]), [
    ['H1 · Fleets pay', 'eadwyn'], ['H2 · Drivers text', 'eadwyn_edited'], ['H3 · Owners decide', null],
  ]);
  const d = adaptModule('validate', 'experiments', r.body);
  assert.equal(d.records.cols.at(-1).key, 'source');
  assert.deepEqual(d.records.rows.map((x: any) => x.cells.source), [
    { text: 'Proposed by Eadwyn', tone: 'v1' },
    { text: 'Proposed by Eadwyn · you edited it', tone: 'v2' },
    null,
  ]);
});

test('#1523: a claim rewritten by hand since Eadwyn proposed it is the founder\'s own, with no mark', async () => {
  const db = await seeded();
  db.exec(`UPDATE hypotheses SET claim = 'Fleets pay monthly' WHERE id = 1`);
  const r = await call(db, 'GET', `/modules/experiments?project=${P}&sort=code`);
  assert.equal(r.body.records.rows[0].provenance, null, 'Eadwyn\'s mark stayed over the founder\'s own sentence');
});

test('#1523: a failed provenance read keeps every hypothesis and says the marks could not be read', async () => {
  const db = await seeded();
  const real = d1Over(db);
  const failing = new Proxy(real, {
    get(target: any, prop: string) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (/FROM fill_provenance/.test(sql)) throw new Error('fill_provenance unreadable');
          return target.prepare(sql);
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const r = await call(db, 'GET', `/modules/experiments?project=${P}&sort=code`, undefined, failing);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.records.state, undefined, 'a failed mark read cost the whole table');
  assert.equal(r.body.records.fills_recorded, false);
  assert.equal(r.body.records.rows.length, 3, 'a hypothesis went missing when its mark could not be read');
  assert.ok(r.body.records.rows.every((x: any) => x.provenance === 'unreadable'), 'a failed read passed for "typed by hand"');
  const d = adaptModule('validate', 'experiments', r.body);
  assert.ok(d.records.rows.every((x: any) => x.cells.source?.text === 'Unreadable' && x.cells.source?.tone === 'muted'));
});

test('#1523: the board and the cycle read share one provenance reader', () => {
  const board = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/founder_validate.ts'), 'utf8');
  const cycle = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/cycleValidate.ts'), 'utf8');
  assert.match(board, /import \{[^}]*\bclaimFills\b[^}]*\} from '\.\.\/services\/fills\/provenance'/);
  assert.match(cycle, /import \{ claimFills \} from '\.\/fills\/provenance'/);
  for (const src of [board, cycle]) assert.doesNotMatch(src, /FROM fill_provenance/, 'a second copy of the provenance query');
});
