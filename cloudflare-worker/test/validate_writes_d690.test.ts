/**
 * D690 (#1692) — the writes behind Validate's six records, on real SQLite.
 *
 * #1692 ships in two PRs. This file holds the first PR's tests: the Add, PATCH
 * and DELETE routes, each record action's writer called as a function (the
 * closing PR declares them on the records), `evidenceFor`, the audio route,
 * `persistResult`, the hypothesis code allocation, the waitlist count and
 * migration 460. Test numbers are #1692's: 2 (the routes' and writers' part),
 * 11 to 17 and 19.
 *
 * The database is built as `cycle_validate_d659.test.ts` builds it: tables
 * from schema_baseline.sql through `_baseline.mjs`, migrations 440, 459 and
 * 460 over them, plus 438 for sessions, 249 for KPIs, 255 and 311 for the
 * reads and 228 for the company directory, and the routes over
 * `_d1_sqlite.mjs`. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_writes_d690.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import sessions from '../src/routes/founder_validate_sessions.ts';
import competitors, { persistResult } from '../src/routes/competitors.ts';
import {
  mergeTheme, splitTheme, attachQuote, linkTheme, stopCompetitor, addCompetitorSignal, markDemandToConfirm,
  attachDemandEvidence, openDemandEvidence, addEvidence, unlinkEvidence, addExperiment, setExperimentStatus,
  setHypothesisPlan, WriterError,
} from '../src/services/validateWriters.ts';
import { updateInterviewDetails, deleteInterview } from '../src/services/interviewWriters.ts';
import { evidenceFor } from '../src/services/validateEvidence.ts';
import { insertHypothesis } from '../src/routes/_founder_validate_writes.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d690-writes-0123456789';
const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(ROOT, `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const MIG460 = sqlOf('460_validate_record_stores.sql');
const TODAY = new Date().toISOString().slice(0, 10);

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, STRANGER = 50;
const P = 1, P_B = 2;

const TABLES = [
  'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
  'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
  'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  'competitor_analysis_outputs', 'mvp_features', 'roadmap_okrs',
];

function fixture(opts: { fk?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: !!opts.fk, enableDoubleQuotedStringLiterals: true });
  // With foreign keys on (test 17), the baseline tables' own references reach
  // tables this fixture does not build, so they are stripped; migration 460's
  // references, which test 17 is about, are applied as written.
  for (const t of TABLES) db.exec(opts.fk ? stripForeignKeys(tableFromBaseline(BASELINE, t)) : tableFromBaseline(BASELINE, t));
  db.exec('CREATE UNIQUE INDEX idx_hypotheses_project_code ON hypotheses (project_id, code)');
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('CREATE UNIQUE INDEX idx_pain_group_aliases_project_phrase ON pain_group_aliases (project_id, phrase_norm)');
  db.exec('CREATE UNIQUE INDEX idx_interview_pain_severities ON interview_pain_severities (interview_id, phrase_norm)');
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  db.exec('ALTER TABLE mvp_features ADD COLUMN pain_group_id INTEGER REFERENCES pain_groups(id)');
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(MIG460);
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('228_research_company_directory.sql'));
  db.exec(sqlOf('438_interview_sessions.sql'));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(STRANGER, 'founder', 'Sid Stranger', 'sid@example.test', 1003);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${P_B}, 'Osprey Works', 1002)`);
  return db;
}

const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [STRANGER]: 'founder' };
const objects = new Map<string, Uint8Array>();
const FILES = {
  async put(key: string, value: ArrayBuffer) { objects.set(key, new Uint8Array(value)); },
  async get(key: string) { const v = objects.get(key); return v ? { arrayBuffer: async () => v.buffer } : null; },
  async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
};
const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES } as any);

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.route('/api/founder/validate', sessions as any);
app.route('/api/competitors', competitors as any);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, envOf(db));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const cv = (db: DatabaseSync, method: string, path: string, body?: unknown, who = FOUNDER, pid = P) =>
  call(db, who, method, `/api/cycles/validate${path}${path.includes('?') ? '&' : '?'}project=${pid}`, body);

let ivSeq = 0;
function interview(db: DatabaseSync, pid: number, o: Record<string, unknown> = {}) {
  ivSeq += 1;
  return Number((db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interviewee_role, interview_date, pains_json,
       hypotheses_json, notes, icp_fit, quote_consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).get(pid, o.name ?? `Person ${ivSeq}`, o.company ?? null, o.role ?? null, o.date ?? TODAY, JSON.stringify(o.pains ?? []),
    JSON.stringify(o.hyps ?? []), o.notes ?? null, o.fit ?? null, o.consent ?? null) as any).id);
}
const group = (db: DatabaseSync, pid: number, title: string) =>
  Number((db.prepare('INSERT INTO pain_groups (project_id, title) VALUES (?, ?) RETURNING id').get(pid, title) as any).id);
const alias = (db: DatabaseSync, pid: number, gid: number, phrase: string) =>
  db.prepare('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, ?, ?, ?)').run(pid, gid, phrase.toLowerCase(), phrase);
const hyp = (db: DatabaseSync, pid: number, code: string, claim = 'Teams will pay for faster dispatch') =>
  Number((db.prepare('INSERT INTO hypotheses (project_id, code, claim) VALUES (?, ?, ?) RETURNING id').get(pid, code, claim) as any).id);
const all = (db: DatabaseSync, sql: string, ...a: any[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
const one = (db: DatabaseSync, sql: string, ...a: any[]) => { const r = db.prepare(sql).get(...a) as any; return r ? { ...r } : r; };
const logs = (db: DatabaseSync) => all(db, 'SELECT entity_type, entity_id, action, details FROM activity_logs ORDER BY id');
async function refused(p: Promise<unknown>): Promise<{ status: number; sentence: string }> {
  try { await p; } catch (e) { if (e instanceof WriterError) return { status: e.status, sentence: e.sentence }; throw e; }
  return assert.fail('the write was not refused');
}

// ---------------------------------------------------------------------------
// Test 11 — themes
// ---------------------------------------------------------------------------

test('11: New theme writes the group, both aliases and both severities in one go, and a quote already judged keeps its own', async () => {
  const db = fixture();
  const a = interview(db, P, { pains: ['Slow dispatch', 'Lost invoices'] });
  const b = interview(db, P, { pains: ['slow dispatch'] });
  db.prepare("INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, 'slow dispatch', 'mild')").run(b);
  const h = hyp(db, P, 'H1');
  const r = await cv(db, 'POST', '/themes', { title: 'Dispatch is slow', severity: 'severe', hypothesis_id: h,
    quotes: [{ interview_id: a, phrase: 'Slow dispatch' }, { interview_id: b, phrase: 'slow dispatch' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const gid = r.body.id;
  assert.deepEqual(one(db, 'SELECT project_id, title, created_by FROM pain_groups WHERE id = ?', gid), { project_id: P, title: 'Dispatch is slow', created_by: FOUNDER });
  assert.deepEqual(all(db, 'SELECT group_id, phrase_norm FROM pain_group_aliases ORDER BY id'), [{ group_id: gid, phrase_norm: 'slow dispatch' }]);
  assert.deepEqual(all(db, 'SELECT interview_id, severity FROM interview_pain_severities ORDER BY interview_id'),
    [{ interview_id: a, severity: 'severe' }, { interview_id: b, severity: 'mild' }], 'the judged quote keeps mild (decision 6)');
  assert.deepEqual(all(db, 'SELECT hypothesis_id, pain_group_id, direction FROM hypothesis_pain_links'), [{ hypothesis_id: h, pain_group_id: gid, direction: 'supports' }]);
  const l = logs(db);
  assert.deepEqual(l.map((x) => [x.entity_type, x.entity_id, x.action]), [
    ['validate.problem-discovery', String(gid), 'theme_created'], ['validate.experiments', String(h), 'theme_linked']]);
  assert.ok(l.every((x) => !/Person|Slow dispatch/i.test(x.details)), 'no interviewee or quote in a summary');
  // A phrase the interview did not record, another venture's interview, another venture's hypothesis.
  const bIv = interview(db, P_B, { pains: ['Slow dispatch'] });
  assert.equal((await cv(db, 'POST', '/themes', { title: 'X', quotes: [{ interview_id: a, phrase: 'never said' }] })).status, 400);
  assert.equal((await cv(db, 'POST', '/themes', { title: 'X', quotes: [{ interview_id: bIv, phrase: 'Slow dispatch' }] })).status, 404);
  assert.equal((await cv(db, 'POST', '/themes', { title: 'X', hypothesis_id: hyp(db, P_B, 'H1') })).status, 404);
  assert.equal(Number(one(db, 'SELECT COUNT(*) AS n FROM pain_groups').n), 1, 'a refused theme writes nothing');
});

test('11: Merge moves aliases and links, drops a duplicate link, repoints features, and keeps a phrase that matched the old title', async () => {
  const db = fixture();
  interview(db, P, { pains: ['Manual reconciliation', 'Spreadsheet hell'] });
  const from = group(db, P, 'Manual reconciliation');
  const into = group(db, P, 'Bookkeeping pain');
  alias(db, P, from, 'Spreadsheet hell');
  const h1 = hyp(db, P, 'H1'), h2 = hyp(db, P, 'H2');
  db.exec(`INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (${h1}, ${from}, 'supports'), (${h1}, ${into}, 'supports'), (${h2}, ${from}, 'contradicts')`);
  db.exec(`INSERT INTO mvp_features (project_id, title, pain_group_id) VALUES (${P}, 'Auto match', ${from})`);
  await mergeTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: from, into });
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM pain_groups WHERE id = ?', from).n, 0);
  assert.deepEqual(all(db, 'SELECT phrase_norm, group_id FROM pain_group_aliases ORDER BY phrase_norm'),
    [{ phrase_norm: 'manual reconciliation', group_id: into }, { phrase_norm: 'spreadsheet hell', group_id: into }],
    'the old title is kept as an alias, so the phrase that matched it by title still lands');
  assert.deepEqual(all(db, 'SELECT hypothesis_id, pain_group_id, direction FROM hypothesis_pain_links ORDER BY hypothesis_id'),
    [{ hypothesis_id: h1, pain_group_id: into, direction: 'supports' }, { hypothesis_id: h2, pain_group_id: into, direction: 'contradicts' }]);
  assert.equal(one(db, 'SELECT pain_group_id FROM mvp_features').pain_group_id, into);
  assert.equal((await refused(mergeTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: into, into }))).status, 400);
  const foreign = group(db, P_B, 'Theirs');
  assert.equal((await refused(mergeTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: into, into: foreign }))).status, 404);
});

test('11: Split makes a new theme of the phrases it names; Attach and Link write theirs; Delete leaves no link and no feature pointing at it', async () => {
  const db = fixture();
  const iv = interview(db, P, { pains: ['Slow dispatch', 'Late drivers', 'No tracking'] });
  const g = group(db, P, 'Operations');
  alias(db, P, g, 'Slow dispatch'); alias(db, P, g, 'Late drivers');
  const out = await splitTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: g, phrases: ['Late drivers'], title: 'Driver reliability' });
  assert.ok(out.id > g);
  assert.equal(one(db, 'SELECT title FROM pain_groups WHERE id = ?', out.id).title, 'Driver reliability');
  assert.equal(one(db, "SELECT group_id FROM pain_group_aliases WHERE phrase_norm = 'late drivers'").group_id, out.id);
  assert.equal(one(db, "SELECT group_id FROM pain_group_aliases WHERE phrase_norm = 'slow dispatch'").group_id, g);
  assert.equal((await refused(splitTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: g, phrases: ['No tracking'], title: 'Z' }))).status, 400, 'a phrase the theme does not hold');
  await attachQuote(envOf(db), { projectId: P, userId: FOUNDER, themeId: g, interview_id: iv, phrase: 'No tracking' });
  assert.equal(one(db, "SELECT group_id FROM pain_group_aliases WHERE phrase_norm = 'no tracking'").group_id, g);
  const h = hyp(db, P, 'H1');
  await linkTheme(envOf(db), { projectId: P, userId: FOUNDER, themeId: g, hypothesis_id: h, direction: 'contradicts' });
  db.exec(`INSERT INTO mvp_features (project_id, title, pain_group_id) VALUES (${P}, 'Live map', ${g})`);
  const del = await cv(db, 'DELETE', `/themes/${g}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM hypothesis_pain_links WHERE pain_group_id = ?', g).n, 0);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM pain_group_aliases WHERE group_id = ?', g).n, 0);
  assert.equal(one(db, 'SELECT pain_group_id FROM mvp_features').pain_group_id, null);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM pain_groups WHERE id = ?', g).n, 0);
  // PATCH writes the severity only to quotes not judged yet.
  const g2 = group(db, P, 'Driver reliability 2');
  alias(db, P, g2, 'Slow dispatch');
  const r = await cv(db, 'PATCH', `/themes/${g2}`, { title: 'Dispatch', severity: 'real' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(one(db, "SELECT severity FROM interview_pain_severities WHERE interview_id = ? AND phrase_norm = 'slow dispatch'", iv).severity, 'real');
});

// ---------------------------------------------------------------------------
// Test 12 — competitors
// ---------------------------------------------------------------------------

test('12: Add competitor with no analysis succeeds, kind lands in category, and an admin\'s first one belongs to the founder', async () => {
  const db = fixture();
  const r = await cv(db, 'POST', '/competitors', { name: 'Routewise', kind: 'adjacent', watch: { hiring: true }, why: 'Same buyer' }, ADMIN);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = one(db, 'SELECT user_id, project_id FROM competitor_analyses');
  assert.deepEqual(a, { user_id: FOUNDER, project_id: P }, 'the analysis is the venture owner\'s, not the admin\'s');
  assert.deepEqual(one(db, 'SELECT name, category, origin FROM competitor_candidates'), { name: 'Routewise', category: 'adjacent', origin: 'manual' });
  const t = one(db, 'SELECT name_norm, watch_json, why_it_matters, stopped_at FROM competitor_tracking WHERE project_id = ?', P);
  assert.deepEqual({ ...t, watch_json: JSON.parse(t.watch_json) }, { name_norm: 'routewise', watch_json: { funding: true, launch: true, hiring: true }, why_it_matters: 'Same buyer', stopped_at: null });
  const listed = await call(db, FOUNDER, 'GET', '/api/competitors');
  assert.equal(listed.body.analyses.length, 1, 'the founder\'s Market › Competitors lists it');
  // A second Add of the same name is the same candidate, tracked again.
  const again = await cv(db, 'POST', '/competitors', { name: '  routewise ', kind: 'direct' });
  assert.equal(again.status, 200);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM competitor_candidates').n, 1);
  assert.equal(one(db, 'SELECT category FROM competitor_candidates').category, 'direct');
  assert.equal((await cv(db, 'POST', '/competitors', { name: 'A', company_ref: 'x' })).status, 400, 'one source only');
  assert.equal((await cv(db, 'POST', '/competitors', { name: 'A', kind: 'rival' })).status, 400);
});

test('12: a Research › Companies pick becomes a candidate with its name and website; an unknown uid answers 404 and writes nothing', async () => {
  const db = fixture();
  db.prepare("INSERT INTO research_company_directory (uid, name, website, source_url, as_of) VALUES ('rcd-1', 'Fleetly', 'https://fleetly.example.test', 'https://example.test/q1', '2026-10-01')").run();
  const r = await cv(db, 'POST', '/competitors', { directory_uid: 'rcd-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(one(db, 'SELECT name, url FROM competitor_candidates'), { name: 'Fleetly', url: 'https://fleetly.example.test/' });
  const before = one(db, 'SELECT (SELECT COUNT(*) FROM competitor_candidates) + (SELECT COUNT(*) FROM competitor_tracking) AS n').n;
  assert.equal((await cv(db, 'POST', '/competitors', { directory_uid: 'rcd-nope' })).status, 404);
  assert.equal(one(db, 'SELECT (SELECT COUNT(*) FROM competitor_candidates) + (SELECT COUNT(*) FROM competitor_tracking) AS n').n, before);
  // company_ref names a candidate in the CALLER's own analyses, never another member's.
  db.exec(`INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('an-other', ${OTHER}, ${P_B})`);
  db.exec("INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('cand-other', 'an-other', 'Secret Co')");
  assert.equal((await cv(db, 'POST', '/competitors', { company_ref: 'cand-other' })).status, 404);
});

test('12: a re-run keeps a stored id, a hand signal and a tracked competitor, drops a pipeline Hires signal when Hires is off, and keeps the tracking row', async () => {
  const db = fixture();
  const env = envOf(db);
  await cv(db, 'POST', '/competitors', { name: 'Routewise' });
  const an = one(db, 'SELECT id FROM competitor_analyses').id;
  const routewise = one(db, "SELECT id FROM competitor_candidates WHERE name = 'Routewise'").id;
  db.exec(`INSERT INTO competitor_candidates (id, analysis_id, name, origin) VALUES ('c-pipe', '${an}', 'Pipeline Co', 'discovered')`);
  await addCompetitorSignal(env, { projectId: P, userId: FOUNDER, candidateId: routewise, signal_type: 'funding', label: 'Raised a seed', amount_cents: 120_000_000, currency: 'usd' });
  db.exec(`UPDATE competitor_tracking SET watch_json = '{"funding":true,"launch":true,"hiring":false}' WHERE project_id = ${P}`);
  const result: any = {
    candidates: [{ id: 'new-1', name: 'routewise', domain: null, url: null, category: 'direct', relevance_score: 1, scores: {}, summary: null, details: {}, origin: 'discovered', position: 0 }],
    sources: [],
    signals: [
      { id: 's-hire', candidate_id: 'new-1', signal_type: 'hiring', label: 'Hiring drivers', detail: null },
      { id: 's-launch', candidate_id: 'new-1', signal_type: 'launch', label: 'New app', detail: null },
    ],
    output: {},
  };
  await persistResult(env, an, result);
  const cands = all(db, 'SELECT id, name FROM competitor_candidates ORDER BY name');
  assert.deepEqual(cands.map((c) => c.id), [routewise], 'the stored id is kept; Pipeline Co, not found again and not tracked, goes');
  const sigs = all(db, 'SELECT id, signal_type, candidate_id, amount_cents FROM competitor_signals ORDER BY signal_type');
  assert.deepEqual(sigs.map((s) => s.signal_type), ['funding', 'launch'], 'the hand signal stays, the Hires one is dropped');
  assert.ok(sigs.every((s) => s.candidate_id === routewise));
  assert.equal(sigs.find((s) => s.signal_type === 'funding').amount_cents, 120_000_000);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM competitor_tracking').n, 1);
  // A re-run that does not find a competitor added through Add, without keep_manual, keeps it:
  // its tracking row alone keeps it, with no signal pointing at it.
  db.exec('DELETE FROM competitor_signals');
  await persistResult(env, an, { candidates: [], sources: [], signals: [], output: {} } as any);
  assert.deepEqual(all(db, 'SELECT id FROM competitor_candidates').map((c) => c.id), [routewise]);
  // Stopped and not pointed at by a kept signal, it goes on the next run.
  await stopCompetitor(env, { projectId: P, userId: FOUNDER, candidateId: routewise });
  assert.ok(one(db, 'SELECT stopped_at FROM competitor_tracking').stopped_at);
  await persistResult(env, an, { candidates: [], sources: [], signals: [], output: {} } as any);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM competitor_candidates').n, 0);
});

test('12: Edit sets kind, watch and positioning on the venture\'s row; another venture\'s competitor answers 404', async () => {
  const db = fixture();
  await cv(db, 'POST', '/competitors', { name: 'Routewise' });
  const id = one(db, 'SELECT id FROM competitor_candidates').id;
  const r = await cv(db, 'PATCH', `/competitors/${id}`, { kind: 'adjacent', watch: { launch: false }, price_position: 'higher', depth_position: 'narrower', why: 'Same buyer' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = one(db, 'SELECT watch_json, price_position, depth_position, why_it_matters FROM competitor_tracking');
  assert.deepEqual({ ...t, watch_json: JSON.parse(t.watch_json) }, { watch_json: { funding: true, launch: false, hiring: false }, price_position: 'higher', depth_position: 'narrower', why_it_matters: 'Same buyer' });
  assert.equal(one(db, 'SELECT category FROM competitor_candidates').category, 'adjacent');
  assert.equal((await cv(db, 'PATCH', `/competitors/${id}`, { price_position: 'cheap' })).status, 400);
  assert.equal((await cv(db, 'PATCH', `/competitors/${id}`, { watch: { funding: 'yes' } })).status, 400);
  assert.equal((await cv(db, 'PATCH', `/competitors/${id}`, { kind: 'direct' }, OTHER, P_B)).status, 404, 'a candidate under A, read from B');
});

// ---------------------------------------------------------------------------
// Test 13 — demand signals
// ---------------------------------------------------------------------------

test('13: a waitlist sign-up recorded by hand lands in demand_signals, writes no waitlist_signups row, and counts once', async () => {
  const db = fixture();
  db.prepare("INSERT INTO waitlist_signups (project_id, email, audience, created_at) VALUES (?, 'a@example.test', 'customer', ?)").run(P, TODAY);
  const r = await cv(db, 'POST', '/demand-signals', { kind: 'waitlist', who: 'Café owner from the fair', signal_date: TODAY });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM waitlist_signups').n, 1);
  assert.equal(one(db, "SELECT kind FROM demand_signals").kind, 'waitlist');
  await cv(db, 'POST', '/demand-signals', { kind: 'waitlist', who: 'Maybe', signal_date: TODAY, status: 'to_confirm' });
  const o = await call(db, FOUNDER, 'GET', `/api/cycles/validate/overview?project=${P}`);
  const fig = o.body.figures.find((f: any) => f.key === 'waitlist_signups');
  assert.equal(fig.value, 2, 'one self sign-up and one confirmed by hand; the one to confirm does not count');
  const card = o.body.cards.find((c: any) => c.slug === 'demand-signals');
  assert.equal(card.series.signups.at(-1).total, 2, 'the bar\'s line counts the same rows');
  assert.equal(card.series.signups.at(-2).total, 0, 'both arrived this week, so the week before had none: the weekly split counts the hand row too');
});

test('13: an amount on a need-to-have or a waitlist sign-up is refused; Edit keeps the same rules', async () => {
  const db = fixture();
  assert.equal((await cv(db, 'POST', '/demand-signals', { kind: 'need_to_have', amount_cents: 5000 })).status, 400);
  assert.equal((await cv(db, 'POST', '/demand-signals', { kind: 'waitlist', amount_cents: 5000 })).status, 400);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM demand_signals').n, 0);
  const r = await cv(db, 'POST', '/demand-signals', { kind: 'pre_sale', amount_cents: 120_000, currency: 'eur' });
  assert.equal(r.status, 201);
  const id = `signal-${r.body.id}`;
  assert.equal((await cv(db, 'PATCH', `/demand-signals/${id}`, { kind: 'need_to_have' })).status, 400, 'the stored amount stays, so it cannot become a need-to-have');
  const e = await cv(db, 'PATCH', `/demand-signals/${id}`, { who: 'Northwind café', amount_cents: 150_000 });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(one(db, 'SELECT who, amount_cents, currency, kind FROM demand_signals'), { who: 'Northwind café', amount_cents: 150_000, currency: 'eur', kind: 'pre_sale' });
  await markDemandToConfirm(envOf(db), { projectId: P, userId: FOUNDER, signalId: r.body.id });
  assert.equal(one(db, 'SELECT status FROM demand_signals').status, 'to_confirm');
  // A revenue- or waitlist- id is not editable here; another venture's signal is a 404.
  assert.equal((await cv(db, 'PATCH', '/demand-signals/revenue-1', { who: 'x' })).status, 404);
  assert.equal((await cv(db, 'PATCH', `/demand-signals/${id}`, { who: 'x' }, OTHER, P_B)).status, 404);
});

test('13: Attach refuses an HTML file and one over 20 MB; open-evidence answers one signed download', async () => {
  const db = fixture();
  const env = envOf(db);
  const r = await cv(db, 'POST', '/demand-signals', { kind: 'loi', who: 'Harbour Freight' });
  const sid = r.body.id;
  const file = (type: string, size: number, name = 'loi.pdf') => new File([new Uint8Array(size)], name, { type });
  assert.equal((await refused(attachDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid, file: file('text/html', 10, 'x.html') }))).status, 415);
  assert.equal((await refused(attachDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid, file: file('application/pdf', 20 * 1024 * 1024 + 1) }))).status, 413);
  assert.equal(one(db, 'SELECT evidence_file_key FROM demand_signals').evidence_file_key, null);
  assert.equal((await refused(openDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid }))).status, 404);
  const ok = await attachDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid, file: file('application/pdf', 2048, 'Signed LOI.pdf') });
  assert.equal(ok.file_name, 'Signed LOI.pdf');
  const key = one(db, 'SELECT evidence_file_key FROM demand_signals').evidence_file_key;
  assert.match(key, /^validate-evidence\/1\/[0-9a-f-]{36}\.pdf$/);
  assert.ok(objects.has(key));
  const open = await openDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid });
  assert.match(open.open.url, /^\/api\/files\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  // A B interview is refused, and writes nothing.
  const bIv = interview(db, P_B);
  assert.equal((await refused(attachDemandEvidence(env, { projectId: P, userId: FOUNDER, signalId: sid, interview_id: bIv }))).status, 404);
  assert.equal(one(db, 'SELECT interview_id FROM demand_signals').interview_id, null);
});

// ---------------------------------------------------------------------------
// Test 14 — hypotheses
// ---------------------------------------------------------------------------

test('14: New hypothesis writes the claim, its bar, its owner and its links in one batch; a foreign theme or owner is refused', async () => {
  const db = fixture();
  const g1 = group(db, P, 'Dispatch'), g2 = group(db, P, 'Invoices');
  const r = await cv(db, 'POST', '/hypotheses', { claim: 'Dispatchers will pay to save an hour a day', success_bar: '5 of 8 say yes',
    disproof: 'Fewer than 2 of 8', pain_group_ids: [g1, g2], direction: 'supports', owner_user_id: FOUNDER, deadline: '2026-11-30' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.code, 'H1');
  assert.deepEqual(one(db, 'SELECT code, success_bar, disproof, deadline, owner_user_id, created_by FROM hypotheses'),
    { code: 'H1', success_bar: '5 of 8 say yes', disproof: 'Fewer than 2 of 8', deadline: '2026-11-30', owner_user_id: FOUNDER, created_by: FOUNDER });
  assert.deepEqual(all(db, 'SELECT pain_group_id, direction FROM hypothesis_pain_links ORDER BY pain_group_id'),
    [{ pain_group_id: g1, direction: 'supports' }, { pain_group_id: g2, direction: 'supports' }]);
  assert.deepEqual(logs(db).map((x) => [x.entity_type, x.entity_id, x.action]), [
    ['validate.experiments', String(r.body.id), 'hypothesis_created'],
    ['validate.problem-discovery', String(g1), 'hypothesis_linked'], ['validate.problem-discovery', String(g2), 'hypothesis_linked']]);
  const gB = group(db, P_B, 'Theirs');
  assert.equal((await cv(db, 'POST', '/hypotheses', { claim: 'X', pain_group_ids: [gB] })).status, 404);
  assert.equal((await cv(db, 'POST', '/hypotheses', { claim: 'X', owner_user_id: OTHER })).status, 400, 'an owner who does not own the venture');
  assert.equal((await cv(db, 'POST', '/hypotheses', { claim: 'X', owner_user_id: ADMIN })).status, 400, 'nor an admin');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM hypotheses').n, 1, 'a refused claim writes nothing');
});

test('14: two creates at once get distinct codes, though both reads happen before either insert', async () => {
  const db = fixture();
  hyp(db, P, 'H1');
  // Hold every read of the venture's highest code until both creates have
  // made one, which is exactly the interleaving a read-then-write allocator
  // loses: both read H1, both write H2, the second hits the unique index.
  let waiting: Array<() => void> = [];
  const base = d1Over(db);
  const DB = {
    ...base,
    prepare(sql: string) {
      const st = base.prepare(sql);
      if (!/MAX\(CAST\(substr\(code, 2\) AS INTEGER\)\)/.test(sql) || /^\s*INSERT/i.test(sql)) return st;
      return {
        bind: (...args: any[]) => {
          const bound = st.bind(...args);
          return { ...bound, first: async () => { await new Promise<void>((r) => { waiting.push(r); if (waiting.length === 2) { waiting.forEach((f) => f()); waiting = []; } }); return bound.first(); } };
        },
      };
    },
  };
  const env = { ...envOf(db), DB } as any;
  const out = await Promise.all([insertHypothesis(env, P, 'First', FOUNDER), insertHypothesis(env, P, 'Second', FOUNDER)]);
  assert.deepEqual(out.map((o) => o.code).sort(), ['H2', 'H3']);
  assert.equal(new Set(out.map((o) => o.id)).size, 2);
  // A hand-edited code stays out of the maximum, and a retired one still counts.
  db.prepare("INSERT INTO hypotheses (project_id, code, claim, retired_at) VALUES (?, 'H9', 'Old', '2026-01-01')").run(P);
  db.prepare("INSERT INTO hypotheses (project_id, code, claim) VALUES (?, 'Custom', 'Hand-coded')").run(P);
  assert.equal((await insertHypothesis(envOf(db), P, 'Next', FOUNDER)).code, 'H10');
  assert.equal((await insertHypothesis(envOf(db), P_B, 'Their first', OTHER)).code, 'H1', 'codes are per venture');
});

test('14: Retire then Restore round-trips; the PATCH and PUT /plan refuse an owner who does not own the venture', async () => {
  const db = fixture();
  const h = hyp(db, P, 'H1');
  assert.equal((await cv(db, 'PATCH', `/hypotheses/${h}`, { retired: true })).status, 200);
  assert.ok(one(db, 'SELECT retired_at FROM hypotheses').retired_at);
  assert.equal((await cv(db, 'PATCH', `/hypotheses/${h}`, { retired: false, success_bar: '3 of 5' })).status, 200);
  assert.deepEqual(one(db, 'SELECT retired_at, success_bar FROM hypotheses'), { retired_at: null, success_bar: '3 of 5' });
  assert.deepEqual(logs(db).map((x) => x.action), ['hypothesis_retired', 'hypothesis_restored']);
  assert.equal((await cv(db, 'PATCH', `/hypotheses/${h}`, { owner_user_id: STRANGER })).status, 400);
  assert.equal((await cv(db, 'PUT', `/hypotheses/${h}/plan`, { owner_user_id: STRANGER })).status, 400);
  assert.equal((await cv(db, 'PUT', `/hypotheses/${h}/plan`, { owner_user_id: FOUNDER })).status, 200);
  assert.equal(one(db, 'SELECT owner_user_id FROM hypotheses').owner_user_id, FOUNDER);
  assert.equal((await refused(setHypothesisPlan(envOf(db), { projectId: P, userId: FOUNDER, hypothesisId: h, owner_user_id: PARTNER }))).status, 400);
  assert.equal((await cv(db, 'PATCH', `/hypotheses/${h}`, { claim: 'Taken' }, OTHER, P_B)).status, 404, 'A\'s claim, read from B');
  assert.equal((await cv(db, 'PATCH', `/hypotheses/${h}`, { deadline: '31 Oct' })).status, 400);
});

// ---------------------------------------------------------------------------
// Test 15 — evidence
// ---------------------------------------------------------------------------

test('15: add-evidence with a KPI is returned by evidenceFor, labelled with its latest value; ids are unique, an interview behind two claims is two items', async () => {
  const db = fixture();
  const env = envOf(db);
  const ivA = interview(db, P, { pains: ['Slow dispatch'], date: '2026-10-01' });
  const g = group(db, P, 'Slow dispatch');
  const h1 = hyp(db, P, 'H1'), h2 = hyp(db, P, 'H2');
  db.exec(`INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction, strength) VALUES (${h1}, ${g}, 'supports', 'pattern'), (${h2}, ${g}, 'contradicts', NULL)`);
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, active_users) VALUES (?, '2026-09-01', 40), (?, '2026-10-01', 55)").run(P, P);
  const link = await addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h1, kind: 'metric', ref_id: 'active_users', direction: 'supports', strength: 'measured' });
  const sig = await cv(db, 'POST', '/demand-signals', { kind: 'pre_sale', amount_cents: 50_000 });
  await addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h1, kind: 'signal', ref_id: `signal-${sig.body.id}`, direction: 'supports' });
  const items = await evidenceFor({ env, projectId: P });
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'every id is unique across the venture');
  const behind = items.filter((i) => i.kind === 'interview' && i.ref_id === String(ivA));
  assert.deepEqual(behind.map((i) => [i.hypothesis_id, i.direction]).sort(), [[h1, 'supports'], [h2, 'contradicts']], 'one interview behind two claims is two items');
  assert.ok(behind.every((i) => /^pain-\d+-\d+$/.test(i.id) && /^pain-\d+$/.test(i.link)));
  const kpi = items.find((i) => i.kind === 'metric')!;
  assert.deepEqual({ id: kpi.id, link: kpi.link, label: kpi.label, strength: kpi.strength, date: kpi.date },
    { id: link.link, link: link.link, label: 'Active users · 55', strength: 'measured', date: '2026-10-01' });
  const s = items.find((i) => i.kind === 'signal')!;
  assert.equal(s.label, 'Pre-sale · 500 USD');
  assert.ok(logs(db).some((x) => x.entity_type === 'validate.demand-signals' && x.entity_id === `signal-${sig.body.id}` && x.action === 'evidence_linked'),
    'a signal linked as evidence logs on its own side, the row its Feeds reads');
  assert.deepEqual((await evidenceFor({ env, projectId: P }, { hypothesisId: h2 })).map((i) => i.hypothesis_id), [h2]);
  // Unlink each kind of link by the id evidenceFor gave.
  await unlinkEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h1, link: kpi.link });
  await unlinkEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h2, link: behind.find((i) => i.hypothesis_id === h2)!.link });
  assert.equal((await evidenceFor({ env, projectId: P })).filter((i) => i.kind === 'metric' || i.hypothesis_id === h2).length, 0);
  assert.equal((await refused(unlinkEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h1, link: 'evidence-999' }))).status, 404);
});

test('2 (writers): add-evidence refuses a B interview, signal or experiment, an investor sign-up, and a KPI never recorded; experiment-status refuses a B experiment', async () => {
  const db = fixture();
  const env = envOf(db);
  const h = hyp(db, P, 'H1');
  const hB = hyp(db, P_B, 'H1');
  const ivB = interview(db, P_B);
  const sigB = Number((db.prepare("INSERT INTO demand_signals (project_id, kind, signal_date) VALUES (?, 'loi', ?) RETURNING id").get(P_B, TODAY) as any).id);
  const investor = Number((db.prepare("INSERT INTO waitlist_signups (project_id, email, audience) VALUES (?, 'inv@example.test', 'investor') RETURNING id").get(P) as any).id);
  const exB = await addExperiment(env, { projectId: P_B, userId: OTHER, hypothesisId: hB, title: 'Their test' });
  for (const [kind, ref] of [['interview', ivB], ['signal', `signal-${sigB}`], ['signal', `waitlist-${investor}`], ['experiment', exB.id], ['metric', 'mrr'], ['metric', 'drop table']] as const) {
    const r = await refused(addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h, kind, ref_id: ref }));
    assert.equal(r.status, 404, `${kind} ${ref}`);
  }
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links').n, 0);
  const own = await addExperiment(env, { projectId: P, userId: FOUNDER, hypothesisId: h, title: 'Smoke test', method: 'Landing page', target: '40 sign-ups' });
  assert.equal((await refused(setExperimentStatus(env, { projectId: P, userId: FOUNDER, hypothesisId: h, experiment_id: exB.id, status: 'done' }))).status, 404);
  await setExperimentStatus(env, { projectId: P, userId: FOUNDER, hypothesisId: h, experiment_id: own.id, status: 'done', result: '52 sign-ups' });
  assert.deepEqual(one(db, 'SELECT status, result FROM hypothesis_experiments WHERE id = ?', own.id), { status: 'done', result: '52 sign-ups' });
  assert.equal((await refused(setExperimentStatus(env, { projectId: P, userId: FOUNDER, hypothesisId: h, experiment_id: own.id, status: 'won' }))).status, 400);
  const ev = await addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: h, kind: 'experiment', ref_id: own.id });
  assert.equal((await evidenceFor({ env, projectId: P })).find((i) => i.id === ev.link)!.label, 'Smoke test · 52 sign-ups');
});

test('2 (routes): another venture\'s record id with ?project=A answers 404 on every PATCH and DELETE, and on the audio route', async () => {
  const db = fixture();
  const gB = group(db, P_B, 'Theirs');
  const hB = hyp(db, P_B, 'H1');
  const segB = Number((db.prepare("INSERT INTO customer_segments (project_id, name, name_norm) VALUES (?, 'Theirs', 'theirs') RETURNING id").get(P_B) as any).id);
  const sigB = Number((db.prepare("INSERT INTO demand_signals (project_id, kind, signal_date) VALUES (?, 'loi', ?) RETURNING id").get(P_B, TODAY) as any).id);
  for (const [method, path] of [['PATCH', `/themes/${gB}`], ['DELETE', `/themes/${gB}`], ['PATCH', `/segments/${segB}`], ['PATCH', `/hypotheses/${hB}`], ['PATCH', `/demand-signals/signal-${sigB}`]] as const) {
    const r = await cv(db, method, path, { title: 'x', name: 'x', claim: 'x', who: 'x' });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
  assert.equal(one(db, 'SELECT title FROM pain_groups WHERE id = ?', gB).title, 'Theirs');
  // A partner and an investor never reach a write; the writer gate answers first.
  assert.equal((await cv(db, 'POST', '/themes', { title: 'x' }, PARTNER)).status, 403);
  assert.equal((await cv(db, 'POST', '/themes', { title: 'x' }, OTHER)).status, 403);
});

// ---------------------------------------------------------------------------
// Test 16 — audio
// ---------------------------------------------------------------------------

function session(db: DatabaseSync, interviewId: number, chunks: number[]) {
  const sid = Number((db.prepare(
    // A recording that holds audio was started with consent (D754: Open recording refuses one without it).
    "INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method) VALUES (?, ?, (SELECT project_id FROM discovery_interviews WHERE id = ?), ?, 'in_person', 'stopped', 'given', 'verbal') RETURNING id",
  ).get(`sess-${interviewId}-${chunks.length}`, interviewId, interviewId, FOUNDER) as any).id);
  for (const seq of chunks) {
    db.prepare("INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, start_ms) VALUES (?, ?, ?, 'audio/webm', 100, ?)")
      .run(sid, seq, `validate-audio/${FOUNDER}/sess/${seq}.webm`, seq * 30_000);
  }
  return sid;
}

test('16: Open recording gives a writer one signed URL per chunk in seq order; a partner and a session with no chunk get 404', async () => {
  const db = fixture();
  const iv = interview(db, P);
  const sid = session(db, iv, [2, 0, 1]);
  const r = await call(db, FOUNDER, 'GET', `/api/founder/validate/sessions/${sid}/audio`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.parts.map((p: any) => [p.seq, p.start_ms, p.mime]), [[0, 0, 'audio/webm'], [1, 30000, 'audio/webm'], [2, 60000, 'audio/webm']]);
  for (const p of r.body.parts) {
    assert.match(p.url, /^\/api\/files\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const payload = JSON.parse(Buffer.from(p.url.split('/').pop().split('.')[0], 'base64url').toString());
    assert.equal(payload.aud, `validate-audio:sess-${iv}-3`);
    assert.ok(payload.exp - Math.floor(Date.now() / 1000) <= 120);
  }
  assert.equal(new Set(r.body.parts.map((p: any) => p.url)).size, 3);
  assert.equal((await call(db, PARTNER, 'GET', `/api/founder/validate/sessions/${sid}/audio`)).status, 404);
  assert.equal((await call(db, OTHER, 'GET', `/api/founder/validate/sessions/${sid}/audio`)).status, 404, 'a session of A\'s interview, asked by B');
  const empty = session(db, iv, []);
  const e = await call(db, FOUNDER, 'GET', `/api/founder/validate/sessions/${empty}/audio`);
  assert.deepEqual([e.status, e.body.detail], [404, 'This session has no recorded audio.']);
  db.prepare("UPDATE interview_session_chunks SET r2_key = 'elsewhere/x.webm' WHERE session_id = ? AND seq = 1").run(sid);
  assert.equal((await call(db, FOUNDER, 'GET', `/api/founder/validate/sessions/${sid}/audio`)).status, 502, 'a key outside validate-audio/ signs nothing');
});

// ---------------------------------------------------------------------------
// Test 17 — migration 460
// ---------------------------------------------------------------------------

test('17: 460 adds no column that any other migration or the baseline already has, and cascades with the venture', async () => {
  const added: Array<[string, string]> = [];
  for (const stmt of splitStatements(MIG460)) {
    const m = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(stmt);
    if (m) added.push([m[1], m[2]]);
  }
  assert.equal(added.length, 14);
  const dir = resolve(ROOT, 'cloudflare-worker/sql/migrations');
  const others = readdirSync(dir).filter((f) => f.endsWith('.sql') && f !== '460_validate_record_stores.sql').map((f) => readFileSync(resolve(dir, f), 'utf8'));
  for (const [table, col] of added) {
    // customer_segments and demand_signals are 440's, not the baseline's; 440's CREATE is checked below.
    if (BASELINE.includes(`CREATE TABLE ${table} (`) || BASELINE.includes(`CREATE TABLE "${table}"`)) {
      assert.doesNotMatch(tableFromBaseline(BASELINE, table), new RegExp(`\\b${col}\\b`), `${table}.${col} is in the baseline`);
    }
    for (const sql of others) {
      for (const stmt of splitStatements(sql)) {
        const m = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(stmt);
        assert.ok(!(m && m[1] === table && m[2] === col), `${table}.${col} is added by another migration`);
        const create = new RegExp(`^CREATE TABLE (IF NOT EXISTS )?"?${table}"?\\s*\\(`).test(stmt);
        assert.ok(!(create && new RegExp(`\\b${col}\\b`).test(stmt)), `${table}.${col} is in another migration's CREATE`);
      }
    }
  }
  for (const t of ['hypothesis_experiments', 'hypothesis_evidence_links', 'competitor_tracking']) {
    for (const sql of others) assert.doesNotMatch(sql, new RegExp(`\\b${t}\\b`), `${t} appears in another migration`);
  }
  // Over a fresh database, and with foreign keys on, hardDeleteProject still removes the venture.
  const db = fixture({ fk: true });
  const h = hyp(db, P, 'H1');
  db.prepare("INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title) VALUES ('ex-1', ?, ?, 'Smoke')").run(P, h);
  db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('ev-1', ?, ?, 'metric', 'mrr', 'supports')").run(P, h);
  db.prepare("INSERT INTO competitor_tracking (uid, project_id, name_norm) VALUES ('ct-1', ?, 'routewise')").run(P);
  // Deleting the claim alone takes its experiments and evidence with it.
  const h2 = hyp(db, P, 'H2');
  db.prepare("INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title) VALUES ('ex-2', ?, ?, 'Gone')").run(P, h2);
  db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('ev-2', ?, ?, 'metric', 'mrr', 'supports')").run(P, h2);
  db.prepare('DELETE FROM hypotheses WHERE id = ?').run(h2);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM hypothesis_experiments WHERE uid = 'ex-2'").n, 0);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM hypothesis_evidence_links WHERE uid = 'ev-2'").n, 0);
  await hardDeleteProject(envOf(db), P);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM projects WHERE id = ?', P).n, 0);
  for (const t of ['hypothesis_experiments', 'hypothesis_evidence_links', 'competitor_tracking']) {
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM ${t}`).n, 0, t);
  }
});

// ---------------------------------------------------------------------------
// Test 19 — Edit details
// ---------------------------------------------------------------------------

test('19: edit-details changes the name and company only, refuses an empty name, and logs a row that names no interviewee', async () => {
  const db = fixture();
  const env = envOf(db);
  const iv = interview(db, P, { name: 'Rhea Quill', company: 'Old Co', role: 'Ops lead', date: '2026-09-30', pains: ['Slow dispatch'],
    hyps: [4], notes: 'Kept notes', fit: 'strong', consent: 1 });
  const before = one(db, 'SELECT * FROM discovery_interviews WHERE id = ?', iv);
  await updateInterviewDetails(env, { projectId: P, userId: FOUNDER, interviewId: iv, interviewee_name: '  Rhea Q. ', interviewee_company: 'Northwind' });
  const after = one(db, 'SELECT * FROM discovery_interviews WHERE id = ?', iv);
  for (const k of Object.keys(before)) {
    if (k === 'interviewee_name') assert.equal(after[k], 'Rhea Q.');
    else if (k === 'interviewee_company') assert.equal(after[k], 'Northwind');
    else if (k === 'updated_at') continue;
    else assert.deepEqual(after[k], before[k], `${k} is unchanged`);
  }
  await updateInterviewDetails(env, { projectId: P, userId: FOUNDER, interviewId: iv, interviewee_name: 'Rhea Q.', interviewee_company: '  ' });
  assert.equal(one(db, 'SELECT interviewee_company FROM discovery_interviews').interviewee_company, null, 'an empty company is NULL');
  const n = logs(db).length;
  assert.equal((await refused(updateInterviewDetails(env, { projectId: P, userId: FOUNDER, interviewId: iv, interviewee_name: '   ' }))).status, 400);
  assert.equal(one(db, 'SELECT interviewee_name FROM discovery_interviews').interviewee_name, 'Rhea Q.');
  assert.equal(logs(db).length, n, 'a refusal logs nothing');
  const l = logs(db).filter((x) => x.action === 'interview_details_edited');
  assert.equal(l.length, 2);
  assert.ok(l.every((x) => x.entity_type === 'validate.customer-research' && x.entity_id === String(iv) && !/Rhea|Northwind/.test(x.details)));
  assert.equal((await refused(updateInterviewDetails(env, { projectId: P_B, userId: OTHER, interviewId: iv, interviewee_name: 'Taken' }))).status, 404);
  // delete: the interview goes, scoped to its venture, and logs.
  assert.equal((await refused(deleteInterview(env, { projectId: P_B, userId: OTHER, interviewId: iv }))).status, 404);
  assert.deepEqual(await deleteInterview(env, { projectId: P, userId: FOUNDER, interviewId: iv }), { deleted: iv, sessions_deleted: 0 });
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM discovery_interviews').n, 0);
});

test('12/segments: New segment stores its five steps; Edit keeps what it is not sent and refuses a bad urgency or date', async () => {
  const db = fixture();
  const r = await cv(db, 'POST', '/segments', { name: 'Regional fleets', who_they_are: 'Ops leads at 20-200 truck fleets', job_to_be_done: 'Dispatch on time',
    urgency: 'high', value_promised: 'An hour a day back', score_since: '2026-09-01' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(one(db, 'SELECT who_they_are, context, job_to_be_done, urgency, value_promised, value_source, score_since FROM customer_segments'),
    { who_they_are: 'Ops leads at 20-200 truck fleets', context: null, job_to_be_done: 'Dispatch on time', urgency: 'high', value_promised: 'An hour a day back', value_source: null, score_since: '2026-09-01' });
  const id = r.body.id;
  assert.equal((await cv(db, 'PATCH', `/segments/${id}`, { value_source: 'Pilot with two fleets' })).status, 200);
  assert.deepEqual(one(db, 'SELECT urgency, value_source FROM customer_segments'), { urgency: 'high', value_source: 'Pilot with two fleets' });
  assert.equal((await cv(db, 'PATCH', `/segments/${id}`, { urgency: 'urgent' })).status, 400);
  assert.equal((await cv(db, 'PATCH', `/segments/${id}`, { score_since: 'last month' })).status, 400);
  await cv(db, 'POST', '/segments', { name: 'Couriers' });
  assert.equal((await cv(db, 'PATCH', `/segments/${id}`, { name: 'couriers' })).status, 409);
});
