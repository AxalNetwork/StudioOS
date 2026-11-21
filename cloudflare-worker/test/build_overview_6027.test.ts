/**
 * #6027 (D6027) — Build Overview V2's Worker read: the next action in the
 * canvas's order, Needs attention (material blockers only, each with its
 * record's link), the Build Plan preview and each figure's module, on the real
 * migrated schema (node:sqlite). Each part fails on its own; an unreadable
 * source never reads as nothing to do; a reader gets no write action; the
 * overview holds D4603's statement and rows-read measurements.
 *
 * Every name is made up. Dates are far in the past or the future, so no
 * assertion depends on today.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_overview_6027.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleBuild from '../src/routes/cycle_build.ts';
import { buildPhone } from '../src/services/cycleFocus.ts';
import { buildAttention, buildSignals } from '../src/services/buildAttention.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { buildReads, seedFilings, seedHolders, seedTools, PROJECT } from './_build_reads.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, ADMIN = 30, PARTNER = 40;
const P = 1, COMPANY = 5;
const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner' };
const PAST = '2000-01-03', FUTURE = '2999-06-01';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(ADMIN, 'admin', 'Ann Admin', 'ann@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  db.prepare(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, 'Juniper Labs', 1001, ?)`).run(P, COMPANY);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${COMPANY}), ('l2', ${PARTNER}, ${COMPANY})`);
  // Three must-haves, one done: Build is not empty, so #1652's first-feature rule never leads here.
  const ins = db.prepare(`INSERT INTO mvp_features (project_id, title, is_must_have, delivery_status, sort_order) VALUES (?, ?, 1, ?, ?)`);
  ['Done', 'Backlog', 'In Progress'].forEach((s, i) => ins.run(P, `Must-have ${i + 1}`, s, i));
  return db;
}

let NEEDLE: string | null = null;
function failing(db: any) {
  const inner = d1Over(db);
  return {
    ...inner,
    prepare(sql: string) {
      if (!NEEDLE || !sql.includes(NEEDLE)) return inner.prepare(sql);
      const boom = async () => { throw new Error('injected failure'); };
      const api: any = { bind: () => api, all: boom, first: boom, run: boom, raw: boom };
      return api;
    },
  };
}
const app = new Hono<any>().route('/api/cycles/build', cycleBuild);
async function read(db: any, who = FOUNDER) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/build/overview?project=${P}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db) } as any);
    return { status: res.status, body: await res.json() as any };
  } finally { [console.warn, console.error] = saved; }
}
const keys = (body: any) => body.attention.items.map((i: any) => i.key);

let seq = 0;
function plan(db: any, status: 'draft' | 'open' | 'paused', items: Array<[string, string, string, string]>) {
  seq += 1;
  const id = Number(db.prepare(`INSERT INTO build_plans (uid, project_id, scope, trigger, status, evidence_hash, created_by) VALUES (?, ?, 'venture', 'manual', ?, 'h', ?)`)
    .run(`plan-${seq}`, P, status, FOUNDER).lastInsertRowid);
  for (const [module, kind, title, state] of items) {
    seq += 1;
    db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status) VALUES (?, ?, 'Founder · Build', 'build/plan', 'proposal', ?, ?)`)
      .run(`q-${seq}`, FOUNDER, JSON.stringify({ title }), state);
    db.prepare(`INSERT INTO build_plan_items (uid, plan_id, project_id, module, kind, item_key, proposal_uid, evidence_json, marker) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`)
      .run(`i-${seq}`, id, P, module, kind, `${module}:${kind}:${seq}`, `q-${seq}`, `m-${seq}`);
  }
  return id;
}
function failingTool(db: any) {
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, display_name, status, last_error_at) VALUES (900, 'i900', ?, 'hubspot', 'oauth2', 'hubspot', 'error', ?)`).run(FOUNDER, `${PAST} 10:00:00`);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (900, ?, 1)').run(COMPANY);
}

test('1. a writer\'s focus follows the canvas: MVP date, must-haves, filing, plan, failing tool, then the card rule', async () => {
  // Mutation checked: the MVP-date rule moved after the must-haves → step two leads with it; overdue counting Done
  // must-haves → the overdue step fires after the must-have is done; a paused plan counted → it still asks for review.
  const db = fixture();
  let r = await read(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.cta],
    ['set_mvp_date', 'Set the MVP target date.', { label: 'Set target', href: `/build/prototype-mvp?project=${P}#mvp-target-date` }]);
  assert.equal(r.body.focus.why, 'No MVP target date is recorded, so Build cannot count the days to it. 1 of 3 must-haves done.');
  assert.deepEqual(keys(r.body), ['mvp_date']);

  db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(FUTURE, P);
  db.prepare(`UPDATE mvp_features SET delivery_status = 'Blocked' WHERE title = 'Must-have 2'`).run();
  r = await read(db);
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.why], ['unblock_must_haves', 'Unblock 1 must-have.', '1 blocked of 2 open must-haves. MVP target 1 Jun.']);
  assert.deepEqual(r.body.focus.cta, { label: 'Open must-haves', href: `/build/prototype-mvp?project=${P}` });
  assert.deepEqual(keys(r.body), ['must_haves']);

  db.prepare(`UPDATE mvp_features SET delivery_status = 'Backlog', due_date = ? WHERE title = 'Must-have 2'`).run(PAST);
  db.prepare(`UPDATE mvp_features SET due_date = ? WHERE title = 'Must-have 1'`).run(PAST); // Done: never overdue
  db.prepare(`UPDATE mvp_features SET due_date = ? WHERE title = 'Must-have 3'`).run(FUTURE);
  r = await read(db);
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline], ['unblock_must_haves', 'Finish 1 overdue must-have.']);
  assert.equal(r.body.attention.items[0].detail, '1 overdue');

  db.prepare(`UPDATE mvp_features SET due_date = NULL`).run();
  db.prepare(`INSERT INTO formation_steps (project_id, title, state, sort_order, created_by, due_date) VALUES (?, 'File the 83(b) election', 'todo', 1, ?, ?)`).run(P, FOUNDER, PAST);
  r = await read(db);
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.why], ['filing_due', 'Complete File the 83(b) election.', 'Overdue.']);
  assert.deepEqual(r.body.attention.items.find((i: any) => i.key === 'filing_due'),
    { key: 'filing_due', tone: 'needs_attention', title: 'File the 83(b) election', detail: 'Overdue', module: 'company-creation',
      href: `/build/company-creation?project=${P}`, action: { label: 'Open filing', href: `/build/company-creation?project=${P}` } });

  db.prepare(`UPDATE formation_steps SET due_date = ? WHERE project_id = ?`).run(FUTURE, P);
  const planId = plan(db, 'open', [['prototype-mvp', 'must-have', 'CSV import', 'proposed'], ['solution-design', 'feature', 'Setup wizard', 'proposed'],
    ['solution-design', 'risk', 'Test the price objection', 'proposed'], ['product-roadmap', 'roadmap', 'First paying customer', 'proposed'],
    ['solution-design', 'feature', 'Bulk invite', 'accepted'], ['prototype-mvp', 'must-have', 'Dismissed one', 'discarded']]);
  r = await read(db);
  assert.equal(r.body.attention.items.some((i: any) => i.key === 'filing_due'), false, 'an upcoming filing is not material');
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.why, r.body.focus.cta],
    ['review_plan', 'Decide on 4 Build Plan proposals.', '1 accepted · 4 waiting for your decision. Nothing lands until you accept it.',
      { label: 'Review 4 proposals', href: `/build/plan?project=${P}` }]);
  assert.deepEqual(r.body.plan, { state: 'ready', status: 'open', accepted: 1, waiting: 4, href: `/build/plan?project=${P}`,
    items: [
      { uid: r.body.plan.items[0].uid, kind: 'roadmap', module: 'product-roadmap', title: 'First paying customer', module_label: 'Product roadmap' },
      { uid: r.body.plan.items[1].uid, kind: 'must-have', module: 'prototype-mvp', title: 'CSV import', module_label: 'Prototype / MVP' },
      { uid: r.body.plan.items[2].uid, kind: 'feature', module: 'solution-design', title: 'Setup wizard', module_label: 'Solution design' },
    ] });
  assert.ok(r.body.plan.items.every((i: any) => /^i-\d+$/.test(i.uid)), 'the plan item uid, as /build/plan addresses it');

  db.prepare(`UPDATE build_plans SET status = 'paused' WHERE id = ?`).run(planId);
  failingTool(db);
  r = await read(db);
  assert.equal(r.body.plan.status, 'paused');
  assert.equal(keys(r.body).includes('plan_waiting'), false, 'a paused plan takes no decision');
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.cta.label], ['reconnect_tool', 'Reconnect HubSpot.', 'Reconnect HubSpot']);
  assert.equal(r.body.focus.why, 'HubSpot is failing since 3 Jan. Build stops filling from it until it is reconnected.');
  assert.deepEqual(keys(r.body), ['tool_failing']);

  db.prepare(`UPDATE integrations SET status = 'active' WHERE id = 900`).run();
  r = await read(db);
  assert.equal(r.body.focus.rule, 'card', 'nothing material: the card rule, never connect_tools for a partly connected company');
  assert.deepEqual(r.body.attention, { state: 'ready', items: [], unreadable: [] });
});

test('2. a reader gets the card rule and links only, and never the private plan', async () => {
  // Mutation checked: attention actions given to every viewer → the partner's items carry actions; the plan read for a partner → it is ready.
  const db = fixture();
  failingTool(db);
  plan(db, 'open', [['solution-design', 'feature', 'Setup wizard', 'proposed']]);
  const founder = await read(db);
  assert.deepEqual(keys(founder.body), ['tool_failing', 'mvp_date', 'plan_waiting']);
  const r = await read(db, PARTNER);
  assert.equal(r.status, 200);
  assert.equal(r.body.focus.rule, 'card');
  assert.deepEqual(r.body.plan, { state: 'restricted', status: null, accepted: null, waiting: null, items: [], href: `/build/plan?project=${P}` });
  assert.deepEqual(keys(r.body), ['tool_failing', 'mvp_date']);
  assert.ok(r.body.attention.items.every((i: any) => i.action === null && /^\/build\//.test(i.href)), JSON.stringify(r.body.attention));
  // An admin reads the plan, as D1065's read gate allows.
  assert.equal((await read(db, ADMIN)).body.plan.waiting, 1);
});

test('3. each part fails on its own, and an unreadable source never reads as nothing to do', async () => {
  // Mutation checked: the unavailable focus dropped (falling to the card rule) → the second case reads `card`;
  // the plan read outside its part → the whole overview fails.
  const db = fixture();
  db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(FUTURE, P);
  const whole = (await read(db)).body;
  NEEDLE = 'FROM build_plans p';
  try {
    const r = await read(db);
    assert.equal(r.status, 200);
    assert.equal(r.body.plan.state, 'unreadable');
    assert.deepEqual([r.body.attention.state, r.body.attention.unreadable, keys(r.body)], ['partial', ['plan'], ['plan_unreadable']]);
    assert.equal(r.body.attention.items[0].title, 'Build Plan could not be read');
    assert.deepEqual([r.body.focus.rule, r.body.focus.cta, r.body.focus.state], ['unavailable', null, 'unavailable']);
    assert.deepEqual([r.body.figures, r.body.cards, r.body.meter, r.body.index], [whole.figures, whole.cards, whole.meter, whole.index]);
  } finally { NEEDLE = null; }
  NEEDLE = 'SELECT g.status, g.hypothesis_id';
  try {
    const r = await read(db);
    assert.equal(r.body.cards[1].state, 'unreadable');
    assert.deepEqual(r.body.attention.unreadable, ['prototype-mvp']);
    assert.equal(r.body.focus.rule, 'unavailable');
    assert.match(r.body.focus.why, /this does not mean nothing needs doing/);
  } finally { NEEDLE = null; }
  // A recorded rule still leads when another source failed: the action it names is real.
  failingTool(db);
  NEEDLE = 'FROM build_plans p';
  try { assert.equal((await read(db)).body.focus.rule, 'reconnect_tool'); } finally { NEEDLE = null; }
});

test('4. each figure names its source module; desktop and phone read one focus object', async () => {
  const r = await read(fixture());
  assert.deepEqual(r.body.figures.map((f: any) => [f.key, f.module]),
    [['must_haves_done', 'prototype-mvp'], ['days_to_mvp', 'prototype-mvp'], ['roadmap_shipped', 'product-roadmap'], ['systems_connected', 'operating-systems']]);
  assert.equal(Object.keys(r.body).filter((k) => /focus/i.test(k)).join(), 'focus');
});

test('5. Connect a tool only when Operating systems, waiting on its first connection, is the current step', async () => {
  // Mutation checked: the rule firing for any company with an empty systems card → the second case connects.
  const card = (slug: string, state: string, next: any = null) => ({ slug, name: slug, caption: '', state, series: [], range: 'Now', reason: null, next });
  const reads = (osNext: any, first: any = null) => [
    { card: card('solution-design', 'ok', first), rows: [], facts: { features: 1, linked: 1 } },
    { card: card('prototype-mvp', 'ok'), rows: [], facts: { done: 1, total: 1, blocked: 0, overdue: 0 } },
    { card: card('product-roadmap', 'ok'), rows: [], facts: {} },
    { card: card('founding-team', 'ok'), rows: [], facts: {} },
    { card: card('company-creation', 'ok'), rows: [], facts: { filings: 1, next_filing: null } },
    { card: card('operating-systems', 'empty', osNext), rows: [], facts: { reconnect: null } },
  ] as any;
  const project = { id: P, founder_id: 1001, company_id: COMPANY, mvp_target_date: FUTURE };
  const viewer = { id: FOUNDER, role: 'founder', founder_id: 1001, licences: ['founder'] } as any;
  const planned = { state: 'not_recorded', status: null, accepted: null, waiting: null, items: [], href: '' } as any;
  const focusOf = async (rs: any) => (await buildPhone({} as any, project as any, viewer, rs, [], buildSignals(project as any, rs, planned))).focus;
  const connect = { text: 'Connect a system', href: `/build/connect?project_id=${P}` };
  assert.equal((await focusOf(reads(connect)))?.rule, 'connect_tools');
  assert.equal((await focusOf(reads(connect, { text: 'Link evidence', href: `/build/solution-design?project=${P}` })))?.rule, 'card');
  assert.equal((await focusOf(reads(connect)))?.cta?.href, `/build/connect?project_id=${P}`);
  // The same signals feed Needs attention: nothing material here.
  assert.deepEqual(buildAttention(P, true, buildSignals(project as any, reads(connect), planned)).items, []);
});

test('6. the overview holds D4603\'s measurement: one statement more (the plan), no integration store, same rows returned', async () => {
  // D4603 part 3 measured 21 statements at every size; the plan preview is one more, and the overdue count is a
  // subquery of Prototype / MVP's grouped statement over `idx_mvp_features_must_due`.
  // Mutation checked: the plan preview read as three statements → 24; the overdue count as its own statement → 23.
  for (const n of [10, 100]) {
    const h = await buildReads(n); seedHolders(h.db, n); seedFilings(h.db); seedTools(h.db, n);
    try {
      const r = await h.get(`/api/cycles/build/overview?project=${PROJECT}`);
      assert.equal(r.status, 200);
      assert.equal(r.statements, 22, `${n}: ${r.statements} statements`);
      // The harness log keeps a statement's first 140 characters.
      assert.equal(r.log.filter((s) => /^SELECT p\.status, \(SELECT COUNT\(\*\) FROM build_plan_items/.test(s.sql)).length, 1);
      assert.equal(r.body.plan.state, 'not_recorded', 'the harness venture has no plan');
      // The harness venture seeds blocked must-haves, an overdue filing and failing tools.
      assert.deepEqual(r.body.attention.items.map((i: any) => i.key).slice(0, 2), ['tool_failing', 'must_haves']);
    } finally { h.close(); }
  }
});

test('7. overdue is a due date before today (UTC): a must-have due today is not overdue', async (t) => {
  // Mutation checked: `due_date <= today` → the must-have due today counts.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 2, 15, 18) });
  const db = fixture();
  db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(FUTURE, P);
  db.prepare(`UPDATE mvp_features SET due_date = '2030-03-15' WHERE title = 'Must-have 2'`).run();
  db.prepare(`UPDATE mvp_features SET due_date = '2030-03-14T23:00:00Z' WHERE title = 'Must-have 3'`).run();
  const r = await read(db);
  assert.equal(r.body.focus.headline, 'Finish 1 overdue must-have.');
  db.prepare(`UPDATE mvp_features SET due_date = '2030-03-16' WHERE title = 'Must-have 3'`).run();
  assert.equal((await read(db)).body.focus.rule, 'card');
});
