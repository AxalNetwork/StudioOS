/**
 * D859 (#2504) — a conversation's data points, actions and prototype asks, as
 * Validate placements the founder accepts: extraction (a stubbed Workers AI),
 * the mapping onto the interview engine's kinds, `money_term`, idempotency,
 * a decided item never returning, the consent gate, metering on the AI token
 * ledger, and accept writing the module. Fixture people are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/conversation_items_d859.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { applyEngineSchema } from './_engine_schema.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { guardSafe } from './_guard_stub.mjs';
import structure from '../src/routes/founder_validate_structure.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  EXTRACT_PROMPT, MIN_CONFIDENCE, amountQuoted, extractConversationItems, parseItems, placementFor, quotedCents,
} from '../src/services/conversationItems.ts';
import { FINDING_KINDS, findingLine } from '../src/services/interviewFindings.ts';
import { PLACEMENT_KINDS, STRUCTURE_PASSES, type Segment } from '../src/services/interviewStructuring.ts';
import { TASK_LABELS } from '../src/services/aiCatalog.ts';
import { digestSession } from '../src/services/validateEngine.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, FOUNDER = 1009, PROJECT = 7, IV = 101, SESSION = 5;

/** A synthetic customer chat, one message per segment. */
const ROWS = [
  [0, 'Founder', 'How do you handle invoices today?'],
  [1000, 'Customer', 'We pay Ledgerly $49 a month and still reconcile by hand every Friday.'],
  [2000, 'Customer', 'We are a team of 12 in finance.'],
  [3000, 'Customer', 'I would pay $1,200 a year for something that matches payments on its own.'],
  [4000, 'Customer', 'Can it export straight to our accounting tool? That is the feature I need.'],
  [5000, 'Customer', 'Send me the beta link next week and I will intro you to our CFO.'],
] as const;
const SEGMENTS: Segment[] = ROWS.map(([start, speaker, text], i) => ({ start, end: i + 1 < ROWS.length ? ROWS[i + 1][0] : start + 1000, speaker, text }));
const cite = (i: number) => ({ cite: { from: SEGMENTS[i].start, to: SEGMENTS[i].end }, quote: SEGMENTS[i].text });

const ITEMS = [
  { type: 'data_point', kind: 'current_tool', value: 'Ledgerly', confidence: 0.9, amount_cents: 4900, currency: 'usd', period: 'month', ...cite(1) },
  { type: 'data_point', kind: 'frequency', value: 'every Friday', unit: 'reconcile by hand', confidence: 0.8, ...cite(1) },
  { type: 'data_point', kind: 'team_size', value: '12', unit: 'in finance', confidence: 0.9, ...cite(2) },
  { type: 'data_point', kind: 'price', value: 'would pay for automatic matching', confidence: 0.85, amount_cents: 120000, currency: 'usd', period: 'year', ...cite(3) },
  { type: 'prototype_ask', feature: 'Export straight to the accounting tool', workflow: 'Matched payments go to accounting', ...cite(4) },
  { type: 'action', kind: 'beta_signup', detail: 'Send the beta link', due_hint: 'next week', ...cite(5) },
  { type: 'action', kind: 'intro_offer', detail: 'An intro to their CFO', ...cite(5) },
];

const TABLES = [
  'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
  'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
  'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  'competitor_analysis_outputs', 'mvp_features', 'roadmap_okrs',
];

/** The Validate world (as D757's), the AI token ledger beside it, and a stub Workers AI. */
function world(answer: (input: any) => unknown = () => ({ response: JSON.stringify({ items: ITEMS }) }), { channel = 'text', via = 'whatsapp', consent = 'given' } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('CREATE UNIQUE INDEX idx_hypotheses_project_code ON hypotheses (project_id, code)');
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(mig('255_hypothesis_verdict_history.sql'));
  db.exec(mig('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(mig('440_validate_cycle_stores.sql'));
  db.exec('ALTER TABLE mvp_features ADD COLUMN pain_group_id INTEGER REFERENCES pain_groups(id)');
  db.exec(mig('459_cycle_activity_convention.sql'));
  db.exec(mig('460_validate_record_stores.sql'));
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql',
    '447_assistant_interviews.sql', '452_record_session_setup.sql', '453_interview_processing.sql']) db.exec(mig(m));
  db.exec(mig('449_interview_channels.sql').split(';')
    .filter((sql) => /CREATE TABLE IF NOT EXISTS channel_threads \(/.test(sql)).map((sql) => `${sql};`).join('\n'));
  db.exec(mig('488_channel_consents.sql'));
  applyEngineSchema(db);
  applySessionTranslationColumns(db); // D857: production applies migration 527 before the Worker ships.
  db.exec(mig('489_interview_findings.sql'));
  // The AI token ledger: every call holds and settles here (D629, D844).
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, 'founder', 'Fay Founder', 'fay@example.test', 1, ?, 0)").run(ME, FOUNDER);
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER});
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${IV}, ${PROJECT}, 'Customer A');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, submitted_via)
      VALUES (${SESSION}, 'sess-5', ${IV}, ${PROJECT}, ${ME}, '${channel}', 'structured', '${consent}', '${via}');
  `);
  for (const [start, speaker, text] of ROWS) {
    db.prepare("INSERT INTO interview_transcript_segments (session_id, source, start_ms, speaker_label, text) VALUES (?, 'final', ?, ?, ?)").run(SESSION, start, speaker, text);
  }
  const calls: any[] = [];
  const env: any = {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    AI: { run: guardSafe(async (model: string, input: any) => { calls.push({ model, input }); return answer(input); }) },
  };
  return { env, db, calls };
}

async function call(env: any, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await structure.request(path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const proposals = (db: any) => db.prepare("SELECT id, kind, payload_json, task, status, cite_from FROM validate_proposals ORDER BY id").all()
  .map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));
const byKind = (db: any, kind: string) => proposals(db).find((p: any) => p.kind === kind);

// ── the pure rules ───────────────────────────────────────────────────────────

test('money_term: an amount is kept only when that figure is in the quote', () => {
  assert.deepEqual([...quotedCents('We pay $49 a month, $1,200 a year, 12.5 per seat, or 2k at most.')].sort((a, b) => a - b), [1250, 4900, 120000, 200000]);
  assert.equal(amountQuoted({ amount_cents: 4900 }, 'We pay $49 a month'), true);
  assert.equal(amountQuoted({ amount_cents: 5000 }, 'We pay $49 a month'), false, 'a rounded figure was not said');
  assert.equal(amountQuoted({}, 'No figure'), true, 'no amount, nothing to check');
  // A price or a spend IS its figure: without a said one it is not a data point.
  assert.equal(placementFor({ type: 'data_point', kind: 'price', value: 'would pay', confidence: 0.9, amount_cents: 99900 }, 'I would pay for it'), null);
  assert.equal(placementFor({ type: 'data_point', kind: 'spend', value: 'pays today', confidence: 0.9 }, 'We pay a lot'), null);
  // A tool stands without its figure; a figure not said is removed.
  assert.deepEqual(placementFor({ type: 'data_point', kind: 'current_tool', value: 'Ledgerly', confidence: 0.9, amount_cents: 5000 }, 'We pay Ledgerly $49'),
    { kind: 'competitor_mention', payload: { name: 'Ledgerly' } });
});

test('the mapping: each typed item onto the interview engine\'s kind for its module', () => {
  const quote = 'We pay Ledgerly $49 a month and $1,200 a year';
  const map = (item: any) => placementFor({ confidence: 0.9, ...item }, quote)?.kind ?? null;
  assert.equal(map({ type: 'data_point', kind: 'price', value: 'x', amount_cents: 120000 }), 'demand_signal');
  assert.equal(map({ type: 'data_point', kind: 'spend', value: 'x', amount_cents: 4900 }), 'budget');
  assert.equal(map({ type: 'data_point', kind: 'current_tool', value: 'Ledgerly' }), 'competitor_mention');
  assert.equal(map({ type: 'data_point', kind: 'team_size', value: '12' }), 'firmographic');
  assert.equal(map({ type: 'data_point', kind: 'frequency', value: 'weekly' }), 'job_to_be_done');
  assert.equal(map({ type: 'data_point', kind: 'pain', value: 'by hand', severity: 'severe' }), 'pain_severity');
  assert.equal(map({ type: 'action', kind: 'follow_up', detail: 'call back' }), 'follow_up');
  assert.equal(map({ type: 'prototype_ask', feature: 'export' }), 'prototype_ask');
  assert.equal(map({ type: 'summary', text: 'x' }), null);
  // A data point below the confidence floor, or with none, is not proposed.
  assert.equal(placementFor({ type: 'data_point', kind: 'team_size', value: '12', confidence: MIN_CONFIDENCE - 0.01 }, quote), null);
  assert.equal(placementFor({ type: 'data_point', kind: 'team_size', value: '12' }, quote), null);
  // The modules: price and spend to Demand signals, a tool to Market intelligence, actions and asks to the interview.
  assert.deepEqual(['demand_signal', 'budget', 'competitor_mention', 'firmographic', 'job_to_be_done', 'pain_severity', 'follow_up', 'prototype_ask']
    .map((k) => PLACEMENT_KINDS[k as keyof typeof PLACEMENT_KINDS].slug),
  ['demand-signals', 'demand-signals', 'market-intelligence', 'ideal-customer-profile', 'ideal-customer-profile', 'problem-discovery', 'customer-research', 'customer-research']);
  // A prototype ask always carries build_candidate; the two new kinds are in a structure pass and have their line.
  assert.equal(FINDING_KINDS.prototype_ask.parse({ feature: 'export' })?.build_candidate, true);
  assert.equal(STRUCTURE_PASSES.filter((p) => (p.kinds as readonly string[]).includes('prototype_ask')).length, 1);
  assert.deepEqual(findingLine('follow_up', { kind: 'beta_signup', detail: 'Send the link', due_hint: 'next week' }), { what: 'Beta sign-up', detail: 'Send the link · next week' });
  assert.equal(TASK_LABELS.extract_conversation_items, 'Find actions and data points in a conversation');
  assert.match(EXTRACT_PROMPT, /untrusted data/);
  assert.match(EXTRACT_PROMPT, /Never estimate/);
});

test('parseItems: every item is tied to its segment; an uncited or invented one is dropped', () => {
  const out = parseItems(JSON.stringify({ items: [
    ...ITEMS,
    { type: 'action', kind: 'follow_up', detail: 'No passage', cite: { from: 0, to: 1000 }, quote: 'Not in the chat at all.' },
    { type: 'data_point', kind: 'price', value: 'would pay', confidence: 0.9, amount_cents: 99900, ...cite(3) },
  ] }), SEGMENTS);
  assert.equal(out.dropped, 2, 'the uncited one and the invented price');
  assert.deepEqual(out.placements.map((p) => [p.kind, p.cite.from]),
    [['competitor_mention', 1000], ['job_to_be_done', 1000], ['firmographic', 2000], ['demand_signal', 3000], ['prototype_ask', 4000], ['follow_up', 5000], ['follow_up', 5000]]);
  assert.deepEqual(out.placements.find((p) => p.kind === 'demand_signal')!.payload,
    { signal: 'would_pay', detail: 'would pay for automatic matching', amount_cents: 120000, currency: 'usd', period: 'year' });
  assert.equal(parseItems('not json at all', SEGMENTS).placements.length, 0);
});

// ── the run ──────────────────────────────────────────────────────────────────

test('a fixture chat yields data points, actions and prototype asks as pending placements, each on its segment', async () => {
  const { env, db, calls } = world();
  const out = await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  assert.equal(out.ok, true);
  assert.equal((out as any).stored, 7);
  const rows = proposals(db);
  assert.deepEqual(rows.map((r: any) => r.kind).sort(), ['competitor_mention', 'demand_signal', 'firmographic', 'follow_up', 'follow_up', 'job_to_be_done', 'prototype_ask']);
  assert.ok(rows.every((r: any) => r.status === 'pending' && r.task === 'extract_conversation_items'), 'pending, and named by their task');
  assert.equal(byKind(db, 'prototype_ask').payload.build_candidate, true);
  assert.equal(byKind(db, 'prototype_ask').cite_from, 4000);
  // The chat is data: the call carries the extraction prompt and the delimited transcript.
  const model = calls.find((c) => !/guard/.test(c.model));
  assert.match(String(model.input.messages?.[0]?.content), /You read one customer conversation/);
  assert.match(String(model.input.messages?.[1]?.content), /BEGIN_TRANSCRIPT_/);
});

test('metered: each call holds and settles the member\'s AI tokens; with none left, nothing runs or is stored', async () => {
  const { env, db } = world();
  await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  const holds = db.prepare('SELECT status FROM ai_budget_reservations').all().map((r: any) => r.status);
  assert.ok(holds.length >= 1 && holds.every((s: string) => s === 'settled'), `held and settled: ${holds}`);
  const logged = db.prepare("SELECT DISTINCT task FROM ai_usage_logs WHERE user_id = ? AND task != 'safety'").all(ME).map((r: any) => r.task);
  assert.deepEqual(logged, ['extract_conversation_items'], 'the run is logged and priced under its own task');
  const broke = world();
  setFixtureAllowance(broke.db, 0);
  const refused = await extractConversationItems(broke.env, { sessionId: SESSION, userId: ME });
  assert.deepEqual([refused.ok, (refused as any).reason], [false, 'refused']);
  assert.equal(proposals(broke.db).length, 0);
  assert.equal(broke.calls.filter((c) => !/guard/.test(c.model)).length, 0, 'no model call without AI tokens');
});

test('idempotent: re-running proposes nothing twice, and a decided item never comes back', async () => {
  const { env, db } = world();
  await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  const again = await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual([(again as any).stored, (again as any).deduped], [0, 7]);
  // Discard one and accept another; neither returns on a third run.
  const ask = byKind(db, 'prototype_ask').id;
  const tool = byKind(db, 'competitor_mention').id;
  assert.equal((await call(env, 'POST', `/placements/${tool}/discard`)).status, 200);
  assert.equal((await call(env, 'POST', `/placements/${ask}/accept`)).status, 200);
  const third = await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  assert.equal((third as any).stored, 0);
  assert.equal(proposals(db).length, 7);
});

test('accept writes the module: a follow-up and a prototype ask land on the interview, with build_candidate', async () => {
  const { env, db } = world();
  await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  const followUp = proposals(db).find((p: any) => p.kind === 'follow_up' && p.payload.kind === 'beta_signup').id;
  assert.equal((await call(env, 'POST', `/placements/${followUp}/accept`)).status, 200);
  assert.equal((await call(env, 'POST', `/placements/${byKind(db, 'prototype_ask').id}/accept`)).status, 200);
  const found = db.prepare('SELECT module, kind, payload_json, interview_id, quote FROM interview_findings ORDER BY id').all()
    .map((r: any) => ({ module: r.module, kind: r.kind, interview: r.interview_id, payload: JSON.parse(r.payload_json) }));
  assert.deepEqual(found, [
    { module: 'customer-research', kind: 'follow_up', interview: IV, payload: { kind: 'beta_signup', detail: 'Send the beta link', due_hint: 'next week' } },
    { module: 'customer-research', kind: 'prototype_ask', interview: IV, payload: { feature: 'Export straight to the accounting tool', workflow: 'Matched payments go to accounting', build_candidate: true } },
  ]);
  // A price is accepted through Demand signals' own writer, with the figure the customer said.
  assert.equal((await call(env, 'POST', `/placements/${byKind(db, 'demand_signal').id}/accept`)).status, 200);
  assert.equal(byKind(db, 'demand_signal').status, 'accepted');
});

test('consent first: a declined chat is never read, and nothing is called or charged', async () => {
  const { env, db, calls } = world(undefined, { consent: 'declined' });
  const out = await extractConversationItems(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual([out.ok, (out as any).reason], [false, 'consent_not_recorded']);
  assert.equal(calls.length, 0);
  assert.equal(proposals(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_budget_reservations').get().n, 0);
});

test('another member, or a session with no final transcript, runs nothing', async () => {
  const { env, db, calls } = world();
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (3, 'founder', 'Other', 'o@example.test', 1, 4242)").run();
  assert.deepEqual([(await extractConversationItems(env, { sessionId: SESSION, userId: 3 })) as any].map((o) => o.reason), ['not_writable']);
  db.exec('DELETE FROM interview_transcript_segments');
  assert.equal(((await extractConversationItems(env, { sessionId: SESSION, userId: ME })) as any).reason, 'no_final_transcript');
  assert.equal(calls.length, 0);
});

test('the engine: a chat\'s digest also lists its items, and since D873 a call\'s does too, read as a call', async () => {
  const byPrompt = (input: any) => (/You read one customer conversation/.test(String(input.messages?.[0]?.content))
    ? { response: JSON.stringify({ items: ITEMS }) }
    : { response: JSON.stringify({ placements: [] }) });
  const chat = world(byPrompt);
  const out = await digestSession(chat.env, { sessionId: SESSION, userId: ME, trigger: 'chat_text_added', stages: ['structure'], force: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(proposals(chat.db).filter((r: any) => r.task === 'extract_conversation_items').length, 7);
  assert.ok(!chat.calls.some((c) => /This conversation is a call/.test(JSON.stringify(c.input))), 'a chat is not read as a call');
  // D873 (#2520): a call's digest lists its items too, with the call's prompt.
  const zoom = world(byPrompt, { via: 'zoom' });
  await digestSession(zoom.env, { sessionId: SESSION, userId: ME, trigger: 'call_imported', stages: ['structure'], force: true });
  assert.equal(proposals(zoom.db).filter((r: any) => r.task === 'extract_conversation_items').length, 7);
  assert.ok(zoom.calls.some((c) => /This conversation is a call/.test(JSON.stringify(c.input))), 'a call is read as a call');
});
