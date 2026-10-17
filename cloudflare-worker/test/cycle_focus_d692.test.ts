/**
 * D692 (#1701, PR 1) — each cycle's phone root: Validate's, Raise's and
 * Grow's overview reads return `focus`, `meter` and `index` in one shape, on
 * real SQLite. Build's arrive with PR 2, after #1652's Worker PR.
 *
 * The fixtures are built the way `cycle_validate_d659.test.ts`,
 * `cycle_raise_d663.test.ts` and `cycle_grow_d664.test.ts` build theirs.
 * Every name is made up, and every date is computed from the test's today.
 * Test numbers follow the issue's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { daysBefore } from '../src/services/cycleValidate.ts';
import { focusOf } from '../src/services/validateFocus.ts';
import { sentence, usdShort, dayMonth, cardFocus, cardValue } from '../src/services/cycleFocus.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const sqlOf = (file: string) => readFileSync(resolve(MIG, file), 'utf8');
const byPrefix = (p: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(`${p}_`))!), 'utf8');
const ddl = (p: string) => byPrefix(p).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => daysBefore(TODAY, n);

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50, ADVISOR = 70;
const P = 1, P_OTHER = 2;
const roleOf: Record<number, string> = {
  [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor', [ADVISOR]: 'founder',
};

/**
 * A D1 binding that throws on any statement containing `needle`, so one part
 * of the read can be made unreadable while the others still read.
 */
function failing(db: any, needle: string | null) {
  const inner = d1Over(db);
  if (!needle) return inner;
  return {
    ...inner,
    prepare(sql: string) {
      if (!sql.includes(needle)) return inner.prepare(sql);
      const boom = async () => { throw new Error('injected failure'); };
      const api: any = { bind: () => api, all: boom, first: boom, run: boom, runSync: () => { throw new Error('injected failure'); } };
      return api;
    },
  };
}

let FLAGS: Record<string, string> = {};
let NEEDLE: string | null = null;

async function request(app: Hono<any>, db: any, who: number, path: string, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: failing(db, NEEDLE), ...FLAGS, ...extra } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const row = (body: any, key: string) => (body.index || []).find((r: any) => r.key === key);

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

function validateDb() {
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
  db.exec(`CREATE TABLE IF NOT EXISTS interview_sessions (id INTEGER PRIMARY KEY, project_id INTEGER, interview_id INTEGER, status TEXT,
             stopped_at TEXT, updated_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS validate_proposals (id INTEGER PRIMARY KEY, project_id INTEGER, session_id INTEGER, kind TEXT,
             payload_json TEXT, edited_payload_json TEXT, status TEXT, run_id TEXT)`);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(ADMIN, 'admin', 'Ari Admin', 'ari@example.test', null);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Juniper Labs', 1001), (${P_OTHER}, 'Beta Freight', 1002)`);
  return db;
}

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

test('1: a founder with interviews and nothing to review records the next conversation, with the meter in the why', async () => {
  const db = validateDb();
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

  db.exec("DELETE FROM metric_targets");
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
  const db = validateDb();
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
  const db = validateDb();
  const first = (await vRead(db)).body.focus;
  assert.deepEqual(first, {
    rule: 'first_interview', eyebrow: 'Validate · Next', headline: 'Record your first conversation.',
    why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
    cta: { label: 'Record a session', href: `/validate/record?project=${P}` },
    then: 'Write the claim you most need to be true.',
  });
  const iv = interview(db, P);
  db.prepare("INSERT INTO interview_sessions (id, project_id, interview_id, status, stopped_at) VALUES (1, ?, ?, 'transcribed', ?)").run(P, iv, `${ago(1)} 10:00:00`);
  const review = (await vRead(db)).body.focus;
  assert.equal(review.rule, 'review');
  assert.equal(review.cta.href, `/validate/interviews/${iv}`);
  const app = readFileSync(resolve(ROOT, 'frontend/src/App.jsx'), 'utf8');
  assert.ok(app.includes('<Route path="/validate/interviews/:id"'), 'the review href is a route');
  db.exec("UPDATE interview_sessions SET status = 'placed'");
  assert.equal((await vRead(db)).body.focus.rule, 'next_interview');
});

test('3: a partner on Validate gets the card rule, never a write; with no card next, no focus', async () => {
  const db = validateDb();
  interview(db, P);
  const iv = interview(db, P);
  db.prepare("INSERT INTO interview_sessions (id, project_id, interview_id, status, stopped_at) VALUES (1, ?, ?, 'transcribed', ?)").run(P, iv, `${ago(1)} 10:00:00`);
  const p = await vRead(db, PARTNER);
  assert.equal(p.status, 200);
  assert.ok(['card', null].includes(p.body.focus?.rule ?? null));
  assert.notEqual(p.body.focus?.rule, 'review');
  assert.notEqual(p.body.focus?.rule, 'next_interview');
  // cardFocus itself: no in-app next → null, never "Record a session.".
  assert.equal(cardFocus('validate', [{ slug: 'x', name: 'X', state: 'ok', range: '', caption: '', series: null, next: { text: 'Open the guide', href: 'https://example.test' }, reason: null }]), null);
  assert.equal(cardFocus('validate', []), null);
});

test('4: a founder\'s index is the canvas\'s seven rows with Verdict last; a partner\'s has no decision anywhere', async () => {
  const db = validateDb();
  interview(db, P, { pains: ['slow dispatch'] });
  const decided = `${ago(77)} 09:30:00`;
  // A superseded decision dated after the current one: the filter, not the order, keeps it out.
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by, superseded_at) VALUES (?, 'stop', 'old', ?, ?, ?)").run(P, `${ago(10)} 09:00:00`, FOUNDER, `${ago(9)} 09:30:00`);
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by) VALUES (?, 'proceed', 'Carriers pay', ?, ?)").run(P, decided, FOUNDER);
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_at, decided_by) VALUES (?, 'pivot', 'theirs', ?, ?)").run(P_OTHER, `${ago(2)} 09:30:00`, OTHER);
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
  const db = validateDb();
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
  assert.equal(cardValue({ state: 'unreadable' } as any), 'Unreadable');
  assert.equal(cardValue({ state: 'too_little' } as any), '');
  assert.equal(cardValue({ state: 'empty' } as any), null);
});

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

function raiseDb() {
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
  db.exec(sqlOf('436_round_calls.sql'));
  db.exec(sqlOf('456_round_call_counsel_terms.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Juniper Labs', 1001), (${P_OTHER}, 'Beta Freight', 1002)`);
  return db;
}

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
  const db = raiseDb();
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
  const db = raiseDb();
  prospect(db, P, 'meeting', ago(-2));
  FLAGS = {};
  const r = await rRead(db);
  assert.notEqual(r.body.focus?.rule, 'call_for_capital');
  assert.deepEqual(r.body.index.map((x: any) => x.key), [
    'fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships',
  ]);
});

test('8: with the flag on and no open call, the call focus, the meter and the follow-ups due or overdue', async () => {
  const db = raiseDb();
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status) VALUES ('r1', ${P}, 'Seed', 1500000, 'active')`);
  prospect(db, P, 'committed', null, 600000);
  prospect(db, P, 'committed', null, 300000);
  prospect(db, P, 'meeting', ago(-1));
  prospect(db, P, 'contacted', ago(-6));
  prospect(db, P, 'diligence', ago(3)); // overdue
  prospect(db, P, 'meeting', ago(-30)); // not this week
  prospect(db, P_OTHER, 'meeting', ago(-1)); // another venture's
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
    prospect(db, P, 'meeting', ago(1));
    assert.equal((await rRead(db)).body.focus.then, 'Follow up with the 1 investor due or overdue this week.');

    // An open call: the card rule leads, and Calls reads "1 open".
    db.exec(`INSERT INTO round_calls (id, uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
             VALUES (1, 'call-1', ${P}, 'Seed call', 100000000, 'safe', 'Post-money SAFE', 2500000, '${ago(-30)}', 'sent', 'h', ${FOUNDER})`);
    const open = await rRead(db);
    assert.ok(['card', null].includes(open.body.focus?.rule ?? null));
    assert.equal(row(open.body, 'calls').value, '1 open');
  } finally { FLAGS = {}; }
});

test('8: readiness reads as a score out of 100; a commitment with no target shows the count alone', async () => {
  const db = raiseDb();
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

const G = 7, G_OTHER = 8;

async function growDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
           CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
           CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT);
           CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  for (const p of ['034', '119', '127', '132', '326']) db.exec(ddl(p));
  db.exec(byPrefix('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(ddl('125')); db.exec(byPrefix('437'));
  db.exec(byPrefix('443'));
  // The baseline's compliance_events carries `source` (seeded rows are 'auto'); 034's shape does not.
  db.exec('ALTER TABLE compliance_events ADD COLUMN source TEXT');
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 1001, 'Ada Quill', 'ada@example.test');
  u.run(ADVISOR, 'founder', 1003, 'Ari Advisor', 'ari@example.test');
  u.run(OTHER, 'founder', 1002, 'Bo Other', 'bo@example.test');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, 'p7', 'Juniper Labs', 1001, NULL), (?, 'p8', 'Beta Freight', 1002, NULL)`).run(G, G_OTHER);
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(G, ADVISOR);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  return db;
}

const gApp = new Hono<any>();
gApp.route('/api/cycles/grow', cycleGrow);
const gRead = (db: any, who = FOUNDER, pid = G) => request(gApp, db, who, `/api/cycles/grow/overview?project=${pid}`);

test('9: a new venture enters the first KPI; old feedback and a seeded obligation each count as a record', async () => {
  const db = await growDb();
  const r = await gRead(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.focus, {
    rule: 'first_kpi', eyebrow: 'Grow · Next', headline: 'Enter the first KPI.', why: 'Nothing in Grow is recorded yet.',
    cta: { label: 'Enter a KPI', href: `/grow/focus?project_id=${G}` }, then: null,
  });
  assert.equal(r.body.meter, null);
  assert.deepEqual(r.body.index.map((x: any) => x.key), [
    'updates', 'product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building',
  ]);
  for (const x of r.body.index) assert.equal(x.value, null, x.key);

  // Another venture's records do not stop it.
  db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, status, created_at) VALUES ('fo', ?, 'Their ask', 'customer', 'open', ?)`).run(G_OTHER, `${TODAY} 10:00:00`);
  assert.equal((await gRead(db)).body.focus.rule, 'first_kpi');

  db.prepare(`INSERT INTO product_feedback (uid, project_id, body, source, status, created_at) VALUES ('f1', ?, 'Bulk export', 'customer', 'open', ?)`).run(G, `${ago(120)} 10:00:00`);
  assert.notEqual((await gRead(db)).body.focus?.rule, 'first_kpi', 'feedback older than the card\'s range still counts');
  db.exec('DELETE FROM product_feedback');
  db.prepare(`INSERT INTO compliance_events (project_id, title, due_at, status, source) VALUES (?, 'Annual report', ?, 'pending', 'auto')`).run(G, ago(-40));
  assert.notEqual((await gRead(db)).body.focus?.rule, 'first_kpi', 'a seeded obligation counts');
});

test('3 and 9: an advisor member never gets a Grow write focus', async () => {
  const db = await growDb();
  const r = await gRead(db, ADVISOR);
  assert.equal(r.status, 200);
  for (const k of ['focus', 'meter', 'index']) assert.ok(k in r.body, k);
  assert.ok(['card', null].includes(r.body.focus?.rule ?? null));
  const other = await gRead(db, OTHER);
  assert.equal(other.status, 403);
  for (const k of ['focus', 'meter', 'index']) assert.equal(k in (other.body || {}), false);
});

test('9: Updates counts sent and submitted updates only, and never another venture\'s', async () => {
  const db = await growDb();
  const ins = db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, sent_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run('u1', G, FOUNDER, 'September', 'sent', `${ago(20)} 10:00:00`, null);
  ins.run('u2', G, FOUNDER, 'October', 'submitted', null, `${ago(2)} 10:00:00`);
  ins.run('u3', G, FOUNDER, 'Draft', 'draft', null, null);
  ins.run('u4', G_OTHER, OTHER, 'Theirs', 'sent', `${ago(5)} 10:00:00`, null);
  const r = await gRead(db);
  assert.deepEqual([row(r.body, 'updates').detail, row(r.body, 'updates').value, row(r.body, 'updates').href], ['Updates shared', '2', `/grow/updates?project=${G}`]);
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
  raise: ['fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships'],
  grow: ['product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building'],
};
function routed(href: string, routes: string[]): boolean {
  const path = href.split('?')[0];
  return routes.some((r) => {
    if (r === path) return true;
    const m = /^\/(validate|raise|grow|build)\/:slug$/.exec(r);
    if (!m) {
      const re = new RegExp(`^${r.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
      return !r.includes(':slug') && re.test(path);
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
  const v = validateDb();
  reads.push((await vRead(v)).body);
  for (let i = 0; i < 3; i += 1) interview(v, P, { pains: ['slow dispatch'] });
  target(v, 20);
  v.prepare("INSERT INTO validation_decisions (project_id, decision, decided_at) VALUES (?, 'proceed', ?)").run(P, `${ago(3)} 09:00:00`);
  reads.push((await vRead(v)).body, (await vRead(v, PARTNER)).body);
  const r = raiseDb();
  reads.push((await rRead(r)).body);
  prospect(r, P, 'meeting', ago(-1));
  FLAGS = { ROUND_CALLS_ENABLED: 'true' };
  try { reads.push((await rRead(r)).body); } finally { FLAGS = {}; }
  const g = await growDb();
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
  const v = validateDb();
  interview(v, P);
  const whole = (await vRead(v)).body;
  for (const [needle, nulled] of [
    ['SELECT target_value FROM metric_targets', 'meter'],
    ['FROM interview_sessions s JOIN discovery_interviews', 'focus'],
  ] as const) {
    NEEDLE = needle;
    try {
      const b = (await vRead(v)).body;
      assert.equal(b[nulled], null, `validate ${nulled}`);
      for (const k of ['focus', 'meter', 'index'].filter((x) => x !== nulled)) assert.notEqual(b[k], null, `validate ${k}`);
      assert.deepEqual(b.figures, whole.figures);
      // The demand card reads its bar with the meter's own statement text, so
      // it shares that failure; every other card reads as it did.
      const states = (body: any) => body.cards.filter((c: any) => nulled !== 'meter' || c.slug !== 'demand-signals').map((c: any) => c.state);
      assert.deepEqual(states(b), states(whole));
    } finally { NEEDLE = null; }
  }

  const r = raiseDb();
  const rWhole = (await rRead(r)).body;
  NEEDLE = 'EXISTS(SELECT 1 FROM readiness_items';
  try {
    const b = (await rRead(r)).body;
    assert.equal(b.focus, null);
    assert.ok(Array.isArray(b.index));
    assert.deepEqual(b.figures, rWhole.figures);
    assert.deepEqual(b.cards, rWhole.cards);
  } finally { NEEDLE = null; }

  const g = await growDb();
  const gWhole = (await gRead(g)).body;
  NEEDLE = 'EXISTS(SELECT 1 FROM product_feedback';
  try {
    const b = (await gRead(g)).body;
    assert.equal(b.focus, null);
    assert.ok(Array.isArray(b.index));
    assert.deepEqual(b.figures.map((f: any) => f.state), gWhole.figures.map((f: any) => f.state));
    assert.deepEqual(b.cards.map((c: any) => c.state), gWhole.cards.map((c: any) => c.state));
  } finally { NEEDLE = null; }
  NEEDLE = 'COUNT(*) AS n FROM portfolio_updates';
  try {
    const b = (await gRead(g)).body;
    assert.equal(row(b, 'updates').value, 'Unreadable');
    assert.equal(b.focus?.rule, 'first_kpi');
  } finally { NEEDLE = null; }
});

test('the helpers: one sentence, no leading Then; the canvas\'s money', () => {
  assert.equal(sentence('then group two more interviews into a theme'), 'Group two more interviews into a theme.');
  assert.equal(sentence('Ship it..'), 'Ship it.');
  assert.equal(sentence('  '), '');
  assert.deepEqual([usdShort(610e6), usdShort(900e3), usdShort(1.5e6), usdShort(null)], ['$610M', '$900k', '$1.5M', null]);
});
