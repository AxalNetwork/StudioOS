/**
 * D4589 (#4589) — Validate's shared next-action policy, end to end on real
 * SQLite: the overview read's `focus` for each venture state the issue names,
 * for the founder, an admin who is not the founder and a partner, with each
 * fact's read failing on its own. The read writes nothing: a decision is
 * never recorded by it. The desktop/phone equivalence of the same `focus` is
 * `frontend/test/validate_next_action_d4589.test.mjs`.
 *
 * The database is the baseline plus every migration, as cycle_focus_d692
 * builds it. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_next_action_d4589.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { planBuildHref } from '../src/services/validateNextAction.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, ADMIN = 30, PARTNER = 40;
const P = 1;
const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner' };

const BUILT = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(ADMIN, 'admin', 'Ann Admin', 'ann@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  db.prepare("INSERT INTO projects (id, name, founder_id) VALUES (?, 'Juniper Labs', 1001)").run(P);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Dispatch'), (2, ${P}, 'Churn')`);
  db.exec(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${P}, 1, 'slow dispatch', 'Slow dispatch'), (${P}, 2, 'churn', 'Churn')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (31, ${P}, 'H1', 'Fleets pay')`);
  return db;
}
let ivSeq = 0;
function interview(db: any, pains: string[], fit: string | null = 'strong') {
  ivSeq += 1;
  db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date, pains_json, hypotheses_json, stage, icp_fit)
    VALUES (?, ?, date('now'), ?, '[]', 'done', ?)`).run(P, `Person ${ivSeq}`, JSON.stringify(pains), fit);
}
const link = (db: any, group: number, direction: string) =>
  db.prepare('INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (31, ?, ?)').run(group, direction);
const decide = (db: any, decision: string) => Number((db.prepare(`INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, decided_at)
  VALUES (?, ?, 'r', ?, 'given', '2026-10-12 10:00:00') RETURNING id`).get(P, decision, FOUNDER) as any).id);

function failing(db: any, needle: string | null) {
  const inner = d1Over(db);
  if (!needle) return inner;
  return {
    ...inner,
    prepare(sql: string) {
      if (!sql.includes(needle)) return inner.prepare(sql);
      const boom = async () => { throw new Error('injected failure'); };
      const api: any = { bind: () => api, all: boom, first: boom, run: boom, raw: boom };
      return api;
    },
  };
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
async function focus(db: any, who = FOUNDER, needle: string | null = null) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate/overview?project=${P}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db, needle) } as any);
    assert.equal(res.status, 200);
    return ((await res.json()) as any).focus;
  } finally { [console.warn, console.error] = saved; }
}
const decisions = (db: any) => (db.prepare('SELECT COUNT(*) AS n FROM validation_decisions').get() as any).n;

test('review backlog leads, on a venture-aware link to the intended session', async () => {
  const db = fixture();
  interview(db, ['slow dispatch']);
  db.prepare(`INSERT INTO interview_sessions (id, uid, project_id, interview_id, created_by_user_id, channel, status, stopped_at)
    VALUES (19, 's19', ?, 1, ?, 'video', 'transcribed', '2026-10-12 10:00:00')`).run(P, FOUNDER);
  const f = await focus(db);
  assert.equal(f.rule, 'review');
  assert.equal(f.cta.href, `/validate/customer-research/1?project_id=${P}&session=19`);
  assert.deepEqual(f.secondary, [{ label: 'Record a session', href: `/validate/record?project=${P}` }]);
});

test('missing customer fit: supporting interviews without ICP fit name the claim', async () => {
  const db = fixture();
  interview(db, ['slow dispatch'], null);
  interview(db, ['slow dispatch'], null);
  link(db, 1, 'supports');
  const f = await focus(db);
  assert.equal(f.rule, 'missing_fit');
  assert.equal(f.cta.href, `/validate/experiments/31?project=${P}`);
  assert.match(f.why, /^2 supporting interviews have no ICP fit recorded/);
});

test('an experiment marked done with no observed result asks for the result; one with a result does not', async () => {
  const db = fixture();
  interview(db, ['slow dispatch']);
  db.prepare(`INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title, status, result) VALUES ('e1', ?, 31, 'Pricing page test', 'done', '  ')`).run(P);
  db.prepare(`INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title, status) VALUES ('e2', ?, 31, 'Still running', 'running')`).run(P);
  const f = await focus(db);
  assert.equal(f.rule, 'record_result');
  assert.equal(f.cta.href, `/validate/experiments/31?project=${P}`);
  assert.match(f.why, /“Pricing page test” is marked done with no result/);
  db.exec("UPDATE hypothesis_experiments SET result = 'Three of ten paid' WHERE uid = 'e1'");
  assert.equal((await focus(db)).rule, 'next_interview', 'a planned or running experiment is not an unfinished result');
});

test('conflicting findings ask for an explicit next test', async () => {
  const db = fixture();
  // Two each way: neither supported (the bar is 5) nor refuted (contradictions must outnumber support).
  interview(db, ['slow dispatch']);
  interview(db, ['slow dispatch']);
  interview(db, ['churn']);
  interview(db, ['churn']);
  link(db, 1, 'supports');
  link(db, 2, 'contradicts');
  const f = await focus(db);
  assert.equal(f.rule, 'next_test');
  assert.equal(f.why, '2 interviews support it and 2 contradict it. One more test should tell them apart.');
  // More contradiction than support refutes the claim: that is a decision to consider, not a next test.
  interview(db, ['churn']);
  assert.equal((await focus(db)).rule, 'decision_ready');
});

test('a supported claim with no decision: consider the decision, and reading it records none', async () => {
  const db = fixture();
  for (let i = 0; i < 5; i += 1) interview(db, ['slow dispatch']);
  link(db, 1, 'supports');
  const before = decisions(db);
  const f = await focus(db);
  assert.equal(f.rule, 'decision_ready');
  assert.equal(f.cta.href, `/validate/verdict/new?project=${P}&for=venture`);
  assert.equal(decisions(db), before, 'the read never records Proceed, Pivot or Stop');
});

test('Proceed: the founder gets the existing Plan the build handoff; an admin and a partner do not', async () => {
  const db = fixture();
  for (let i = 0; i < 5; i += 1) interview(db, ['slow dispatch']);
  link(db, 1, 'supports');
  const id = decide(db, 'proceed');
  const f = await focus(db);
  assert.equal(f.rule, 'plan_build');
  assert.equal(f.cta.href, planBuildHref(P), 'the same href the Verdict record’s Plan the build declares');
  assert.equal(f.cta.href, `/build/plan?project_id=${P}`);
  assert.ok(f.secondary.some((s: any) => s.href === `/validate/verdict/${id}?project=${P}`));
  assert.equal((await focus(db, ADMIN)).rule, 'next_interview');
  assert.equal((await focus(db, PARTNER)).rule, 'card', 'a partner is never sent to a write');
});

test('Stop is respected: review it, never record or build more; pending review still comes first', async () => {
  const db = fixture();
  interview(db, ['slow dispatch']);
  interview(db, ['churn']);
  link(db, 1, 'supports');
  link(db, 2, 'contradicts');
  const id = decide(db, 'stop');
  const f = await focus(db);
  assert.equal(f.rule, 'stopped');
  assert.equal(f.headline, 'You decided to stop on 12 Oct.');
  assert.equal(f.cta.href, `/validate/verdict/${id}?project=${P}`);
  assert.deepEqual(f.secondary, [{ label: 'Record a new decision', href: `/validate/verdict/new?project=${P}&for=venture` }]);
  db.prepare(`INSERT INTO interview_sessions (id, uid, project_id, interview_id, created_by_user_id, channel, status, stopped_at)
    VALUES (20, 's20', ?, 1, ?, 'video', 'transcribed', '2026-10-13 10:00:00')`).run(P, FOUNDER);
  assert.equal((await focus(db)).rule, 'review');
});

test('each fact that cannot be read makes the step unavailable, never a lower rule', async () => {
  const db = fixture();
  interview(db, ['slow dispatch']);
  for (const [needle, what] of [
    ['FROM interview_sessions s JOIN discovery_interviews', 'The interview sessions'],
    ['FROM validation_decisions d', 'The current decision'],
    ['FROM hypothesis_pain_links l JOIN hypotheses h', 'The hypotheses and their evidence'],
    ['FROM hypothesis_experiments e JOIN hypotheses h', 'The experiments'],
  ] as const) {
    const f = await focus(db, FOUNDER, needle);
    assert.equal(f.rule, 'unavailable', needle);
    assert.equal(f.cta, null);
    assert.equal(f.why, `${what} could not be read. This is not a claim that nothing is waiting.`);
  }
  assert.equal((await focus(db)).rule, 'next_interview', 'a healthy read recovers');
});
