/**
 * D4585 (#4585) — Validate's evidence contract: one population per figure, said
 * out loud; a PostHog metric that is accepted is also read; and a required read
 * that fails is refused, never turned into an empty board, an empty CSV or a
 * false verdict transition.
 *
 * Real SQLite over every migration (`_posthog_cycle_fixture.ts`), the real
 * routes and the real writers. Fault injection fails one named query at a time.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_evidence_reliability_4585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import founderValidate from '../src/routes/founder_validate.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { RECORD_SPECS } from '../src/services/records/index.ts';
import { linkedCounts } from '../src/services/cycleValidate.ts';
import { evidenceFor } from '../src/services/validateEvidence.ts';
import { addEvidence, unlinkEvidence } from '../src/services/validateWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { ADMIN, FOUNDER, JWT_SECRET, P, PH, fixture } from './_posthog_cycle_fixture.ts';

const H = 5;

function app() {
  const a = new Hono<any>();
  a.route('/api/founder/validate', founderValidate);
  a.route('/api/cycles', createCycleRecords(RECORD_SPECS));
  a.route('/api/cycles/validate', cycleValidate);
  a.onError((e: any, c) => c.json({ detail: String(e?.message || '') }, 500));
  return a;
}

async function get(env: any, path: string, who = FOUNDER) {
  const token = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app().request(path, { headers: { Authorization: `Bearer ${token}` } }, env));
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* a CSV */ }
    return { status: res.status, body, text };
  } finally { [console.warn, console.error] = saved; }
}

/** `env` whose D1 fails every statement matching `re` when it is read; every other statement is the real one. */
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

const REQUIRED: Array<[string, RegExp]> = [
  ['claims', /FROM hypotheses WHERE project_id = \? ORDER BY sort_order, id/],
  ['pain links', /FROM hypothesis_pain_links l\s+JOIN hypotheses h ON h\.id = l\.hypothesis_id\s+WHERE h\.project_id = \?$/],
  ['interviews', /FROM discovery_interviews WHERE project_id = \? ORDER BY id/],
];

/** One claim, one theme, the claim linked to it, and interviews naming that theme: H2 has pain-derived support. */
function seed(db: any) {
  db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (?, ?, 'H2', 'Finance teams reconcile by hand')").run(H, P);
  db.prepare("INSERT INTO pain_groups (id, project_id, title) VALUES (70, ?, 'Manual reconciliation')").run(P);
  db.prepare("INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, 70, 'manual reconciliation', 'manual reconciliation')").run(P);
  db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, 70, 'supports')").run(H);
  const iv = db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, icp_fit, quote_consent, pains_json)
    VALUES (?, ?, ?, '2026-10-02', 'strong', 1, '["manual reconciliation"]')`);
  iv.run(101, P, 'Dana Example');
  iv.run(102, P, 'Lee Example');
}
const history = (db: any) => db.prepare('SELECT hypothesis_id, verdict, lane FROM hypothesis_verdict_history WHERE project_id = ? ORDER BY id').all(P).map((r: any) => ({ ...r }));

test('each required board read, failed on its own, is refused with its source named; nothing is written; a healthy read recovers', async () => {
  for (const [source, re] of REQUIRED) {
    const { db, env } = await fixture();
    seed(db);
    const before = history(db);
    for (const path of [`/api/founder/validate/board/${P}`, `/api/founder/validate/summary/${P}/export.csv`]) {
      const r = await get(failing(env, re), path);
      assert.equal(r.status, 503, `${source} on ${path}: ${r.text.slice(0, 200)}`);
      assert.equal(r.body.error, 'evidence_unreadable');
      assert.equal(r.body.source, source);
      assert.match(r.body.detail, /Nothing was changed/);
      assert.deepEqual(history(db), before, `${source}: a failed read must not append a verdict observation`);
    }
    // A later healthy read records the claim's real state once, with no "recovery" from a transition that never was.
    const ok = await get(env, `/api/founder/validate/board/${P}`);
    assert.equal(ok.status, 200, ok.text.slice(0, 200));
    const h2 = ok.body.hypotheses.find((h: any) => h.id === H);
    assert.equal(h2.evidence.supporting, 2);
    const after = history(db);
    assert.equal(after.length, 1, `${source}: exactly the one real observation`);
    assert.equal(after[0].hypothesis_id, H);
    assert.equal(after[0].verdict, h2.verdict);
    assert.equal((await get(env, `/api/founder/validate/board/${P}`)).status, 200);
    assert.equal(history(db).length, 1, 'an unchanged recompute writes nothing');
  }
});

test('the interview CSV refuses a failed interview read, and exports a genuinely empty venture successfully', async () => {
  const { db, env } = await fixture();
  const path = `/api/founder/validate/interviews/${P}/export.csv`;
  const empty = await get(env, path);
  assert.equal(empty.status, 200);
  assert.equal(empty.text.split('\r\n').filter(Boolean).length, 1, 'an empty venture is a header and no rows');
  const failed = await get(failing(env, /FROM discovery_interviews/), path);
  assert.equal(failed.status, 503);
  assert.deepEqual([failed.body.error, failed.body.source], ['evidence_unreadable', 'interviews']);
  seed(db);
  const full = await get(env, path);
  assert.equal(full.status, 200);
  assert.equal(full.text.split('\r\n').filter(Boolean).length, 3);
});

test('a genuinely empty venture reads an empty board and exports its summary, distinct from a failure', async () => {
  const { db, env } = await fixture();
  db.prepare("INSERT INTO validation_decisions (project_id, decision, decided_by) VALUES (?, 'persevere', ?)").run(P, FOUNDER);
  const board = await get(env, `/api/founder/validate/board/${P}`);
  assert.equal(board.status, 200);
  assert.deepEqual(board.body.hypotheses, []);
  assert.equal(board.body.evidence_base.interviews, 0);
  const csv = await get(env, `/api/founder/validate/summary/${P}/export.csv`);
  assert.equal(csv.status, 200, csv.text.slice(0, 200));
  assert.equal(history(db).length, 0);
});

test('every evidence kind: written by addEvidence, read back by evidenceFor with its source, direction and date, counted apart from interview support', async () => {
  const { db, env } = await fixture();
  seed(db);
  // The other kinds a claim can carry: a direct interview, a pre-sale, a demand signal, a KPI, a PostHog metric, an experiment.
  db.prepare("INSERT INTO demand_signals (id, project_id, kind, who, signal_date) VALUES (31, ?, 'loi', 'Northwind Example', '2026-10-05')").run(P);
  db.prepare("INSERT INTO revenue_entries (id, uid, project_id, revenue_type, customer, amount_cents, currency, received_on) VALUES (41, 'rev-41', ?, 'deposit', 'Acme Example', 50000, 'EUR', '2026-10-06')").run(P);
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (?, '2026-10-07', 1200)").run(P);
  db.prepare("INSERT INTO posthog_tracked_metrics (uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by) VALUES ('phm-1', ?, ?, 'ins-1', 'Activated teams', 'activation', 'experiments', 'pct', ?)").run(PH, P, FOUNDER);
  db.prepare("INSERT INTO posthog_metric_facts (integration_id, project_id, module, kind, fact_key, period, value, as_of) VALUES (?, ?, 'experiments', 'metric', 'metric:phm-1', '2026-10-01', 41.5, '2026-10-08T06:00:00Z')").run(PH, P);
  db.prepare("INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title, result, status) VALUES (51, 'exp-51', ?, ?, 'Landing page', 'Two sign-ups', 'done')").run(P, H);

  const add = (kind: string, ref_id: string, direction = 'supports') =>
    addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: H, kind, ref_id, direction });
  await add('interview', '102');
  await add('signal', 'signal-31');
  await add('signal', 'revenue-41');
  await add('metric', 'mrr');
  await add('metric', 'posthog-phm-1', 'contradicts');
  await add('experiment', '51');

  const items = await evidenceFor({ env, projectId: P }, { hypothesisId: H });
  const pick = (link: RegExp, kind: string, ref: string) => items.find((e: any) => link.test(e.link) && e.kind === kind && e.ref_id === ref);
  assert.ok(pick(/^evidence-/, 'interview', '102'), 'the direct interview');
  assert.ok(pick(/^pain-/, 'interview', '101'), 'the pain-derived interview');
  assert.equal(pick(/^evidence-/, 'signal', 'signal-31')?.label, 'Letter of intent', 'the demand signal');
  assert.equal(pick(/^evidence-/, 'signal', 'revenue-41')?.label, 'Pre-sale · 500 EUR', 'the pre-sale');
  assert.deepEqual(pick(/^evidence-/, 'metric', 'mrr') && [pick(/^evidence-/, 'metric', 'mrr')!.label, pick(/^evidence-/, 'metric', 'mrr')!.date], ['MRR · 1200', '2026-10-07'], 'the ordinary KPI');
  assert.equal(pick(/^evidence-/, 'experiment', '51')?.label, 'Landing page · Two sign-ups', 'the experiment');
  const ph = items.find((e: any) => /PostHog/.test(e.label));
  assert.ok(ph, `the accepted PostHog metric is read back: ${JSON.stringify(items.map((e: any) => e.label))}`);
  assert.equal(ph!.label, 'Activated teams (PostHog) · 41.5%');
  assert.equal(ph!.kind, 'metric');
  assert.equal(ph!.direction, 'contradicts');
  assert.equal(ph!.date, '2026-10-08', 'the observation date is the fact\'s, not the link\'s');

  // The Experiments list: interview support is the status's population; the other links are counted by kind beside it.
  const list = await get(env, `/api/cycles/validate/modules/experiments?project=${P}`);
  assert.equal(list.status, 200, list.text.slice(0, 300));
  assert.ok(list.body.records.cols.includes('Interview support'));
  const row = list.body.records.rows.find((r: any) => r.id === H);
  assert.equal(row.interview_support, row.evidence);
  assert.deepEqual(row.linked_evidence, { interview: 1, signal: 2, metric: 2, experiment: 1 });
  assert.equal(list.body.parts.stats.status_basis, 'interviews');

  // The record header says which population its figure counts.
  const rec = await get(env, `/api/cycles/validate/modules/experiments/records/${H}?project=${P}`);
  assert.equal(rec.status, 200, rec.text.slice(0, 300));
  assert.ok(rec.body.facts.some((f: any) => f.label === 'Interview support'));
  assert.ok(!rec.body.facts.some((f: any) => f.label === 'Evidence'), 'no generically labelled figure');
  // Add evidence offers the valued PostHog metric, the same population addEvidence accepts.
  const addForm = rec.body.actions.find((a: any) => a.key === 'add-evidence');
  const refs = addForm.form.fields.find((f: any) => f.key === 'ref_id').options;
  assert.ok(refs.some((o: any) => o.value === 'posthog-phm-1' && o.label === 'KPI · Activated teams (PostHog)'), JSON.stringify(refs.map((o: any) => o.label)));

  // Removing a link updates the views; the source record stays.
  const phLink = ph!.link;
  await unlinkEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: H, link: phLink });
  const after = await evidenceFor({ env, projectId: P }, { hypothesisId: H });
  assert.ok(!after.some((e: any) => /PostHog/.test(e.label)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posthog_tracked_metrics WHERE uid = 'phm-1'").get().n, 1, 'the tracked metric is not deleted');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posthog_metric_facts WHERE fact_key = 'metric:phm-1'").get().n, 1, 'nor its fact');
  const relist = await get(env, `/api/cycles/validate/modules/experiments?project=${P}`);
  assert.deepEqual(relist.body.records.rows.find((r: any) => r.id === H).linked_evidence, { interview: 1, signal: 2, metric: 1, experiment: 1 });
});

test('a linked PostHog metric whose value is gone reads "Not recorded", never 0; one no longer tracked is left out', async () => {
  const { db, env } = await fixture();
  seed(db);
  db.prepare("INSERT INTO posthog_tracked_metrics (uid, integration_id, project_id, insight_short_id, insight_name, role, module, unit, created_by) VALUES ('phm-2', ?, ?, 'ins-2', NULL, 'retention', 'experiments', 'count', ?)").run(PH, P, FOUNDER);
  db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('l-1', ?, ?, 'metric', 'posthog-phm-2', 'supports')").run(P, H);
  db.prepare("INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('l-2', ?, ?, 'metric', 'posthog-gone', 'supports')").run(P, H);
  const items = await evidenceFor({ env, projectId: P }, { hypothesisId: H });
  const labels = items.filter((e: any) => e.kind === 'metric').map((e: any) => e.label);
  assert.deepEqual(labels, ['Retention (PostHog) · Not recorded']);
});

test('linkedCounts counts each kind and ignores an unknown one', () => {
  assert.deepEqual(linkedCounts([]), { interview: 0, signal: 0, metric: 0, experiment: 0 });
  assert.deepEqual(linkedCounts([{ kind: 'signal' }, { kind: 'signal' }, { kind: 'metric' }, { kind: 'bogus' }]),
    { interview: 0, signal: 2, metric: 1, experiment: 0 });
});
