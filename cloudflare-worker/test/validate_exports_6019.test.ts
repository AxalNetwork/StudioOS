/**
 * D6019 (#6019) — Validate's competitor, demand-signal and hypothesis-evidence
 * CSV exports.
 *
 * The serializers against fixtures, then the real routes over real SQLite
 * (`_posthog_cycle_fixture.ts`, every migration). What is pinned is what would
 * make a file lie or leak: a failed source read exported as an empty file, an
 * unread amount written as 0, a waitlist sign-up's address in the file, and the
 * evidence file (which names Verdict decisions) reaching a partner.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_exports_6019.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import founderValidate from '../src/routes/founder_validate.ts';
import {
  serializeCompetitorsCsv, serializeSignalsCsv, serializeEvidenceCsv,
  COMPETITORS_CSV_HEADER, SIGNALS_CSV_HEADER, EVIDENCE_CSV_HEADER, EXPERIMENTS_CSV_HEADER,
} from '../src/routes/_founder_validate_exports.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { ADMIN, FOUNDER, JWT_SECRET, OTHER, P, fixture } from './_posthog_cycle_fixture.ts';

const PARTNER = 40;
const H = 5;

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/** Enough CSV parsing to read a row back: quoted fields, doubled quotes. */
const cells = (line: string) => {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
};
const table = (csv: string) => {
  const [head, ...body] = csv.split('\r\n');
  const h = cells(head);
  return body.filter((l) => l !== '').map((l) => Object.fromEntries(cells(l).map((v, i) => [h[i], v])));
};
/** The two blocks of the evidence file: claims' evidence, then experiments. */
const blocks = (csv: string) => csv.split('\r\n\r\n');

const signal = (over: Record<string, unknown> = {}) => ({
  key: 'signal-1', signal: 'loi', who: 'Meridian Freight', amount: '1200.00', currency: 'USD', period: 'once',
  date: '2026-10-01', counts: 'confirmed', ...over,
});

test('signals: a waitlist row never carries an address, even one typed into the name', () => {
  const csv = serializeSignalsCsv([
    signal({ key: 'waitlist-1', signal: 'waitlist', who: 'sam@example.test', amount: null, currency: null, counts: 'counted' }),
    signal({ key: 'waitlist-2', signal: 'waitlist', who: 'Sam Example', amount: null, currency: null, counts: 'counted' }),
  ]);
  assert.ok(!csv.includes('@'), csv);
  assert.deepEqual(table(csv).map((r) => r.who), ['', 'Sam Example']);
});

test('signals: an absent amount is empty, never 0, and carries no currency', () => {
  const rows = table(serializeSignalsCsv([
    signal(),
    signal({ key: 'signal-2', signal: 'need_to_have', amount: null, currency: 'USD' }),
  ]));
  assert.deepEqual(Object.keys(rows[0]), [...SIGNALS_CSV_HEADER]);
  assert.deepEqual([rows[0].amount, rows[0].currency], ['1200.00', 'USD']);
  assert.deepEqual([rows[1].amount, rows[1].currency], ['', '']);
});

test('competitors: one row per tracked competitor; no signal is empty cells, the source falls back to its kind', () => {
  const rows = table(serializeCompetitorsCsv([
    { name: 'Routewise', kind: 'direct', latest_signal: 'Raised a Series A', latest_on: '2026-09-30', source_url: 'https://example.test/a', source_kind: 'news' },
    { name: 'Haulbase', kind: 'adjacent', latest_signal: null, latest_on: null, source_url: null, source_kind: null },
    { name: 'Loadly', kind: 'direct', latest_signal: 'Launch', latest_on: '2026-08-01', source_url: null, source_kind: 'manual' },
  ]));
  assert.deepEqual(Object.keys(rows[0]), [...COMPETITORS_CSV_HEADER]);
  assert.deepEqual(rows.map((r) => [r.company, r.kind, r.latest_signal, r.latest_signal_date, r.source]), [
    ['Routewise', 'direct', 'Raised a Series A', '2026-09-30', 'https://example.test/a'],
    ['Haulbase', 'adjacent', '', '', ''],
    ['Loadly', 'direct', 'Launch', '2026-08-01', 'manual'],
  ]);
});

test('evidence: each item under its claim with the decisions that cited it; a bare claim still has a row; experiments follow', () => {
  const csv = serializeEvidenceCsv(
    [{ id: 1, code: 'H1', claim: 'Fleets pay', retired_at: null }, { id: 2, code: 'H2', claim: 'Owners decide', retired_at: null }],
    [{ id: 'pain-3-101', hypothesis_id: 1, kind: 'interview', label: 'Interview naming Manual reconciliation', direction: 'supports', strength: 'pattern', date: '2026-10-02' }],
    [
      { ref_id: 'pain-3-101', decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', superseded_at: null },
      { ref_id: 'pain-3-101', decision: 'pivot', state: 'withheld', decided_at: '2026-10-01 09:00:00', superseded_at: '2026-10-12 09:00:00' },
    ],
    [
      { hypothesis_id: 1, title: 'Smoke test', method: 'Landing page', target: '40 sign-ups', status: 'done', result: '52 sign-ups' },
      { hypothesis_id: 2, title: 'Pricing call', method: null, target: null, status: 'done', result: '  ' },
    ],
  );
  const [ev, ex] = blocks(csv);
  const rows = table(ev);
  assert.deepEqual(Object.keys(rows[0]), [...EVIDENCE_CSV_HEADER]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'H1');
  assert.equal(rows[0].decisions, 'proceed 2026-10-12; pivot 2026-10-01 (withheld) (superseded)');
  assert.deepEqual([rows[1].code, rows[1].evidence, rows[1].evidence_id, rows[1].decisions], ['H2', 'No evidence linked', '', '']);
  const exps = table(ex);
  assert.deepEqual(Object.keys(exps[0]), [...EXPERIMENTS_CSV_HEADER]);
  assert.deepEqual(exps.map((r) => [r.code, r.experiment, r.result, r.observed]), [
    ['H1', 'Smoke test', '52 sign-ups', 'yes'],
    // Done with no result is context, not a finding.
    ['H2', 'Pricing call', '', 'no'],
  ]);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function app() {
  const a = new Hono<any>();
  a.route('/api/founder/validate', founderValidate);
  a.onError((e: any, c) => c.json({ detail: String(e?.message || '') }, 500));
  return a;
}

async function get(env: any, path: string, who = FOUNDER) {
  const role = who === ADMIN ? 'admin' : who === PARTNER ? 'partner' : 'founder';
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app().request(path, { headers: { Authorization: `Bearer ${token}` } }, env));
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a CSV */ }
    return { status: res.status, body, text, rows: res.headers.get('X-Export-Rows') };
  } finally { [console.warn, console.error] = saved; }
}

/** `env` whose D1 fails every statement matching `re`; every other statement is the real one. */
function failing(env: any, re: RegExp) {
  const real = env.DB;
  const boom = () => Promise.reject(new Error('D1_ERROR: injected'));
  const DB = {
    ...real,
    prepare(sql: string) {
      if (!re.test(sql)) return real.prepare(sql);
      const st: any = { bind: () => st, all: boom, first: boom, run: boom, raw: boom };
      return st;
    },
    batch: real.batch?.bind(real), exec: real.exec?.bind(real),
  };
  return { ...env, DB };
}

const PATHS = {
  competitors: `/api/founder/validate/competitors/${P}/export.csv`,
  signals: `/api/founder/validate/signals/${P}/export.csv`,
  evidence: `/api/founder/validate/evidence/${P}/export.csv`,
};

async function seeded() {
  const f = await fixture();
  const { db } = f;
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'partner', 'Pat Partner', 'pat@example.test', 1)").run(PARTNER);
  // Competitors: two analysed, one stopped.
  db.prepare("INSERT INTO competitor_analyses (id, user_id, project_id, status) VALUES ('an1', ?, ?, 'complete')").run(FOUNDER, P);
  const cand = db.prepare("INSERT INTO competitor_candidates (id, analysis_id, name, category, created_at) VALUES (?, 'an1', ?, ?, '2026-09-01')");
  cand.run('c1', 'Routewise', 'direct');
  cand.run('c2', 'Haulbase', 'adjacent');
  cand.run('c3', 'Gone Co', 'direct');
  db.prepare("INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, observed_on, source_url, project_id) VALUES ('s1', 'an1', 'c1', 'funding', 'Raised a Series A', '2026-09-30', 'https://example.test/a', ?)").run(P);
  db.prepare("INSERT INTO competitor_tracking (uid, project_id, name_norm, stopped_at) VALUES ('t1', ?, 'gone co', '2026-10-01')").run(P);
  // Demand: a letter of intent, a need-to-have mention with no amount, a paid pilot, two sign-ups.
  db.prepare("INSERT INTO demand_signals (id, project_id, kind, who, amount_cents, currency, period, signal_date, status, note) VALUES (71, ?, 'loi', 'Meridian Freight', 120000, 'usd', 'once', '2026-10-01', 'confirmed', 'She said \"we would sign today\"')").run(P);
  db.prepare("INSERT INTO demand_signals (id, project_id, kind, who, signal_date, status) VALUES (72, ?, 'need_to_have', 'Dana Example', '2026-10-03', 'counted')").run(P);
  db.prepare("INSERT INTO revenue_entries (id, uid, project_id, customer, amount_cents, currency, revenue_type, received_on) VALUES (9, 'r9', ?, 'Northline', 50000, 'eur', 'pilot', '2026-10-05')").run(P);
  const w = db.prepare("INSERT INTO waitlist_signups (id, project_id, email, name, created_at, audience) VALUES (?, ?, ?, ?, '2026-10-06 10:00:00', ?)");
  w.run(1, P, 'sam@example.test', 'Sam Example', 'customer');
  w.run(2, P, 'kim@example.test', 'kim@example.test', null);
  w.run(3, P, 'inv@example.test', 'An Investor', 'investor');
  // Evidence: H2 linked to a theme two interviews name, an experiment linked directly, and a decision that cited one item.
  db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (?, ?, 'H2', 'Finance teams reconcile by hand')").run(H, P);
  db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (6, ?, 'H3', 'Owners sign off')").run(P);
  db.prepare("INSERT INTO pain_groups (id, project_id, title) VALUES (70, ?, 'Manual reconciliation')").run(P);
  db.prepare("INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, 70, 'manual reconciliation', 'manual reconciliation')").run(P);
  db.prepare("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, strength) VALUES (3, ?, 70, 'supports', 'pattern')").run(H);
  const iv = db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, icp_fit, quote_consent, notes, pains_json)
    VALUES (?, ?, ?, '2026-10-02', 'strong', ?, 'Reconciles by hand every Friday, "it is miserable"', '["manual reconciliation"]')`);
  iv.run(101, P, 'Dana Example', 0);
  iv.run(102, P, 'Lee Example', null);
  db.prepare("INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title, method, target, result, status) VALUES (8, 'x8', ?, ?, 'Smoke test', 'Landing page', '40 sign-ups', '52 sign-ups', 'done')").run(P, H);
  db.prepare("INSERT INTO hypothesis_evidence_links (id, uid, project_id, hypothesis_id, kind, ref_id, direction, strength, created_at) VALUES (4, 'e4', ?, ?, 'experiment', '8', 'supports', 'measured', '2026-10-07 09:00:00')").run(P, H);
  db.prepare("INSERT INTO validation_decisions (id, project_id, decision, decided_at, decided_by, hypothesis_id, state) VALUES (41, ?, 'proceed', '2026-10-12 09:00:00', ?, ?, 'given')").run(P, FOUNDER, H);
  db.prepare("INSERT INTO validation_decision_evidence (uid, decision_id, kind, ref_id, label, direction) VALUES ('de1', 41, 'interview', 'pain-3-101', 'Interview naming Manual reconciliation', 'supports')").run();
  return f;
}

test('competitors route: the tracked list, a stopped name left out', async () => {
  const { env } = await seeded();
  const r = await get(env, PATHS.competitors);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  const rows = table(r.text);
  assert.deepEqual(rows.map((x) => [x.company, x.kind, x.latest_signal, x.latest_signal_date]).sort(), [
    ['Haulbase', 'adjacent', '', ''],
    ['Routewise', 'direct', 'Raised a Series A', '2026-09-30'],
  ]);
  assert.equal(r.rows, '2');
});

test('signals route: the list\'s population, amounts in major units, no address and no note anywhere', async () => {
  const { env } = await seeded();
  const r = await get(env, PATHS.signals);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.ok(!r.text.includes('@'), 'a waitlist address reached the file');
  assert.ok(!r.text.includes('sign today'), 'a signal\'s note (which can quote an interview) reached the file');
  const byId = new Map(table(r.text).map((x) => [x.id, x]));
  assert.deepEqual([...byId.keys()].sort(), ['revenue-9', 'signal-71', 'signal-72', 'waitlist-1', 'waitlist-2']);
  assert.deepEqual([byId.get('signal-71')!.amount, byId.get('signal-71')!.currency], ['1200.00', 'USD']);
  assert.deepEqual([byId.get('revenue-9')!.amount, byId.get('revenue-9')!.currency, byId.get('revenue-9')!.signal], ['500.00', 'EUR', 'pre_sale']);
  assert.deepEqual([byId.get('signal-72')!.amount, byId.get('signal-72')!.currency], ['', '']);
  assert.equal(byId.get('waitlist-1')!.who, 'Sam Example');
  assert.equal(byId.get('waitlist-2')!.who, '');
});

test('evidence route: every item under its claim, the citing decision named, experiments after, no interviewee words', async () => {
  const { env } = await seeded();
  const r = await get(env, PATHS.evidence);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.ok(!r.text.includes('miserable') && !r.text.includes('Dana Example'), 'an interviewee\'s words or name reached the file');
  const [ev, ex] = blocks(r.text);
  const rows = table(ev);
  const h2 = rows.filter((x) => x.code === 'H2');
  assert.deepEqual(h2.map((x) => x.evidence_id).sort(), ['evidence-4', 'pain-3-101', 'pain-3-102']);
  assert.equal(h2.find((x) => x.evidence_id === 'pain-3-101')!.decisions, 'proceed 2026-10-12');
  assert.equal(h2.find((x) => x.evidence_id === 'pain-3-102')!.decisions, '');
  assert.equal(h2.find((x) => x.evidence_id === 'evidence-4')!.kind, 'experiment');
  assert.deepEqual(rows.filter((x) => x.code === 'H3').map((x) => x.evidence), ['No evidence linked']);
  assert.deepEqual(table(ex).map((x) => [x.code, x.experiment, x.result, x.observed]), [['H2', 'Smoke test', '52 sign-ups', 'yes']]);
});

test('an empty venture exports all three with status 200: headers and no rows', async () => {
  const { env } = await fixture();
  for (const path of Object.values(PATHS)) {
    const r = await get(env, path);
    assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 200)}`);
    for (const block of blocks(r.text)) assert.equal(table(block).length, 0, path);
  }
});

const REQUIRED: Array<[keyof typeof PATHS, string, RegExp]> = [
  ['competitors', 'competitors', /FROM competitor_candidates c JOIN competitor_analyses/],
  ['competitors', 'competitors', /FROM competitor_signals s JOIN competitor_analyses/],
  ['signals', 'demand signals', /FROM demand_signals WHERE project_id = \? ORDER BY/],
  ['signals', 'demand signals', /FROM revenue_entries WHERE project_id = \?/],
  ['signals', 'waitlist', /FROM waitlist_signups/],
  ['evidence', 'claims', /SELECT id, code, claim, retired_at FROM hypotheses/],
  ['evidence', 'evidence', /FROM hypothesis_pain_links l/],
  ['evidence', 'evidence', /FROM hypothesis_evidence_links e/],
  ['evidence', 'evidence', /FROM hypothesis_experiments WHERE id = \?/],
  ['evidence', 'decisions', /FROM validation_decision_evidence e JOIN validation_decisions/],
  ['evidence', 'experiments', /FROM hypothesis_experiments\s+WHERE project_id = \?/],
];

test('each required source, failed on its own, refuses its export with the source named and a sentence', async () => {
  const { env } = await seeded();
  for (const [which, source, re] of REQUIRED) {
    const r = await get(failing(env, re), PATHS[which]);
    assert.equal(r.status, 503, `${which} / ${re}: ${r.text.slice(0, 200)}`);
    assert.equal(r.body.error, 'evidence_unreadable');
    assert.equal(r.body.source, source, `${re}`);
    assert.equal(r.body.detail, `The ${source} could not be read, so nothing was exported. Nothing was changed. Try again.`);
  }
});

test('gates: competitors and signals as the board (partners read them), evidence as the summary (partners refused)', async () => {
  const { env } = await seeded();
  for (const who of [FOUNDER, ADMIN]) {
    for (const path of Object.values(PATHS)) assert.equal((await get(env, path, who)).status, 200, `${who} ${path}`);
  }
  assert.equal((await get(env, PATHS.competitors, PARTNER)).status, 200);
  assert.equal((await get(env, PATHS.signals, PARTNER)).status, 200);
  assert.equal((await get(env, PATHS.evidence, PARTNER)).status, 403, 'the evidence file names decisions, which partners may not read');
  for (const path of Object.values(PATHS)) assert.equal((await get(env, path, OTHER)).status, 403, `another venture's founder on ${path}`);
});
