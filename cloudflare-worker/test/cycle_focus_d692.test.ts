/**
 * D692 (#1701, PR 1a and PR 1b) — each cycle's phone root: Validate's,
 * Build's, Raise's and Grow's overview reads return `focus`, `meter` and
 * `index` in one shape, on real SQLite. Grow's `tell_customers` arrives with
 * PR 2.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, as migrations_fresh_build.test.ts builds one, so no table is
 * hand-written. It is built once and its schema replayed for each fixture.
 * Every name is made up, and every date is computed from the test's today.
 * Test numbers follow the issue's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_focus_d692.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import cycleBuild from '../src/routes/cycle_build.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { sentence, usdShort, dayMonth, cardFocus, cardValue } from '../src/services/cycleFocus.ts';
import { focusOf } from '../src/services/validateFocus.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const TODAY = day(0);

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50, ADVISOR = 70;
const P = 1, P_OTHER = 2, COMPANY = 5;
const roleOf: Record<number, string> = {
  [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor', [ADVISOR]: 'founder',
};

function freshBuild(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return db;
}
const BUILT_DDL = (freshBuild().prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);

/** Two ventures, one company, and a viewer of every role. */
function fixture(companyId: number | null = COMPANY) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ann Admin', 'ann@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  u.run(ADVISOR, 'founder', 'Ari Advisor', 'ari@example.test', 1003);
  db.prepare(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, 'Juniper Labs', 1001, ?), (?, 'Beta Freight', 1002, NULL)`).run(P, companyId, P_OTHER);
  if (companyId != null) db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${companyId})`);
  return db;
}

/** A D1 binding that throws on any statement containing `needle`. */
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

let FLAGS: Record<string, string> = {};
let NEEDLE: string | null = null;
async function request(app: Hono<any>, db: any, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db, NEEDLE), ...FLAGS } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const row = (body: any, key: string) => (body.index || []).find((r: any) => r.key === key);

// ---------------------------------------------------------------------------
// Validate (PR 1b)
// ---------------------------------------------------------------------------

const vApp = new Hono<any>();
vApp.route('/api/cycles/validate', cycleValidate);
const vRead = (db: any, who = FOUNDER, pid = P) => request(vApp, db, who, `/api/cycles/validate/overview?project=${pid}`);

let ivSeq = 0;
function interview(db: any, pid: number, o: Record<string, unknown> = {}) {
  ivSeq += 1;
  const r = db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date, pains_json, hypotheses_json, stage)
     VALUES (?, ?, ?, ?, '[]', ?) RETURNING id`,
  ).get(pid, `Person ${ivSeq}`, o.date ?? TODAY, JSON.stringify(o.pains ?? []), o.stage === undefined ? 'done' : o.stage) as any;
  return Number(r.id);
}
const target = (db: any, n: number) => db.prepare(
  `INSERT INTO metric_targets (project_id, metric_key, target_value, direction) VALUES (?, 'interviews_month_target', ?, 'up')`,
).run(P, n);
const session = (db: any, iv: number, status: string, stoppedAt: string) => db.prepare(
  `INSERT INTO interview_sessions (id, uid, project_id, interview_id, created_by_user_id, channel, status, stopped_at)
   VALUES (1, 's1', ?, ?, ?, 'video', ?, ?)`,
).run(P, iv, FOUNDER, status, stoppedAt);

test('1: a founder with interviews and nothing to review records the next conversation, with the meter in the why', async () => {
  const db = fixture(null);
  for (let i = 0; i < 14; i += 1) interview(db, P, { pains: ['slow dispatch'] });
  target(db, 20);
  const r = await vRead(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = r.body.focus;
  assert.equal(f.rule, 'next_interview');
  assert.equal(f.eyebrow, 'Validate · Next');
  assert.equal(f.headline, 'Record your next customer conversation.');
  assert.equal(f.why, 'Every interview feeds the pain themes, the hypotheses and the verdict. You are at 14 of 20 this month.');
  assert.deepEqual(f.cta, { label: 'Record a session', href: `/validate/record?project=${P}` });
  // Then: the first card's next that is not Customer research's.
  const other = r.body.cards.find((c: any) => c.slug !== 'customer-research' && c.next?.text);
  assert.ok(other, 'the fixture has another card with a next');
  assert.equal(f.then, sentence(other.next.text));
  assert.doesNotMatch(f.then, /^Then /);
  assert.doesNotMatch(f.then, /^Log \d+ more interview/);
  assert.deepEqual([r.body.meter.count, r.body.meter.target, r.body.meter.display], [14, 20, '14 of 20']);

  db.exec('DELETE FROM metric_targets');
  const n = await vRead(db);
  assert.equal(n.body.focus.why, 'Every interview feeds the pain themes, the hypotheses and the verdict. Interviews this month: 14.');
  assert.equal(n.body.meter.display, '14');

  // An unreadable count: the why is its first sentence alone.
  NEEDLE = 'SELECT target_value FROM metric_targets';
  try {
    const u = await vRead(db);
    assert.equal(u.body.meter, null);
    assert.equal(u.body.focus.why, 'Every interview feeds the pain themes, the hypotheses and the verdict.');
  } finally { NEEDLE = null; }
});

test('1: Then never repeats Customer research\'s "Log <n> more interviews"; with no other next, no Then', async () => {
  const db = fixture(null);
  interview(db, P);
  const env = { DB: d1Over(db) } as any;
  const card = (slug: string, text: string | null) => ({ slug, name: slug, state: 'ok', range: '', caption: '', series: null, reason: null,
    next: text ? { text, href: `/validate/${slug}?project=${P}` } : null }) as any;
  const meter = { key: 'interviews_this_month', label: 'Interviews this month', count: 1, target: null, target_reason: 'No target set', display: '1' };
  const a = await focusOf(env, P, true, [card('problem-discovery', null), card('customer-research', 'Log 2 more interviews'), card('ideal-customer-profile', 'then add your first segment')], [], meter);
  assert.equal(a!.then, 'Add your first segment.');
  const b = await focusOf(env, P, true, [card('customer-research', 'Log 2 more interviews')], [], meter);
  assert.equal(b!.then, null);
});

test('2: rule order — no interview, then a session to review, then the next conversation', async () => {
  const db = fixture(null);
  const first = (await vRead(db)).body.focus;
  assert.deepEqual(first, {
    rule: 'first_interview', eyebrow: 'Validate · Next', headline: 'Record your first conversation.',
    why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
    cta: { label: 'Record a session', href: `/validate/record?project=${P}` },
    then: 'Write the claim you most need to be true.',
  });
  const iv = interview(db, P);
  session(db, iv, 'transcribed', `${day(-1)} 10:00:00`);
  const review = (await vRead(db)).body.focus;
  assert.equal(review.rule, 'review');
  // D704 (#1783) moved rule 2's href to the interview's record (D-b).
  assert.equal(review.cta.href, `/validate/customer-research/${iv}?session=1`);
  assert.ok(routed(review.cta.href, routesOf()), 'the review href is a route');
  db.exec("UPDATE interview_sessions SET status = 'reviewed'");
  assert.equal((await vRead(db)).body.focus.rule, 'next_interview');
});

test('3: a partner on Validate gets the card rule, never a write; with no card next, no focus', async () => {
  const db = fixture(null);
  interview(db, P);
  const iv = interview(db, P);
  session(db, iv, 'transcribed', `${day(-1)} 10:00:00`);
  const p = await vRead(db, PARTNER);
  assert.equal(p.status, 200);
  assert.ok(['card', null].includes(p.body.focus?.rule ?? null));
  assert.notEqual(p.body.focus?.rule, 'review');
  assert.notEqual(p.body.focus?.rule, 'next_interview');
  // cardFocus itself: no in-app next → null, never "Record a session.".
  assert.equal(cardFocus('validate', [{ slug: 'x', name: 'X', state: 'ok', range: '', caption: '', series: null, next: { text: 'Open the guide', href: 'https://example.test' }, reason: null } as any]), null);
  assert.equal(cardFocus('validate', []), null);
});

test('4: a founder\'s index is the canvas\'s seven rows with Verdict last; a partner\'s has no decision anywhere', async () => {
  const db = fixture(null);
  interview(db, P, { pains: ['slow dispatch'] });
  const decided = `${day(-77)} 09:30:00`;
  // A superseded decision dated after the current one: the filter, not the order, keeps it out.
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by, superseded_at) VALUES (?, 'stop', 'old', ?, ?, ?)").run(P, `${day(-10)} 09:00:00`, FOUNDER, `${day(-9)} 09:30:00`);
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by) VALUES (?, 'proceed', 'Carriers pay', ?, ?)").run(P, decided, FOUNDER);
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by) VALUES (?, 'pivot', 'theirs', ?, ?)").run(P_OTHER, `${day(-2)} 09:30:00`, OTHER);
  // Newer than the current decision, but withheld, or for one hypothesis: never the venture's verdict.
  const h = db.prepare("INSERT INTO hypotheses (project_id, code, claim) VALUES (?, 'H1', 'Carriers pay') RETURNING id").get(P) as any;
  db.prepare("INSERT INTO validation_decisions (project_id, decision, decided_at, decided_by, state) VALUES (?, 'pivot', ?, ?, 'withheld')").run(P, `${day(-5)} 09:30:00`, FOUNDER);
  db.prepare("INSERT INTO validation_decisions (project_id, hypothesis_id, decision, decided_at, decided_by) VALUES (?, ?, 'stop', ?, ?)").run(P, h.id, `${day(-4)} 09:30:00`, FOUNDER);
  const f = await vRead(db);
  assert.deepEqual(f.body.index.map((r: any) => r.key), [
    'problem-discovery', 'customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments', 'verdict',
  ]);
  const v = row(f.body, 'verdict');
  assert.deepEqual([v.title, v.detail, v.value, v.href], ['Verdict', `Proceed · ${dayMonth(decided)}`, '', `/validate/verdict?project=${P}`]);
  for (const r of f.body.index.slice(0, 6)) assert.equal(r.href, `/validate/${r.key}?project=${P}`);
  assert.equal(row(f.body, 'interviews'), undefined);
  assert.equal(JSON.stringify(f.body.index).includes('Pivot'), false, 'another venture\'s decision is never ours');
  assert.equal(JSON.stringify(f.body.index).includes('Stop'), false, 'a superseded decision is never the value');

  const p = await vRead(db, PARTNER);
  assert.equal(p.status, 200);
  assert.equal(p.body.index.length, 6);
  assert.equal(row(p.body, 'verdict'), undefined);
  const text = JSON.stringify(p.body);
  assert.equal(text.includes('Proceed'), false);
  for (const form of [decided.slice(0, 10), dayMonth(decided)!, decided]) assert.equal(text.includes(form), false, form);

  for (const who of [OTHER, INVESTOR]) {
    const r = await vRead(db, who);
    assert.equal(r.status, 403);
    for (const k of ['focus', 'meter', 'index']) assert.equal(k in (r.body || {}), false);
  }
});

test('5: an empty venture\'s rows are Not recorded with a neutral detail; none booked is a counted 0', async () => {
  const db = fixture(null);
  const e = await vRead(db);
  for (const r of e.body.index) {
    assert.equal(r.value, null, r.key);
    assert.doesNotMatch(r.detail, /\d/, `${r.key}: a neutral detail, never a number`);
  }
  assert.equal(row(e.body, 'verdict').detail, 'Proceed, pivot or stop');
  interview(db, P, { stage: 'done' });
  const one = await vRead(db);
  assert.deepEqual([row(one.body, 'customer-research').detail, row(one.body, 'customer-research').value], ['Recruiting · 0 booked', '']);
  // An unreadable card gives "Unreadable".
  NEEDLE = 'FROM customer_segments';
  try {
    assert.equal(row((await vRead(db)).body, 'ideal-customer-profile').value, 'Unreadable');
  } finally { NEEDLE = null; }
});

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const bApp = new Hono<any>();
bApp.route('/api/cycles/build', cycleBuild);
const bRead = (db: any, who = FOUNDER, pid = P) => request(bApp, db, who, `/api/cycles/build/overview?project=${pid}`);

let intSeq = 100;
/** A tool owned by the founder and enabled for the company, mapped to a core system when `kind` is set. */
function tool(db: any, status: 'active' | 'error', provider = 'hubspot', kind: string | null = null) {
  intSeq += 1;
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, display_name, status) VALUES (?, ?, ?, ?, 'oauth2', ?, ?)`)
    .run(intSeq, `i${intSeq}`, FOUNDER, provider, provider, status);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(intSeq, COMPANY);
  if (kind) db.prepare('INSERT INTO project_core_systems (project_id, kind, integration_id, updated_by) VALUES (?, ?, ?, ?)').run(P, kind, intSeq, FOUNDER);
  return intSeq;
}
/** Nine must-haves, seven done. */
function mustHaves(db: any) {
  const ins = db.prepare(`INSERT INTO mvp_features (project_id, title, is_must_have, delivery_status, sort_order) VALUES (?, ?, 1, ?, ?)`);
  for (let i = 0; i < 9; i += 1) ins.run(P, `Must-have ${i + 1}`, i < 7 ? 'Done' : 'Backlog', i);
}

test('6: a new venture keeps #1652\'s first-feature focus', async () => {
  const db = fixture();
  const r = await bRead(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.focus.rule, r.body.focus.headline, r.body.focus.why, r.body.focus.then],
    ['first_feature', 'Add the first feature.', 'Nothing in Build is recorded yet. Each chart fills as you add to its module.', null]);
  assert.deepEqual(r.body.focus.cta, { label: 'Add feature', href: `/build/solution-design?project=${P}&add=1` });
  assert.equal(r.body.meter, null);
});

test('6: two of five systems connected leads with connect_tools, its meter and the must-haves Then', async () => {
  const db = fixture();
  mustHaves(db);
  tool(db, 'active', 'hubspot', 'crm');
  tool(db, 'active', 'quickbooks', 'accounting');
  db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(day(47), P);
  const r = await bRead(db);
  assert.equal(r.body.focus.rule, 'connect_tools');
  assert.equal(r.body.focus.headline, 'Connect the tools your company already runs on.');
  assert.equal(r.body.focus.why, 'Connected tools fill the roadmap, the MVP burn-up and your KPIs without typing. 2 of 5 core systems are connected.');
  assert.deepEqual(r.body.focus.cta, { label: 'Connect a tool', href: `/build/connect?project_id=${P}` });
  assert.equal(r.body.focus.then, `Ship the last 2 must-haves before ${dayMonth(day(47))}.`);
  assert.deepEqual(r.body.meter, { key: 'must_haves_done', label: 'Must-haves done', count: 7, target: 9, target_reason: null, display: '7 of 9' });

  db.prepare('UPDATE projects SET mvp_target_date = NULL WHERE id = ?').run(P);
  assert.equal((await bRead(db)).body.focus.then, null, 'no date: no Then');
  db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(day(-3), P);
  assert.equal((await bRead(db)).body.focus.then, null, 'a past date: no Then');
});

test('6: a company with no system mapped drops the count, never "0 of 5"; all five connected, or no company, gives the card rule', async () => {
  const db = fixture();
  mustHaves(db);
  const r = await bRead(db);
  assert.equal(r.body.focus.rule, 'connect_tools');
  assert.equal(r.body.focus.why, 'Connected tools fill the roadmap, the MVP burn-up and your KPIs without typing.');

  for (const [kind, provider] of [['bank', 'mercury'], ['accounting', 'quickbooks'], ['payroll', 'gusto'], ['crm', 'hubspot']]) tool(db, 'active', provider, kind);
  db.prepare(`INSERT INTO project_core_systems (project_id, kind, provider_key, updated_by) VALUES (?, 'workspace', 'google_calendar', ?)`).run(P, FOUNDER);
  db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token) VALUES (?, ?)').run(FOUNDER, 'test-refresh');
  const all = await bRead(db);
  assert.equal(all.body.figures[3].value.join(' of '), '5 of 5');
  assert.ok(['card', null].includes(all.body.focus?.rule ?? null), JSON.stringify(all.body.focus));

  const noCompany = fixture(null);
  mustHaves(noCompany);
  assert.ok(['card', null].includes((await bRead(noCompany)).body.focus?.rule ?? null));
});

test('3: a partner on Build gets the three parts, and never connect_tools', async () => {
  const db = fixture();
  mustHaves(db);
  tool(db, 'active', 'hubspot', 'crm');
  tool(db, 'active', 'quickbooks', 'accounting');
  const r = await bRead(db, PARTNER);
  assert.equal(r.status, 200);
  for (const k of ['focus', 'meter', 'index']) assert.ok(k in r.body, k);
  assert.ok(['card', null].includes(r.body.focus?.rule ?? null), JSON.stringify(r.body.focus));
  for (const who of [OTHER, INVESTOR]) {
    const x = await bRead(db, who);
    assert.equal(x.status, 403);
    for (const k of ['focus', 'meter', 'index']) assert.equal(k in (x.body || {}), false);
  }
});

test('7: Build\'s index is the canvas\'s seven rows with Tools first, from the stores', async () => {
  const db = fixture();
  tool(db, 'active', 'hubspot', 'crm');
  tool(db, 'active', 'stripe');
  tool(db, 'error', 'salesforce');
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Slow dispatch')`);
  db.exec(`INSERT INTO mvp_features (project_id, title, pain_group_id) VALUES (${P}, 'Bulk export', 1), (${P}, 'Route planner', 1), (${P}, 'Dark mode', NULL)`);
  db.exec(`INSERT INTO formation_steps (project_id, title, due_date, state, created_by, sort_order) VALUES
    (${P}, 'Register the company', '${day(5)}', 'done', ${FOUNDER}, 1), (${P}, 'File the annual report', '${day(20)}', 'todo', ${FOUNDER}, 2)`);
  const r = await bRead(db);
  assert.deepEqual(r.body.index.map((x: any) => x.key),
    ['tools', 'solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems']);
  assert.deepEqual(row(r.body, 'tools'), { key: 'tools', title: 'Tools', detail: '2 connected · 1 failing', value: '3', href: `/build/tools?project=${P}` });
  assert.deepEqual([row(r.body, 'solution-design').detail, row(r.body, 'solution-design').value], ['2 features linked to a pain', '']);
  assert.deepEqual([row(r.body, 'company-creation').detail, row(r.body, 'company-creation').value], [`Next filing ${dayMonth(day(20))}`, '']);
  assert.deepEqual([row(r.body, 'operating-systems').detail, row(r.body, 'operating-systems').value], ['Systems connected', '1 of 5']);
  for (const x of r.body.index) assert.equal(x.href.split('?')[1], `project=${P}`, x.key);

  const noCompany = fixture(null);
  const n = await bRead(noCompany);
  assert.deepEqual([row(n.body, 'tools').detail, row(n.body, 'tools').value], ['Connected tools', null]);
  for (const x of n.body.index) assert.equal(x.value, null, `${x.key} on an empty venture`);
});

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

const rApp = new Hono<any>();
rApp.route('/api/cycles/raise', cycleRaise);
const rRead = (db: any, who = FOUNDER, pid = P) => request(rApp, db, who, `/api/cycles/raise/overview?project=${pid}`);

let prSeq = 0;
function prospect(db: any, pid: number, stage: string, due: string | null, amount: number | null = null) {
  prSeq += 1;
  db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, stage, next_step, next_step_due, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(`p${prSeq}`, pid, `Investor ${prSeq}`, stage, due ? 'Send the deck' : null, due, amount);
}

test('8: a new venture scores readiness first; a deck nobody opened is already a record', async () => {
  const db = fixture();
  const r = await rRead(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.focus, {
    rule: 'first_readiness', eyebrow: 'Raise · Next', headline: 'Score your readiness.', why: 'Nothing in Raise is recorded yet.',
    cta: { label: 'Score readiness', href: `/raise/fundraising-readiness?project=${P}&add=1` }, then: null,
  });
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (5, ${P}, 1, '[]')`);
  assert.notEqual((await rRead(db)).body.focus?.rule, 'first_readiness');
});

test('8: with the flag off there is no call focus and no Calls row; the index has seven rows', async () => {
  const db = fixture();
  prospect(db, P, 'meeting', day(2));
  FLAGS = {};
  const r = await rRead(db);
  assert.notEqual(r.body.focus?.rule, 'call_for_capital');
  assert.deepEqual(r.body.index.map((x: any) => x.key), [
    'fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships',
  ]);
});

test('8: with the flag on and no open call, the call focus, the meter and the follow-ups due or overdue', async () => {
  const db = fixture();
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status) VALUES ('r1', ${P}, 'Seed', 1500000, 'active')`);
  prospect(db, P, 'committed', null, 600000);
  prospect(db, P, 'committed', null, 300000);
  prospect(db, P, 'meeting', day(1));
  prospect(db, P, 'contacted', day(6));
  prospect(db, P, 'diligence', day(-3)); // overdue
  prospect(db, P, 'meeting', day(30)); // not this week
  prospect(db, P_OTHER, 'meeting', day(1)); // another venture's
  FLAGS = { ROUND_CALLS_ENABLED: 'true' };
  try {
    const r = await rRead(db);
    assert.equal(r.body.focus.rule, 'call_for_capital');
    assert.equal(r.body.focus.headline, 'Call for capital from investors who fit.');
    assert.deepEqual(r.body.focus.cta, { label: 'Call for Capital', href: `/raise/call?project_id=${P}` });
    assert.equal(r.body.focus.then, 'Follow up with the 3 investors due or overdue this week.');
    assert.deepEqual([r.body.meter.label, r.body.meter.count, r.body.meter.target, r.body.meter.display], ['Committed', 900000, 1500000, '$900k of $1.5M']);
    assert.equal(r.body.index[0].key, 'calls');
    assert.equal(row(r.body, 'calls').value, null, 'no call yet: Not recorded');

    db.exec("DELETE FROM raise_prospects WHERE stage <> 'committed'");
    prospect(db, P, 'meeting', day(-1));
    assert.equal((await rRead(db)).body.focus.then, 'Follow up with the 1 investor due or overdue this week.');

    // An open call: the card rule leads, and Calls reads "1 open".
    db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
             VALUES (1, 'call-1', ${P}, 'Seed call', 100000000, 'safe', 'Post-money SAFE', 2500000, '${day(30)}', 'sent', 'h', ${FOUNDER})`);
    const open = await rRead(db);
    assert.ok(['card', null].includes(open.body.focus?.rule ?? null));
    assert.equal(row(open.body, 'calls').value, '1 open');
  } finally { FLAGS = {}; }
});

test('8: readiness reads as a score out of 100; a commitment with no target shows the count alone', async () => {
  const db = fixture();
  db.exec(`INSERT INTO readiness_items (id, project_id, item_key, label, position) VALUES (1, ${P}, 'deck', 'Pitch deck', 1)`);
  db.exec(`INSERT INTO readiness_scores (item_id, project_id, score, evidence) VALUES (1, ${P}, 7, 'measured')`);
  prospect(db, P, 'committed', null, 900000);
  const r = await rRead(db);
  assert.deepEqual([row(r.body, 'fundraising-readiness').detail, row(r.body, 'fundraising-readiness').value], ['Readiness score', '70 of 100']);
  assert.deepEqual([r.body.meter.display, r.body.meter.target, r.body.meter.target_reason], ['$900k', null, 'No active round target is recorded']);
  for (const who of [OTHER, INVESTOR, PARTNER]) {
    const x = await rRead(db, who);
    assert.equal(x.status, 403);
    for (const k of ['focus', 'meter', 'index']) assert.equal(k in (x.body || {}), false);
  }
});

// ---------------------------------------------------------------------------
// Grow
// ---------------------------------------------------------------------------

const gApp = new Hono<any>();
gApp.route('/api/cycles/grow', cycleGrow);
const gRead = (db: any, who = FOUNDER, pid = P) => request(gApp, db, who, `/api/cycles/grow/overview?project=${pid}`);
const growFixture = () => {
  const db = fixture(null);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(P, ADVISOR);
  return db;
};

test('9: a new venture enters the first KPI; old feedback and a seeded obligation each count as a record', async () => {
  const db = growFixture();
  const r = await gRead(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.focus, {
    rule: 'first_kpi', eyebrow: 'Grow · Next', headline: 'Enter the first KPI.', why: 'Nothing in Grow is recorded yet.',
    cta: { label: 'Enter a KPI', href: `/grow/focus?project_id=${P}` }, then: null,
  });
  assert.equal(r.body.meter, null);
  assert.deepEqual(r.body.index.map((x: any) => x.key), [
    'updates', 'product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building',
  ]);
  for (const x of r.body.index) assert.equal(x.value, null, x.key);

  // Another venture's records do not stop it.
  db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, status, created_at) VALUES ('fo', ?, 'Their ask', 'customer', 'open', ?)`).run(P_OTHER, `${TODAY} 10:00:00`);
  assert.equal((await gRead(db)).body.focus.rule, 'first_kpi');

  db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, status, created_at) VALUES ('f1', ?, 'Bulk export', 'customer', 'open', ?)`).run(P, `${day(-120)} 10:00:00`);
  assert.notEqual((await gRead(db)).body.focus?.rule, 'first_kpi', 'feedback older than the card\'s range still counts');
  db.exec(`DELETE FROM product_feedback WHERE project_id = ${P}`);
  db.prepare(`INSERT INTO compliance_events (project_id, jurisdiction, event_type, title, due_date, source) VALUES (?, 'Delaware', 'annual_report', 'Annual report', ?, 'auto')`).run(P, day(40));
  assert.notEqual((await gRead(db)).body.focus?.rule, 'first_kpi', 'a seeded obligation counts');
});

test('3 and 9: an advisor member never gets a Grow write focus', async () => {
  const db = growFixture();
  const r = await gRead(db, ADVISOR);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const k of ['focus', 'meter', 'index']) assert.ok(k in r.body, k);
  assert.ok(['card', null].includes(r.body.focus?.rule ?? null));
  const other = await gRead(db, OTHER);
  assert.equal(other.status, 403);
  for (const k of ['focus', 'meter', 'index']) assert.equal(k in (other.body || {}), false);
});

test('9: Updates counts sent and submitted updates only, and never another venture\'s', async () => {
  const db = growFixture();
  const ins = db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, sent_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run('u1', P, FOUNDER, 'September', 'sent', `${day(-20)} 10:00:00`, null);
  ins.run('u2', P, FOUNDER, 'October', 'submitted', null, `${day(-2)} 10:00:00`);
  ins.run('u3', P, FOUNDER, 'Draft', 'draft', null, null);
  ins.run('u4', P_OTHER, OTHER, 'Theirs', 'sent', `${day(-5)} 10:00:00`, null);
  const r = await gRead(db);
  assert.deepEqual([row(r.body, 'updates').detail, row(r.body, 'updates').value, row(r.body, 'updates').href], ['Updates shared', '2', `/grow/updates?project=${P}`]);
});

// ---------------------------------------------------------------------------
// 10. No brackets, no doubled Then, no dead links · 11. Each part fails alone
// ---------------------------------------------------------------------------

function routesOf() {
  const app = readFileSync(resolve(ROOT, 'frontend/src/App.jsx'), 'utf8');
  return [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
}
const SLUGS: Record<string, string[]> = {
  validate: ['problem-discovery', 'customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments'],
  build: ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'],
  raise: ['fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships'],
  grow: ['product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building'],
};
function routed(href: string, routes: string[]): boolean {
  const path = href.split('?')[0];
  return routes.some((r) => {
    if (r === path) return true;
    const m = /^\/(validate|raise|grow|build)\/:slug$/.exec(r);
    if (!m) {
      // Segment by segment, so a route's own text is never compiled as a pattern.
      const want = r.split('/'), got = path.split('/');
      return !r.includes(':slug') && want.length === got.length
        && want.every((s, i) => (s.startsWith(':') ? got[i] !== '' : s === got[i]));
    }
    const [, cycle, slug] = /^\/([a-z]+)\/([^/]+)$/.exec(path) || [];
    return cycle === m[1] && (SLUGS[cycle] || []).includes(slug);
  });
}
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

test('10: every read carries the three parts; no bracket, undefined, NaN or leading Then; every href is a route', async () => {
  const routes = routesOf();
  const reads: any[] = [];
  const v = fixture(null);
  reads.push((await vRead(v)).body);
  for (let i = 0; i < 3; i += 1) interview(v, P, { pains: ['slow dispatch'] });
  target(v, 20);
  v.prepare("INSERT INTO validation_decisions (project_id, decision, decided_at) VALUES (?, 'proceed', ?)").run(P, `${day(-3)} 09:00:00`);
  reads.push((await vRead(v)).body, (await vRead(v, PARTNER)).body);
  const iv = interview(v, P);
  session(v, iv, 'transcribed', `${day(-1)} 10:00:00`);
  reads.push((await vRead(v)).body);
  assert.equal(reads[reads.length - 1].focus.rule, 'review', 'the review href is checked as a route too');
  const b = fixture();
  reads.push((await bRead(b)).body);
  mustHaves(b);
  tool(b, 'active', 'hubspot', 'crm');
  b.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(day(10), P);
  reads.push((await bRead(b)).body, (await bRead(b, PARTNER)).body);
  const r = fixture();
  reads.push((await rRead(r)).body);
  prospect(r, P, 'meeting', day(1));
  FLAGS = { ROUND_CALLS_ENABLED: 'true' };
  try { reads.push((await rRead(r)).body); } finally { FLAGS = {}; }
  const g = growFixture();
  reads.push((await gRead(g)).body, (await gRead(g, ADVISOR)).body);
  for (const body of reads) {
    for (const k of ['focus', 'meter', 'index']) assert.ok(k in body, `${body.cycle}: ${k}`);
    for (const s of strings({ focus: body.focus, meter: body.meter, index: body.index })) {
      assert.doesNotMatch(s, /\[|\]|undefined|NaN/, `${body.cycle}: ${s}`);
      assert.doesNotMatch(s, /^Then /, `${body.cycle}: ${s}`);
    }
    const hrefs = [body.focus?.cta?.href, ...(body.index || []).map((x: any) => x.href)].filter(Boolean);
    for (const h of hrefs) assert.ok(routed(h, routes), `${body.cycle}: ${h} is not a route`);
  }
});

test('11: a throwing query in one part leaves that part null and the rest of the read as it was', async () => {
  const v = fixture(null);
  interview(v, P);
  const whole = (await vRead(v)).body;
  for (const [needle, nulled] of [
    ['SELECT target_value FROM metric_targets', 'meter'],
    ['FROM interview_sessions s JOIN discovery_interviews', 'focus'],
  ] as const) {
    NEEDLE = needle;
    try {
      const x = (await vRead(v)).body;
      assert.equal(x[nulled], null, `validate ${nulled}`);
      for (const k of ['focus', 'meter', 'index'].filter((y) => y !== nulled)) assert.notEqual(x[k], null, `validate ${k}`);
      assert.deepEqual(x.figures, whole.figures);
      // The demand card reads its bar with the meter's own statement text, so
      // it shares that failure; every other card reads as it did.
      const states = (body: any) => body.cards.filter((c: any) => nulled !== 'meter' || c.slug !== 'demand-signals').map((c: any) => c.state);
      assert.deepEqual(states(x), states(whole));
    } finally { NEEDLE = null; }
  }

  // Build's parts read only what the overview already holds; an unreadable
  // module read reaches them as "Unreadable", never as a failed read.
  const b = fixture();
  mustHaves(b);
  tool(b, 'active', 'hubspot', 'crm');
  NEEDLE = 'FROM project_core_systems s\n       JOIN integrations i';
  try {
    const x = (await bRead(b)).body;
    assert.equal(x.cards[5].state, 'unreadable');
    assert.equal(row(x, 'tools').value, 'Unreadable');
    assert.ok(['card', null].includes(x.focus?.rule ?? null), 'no connect rule from an unreadable systems read');
    assert.equal(x.meter.display, '7 of 9');
  } finally { NEEDLE = null; }

  const r = fixture();
  const rWhole = (await rRead(r)).body;
  NEEDLE = 'EXISTS(SELECT 1 FROM readiness_items';
  try {
    const x = (await rRead(r)).body;
    assert.equal(x.focus, null);
    assert.ok(Array.isArray(x.index));
    assert.deepEqual(x.figures, rWhole.figures);
    assert.deepEqual(x.cards, rWhole.cards);
  } finally { NEEDLE = null; }

  const g = growFixture();
  const gWhole = (await gRead(g)).body;
  NEEDLE = 'EXISTS(SELECT 1 FROM product_feedback';
  try {
    const x = (await gRead(g)).body;
    assert.equal(x.focus, null);
    assert.ok(Array.isArray(x.index));
    assert.deepEqual(x.figures.map((f: any) => f.state), gWhole.figures.map((f: any) => f.state));
    assert.deepEqual(x.cards.map((c: any) => c.state), gWhole.cards.map((c: any) => c.state));
  } finally { NEEDLE = null; }
  NEEDLE = 'COUNT(*) AS n FROM portfolio_updates';
  try {
    const x = (await gRead(g)).body;
    assert.equal(row(x, 'updates').value, 'Unreadable');
    assert.equal(x.focus?.rule, 'first_kpi');
  } finally { NEEDLE = null; }
});

test('the helpers: one sentence, no leading Then; the canvas\'s money; the card rule and card values', () => {
  assert.equal(sentence('then group two more interviews into a theme'), 'Group two more interviews into a theme.');
  assert.equal(sentence('Ship it..'), 'Ship it.');
  assert.equal(sentence('  '), '');
  assert.deepEqual([usdShort(610e6), usdShort(900e3), usdShort(1.5e6), usdShort(null)], ['$610M', '$900k', '$1.5M', null]);
  assert.equal(dayMonth('2026-03-12'), '12 Mar');
  const card = (next: any) => ({ slug: 's', name: 'S', caption: 'Why it matters.', state: 'ok', series: [], range: 'Now', reason: null, next }) as any;
  assert.equal(cardFocus('build', [card({ text: 'Off site', href: 'https://example.test' })]), null, 'only an in-app next');
  assert.deepEqual(cardFocus('build', [card(null), card({ text: 'Mark the first must-have', href: '/build/prototype-mvp?project=1' })]), {
    rule: 'card', eyebrow: 'Build · Next', headline: 'Mark the first must-have.', why: 'Why it matters.',
    cta: { label: 'Mark the first must-have', href: '/build/prototype-mvp?project=1' }, then: null,
  });
  assert.deepEqual(['ok', 'too_little', 'unreadable', 'empty', 'not_recorded'].map((state) => cardValue({ state } as any)), ['', '', 'Unreadable', null, null]);
});
