/**
 * D659 (#1472) — `/api/cycles/validate` on real SQLite: the baseline's own
 * tables, migration 440 applied over them, the route mounted on a bare Hono.
 *
 * What #1472 says must be tested, each below by name:
 *   · one failing source → only its card is unreadable;
 *   · a missing value is null with a reason, never 0;
 *   · two points → too_little, no line;
 *   · a new venture → every card empty with its one starting action;
 *   · old two-level severities read correctly under three levels;
 *   · a Lab venture's read gives the Lab page's own figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleValidate from '../src/routes/cycle_validate.ts';
import { CARD_STATES } from '../src/services/cycleCards.ts';
import { getPainGroupsView } from '../src/services/painGroups.ts';
import { daysBefore } from '../src/services/cycleValidate.ts';
import { labDiscoveryCounts } from '../../frontend/src/lib/labDiscovery.js';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const MIG440 = sqlOf('440_validate_cycle_stores.sql');
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => daysBefore(TODAY, n);

const FOUNDER = 10, OTHER = 20, ADMIN = 30, PARTNER = 40, INVESTOR = 50, LAB = 60;
const P = 1, P_OTHER = 2, P_LAB = 3;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(MIG440);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 0);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002, 0);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null, 0);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null, 0);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null, 0);
  // An admitted Lab member keeps an `exploring` role and owns their venture.
  u.run(LAB, 'exploring', 'Lou Lab', 'lou@example.test', 1003, 1);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P_OTHER}, 'Beta', 1002), (${P_LAB}, 'Lab venture', 1003)`);
  return db;
}

/** D690 decision 9: the interview log reads each interview's latest session, so its tests carry the real store. */
function withSessionStore(db: any) {
  db.exec(sqlOf('438_interview_sessions.sql'));
  db.exec(sqlOf('447_assistant_interviews.sql').replace(/ALTER TABLE validate_proposals[^;]*;/, ''));
  db.exec(sqlOf('453_interview_processing.sql'));
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/validate', cycleValidate);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

const roleOf: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [PARTNER]: 'partner', [INVESTOR]: 'investor', [LAB]: 'exploring' };
async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: roleOf[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const overview = (db: any, who = FOUNDER, pid = P) => call(db, who, 'GET', `/overview?project=${pid}`);
const card = (o: any, slug: string) => o.cards.find((c: any) => c.slug === slug);
const fig = (o: any, key: string) => o.figures.find((f: any) => f.key === key);

let ivSeq = 0;
function interview(db: any, pid: number, o: Record<string, unknown> = {}) {
  ivSeq += 1;
  const r = db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interview_date, pains_json,
       hypotheses_json, notes, icp_fit, quote_consent, stage, booked_at, segment_id, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).get(
    pid, o.name ?? `Person ${ivSeq}`, o.company ?? null, o.date ?? TODAY, JSON.stringify(o.pains ?? []),
    JSON.stringify(o.hyps ?? []), o.notes ?? null, o.fit ?? null, o.consent ?? null, o.stage ?? null,
    o.booked_at ?? null, o.segment_id ?? null, o.channel ?? null,
  ) as any;
  return Number(r.id);
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test('D659: the overview is #1469\'s shape — four figures, six cards, every state one of five', async () => {
  const db = fixture();
  interview(db, P, { pains: ['slow dispatch'] });
  const r = await overview(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cycle, 'validate');
  assert.equal(r.body.question, 'Is this worth building?');
  assert.deepEqual(r.body.figures.map((f: any) => f.key), ['interviews_this_month', 'pain_themes', 'hypotheses_supported', 'waitlist_signups']);
  assert.deepEqual(r.body.cards.map((c: any) => c.slug), ['problem-discovery', 'customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments']);
  for (const f of r.body.figures) {
    assert.deepEqual(Object.keys(f).filter((k) => k !== 'reason').sort(), ['as_of', 'delta_30d', 'key', 'label', 'source', 'spark', 'state', 'unit', 'value']);
    assert.ok((CARD_STATES as readonly string[]).includes(f.state), f.key);
  }
  for (const c of r.body.cards) {
    assert.deepEqual(Object.keys(c).sort(), ['caption', 'name', 'next', 'range', 'reason', 'series', 'slug', 'state']);
    assert.ok((CARD_STATES as readonly string[]).includes(c.state), c.slug);
  }
});

test('D659: a new venture — every card empty with its one starting action, every figure null, none 0', async () => {
  const db = fixture();
  const r = await overview(db);
  assert.equal(r.status, 200);
  for (const c of r.body.cards) {
    assert.equal(c.state, 'empty', c.slug);
    assert.ok(c.next && c.next.text && c.next.href.startsWith('/validate/'), `${c.slug} names its starting action`);
    assert.equal(c.series, null, `${c.slug} draws nothing`);
  }
  assert.equal(card(r.body, 'problem-discovery').next.text, 'Record your first session');
  assert.equal(card(r.body, 'ideal-customer-profile').next.text, 'Start the profile');
  assert.equal(card(r.body, 'market-intelligence').next.text, 'Add the total market, with its source');
  assert.equal(card(r.body, 'demand-signals').next.text, 'Connect a landing page');
  assert.equal(card(r.body, 'experiments').next.text, 'Write the claim you most need to be true');
  for (const f of r.body.figures) {
    assert.equal(f.value, null, `${f.key} is null, not 0`);
    assert.equal(f.delta_30d, null, `${f.key} change is null`);
    assert.equal(f.state, 'empty', f.key);
    assert.deepEqual(f.spark, []);
  }
});

// ---------------------------------------------------------------------------
// The five states
// ---------------------------------------------------------------------------

test('D659: one failing source makes only its own card unreadable, naming the source', async () => {
  const db = fixture();
  interview(db, P, { pains: ['slow dispatch'] });
  db.exec('DROP TABLE demand_signals');
  const r = await overview(db);
  assert.equal(r.status, 200, 'the overview as a whole still answers');
  const demand = card(r.body, 'demand-signals');
  assert.equal(demand.state, 'unreadable');
  assert.equal(demand.reason, 'Waitlist, demand signals and the revenue ledger could not be read');
  assert.equal(demand.series, null);
  for (const c of r.body.cards.filter((x: any) => x.slug !== 'demand-signals')) {
    assert.notEqual(c.state, 'unreadable', `${c.slug} is untouched by the demand store`);
  }
});

test('D659: a broken competitor store makes the market card unreadable and nothing else', async () => {
  const db = fixture();
  db.exec('DROP TABLE competitor_signals');
  db.exec("CREATE TABLE competitor_signals (id TEXT PRIMARY KEY)"); // no analysis_id: the join throws
  const r = await overview(db);
  assert.equal(card(r.body, 'market-intelligence').state, 'unreadable');
  assert.equal(card(r.body, 'market-intelligence').reason, 'Market figures and the competitor list could not be read');
  assert.deepEqual(r.body.cards.filter((c: any) => c.state === 'unreadable').map((c: any) => c.slug), ['market-intelligence']);
});

test('D659: a failing figure source is that figure\'s unreadable, with a null value', async () => {
  const db = fixture();
  interview(db, P);
  db.exec('DROP TABLE waitlist_signups');
  const r = await overview(db);
  const w = fig(r.body, 'waitlist_signups');
  assert.equal(w.state, 'unreadable');
  assert.equal(w.value, null);
  assert.equal(w.reason, 'waitlist_signups could not be read');
  assert.equal(fig(r.body, 'interviews_this_month').state, 'ok');
});

test('D659: a value the source does not hold is null with its reason — never 0', async () => {
  const db = fixture();
  db.exec(`UPDATE projects SET tam = 4200000000 WHERE id = ${P}`);
  interview(db, P, { pains: ['slow dispatch'] });
  db.prepare("INSERT INTO waitlist_signups (project_id, email, audience) VALUES (?, 'a@x.test', 'customer')").run(P);
  const r = await overview(db);
  const m = card(r.body, 'market-intelligence').series;
  assert.deepEqual(m.tam, { value: 4200000000, source: null, reason: 'No source recorded for this figure' });
  assert.deepEqual(m.sam, { value: null, source: null, reason: 'No figure entered' });
  const d = card(r.body, 'demand-signals').series;
  assert.equal(d.bar, null);
  assert.equal(d.bar_reason, 'No bar set');
  assert.equal(d.need_to_have, null, 'no interview judged → no share, not 0%');
  assert.equal(d.need_to_have_reason, 'No interview has a pain judged yet');
});

test('D659: two points draw no line — too_little; a third draws one', async () => {
  const db = fixture();
  interview(db, P, { date: ago(1) });
  interview(db, P, { date: ago(8) });
  let r = await overview(db);
  const cr = card(r.body, 'customer-research');
  assert.equal(cr.state, 'too_little');
  assert.equal(cr.reason, '2 weeks with an interview in the last 12. The chart appears at 3.');
  assert.deepEqual(fig(r.body, 'interviews_this_month').spark, [], 'no sparkline through two points');
  interview(db, P, { date: ago(15) });
  r = await overview(db);
  assert.equal(card(r.body, 'customer-research').state, 'ok');
  assert.equal(fig(r.body, 'interviews_this_month').spark.length, 8);
  assert.equal(fig(r.body, 'interviews_this_month').spark.reduce((a: number, b: number) => a + b, 0), 3);
});

test('D659: weekly interviews are bucketed by the day each was held', async () => {
  const db = fixture();
  interview(db, P, { date: ago(0) });
  interview(db, P, { date: ago(3) });
  interview(db, P, { date: ago(10) });
  interview(db, P, { date: ago(90) });
  interview(db, P, { date: ago(2), stage: 'booked' }); // booked is not held
  const r = await overview(db);
  const weeks = card(r.body, 'customer-research').series.weeks.map((w: any) => w.interviews);
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11], 2, 'this week');
  assert.equal(weeks[10], 1, 'last week');
  assert.equal(weeks.reduce((a: number, b: number) => a + b, 0), 3, 'ninety days ago is outside twelve weeks');
});

// ---------------------------------------------------------------------------
// Severity, three levels over two
// ---------------------------------------------------------------------------

test('D659: an old need reads as Severe and an old nice as Mild; Real is the new middle', async () => {
  const db = fixture();
  const a = interview(db, P, { pains: ['Slow dispatch', 'Manual invoicing', 'Bad reports'] });
  const b = interview(db, P, { pains: ['Slow dispatch', 'Bad reports'] });
  const sev = db.prepare('INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, ?, ?)');
  sev.run(a, 'slow dispatch', 'need');
  sev.run(b, 'slow dispatch', 'need');
  sev.run(a, 'manual invoicing', 'nice');
  sev.run(a, 'bad reports', 'real');
  // A tie between levels reads as the more severe one.
  const c = interview(db, P, { pains: ['Late payments'] });
  const d = interview(db, P, { pains: ['Late payments'] });
  sev.run(c, 'late payments', 'nice');
  sev.run(d, 'late payments', 'need');
  const r = await overview(db);
  const themes = card(r.body, 'problem-discovery').series.themes;
  const by = Object.fromEntries(themes.map((t: any) => [t.theme, t]));
  assert.equal(by['Slow dispatch'].severity, 'severe');
  assert.equal(by['Slow dispatch'].severe, 2);
  assert.equal(by['Manual invoicing'].severity, 'mild');
  assert.equal(by['Bad reports'].severity, 'real');
  assert.equal(by['Late payments'].severity, 'severe', 'one Severe and one Mild read as Severe');
  // Nothing was rewritten.
  assert.deepEqual(db.prepare('SELECT severity FROM interview_pain_severities ORDER BY id').all().map((x: any) => x.severity), ['need', 'need', 'nice', 'real', 'nice', 'need']);
  // And the old two-count view counts the new level on its own scale.
  const view = await getPainGroupsView({ DB: d1Over(db) } as any, P);
  const reports = view.ungrouped.find((u: any) => u.display_phrase === 'Bad reports')!;
  assert.equal(reports.need_count, 1, 'Real counts as a need on the two-level view');
  assert.equal(reports.nice_count, 0);
  // The need-to-have share: interviews that judged a pain Severe or Real.
  const share = card(r.body, 'demand-signals').series.need_to_have;
  assert.deepEqual(share, { interviews: 3, of: 4 }, 'interview c judged its only pain Mild');
});

// ---------------------------------------------------------------------------
// `next` comes from records
// ---------------------------------------------------------------------------

test('D659: next names the number it counted — the invited leads with no slot', async () => {
  const db = fixture();
  interview(db, P, { stage: 'invited' });
  interview(db, P, { stage: 'invited' });
  interview(db, P, { stage: 'invited', booked_at: `${TODAY}T09:00:00Z` });
  interview(db, P, { stage: 'lead' });
  interview(db, P);
  db.prepare("INSERT INTO waitlist_signups (project_id, email, audience, crm_status) VALUES (?, 'n@x.test', 'customer', 'new'), (?, 'i@x.test', 'customer', 'invited')").run(P, P);
  const r = await overview(db);
  const cr = card(r.body, 'customer-research');
  assert.deepEqual(cr.next, { text: 'Book the 2 invited leads with no slot yet', href: `/validate/customer-research?project=${P}` });
  assert.deepEqual(cr.series.funnel, { lead: 7, invited: 5, booked: 1, done: 1 });
});

// ---------------------------------------------------------------------------
// The Spin-Out Lab reads through the same module read
// ---------------------------------------------------------------------------

test('D659: a Lab venture\'s read gives the Lab discovery page\'s own funnel, readiness and claim counts', async () => {
  const db = fixture();
  const rows = [
    { pains: ['Slow dispatch', 'No visibility'], hyps: [{ hypothesis: 'Fleets pay for dispatch', status: 'validated' }], notes: 'Long call' },
    { pains: ['Slow dispatch'], hyps: [{ hypothesis: 'Fleets pay for dispatch', status: 'invalidated' }, { hypothesis: 'Drivers use phones', status: 'open' }], notes: '' },
    { pains: ['Paper forms'], hyps: [], notes: 'Short' },
  ];
  for (const o of rows) interview(db, P_LAB, o);
  const ins = db.prepare("INSERT INTO waitlist_signups (project_id, email, audience, crm_status) VALUES (?, ?, 'customer', ?)");
  ins.run(P_LAB, 'a@x.test', 'new');
  ins.run(P_LAB, 'b@x.test', 'invited');
  ins.run(P_LAB, 'c@x.test', 'followed_up');
  db.prepare("INSERT INTO waitlist_signups (project_id, email, audience, crm_status) VALUES (?, 'inv@x.test', 'investor', 'new')").run(P_LAB);

  const r = await overview(db, LAB, P_LAB);
  assert.equal(r.status, 200, 'the admitted Lab member reads their own venture');

  // What the Lab page computes, from the same three reads it makes.
  const ivRows = db.prepare('SELECT * FROM discovery_interviews WHERE project_id = ? ORDER BY id').all(P_LAB);
  const signups = db.prepare("SELECT crm_status FROM waitlist_signups WHERE project_id = ? AND audience = 'customer'").all(P_LAB);
  const painData = await getPainGroupsView({ DB: d1Over(db) } as any, P_LAB);
  const page = labDiscoveryCounts({ interviews: ivRows, signups, painData });

  const lab = card(r.body, 'customer-research').series.lab;
  assert.deepEqual(lab.funnel, page.funnel);
  assert.deepEqual(lab.readiness, page.readiness);
  assert.equal(lab.distinct_pains, page.distinctPains);
  assert.deepEqual(lab.hypotheses, { total: page.hypTotal, validated: page.hypValidated, invalidated: page.hypInvalidated, inconclusive: page.hypInconclusive });
  assert.deepEqual(card(r.body, 'experiments').series.interview_claims, lab.hypotheses);
  // And the figures a reader sees for the venture are the page's.
  assert.equal(fig(r.body, 'hypotheses_supported').value, page.hypValidated);
  assert.equal(fig(r.body, 'hypotheses_supported').unit, `of ${page.hypTotal}`);
  // The page's numbers are not vacuous.
  assert.deepEqual(page.funnel.map((f: any) => f.n), [6, 5, 3, 1]);
  assert.deepEqual(page.readiness.map((x: any) => x.ok), [true, true, false, true]);
});

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

test('D659: the founder board\'s audience reads; an investor or another founder does not; a partner cannot write', async () => {
  const db = fixture();
  assert.equal((await overview(db, FOUNDER)).status, 200);
  assert.equal((await overview(db, ADMIN)).status, 200);
  assert.equal((await overview(db, PARTNER)).status, 200);
  assert.equal((await overview(db, OTHER)).status, 403);
  assert.equal((await overview(db, INVESTOR)).status, 403);
  assert.equal((await overview(db, LAB, P)).status, 403, 'a Lab member owns only their own venture');
  assert.equal((await call(db, PARTNER, 'POST', `/segments?project=${P}`, { name: 'Ops leads' })).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/overview?project=1%20OR%201=1')).status, 400);
  assert.equal((await call(db, FOUNDER, 'GET', '/overview?project=999')).status, 404);
});

// ---------------------------------------------------------------------------
// The writers
// ---------------------------------------------------------------------------

test('D659: a segment is written once per name, an interview is placed in it, and the actor is recorded', async () => {
  const db = fixture();
  const first = await call(db, FOUNDER, 'POST', `/segments?project=${P}`, { name: 'Ops leads' });
  assert.equal(first.status, 201);
  const again = await call(db, ADMIN, 'POST', `/segments?project=${P}`, { name: '  ops   LEADS ' });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id, 'the same name is the same segment');
  const iv = interview(db, P, { fit: 'strong' });
  assert.equal((await call(db, ADMIN, 'PUT', `/interviews/${iv}/segment?project=${P}`, { segment_id: first.body.id })).status, 200);
  // A booked conversation has not happened: it is in the segment, not counted in it.
  interview(db, P, { fit: 'strong', stage: 'booked', segment_id: first.body.id });
  const log = db.prepare("SELECT actor, user_id FROM activity_logs WHERE action = 'interview_segment_set'").all() as any[];
  assert.deepEqual(log.map((l) => [l.actor, l.user_id]), [[`user:${ADMIN}`, ADMIN]], 'a write on the founder\'s behalf names who made it');
  // Another project's interview cannot be moved through this one.
  const theirs = interview(db, P_OTHER);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews/${theirs}/segment?project=${P}`, { segment_id: first.body.id })).status, 404);
  const o = await overview(db);
  assert.deepEqual(card(o.body, 'ideal-customer-profile').series.segments, [{ id: first.body.id, name: 'Ops leads', strong: 1, partial: 0, weak: 0, not_recorded: 0 }]);
});

test('D659: a confirmed ICP definition seeds the first segment once; a draft seeds nothing', async () => {
  const db = fixture();
  const def = (status: string) => JSON.stringify({ status, step: 5, version: 1, fields: { persona: 'Ops lead', industry: 'Logistics', pain1: 'Dispatch by phone' } });
  db.prepare('UPDATE projects SET icp_definition_meta = ? WHERE id = ?').run(def('draft'), P);
  await overview(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM customer_segments').get() as any).n, 0);
  db.prepare('UPDATE projects SET icp_definition_meta = ? WHERE id = ?').run(def('confirmed'), P);
  await overview(db);
  await overview(db);
  const segs = db.prepare('SELECT name, source, description FROM customer_segments').all() as any[];
  assert.deepEqual(segs.map((s) => ({ ...s })), [{ name: 'Ops lead · Logistics', source: 'icp_definition', description: 'Dispatch by phone' }]);
});

test('D659: a demand signal — an amount of 0 is refused, a typed signal is confirmed, a proposed one waits', async () => {
  const db = fixture();
  assert.equal((await call(db, FOUNDER, 'POST', `/demand-signals?project=${P}`, { kind: 'loi', amount_cents: 0 })).status, 400);
  assert.equal((await call(db, FOUNDER, 'POST', `/demand-signals?project=${P}`, { kind: 'bogus' })).status, 400);
  const ok = await call(db, FOUNDER, 'POST', `/demand-signals?project=${P}`, { kind: 'loi', who: 'Fleetco', amount_cents: 1800000, currency: 'usd', period: 'year', signal_date: ago(2) });
  assert.equal(ok.status, 201);
  const forged = await call(db, FOUNDER, 'POST', `/demand-signals?project=${P}`, { kind: 'pre_sale', source_kind: 'interview', status: 'to_confirm' });
  assert.equal(forged.status, 201);
  const rows = db.prepare('SELECT kind, status, source_kind, amount_cents FROM demand_signals ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { kind: 'loi', status: 'confirmed', source_kind: 'manual', amount_cents: 1800000 },
    { kind: 'pre_sale', status: 'to_confirm', source_kind: 'manual', amount_cents: null },
  ]);
  db.prepare("INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on) VALUES ('r1', ?, 'Haulr', 240000, 'deposit', ?)").run(P, ago(5));
  const o = await overview(db);
  const d = card(o.body, 'demand-signals');
  assert.equal(d.series.signals.loi, 1);
  assert.equal(d.series.signals.pre_sale, 1, 'the paid deposit counts; the unconfirmed one does not yet');
  assert.deepEqual(d.next, { text: 'Set the bar for waitlist sign-ups', href: `/validate/demand-signals?project=${P}` });
  assert.equal((await call(db, FOUNDER, 'PUT', `/waitlist-target?project=${P}`, { value: 40 })).status, 200);
  const o2 = await overview(db);
  assert.equal(card(o2.body, 'demand-signals').series.bar, 40);
  assert.deepEqual(card(o2.body, 'demand-signals').next.text, 'Confirm the 1 signal waiting');
  assert.equal((await call(db, FOUNDER, 'PUT', `/waitlist-target?project=${P}`, { value: 0 })).status, 400);
});

test('D659: a competitor mention needs the project\'s list, and lands on it with its source', async () => {
  const db = fixture();
  const none = await call(db, FOUNDER, 'POST', `/competitor-mentions?project=${P}`, { name: 'Haulr' });
  assert.equal(none.status, 409);
  db.prepare("INSERT INTO competitor_analyses (id, user_id, project_id) VALUES ('an1', ?, ?)").run(OTHER, P);
  const bad = await call(db, FOUNDER, 'POST', `/competitor-mentions?project=${P}`, { name: 'Haulr', source_url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const r = await call(db, FOUNDER, 'POST', `/competitor-mentions?project=${P}`, {
    name: 'Haulr', category: 'adjacent', signal_type: 'funding', label: 'raised $12M', source_url: 'https://news.example/haulr', observed_on: ago(3),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.added, true);
  const again = await call(db, FOUNDER, 'POST', `/competitor-mentions?project=${P}`, { name: 'haulr', label: 'mentioned', observed_on: ago(1) });
  assert.equal(again.body.added, false, 'the same company gains a signal, not a second row');
  const sig = db.prepare('SELECT project_id, source_url, source_kind FROM competitor_signals ORDER BY observed_on').all() as any[];
  assert.deepEqual(sig.map((s) => ({ ...s })), [
    { project_id: P, source_url: 'https://news.example/haulr', source_kind: 'manual' },
    { project_id: P, source_url: null, source_kind: 'manual' },
  ]);
  const m = await call(db, FOUNDER, 'GET', `/modules/market-intelligence?project=${P}`);
  assert.equal(m.body.records.total, 1);
  assert.deepEqual(m.body.records.rows[0], { id: r.body.candidate_id, company: 'Haulr', kind: 'adjacent', latest_signal: 'mentioned', date: ago(1), source: 'manual' });
});

test('D659: Inconclusive is the founder\'s mark under a computed verdict; strength is per link', async () => {
  const db = fixture();
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Dispatch')`);
  db.exec(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${P}, 1, 'slow dispatch', 'Slow dispatch')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (1, ${P}, 'H1', 'Fleets pay'), (2, ${P}, 'H2', 'Drivers text'), (3, ${P}, 'H3', 'Owners decide')`);
  db.exec("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction) VALUES (1, 1, 1, 'supports')");
  for (let i = 0; i < 5; i += 1) interview(db, P, { pains: ['Slow dispatch'], fit: 'strong' });
  assert.equal((await call(db, FOUNDER, 'PUT', `/hypotheses/2/plan?project=${P}`, { inconclusive: true, sprint: 'Sprint 3', owner_user_id: FOUNDER })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', `/hypotheses/1/plan?project=${P}`, { inconclusive: true })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', `/evidence-links/1/strength?project=${P}`, { strength: 'pattern' })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', `/evidence-links/1/strength?project=${P}`, { strength: 'proof' })).status, 400);
  const m = await call(db, FOUNDER, 'GET', `/modules/experiments?project=${P}&sort=code`);
  const by = Object.fromEntries(m.body.records.rows.map((x: any) => [x.hypothesis.slice(0, 2), x]));
  assert.equal(by.H1.status, 'supported', 'five ICP supporters outrank the mark');
  assert.equal(by.H1.strength, 'pattern');
  assert.equal(by.H2.status, 'inconclusive');
  assert.equal(by.H2.sprint, 'Sprint 3');
  assert.equal(by.H2.owner, 'Fay Founder');
  assert.equal(by.H3.status, 'untested');
  const o = await overview(db);
  assert.equal(fig(o.body, 'hypotheses_supported').value, 1);
  assert.equal(fig(o.body, 'hypotheses_supported').unit, 'of 3');
  assert.equal(fig(o.body, 'hypotheses_supported').delta_30d, null, 'no verdict history → the change is not recorded');
  assert.equal(fig(o.body, 'hypotheses_supported').reason, 'The change over 30 days is not recorded: verdict history starts later');
  assert.deepEqual(card(o.body, 'experiments').series.statuses, { untested: 1, testing: 0, supported: 1, refuted: 0, inconclusive: 1, not_recorded: 0 });
});

test('D659: the market page\'s three checks are stored and read back', async () => {
  const db = fixture();
  assert.equal((await call(db, LAB, 'PUT', `/market-marks/positioning_map?project=${P_LAB}`, { done: true })).status, 200);
  assert.equal((await call(db, LAB, 'PUT', `/market-marks/anything?project=${P_LAB}`, { done: true })).status, 400);
  const s = await call(db, LAB, 'POST', `/market-sources?project=${P_LAB}`, { title: 'Gartner 2026', kind: 'Report' });
  assert.equal(s.status, 201);
  let r = await call(db, LAB, 'GET', `/market-readiness?project=${P_LAB}`);
  assert.ok(r.body.positioning_map);
  assert.equal(r.body.assumptions_reviewed, null);
  assert.deepEqual(r.body.sources.map((x: any) => x.title), ['Gartner 2026']);
  assert.equal((await call(db, LAB, 'DELETE', `/market-sources/${s.body.id}?project=${P_LAB}`)).status, 200);
  r = await call(db, LAB, 'GET', `/market-readiness?project=${P_LAB}`);
  assert.deepEqual(r.body.sources, []);
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

test('D659: customer research records search, filter, sort and page in SQL', async () => {
  const db = withSessionStore(fixture());
  for (let i = 0; i < 30; i += 1) interview(db, P, { name: `Lead ${String(i).padStart(2, '0')}`, date: ago(i), fit: i % 2 ? 'strong' : null, consent: i % 3 === 0 ? 1 : null });
  interview(db, P, { name: 'Zed % Quote', company: 'Acme_Co', date: ago(40) });
  let m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}`);
  assert.equal(m.status, 200);
  assert.equal(m.body.records.total, 31);
  assert.equal(m.body.records.rows.length, 25);
  assert.equal(m.body.records.rows[0].interviewee, 'Lead 00', 'newest first');
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&page=2`);
  assert.equal(m.body.records.rows.length, 6);
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=icp:not_recorded`);
  assert.equal(m.body.records.total, 16, 'fifteen unrecorded leads and the one with no fit');
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=consent:agreed`);
  assert.equal(m.body.records.total, 10);
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&q=${encodeURIComponent('%')}`);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.interviewee), ['Zed % Quote'], 'a % is a character, not a wildcard');
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&q=acme_co&sort=oldest`);
  assert.equal(m.body.records.total, 1);
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&sort=oldest`);
  assert.equal(m.body.records.rows[0].interviewee, 'Zed % Quote');
  assert.equal(m.body.records.rows[0].company, 'Acme_Co');
  assert.equal(m.body.records.rows[0].consent, null, 'never asked is not "declined"');
  assert.equal((await call(db, FOUNDER, 'GET', `/modules/nope?project=${P}`)).status, 404);
});

test('D659: problem discovery records filter by severity and say what links to a claim', async () => {
  const db = fixture();
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Dispatch')`);
  db.exec(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${P}, 1, 'slow dispatch', 'Slow dispatch')`);
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (1, ${P}, 'H1', 'Fleets pay')`);
  db.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 1, 'supports')");
  const a = interview(db, P, { pains: ['Slow dispatch', 'Paper forms'], date: ago(2) });
  interview(db, P, { pains: ['Slow dispatch'], date: ago(40) });
  db.prepare("INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, 'slow dispatch', 'need')").run(a);
  let m = await call(db, FOUNDER, 'GET', `/modules/problem-discovery?project=${P}`);
  assert.deepEqual(m.body.records.rows, [
    // One mention in the last 30 days, one in the 30 before: no change.
    { id: 1, theme: 'Dispatch', mentions: 2, severity: 'severe', trend: 0, supports: ['H1'],
      icp_count: 0, need_count: 1, fit_unrecorded_count: 2, last_mention_at: ago(2), wordings: ['Slow dispatch'] },
    { id: null, theme: 'Paper forms', mentions: 1, severity: null, trend: 1, supports: null,
      icp_count: 0, need_count: 0, fit_unrecorded_count: 1, last_mention_at: ago(2), wordings: ['Paper forms'] },
  ]);
  m = await call(db, FOUNDER, 'GET', `/modules/problem-discovery?project=${P}&filter=severity:not_recorded`);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.theme), ['Paper forms']);
  assert.equal(card(m.body.card ? { cards: [m.body.card] } : { cards: [] }, 'problem-discovery').next.text, 'Group the 1 pain that sits in no theme');
});

test('D659: the module read keeps its card when its records cannot be read', async () => {
  const db = fixture();
  interview(db, P);
  db.exec('DROP TABLE demand_signals');
  const m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}`);
  assert.equal(m.status, 200);
  assert.notEqual(m.body.card.state, 'unreadable');
  const d = await call(db, FOUNDER, 'GET', `/modules/demand-signals?project=${P}`);
  assert.equal(d.body.card.state, 'unreadable');
  assert.equal(d.body.records.state, 'unreadable');
  assert.equal(d.body.records.total, null, 'an unreadable table has no total, not 0');
});

test('D659: the waitlist bar shares metric_targets but never reaches the snapshot targets list', async () => {
  const { default: progress } = await import('../src/routes/progress.ts');
  const db = fixture();
  db.exec(`INSERT INTO metric_targets (project_id, metric_key, target_value, direction) VALUES (${P}, 'mrr', 10000, 'up')`);
  assert.equal((await call(db, FOUNDER, 'PUT', `/waitlist-target?project=${P}`, { value: 40 })).status, 200);
  assert.deepEqual(db.prepare('SELECT metric_key FROM metric_targets ORDER BY metric_key').all().map((r: any) => r.metric_key), ['mrr', 'waitlist_target']);
  const p = new Hono<any>();
  p.route('/api/progress', progress);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await p.request(`/api/progress/metrics/${P}/targets`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const body = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.items.map((t: any) => t.metric_key), ['mrr'], 'the Grow targets view lists snapshot metrics only');
  } finally { [console.warn, console.error] = saved; }
});

test('D659: a pain-group store that cannot be read makes the pain card unreadable, not an empty map', async () => {
  const db = fixture();
  interview(db, P, { pains: ['Slow dispatch'] });
  db.exec('DROP TABLE pain_groups');
  db.exec('CREATE TABLE pain_groups (id INTEGER PRIMARY KEY, project_id INTEGER)'); // no title: the read throws
  const r = await overview(db);
  assert.equal(card(r.body, 'problem-discovery').state, 'unreadable');
  assert.equal(card(r.body, 'problem-discovery').reason, 'Interviews and pain groups could not be read');
  assert.equal(fig(r.body, 'pain_themes').state, 'unreadable');
  assert.equal(card(r.body, 'customer-research').state, 'unreadable', 'the Lab funnel reads the pain-group view');
  assert.equal(card(r.body, 'demand-signals').state, 'empty', 'the waitlist card reads no pain group');
});

// ---------------------------------------------------------------------------
// D685 S03-A (#1583)
// ---------------------------------------------------------------------------

test('D685: the recruiting picker\'s pipeline filter and booked-first order; the Channel filter; the list says Interviews', async () => {
  const db = withSessionStore(fixture());
  interview(db, P, { name: 'Held', stage: 'done', channel: 'video', date: ago(1) });
  interview(db, P, { name: 'Old held', stage: null, channel: 'phone', date: ago(2) });
  // Inserted out of stage order, so neither id nor date gives the booked-first order.
  interview(db, P, { name: 'A booking', stage: 'booked', date: ago(5) });
  interview(db, P, { name: 'A lead', stage: 'lead', date: ago(3) });
  interview(db, P, { name: 'An invite', stage: 'invited', date: ago(4) });
  let m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=stage:pipeline&sort=booked`);
  assert.equal(m.status, 200);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.interviewee), ['A booking', 'An invite', 'A lead']);
  assert.equal(m.body.module.records_title, 'Interviews');
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=stage:pipeline`);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.interviewee), ['A lead', 'An invite', 'A booking'], 'newest first by default');
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=channel:video`);
  assert.deepEqual(m.body.records.rows.map((x: any) => x.interviewee), ['Held']);
  m = await call(db, FOUNDER, 'GET', `/modules/customer-research?project=${P}&filter=channel:fax`);
  assert.equal(m.body.records.total, 5, 'an unknown channel is no filter, not an empty list');
});

test('D685: "Record your first session" opens the setup route', async () => {
  const db = fixture();
  const r = await overview(db);
  for (const slug of ['problem-discovery', 'customer-research']) {
    assert.equal(card(r.body, slug).next.href, `/validate/record?project=${P}`, slug);
  }
});

// ---------------------------------------------------------------------------
// D685 §5.12 (#1584): the phone's focus, the interviews meter, the index counts
// ---------------------------------------------------------------------------

/** The two session stores the focus reads, only the columns it reads. */
function withSessions(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS interview_sessions (id INTEGER PRIMARY KEY, project_id INTEGER, interview_id INTEGER, status TEXT,
             stopped_at TEXT, updated_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS validate_proposals (id INTEGER PRIMARY KEY, project_id INTEGER, session_id INTEGER, kind TEXT,
             payload_json TEXT, edited_payload_json TEXT, status TEXT, run_id TEXT)`);
  return db;
}
const proposal = (db: any, sid: number, kind: string, payload: unknown, o: { status?: string; run?: string | null } = {}) =>
  db.prepare('INSERT INTO validate_proposals (project_id, session_id, kind, payload_json, status, run_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(P, sid, kind, JSON.stringify(payload), o.status ?? 'pending', o.run === undefined ? 'run-1' : o.run);

test('D685 §5.12: no interview → "Record your first conversation." word for word', async () => {
  const r = await overview(withSessions(fixture()));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.focus, {
    rule: 'first_interview', eyebrow: 'Validate · Next', headline: 'Record your first conversation.',
    why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
    cta: { label: 'Record a session', href: `/validate/record?project=${P}` },
    then: 'Write the claim you most need to be true.',
  });
});

test('D685 §5.12: the newest session needing review leads, counting themes and hypotheses, never placements', async () => {
  const db = withSessions(fixture());
  const iv = interview(db, P, { name: 'Robin Reyes', stage: 'done' });
  db.prepare("INSERT INTO pain_groups (id, project_id, title) VALUES (7, ?, 'Slow dispatch'), (9, ?, 'Churn')").run(P, P);
  db.prepare("INSERT INTO interview_sessions (id, project_id, interview_id, status, stopped_at) VALUES (1, ?, ?, 'structured', '2026-10-14 10:00:00')").run(P, iv);
  // Two wordings of one theme count once, and so does that theme named again through evidence.
  proposal(db, 1, 'pain_severity', { phrase: 'Slow dispatch', severity: 'severe' });
  proposal(db, 1, 'pain_severity', { phrase: 'slow   dispatch', severity: 'real' });
  proposal(db, 1, 'pain_severity', { phrase: 'Billing errors', severity: 'mild' });
  proposal(db, 1, 'evidence', { hypothesis_id: 3, pain_group_id: 7, direction: 'supports' });
  proposal(db, 1, 'evidence', { hypothesis_id: 4, pain_group_id: 7, direction: 'supports' });
  // Evidence alone names a third theme; a hypothesis named twice counts once.
  proposal(db, 1, 'evidence', { hypothesis_id: 3, pain_group_id: 9, direction: 'refutes' });
  proposal(db, 1, 'pain_severity', { phrase: 'Ignored' }, { status: 'accepted' });
  proposal(db, 1, 'pain_severity', { phrase: 'Assistant' }, { run: null });
  const f = (await overview(db)).body.focus;
  assert.deepEqual([f.rule, f.headline, f.why, f.cta, f.then], ['review', 'Review the interview with Robin Reyes from 14 Oct.',
    'Its findings would move 3 pain themes and 2 hypotheses.', { label: 'Review the interview', href: `/validate/customer-research/${iv}?session=1` }, null]);
  // A transcribed session that is not placed says so.
  db.prepare("INSERT INTO interview_sessions (id, project_id, interview_id, status, stopped_at) VALUES (2, ?, ?, 'transcribed', '2026-10-15 10:00:00')").run(P, iv);
  assert.equal((await overview(db)).body.focus.why, 'It is transcribed but not yet placed.');
  // A partner reads the board but cannot write: the rule falls through to the first card.
  const partner = (await overview(db, PARTNER)).body.focus;
  assert.equal(partner.rule, 'card');
  // A structured session with nothing pending falls through too.
  db.prepare('DELETE FROM interview_sessions WHERE id = 2').run();
  db.prepare("UPDATE validate_proposals SET status = 'accepted'").run();
  const done = (await overview(db)).body.focus;
  assert.equal(done.rule, 'card');
  const first = (await overview(db)).body.cards.find((c: any) => c.next?.text);
  assert.deepEqual(done.cta, { label: first.next.text, href: first.next.href });
});

test('D685 §5.12: the meter reads the stored target; none reads "No target set"; the writer refuses 0 and clears with null', async () => {
  const db = withSessions(fixture());
  interview(db, P, { stage: 'done', date: TODAY });
  interview(db, P, { stage: 'done', date: TODAY });
  interview(db, P, { stage: 'booked' });
  let m = (await overview(db)).body.meter;
  assert.deepEqual([m.count, m.target, m.target_reason], [2, null, 'No target set']);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews-target?project=${P}`, { value: 0 })).status, 400);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews-target?project=${P}`, { value: 2.5 })).status, 400);
  assert.equal((await call(db, PARTNER, 'PUT', `/interviews-target?project=${P}`, { value: 8 })).status, 403);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews-target?project=${P}`, { value: 8 })).status, 200);
  m = (await overview(db)).body.meter;
  assert.deepEqual([m.count, m.target, m.target_reason], [2, 8, null]);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews-target?project=${P}`, { value: null })).status, 200);
  assert.equal((await overview(db)).body.meter.target, null);
  // The index: every interview, and booked now (not the cumulative funnel).
  assert.deepEqual((await overview(db)).body.index, { interviews_total: 3, booked: 1 });
});

test('D685 §5.12: the interviews target shares metric_targets but never reaches the snapshot targets list', async () => {
  const { default: progress } = await import('../src/routes/progress.ts');
  const db = fixture();
  db.exec(`INSERT INTO metric_targets (project_id, metric_key, target_value, direction) VALUES (${P}, 'mrr', 10000, 'up')`);
  assert.equal((await call(db, FOUNDER, 'PUT', `/interviews-target?project=${P}`, { value: 8 })).status, 200);
  assert.equal((await call(db, FOUNDER, 'PUT', `/waitlist-target?project=${P}`, { value: 40 })).status, 200);
  const p = new Hono<any>();
  p.route('/api/progress', progress);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await p.request(`/api/progress/metrics/${P}/targets`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const body = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.items.map((t: any) => t.metric_key), ['mrr']);
  } finally { [console.warn, console.error] = saved; }
});
