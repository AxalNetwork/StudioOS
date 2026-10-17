/**
 * D693 (#1702, part 1 of 3) — Verdict's store, writer and the old routes, on
 * real SQLite: the baseline's own tables, migrations 440 and 464 over them,
 * the routes mounted on a bare Hono. #1703 and #1704 extend this file; each
 * test's number means the same in all three parts.
 *
 * Part 1 adds tests 1, 2, 3, 5, 7 and 10, and the parts of 6, 8, 9 and 11 its
 * routes answer. Every venture and person below is made up.
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
  VerdictError, type EvidenceItem, type EvidenceSource,
} from '../src/services/verdict.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { ensurePainGroupsSchema } from '../src/services/painGroups.ts';
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
];

function fixture({ fk = false }: { fk?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  db.exec(MIG464);
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

/**
 * A stand-in for #1692's `evidenceFor`, over this fixture: one item per
 * interview behind a pain link, keyed by the link, labelled by its claim.
 */
const fromLinks: EvidenceSource = async (env, projectId) => {
  const res = await env.DB.prepare(
    `SELECT l.id AS link_id, i.id AS interview_id, i.interviewee_name AS name, i.interview_date AS d, h.code
       FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
       JOIN pain_groups g ON g.id = l.pain_group_id
       JOIN discovery_interviews i ON i.project_id = h.project_id
      WHERE h.project_id = ? ORDER BY l.id, i.id`,
  ).bind(projectId).all<any>();
  return (res.results || []).map((r: any) => ({
    id: `pain-${r.link_id}-${r.interview_id}`, kind: 'interview', label: `${r.name} · ${r.code}`,
    strength: 'anecdote', direction: 'supports', date: r.d,
  }));
};

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
  const source: EvidenceSource = async (_e, pid) => (pid === P ? ours : theirs);
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
    [{ decision: 'pivot', for: `h-${h}`, pivot_claim: 'Carriers want a phone app' }, 400, 'A Pivot cannot start a hypothesis yet.'],
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
    // entries only (D-u), and services/cycleActivity.ts in `logCycleWrite`'s
    // read-back list entry only, once #1690 adds those files.
    if (rel === 'services/records/owned.ts' && lines.length <= 2) continue;
    if (rel === 'services/cycleActivity.ts' && lines.length <= 1) continue;
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
