/**
 * D757 (#1924) — the Otter-like summary for every source: an overview, key
 * quotes with speaker and time, decisions and next steps, as a draft until a
 * writer keeps it.
 *
 * Real SQLite, as validate_engine_d757.test.ts builds it. Workers AI is an
 * in-memory stand-in that returns fixture JSON per task and counts its calls.
 * Each case names the mutation it was checked against.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/session_digest_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import sessionsRoutes, { sessionDigest } from '../src/routes/founder_validate_sessions.ts';
import structureRoutes from '../src/routes/founder_validate_structure.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { appendSegments, importTranscript, openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { NOTES, digestSession } from '../src/services/validateEngine.ts';
import { MAX_DIGEST_OVERVIEW, MAX_DIGEST_PARTS, checkDigest } from '../src/services/interviewStructuring.ts';
import { VALIDATE_SPECS } from '../src/services/records/validate.ts';
import { QUOTE_WITHHELD } from '../src/services/cycleValidate.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ME = 2, PARTNER = 40, FOUNDER = 9;
const PROJECT = 7;
const INTERVIEW = 101;
const LINE = 'We reconcile invoices by hand every Friday.';
const SECOND = 'It takes the whole afternoon.';

type Reply = { summary: unknown; structure?: unknown };

function world(reply: Reply) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    UPDATE users SET role = 'partner' WHERE id = ${PARTNER};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER});
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT, recording_duration_sec INTEGER,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz');
    CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL, claim TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, retired_at TEXT);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', auth_type TEXT, credentials_enc TEXT, config_json TEXT,
      external_account_id TEXT, external_account_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    '452_record_session_setup.sql', '453_interview_processing.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql']) db.exec(mig(m));
    applySessionTranslationColumns(db); // D857: migration 527's segment columns
  applyEngineSchema(db);
  const ai: { task: 'summary' | 'structure'; prompt: string }[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        const prompt = JSON.stringify(input);
        const task = prompt.includes('Summarise one customer') ? 'summary' : 'structure';
        ai.push({ task, prompt });
        const body = task === 'summary' ? reply.summary : (reply.structure ?? { placements: [] });
        return { response: typeof body === 'string' ? body : JSON.stringify(body) };
      },
    },
  };
  return { env, db, ai };
}
type World = ReturnType<typeof world>;

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessionsRoutes as any);
  a.route('/api/founder/validate', structureRoutes as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    if (err instanceof Response) return err;
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, method: string, path: string, body?: unknown, user = ME) {
  const tok = await new SignJWT({ user_id: user, role: user === PARTNER ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const row = (db: any, id: number) => ({ ...db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(id) });
const digestOf = (db: any, id: number) => JSON.parse(row(db, id).digest_json);
const n = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);

/** A consented call with two lines, 0–1000 ms and 1000–2000 ms. */
async function call2(f: World) {
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  await importTranscript(f.env, ME, s.id, [
    { speaker: 'Dana Ruiz', text: LINE, startMs: 0, endMs: 1000 },
    { speaker: 'Founder', text: SECOND, startMs: 1000, endMs: 2000 },
  ], 'zoom');
  return s.id;
}

const DIGEST = {
  overview: [
    { text: 'They reconcile invoices by hand.', cites: [{ from: 0, to: 1000 }] },
    { text: 'An uncited claim.', cites: [] },
    { text: 'A claim cited outside the transcript.', cites: [{ from: 50_000, to: 60_000 }] },
  ],
  key_quotes: [
    { quote: LINE, speaker: 'Someone Else', start_ms: 99_999, segment_id: 7777 },
    { quote: 'We never said this.' },
  ],
  decisions: [{ text: 'They will try a pilot.', cite: { from: 1000, to: 2000 } }, { text: 'Uncited decision.' }],
  next_steps: [{ text: 'Send the pricing sheet.', who: 'me', cites: [{ from: 1000, to: 2000 }] }, { text: 'Bad who.', who: 'bob', cites: [{ from: 0, to: 1000 }] }],
};

// ── 1. Every computed field is from the segments ─────────────────────────────

test('speaker, time and segment are read from the stored segments; non-verbatim quotes and uncited sentences are dropped', async () => {
  // Mutation checked: taking `speaker` from the model's quote, or skipping quoteSpan, fails here.
  const f = world({ summary: DIGEST });
  const id = await call2(f);
  const r = await call(f.env, 'POST', `/sessions/${id}/summarise`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = digestOf(f.db, id);
  const seg = f.db.prepare("SELECT id FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY id").all(id);
  assert.deepEqual(d.overview.map((o: any) => o.text), ['They reconcile invoices by hand.']);
  assert.deepEqual(d.key_quotes, [{ quote: LINE, speaker: 'Dana Ruiz', start_ms: 0, segment_id: seg[0].id }]);
  assert.deepEqual(d.decisions.map((x: any) => x.text), ['They will try a pilot.'], 'a single `cite` object is read too');
  assert.deepEqual(d.next_steps.map((x: any) => [x.text, x.who]), [['Send the pricing sheet.', 'me'], ['Bad who.', null]]);
  assert.deepEqual(d.overview[0].cite, { from: 0, to: 1000, quote: LINE });
  assert.equal(d.v, 1);
  assert.equal(d.kind, 'video');
  assert.equal(d.source, 'zoom');
  assert.match(d.hash, /^[0-9a-f]{64}$/);
  assert.equal(d.parts, 1);
  // 7. summary and its citations are still written, from the overview.
  assert.equal(row(f.db, id).summary, 'They reconcile invoices by hand.');
  assert.deepEqual(JSON.parse(row(f.db, id).summary_citations_json).map((s: any) => s.text), ['They reconcile invoices by hand.']);
  assert.equal(r.body.summary.text, 'They reconcile invoices by hand.');
});

test('checkDigest reads the older { sentences } reply as the overview', () => {
  const segs = [{ start: 0, end: 1000, speaker: 'A', text: LINE }];
  const out = checkDigest(JSON.stringify({ sentences: [{ text: 'Old shape.', cites: [{ from: 0, to: 1000 }] }] }), segs);
  assert.deepEqual(out.overview.map((o) => o.text), ['Old shape.']);
});

// ── 2. Thread mode ───────────────────────────────────────────────────────────

test('a chat session is summarised as notes over days, with Me and the interviewee as speakers and message-time cites', async () => {
  // Mutation checked: always passing mode 'call' sends the interview prompt.
  const f = world({ summary: { overview: [{ text: 'Dana does it by hand.', cites: [{ from: 0, to: 1000 }] }], key_quotes: [{ quote: 'How do you invoice?' }, { quote: LINE }] } });
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'telegram', 'text');
  await appendSegments(f.env, ME, s.id, [
    { start_ms: null, end_ms: null, speaker_raw: null, speaker_label: 'Me', text: 'How do you invoice?' },
    { start_ms: null, end_ms: null, speaker_raw: null, speaker_label: 'Dana Ruiz', text: LINE },
  ], 'telegram');
  assert.equal((await digestSession(f.env, { sessionId: s.id, userId: ME, trigger: 'chat_quiet', stages: ['summarise'] })).status, 'done');
  const prompt = f.ai.find((a) => a.task === 'summary')!.prompt;
  assert.match(prompt, /chat messages over days/);
  assert.match(prompt, /\\"Me\\" is the founder/);
  const d = digestOf(f.db, s.id);
  assert.equal(d.kind, 'text');
  assert.deepEqual(d.key_quotes.map((q: any) => [q.speaker, q.start_ms]), [['Me', 0], ['Dana Ruiz', 1000]]);
  assert.deepEqual(d.overview[0].cite.quote, 'How do you invoice?');
});

// ── 3. Parts ─────────────────────────────────────────────────────────────────

const many = (k: number) => Array.from({ length: k }, (_, i) => ({ speaker: 'Dana Ruiz', text: `${i} ${'word '.repeat(400)}`, startMs: i * 1000, endMs: i * 1000 + 999 }));
const sixPerPart = { overview: Array.from({ length: 6 }, (_, i) => ({ text: `Point ${i}.`, cites: [{ from: 0, to: 10_000_000 }] })) };

test('a transcript over 100 KB is summarised in parts, at most five overview sentences each and twelve in all', async () => {
  // Mutation checked: dropping the per-part cap, or the overall cap, fails the counts.
  const f = world({ summary: sixPerPart });
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  await importTranscript(f.env, ME, s.id, many(60), 'zoom');
  const bytes = n(f.db, "SELECT SUM(LENGTH(text)) n FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'", s.id);
  assert.ok(bytes > 100 * 1024, `fixture is ${bytes} bytes`);
  const out: any = await digestSession(f.env, { sessionId: s.id, userId: ME, trigger: 'call_imported' });
  const parts = f.ai.filter((a) => a.task === 'summary').length;
  assert.ok(parts >= 3 && parts <= MAX_DIGEST_PARTS, `${parts} parts`);
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_summary_receipts WHERE session_id = ?', s.id), parts, 'one receipt line per part');
  const d = digestOf(f.db, s.id);
  assert.equal(d.parts, parts);
  assert.equal(d.overview.length, Math.min(MAX_DIGEST_OVERVIEW, parts * 5));
  // The structure pass still stops at 100 KB: the summary stands, and the note says so (D7).
  assert.deepEqual([out.status, out.reason, out.note], ['refused', 'transcript_too_large', NOTES.tooLargeToStructure]);
});

test('two parts keep five overview sentences each: the per-part cap, under the overall one', async () => {
  // Mutation checked: dropping the per-part slice keeps all twelve.
  const f = world({ summary: sixPerPart });
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  await importTranscript(f.env, ME, s.id, many(20), 'zoom');
  await digestSession(f.env, { sessionId: s.id, userId: ME, trigger: 'call_imported', stages: ['summarise'] });
  assert.equal(f.ai.filter((a) => a.task === 'summary').length, 2);
  assert.equal(digestOf(f.db, s.id).overview.length, 10);
});

test('a transcript over the parts bound is refused with #1898\'s note, and no call is made', async () => {
  const f = world({ summary: sixPerPart });
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  await importTranscript(f.env, ME, s.id, many(140), 'zoom');
  const out: any = await digestSession(f.env, { sessionId: s.id, userId: ME, trigger: 'call_imported' });
  assert.deepEqual([out.status, out.reason, out.note], ['refused', 'transcript_too_large', NOTES.tooLarge]);
  assert.equal(f.ai.length, 0);
  assert.equal(row(f.db, s.id).digest_json, null);
});

// ── 4. The read ──────────────────────────────────────────────────────────────

const PLACEMENTS = { placements: [
  { kind: 'pain_severity', payload: { phrase: 'Manual reconciliation', severity: 'severe' }, cite: { from: 0, to: 1000 }, quote: LINE },
  { kind: 'competitor_mention', payload: { name: 'Xero' }, cite: { from: 0, to: 1000 }, quote: LINE },
  { kind: 'demand_signal', payload: { signal: 'would_pay' }, cite: { from: 1000, to: 2000 }, quote: SECOND },
] };

test('a writer reads the draft, its sections grouped from the same run\'s proposals', async () => {
  // Mutation checked: grouping without the run id pulls in another run's pain.
  const f = world({ summary: DIGEST, structure: PLACEMENTS });
  const id = await call2(f);
  f.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, created_by, session_id, run_id, target_ref, status)
                VALUES (?, 'pain_severity', '{"phrase":"Old run pain","severity":"real"}', ?, ?, 'old-run', ?, 'pending')`).run(PROJECT, ME, id, `interview:${INTERVIEW}`);
  assert.equal((await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' })).status, 'done');
  const r = await call(f.env, 'GET', `/sessions/${id}`);
  assert.equal(r.status, 200);
  const d = r.body.digest;
  assert.equal(d.kept, false);
  assert.equal(d.model, row(f.db, id).summary_model);
  assert.deepEqual(d.sections.pain_points.map((p: any) => p.payload.phrase), ['Manual reconciliation']);
  assert.deepEqual(d.sections.competitors.map((p: any) => p.payload.name), ['Xero']);
  assert.deepEqual(d.sections.willingness_to_pay.map((p: any) => p.payload.signal), ['would_pay']);
  assert.deepEqual(Object.keys(d.sections).sort(), ['competitors', 'jobs_to_be_done', 'next_steps', 'objections', 'pain_points', 'willingness_to_pay']);
  assert.equal(digestOf(f.db, id).run_id, row(f.db, id).digest_run_id, 'the engine names the run beside the digest');
  assert.equal(d.key_quotes[0].quote, LINE, 'a writer reads the quote');
});

test('a reader who is not a writer sees nothing until Keep, then the kept digest, with quotes behind the quote gate', async () => {
  // Mutation checked: letting a non-writer read the draft, or skipping the quote gate, fails here.
  const f = world({ summary: DIGEST, structure: PLACEMENTS });
  const id = await call2(f);
  await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' });
  const reader = () => sessionDigest(f.env, row(f.db, id), { writer: false, quoteConsent: false });
  assert.equal(await reader(), null);
  assert.equal((await call(f.env, 'POST', `/sessions/${id}/digest/keep`, {})).status, 200);
  const kept: any = await reader();
  assert.equal(kept.kept, true);
  assert.deepEqual(kept.key_quotes.map((q: any) => q.quote), [QUOTE_WITHHELD]);
  assert.ok(kept.sections.pain_points.every((p: any) => p.quote === QUOTE_WITHHELD));
  const consented: any = await sessionDigest(f.env, row(f.db, id), { writer: false, quoteConsent: true });
  assert.deepEqual(consented.key_quotes.map((q: any) => q.quote), [LINE]);
  // The session route itself is writers only: a partner gets 404, never the draft.
  assert.equal((await call(f.env, 'GET', `/sessions/${id}`, undefined, PARTNER)).status, 404);
});

// ── 5. Keep and Edit ─────────────────────────────────────────────────────────

test('Keep stamps who and when; an edit may remove a quote but never rewrite one; a new run clears Keep; a non-writer gets 404', async () => {
  // Mutation checked: accepting a quote not in the digest, or not clearing digest_kept_at on a new run, fails here.
  const f = world({ summary: { ...DIGEST, key_quotes: [{ quote: LINE }, { quote: SECOND }] } });
  const id = await call2(f);
  await call(f.env, 'POST', `/sessions/${id}/summarise`, {});
  assert.equal(digestOf(f.db, id).key_quotes.length, 2);
  const k = await call(f.env, 'POST', `/sessions/${id}/digest/keep`, {});
  assert.equal(k.status, 200);
  assert.deepEqual([row(f.db, id).digest_kept_by, !!row(f.db, id).digest_kept_at, k.body.digest.kept], [ME, true, true]);
  const log = f.db.prepare("SELECT action, entity_type, entity_id FROM activity_logs WHERE action LIKE 'interview_digest_%'").all();
  assert.deepEqual(log.map((l: any) => ({ ...l })), [{ action: 'interview_digest_kept', entity_type: 'validate.customer-research', entity_id: String(INTERVIEW) }]);

  const rewrite = await call(f.env, 'PATCH', `/sessions/${id}/digest`, { key_quotes: [`${LINE} Honestly.`] });
  assert.deepEqual([rewrite.status, rewrite.body.error], [400, 'quote_rewrite_refused']);
  assert.equal(digestOf(f.db, id).key_quotes.length, 2, 'nothing saved');

  const edit = await call(f.env, 'PATCH', `/sessions/${id}/digest`, {
    key_quotes: [SECOND],
    overview: [{ index: 0, text: 'They reconcile every invoice by hand.' }],
    next_steps: [{ index: 0, text: 'Send pricing by Monday.', who: 'me' }, { text: 'Book a follow-up.', who: 'them' }],
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const d = digestOf(f.db, id);
  assert.deepEqual(d.key_quotes.map((q: any) => q.quote), [SECOND]);
  assert.deepEqual(d.overview.map((o: any) => [o.text, o.cite.from]), [['They reconcile every invoice by hand.', 0]]);
  assert.deepEqual(d.next_steps.map((x: any) => [x.text, x.who]), [['Send pricing by Monday.', 'me'], ['Book a follow-up.', 'them']]);
  assert.equal(row(f.db, id).summary, 'They reconcile every invoice by hand.', 'summary follows the kept overview');
  assert.deepEqual(JSON.parse(row(f.db, id).summary_citations_json).map((x: any) => [x.text, x.cites[0].from]), [['They reconcile every invoice by hand.', 0]]);
  assert.equal((await call(f.env, 'PATCH', `/sessions/${id}/digest`, { overview: [{ index: 9, text: 'x' }] })).status, 400);

  for (const [method, path] of [['POST', `/sessions/${id}/digest/keep`], ['PATCH', `/sessions/${id}/digest`]] as const) {
    assert.equal((await call(f.env, method, path, {}, PARTNER)).status, 404, `${method} for a non-writer`);
  }
  assert.ok(row(f.db, id).digest_kept_at);
  await call(f.env, 'POST', `/sessions/${id}/summarise`, {});
  assert.deepEqual([row(f.db, id).digest_kept_at, row(f.db, id).digest_kept_by], [null, null], 'a new draft must be kept again');
});

test('Keep and Edit with no summary yet are refused', async () => {
  const f = world({ summary: DIGEST });
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  assert.deepEqual([(await call(f.env, 'POST', `/sessions/${s.id}/digest/keep`, {})).body.error], ['no_digest']);
  assert.equal((await call(f.env, 'PATCH', `/sessions/${s.id}/digest`, {})).status, 409);
});

// ── 6. The record's Summary section ──────────────────────────────────────────

test('the Customer research record shows the draft to writers, labelled, and only a kept summary to other readers', async () => {
  // Mutation checked: dropping the Draft label, or `writer` → true for every reader, fails here.
  const f = world({ summary: DIGEST });
  const read = async (user: any) => {
    const spec = VALIDATE_SPECS['customer-research'];
    const section = spec.sections.find((x: any) => x.key === 'summary')!;
    return section.read({ env: f.env, projectId: PROJECT, project: { id: PROJECT, founder_id: FOUNDER } as any, user } as any, String(INTERVIEW));
  };
  const writer = { id: ME, role: 'founder', founder_id: FOUNDER };
  const partner = { id: PARTNER, role: 'partner', founder_id: null };
  assert.deepEqual(await read(writer), { rows: [], empty: 'No session recorded.' });
  const id = await call2(f);
  assert.deepEqual(await read(writer), { rows: [], empty: 'No summary yet.' });
  await call(f.env, 'POST', `/sessions/${id}/summarise`, {});
  const draft: any = await read(writer);
  assert.match(draft.rows[0].a, /^Draft · written by /);
  assert.deepEqual(draft.rows.slice(1).map((r: any) => r.a), ['They reconcile invoices by hand.', `"${LINE}"`, 'They will try a pilot.', 'Send the pricing sheet.', 'Bad who.']);
  assert.equal(draft.rows[2].b, 'Dana Ruiz · 00:00:00');
  assert.deepEqual(await read(partner), { rows: [], empty: 'No summary kept yet.' });
  await call(f.env, 'POST', `/sessions/${id}/digest/keep`, {});
  const kept: any = await read(partner);
  assert.equal(kept.rows[0].a, 'They reconcile invoices by hand.', 'no Draft label once kept');
  assert.equal(kept.rows[1].a, QUOTE_WITHHELD);
});

// ── D778 part 8 (#2103): the digest's three presses name their option ───────

const PLACED = { placements: [] };
const ANSWER = { answer: 'By hand, every Friday.', cites: [{ from: 0, to: 1000 }] };
const digestRuns = (db: any) => (db.prepare(
  `SELECT task, rail_page, rail_option, record_ref FROM ai_usage_logs
    WHERE task IN ('summarise_interview', 'structure_interview') AND guard_for IS NULL ORDER BY id`,
).all() as any[]).map((r) => ({ ...r }));

async function press(env: any, path: string, body: unknown, headers: Record<string, string> = {}) {
  const tok = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D778 part 8: the three digest options are the founder inventory\'s, on Customer research; the run page is the switch\'s section', async () => {
  const { DIGEST_OPTIONS, DIGEST_PAGE } = await import('../src/services/interviewProcessing.ts');
  const { VALIDATE_SECTION } = await import('../src/services/validateEngine.ts');
  const { FOUNDER_OPTIONS } = await import('../../frontend/src/lib/railOptions/founder.js');
  for (const key of Object.values(DIGEST_OPTIONS)) {
    const rows = FOUNDER_OPTIONS.filter((o: any) => o.key === key);
    assert.equal(rows.length, 1, key);
    assert.equal(rows[0].page, 'Founder · Validate · Customer research', key);
  }
  // Mutation checked: naming the inventory's label here runs a press the founder switched off (below).
  assert.equal(DIGEST_PAGE, VALIDATE_SECTION);
});

test('D778 part 8: with no rail mounted, Summarise, Structure and Ask each log validate, their own option and the session', async () => {
  // Mutations checked: each route's old fallback (summarise:interview, place:interview), a fixed context
  // instead of railFor, the stage rail not reaching summariseSession or structureSession, and the browser's record winning.
  const f = world({ summary: DIGEST, structure: PLACED });
  const id = await call2(f);
  const record = `session:${id}`;
  const rec = { 'X-Rail-Record': 'project:999' };
  assert.equal((await press(f.env, `/sessions/${id}/summarise`, {}, rec)).status, 201);
  assert.equal((await press(f.env, `/sessions/${id}/structure`, {}, rec)).status, 201);
  f.env.AI.run = async (model: string) => (/guard/.test(model) ? { response: 'safe' } : { response: JSON.stringify(ANSWER) });
  const asked = await press(f.env, `/sessions/${id}/ask`, { question: 'How do they reconcile?' }, rec);
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  const runs = digestRuns(f.db);
  const byOption = (o: string) => runs.filter((r) => r.rail_option === o);
  assert.deepEqual(byOption('summarise:session').map((r) => [r.task, r.rail_page, r.record_ref]), [['summarise_interview', 'validate', record]]);
  assert.ok(byOption('structure:transcript').length >= 1);
  for (const r of byOption('structure:transcript')) assert.deepEqual([r.task, r.rail_page, r.record_ref], ['structure_interview', 'validate', record]);
  assert.deepEqual(byOption('ask:transcript').map((r) => [r.task, r.rail_page, r.record_ref]), [['structure_interview', 'validate', record]]);
  assert.equal(runs.length, byOption('summarise:session').length + byOption('structure:transcript').length + 1, 'no run names another key');
});

test('D778 part 8: a mounted rail\'s page and the press\'s option win on all three', async () => {
  const f = world({ summary: DIGEST, structure: PLACED });
  const id = await call2(f);
  const h = (option: string) => ({ 'X-Rail-Page': 'Validate', 'X-Rail-Option': option });
  assert.equal((await press(f.env, `/sessions/${id}/summarise`, {}, h('summarise:session'))).status, 201);
  assert.equal((await press(f.env, `/sessions/${id}/structure`, {}, h('structure:transcript'))).status, 201);
  f.env.AI.run = async (model: string) => (/guard/.test(model) ? { response: 'safe' } : { response: JSON.stringify(ANSWER) });
  assert.equal((await press(f.env, `/sessions/${id}/ask`, { question: 'How?' }, h('ask:transcript'))).status, 200);
  const runs = digestRuns(f.db);
  assert.ok(runs.length >= 3);
  for (const r of runs) assert.equal(r.rail_page, 'Validate');
  assert.deepEqual([...new Set(runs.map((r) => r.rail_option))].sort(), ['ask:transcript', 'structure:transcript', 'summarise:session']);
});

test('D778 part 8: the Validate switch still refuses all three presses with no rail mounted, and nothing runs or is charged', async () => {
  // The session page mounts no rail, so its presses use the fallback page.
  // Mutation checked: DIGEST_PAGE set to the inventory label lets all three run here.
  const f = world({ summary: DIGEST, structure: PLACED });
  const id = await call2(f);
  f.db.prepare("INSERT INTO ai_rail_preferences(uid, user_id, section, task, mode) VALUES ('off-d778', ?, 'validate', '', 'manual')").run(ME);
  for (const [path, body] of [['summarise', {}], ['structure', {}], ['ask', { question: 'How?' }]] as const) {
    const r = await press(f.env, `/sessions/${id}/${path}`, body);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.refusal, 'assist_off', path);
  }
  assert.equal(f.ai.length, 0, 'no model ran');
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM ai_usage_logs WHERE task IN ('summarise_interview', 'structure_interview') AND COALESCE(charged_microusd, 0) > 0"), 0);
});

test('D778 part 8: a Summarise keeps its digest a draft, and a Structure only proposes: nothing lands on the interview before Keep or Accept', async () => {
  const f = world({ summary: DIGEST, structure: PLACED });
  const id = await call2(f);
  const before = { ...f.db.prepare('SELECT * FROM discovery_interviews WHERE id = ?').get(INTERVIEW) };
  assert.equal((await press(f.env, `/sessions/${id}/summarise`, {})).status, 201);
  assert.equal((await press(f.env, `/sessions/${id}/structure`, {})).status, 201);
  assert.equal(row(f.db, id).digest_kept_at, null, 'the digest waits for Keep');
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM discovery_interviews WHERE id = ?').get(INTERVIEW) }, before, 'the interview record is unchanged');
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ? AND status <> 'proposed'", id), 0, 'nothing accepted');
});
