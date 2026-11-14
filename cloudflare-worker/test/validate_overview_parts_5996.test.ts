/**
 * #5996 (D5996) — Validate's overview read gains V2's parts (#4837, V1/V13/V16):
 * `evidence`, `attention`, `hypotheses` and `changes`, additive and each failing alone.
 *
 * On the baseline plus every migration (`_schema_once.mjs`), through the mounted route:
 *   1. an empty venture: every part reads, every figure is null (Not recorded) with its reason, never 0;
 *   2. a venture with reviews waiting: the six figures with population and window, Needs attention
 *      (at most four, most useful first, venture-aware hrefs), the open hypotheses and the latest changes;
 *   3. a partner (no decision access, no write): no review or suggestion item, no write action, and no
 *      verdict data in any part;
 *   4. one failed read makes only the parts that need it Unavailable; today's keys are untouched.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_overview_parts_5996.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, PARTNER = 40;
const P = 1;
const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [PARTNER]: 'partner' };

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
  u.run(FOUNDER, 'founder', 'Synthetic Founder', 'founder@example.test', 1001);
  u.run(PARTNER, 'partner', 'Synthetic Partner', 'partner@example.test', null);
  db.prepare("INSERT INTO projects (id, name, founder_id) VALUES (?, 'Synthetic Venture', 1001)").run(P);
  return db;
}

/** Reviews waiting, mixed evidence, a done experiment with no result, a held interview with no fit, signals, suggestions and activity. */
function busy() {
  const db = fixture();
  db.exec(`
    INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Dispatch'), (2, ${P}, 'Churn');
    INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${P}, 1, 'slow dispatch', 'Slow dispatch'), (${P}, 2, 'churn', 'Churn');
    INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (31, ${P}, 'H1', 'Synthetic fleets pay', 1), (32, ${P}, 'H2', 'Synthetic finance signs off', 2), (34, ${P}, 'H3', 'Synthetic dispatch hurts', 3);
    INSERT INTO hypotheses (id, project_id, code, claim, retired_at) VALUES (33, ${P}, 'H9', 'Synthetic retired claim', '2026-10-01');
    INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (31, 1, 'supports'), (31, 2, 'contradicts'), (34, 1, 'supports');
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, pains_json, hypotheses_json, stage, icp_fit) VALUES
      (1, ${P}, 'Synthetic One', '2026-10-01', '["slow dispatch"]', '[]', 'done', 'strong'),
      (2, ${P}, 'Synthetic Two', '2026-10-02', '["churn"]', '[]', 'done', 'strong'),
      (3, ${P}, 'Synthetic Three', '2026-10-03', '[]', '[]', 'done', NULL),
      (4, ${P}, 'Synthetic Booked', '2026-12-01', '[]', '[]', 'booked', NULL);
    INSERT INTO interview_sessions (id, uid, project_id, interview_id, created_by_user_id, channel, status, stopped_at) VALUES
      (19, 's19', ${P}, 2, ${FOUNDER}, 'video', 'transcribed', '2026-10-12 10:00:00'),
      (18, 's18', ${P}, 1, ${FOUNDER}, 'video', 'transcribed', '2026-10-10 10:00:00');
    INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title, status, result, updated_at) VALUES
      ('e1', ${P}, 31, 'Synthetic pricing page', 'done', NULL, '2026-10-05 10:00:00'),
      ('e2', ${P}, 31, 'Synthetic concierge test', 'done', 'Synthetic observed result', '2026-10-01 10:00:00'),
      ('e3', ${P}, 33, 'Synthetic retired experiment', 'done', NULL, '2026-09-01 10:00:00');
    INSERT INTO demand_signals (project_id, kind, signal_date, status) VALUES (${P}, 'loi', '2026-10-01', 'confirmed'), (${P}, 'waitlist', '2026-10-02', 'to_confirm');
    INSERT INTO validate_proposals (project_id, kind, payload_json, status, run_id) VALUES
      (${P}, 'interview_summary', '{"text":"Synthetic summary"}', 'pending', 7),
      (${P}, 'verdict_contribution', '{"text":"Synthetic verdict note"}', 'pending', 7),
      (${P}, 'interview_summary', '{"text":"Synthetic accepted"}', 'accepted', 7);
    INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor, created_at) VALUES
      (${P}, ${FOUNDER}, 'validate.customer-research', '1', 'interview_logged', 'Synthetic interview logged', 'user:${FOUNDER}', '2026-10-01 09:00:00'),
      (${P}, ${FOUNDER}, 'validate.experiments', '31', 'evidence_linked', 'Synthetic contradiction linked to H1', 'user:${FOUNDER}', '2026-10-04 09:00:00'),
      (${P}, ${FOUNDER}, 'validate.verdict', '5', 'decision_recorded', 'Synthetic SECRET decision', 'user:${FOUNDER}', '2026-10-06 09:00:00'),
      (${P}, ${FOUNDER}, 'build.prototype-mvp', '1', 'x', 'Synthetic build change', 'user:${FOUNDER}', '2026-10-07 09:00:00'),
      (2, ${FOUNDER}, 'validate.experiments', '1', 'x', 'Synthetic other venture', 'user:${FOUNDER}', '2026-10-08 09:00:00');
  `);
  return db;
}

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
async function overview(db: any, who = FOUNDER, needle: string | null = null) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate/overview?project=${P}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db, needle) } as any);
    assert.equal(res.status, 200);
    return (await res.json()) as any;
  } finally { [console.warn, console.error] = saved; }
}
const fig = (body: any, key: string) => body.evidence.figures.find((f: any) => f.key === key);

test('1. an empty venture: every part reads, and every figure is Not recorded, never 0', async () => {
  // Mutation checked: a figure's empty population read as 0 → distinct_sources is 0.
  const b = await overview(fixture());
  for (const k of ['evidence', 'attention', 'hypotheses', 'changes']) assert.equal(b[k].state, 'ok', k);
  assert.deepEqual(b.evidence.figures.map((f: any) => f.key), ['distinct_sources', 'supporting', 'contradicting', 'unknown_fit', 'experiment_results', 'demand_signals']);
  for (const f of b.evidence.figures) {
    assert.equal(f.value, null, `${f.key} is Not recorded`);
    assert.ok(f.reason && f.population && f.window, `${f.key} says why, over what and when`);
  }
  assert.deepEqual([b.attention.items, b.attention.total, b.hypotheses.items, b.hypotheses.total, b.changes.items], [[], 0, [], 0, []]);
});

test('2. a venture with reviews waiting: figures, Needs attention, hypotheses and changes', async () => {
  // Mutation checked: retired hypotheses' experiments counted → experiment_results "1 of 3";
  // the attention list not capped → five items; the changes read not scoped to Validate → the Build change is listed;
  // the review queue counted from one session → "1 interview"; mixed evidence without a contradiction → "2 hypotheses".
  const b = await overview(busy());
  assert.deepEqual(['distinct_sources', 'supporting', 'contradicting', 'unknown_fit', 'experiment_results', 'demand_signals'].map((k) => {
    const f = fig(b, k); return [f.value, f.of ?? null, f.detail];
  }), [
    [5, null, '3 interviews, 1 demand signal, 1 experiment result'],
    [2, null, 'across 3 open hypotheses'],
    [1, null, 'across 3 open hypotheses'],
    [1, 3, 'of 3 held interviews'],
    [1, 2, 'of 2 done experiments'],
    [2, null, '1 confirmed · 1 to confirm'],
  ]);
  assert.match(fig(b, 'supporting').population, /not distinct sources/);
  assert.equal(b.attention.total, 5);
  assert.deepEqual(b.attention.items.map((i: any) => [i.kind, i.label, i.action, i.href]), [
    ['reviews', '2 interviews awaiting review', 'Review interviews', `/validate/customer-research/2?project_id=${P}&session=19`],
    ['suggestions', '1 suggestion waiting', 'Review suggestions', `/validate/customer-research?project=${P}`],
    ['results', '“Synthetic pricing page” has no result', 'Record the result', `/validate/experiments/31?project=${P}`],
    ['mixed', 'H1 has mixed evidence', 'Review evidence', `/validate/experiments/31?project=${P}`],
  ]);
  assert.equal(b.hypotheses.total, 3);
  const [h1, h2, h3] = b.hypotheses.items;
  assert.deepEqual([h3.code, h3.supporting, h3.contradicting], ['H3', 1, 0], 'support alone is not mixed evidence');
  assert.deepEqual([h1.code, h1.supporting, h1.contradicting, h1.sources, h1.experiment, h1.href],
    ['H1', 1, 1, 2, { title: 'Synthetic pricing page', status: 'done', result_recorded: false, result_needed: true }, `/validate/experiments/31?project=${P}`]);
  assert.deepEqual([h2.code, h2.supporting, h2.contradicting, h2.experiment], ['H2', 0, 0, null]);
  assert.deepEqual(b.changes.items.map((c: any) => [c.module, c.summary]), [
    ['experiments', 'Synthetic contradiction linked to H1'], ['customer-research', 'Synthetic interview logged'],
  ]);
  assert.match(b.changes.window, /latest 8/);
});

test('3. a partner: nothing to act on, no write action, and no verdict data in any part', async () => {
  // Mutation checked: the writer gate dropped → the partner gets the review item;
  // verdict placements counted → "2 suggestions"; Verdict's activity read → its summary appears.
  const db = busy();
  const b = await overview(db, PARTNER);
  assert.deepEqual(b.attention.items.map((i: any) => [i.kind, i.action]), [['results', 'Open experiment'], ['mixed', 'Review evidence'], ['fit', 'Open interviews']]);
  const parts = JSON.stringify({ e: b.evidence, a: b.attention, h: b.hypotheses, c: b.changes });
  assert.ok(!/SECRET|verdict note|decision_recorded/.test(parts), 'no verdict data');
  const founder = await overview(db);
  assert.ok(!/SECRET|verdict note/.test(JSON.stringify({ a: founder.attention, c: founder.changes })), 'nor for the founder: the six modules only');
  assert.equal(founder.attention.items.find((i: any) => i.kind === 'suggestions').label, '1 suggestion waiting');
});

test('4. one failed read makes only the parts that need it Unavailable; today\'s keys are unchanged', async () => {
  // Mutation checked: a part not caught → the whole read is a 500; the activity failure caught as an empty list → state ok.
  const db = busy();
  const whole = await overview(db);
  let b = await overview(db, FOUNDER, 'FROM activity_logs');
  assert.deepEqual(b.changes, { state: 'unavailable', reason: 'The recent changes could not be read.' });
  for (const k of ['evidence', 'attention', 'hypotheses']) assert.equal(b[k].state, 'ok', k);
  b = await overview(db, FOUNDER, 'SELECT e.id, e.hypothesis_id, e.title, e.status, e.result');
  for (const k of ['evidence', 'attention', 'hypotheses']) assert.equal(b[k].state, 'unavailable', k);
  assert.equal(b.changes.state, 'ok');
  b = await overview(db, FOUNDER, 'SELECT status FROM demand_signals');
  assert.deepEqual([b.evidence.state, b.attention.state, b.hypotheses.state], ['unavailable', 'ok', 'ok']);
  // Additive: today's keys are all still there, with what they said before.
  for (const k of ['cycle', 'question', 'figures', 'cards', 'focus', 'meter', 'index', 'can_read_decisions']) assert.ok(Object.hasOwn(whole, k), k);
  assert.deepEqual(b.focus, whole.focus);
});

test('5. a long review queue is counted up to its scan, and says "or more" past it', async () => {
  // Mutation checked: the queue's limit ignored → "11 interviews"; `more` dropped → "10 interviews".
  const db = busy();
  const add = db.prepare(`INSERT INTO interview_sessions (id, uid, project_id, interview_id, created_by_user_id, channel, status, stopped_at)
    VALUES (?, ?, ?, 1, ?, 'video', 'transcribed', ?)`);
  for (let i = 0; i < 9; i += 1) add.run(100 + i, `s${100 + i}`, P, FOUNDER, `2026-09-0${i + 1} 10:00:00`);
  const b = await overview(db);
  assert.equal(b.attention.items[0].label, '10 or more interviews awaiting review');
  assert.equal(b.attention.items[0].href, `/validate/customer-research/2?project_id=${P}&session=19`, 'still the newest first');
  assert.equal(b.focus.cta.href, `/validate/customer-research/2?project_id=${P}&session=19`, 'the focus reads the same queue');
  db.prepare('DELETE FROM interview_sessions WHERE id = 108').run();
  assert.equal((await overview(db)).attention.items[0].label, '10 interviews awaiting review');
});
