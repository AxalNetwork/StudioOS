/**
 * D4586 part 3 (#4586) — claim status on methodology v2, through the shipped Validate read.
 *
 * The Hypotheses list, its stats and a claim's record take their status from `claimsOf` → `verdictFor`, which now
 * reads `claimStatusV2`: contradiction before the bar, Contested, and Unknown only when a missing fit could change
 * the answer. Support, contradiction, unknown fit and breadth travel together. The verdict history records the
 * methodology version, and a claim moved only because the method changed is marked so, never read as new evidence.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/claim_status_v2_4586.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { claimsOf, statusOf } from '../src/services/cycleValidate.ts';
import { movedWithin, recordVerdictChanges } from '../src/services/verdictHistory.ts';
import { claimBreadth, claimSupport } from '../src/services/records/validate.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const KEY = ['fixture', 'key', 'for', 'd4586', 'claims'].join('-');
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const MIGRATION = '202611092033_verdict_history_methodology.sql';
const FOUNDER = 10;
const P = 1;
const DISPATCH = 500; const BILLING = 501;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validate_proposals',
    'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  // Migration 255 only: the read's bootstrap must add this slice's two columns to a table that predates them.
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  for (const m of ['440_validate_cycle_stores.sql', '438_interview_sessions.sql', '447_assistant_interviews.sql',
    '453_interview_processing.sql', '459_cycle_activity_convention.sql', '460_validate_record_stores.sql']) db.exec(sqlOf(m));
  applySessionTranslationColumns(db);
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)')
    .run(FOUNDER, 'founder', 'Fern Founder', 'fern@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Quillworks', 1001)`);
  for (const [id, title] of [[DISPATCH, 'Dispatch'], [BILLING, 'Billing']] as const) {
    db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?, ?, ?)').run(id, P, title);
    db.prepare('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, ?, ?, ?)').run(P, id, title.toLowerCase(), title);
  }
  return db;
}

async function get(db: DatabaseSync, path: string) {
  const app = new Hono<any>();
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const list = (db: DatabaseSync, query = '') => get(db, `/modules/experiments?project=${P}${query}`);

let seq = 0;
function interview(db: DatabaseSync, pains: string[], fit: string | null, o: { name?: string | null; company?: string | null } = {}) {
  seq += 1;
  db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interview_date, pains_json, icp_fit)
    VALUES (?, ?, ?, date('now'), ?, ?)`).run(P, o.name === undefined ? `Person ${seq}` : o.name, o.company === undefined ? `Org ${seq}` : o.company, JSON.stringify(pains), fit);
}
function claim(db: DatabaseSync, id: number, code: string) {
  db.prepare('INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, P, code, `Claim ${code}`, id);
  db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'supports')").run(id, DISPATCH);
  db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'contradicts')").run(id, BILLING);
}
/** `n` strong-fit supporters and `c` contradictors (no fit recorded: anyone can contradict). */
function evidence(db: DatabaseSync, s: number, c: number) {
  for (let i = 0; i < s; i += 1) interview(db, ['Dispatch'], 'strong');
  for (let i = 0; i < c; i += 1) interview(db, ['Billing'], 'none');
}
const history = (db: DatabaseSync) => db.prepare('SELECT hypothesis_id, verdict, lane, methodology_version, method_change FROM hypothesis_verdict_history ORDER BY id').all().map((r: any) => ({ ...r })) as any[];
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const COUNTS = ['status', 'supporting', 'contradicting', 'fit_unrecorded', 'both', 'interviews'];

test('5 supporting and 3 contradicting is Contested on the shipped list, with every count beside it', async () => {
  // Mutations checked: contradiction read after the bar (5/3 reads supported); statusOf without its contested branch
  // (reads not_recorded); the stats without `contested`; the experiments row without the v2 counts.
  const db = fixture();
  claim(db, 1, 'H1');
  evidence(db, 5, 3);
  const r = await list(db);
  assert.equal(r.status, 200);
  assert.deepEqual(pick(r.body.records.rows[0], COUNTS),
    { status: 'contested', supporting: 5, contradicting: 3, fit_unrecorded: 0, both: 0, interviews: 8 });
  assert.equal(r.body.parts.stats.contested, 1);
  assert.equal(r.body.parts.stats.supported, 0, 'v1 called this Supported');
  assert.deepEqual(r.body.parts.fit_gap, [], 'a contested claim is past its bar: no distance to show');
  const f = await list(db, '&filter=status:contested');
  assert.deepEqual(f.body.records.rows.map((x: any) => x.id), [1]);
});

test('5 supporting against 6 or 50 contradicting is Refuted, never Supported', async () => {
  // Mutations checked: contradiction read after the bar.
  for (const c of [6, 50]) {
    const db = fixture();
    claim(db, 1, 'H1');
    evidence(db, 5, c);
    const row = (await list(db)).body.records.rows[0];
    assert.deepEqual(pick(row, ['status', 'supporting', 'contradicting']), { status: 'refuted', supporting: 5, contradicting: c }, `5/${c}`);
  }
});

test('an unrecorded fit makes the status unknown only when it could change it', async () => {
  // Mutations checked: unknown whenever any fit is missing (2/0/1 would read Fit not recorded).
  const db = fixture();
  claim(db, 1, 'H1');
  // 4 supporters + 1 of unrecorded fit: that one could reach the bar, so the status is unknown (Fit not recorded).
  evidence(db, 4, 0);
  interview(db, ['Dispatch'], null);
  const rows = (await list(db)).body.records.rows;
  assert.equal(rows[0].status, 'not_recorded');
  assert.equal(rows[0].fit_unrecorded, 1);
  // The same rule on rows, without the route: 2 ICP + 1 unknown can never reach 5, so the status stands.
  const hyps = [{ id: 7, code: 'H7', claim: 'x', sort_order: 1, retired_at: null, sprint: null, owner_user_id: null, owner_name: null, inconclusive_at: null, updated_at: null }];
  const links = [{ id: 1, hypothesis_id: 7, pain_group_id: 9, direction: 'supports', strength: null }];
  const ivs = [
    ...['strong', 'partial', null].map((fit, i) => ({ id: i + 1, interviewee_name: `P${i}`, interviewee_company: 'Acme', icp_fit: fit, pains_json: '["Theme"]' })),
  ];
  const model = { aliasByNorm: new Map([['theme', 9]]), groups: [] } as any;
  const [c] = claimsOf(hyps as any, links as any, ivs as any, model);
  assert.deepEqual(pick(c, ['status', 'supporting', 'fit_unrecorded', 'interviews', 'interviewees', 'organizations']),
    { status: 'testing', supporting: 2, fit_unrecorded: 1, interviews: 3, interviewees: 3, organizations: 1 });
});

test('an interview touching both directions is in both counts and counted once as an interview', async () => {
  // Mutations checked: `both` not counted; `interviews` as supporting + contradicting.
  const db = fixture();
  claim(db, 1, 'H1');
  interview(db, ['Dispatch', 'Billing'], 'strong');
  interview(db, ['Dispatch'], 'strong');
  const row = (await list(db)).body.records.rows[0];
  assert.deepEqual(pick(row, COUNTS), { status: 'testing', supporting: 2, contradicting: 1, fit_unrecorded: 0, both: 1, interviews: 2 });
});

test('the claim record\'s Interview support says support, contradiction and breadth together; a missing company is "not recorded"', () => {
  // The record's fact is `claimSupport` + `claimBreadth` over the same `claimsOf` row the list uses
  // (cycle_records_validate_d690 pins the fact on the route and the canvas's four facts).
  // Mutations checked: breadth over only the interviews with a company (would read "1 organization");
  // names not folded (would read "3 interviewees").
  const hyps = [{ id: 1, code: 'H1', claim: 'x', sort_order: 1, retired_at: null, sprint: null, owner_user_id: null, owner_name: null, inconclusive_at: null, updated_at: null }];
  const links = [
    { id: 1, hypothesis_id: 1, pain_group_id: DISPATCH, direction: 'supports', strength: null },
    { id: 2, hypothesis_id: 1, pain_group_id: BILLING, direction: 'contradicts', strength: null },
  ];
  const model = { aliasByNorm: new Map([['dispatch', DISPATCH], ['billing', BILLING]]), groups: [] } as any;
  const ivs = [
    { id: 1, interviewee_name: 'Ada', interviewee_company: 'Acme', icp_fit: 'strong', pains_json: '["Dispatch"]' },
    { id: 2, interviewee_name: ' ada ', interviewee_company: 'ACME', icp_fit: 'strong', pains_json: '["Dispatch"]' },
    { id: 3, interviewee_name: 'Bo', interviewee_company: null, icp_fit: 'none', pains_json: '["Billing"]' },
    { id: 4, interviewee_name: 'Cy', interviewee_company: 'Initech', icp_fit: null, pains_json: '["Dispatch", "Billing"]' },
  ];
  const [c] = claimsOf(hyps as any, links as any, ivs as any, model);
  assert.equal(claimSupport(c), '2 for · 2 against · 1 fit not recorded · 1 in both');
  assert.equal(claimBreadth(c), '4 interviews · 3 interviewees · organizations not recorded');
  ivs[2].interviewee_company = 'Hooli';
  const [d] = claimsOf(hyps as any, links as any, ivs as any, model);
  assert.equal(claimBreadth(d), '4 interviews · 3 interviewees · 3 organizations');
  assert.equal(claimBreadth({ ...d, interviews: 0, interviewees: 0, organizations: 0 }), '0 interviews');
});

test('history: a claim moved only by the method is recorded as v2 and marked a method change', async () => {
  // Mutations checked: method_change always 0; methodology_version not written; movedWithin ignoring the mark
  // (the row would read "recent"); the v1 comparison against the v2 state (would never mark).
  const db = fixture();
  claim(db, 1, 'H1');
  evidence(db, 5, 3);
  // What the v1 board recorded for this same evidence yesterday.
  db.prepare("INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane, observed_at) VALUES (?, 1, 'validated', 'validated', datetime('now', '-1 day'))").run(P);
  const r = await list(db);
  assert.deepEqual(history(db), [
    { hypothesis_id: 1, verdict: 'validated', lane: 'validated', methodology_version: null, method_change: 0 },
    { hypothesis_id: 1, verdict: 'contested', lane: 'testing', methodology_version: 2, method_change: 1 },
  ], 'the v1 row is kept as it was; the new row is v2 and says why it was written');
  assert.equal(r.body.records.rows[0].moved, 'method');
  // A second read writes nothing.
  await list(db);
  assert.equal(history(db).length, 2);
});

test('history: when the evidence moved too, the row is new evidence, not a method change', async () => {
  const db = fixture();
  claim(db, 1, 'H1');
  evidence(db, 5, 3);
  // v1 last saw this claim below the bar: the new supporters are new evidence, whatever the method.
  db.prepare("INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane, observed_at) VALUES (?, 1, 'unproven', 'testing', datetime('now', '-1 day'))").run(P);
  const r = await list(db);
  assert.deepEqual(history(db).at(-1), { hypothesis_id: 1, verdict: 'contested', lane: 'testing', methodology_version: 2, method_change: 0 });
  // The lane did not move (testing → testing), so this claim is not "recently moved" at all.
  assert.equal(r.body.records.rows[0].moved, null);
});

test('movedWithin: evidence moves win over method moves; a method-only window reads "method"', () => {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const o = (id: number, lane: string, at: string, method = false) => ({ id, hypothesis_id: 1, verdict: null, lane, observed_at: at, methodology_version: 2, method_change: method });
  assert.equal(movedWithin([o(1, 'validated', day(20)), o(2, 'testing', day(2), true)], since), 'method');
  assert.equal(movedWithin([o(1, 'none', day(20)), o(2, 'validated', day(5)), o(3, 'testing', day(2), true)], since), 'recent');
  assert.equal(movedWithin([o(1, 'testing', day(20))], since), null, 'a first observation is never a move');
});

test('statusOf reads a stored contested verdict as Contested, above the founder\'s Inconclusive mark', () => {
  assert.equal(statusOf('contested', 'testing', false), 'contested');
  assert.equal(statusOf('contested', 'testing', true), 'contested');
  assert.equal(statusOf('validated', 'validated', true), 'supported');
});

test('the migration adds both columns with ALTER, and the runtime bootstrap mirrors them', async () => {
  const sql = sqlOf(MIGRATION);
  assert.match(sql, /ALTER TABLE hypothesis_verdict_history ADD COLUMN methodology_version INTEGER;/);
  assert.match(sql, /ALTER TABLE hypothesis_verdict_history ADD COLUMN method_change INTEGER NOT NULL DEFAULT 0;/);
  // Applied after 255, the table carries both and an old row keeps NULL (v1).
  const db = new DatabaseSync(':memory:');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec("INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane) VALUES (1, 1, 'validated', 'validated')");
  db.exec(sql);
  assert.deepEqual(pick(db.prepare('SELECT * FROM hypothesis_verdict_history').get(), ['methodology_version', 'method_change']),
    { methodology_version: null, method_change: 0 });
  // The bootstrap on a migrated table adds nothing and writes v2.
  const env = { DB: d1Over(db) } as any;
  assert.equal(await recordVerdictChanges(env, 1, [{ hypothesis_id: 1, verdict: 'contested', lane: 'testing', v1: { verdict: 'validated', lane: 'validated' } }]), 1);
  assert.deepEqual(pick(db.prepare('SELECT * FROM hypothesis_verdict_history ORDER BY id DESC').get(), ['methodology_version', 'method_change']),
    { methodology_version: 2, method_change: 1 });
});
