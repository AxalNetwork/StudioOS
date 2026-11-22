/**
 * D6006 (#6006, part 1): Problem discovery's Worker side for the Validate v2 Discovery canvas (V17 to V20).
 * The ranked list says each theme's rank and why, who said it beside how often, and the claims it supports and
 * contradicts; the theme record carries a problem statement and says "used on slide" cannot be answered; several
 * quotes are assigned in one step. A reader without write access never reads a quote said without consent.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/problem_discovery_6006.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import progress, { MAX_BULK_ASSIGN } from '../src/routes/progress.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { USED_ON_SLIDE_UNAVAILABLE } from '../src/services/records/validate.ts';
import { QUOTE_WITHHELD, rankReason, type Theme } from '../src/services/cycleValidate.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (name: string) => readFileSync(resolve('cloudflare-worker/sql/migrations', name), 'utf8');
const KEY = ['fixture', 'key', 'for', 'd6006', 'tests'].join('-');
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
  db.exec(migration('202611220319_6007_segment_primary_profile.sql')); // D6007: the primary ICP columns the segment readers select.
  db.exec(migration('438_interview_sessions.sql'));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec(migration('447_assistant_interviews.sql'));
  db.exec(migration('453_interview_processing.sql'));
  db.exec(migration('531_meeting_bots.sql'));
  db.exec(migration('459_cycle_activity_convention.sql'));
  // D690 (#1692): Validate's record stores, and what the interview record reads.
  db.exec(migration('460_validate_record_stores.sql'));
  db.exec(migration('755_posthog_metrics.sql')); // D4585: Add evidence offers valued PostHog metrics
  db.exec(migration('439_validate_proposals_structuring.sql'));
  db.exec(migration('446_interview_structure_receipts.sql'));
  // D757 (#1925): "What it fed" reads a proposal's interview (246's
  // `target_ref`), and the ICP, Market and Demand records read the findings store.
  db.exec(migration('246_fills_the_blanks_everywhere.sql'));
  db.exec(migration('489_interview_findings.sql'));
  db.exec(migration('228_research_company_directory.sql'));
  db.exec(migration('249_project_metrics.sql'));
  db.exec(migration('202611152333_6006_theme_problem_statement.sql')); // D6006: the theme's problem statement
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null],
    [40, 'partner', null], [50, 'investor', null], [60, 'exploring', 1001], [70, 'advisor', null]] as const) {
    u.run(id, role, `User ${id}`, `user${id}@example.test`, founder, id === 60 ? 1 : 0);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Project One', 1001), (2, 'Project Two', 1002)");
  return db;
}

/** Venture 1: "Slow dispatch" (theme 11) said by three people at two companies, one without consent; a loose phrase. */
function seeded() {
  const db = fixture();
  db.exec(`
    INSERT INTO pain_groups (id, project_id, title) VALUES (11, 1, 'Slow dispatch'), (12, 1, 'Paper forms'), (22, 2, 'Theirs');
    INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES
      (1, 11, 'dispatch is slow', 'Dispatch is slow'), (1, 11, 'we wait on dispatch', 'We wait on dispatch'),
      (1, 12, 'paper forms everywhere', 'Paper forms everywhere'), (2, 22, 'theirs', 'Theirs');
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_company, pains_json, quote_consent, icp_fit, interview_date) VALUES
      (1, 1, 'Iris Example', 'Northwind', '["Dispatch is slow", "dispatch  is slow", "We wait on dispatch", "Secret pricing pain"]', 0, 'strong', date('now')),
      (2, 1, 'Jon Example', 'Northwind', '["Dispatch is slow", "Paper forms everywhere"]', 1, 'strong', date('now')),
      (3, 1, '', NULL, '["we wait on dispatch"]', 1, NULL, date('now')),
      (4, 1, 'Kim Example', 'Southwind', '["Paper forms everywhere"]', 1, NULL, date('now'));
    INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (5, 1, 'H1', 'Fleets pay', 1), (6, 1, 'H2', 'Ops buy alone', 2);
    INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (5, 11, 'supports'), (6, 11, 'contradicts'), (6, 12, 'supports');
  `);
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/cycles', createCycleRecords(RECORD_SPECS));
  app.route('/api/cycles/validate', cycleValidate);
  app.route('/api/progress', progress);
  app.onError((error: Error, c) => c.json({ detail: error.message }, error.message === 'Forbidden' ? 403 : 500));
  const token = await new SignJWT({ user_id: who, role: roles[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api${path}`, { method, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const list = (db: DatabaseSync, who = 10) => call(db, who, 'GET', '/cycles/validate/modules/problem-discovery?project=1');
const record = (db: DatabaseSync, id: string, who = 10, suffix = '') => call(db, who, suffix ? 'POST' : 'GET', `/cycles/validate/modules/problem-discovery/records/${id}${suffix}?project=1`);

test('the ranked list: rank and its reason, sources beside mentions, supporting and contradicting, and loose phrases as Not grouped', async () => {
  const db = seeded();
  const r = await list(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = r.body.records.rows;
  assert.deepEqual(rows.map((t: any) => [t.rank, t.theme, t.grouped]), [
    [1, 'Slow dispatch', true], [2, 'Paper forms', true], [3, 'Secret pricing pain', false],
  ]);
  const dispatch = rows[0];
  assert.equal(dispatch.mentions, 3, 'three interviews');
  assert.equal(dispatch.phrases, 4, 'four wordings: Iris said two (one of them twice, counted once), Jon one, the third interview one');
  assert.deepEqual(dispatch.sources, { interviews: 3, people: 2, organisations: 1, people_unrecorded: 1, organisations_unrecorded: 1 });
  assert.equal(dispatch.supporting, 1);
  assert.equal(dispatch.contradicting, 1);
  assert.deepEqual(dispatch.contradicts, ['H2']);
  assert.equal(dispatch.rank_reason, 'Most mentions · 2 from ICP');
  assert.equal(rows[1].rank_reason, '2 mentions, both in the last 30 days · 1 from ICP');
  assert.deepEqual([rows[1].supporting, rows[1].contradicting, rows[1].contradicts], [1, 0, null]);
  assert.equal(rows[2].id, null, 'a loose phrase opens no record');
  // The rank stays the theme's place in the whole venture's order when the list is narrowed.
  const narrowed = await call(db, 10, 'GET', '/cycles/validate/modules/problem-discovery?project=1&q=paper');
  assert.deepEqual(narrowed.body.records.rows.map((t: any) => [t.rank, t.theme]), [[2, 'Paper forms']]);
});

test('a partner reads the same counts and reasons, and never an unconsented quote', async () => {
  const db = seeded();
  const founder = (await list(db)).body.records.rows;
  const partner = (await list(db, 40)).body.records.rows;
  for (const key of ['rank', 'rank_reason', 'sources', 'phrases', 'supporting', 'contradicting']) {
    assert.deepEqual(partner.map((t: any) => t[key]), founder.map((t: any) => t[key]), key);
  }
  const dispatch = partner.find((t: any) => t.id === 11);
  assert.deepEqual(dispatch.wordings, ['Dispatch is slow', 'we wait on dispatch'], 'both were also said by an interview that consented');
  for (const t of partner) assert.equal(t.rank_reason.includes('Secret pricing pain'), false, 'a reason is counts, never a quote');
  assert.deepEqual(partner.find((t: any) => t.id === null).wordings, [QUOTE_WITHHELD]);
});

test('rankReason: a tie names the name order, a theme no held interview names says so, severity is a word', () => {
  const t = (title: string, mentions: number, o: Partial<Theme> = {}): Theme => ({
    key: title, title, group_id: 1, mentions, severe: 0, real: 0, mild: 0, severity: null, first_mention: null,
    last_30d: 0, prior_30d: 0, supports: [], contradicts: [], phrases: mentions, people: null, organisations: null,
    people_unrecorded: 0, organisations_unrecorded: 0, ...o,
  });
  const themes = [t('Alpha', 3, { severity: 'severe' }), t('Beta', 3, { last_30d: 3 }), t('Gamma', 1), t('Delta', 0)];
  assert.equal(rankReason(themes, 0, 0), '3 mentions · mostly Severe · tied on mentions, ordered by name');
  assert.equal(rankReason(themes, 1, 2), '3 mentions, all in the last 30 days · 2 from ICP · tied on mentions, ordered by name');
  assert.equal(rankReason(themes, 2, 0), '1 mention');
  assert.equal(rankReason(themes, 3, 0), 'Named in no held interview');
  assert.equal(rankReason([t('Solo', 2)], 0, 0), 'Most mentions');
});

test('the theme record: a problem statement every reader reads, sources, and used on slide as Unavailable with its reason', async () => {
  const db = seeded();
  const r = await record(db, '11');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.main.map((s: any) => s.key), ['statement', 'quotes', 'hypotheses']);
  assert.deepEqual(r.body.main[0].rows, [
    { a: 'Who has it', b: 'Not recorded', tone: 'grey' }, { a: 'How they cope today', b: 'Not recorded', tone: 'grey' },
    { a: 'What it costs', b: 'Not recorded', tone: 'grey' },
  ]);
  const parts = r.body.parts;
  assert.deepEqual(parts.problem_statement, { who: null, cope: null, cost: null, updated_at: null, updated_by: null });
  assert.deepEqual(parts.sources, { interviews: 3, people: 2, organisations: 1, people_unrecorded: 1, organisations_unrecorded: 1, phrases: 4 });
  assert.deepEqual([parts.supporting, parts.contradicting], [1, 1]);
  assert.deepEqual(parts.used_on_slide, { state: 'unavailable', reason: USED_ON_SLIDE_UNAVAILABLE, slide: 'problem' });
  assert.ok(r.body.actions.some((a: any) => a.key === 'statement'));
});

test('Write the problem statement: saves the three fields with who and when, clears an empty one, refuses a partner and a long field', async () => {
  const db = seeded();
  const saved = await call(db, 10, 'POST', '/cycles/validate/modules/problem-discovery/records/11/actions/statement?project=1',
    { who: '  Ops leads at 3PLs  ', cope: 'Phone calls and a spreadsheet', cost: 'Two hours a day' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  let row = db.prepare('SELECT statement_who, statement_cope, statement_cost, statement_updated_by, statement_updated_at FROM pain_groups WHERE id = 11').get() as any;
  assert.deepEqual([row.statement_who, row.statement_cope, row.statement_cost, row.statement_updated_by], ['Ops leads at 3PLs', 'Phone calls and a spreadsheet', 'Two hours a day', 10]);
  assert.ok(row.statement_updated_at);
  const log = db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE '%theme_statement_edited%' OR details LIKE '%theme_statement_edited%'").get() as any;
  assert.equal(log.n, 1, 'one activity row');
  const partnerRead = await record(db, '11', 40);
  assert.equal(partnerRead.body.parts.problem_statement.who, 'Ops leads at 3PLs', 'the founder\'s words, not a quote');
  assert.deepEqual(partnerRead.body.actions, []);

  assert.equal((await call(db, 10, 'POST', '/cycles/validate/modules/problem-discovery/records/11/actions/statement?project=1', { cost: '' })).status, 200);
  row = db.prepare('SELECT statement_who, statement_cost FROM pain_groups WHERE id = 11').get() as any;
  assert.deepEqual([row.statement_who, row.statement_cost], ['Ops leads at 3PLs', null], 'empty clears; left out keeps');

  assert.equal((await call(db, 40, 'POST', '/cycles/validate/modules/problem-discovery/records/11/actions/statement?project=1', { who: 'x' })).status, 403);
  assert.equal((await call(db, 20, 'POST', '/cycles/validate/modules/problem-discovery/records/11/actions/statement?project=1', { who: 'x' })).status, 403);
  assert.equal((await call(db, 10, 'POST', '/cycles/validate/modules/problem-discovery/records/22/actions/statement?project=1', { who: 'x' })).status, 404);
  const long = await call(db, 10, 'POST', '/cycles/validate/modules/problem-discovery/records/11/actions/statement?project=1', { who: 'x'.repeat(1001) });
  assert.equal(long.status, 400);
  assert.equal((db.prepare('SELECT statement_who FROM pain_groups WHERE id = 11').get() as any).statement_who, 'Ops leads at 3PLs', 'a refused save writes nothing');
});

test('Assign several at once: into a theme, into a new one, each phrase once, all or nothing, with Assign\'s gate', async () => {
  const db = seeded();
  const into = await call(db, 10, 'POST', '/progress/pain-groups/1/assign-many', { phrases: ['Secret pricing pain', 'secret   pricing pain', 'Paper forms everywhere'], group_id: 11 });
  assert.equal(into.status, 200, JSON.stringify(into.body));
  assert.equal(into.body.assigned, 2, 'two wordings of one phrase count once');
  assert.equal(into.body.group_id, 11);
  const aliases = (gid: number) => db.prepare('SELECT phrase_norm FROM pain_group_aliases WHERE project_id = 1 AND group_id = ? ORDER BY phrase_norm').all(gid).map((r: any) => r.phrase_norm);
  assert.deepEqual(aliases(11), ['dispatch is slow', 'paper forms everywhere', 'secret pricing pain', 'we wait on dispatch']);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE details LIKE '%2 quotes assigned to Slow dispatch%'").get() as any).n, 1, 'one activity row for the set');

  const fresh = await call(db, 10, 'POST', '/progress/pain-groups/1/assign-many', { phrases: ['Dispatch is slow', 'We wait on dispatch'], new_title: 'Waiting on dispatch' });
  assert.equal(fresh.status, 200);
  const created = db.prepare("SELECT id, created_by FROM pain_groups WHERE title = 'Waiting on dispatch'").get() as any;
  assert.equal(created.created_by, 10);
  assert.deepEqual(aliases(created.id), ['dispatch is slow', 'we wait on dispatch']);

  const refused = async (who: number, body: unknown, project = 1) => (await call(db, who, 'POST', `/progress/pain-groups/${project}/assign-many`, body));
  assert.equal((await refused(40, { phrases: ['Dispatch is slow'], group_id: 11 })).status, 403, 'a partner reads only');
  assert.equal((await refused(20, { phrases: ['Dispatch is slow'], group_id: 11 })).status, 403, 'another founder');
  assert.equal((await refused(10, { phrases: ['Theirs'], group_id: 22 })).status, 404, 'another venture\'s theme');
  const tooMany = await refused(10, { phrases: Array.from({ length: MAX_BULK_ASSIGN + 1 }, (_, i) => `p${i}`), group_id: 11 });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error, 'too_many_phrases');
  assert.equal((await refused(10, { phrases: [], group_id: 11 })).body.error, 'phrases_required');
  assert.equal((await refused(10, { phrases: ['ok', '  '], group_id: 11 })).body.error, 'invalid_phrase');
  assert.equal((await refused(10, { phrases: ['ok'], group_id: 11, new_title: 'Both' })).body.error, 'target_required');
  assert.equal((await refused(10, { phrases: ['ok'] })).body.error, 'target_required');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM pain_group_aliases WHERE phrase_norm = 'ok'").get() as any).n, 0, 'a refused set writes nothing');
});
