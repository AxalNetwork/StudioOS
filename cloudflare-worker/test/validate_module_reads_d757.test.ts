/**
 * D757 §2.6–§2.7 (#1925) — what each Validate module reads from interviews:
 * its pending suggestions (writers only), the findings its records list,
 * "What it fed" on the Customer research record, the Verdict card's
 * interview line and Record a decision's preselection, and Accept all.
 * Fixture people are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_module_reads_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { PLACEMENT_KINDS, parsePlacements, placementSlug, type Segment } from '../src/services/interviewStructuring.ts';
import structure, { MAX_ACCEPT_ALL, storePlacements } from '../src/routes/founder_validate_structure.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { MODULES, QUOTE_WITHHELD } from '../src/services/cycleValidate.ts';
import { VALIDATE_SPECS } from '../src/services/records/validate.ts';
import { interviewEvidenceLine, interviewEvidenceSince, verdictCard } from '../src/services/verdict.ts';
import { canReadDecision } from '../src/routes/_founder_validate_helpers.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, PARTNER = 3, OTHER = 4, FOUNDER = 1009, OTHER_FOUNDER = 1010;
const PROJECT = 7, OTHER_PROJECT = 8, IV = 101, IV2 = 102, OTHER_IV = 201, SESSION = 5, SESSION2 = 6, OTHER_SESSION = 9, SEG = 61;

const SEGMENTS: Segment[] = [
  { start: 0, end: 4000, speaker: 'Me', text: 'How do you reconcile invoices today?' },
  { start: 4000, end: 12000, speaker: '[Interviewee]', text: 'By hand, every Friday. It takes my whole afternoon and I hate it.' },
  { start: 12000, end: 20000, speaker: '[Interviewee]', text: 'We looked at Ledgerly but it was too expensive.' },
  { start: 20000, end: 26000, speaker: '[Interviewee]', text: 'If it worked I would pay for it tomorrow.' },
];
const Q = {
  hand: { cite: { from: 4000, to: 12000 }, quote: SEGMENTS[1].text },
  ledgerly: { cite: { from: 12000, to: 20000 }, quote: SEGMENTS[2].text },
  pay: { cite: { from: 20000, to: 26000 }, quote: SEGMENTS[3].text },
};
const CTX = { hypotheses: [{ id: 31, code: 'H1', claim: 'Finance leads reconcile by hand' }], painGroups: [{ id: 41, title: 'Manual reconciliation' }] };

const TABLES = [
  'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
  'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
  'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  'competitor_analysis_outputs', 'mvp_features', 'roadmap_okrs', 'validation_decisions',
];

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('CREATE UNIQUE INDEX idx_hypotheses_project_code ON hypotheses (project_id, code)');
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('CREATE UNIQUE INDEX idx_pain_group_aliases_project_phrase ON pain_group_aliases (project_id, phrase_norm)');
  db.exec('CREATE UNIQUE INDEX idx_interview_pain_severities_unique ON interview_pain_severities (interview_id, phrase_norm)');
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(mig('255_hypothesis_verdict_history.sql'));
  db.exec(mig('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(mig('440_validate_cycle_stores.sql'));
  db.exec('ALTER TABLE mvp_features ADD COLUMN pain_group_id INTEGER REFERENCES pain_groups(id)');
  db.exec(mig('459_cycle_activity_convention.sql'));
  db.exec(mig('460_validate_record_stores.sql'));
  db.exec(mig('464_verdict_decisions.sql'));
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql',
    '447_assistant_interviews.sql', '452_record_session_setup.sql', '453_interview_processing.sql']) db.exec(mig(m));
    applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec(mig('449_interview_channels.sql').split(';')
    .filter((sql) => /CREATE TABLE IF NOT EXISTS channel_threads \(/.test(sql)).map((sql) => `${sql};`).join('\n'));
  db.exec(mig('488_channel_consents.sql'));
  applyEngineSchema(db);
  db.exec(mig('489_interview_findings.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, 0)');
  u.run(ME, 'founder', 'Fay Founder', 'fay@example.test', FOUNDER);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', OTHER_FOUNDER);
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Other tool', ${OTHER_FOUNDER});
    INSERT INTO customer_segments (id, project_id, name, name_norm) VALUES (${SEG}, ${PROJECT}, 'Finance leads', 'finance leads');
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, segment_id) VALUES
      (${IV}, ${PROJECT}, 'Interviewee A', ${SEG}), (${IV2}, ${PROJECT}, 'Interviewee B', NULL), (${OTHER_IV}, ${OTHER_PROJECT}, 'Interviewee C', NULL);
    INSERT INTO hypotheses (id, project_id, code, claim) VALUES (31, ${PROJECT}, 'H1', 'Finance leads reconcile by hand');
    INSERT INTO pain_groups (id, project_id, title) VALUES (41, ${PROJECT}, 'Manual reconciliation');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status) VALUES
      (${SESSION}, 'sess-5', ${IV}, ${PROJECT}, ${ME}, 'video', 'transcribed', 'given'),
      (${SESSION2}, 'sess-6', ${IV2}, ${PROJECT}, ${ME}, 'video', 'transcribed', 'given'),
      (${OTHER_SESSION}, 'sess-9', ${OTHER_IV}, ${OTHER_PROJECT}, ${OTHER}, 'video', 'transcribed', 'given');
  `);
  const seg = db.prepare("INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text) VALUES (?, ?, ?, ?, ?, ?)");
  for (const sid of [SESSION, SESSION2, OTHER_SESSION]) {
    // A live line first, so the final segment is not simply the lowest id.
    seg.run(sid, 'live', 20000, 26000, 'Speaker ?', 'live words');
    for (const s of SEGMENTS) seg.run(sid, 'final', s.start, s.end, s.speaker, s.text);
  }
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { env, db };
}

const ROLE: Record<number, string> = { [ME]: 'founder', [PARTNER]: 'partner', [OTHER]: 'founder' };
const token = (who: number) => new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function send(app: { request: Function }, env: any, who: number, method: string, path: string, body?: unknown) {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { authorization: `Bearer ${await token(who)}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: res.status, json: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const cycle = new Hono<any>();
cycle.route('/api/cycles/validate', cycleValidate);
cycle.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
const moduleRead = (env: any, who: number, slug: string) => send(cycle, env, who, 'GET', `/api/cycles/validate/modules/${slug}?project=${PROJECT}`);
const acceptAll = (env: any, who: number, sessionId: number, body: unknown) => send(structure, env, who, 'POST', `/sessions/${sessionId}/placements/accept`, body);

/** Store placements as one run on a session, and return their proposal ids in order. */
async function propose(env: any, db: any, placements: any[], { session = SESSION, interview = IV, project = PROJECT } = {}) {
  const parsed = parsePlacements(JSON.stringify({ placements }), SEGMENTS, CTX);
  assert.equal(parsed.dropped, 0, `a fixture placement was dropped: ${JSON.stringify(placements)}`);
  await storePlacements(env, { projectId: project, sessionId: session, interviewId: interview, runId: crypto.randomUUID(), userId: ME, model: 'm', placements: parsed.placements });
  return db.prepare('SELECT id FROM validate_proposals ORDER BY id DESC LIMIT ?').all(placements.length).map((r: any) => Number(r.id)).reverse();
}
const status = (db: any, id: number) => db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status;
const segId = (db: any, sid: number, start: number) => Number(db.prepare("SELECT id FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' AND start_ms = ?").get(sid, start).id);
const rctx = (env: any, user: any) => ({ env, projectId: PROJECT, project: { id: PROJECT, founder_id: FOUNDER }, user });
const FAY = { id: ME, role: 'founder', founder_id: FOUNDER };
const PAT = { id: PARTNER, role: 'partner', founder_id: null };
const section = (slug: string, key: string) => VALIDATE_SPECS[slug].sections.find((s) => s.key === key)!;

const ONE_PER_MODULE = [
  { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, ...Q.hand },
  { kind: 'firmographic', payload: { attribute: 'role', value: 'Finance lead' }, ...Q.hand },
  { kind: 'firmographic', payload: { attribute: 'tools', value: 'Spreadsheets' }, ...Q.hand },
  { kind: 'alternative', payload: { name: 'Spreadsheets', kind: 'workaround' }, ...Q.hand },
  { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
  { kind: 'hypothesis_new', payload: { claim: 'Finance leads pay to skip Fridays' }, ...Q.pay },
];

// ── 1. per-module suggestions ───────────────────────────────────────────────

test('1: a writer sees a module\'s pending suggestions with where each was heard, and the link to its line', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, ONE_PER_MODULE);
  const r = await moduleRead(env, ME, 'demand-signals');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const seg = segId(db, SESSION, 20000);
  assert.deepEqual(r.json.parts.suggestions, [{
    id: ids[4], kind: 'timing', payload: { when: 'tomorrow' }, quote: QUOTE_WITHHELD,
    // D857: no translation was read, so no original and no source language.
    quote_original: null, source_lang: null,
    interviewee: 'Interviewee A', interview_id: IV, session_id: SESSION, cite_from: 20000,
    segment_id: seg, speaker: '[Interviewee]', href: `/validate/session/${SESSION}?project=${PROJECT}#seg-${seg}`,
  }]);
  // With consent to quote, the quote itself.
  db.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').run(IV);
  assert.equal((await moduleRead(env, ME, 'demand-signals')).json.parts.suggestions[0].quote, Q.pay.quote);
  // A decided suggestion, another venture's, and one not from an engine run are not listed.
  await propose(env, db, [{ kind: 'timing', payload: { when: 'next week' }, ...Q.pay }], { session: OTHER_SESSION, interview: OTHER_IV, project: OTHER_PROJECT });
  db.prepare("INSERT INTO validate_proposals (project_id, kind, payload_json, model, task, status, target_ref) VALUES (?, 'timing', '{\"when\":\"now\"}', 'm', 't', 'pending', ?)").run(PROJECT, `interview:${IV}`);
  assert.equal((await send(structure, env, ME, 'POST', `/placements/${ids[4]}/discard`)).status, 200);
  assert.deepEqual((await moduleRead(env, ME, 'demand-signals')).json.parts.suggestions, []);
});

test('1: a reader gets no suggestions key at all', async () => {
  const { env, db } = world();
  await propose(env, db, ONE_PER_MODULE);
  const r = await moduleRead(env, PARTNER, 'demand-signals');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.parts.can_write, false);
  assert.equal('suggestions' in r.json.parts, false);
});

test('1: every suggestion maps to exactly one module through its slug', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, ONE_PER_MODULE);
  const seen = new Map<number, string[]>();
  for (const m of MODULES) {
    if (m.slug === 'verdict') continue;
    const r = await moduleRead(env, ME, m.slug);
    for (const s of r.json.parts.suggestions ?? []) seen.set(s.id, [...(seen.get(s.id) ?? []), m.slug]);
  }
  assert.deepEqual([...seen.keys()].sort((a, b) => a - b), ids);
  assert.deepEqual(ids.map((id) => seen.get(id)), [
    ['problem-discovery'], ['customer-research'], ['ideal-customer-profile'], ['market-intelligence'], ['demand-signals'], ['experiments'],
  ]);
  for (const [i, p] of ONE_PER_MODULE.entries()) assert.deepEqual(seen.get(ids[i]), [placementSlug(p.kind as any, p.payload)]);
  // #1927: the session's placements read names the same module, which the session page groups by.
  const read = await send(structure, env, ME, 'GET', `/sessions/${SESSION}/placements`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.json.runs[0].placements.map((p: any) => p.slug), ids.map((id) => seen.get(id)![0]));
});

// ── 2. the ICP, Market and Demand records list their findings ───────────────

test('2: the segment, competitor and demand records list their accepted findings, quotes behind the gate', async () => {
  const { env, db } = world();
  db.exec(`
    INSERT INTO competitor_analyses (id, user_id, project_id, status) VALUES ('analysis1', ${ME}, ${PROJECT}, 'complete');
    INSERT INTO competitor_candidates (id, analysis_id, name) VALUES ('candidate1', 'analysis1', 'Ledgerly');
    INSERT INTO demand_signals (id, project_id, kind, interview_id, status, signal_date) VALUES (71, ${PROJECT}, 'would_pay', ${IV}, 'to_confirm', '2026-10-12'), (72, ${PROJECT}, 'loi', ${IV2}, 'to_confirm', '2026-10-12');
  `);
  const ids = await propose(env, db, [
    { kind: 'firmographic', payload: { attribute: 'industry', value: 'Accounting' }, ...Q.hand },
    { kind: 'job_to_be_done', payload: { job: 'Close the books by Friday' }, ...Q.hand },
    { kind: 'alternative', payload: { name: 'Spreadsheets', kind: 'workaround' }, ...Q.hand },
    { kind: 'market_fact', payload: { fact: 'Ledgerly is priced for enterprises', topic: 'pricing' }, ...Q.ledgerly },
    { kind: 'budget', payload: { detail: 'About a hundred a month', amount_cents: 10000, currency: 'usd', period: 'month' }, ...Q.pay },
    { kind: 'objection', payload: { about: 'price', detail: 'Ledgerly was too expensive' }, ...Q.ledgerly },
  ]);
  for (const id of ids) assert.equal((await send(structure, env, ME, 'POST', `/placements/${id}/accept`)).status, 200);
  // A finding from the interview outside the segment and the signal.
  const [b] = await propose(env, db, [{ kind: 'job_to_be_done', payload: { job: 'Chase receipts' }, ...Q.hand }], { session: SESSION2, interview: IV2 });
  assert.equal((await send(structure, env, ME, 'POST', `/placements/${b}/accept`)).status, 200);

  const href = `/validate/customer-research/${IV}?project=${PROJECT}`;
  const icp = await section('ideal-customer-profile', 'findings').read(rctx(env, FAY), String(SEG));
  assert.deepEqual(icp.rows.map((r: any) => [r.a, r.b, r.c, r.href]).sort(), [
    ['Industry', `Accounting · "${Q.hand.quote}"`, 'Interviewee A', href],
    ['Job to be done', `Close the books by Friday · "${Q.hand.quote}"`, 'Interviewee A', href],
  ]);
  const market = await section('market-intelligence', 'findings').read(rctx(env, FAY), 'candidate1');
  assert.deepEqual(market.rows.map((r: any) => [r.a, r.b]).sort(), [
    ['Alternative · Workaround', `Spreadsheets · "${Q.hand.quote}"`],
    ['Market fact · Pricing', `Ledgerly is priced for enterprises · "${Q.ledgerly.quote}"`],
  ]);
  const demand = await section('demand-signals', 'findings').read(rctx(env, FAY), 'signal-71');
  assert.deepEqual(demand.rows.map((r: any) => [r.a, r.b]).sort(), [
    ['Budget', `About a hundred a month · 100 USD / month · "${Q.pay.quote}"`],
    ['Objection · Price', `Ledgerly was too expensive · "${Q.ledgerly.quote}"`],
  ]);
  // The other signal's interview gave none; a reader gets the line without the words.
  assert.deepEqual((await section('demand-signals', 'findings').read(rctx(env, FAY), 'signal-72')).rows, []);
  const read = await section('ideal-customer-profile', 'findings').read(rctx(env, PAT), String(SEG));
  assert.deepEqual(read.rows.map((r: any) => r.b).sort(), [`Accounting · ${QUOTE_WITHHELD}`, `Close the books by Friday · ${QUOTE_WITHHELD}`]);
  db.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').run(IV);
  const consented = await section('ideal-customer-profile', 'findings').read(rctx(env, PAT), String(SEG));
  assert.ok(consented.rows.every((r: any) => r.b.endsWith(`"${Q.hand.quote}"`)), 'with consent, a reader reads the quote');
});

// ── 3. What it fed ──────────────────────────────────────────────────────────

test('3: What it fed counts the interview\'s accepted suggestions per module, each linking its module', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, [
    { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
    { kind: 'urgency', payload: { level: 'high' }, ...Q.hand },
    { kind: 'firmographic', payload: { attribute: 'tools', value: 'Spreadsheets' }, ...Q.hand },
    { kind: 'buying_trigger', payload: { trigger: 'Month-end close' }, ...Q.hand },
  ]);
  for (const id of ids.slice(0, 3)) assert.equal((await send(structure, env, ME, 'POST', `/placements/${id}/accept`)).status, 200);
  assert.equal((await send(structure, env, ME, 'POST', `/placements/${ids[3]}/discard`)).status, 200);
  // Another interview's accept is that interview's.
  const [b] = await propose(env, db, [{ kind: 'timing', payload: { when: 'later' }, ...Q.pay }], { session: SESSION2, interview: IV2 });
  assert.equal((await send(structure, env, ME, 'POST', `/placements/${b}/accept`)).status, 200);
  const fed = await section('customer-research', 'fed').read(rctx(env, FAY), String(IV));
  assert.deepEqual(fed.rows.slice(3), [
    { a: 'Ideal customer profile', b: '1 accepted suggestion', href: `/validate/ideal-customer-profile?project=${PROJECT}` },
    { a: 'Demand and urgency signals', b: '2 accepted suggestions', href: `/validate/demand-signals?project=${PROJECT}` },
  ]);
  const none = await section('customer-research', 'fed').read(rctx(env, FAY), String(IV2));
  assert.deepEqual(none.rows.slice(3).map((r: any) => [r.a, r.b]), [['Demand and urgency signals', '1 accepted suggestion']]);
});

// ── 4. Verdict ──────────────────────────────────────────────────────────────

function evidenceLink(db: any, id: number, ref: string, direction: string, at: string, hypothesis = 31) {
  db.prepare(`INSERT INTO hypothesis_evidence_links (id, uid, project_id, hypothesis_id, kind, ref_id, direction, created_at)
    VALUES (?, ?, ?, ?, 'interview', ?, ?, ?)`).run(id, `e-${id}`, PROJECT, hypothesis, ref, direction, at);
}

test('4: the Verdict line counts interview evidence since the last decision, and the contradicting ones', async () => {
  const { env, db } = world();
  const ctx: any = { env, projectId: PROJECT, today: '2026-10-19', canWrite: true };
  assert.equal((await verdictCard(ctx)).interview_evidence!.text, '0 pieces of interview evidence so far, 0 contradicting');
  evidenceLink(db, 1, String(IV), 'supports', '2026-10-01 09:00:00');
  evidenceLink(db, 2, String(IV2), 'contradicts', '2026-10-01 10:00:00');
  db.prepare("INSERT INTO hypothesis_evidence_links (id, uid, project_id, hypothesis_id, kind, ref_id, direction, created_at) VALUES (3, 'e-3', ?, 31, 'signal', 'signal-71', 'supports', '2026-10-12 09:00:00')").run(PROJECT);
  db.prepare("INSERT INTO demand_signals (id, project_id, kind, status, signal_date) VALUES (71, ?, 'would_pay', 'to_confirm', '2026-10-12')").run(PROJECT);
  assert.deepEqual(await interviewEvidenceSince(env, PROJECT), { ids: ['evidence-1', 'evidence-2'], contradicting: 1, since: null });
  // A decision on 5 Oct: only what came after it is new; a signal is never interview evidence.
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, decided_at) VALUES (?, 'persevere', 'r', ?, 'withheld', '2026-10-05T12:00:00Z')").run(PROJECT, ME);
  db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (32, ?, 'H2', 'Fridays are the pain')").run(PROJECT);
  evidenceLink(db, 4, String(IV), 'contradicts', '2026-10-05 12:00:01', 32);
  evidenceLink(db, 5, String(IV2), 'supports', '2026-10-06 08:00:00', 32);
  // Another venture's decision is not this venture's last.
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, decided_at) VALUES (?, 'persevere', 'r', ?, 'withheld', '2026-10-30 00:00:00')").run(OTHER_PROJECT, OTHER);
  assert.deepEqual(await interviewEvidenceSince(env, PROJECT), { ids: ['evidence-4', 'evidence-5'], contradicting: 1, since: '2026-10-05 12:00:00' });
  const card = await verdictCard(ctx);
  assert.deepEqual(card.interview_evidence, { count: 2, contradicting: 1, text: '2 new pieces of interview evidence since your last decision, 1 contradicting' });
  // A pain-link item is as new as the later of its link and its interview.
  db.prepare("INSERT INTO hypothesis_pain_links (id, hypothesis_id, pain_group_id, direction, created_at) VALUES (81, 31, 41, 'supports', '2026-10-01 00:00:00')").run();
  db.prepare("UPDATE discovery_interviews SET created_at = CASE id WHEN ? THEN '2026-10-07 00:00:00' ELSE '2026-09-01 00:00:00' END").run(IV);
  const pains = [{ id: `pain-81-${IV}`, kind: 'interview', direction: 'supports' }, { id: `pain-81-${IV2}`, kind: 'interview', direction: 'supports' }] as any;
  assert.deepEqual((await interviewEvidenceSince(env, PROJECT, pains)).ids, [`pain-81-${IV}`]);
  // A current verdict for the venture: the ok card carries the line too.
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, decided_at) VALUES (?, 'persevere', 'r', ?, 'given', '2026-10-05 12:00:00')").run(PROJECT, ME);
  const ok = await verdictCard(ctx);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.interview_evidence!.count, 2);
  assert.equal(interviewEvidenceLine(1, 0, 'x'), '1 new piece of interview evidence since your last decision, 0 contradicting');
});

test('4: Record a decision preselects exactly that evidence; a partner gets neither the line nor the form', async () => {
  const { env, db } = world();
  db.prepare("INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by, state, decided_at) VALUES (?, 'persevere', 'r', ?, 'withheld', '2026-10-05 12:00:00')").run(PROJECT, ME);
  evidenceLink(db, 1, String(IV), 'supports', '2026-10-01 09:00:00');
  evidenceLink(db, 2, String(IV2), 'contradicts', '2026-10-06 10:00:00');
  const opts: any = await VALIDATE_SPECS.verdict.formOptions!(rctx(env, FAY) as any, {});
  assert.deepEqual(opts.evidence.options.map((o: any) => o.value), ['evidence-1', 'evidence-2']);
  assert.deepEqual(opts.evidence.suggested_evidence, ['evidence-2']);
  // The Verdict module (and its card) and the form are refused to a partner.
  const r = await moduleRead(env, PARTNER, 'verdict');
  assert.equal(r.status, 403);
  assert.equal(canReadDecision({ id: PROJECT, founder_id: FOUNDER }, PAT as any), false);
  assert.equal(VALIDATE_SPECS.verdict.read, canReadDecision);
  const overview = await send(cycle, env, PARTNER, 'GET', `/api/cycles/validate/overview?project=${PROJECT}`);
  assert.equal(overview.status, 200);
  assert.equal(overview.json.cards.some((c: any) => c.slug === 'verdict'), false);
  assert.equal(JSON.stringify(overview.json).includes('interview evidence'), false);
});

test('4: no kind proposes a verdict, and no suggestion path writes a decision', async () => {
  const { env, db } = world();
  for (const kind of Object.keys(PLACEMENT_KINDS) as (keyof typeof PLACEMENT_KINDS)[]) {
    assert.notEqual(PLACEMENT_KINDS[kind].slug, 'verdict', kind);
    for (const p of [{}, { attribute: 'role' }, { attribute: 'tools' }]) assert.notEqual(placementSlug(kind, p), 'verdict', kind);
  }
  for (const file of ['routes/founder_validate_structure.ts', 'services/interviewSuggestions.ts', 'services/records/validate.ts']) {
    assert.doesNotMatch(src(file), /INSERT INTO validation_decisions|UPDATE validation_decisions/, file);
  }
  const ids = await propose(env, db, ONE_PER_MODULE);
  const outcomes = [];
  for (const m of MODULES) outcomes.push(...(await acceptAll(env, ME, SESSION, { slug: m.slug })).json.results);
  assert.deepEqual(outcomes.filter((o: any) => !o.ok), []);
  assert.ok(ids.every((id) => status(db, id) === 'accepted'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM validation_decisions').get().n, 0);
  assert.equal((await acceptAll(env, ME, SESSION, { slug: 'verdict' })).json.results.length, 0);
});

// ── 5. Accept all ───────────────────────────────────────────────────────────

const findingsCount = (db: any) => Number(db.prepare('SELECT COUNT(*) AS n FROM interview_findings').get().n);

test('5: three suggestions, one with a bad payload: two accepted, one back to pending, each reported', async () => {
  const { env, db } = world();
  const [timing, urgency] = await propose(env, db, [
    { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
    { kind: 'urgency', payload: { level: 'high' }, ...Q.hand },
  ]);
  // A payload its writer refuses: the claim is taken, the writer says no, and it goes back.
  db.prepare("UPDATE validate_proposals SET payload_json = '{\"trigger\":\"\"}', kind = 'buying_trigger' WHERE id = ?").run(urgency);
  const [extra, icp] = await propose(env, db, [
    { kind: 'objection', payload: { about: 'price', detail: 'Too expensive' }, ...Q.ledgerly },
    // Another module's suggestion is not this module's to accept.
    { kind: 'firmographic', payload: { attribute: 'tools', value: 'Spreadsheets' }, ...Q.hand },
  ]);
  const r = await acceptAll(env, ME, SESSION, { slug: 'demand-signals' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.results.map((x: any) => [x.id, x.ok, x.error ?? null]), [[timing, true, null], [urgency, false, 'writer_refused'], [extra, true, null]]);
  assert.equal(r.json.results[1].detail, 'That is not a valid value for this finding');
  assert.deepEqual([r.json.accepted, r.json.remaining], [2, 0]);
  assert.deepEqual([status(db, timing), status(db, urgency), status(db, extra), status(db, icp)], ['accepted', 'pending', 'accepted', 'pending']);
  assert.equal(findingsCount(db), 2);
  // Each one ran its own writer, with its own log row.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'interview_finding_written'").get().n, 2);
});

test('5: a replay accepts nothing twice', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, [
    { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
    { kind: 'urgency', payload: { level: 'high' }, ...Q.hand },
  ]);
  assert.equal((await acceptAll(env, ME, SESSION, { slug: 'demand-signals' })).json.accepted, 2);
  const again = await acceptAll(env, ME, SESSION, { slug: 'demand-signals' });
  assert.deepEqual([again.json.results, again.json.accepted], [[], 0]);
  const byIds = await acceptAll(env, ME, SESSION, { ids });
  assert.deepEqual(byIds.json.results.map((x: any) => [x.id, x.ok, x.error]), [[ids[0], false, 'not_pending'], [ids[1], false, 'not_pending']]);
  assert.equal(findingsCount(db), 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'interview_finding_written'").get().n, 2);
});

test('5: another founder\'s session answers 404; ids outside the session are not found and untouched', async () => {
  const { env, db } = world();
  const [mine] = await propose(env, db, [{ kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay }]);
  const [theirs] = await propose(env, db, [{ kind: 'timing', payload: { when: 'later' }, ...Q.pay }], { session: OTHER_SESSION, interview: OTHER_IV, project: OTHER_PROJECT });
  for (const body of [{ slug: 'demand-signals' }, { ids: [mine] }]) {
    const r = await acceptAll(env, OTHER, SESSION, body);
    assert.equal(r.status, 404, JSON.stringify(body));
  }
  assert.equal((await acceptAll(env, PARTNER, SESSION, { slug: 'demand-signals' })).status, 404);
  assert.equal((await acceptAll(env, ME, 999, { slug: 'demand-signals' })).status, 404);
  assert.equal(status(db, mine), 'pending');
  // Another venture's, and this venture's from another session: neither is this session's.
  const [sibling] = await propose(env, db, [{ kind: 'timing', payload: { when: 'soon' }, ...Q.pay }], { session: SESSION2, interview: IV2 });
  const r = await acceptAll(env, ME, SESSION, { ids: [theirs, sibling] });
  const nf = { ok: false, error: 'not_found', detail: 'This placement is not in this session.' };
  assert.deepEqual(r.json.results, [{ id: theirs, ...nf }, { id: sibling, ...nf }]);
  assert.deepEqual([status(db, theirs), status(db, sibling)], ['pending', 'pending']);
});

test('5: 51 ids are refused before anything runs; a module with 51 takes 50 and says one remains', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, Array.from({ length: MAX_ACCEPT_ALL + 1 }, (_, i) => ({ kind: 'buying_trigger', payload: { trigger: `Trigger ${i}` }, ...Q.hand })));
  const r = await acceptAll(env, ME, SESSION, { ids });
  assert.deepEqual([r.status, r.json.error], [400, 'too_many']);
  assert.ok(ids.every((id) => status(db, id) === 'pending'));
  for (const body of [{}, { slug: 'demand-signals', ids: [ids[0]] }, { ids: [] }, { ids: ['1'] }, { slug: 'nowhere' }]) {
    assert.equal((await acceptAll(env, ME, SESSION, body)).status, 400, JSON.stringify(body));
  }
  const all = await acceptAll(env, ME, SESSION, { slug: 'demand-signals' });
  assert.deepEqual([all.json.accepted, all.json.remaining], [MAX_ACCEPT_ALL, 1]);
  assert.equal(status(db, ids[MAX_ACCEPT_ALL]), 'pending');
  assert.equal(findingsCount(db), MAX_ACCEPT_ALL);
});
