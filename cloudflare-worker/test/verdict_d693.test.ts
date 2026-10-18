/**
 * D693 (#1702, part 1 of 3) — Verdict's store, writer and the old routes, on
 * real SQLite: the baseline's own tables, migrations 440 and 464 over them,
 * the routes mounted on a bare Hono. #1703 and #1704 extend this file; each
 * test's number means the same in all three parts.
 *
 * Part 1 adds tests 1, 2, 3, 5, 7 and 10, and the parts of 6, 8, 9 and 11 its
 * routes answer. Part 2's first PR adds 13 and 14, the record's parts of 6 and
 * 8, and runs 1 and 7 again over the record and `logCycleWrite`. Part 3's
 * Worker PR adds test 12's card and table, read through `verdictCard` and
 * `decisionRecords` before they join the module lists. Every venture and
 * person below is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleVerdict from '../src/routes/cycle_verdict.ts';
import founderValidate from '../src/routes/founder_validate.ts';
import {
  recordDecision, currentDecision, decisionsFor, decisionById, DECISION_EVIDENCE_BAR, NO_EVIDENCE_REASON,
  VerdictError, adaptEvidenceReader, evidenceFor, verdictCard, decisionRecords, TIMELINE_CAP,
  type EvidenceItem, type EvidenceSource, type PivotStatements,
} from '../src/services/verdict.ts';
import { recordQuery } from '../src/services/cycleValidate.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { ensurePainGroupsSchema } from '../src/services/painGroups.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleValidateRoute from '../src/routes/cycle_validate.ts';
import { verdictSpec } from '../src/services/records/verdict.ts';
import { createHypothesis } from '../src/services/validateWriters.ts';
import { evidenceFor as validateEvidenceFor } from '../src/services/validateEvidence.ts';
import { activityFor } from '../src/services/cycleActivity.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const SQL_DIR = resolve(ROOT, 'cloudflare-worker/sql');
const BASELINE = readFileSync(join(SQL_DIR, 'schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(join(SQL_DIR, 'migrations', file), 'utf8');
const MIG464 = sqlOf('464_verdict_decisions.sql');

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50, LAB = 60, ADVISOR = 70;
const P = 1, P_OTHER = 2, P_LAB = 3;
const roleOf: Record<number, string> = {
  [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner',
  [INVESTOR]: 'investor', [LAB]: 'exploring', [ADVISOR]: 'advisor',
};
const userOf = (id: number) => ({ id, role: roleOf[id] }) as any;

const TABLES = [
  'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
  'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
  'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validation_decisions',
  'mvp_features', 'roadmap_okrs',
];

function fixture({ fk = false }: { fk?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  db.exec(MIG464);
  // #1703: #1690's convention (`created_by` and the activity index).
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  // #1704 PR A: #1692's `hypotheses.deadline`, the card's Next. #1703: the
  // real evidence reader's `hypothesis_evidence_links` and the Pivot's
  // createHypothesis columns. Applied once: its ALTERs cannot run twice.
  db.exec(sqlOf('460_validate_record_stores.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 0);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002, 0);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null, 0);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null, 0);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null, 0);
  // An admitted Lab member keeps an `exploring` role and owns their venture.
  u.run(LAB, 'exploring', 'Lou Lab', 'lou@example.test', 1003, 1);
  u.run(ADVISOR, 'advisor', 'Ari Advisor', 'ari@example.test', null, 0);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Dispatch', 1001), (${P_OTHER}, 'Beta Freight', 1002), (${P_LAB}, 'Lab venture', 1003)`);
  // Foreign keys are switched on after the seed: `users` references tables
  // this fixture does not build, and only the rows written from here on are
  // checked.
  if (fk) {
    // A parent table the fixture does not build is stubbed, so SQLite can
    // resolve every foreign key the delete touches.
    const built = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as any[]).map((r) => r.name));
    const sqls = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL`).all() as any[]).map((r) => String(r.sql));
    for (const sql of sqls) {
      for (const m of sql.matchAll(/REFERENCES\s+"?(\w+)"?/gi)) {
        if (!built.has(m[1])) { db.exec(`CREATE TABLE "${m[1]}" (id INTEGER PRIMARY KEY)`); built.add(m[1]); }
      }
    }
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

const envOf = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

const app = new Hono<any>();
app.route('/api/cycles/validate/decisions', cycleVerdict);
app.route('/api/founder/validate', founderValidate);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const env = envOf(db);
  await ensurePainGroupsSchema(env);
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally { [console.warn, console.error] = saved; }
}
const post = (db: any, who: number, body: unknown, pid = P) => call(db, who, 'POST', `/api/cycles/validate/decisions?project=${pid}`, body);
const oldGet = (db: any, who: number, pid = P) => call(db, who, 'GET', `/api/founder/validate/decision/${pid}`);
const oldPost = (db: any, who: number, body: unknown, pid = P) => call(db, who, 'POST', `/api/founder/validate/decision/${pid}`, body);
const summaryCsv = (db: any, who: number, pid = P) => call(db, who, 'GET', `/api/founder/validate/summary/${pid}/export.csv`);

function hypothesis(db: any, pid: number, code: string, claim = `${code} claim`) {
  const r = db.prepare('INSERT INTO hypotheses (project_id, code, claim) VALUES (?, ?, ?) RETURNING id').get(pid, code, claim) as any;
  return Number(r.id);
}

/** Made-up evidence items, keyed the way #1692 names them. */
function items(n: number, { contradicting = 0, prefix = 'evidence' } = {}): EvidenceItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`, kind: 'hypothesis_evidence', label: `Item ${i + 1} · H1`,
    strength: 'measured', direction: i < contradicting ? 'contradicts' : 'supports', date: '2026-10-12',
  }));
}
const fixed = (list: EvidenceItem[]): EvidenceSource => async () => list;
const keys = (list: EvidenceItem[]) => list.map((i) => i.id);

const rows = (db: any, pid = P) => db.prepare('SELECT * FROM validation_decisions WHERE project_id = ? ORDER BY id').all(pid) as any[];
const current = (db: any, pid = P) => rows(db, pid).filter((r) => r.state === 'given' && !r.superseded_at);

// ---------------------------------------------------------------------------
// 1. Migration
// ---------------------------------------------------------------------------

test('1: none of 464\'s columns or tables exists in the baseline or an earlier migration', () => {
  const names = ['hypothesis_id', 'supersedes_id', 'pivot_hypothesis_id', 'validation_decision_evidence', 'validation_decision_commitments'];
  // validation_decisions' own DDL, in the baseline and in 211, has none of them.
  const ddl = (src: string) => {
    const at = src.indexOf('CREATE TABLE');
    let i = src.indexOf('validation_decisions (', at);
    while (i >= 0 && !/CREATE TABLE (IF NOT EXISTS )?$/.test(src.slice(Math.max(0, i - 30), i))) i = src.indexOf('validation_decisions (', i + 1);
    assert.ok(i >= 0, 'validation_decisions DDL found');
    return src.slice(i, src.indexOf(');', i));
  };
  for (const col of ['hypothesis_id', 'supersedes_id', 'state', 'pivot_hypothesis_id']) {
    assert.equal(new RegExp(`\\b${col}\\b`).test(ddl(BASELINE)), false, `${col} in the baseline's validation_decisions`);
    assert.equal(new RegExp(`\\b${col}\\b`).test(ddl(sqlOf('211_founder_validate_evidence.sql'))), false, `${col} in 211`);
  }
  for (const t of ['validation_decision_evidence', 'validation_decision_commitments', 'idx_validation_decisions_scope']) {
    assert.equal(BASELINE.includes(t), false, `${t} in the baseline`);
  }
  const earlier = readdirSync(join(SQL_DIR, 'migrations')).filter((f) => f.endsWith('.sql') && f < '464');
  for (const f of earlier) {
    const src = sqlOf(f);
    for (const n of names.slice(3)) assert.equal(src.includes(n), false, `${n} in ${f}`);
    assert.equal(/ALTER TABLE validation_decisions/.test(src), false, `${f} alters validation_decisions`);
  }
  // And it applies over the fixture (baseline tables, then 464).
  const db = fixture();
  const cols = (db.prepare('PRAGMA table_info(validation_decisions)').all() as any[]).map((c) => c.name);
  for (const c of ['hypothesis_id', 'supersedes_id', 'state', 'pivot_hypothesis_id']) assert.ok(cols.includes(c), c);
});

test('1: a pre-464 row reads as a given decision for the venture, with no evidence and the reason why', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (${FOUNDER}, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001)`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Dispatch', 1001)`);
  db.exec(`INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by) VALUES (${P}, 'proceed', 'old page', ${FOUNDER})`);
  db.exec(MIG464); // applied over the existing row
  const env = envOf(db);
  const cur = await currentDecision(env, P, 'venture');
  assert.equal(cur?.decision, 'proceed');
  assert.equal(cur?.state, 'given');
  assert.equal(cur?.hypothesis_id, null);
  const rec = await decisionById(env, P, Number(cur!.id));
  assert.deepEqual(rec?.evidence, []);
  assert.equal(rec?.evidence_count, 0);
  assert.equal(NO_EVIDENCE_REASON, 'Recorded on the earlier verdict page, which kept no evidence.');
});

test('1: deleting a project with a hypothesis\'s decision, its evidence and a commitment leaves no row, foreign keys on', async () => {
  const db = fixture({ fk: true });
  const env = envOf(db);
  const h = hypothesis(db, P, 'H1');
  const r = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: h, evidence: keys(items(5)) }, { evidenceSource: fixed(items(5)) });
  await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'stop', for: h, evidence: keys(items(5)) }, { evidenceSource: fixed(items(5)) });
  db.prepare(`INSERT INTO validation_decision_commitments (uid, decision_id, project_id, text, owner_user_id, created_by)
              VALUES ('c-1', ?, ?, 'Call five carriers', ?, ?)`).run(r.id, P, FOUNDER, FOUNDER);
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM validation_decision_evidence').get() as any).n >= 5);
  await hardDeleteProject(env, P);
  for (const t of ['validation_decisions', 'validation_decision_evidence', 'validation_decision_commitments']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n, 0, t);
  }
  assert.equal(db.prepare('SELECT id FROM projects WHERE id = ?').get(P), undefined);
});

// ---------------------------------------------------------------------------
// 2. Withheld · 3. Scope
// ---------------------------------------------------------------------------

test('2: below the bar a decision is withheld, changes no verdict and supersedes nothing; at the bar it is given', async () => {
  assert.equal(DECISION_EVIDENCE_BAR, 5);
  const db = fixture();
  const env = envOf(db);
  const given = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'stop', for: 'venture', evidence: keys(items(5)) }, { evidenceSource: fixed(items(5)) });
  assert.equal(given.state, 'given');

  const four = items(4, { contradicting: 1 });
  const w = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', evidence: keys(four) }, { evidenceSource: fixed(four) });
  assert.equal(w.state, 'withheld');
  assert.equal(w.supersedes_id, null);
  assert.equal((await currentDecision(env, P, 'venture'))?.id, given.id, 'the current verdict is unchanged');
  assert.equal(rows(db).find((r) => r.id === given.id).superseded_at, null, 'nothing was superseded');

  const five = items(5, { contradicting: 2 });
  const g = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', evidence: keys(five) }, { evidenceSource: fixed(five) });
  assert.equal(g.state, 'given');
  assert.equal(g.supersedes_id, given.id);
  assert.equal((await currentDecision(env, P, 'venture'))?.id, g.id);
});

test('3: a decision supersedes only its own scope, and two in one scope leave one current and a chain', async () => {
  const db = fixture();
  const env = envOf(db);
  const h2 = hypothesis(db, P, 'H2');
  const ev = fixed(items(5));
  const rec = (d: string, f: any) => recordDecision(env, userOf(FOUNDER), { id: P }, { decision: d, for: f, evidence: keys(items(5)) }, { evidenceSource: ev });

  const v1 = await rec('proceed', 'venture');
  const hA = await rec('pivot', h2);
  assert.equal((await currentDecision(env, P, 'venture'))?.id, v1.id, 'H2\'s decision left the venture\'s current');
  const v2 = await rec('stop', 'venture');
  assert.equal((await currentDecision(env, P, h2))?.id, hA.id, 'the venture\'s decision left H2\'s current');
  assert.equal(v2.supersedes_id, v1.id);
  assert.equal(hA.supersedes_id, null);
  assert.equal(current(db).filter((r) => r.hypothesis_id === null).length, 1);

  const hB = await rec('proceed', h2);
  assert.equal(hB.supersedes_id, hA.id);
  assert.equal(current(db).filter((r) => r.hypothesis_id === h2).length, 1);
});

test('3: two decisions recorded at once leave exactly one current and a correct chain', async () => {
  const db = fixture();
  const env = envOf(db);
  const ev = fixed(items(5));
  const rec = (d: string) => recordDecision(env, userOf(FOUNDER), { id: P }, { decision: d, for: 'venture', evidence: keys(items(5)) }, { evidenceSource: ev });
  const [a, b] = await Promise.all([rec('proceed'), rec('stop')]);
  assert.equal(current(db).length, 1);
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  assert.equal(first.supersedes_id, null);
  assert.equal(second.supersedes_id, first.id);
});

test('3: a venture seeded with two current legacy rows has one current after the next given decision', async () => {
  const db = fixture();
  const env = envOf(db);
  db.exec(`INSERT INTO validation_decisions (project_id, decision, decided_by, decided_at) VALUES (${P}, 'proceed', ${FOUNDER}, '2026-07-14 10:00:00'), (${P}, 'pivot', ${FOUNDER}, '2026-09-03 10:00:00')`);
  assert.equal(current(db).length, 2);
  assert.equal((await currentDecision(env, P, 'venture'))?.decision, 'pivot', 'the reader takes the newest');
  const r = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', evidence: keys(items(5)) }, { evidenceSource: fixed(items(5)) });
  assert.deepEqual(current(db).map((x) => x.id), [r.id]);
  assert.equal(r.supersedes_id, rows(db).find((x) => x.decision === 'pivot').id);
});

// ---------------------------------------------------------------------------
// 5. Evidence, through the seam
// ---------------------------------------------------------------------------

/** Fixture statements only; the production default remains unwired in this part. */
const pivotStatements: PivotStatements = (env, { projectId, claim, userId }) => [
  env.DB.prepare(
    `INSERT INTO hypotheses (project_id, code, claim, created_by)
     SELECT ?, 'H' || (COALESCE(MAX(CAST(substr(code, 2) AS INTEGER)), 0) + 1), ?, ?
       FROM hypotheses WHERE project_id = ? RETURNING id`,
  ).bind(projectId, claim, userId, projectId),
  env.DB.prepare('SELECT id FROM hypotheses WHERE project_id = ? ORDER BY id DESC LIMIT 1').bind(projectId),
];

test('4: given and withheld Pivots create their claim and return its stored id in the same batch', async () => {
  const db = fixture();
  const env = envOf(db);
  hypothesis(db, P, 'H1');
  hypothesis(db, P_OTHER, 'H99');
  // Make decision ids differ from hypothesis ids: reading the builder's
  // RETURNING row instead of the decision's must not accidentally pass.
  await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture' });
  for (const n of [5, 1]) {
    const ev = items(n);
    const claim = `Dispatch claim ${n}`;
    const result = await recordDecision(env, userOf(FOUNDER), { id: P }, {
      decision: 'pivot', for: 'venture', evidence: keys(ev), pivot_claim: claim,
    }, { evidenceSource: fixed(ev), pivotStatements });
    const created = db.prepare('SELECT id, project_id, claim, created_by FROM hypotheses WHERE claim = ?').get(claim) as any;
    assert.deepEqual({ ...created }, { id: result.pivot_hypothesis_id, project_id: P, claim, created_by: FOUNDER });
    assert.ok(result.pivot_hypothesis_id);
    const saved = rows(db).find((r) => r.id === result.id);
    assert.equal(saved.pivot_hypothesis_id, created.id);
    assert.equal(saved.decision, 'pivot');
    assert.equal(result.state, n === 5 ? 'given' : 'withheld');
    assert.equal(result.supersedes_id, null);
    assert.equal(saved.superseded_at, null);
  }
  assert.equal(current(db).length, 1);
});

test('4: a failed decision insert rolls back the Pivot hypothesis and all activity', async () => {
  for (const bar of [0, 5]) {
    const db = fixture();
    const env = envOf(db);
    // The fixture rejects the decision after the hypothesis INSERT has run.
    db.exec("CREATE TRIGGER reject_decision BEFORE INSERT ON validation_decisions BEGIN SELECT RAISE(ABORT, 'fixture rejects decision'); END");
    await assert.rejects(recordDecision(env, userOf(FOUNDER), { id: P }, {
      decision: 'pivot', for: 'venture', pivot_claim: 'Dispatch by phone',
    }, { bar, pivotStatements }), /fixture rejects decision/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n, 0);
    assert.equal(rows(db).length, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
  }
});

test('4: claims without Pivot are refused before the builder; a Pivot without a claim never invokes it', async () => {
  const db = fixture();
  const env = envOf(db);
  hypothesis(db, P, 'H1');
  const builder: PivotStatements = () => { throw new Error('builder must not run'); };
  for (const decision of ['proceed', 'stop']) {
    await assert.rejects(recordDecision(env, userOf(FOUNDER), { id: P }, {
      decision, for: 'venture', pivot_claim: 'Dispatch by phone',
    }, { pivotStatements: builder }),
    (e: any) => e instanceof VerdictError && e.status === 400 && e.sentence === 'Only a Pivot starts a new hypothesis.');
  }
  const result = await recordDecision(env, userOf(FOUNDER), { id: P }, {
    decision: 'pivot', for: 'venture',
  }, { pivotStatements: builder });
  assert.equal(result.pivot_hypothesis_id, null);
  assert.equal(rows(db)[0].pivot_hypothesis_id, null);
  assert.equal(rows(db).length, 1);
});

/**
 * A stand-in for #1692's `evidenceFor`, over this fixture: one item per
 * interview behind a pain link, keyed by the link, labelled by its claim.
 */
const fromLinks = adaptEvidenceReader(async ({ env, projectId }) => {
  const res = await env.DB.prepare(
    `SELECT l.id AS link_id, i.id AS interview_id, i.interviewee_name AS name, i.interview_date AS d, h.code, h.id AS hypothesis_id
       FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
       JOIN pain_groups g ON g.id = l.pain_group_id
       JOIN discovery_interviews i ON i.project_id = h.project_id
      WHERE h.project_id = ? ORDER BY l.id, i.id`,
  ).bind(projectId).all<any>();
  return (res.results || []).map((r: any) => ({
    id: `pain-${r.link_id}-${r.interview_id}`, link: `pain-${r.link_id}`, ref_id: String(r.interview_id),
    hypothesis_id: r.hypothesis_id, kind: 'interview', label: `${r.name} · ${r.code}`,
    strength: 'anecdote', direction: 'supports', date: r.d,
  }));
});

function painLinkSetup(db: any) {
  const h1 = hypothesis(db, P, 'H1');
  const h2 = hypothesis(db, P, 'H2');
  const g = db.prepare(`INSERT INTO pain_groups (project_id, title) VALUES (?, 'slow dispatch') RETURNING id`).get(P) as any;
  const iv = db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date) VALUES (?, 'Rae Carrier', '2026-10-01') RETURNING id`).get(P) as any;
  const l1 = db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'supports') RETURNING id").get(h1, g.id) as any;
  const l2 = db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'supports') RETURNING id").get(h2, g.id) as any;
  return { h1, h2, iv: Number(iv.id), l1: Number(l1.id), l2: Number(l2.id) };
}

test('5: a key that is not this venture\'s answers 404 and nothing is written', async () => {
  const db = fixture();
  const env = envOf(db);
  const ours = items(5);
  const theirs: EvidenceItem[] = items(1, { prefix: 'beta' });
  const source = adaptEvidenceReader(async ({ projectId }) => (projectId === P ? ours : theirs).map((it) => ({
    ...it, kind: 'interview' as const, link: it.id, ref_id: '1', hypothesis_id: 1,
  })));
  await assert.rejects(
    recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', evidence: [...keys(ours).slice(0, 4), 'beta-1'] }, { evidenceSource: source }),
    (e: any) => e instanceof VerdictError && e.status === 404 && e.sentence === 'Evidence not found.',
  );
  assert.equal(rows(db).length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM validation_decision_evidence').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
  // Through the route, which has no evidence until #1703: every key is unknown.
  const r = await post(db, FOUNDER, { decision: 'proceed', for: 'venture', evidence: ['evidence-1'] });
  assert.equal(r.status, 404);
  assert.equal(r.body.detail, 'Evidence not found.');
  assert.equal(rows(db).length, 0);
});

test('5: each stored item keeps its label, strength, direction and date after its source is edited', async () => {
  const db = fixture();
  const env = envOf(db);
  const { iv, l1, l2 } = painLinkSetup(db);
  const ev = await fromLinks(env, P);
  // An interview behind two claims is two items with two keys.
  assert.deepEqual(ev.map((i) => i.id), [`pain-${l1}-${iv}`, `pain-${l2}-${iv}`]);
  const r = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', evidence: keys(ev) }, { evidenceSource: fromLinks });
  db.prepare(`UPDATE discovery_interviews SET interviewee_name = 'Renamed', interview_date = '2026-10-15' WHERE id = ?`).run(iv);
  const rec = await decisionById(env, P, r.id);
  assert.deepEqual(rec!.evidence.map((e) => [e.ref_id, e.label, e.strength, e.direction, e.on_date]), [
    [`pain-${l1}-${iv}`, 'Rae Carrier · H1', 'anecdote', 'supports', '2026-10-01'],
    [`pain-${l2}-${iv}`, 'Rae Carrier · H2', 'anecdote', 'supports', '2026-10-01'],
  ]);
});

// ---------------------------------------------------------------------------
// 6. Who · 8. Ownership
// ---------------------------------------------------------------------------

test('6: a partner, an advisor, an investor and another venture\'s founder are refused every decision route', async () => {
  const db = fixture();
  await oldPost(db, FOUNDER, { decision: 'proceed', reasoning: 'Carriers pay for it' });
  for (const who of [PARTNER, ADVISOR, INVESTOR, OTHER]) {
    const p = await post(db, who, { decision: 'stop', for: 'venture' });
    assert.equal(p.status, 403, `${roleOf[who]} POST /decisions`);
    const g = await oldGet(db, who);
    assert.equal(g.status, 403, `${roleOf[who]} old GET`);
    assert.equal(g.text.includes('Carriers pay for it'), false);
    const c = await summaryCsv(db, who);
    assert.equal(c.status, 403, `${roleOf[who]} summary CSV`);
    const o = await oldPost(db, who, { decision: 'stop' });
    assert.equal(o.status, 403, `${roleOf[who]} old POST`);
  }
  assert.equal(rows(db).length, 1, 'no refused caller wrote a decision');
});

test('6: the founder, an admitted Lab member on their own venture and an admin read and write them', async () => {
  const db = fixture();
  for (const [who, pid] of [[FOUNDER, P], [ADMIN, P], [LAB, P_LAB]] as const) {
    const p = await post(db, who, { decision: 'proceed', for: 'venture' }, pid);
    assert.equal(p.status, 201, `${roleOf[who]} POST ${JSON.stringify(p.body)}`);
    assert.equal(p.body.state, 'withheld');
    assert.deepEqual(Object.keys(p.body).sort(), ['id', 'pivot_hypothesis_id', 'state', 'supersedes_id']);
    assert.equal((await oldGet(db, who, pid)).status, 200, `${roleOf[who]} old GET`);
    assert.equal((await summaryCsv(db, who, pid)).status, 200, `${roleOf[who]} CSV`);
  }
});

test('8: a hypothesis of another venture answers 404, and nothing is written', async () => {
  const db = fixture();
  const theirs = hypothesis(db, P_OTHER, 'H1');
  const r = await post(db, FOUNDER, { decision: 'pivot', for: `h-${theirs}` });
  assert.equal(r.status, 404);
  assert.equal(r.body.detail, 'Hypothesis not found.');
  assert.equal(rows(db).length + rows(db, P_OTHER).length, 0);
});

test('the route refuses a malformed body in the documented order', async () => {
  const db = fixture();
  const h = hypothesis(db, P, 'H1');
  const cases: [unknown, number, string][] = [
    [{ decision: 'maybe', for: 'venture' }, 400, 'decision must be proceed, pivot or stop'],
    [{ decision: 'proceed', for: 'H1' }, 400, "for must be 'venture' or 'h-<id>'"],
    [{ decision: 'proceed', for: 'venture', evidence: Array.from({ length: 51 }, (_, i) => `k-${i}`) }, 400, 'A decision rests on at most 50 pieces of evidence.'],
    [{ decision: 'proceed', for: 'venture', reasoning: 'x'.repeat(4001) }, 400, 'Reasoning must be 4,000 characters or fewer.'],
    [{ decision: 'proceed', for: `h-${h}`, pivot_claim: 'Carriers want a phone app' }, 400, 'Only a Pivot starts a new hypothesis.'],
  ];
  for (const [body, status, detail] of cases) {
    const r = await post(db, FOUNDER, body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal(r.body.detail, detail);
  }
  assert.equal((await post(db, FOUNDER, { decision: 'proceed', for: 'venture' }, 999)).status, 404);
  assert.equal((await call(db, FOUNDER, 'POST', '/api/cycles/validate/decisions?project=x', {})).status, 400);
  assert.equal(rows(db).length, 0);
});

// ---------------------------------------------------------------------------
// 7. Activity
// ---------------------------------------------------------------------------

test('7: a decision logs one validate.verdict row; a superseding one also logs on the one it replaced; a withheld one does not', async () => {
  const db = fixture();
  const env = envOf(db);
  const h2 = hypothesis(db, P, 'H2');
  const ev = fixed(items(5));
  const SECRET = 'Margins collapse below forty carriers';
  const first = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'pivot', for: h2, reasoning: SECRET, evidence: keys(items(5)) }, { evidenceSource: ev });
  const second = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: h2, reasoning: SECRET, evidence: keys(items(5)) }, { evidenceSource: ev });
  const withheld = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'stop', for: 'venture', reasoning: SECRET }, { evidenceSource: ev });

  const log = db.prepare(`SELECT action, details, entity_type, entity_id, user_id, actor FROM activity_logs ORDER BY id`).all() as any[];
  assert.deepEqual(log.map((r) => [r.action, r.entity_id, r.details]), [
    ['validation_decision_recorded', String(first.id), 'Recorded Pivot for H2'],
    ['validation_decision_recorded', String(second.id), 'Recorded Proceed for H2'],
    ['validation_decision_superseded', String(first.id), 'Superseded by Proceed'],
    ['validation_decision_recorded', String(withheld.id), 'Recorded Stop for the venture, withheld'],
  ]);
  for (const r of log) {
    assert.equal(r.entity_type, 'validate.verdict');
    assert.equal(r.user_id, FOUNDER);
    assert.equal(r.actor, `user:${FOUNDER}`);
    assert.equal(String(r.details).includes(SECRET), false, 'no summary holds the reasoning');
  }
  // Nothing is logged against the hypothesis a decision was For.
  assert.equal(log.some((r) => r.entity_id === `h-${h2}` || String(r.entity_type).startsWith('validate.experiments')), false);
});

// ---------------------------------------------------------------------------
// 9. Failures · 10. One reader · 11. The old POST
// ---------------------------------------------------------------------------

test('9: a failed decisions read answers 503 on the old GET and the summary CSV, never an empty history', async () => {
  const db = fixture();
  await oldPost(db, FOUNDER, { decision: 'proceed' });
  db.exec('ALTER TABLE validation_decisions RENAME TO validation_decisions_unreadable');
  const g = await oldGet(db, FOUNDER);
  assert.equal(g.status, 503);
  assert.equal(g.body.detail, 'The decision could not be read.');
  assert.equal('history' in g.body, false);
  const c = await summaryCsv(db, FOUNDER);
  assert.equal(c.status, 503);
  assert.equal(c.body.detail, 'The decision could not be read.');
});

test('10: the old GET and the summary CSV read the venture\'s current given decision, never a hypothesis\'s or a withheld one', async () => {
  const db = fixture();
  const env = envOf(db);
  const h2 = hypothesis(db, P, 'H2');
  const ev = fixed(items(5));
  const venture = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: 'venture', reasoning: 'Venture call', evidence: keys(items(5)) }, { evidenceSource: ev });
  await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'stop', for: h2, reasoning: 'H2 call', evidence: keys(items(5)) }, { evidenceSource: ev });
  await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'pivot', for: 'venture', reasoning: 'Withheld call' }, { evidenceSource: ev });

  const g = await oldGet(db, FOUNDER);
  assert.equal(g.status, 200);
  assert.equal(g.body.current.id, venture.id);
  assert.equal(g.body.current.decision, 'proceed');
  assert.deepEqual(g.body.history.map((r: any) => [r.decision, r.state]), [['pivot', 'withheld'], ['proceed', 'given']]);
  assert.equal(g.body.history.some((r: any) => r.hypothesis_id !== null), false, 'history is the venture\'s own rows');

  const c = await summaryCsv(db, FOUNDER);
  assert.equal(c.status, 200);
  assert.match(c.text, /proceed,Venture call/);
  assert.equal(c.text.includes('H2 call') || c.text.includes('Withheld call'), false);

  const page = await decisionsFor(env, P, { filter: 'withheld' });
  assert.deepEqual(page.rows.map((r) => r.decision), ['pivot']);
});

test('10: no file under cloudflare-worker/src but services/verdict.ts names validation_decision', () => {
  const src = resolve(ROOT, 'cloudflare-worker/src');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const offenders: string[] = [];
  for (const f of walk(src)) {
    const rel = relative(src, f).split('\\').join('/');
    if (rel === 'services/verdict.ts') continue;
    const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('validation_decision'));
    if (!lines.length) continue;
    // services/records/owned.ts may name the tables in its two verdict
    // entries only (D-u), and types.ts in their `Store` names. #1703:
    // services/cycleActivity.ts in `logCycleWrite`'s read-back entry (its
    // type, the superseded row's statement and the newest decision's), and
    // services/records/verdict.ts in its two `store` keys only.
    if (rel === 'services/records/owned.ts' && lines.length <= 2) continue;
    if (rel === 'services/records/types.ts' && lines.length <= 1) continue;
    if (rel === 'services/cycleActivity.ts' && lines.length <= 4) continue;
    if (rel === 'services/records/verdict.ts' && lines.every((l) => /\bstore: 'validation_decision(s|_commitments)'/.test(l))) continue;
    offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('11: the old POST records a given venture decision that supersedes only the venture\'s current given one', async () => {
  const db = fixture();
  const env = envOf(db);
  const h2 = hypothesis(db, P, 'H2');
  const hd = await recordDecision(env, userOf(FOUNDER), { id: P }, { decision: 'proceed', for: h2, evidence: keys(items(5)) }, { evidenceSource: fixed(items(5)) });
  const a = await oldPost(db, FOUNDER, { decision: 'proceed', reasoning: 'ship it' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual(Object.keys(a.body).sort(), ['decision', 'id']);
  const b = await oldPost(db, FOUNDER, { decision: 'pivot', reasoning: 'narrow it' });
  assert.equal(b.status, 201);
  const second = rows(db).find((r) => r.id === b.body.id);
  assert.equal(second.state, 'given');
  assert.equal(second.hypothesis_id, null);
  assert.equal(second.supersedes_id, a.body.id);
  assert.equal((await currentDecision(env, P, h2))?.id, hd.id, 'H2\'s decision is still current');
  assert.equal((await currentDecision(env, P, 'venture'))?.id, b.body.id);
  assert.equal((await oldPost(db, FOUNDER, { decision: 'maybe' })).status, 400);
});

// ---------------------------------------------------------------------------
// #1703, part 2's first PR: the record, its commitments and form-options,
// through #1690's route with a test registry (Verdict is not in RECORD_SPECS
// until the closing PR). The production entry point lets a thrown Response
// answer (`util/thrownResponse.ts`), so these calls do the same.
// ---------------------------------------------------------------------------

const EVIDENCE = items(5, { contradicting: 1 }).map((e, i) => ({ ...e, strength: i === 4 ? null : e.strength }));
function recordsApp(list: EvidenceItem[] | null = EVIDENCE) {
  const r = new Hono<any>();
  r.route('/api/cycles', list === null ? createCycleRecords() : createCycleRecords({ validate: { verdict: verdictSpec({ evidenceSource: fixed(list) }) } }));
  r.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  return r;
}
async function rec(db: any, who: number, method: string, path: string, body?: unknown, list?: EvidenceItem[] | null) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = recordsApp(list);
  const res = await withThrownResponses(() => r.request(`/api/cycles/validate/modules/verdict${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, envOf(db)));
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}
const recordOf = (db: any, who: number, id: number, pid = P) => rec(db, who, 'GET', `/records/${id}?project=${pid}`);
const actOn = (db: any, who: number, id: number, key: string, body: unknown = {}, pid = P) =>
  rec(db, who, 'POST', `/records/${id}/actions/${key}?project=${pid}`, body);
const given = (db: any, who: number, input: any, pid = P) =>
  recordDecision(envOf(db), userOf(who), { id: pid }, { evidence: keys(EVIDENCE), ...input }, { evidenceSource: fixed(EVIDENCE) });
const commitments = (db: any) => db.prepare('SELECT * FROM validation_decision_commitments ORDER BY id').all() as any[];

test('1: on the record, a pre-464 row is a given venture decision whose Evidence is Not recorded, with the reason', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by)
              VALUES (?, 'stop', 'Too few carriers', '2026-09-03 10:00:00', ?)`).run(P, FOUNDER);
  const id = rows(db)[0].id;
  const r = await recordOf(db, FOUNDER, id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.title, 'Stop · the venture');
  assert.equal(r.body.sub, 'Recorded 3 Sep by Fay Founder', 'no evidence clause on an old-route decision');
  assert.deepEqual(r.body.facts[2], { label: 'Evidence', value: null, reason: NO_EVIDENCE_REASON });
  assert.deepEqual(r.body.facts[3], { label: 'Supersedes', value: 'Nothing, the first for the venture' });
  assert.equal(r.body.main[1].empty, NO_EVIDENCE_REASON);
});

test('6: a partner, an advisor, an investor and another venture\'s founder get 403 from the record, activity, form-options and both actions', async () => {
  const db = fixture();
  const d = await given(db, FOUNDER, { decision: 'proceed', for: 'venture', reasoning: 'Carriers pay for it' });
  const c = await actOn(db, FOUNDER, d.id, 'add-commitment', { text: 'Sign three carriers' });
  assert.equal(c.status, 200, c.text);
  const cid = commitments(db)[0].id;
  for (const who of [PARTNER, ADVISOR, INVESTOR, OTHER]) {
    const calls = [
      await recordOf(db, who, d.id),
      await rec(db, who, 'GET', `/records/${d.id}/activity?project=${P}`),
      await rec(db, who, 'GET', `/form-options?project=${P}`),
      await actOn(db, who, d.id, 'add-commitment', { text: 'Nope' }),
      await actOn(db, who, d.id, 'commitment-done', { commitment_id: cid }),
    ];
    assert.deepEqual(calls.map((x) => x.status), [403, 403, 403, 403, 403], roleOf[who]);
    for (const x of calls) assert.equal(x.text.includes('Carriers pay for it') || x.text.includes('Sign three carriers'), false);
  }
  assert.equal(commitments(db).length, 1);
  assert.equal(commitments(db)[0].done_at, null);
});

test('6: the founder, an admitted Lab member on their own venture and an admin read the record, activity and form-options and use both actions', async () => {
  const db = fixture();
  for (const [who, pid] of [[FOUNDER, P], [ADMIN, P], [LAB, P_LAB]] as const) {
    const d = await given(db, who, { decision: 'proceed', for: 'venture' }, pid);
    assert.equal((await recordOf(db, who, d.id, pid)).status, 200, roleOf[who]);
    assert.equal((await rec(db, who, 'GET', `/records/${d.id}/activity?project=${pid}`)).status, 200);
    assert.equal((await rec(db, who, 'GET', `/form-options?project=${pid}`)).status, 200);
    assert.equal((await actOn(db, who, d.id, 'add-commitment', { text: `Ship ${who}` }, pid)).status, 200);
    const mine = commitments(db).find((m) => m.text === `Ship ${who}`);
    const done = await actOn(db, who, d.id, 'commitment-done', { commitment_id: mine.id }, pid);
    assert.equal(done.status, 200, done.text);
  }
});

test('7: through logCycleWrite, the hypothesis a decision was For shows no decision row, and no summary holds a commitment\'s text', async () => {
  const db = fixture();
  const h2 = hypothesis(db, P, 'H2');
  const first = await given(db, FOUNDER, { decision: 'pivot', for: h2 });
  await given(db, FOUNDER, { decision: 'proceed', for: h2 });
  const SECRET = 'Call every carrier in Lyon';
  assert.equal((await actOn(db, FOUNDER, first.id, 'add-commitment', { text: SECRET })).status, 200);
  const page = await activityFor(envOf(db), { projectId: P, entityType: 'validate.experiments', entityId: String(h2), store: 'hypotheses' });
  assert.equal(page.items.some((i) => /validation_|decision/i.test(i.action)), false);
  const log = db.prepare('SELECT entity_type, entity_id, action, details FROM activity_logs ORDER BY id').all() as any[];
  assert.deepEqual(log.map((r) => [r.entity_type, r.entity_id, r.action]).at(-1), ['validate.verdict', String(first.id), 'validation_commitment_added']);
  assert.equal(log.some((r) => String(r.details).includes(SECRET)), false);
  const act = await rec(db, FOUNDER, 'GET', `/records/${first.id}/activity?project=${P}`);
  assert.deepEqual(act.body.items.map((i: any) => i.action),
    ['validation_commitment_added', 'validation_decision_superseded', 'validation_decision_recorded']);
});

test('8: a venture-B decision with ?project=A answers 404 on the record, activity and every action; another decision\'s commitment answers 404', async () => {
  const db = fixture();
  const theirs = await given(db, OTHER, { decision: 'stop', for: 'venture' }, P_OTHER);
  assert.equal((await actOn(db, OTHER, theirs.id, 'add-commitment', { text: 'Theirs' }, P_OTHER)).status, 200);
  const theirCommitment = commitments(db)[0].id;
  for (const r of [
    await recordOf(db, FOUNDER, theirs.id),
    await rec(db, FOUNDER, 'GET', `/records/${theirs.id}/activity?project=${P}`),
    await actOn(db, FOUNDER, theirs.id, 'add-commitment', { text: 'Mine' }),
    await actOn(db, FOUNDER, theirs.id, 'commitment-done', { commitment_id: theirCommitment }),
    await actOn(db, FOUNDER, theirs.id, 'record-new-decision'),
  ]) {
    assert.equal(r.status, 404);
    assert.equal(r.body.detail, 'Record not found.');
  }
  const a = await given(db, FOUNDER, { decision: 'proceed', for: 'venture' });
  const b = await given(db, FOUNDER, { decision: 'pivot', for: 'venture' });
  assert.equal((await actOn(db, FOUNDER, a.id, 'add-commitment', { text: 'On A' })).status, 200);
  assert.equal((await actOn(db, FOUNDER, b.id, 'add-commitment', { text: 'On B' })).status, 200);
  const onA = commitments(db).find((m) => m.text === 'On A').id;
  const wrong = await actOn(db, FOUNDER, b.id, 'commitment-done', { commitment_id: onA });
  assert.equal(wrong.status, 404);
  assert.equal(wrong.body.detail, 'Commitment not found.');
  const foreign = await actOn(db, FOUNDER, b.id, 'commitment-done', { commitment_id: theirCommitment });
  assert.equal(foreign.status, 404);
  assert.equal(commitments(db).every((m) => m.done_at === null), true, 'nothing was closed');
  assert.equal(commitments(db).filter((m) => m.project_id === P_OTHER).length, 1, 'nothing was added to venture B');
});

test('13: the record follows CO:368', async () => {
  const db = fixture();
  const h2 = hypothesis(db, P, 'H2', 'Carriers pay per load');
  const earlier = await given(db, FOUNDER, { decision: 'pivot', for: 'venture' });
  db.prepare("UPDATE validation_decisions SET decided_at = '2026-09-03 09:00:00' WHERE id = ?").run(earlier.id);
  const d = await given(db, FOUNDER, { decision: 'proceed', for: 'venture', reasoning: 'Margins hold at forty carriers' });
  db.prepare("UPDATE validation_decisions SET decided_at = '2026-10-12 09:00:00' WHERE id = ?").run(d.id);
  const r = await recordOf(db, FOUNDER, d.id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.title, 'Proceed · the venture');
  assert.equal(r.body.sub, 'Recorded 12 Oct by Fay Founder · rests on 5 pieces of evidence');
  assert.deepEqual(r.body.pills, [{ text: 'Proceed', tone: 'ok' }, { text: 'Current', tone: 'v1' }]);
  assert.deepEqual(r.body.facts, [
    { label: 'Decision', value: 'Proceed' },
    { label: 'For', value: 'The venture' },
    { label: 'Evidence', value: '5 items' },
    { label: 'Supersedes', value: 'Pivot · 3 Sep' },
  ]);
  assert.deepEqual(r.body.main.map((s: any) => [s.key, s.title]), [['reasoning', 'Reasoning'], ['evidence', 'Evidence it rests on']]);
  assert.deepEqual(r.body.main[0].rows, [{ a: 'Margins hold at forty carriers' }]);
  assert.deepEqual(r.body.main[1].rows.slice(0, 2), [
    { a: 'Item 1 · H1', b: 'Measured · 12 Oct', c: 'Contradicts', tone: 'bad' },
    { a: 'Item 2 · H1', b: 'Measured · 12 Oct', c: 'Supports', tone: 'ok' },
  ]);
  assert.equal(r.body.main[1].rows[4].b, 'Strength not recorded · 12 Oct');
  assert.deepEqual(r.body.side.map((s: any) => [s.key, s.title, s.action ?? null]),
    [['commitments', 'Commitments it created', 'add-commitment'], ['memo', 'Memo', null]]);
  assert.deepEqual(r.body.side[1].rows, [{ a: 'Decision memo', b: 'Export PDF', action: 'export-memo' }]);
  assert.deepEqual(r.body.actions.map((a: any) => [a.key, a.label, a.kind, a.tone]), [
    ['record-new-decision', 'Record a new decision', 'link', 'primary'],
    ['export-memo', 'Export memo', 'write', 'default'],
    ['add-commitment', 'Add a commitment', 'form', 'default'],
  ], 'commitment-done is declared only while a commitment is open');
  assert.equal(r.body.actions[0].href, `/validate/verdict/new?project=${P}&for=venture`);
  assert.deepEqual(r.body.next, { text: 'Record a new decision', action: 'record-new-decision' });

  // The earlier one reads Superseded; a first decision reads Nothing, the first.
  const e = await recordOf(db, FOUNDER, earlier.id);
  assert.deepEqual(e.body.pills[1], { text: 'Superseded', tone: 'grey' });
  assert.deepEqual(e.body.facts[3], { label: 'Supersedes', value: 'Nothing, the first for the venture' });

  // A hypothesis's decision; a withheld one; one piece of evidence.
  const hd = await given(db, ADMIN, { decision: 'stop', for: h2, evidence: keys(EVIDENCE) });
  const h = await recordOf(db, FOUNDER, hd.id);
  assert.equal(h.body.title, 'Stop · Carriers pay per load');
  assert.equal(h.body.sub.endsWith('by Ada Admin · rests on 5 pieces of evidence'), true, h.body.sub);
  assert.deepEqual(h.body.pills[0], { text: 'Stop', tone: 'bad' });
  assert.deepEqual(h.body.facts[1], { label: 'For', value: 'H2 · Carriers pay per load' });
  assert.deepEqual(h.body.facts[3], { label: 'Supersedes', value: 'Nothing, the first for H2' });
  assert.equal(h.body.actions[0].href, `/validate/verdict/new?project=${P}&for=h-${h2}`);
  const w = await given(db, FOUNDER, { decision: 'pivot', for: 'venture', evidence: keys(EVIDENCE).slice(0, 1) });
  const wr = await recordOf(db, FOUNDER, w.id);
  assert.deepEqual(wr.body.pills, [{ text: 'Pivot', tone: 'warn' }, { text: 'Withheld', tone: 'grey' }]);
  assert.equal(wr.body.sub.endsWith('rests on 1 piece of evidence'), true, wr.body.sub);
  assert.deepEqual(wr.body.facts.slice(2), [{ label: 'Evidence', value: '1 item' }, { label: 'Supersedes', value: 'Nothing, withheld' }]);
  assert.equal(wr.body.main[0].empty, 'No reasoning recorded.');
  assert.deepEqual(wr.body.main[0].rows, []);
});

test('13: a legacy row seeded after an earlier decision reads Not recorded, with decision 10\'s reason; no name without decided_by', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO validation_decisions (project_id, decision, decided_at, superseded_at) VALUES
    (?, 'pivot', '2026-08-01 10:00:00', '2026-09-01 10:00:00'), (?, 'proceed', '2026-09-01 10:00:00', NULL)`).run(P, P);
  const [first, second] = rows(db);
  const r = await recordOf(db, FOUNDER, second.id);
  assert.deepEqual(r.body.facts[3], { label: 'Supersedes', value: null, reason: 'Recorded before decisions named what they replaced.' });
  assert.equal(r.body.sub, 'Recorded 1 Sep');
  assert.deepEqual((await recordOf(db, FOUNDER, first.id)).body.facts[3], { label: 'Supersedes', value: 'Nothing, the first for the venture' });
});

test('13: commitments are added and marked done through the action route, by an owner who owns the venture', async () => {
  const db = fixture();
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)')
    .run(11, 'founder', 'Cy Cofounder', 'cy@example.test', 1001);
  // Same founder_id, but not an admitted Lab member: not an owner.
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)')
    .run(12, 'exploring', 'Eve Explorer', 'eve@example.test', 1001);
  const d = await given(db, FOUNDER, { decision: 'proceed', for: 'venture' });

  const form = (await recordOf(db, FOUNDER, d.id)).body.actions.find((a: any) => a.key === 'add-commitment').form;
  assert.deepEqual(form.fields.map((f: any) => [f.key, f.kind, f.input ?? null, f.required ?? false]),
    [['text', 'T', null, true], ['owner_user_id', 'CH', null, false], ['due_date', 'T', 'date', false]]);
  assert.deepEqual(form.fields[1].options, [{ value: '11', label: 'Cy Cofounder' }, { value: String(FOUNDER), label: 'Fay Founder' }]);
  assert.equal(form.fields[1].value, String(FOUNDER), 'the owner defaults to the caller');

  assert.equal((await actOn(db, FOUNDER, d.id, 'add-commitment', { text: '  Sign  three carriers ', due_date: '2026-10-31' })).status, 200);
  assert.equal((await actOn(db, FOUNDER, d.id, 'add-commitment', { text: 'Price the pilot', owner_user_id: '11' })).status, 200);
  assert.equal((await actOn(db, ADMIN, d.id, 'add-commitment', { text: 'Admin note' })).status, 200);
  for (const owner of [OTHER, 12, 999]) {
    const bad = await actOn(db, FOUNDER, d.id, 'add-commitment', { text: 'Theirs', owner_user_id: owner });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.detail, 'The owner must own this venture.');
  }
  assert.equal((await actOn(db, FOUNDER, d.id, 'add-commitment', { text: '' })).status, 400);
  assert.equal((await actOn(db, FOUNDER, d.id, 'add-commitment', { text: 'x', due_date: 'soon' })).status, 400);
  assert.deepEqual(commitments(db).map((m) => [m.text, m.owner_user_id, m.created_by, m.due_date, m.project_id]), [
    ['Sign three carriers', FOUNDER, FOUNDER, '2026-10-31', P],
    ['Price the pilot', 11, FOUNDER, null, P],
    ['Admin note', null, ADMIN, null, P],
  ]);

  let r = await recordOf(db, FOUNDER, d.id);
  assert.deepEqual(r.body.side[0].rows, [
    { a: 'Sign three carriers', b: 'Fay Founder · 31 Oct' },
    { a: 'Price the pilot', b: 'Cy Cofounder' },
    { a: 'Admin note', b: 'No owner' },
  ]);
  const done = r.body.actions.find((a: any) => a.key === 'commitment-done');
  assert.deepEqual(done.form.fields[0].options.map((o: any) => o.label), ['Sign three carriers', 'Price the pilot', 'Admin note']);

  const first = commitments(db)[0].id;
  assert.equal((await actOn(db, FOUNDER, d.id, 'commitment-done', { commitment_id: String(first) })).status, 200);
  assert.equal((await actOn(db, FOUNDER, d.id, 'commitment-done', { commitment_id: first })).status, 404, 'a closed one is not open');
  r = await recordOf(db, FOUNDER, d.id);
  assert.match(r.body.side[0].rows[0].b, /^Done \d{1,2} [A-Z][a-z]{2}$/);
  for (const m of commitments(db).slice(1)) assert.equal((await actOn(db, FOUNDER, d.id, 'commitment-done', { commitment_id: m.id })).status, 200);

  const none = await actOn(db, FOUNDER, d.id, 'commitment-done', { commitment_id: first });
  assert.equal(none.status, 404);
  assert.equal(none.body.detail, 'No such action on this record.', 'nothing open: the action is not declared');
  assert.equal((await actOn(db, FOUNDER, d.id, 'edit-decision')).body.detail, 'No such action on this record.');
  assert.equal((await rec(db, FOUNDER, 'PATCH', `/records/${d.id}?project=${P}`, { decision: 'stop' })).status, 404, 'a decision is never edited');
  assert.equal((await rec(db, FOUNDER, 'DELETE', `/records/${d.id}?project=${P}`)).status, 404, 'nor deleted');
  assert.equal(rows(db).length, 1);
  const log = db.prepare(`SELECT action, details FROM activity_logs WHERE action LIKE 'validation_commitment%' ORDER BY id`).all() as any[];
  assert.deepEqual(log.map((l) => l.action), [...Array(3).fill('validation_commitment_added'), ...Array(3).fill('validation_commitment_done')]);
});

test('14: form-options lists The venture then the open hypotheses, and each evidence item with its strength, date and the bar', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1', 'Dispatchers lose an hour a day');
  const h2 = hypothesis(db, P, 'H2', 'Retired claim');
  db.prepare("UPDATE hypotheses SET retired_at = '2026-10-01' WHERE id = ?").run(h2);
  hypothesis(db, P_OTHER, 'H1', 'Not this venture');
  const list = [
    { id: 'evidence-7', kind: 'hypothesis_evidence', label: 'Pilot invoice · H1', strength: 'measured', direction: 'supports', date: '2026-10-12', hypothesis_id: h1 },
    { id: 'pain-3-9', kind: 'interview', label: 'Interview · H1', strength: null, direction: 'contradicts', date: null },
  ] as EvidenceItem[];
  const r = await rec(db, FOUNDER, 'GET', `/form-options?project=${P}&x=1`, undefined, list);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.for.options, [
    { value: 'venture', label: 'The venture' },
    { value: `h-${h1}`, label: 'H1 · Dispatchers lose an hour a day' },
  ]);
  assert.equal(r.body.evidence.bar, DECISION_EVIDENCE_BAR);
  assert.deepEqual(r.body.evidence.options, [
    { value: 'evidence-7', label: 'Pilot invoice · H1 · Measured', meta: '12 Oct', hypothesis_id: h1 },
    { value: 'pain-3-9', label: 'Interview · H1 · Strength not recorded', meta: null, hypothesis_id: null },
  ]);
  const empty = await rec(db, OTHER, 'GET', `/form-options?project=${P_LAB}`, undefined, []);
  assert.equal(empty.status, 403);
  const lab = await rec(db, LAB, 'GET', `/form-options?project=${P_LAB}`, undefined, []);
  assert.deepEqual(lab.body, { for: { options: [{ value: 'venture', label: 'The venture' }] }, evidence: { bar: 5, options: [] } });
});

// ---------------------------------------------------------------------------
// 12. The card and the Decisions table (#1704's Worker part)
// ---------------------------------------------------------------------------

const ctxOf = (db: any, pid = P) => ({ env: envOf(db), projectId: pid, today: '2026-10-17' }) as any;
const table = (db: any, q: Record<string, unknown> = {}, pid = P) => decisionRecords(ctxOf(db, pid), recordQuery(q));

/** One decision through the writer, dated `on` and written by `who`: given at the bar, withheld below it. */
async function decide(db: any, o: { decision?: string; for?: 'venture' | number; n?: number; reasoning?: string; on?: string; who?: number; pid?: number } = {}) {
  const list = items(o.n ?? DECISION_EVIDENCE_BAR, { prefix: `e${Math.random().toString(36).slice(2, 8)}` });
  const r = await recordDecision(envOf(db), userOf(o.who ?? FOUNDER), { id: o.pid ?? P },
    { decision: o.decision ?? 'proceed', for: o.for ?? 'venture', reasoning: o.reasoning, evidence: keys(list) },
    { evidenceSource: fixed(list) });
  if (o.on) db.prepare('UPDATE validation_decisions SET decided_at = ? WHERE id = ?').run(`${o.on} 09:00:00`, r.id);
  return r;
}

test('12: the card is empty with no decision, too little without a venture verdict, and keeps the eight keys', async () => {
  const db = fixture();
  let c = await verdictCard(ctxOf(db));
  assert.deepEqual(Object.keys(c).sort(), ['caption', 'name', 'next', 'range', 'reason', 'series', 'slug', 'state']);
  assert.deepEqual(c, {
    slug: 'verdict', name: 'Verdict', range: 'All time', caption: 'Every decision, oldest to newest, never overwritten.',
    state: 'empty', series: null, reason: 'No decision yet. Decisions appear here once evidence is in.',
    next: { text: 'Record a decision', href: `/validate/verdict/new?project=${P}` },
  });
  // A withheld venture decision and a given decision on one hypothesis: no verdict for the venture.
  const h1 = hypothesis(db, P, 'H1');
  await decide(db, { n: 2 });
  await decide(db, { for: h1 });
  c = await verdictCard(ctxOf(db));
  assert.equal(c.state, 'too_little');
  assert.equal(c.reason, 'No verdict for the venture yet. Withheld decisions and decisions on one hypothesis are in the table.');
  assert.deepEqual(c.next, { text: 'Record a decision', href: `/validate/verdict/new?project=${P}` });
  assert.equal(c.series, null);
  // Another venture's decisions never count here.
  assert.equal((await verdictCard(ctxOf(db, P_OTHER))).state, 'empty');
});

test('12: an ok card draws the venture\'s six newest decisions oldest first, withheld ones kept, then the current verdict', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1');
  const plan = [
    ['proceed', 5, '2026-06-01'], ['pivot', 5, '2026-07-14'], ['stop', 2, '2026-08-01'], ['proceed', 5, '2026-08-20'],
    ['pivot', 5, '2026-09-03'], ['stop', 3, '2026-09-20'], ['proceed', 6, '2026-10-12'],
  ] as const;
  for (const [decision, n, on] of plan) await decide(db, { decision, n, on });
  await decide(db, { decision: 'stop', for: h1, on: '2026-10-15' });
  const c = await verdictCard(ctxOf(db));
  assert.equal(c.state, 'ok');
  assert.equal(c.next, null, 'no hypothesis has a deadline, so there is no Next');
  assert.equal(c.reason, null);
  const s = c.series as any;
  assert.equal(TIMELINE_CAP, 6);
  assert.deepEqual(s.decisions, [
    { decision: 'pivot', state: 'given', date: '2026-07-14' },
    { decision: 'stop', state: 'withheld', date: '2026-08-01' },
    { decision: 'proceed', state: 'given', date: '2026-08-20' },
    { decision: 'pivot', state: 'given', date: '2026-09-03' },
    { decision: 'stop', state: 'withheld', date: '2026-09-20' },
    { decision: 'proceed', state: 'given', date: '2026-10-12' },
  ], 'six steps at most, the hypothesis\'s decision left out');
  assert.ok(s.decisions.length + 1 <= 7, 'with Next, at most seven steps');
  assert.deepEqual(s.current, { decision: 'proceed', date: '2026-10-12', evidence: 6 });
  assert.equal(s.next, null);
});

test('12: Next is the nearest open hypothesis deadline, today or later, and null with none ahead', async () => {
  const db = fixture();
  await decide(db, { decision: 'proceed', n: 5, on: '2026-10-12' });
  const h1 = hypothesis(db, P, 'H1');
  const h2 = hypothesis(db, P, 'H2');
  const h3 = hypothesis(db, P, 'H3');
  const h4 = hypothesis(db, P, 'H4');
  const hOther = hypothesis(db, P_OTHER, 'H1');
  const due = (id: number, d: string | null) => db.prepare('UPDATE hypotheses SET deadline = ? WHERE id = ?').run(d, id);
  due(h1, '2026-10-16');                                   // passed
  due(h2, '2026-11-02');                                   // later
  due(h3, '2026-10-24');                                   // nearest
  due(h4, '2026-10-20');                                   // nearer, but retired
  db.prepare("UPDATE hypotheses SET retired_at = '2026-10-01' WHERE id = ?").run(h4);
  due(hOther, '2026-10-18');                               // another venture's
  let c = await verdictCard(ctxOf(db));
  assert.equal(c.state, 'ok');
  assert.deepEqual((c.series as any).next, { date: '2026-10-24' });
  assert.deepEqual(c.next, {
    text: 'Record the decision for the sprint ending 24 Oct.',
    href: `/validate/verdict/new?project=${P}&for=h-${h3}`,
  });
  // A deadline today still counts.
  due(h1, '2026-10-17');
  c = await verdictCard(ctxOf(db));
  assert.deepEqual((c.series as any).next, { date: '2026-10-17' });
  assert.equal((c.next as any).href, `/validate/verdict/new?project=${P}&for=h-${h1}`);
  // None ahead: both null.
  for (const id of [h1, h2, h3]) due(id, '2026-09-01');
  c = await verdictCard(ctxOf(db));
  assert.equal((c.series as any).next, null);
  assert.equal(c.next, null);
});

test('12: with Next, the timeline holds at most seven steps', async () => {
  const db = fixture();
  for (let i = 1; i <= 8; i++) await decide(db, { decision: 'proceed', n: 5, on: `2026-09-${String(i).padStart(2, '0')}` });
  const h1 = hypothesis(db, P, 'H1');
  db.prepare("UPDATE hypotheses SET deadline = '2026-10-30' WHERE id = ?").run(h1);
  const s = (await verdictCard(ctxOf(db))).series as any;
  assert.equal(s.decisions.length, TIMELINE_CAP);
  assert.ok(s.next);
  assert.equal(s.decisions.length + (s.next ? 1 : 0), 7);
});

test('12: an old-route decision is the current verdict with no evidence count', async () => {
  const db = fixture();
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, decided_at) VALUES (?, 'stop', 'Old page', ?, '2026-05-02 10:00:00')").run(P, FOUNDER);
  const c = await verdictCard(ctxOf(db));
  assert.equal(c.state, 'ok');
  assert.deepEqual((c.series as any).current, { decision: 'stop', date: '2026-05-02', evidence: null });
});

test('12: a failed decisions read makes the card unreadable, never an empty history', async () => {
  const db = fixture();
  await decide(db);
  db.exec('DROP TABLE validation_decisions');
  const saved = console.warn; console.warn = () => {};
  try {
    const c = await verdictCard(ctxOf(db));
    assert.equal(c.state, 'unreadable');
    assert.equal(c.series, null);
    assert.equal(c.reason, 'Decisions could not be read');
  } finally { console.warn = saved; }
  await assert.rejects(() => table(db), 'the table throws too, for the route to say so');
});

test('12: the Decisions table has CO:610\'s columns, the Decision and For filters, and Newest then Oldest', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1', 'Dispatchers lose an hour a day');
  hypothesis(db, P, 'H2', 'No decision on this one');
  const h9 = hypothesis(db, P_OTHER, 'H1', 'Another venture');
  await decide(db, { for: h1 });
  await decide(db, { for: h9, pid: P_OTHER, who: OTHER });
  const r = await table(db);
  assert.deepEqual(r.cols, ['Decision', 'For', 'Reasoning', 'Evidence', 'Date · by']);
  assert.deepEqual(r.filters, [
    { key: 'decision', label: 'Decision', options: [
      { value: 'proceed', label: 'Proceed' }, { value: 'pivot', label: 'Pivot' }, { value: 'stop', label: 'Stop' }, { value: 'withheld', label: 'Withheld' },
    ] },
    { key: 'for', label: 'For', options: [
      { value: 'venture', label: 'The venture' }, { value: `h-${h1}`, label: 'H1 · Dispatchers lose an hour a day' },
    ] },
  ], 'For lists only the hypotheses that have a decision, this venture\'s');
  assert.deepEqual(r.sorts, [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }]);
});

test('12: Withheld, Pivot and other rows read as specified, each id is the decision\'s, and the row says who and when', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1', 'Dispatchers lose an hour a day');
  const h3 = hypothesis(db, P, 'H3', 'Fleet managers buy it');
  const w = await decide(db, { decision: 'proceed', n: 3, reasoning: 'Not enough yet', on: '2026-09-01' });
  const g = await decide(db, { decision: 'stop', for: h1, reasoning: '\n  Churn is too high\nSecond line', on: '2026-09-10', who: ADMIN });
  const pv = await decide(db, { decision: 'pivot', n: 6, reasoning: 'Change the buyer', on: '2026-10-12' });
  db.prepare('UPDATE validation_decisions SET pivot_hypothesis_id = ? WHERE id = ?').run(h3, pv.id);
  const blank = await decide(db, { decision: 'proceed', on: '2026-10-14' });
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at) VALUES (?, 'proceed', 'From the old page', '2026-04-01 08:00:00')").run(P);
  const r = await table(db);
  assert.equal(r.total, 5);
  const by = Object.fromEntries(r.rows.map((x: any) => [x.id, x]));
  assert.deepEqual(r.rows.map((x: any) => x.id).slice(0, 4), [blank.id, pv.id, g.id, w.id], 'newest first, each id the decision\'s');
  assert.deepEqual(by[w.id], {
    id: w.id, decision: 'proceed', state: 'withheld', hypothesis_id: null, for: 'The venture',
    reasoning: '3 of 5 pieces of evidence', evidence: 3, date: '2026-09-01', by: 'Fay Founder',
  });
  assert.deepEqual(by[pv.id].reasoning, 'Starts H3 · Fleet managers buy it');
  assert.equal(by[pv.id].evidence, 6);
  assert.deepEqual({ for: by[g.id].for, reasoning: by[g.id].reasoning, by: by[g.id].by, hypothesis_id: by[g.id].hypothesis_id },
    { for: 'H1 · Dispatchers lose an hour a day', reasoning: 'Churn is too high', by: 'Ada Admin', hypothesis_id: h1 });
  assert.equal(by[blank.id].reasoning, null, 'no reasoning is null, not an empty string');
  const old = r.rows[4] as any;
  assert.deepEqual({ reasoning: old.reasoning, evidence: old.evidence, by: old.by, date: old.date },
    { reasoning: 'From the old page', evidence: null, by: null, date: '2026-04-01' });
  assert.deepEqual((await table(db, { sort: 'oldest' })).rows.map((x: any) => x.id)[0], old.id);
});

test('12: the filters, the search and the pages run in SQL, bound, before paging', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1', 'Dispatchers lose an hour a day');
  for (let i = 0; i < 27; i += 1) await decide(db, { decision: i % 3 === 0 ? 'stop' : 'proceed', reasoning: `Week ${i}`, on: `2026-08-${String(i + 1).padStart(2, '0')}` });
  const w = await decide(db, { decision: 'proceed', n: 1, reasoning: '50% of drivers said so', on: '2026-09-02' });
  const hd = await decide(db, { decision: 'pivot', for: h1, reasoning: 'Buyer moved', on: '2026-09-03' });
  let r = await table(db);
  assert.equal(r.total, 29);
  assert.equal(r.rows.length, 25);
  assert.equal((await table(db, { page: 2 })).rows.length, 4);
  r = await table(db, { filter: 'decision:withheld' });
  assert.deepEqual(r.rows.map((x: any) => x.id), [w.id]);
  r = await table(db, { filter: 'decision:proceed' });
  assert.equal(r.total, 18, 'a withheld Proceed is under Withheld, not Proceed');
  assert.ok(r.rows.every((x: any) => x.decision === 'proceed' && x.state === 'given'));
  assert.equal((await table(db, { filter: 'decision:stop' })).total, 9);
  assert.deepEqual((await table(db, { filter: `for:h-${h1}` })).rows.map((x: any) => x.id), [hd.id]);
  assert.equal((await table(db, { filter: 'for:venture' })).total, 28);
  assert.equal((await table(db, { filter: 'for:h-999' })).total, 0, 'a hypothesis with no decision is no row');
  assert.equal((await table(db, { filter: 'decision:maybe' })).total, 29, 'an unknown value is no filter');
  assert.deepEqual((await table(db, { q: 'hour a day' })).rows.map((x: any) => x.id), [hd.id], 'the claim is searched');
  assert.deepEqual((await table(db, { q: 'WEEK 26' })).rows.map((x: any) => x.reasoning), ['Week 26'], 'the reasoning is searched, case-blind');
  assert.deepEqual((await table(db, { q: '50%' })).rows.map((x: any) => x.id), [w.id], 'a % is a character, not a wildcard');
  assert.equal((await table(db, { q: '%' })).total, 1);
  assert.equal((await table(db, {}, P_OTHER)).total, 0, 'another venture reads none of these');
});


// #1703 closing integration: real evidence, production Pivot and registry.
function realEvidence(db: any) {
  const links = painLinkSetup(db);
  db.prepare('UPDATE discovery_interviews SET pains_json = ? WHERE id = ?').run('["slow dispatch"]', links.iv);
  db.prepare("UPDATE hypothesis_pain_links SET strength = 'pattern', direction = 'contradicts' WHERE id = ?").run(links.l2);
  db.prepare("UPDATE hypothesis_pain_links SET strength = 'anecdote' WHERE id = ?").run(links.l1);
  for (let i = 0; i < 3; i++) {
    const iv = db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date) VALUES (?, 'Fixture carrier', '2026-10-12') RETURNING id").get(P) as any;
    db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction, strength) VALUES (?, ?, ?, 'interview', ?, 'supports', 'measured')")
      .run(crypto.randomUUID(), P, links.h1, String(iv.id));
  }
  return links;
}

test('4 integration: production Pivots create distinct codes alongside New hypothesis and keep decision activity private', async () => {
  for (const pivotFirst of [true, false]) {
    const db = fixture(); const env = envOf(db);
    const pivot = () => recordDecision(env, userOf(FOUNDER), { id: P }, {
      decision: 'pivot', for: 'venture', pivot_claim: 'Dispatch by phone', reasoning: 'Private decision reasoning',
    });
    const ordinary = () => createHypothesis(env, { projectId: P, userId: FOUNDER, claim: 'Dispatch by rail' });
    const results = await Promise.all(pivotFirst ? [pivot(), ordinary()] : [ordinary(), pivot()]);
    const recorded = results[pivotFirst ? 0 : 1] as any;
    const claims = db.prepare('SELECT id, code, created_by FROM hypotheses ORDER BY id').all() as any[];
    assert.deepEqual(claims.map((h) => h.code).sort(), ['H1', 'H2']);
    assert.equal(claims.find((h) => h.id === recorded.pivot_hypothesis_id)?.created_by, FOUNDER);
    assert.equal(rows(db)[0].pivot_hypothesis_id, recorded.pivot_hypothesis_id);
    assert.equal(recorded.state, 'withheld');
    const history = await activityFor(env, { projectId: P, entityType: 'validate.experiments', entityId: String(recorded.pivot_hypothesis_id), store: 'hypotheses' });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].action, 'hypothesis_created');
    assert.equal(history.items[0].a, 'Created by Fay Founder');
    const logged = db.prepare("SELECT details FROM activity_logs WHERE project_id = ? AND entity_type = 'validate.experiments' AND entity_id = ?").get(P, String(recorded.pivot_hypothesis_id)) as any;
    assert.equal(logged.details, 'Hypothesis created');
    assert.equal(JSON.stringify(history).includes('Private decision reasoning'), false);
    assert.equal(/pivot|decision/i.test(JSON.stringify(history)), false);
  }
});

test('4 integration: a failed real Pivot decision rolls back the hypothesis and both kinds of activity', async () => {
  const db = fixture();
  db.exec("CREATE TRIGGER reject_real_decision BEFORE INSERT ON validation_decisions BEGIN SELECT RAISE(ABORT, 'fixture rejects decision'); END");
  await assert.rejects(recordDecision(envOf(db), userOf(FOUNDER), { id: P }, {
    decision: 'pivot', for: 'venture', pivot_claim: 'Dispatch by phone',
  }), /fixture rejects decision/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
  assert.equal(rows(db).length, 0);
});

test('5 integration: real evidence uses distinct link keys, names claims, and snapshots every displayed field', async () => {
  const db = fixture(); const env = envOf(db); const links = realEvidence(db);
  const raw = await validateEvidenceFor({ env, projectId: P });
  const selected = await evidenceFor(env, P);
  assert.deepEqual(keys(selected), keys(raw));
  assert.equal(new Set(keys(selected)).size, 5);
  assert.deepEqual(keys(selected).slice(0, 2), [`pain-${links.l1}-${links.iv}`, `pain-${links.l2}-${links.iv}`]);
  assert.ok(selected.every((it) => it.label.includes(`${it.hypothesis_id === links.h1 ? 'H1' : 'H2'} claim`)));
  const r = await post(db, FOUNDER, { decision: 'pivot', for: 'venture', pivot_claim: 'Dispatch by phone', evidence: keys(selected) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.state, 'given');
  assert.ok(r.body.pivot_hypothesis_id);
  db.exec("UPDATE pain_groups SET title = 'Changed theme'; UPDATE hypotheses SET claim = 'Changed claim'; UPDATE hypothesis_pain_links SET strength = 'measured', direction = 'contradicts'; UPDATE hypothesis_evidence_links SET strength = 'anecdote', direction = 'contradicts'; UPDATE discovery_interviews SET interview_date = '2026-10-16'");
  assert.notDeepEqual(await evidenceFor(env, P), selected);
  const saved = await decisionById(env, P, r.body.id);
  assert.deepEqual(saved!.evidence.map((it) => [it.ref_id, it.label, it.strength, it.direction, it.on_date]),
    selected.map((it) => [it.id, it.label, it.strength, it.direction, it.date]));
});

test('5 integration: a foreign real evidence key is 404 before any Pivot, decision, snapshot or activity write', async () => {
  const db = fixture(); const env = envOf(db); realEvidence(db);
  const theirs = hypothesis(db, P_OTHER, 'H1');
  const iv = db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (?, 'Foreign fixture') RETURNING id").get(P_OTHER) as any;
  const link = db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES (?, ?, ?, 'interview', ?, 'supports') RETURNING id")
    .get(crypto.randomUUID(), P_OTHER, theirs, String(iv.id)) as any;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n;
  const selected = await evidenceFor(env, P);
  const r = await post(db, FOUNDER, { decision: 'pivot', for: 'venture', pivot_claim: 'Must not be written', evidence: [...keys(selected).slice(0, 4), `evidence-${link.id}`] });
  assert.equal(r.status, 404);
  assert.equal(r.body.detail, 'Evidence not found.');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n, before);
  assert.equal(rows(db).length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM validation_decision_evidence').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
});

test('6/8/14 integration: registered Verdict serves real choices and records with the decision gates and actions', async () => {
  const db = fixture(); const env = envOf(db); realEvidence(db);
  const options = await rec(db, FOUNDER, 'GET', `/form-options?project=${P}`, undefined, null);
  assert.equal(options.status, 200, options.text);
  assert.equal(options.body.evidence.bar, 5);
  const selected = await evidenceFor(env, P);
  assert.deepEqual(options.body.evidence.options.map((it: any) => it.value), keys(selected));
  const d = await post(db, FOUNDER, { decision: 'proceed', for: 'venture', evidence: keys(selected) });
  assert.equal(d.status, 201, d.text);
  for (const who of [PARTNER, ADVISOR, INVESTOR, OTHER]) {
    for (const path of [`/records/${d.body.id}?project=${P}`, `/records/${d.body.id}/activity?project=${P}`, `/form-options?project=${P}`]) {
      assert.equal((await rec(db, who, 'GET', path, undefined, null)).status, 403);
    }
    for (const key of ['add-commitment', 'commitment-done']) {
      assert.equal((await rec(db, who, 'POST', `/records/${d.body.id}/actions/${key}?project=${P}`, {}, null)).status, 403);
    }
  }
  const foreign = await rec(db, OTHER, 'GET', `/records/${d.body.id}?project=${P_OTHER}`, undefined, null);
  assert.equal(foreign.status, 404);
  const record = await rec(db, FOUNDER, 'GET', `/records/${d.body.id}?project=${P}`, undefined, null);
  assert.equal(record.status, 200, record.text);
  assert.equal(record.body.title, 'Proceed · the venture');
  const added = await rec(db, FOUNDER, 'POST', `/records/${d.body.id}/actions/add-commitment?project=${P}`, { text: 'Call carriers' }, null);
  assert.equal(added.status, 200, added.text);
  const commitment = commitments(db)[0];
  const done = await rec(db, FOUNDER, 'POST', `/records/${d.body.id}/actions/commitment-done?project=${P}`, { commitment_id: commitment.id }, null);
  assert.equal(done.status, 200, done.text);
  assert.ok(commitments(db)[0].done_at);
});

// ---------------------------------------------------------------------------
// #1704 closing PR: the module read, and MCP
// ---------------------------------------------------------------------------

test('12: the Verdict module read sends the Decisions table: its columns, filters, Newest first, row ids and linkable', async () => {
  const db = fixture();
  const h1 = hypothesis(db, P, 'H1', 'Fleets pay');
  await decide(db, { decision: 'proceed', n: 5, on: '2026-10-01' });
  await decide(db, { decision: 'stop', n: 2, on: '2026-10-05' });
  await decide(db, { decision: 'pivot', for: h1, on: '2026-10-09' });
  const route = new Hono<any>();
  route.route('/api/cycles/validate', cycleValidateRoute);
  const read = async (who: number) => {
    const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await route.request(`/api/cycles/validate/modules/verdict?project=${P}`, { headers: { Authorization: `Bearer ${token}` } }, envOf(db));
    return { status: res.status, body: await res.json() as any };
  };
  const r = await read(FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.module, { slug: 'verdict', name: 'Verdict', records_title: 'Decisions' });
  assert.deepEqual(r.body.records.cols, ['Decision', 'For', 'Reasoning', 'Evidence', 'Date · by']);
  assert.deepEqual(r.body.records.filters.map((f: any) => f.key), ['decision', 'for']);
  assert.deepEqual(r.body.records.sorts.map((x: any) => x.key), ['newest', 'oldest']);
  assert.equal(r.body.records.linkable, true);
  assert.equal(r.body.can_read_decisions, true);
  const ids = (db.prepare('SELECT id FROM validation_decisions WHERE project_id = ? ORDER BY decided_at DESC, id DESC').all(P) as any[]).map((x) => Number(x.id));
  assert.deepEqual(r.body.records.rows.map((x: any) => Number(x.id)), ids, 'every row id is the decision\'s, newest first');
  assert.equal(r.body.card.slug, 'verdict');
  // A partner is refused before anything is read.
  const p = await read(PARTNER);
  assert.equal(p.status, 403);
  assert.deepEqual(p.body, { detail: 'Partners do not see decisions.' });
});

test('15: the MCP context tool still reads three Validate slugs, never Verdict', () => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/mcp/tools/context.ts'), 'utf8');
  const union = /slug: ('[a-z-]+'(?:\s*\|\s*'[a-z-]+')*)/.exec(src);
  assert.ok(union, 'the slug union is still there');
  assert.deepEqual(union![1].split('|').map((x) => x.trim().replace(/'/g, '')), ['problem-discovery', 'ideal-customer-profile', 'experiments']);
  assert.equal(/verdict/i.test(src), false);
});
