/**
 * D757 (#1898) — the Validate engine's one entry (src/services/validateEngine.ts).
 *
 * Real SQLite: the D640 budget fixture, the interview, channel and proposal
 * migrations, then 465 and 487 (`applyEngineSchema`). Workers AI is an
 * in-memory stand-in that counts its calls; no Zoom, Google, Meta or Telegram
 * endpoint is called (meeting imports go through `importMeetingRef` with a stub
 * fetcher). Each case names the mutation it was checked against.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/validate_engine_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import sessionsRoutes from '../src/routes/founder_validate_sessions.ts';
import structureRoutes from '../src/routes/founder_validate_structure.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { assignThread, listThreads, storeMessage, type ThreadMessageInput } from '../src/services/channels/threads.ts';
import { connectionForTelegram } from '../src/services/channels/connections.ts';
import { importMeetingRef } from '../src/services/channels/meetings.ts';
import { IntakeError, appendSegments, importTranscript, openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { JOB_TRIGGERS, runSessionStructureJob, sweepQuietChats } from '../src/services/sessionAutoStructure.ts';
import { NOTES, digestSession, transcriptHash } from '../src/services/validateEngine.ts';
import { FREE_TIER_LIMITS } from '../src/middleware/requireTier.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ME = 2, ADMIN = 1, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101, SECOND = 102;
const TG_INT = 11;
const SURFACE = '/validate/customer-research';
// Both the call and the thread prompt (#1924) open with these words.
const SUMMARY_MARK = 'Summarise one customer';

const PAIN = (phrase = 'Manual invoice reconciliation') => JSON.stringify({ placements: [
  { kind: 'pain_severity', payload: { phrase, severity: 'severe' }, cite: { from: 0, to: 1000 }, quote: 'We reconcile invoices by hand every Friday.' },
] });
const SUMMARY = JSON.stringify({ sentences: [{ text: 'They reconcile invoices by hand.', cites: [{ from: 0, to: 100_000_000 }] }] });

function world() {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Not mine', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz'), (${SECOND}, ${PROJECT}, 'Sam Lee');
    CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL, claim TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, retired_at TEXT);
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', auth_type TEXT, credentials_enc TEXT, config_json TEXT,
      external_account_id TEXT, external_account_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, external_account_id) VALUES
      (${TG_INT}, 'tg-me', ${ME}, 'telegram', 'webhook', '555001');
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
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    // D754 (#1893): the consent store, which assign and the voice job now read.
    '488_channel_consents.sql']) db.exec(mig(m));
  applyEngineSchema(db);
  db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
           VALUES ('bc-1', 'BC-ME', '555001', ${ME}, 1, 1)`);
  const ai: { model: string; task: 'summary' | 'structure' }[] = [];
  let structureReply = PAIN();
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    AI: {
      run: async (model: string, input: unknown) => {
        if (/guard/.test(model)) return { response: 'safe' };
        const task = JSON.stringify(input).includes(SUMMARY_MARK) ? 'summary' : 'structure';
        ai.push({ model, task });
        return { response: task === 'summary' ? SUMMARY : structureReply };
      },
    },
  };
  return { env, db, ai, setStructure: (r: string) => { structureReply = r; } };
}
type World = ReturnType<typeof world>;

const n = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
const row = (db: any, id: number) => ({ ...db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(id) });
const summaryReceipts = (db: any, id: number) => db.prepare('SELECT step, requested_model, outcome FROM interview_summary_receipts WHERE session_id = ? ORDER BY id').all(id);
const structureRuns = (db: any, id: number) => db.prepare('SELECT DISTINCT run_id, step FROM interview_structure_receipts WHERE session_id = ? ORDER BY id').all(id);
const queued = (db: any) => db.prepare("SELECT id, payload FROM queue_jobs WHERE job_type = 'session_structure' ORDER BY id").all()
  .map((r: any) => ({ id: r.id, ...JSON.parse(r.payload) }));

/** Run every queued session_structure job not yet run, as the queue consumer would. */
async function drain(f: World, ran = new Set<number>()) {
  const outs: any[] = [];
  for (const job of queued(f.db)) {
    if (ran.has(job.id)) continue;
    ran.add(job.id);
    outs.push(await runSessionStructureJob(f.env, { session_id: job.session_id, user_id: job.user_id, trigger: job.trigger }));
  }
  return outs;
}

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
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

function msg(over: Partial<ThreadMessageInput> = {}): ThreadMessageInput {
  return {
    externalChatId: 'chat-1', externalMessageId: `m-${Math.random()}`, side: 'contact', contactName: 'Dana R.',
    text: 'We reconcile invoices by hand every Friday.', kind: 'text', sentAt: new Date().toISOString(), ...over,
  };
}

/** A Telegram chat assigned to INTERVIEW; its chat_assigned job is queued, not run. */
async function assignedChat(f: World, interviewId = INTERVIEW, chat = 'chat-1') {
  const conn = (await connectionForTelegram(f.env, 'BC-ME'))!;
  await storeMessage(f.env, conn, msg({ externalChatId: chat }));
  const t = (await listThreads(f.env, ME)).find((x: any) => x.status === 'pending')!;
  const r = await assignThread(f.env, ME, t.uid, { interviewId });
  return r.sessionId as number;
}

/** A consented Zoom call session with one imported line. */
async function importedCall(f: World, consent: { method: string } | null = { method: 'verbal' }) {
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', consent);
  await importTranscript(f.env, ME, s.id, [{ speaker: 'Dana Ruiz', text: 'We reconcile invoices by hand every Friday.', startMs: 0, endMs: 1000 }], 'zoom');
  return s.id;
}

const chatLine = (text: string) => ({ start_ms: null, end_ms: null, speaker_raw: null, speaker_label: 'Dana Ruiz', text });

// ── Every trigger, once ──────────────────────────────────────────────────────

test('a chat\'s text and the quiet sweep queue a digest on their own; the other sources queue nothing (D765); each job runs once: one summary, one structure run, done', async () => {
  // D765 (#2090), D720 §6, with the owner's exceptions (2026-10-19): a chat's
  // final text, the quiet-chat sweep and a voice note still queue the engine.
  // An import, consent and a paste store and transcribe and queue nothing; the
  // job still digests once whatever press queues it (D770), so those rows run it by hand.
  // Mutation checked: dropping a trigger from JOB_TRIGGERS fails its row here.
  assert.deepEqual([...JOB_TRIGGERS].sort(), ['assistant_submitted', 'call_imported', 'chat_assigned', 'chat_pasted', 'chat_quiet', 'chat_text_added',
    'consent_given', 'recording_processed', 'voice_note_added'], 'every trigger but manual rides the job');

  const expectOnce = (f: World, id: number, trigger: string) => {
    const s = row(f.db, id);
    assert.equal(summaryReceipts(f.db, id).length, 1, `${trigger}: one summary receipt`);
    assert.equal(structureRuns(f.db, id).length, 1, `${trigger}: one structure run`);
    assert.ok(s.summary, `${trigger}: summarised`);
    assert.equal(s.digest_status, 'done', trigger);
    assert.equal(s.digest_trigger, trigger);
  };
  const expectNothing = (f: World, id: number, trigger: string) => {
    assert.deepEqual(queued(f.db), [], `${trigger}: nothing is queued`);
    assert.equal(summaryReceipts(f.db, id).length, 0, `${trigger}: no summary`);
    assert.equal(structureRuns(f.db, id).length, 0, `${trigger}: no structure run`);
    assert.equal(f.ai.length, 0, `${trigger}: no model`);
  };

  for (const trigger of ['chat_assigned', 'chat_text_added'] as const) { // legacy and current chat jobs
    const f = world();
    const id = await assignedChat(f);
    assert.equal(f.ai.length, 0, 'assigning runs no model itself');
    await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger });
    expectOnce(f, id, trigger);
  }
  { // call_imported, through importMeetingRef with a stub fetcher
    const f = world();
    const scoped = await writableInterview(f.env, ME, INTERVIEW);
    const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
    f.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, status)
                  VALUES ('ref-1', 'zoom', '85746065432', ?, ?, ?, 'https://zoom.us/j/85746065432', 'transcript_ready')`).run(s.id, INTERVIEW, ME);
    const ref = f.db.prepare("SELECT * FROM interview_channel_refs WHERE uid = 'ref-1'").get();
    const out = await importMeetingRef(f.env, ref, async () => ({ kind: 'segments', segments: [{ speaker: 'Dana Ruiz', text: 'We reconcile invoices by hand every Friday.', startMs: 0, endMs: 1000 }] }));
    assert.equal(out.status, 'imported');
    await drain(f);
    expectNothing(f, s.id, 'call_imported');
    await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'call_imported' });
    expectOnce(f, s.id, 'call_imported');
  }
  { // chat_quiet
    const f = world();
    const scoped = await writableInterview(f.env, ME, INTERVIEW);
    const s = await openSession(f.env, scoped, 'telegram', 'text');
    await appendSegments(f.env, ME, s.id, [chatLine('We reconcile invoices by hand every Friday.')], 'telegram');
    f.db.exec(`UPDATE interview_sessions SET updated_at = datetime('now', '-2 hours') WHERE id = ${s.id}`);
    assert.equal(await sweepQuietChats(f.env, new Date()), 1);
    await drain(f);
    expectOnce(f, s.id, 'chat_quiet');
  }
  { // recording_processed, through the job
    const f = world();
    const id = await importedCall(f);
    await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'recording_processed' });
    expectOnce(f, id, 'recording_processed');
  }
  { // consent_given, through PATCH /consent
    const f = world();
    const id = await importedCall(f, null);
    const r = await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'given', method: 'verbal' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await drain(f);
    expectNothing(f, id, 'consent_given');
    await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'consent_given' });
    expectOnce(f, id, 'consent_given');
  }
  { // chat_pasted, through the setup route
    const f = world();
    const r = await call(f.env, 'POST', `/interviews/${INTERVIEW}/sessions`, {
      channel: 'text', messages: [{ author: 'Me', text: 'How do you invoice?', at_ms: 0 }, { author: 'Dana', text: 'We reconcile invoices by hand.', at_ms: 4000 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(f.ai.length, 0, 'the paste itself runs no model');
    await drain(f);
    expectNothing(f, r.body.session.id, 'chat_pasted');
    await runSessionStructureJob(f.env, { session_id: r.body.session.id, user_id: ME, trigger: 'chat_pasted' });
    expectOnce(f, r.body.session.id, 'chat_pasted');
  }
  { // manual, through the two buttons
    const f = world();
    const id = await importedCall(f);
    assert.equal((await call(f.env, 'POST', `/sessions/${id}/summarise`, {})).status, 201);
    const st = await call(f.env, 'POST', `/sessions/${id}/structure`, {});
    assert.equal(st.status, 201, JSON.stringify(st.body));
    assert.deepEqual(Object.keys(st.body).sort(), ['dropped', 'ok', 'parts', 'receipt', 'run_id', 'step', 'stored'], 'the 201 body is unchanged');
    expectOnce(f, id, 'manual');
  }
});

// ── One transcript, one automatic digest ─────────────────────────────────────

test('the same VTT imported twice bills once, and the session ends structured', async () => {
  // Mutation checked: skipping the hash comparison makes the second drain bill again (AI calls 4).
  const f = world();
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'zoom', 'video', { method: 'verbal' });
  f.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, status)
                VALUES ('ref-1', 'zoom', '85746065432', ?, ?, ?, 'https://zoom.us/j/85746065432', 'transcript_ready')`).run(s.id, INTERVIEW, ME);
  const vtt = async () => ({ kind: 'segments' as const, segments: [{ speaker: 'Dana Ruiz', text: 'We reconcile invoices by hand every Friday.', startMs: 0, endMs: 1000 }] });
  const ref = () => f.db.prepare("SELECT * FROM interview_channel_refs WHERE uid = 'ref-1'").get();
  await importMeetingRef(f.env, ref(), vtt);
  // The race the settled-ref check does not close: the ref read before the first import settled.
  f.db.exec("UPDATE interview_channel_refs SET status = 'transcript_ready' WHERE uid = 'ref-1'");
  await importMeetingRef(f.env, ref(), vtt);
  // D765 (#2090): an import queues nothing; the job is run twice by hand, as two presses would queue it.
  assert.deepEqual(queued(f.db), [], 'an import queues no digest');
  const first: any = await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'call_imported' });
  const second = await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'call_imported' });
  assert.equal(first.status, 'done');
  assert.deepEqual(second, { ok: true, status: 'unchanged' });
  // D757 (#1923): one summary call, and one structure call per pass.
  assert.equal(f.ai.length, 3, 'once per task, structure in its two passes');
  assert.equal(summaryReceipts(f.db, s.id).length, 1);
  assert.equal(structureRuns(f.db, s.id).length, 1);
  assert.equal(row(f.db, s.id).status, 'structured', 'not left transcribed for the quiet sweep');
  assert.equal(row(f.db, s.id).digest_status, 'done');
  // A re-import of the same words marks the session transcribed and the digest queued; the
  // unchanged run puts both back, so the quiet sweep never picks it again.
  // Mutation checked: skipping the early hash comparison leaves it transcribed and queued.
  const { enqueueDigest } = await import('../src/services/validateEngine.ts');
  await enqueueDigest(f.env, s.id, ME, 'call_imported');
  f.db.exec(`UPDATE interview_sessions SET status = 'transcribed' WHERE id = ${s.id}`);
  assert.deepEqual(await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'call_imported' }), { ok: true, status: 'unchanged' });
  assert.deepEqual([row(f.db, s.id).status, row(f.db, s.id).digest_status], ['structured', 'done']);
  assert.equal(f.ai.length, 3);
});

test('a button always runs (re_summarised, re_structured), and never moves the automatic hash', async () => {
  const f = world();
  const id = await importedCall(f);
  await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
  const hash = row(f.db, id).digest_hash;
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal((await call(f.env, 'POST', `/sessions/${id}/summarise`, {})).status, 201);
  assert.equal((await call(f.env, 'POST', `/sessions/${id}/structure`, {})).status, 201);
  assert.deepEqual(summaryReceipts(f.db, id).map((r: any) => r.step), ['summarised', 're_summarised']);
  assert.deepEqual(structureRuns(f.db, id).map((r: any) => r.step), ['structured', 're_structured']);
  assert.equal(row(f.db, id).digest_hash, hash, 'a forced run never writes the hash');
});

test('a changed transcript runs again', async () => {
  const f = world();
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'telegram', 'text');
  await appendSegments(f.env, ME, s.id, [chatLine('We reconcile invoices by hand every Friday.')], 'telegram');
  await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'chat_quiet' });
  const before = row(f.db, s.id).digest_hash;
  await appendSegments(f.env, ME, s.id, [chatLine('It takes the whole afternoon.')], 'telegram');
  const out = await runSessionStructureJob(f.env, { session_id: s.id, user_id: ME, trigger: 'chat_quiet' });
  assert.equal(out?.status, 'done');
  assert.notEqual(row(f.db, s.id).digest_hash, before);
  assert.deepEqual(summaryReceipts(f.db, s.id).map((r: any) => r.step), ['summarised', 're_summarised']);
});

test('transcriptHash is sha256 hex over start|end|speaker|text lines, order-sensitive', async () => {
  const a = { start: 0, end: 1000, speaker: 'A', text: 'one' }, b = { start: 1000, end: 2000, speaker: null, text: 'two' };
  const h = await transcriptHash([a, b]);
  const want = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('0|1000|A|one\n1000|2000||two'))))
    .map((x) => x.toString(16).padStart(2, '0')).join('');
  assert.equal(h, want);
  assert.notEqual(await transcriptHash([b, a]), h);
});

// ── The member's mode and model ──────────────────────────────────────────────

const setMode = (db: any, mode: string) => db.prepare(
  "INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES (?, ?, 'validate', '', ?)").run(crypto.randomUUID(), ME, mode);
const setPick = (db: any, task: string, model: string) => db.prepare(
  "INSERT INTO ai_rail_preferences (uid, user_id, section, task, model) VALUES (?, ?, 'validate', ?, ?)").run(crypto.randomUUID(), ME, task, model);

test('Manual mode stops automatic runs, with its sentence; Eadwyn or no row runs; since D765 the buttons and the recorder\'s summary obey it too', async () => {
  // Mutation checked: ignoring the manual row lets call_imported bill.
  for (const trigger of ['call_imported', 'chat_assigned'] as const) {
    const f = world();
    setMode(f.db, 'manual');
    const id = trigger === 'call_imported' ? await importedCall(f) : await assignedChat(f);
    const out = await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger });
    assert.deepEqual(out, { ok: false, status: 'skipped', reason: 'manual_mode', note: NOTES.manual });
    assert.equal(f.ai.length, 0, `${trigger}: no model`);
    assert.equal(row(f.db, id).digest_status, 'skipped');
    assert.equal(row(f.db, id).digest_note, NOTES.manual);
    // D765 (#2090), D720 §6: the mode row is the page's AI switch, enforced in
    // run(). Summarising and placing are assistance, so the founder's buttons
    // and the recorder's own summary are refused assist_off, and no model runs.
    for (const step of ['summarise', 'structure']) {
      const res = await call(f.env, 'POST', `/sessions/${id}/${step}`, {});
      assert.equal(res.status, 403, step);
      assert.deepEqual(res.body, { ok: false, refusal: 'assist_off', message: 'AI assistance is off on this page.' });
    }
    const recorded = await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'recording_processed' });
    assert.equal(recorded.status, 'refused');
    assert.equal((recorded as any).refusal, 'assist_off');
    assert.equal(f.ai.length, 0, `${trigger}: still no model`);
  }
  for (const mode of [null, 'eadwyn']) {
    const f = world();
    if (mode) setMode(f.db, mode);
    const id = await importedCall(f);
    assert.equal((await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' }))?.status, 'done', String(mode));
  }
});

test('a stored model pick runs on automatic runs; a pick no longer offered runs the default and says so', async () => {
  // Mutation checked: passing no model to summariseSession leaves requested_model null.
  const PICK = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
  {
    const f = world();
    setPick(f.db, 'summarise_interview', PICK);
    const id = await importedCall(f);
    const out: any = await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
    assert.equal(out.status, 'done');
    assert.equal(summaryReceipts(f.db, id)[0].requested_model, PICK);
    assert.equal(row(f.db, id).digest_note, null);
  }
  {
    const f = world();
    setPick(f.db, 'summarise_interview', '@cf/retired/model-x');
    const id = await importedCall(f);
    await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
    assert.equal(summaryReceipts(f.db, id)[0].requested_model, null, 'the default ran');
    assert.equal(row(f.db, id).digest_note, NOTES.modelDropped);
  }
});

// ── Consent ──────────────────────────────────────────────────────────────────

test('an audio session without consent runs nothing; a text session is not gated', async () => {
  // Mutation checked: removing the consentBlocks step bills the video session.
  const f = world();
  const id = await importedCall(f, null);
  const out = await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' });
  assert.equal(out.status, 'refused');
  assert.equal((out as any).reason, 'consent_not_recorded');
  assert.equal((out as any).note, 'Record the interviewee’s consent to be recorded before you start.');
  assert.equal(f.ai.length, 0);
  const chat = await assignedChat(f);
  assert.equal(row(f.db, chat).consent_status, 'not_recorded');
  assert.equal((await digestSession(f.env, { sessionId: chat, userId: ME, trigger: 'chat_assigned' })).status, 'done');
});

test('after a recording, consent takes exactly two changes; recording stays locked', async () => {
  // Mutation checked: allowing any change after recording passes given → not_recorded.
  const f = world();
  const id = await importedCall(f);
  assert.equal(row(f.db, id).status, 'transcribed');
  assert.equal((await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'not_recorded' })).status, 409, 'given → not_recorded');
  assert.equal((await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'declined' })).status, 200, 'withdrawal');
  const back = await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'given', method: 'verbal' });
  assert.deepEqual([back.status, back.body.detail], [409, 'consent_locked'], 'declined stays declined');
  f.db.exec(`UPDATE interview_sessions SET status = 'recording' WHERE id = ${id}`);
  assert.equal((await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'declined' })).status, 409, 'recording stays locked');
});

test('a withdrawal clears the summary, the digest and the pending suggestions; decisions stay, without the quote', async () => {
  // Mutation checked: dropping the pending DELETE from withdrawDigest leaves two pending rows.
  const f = world();
  f.setStructure(JSON.stringify({ placements: [
    { kind: 'pain_severity', payload: { phrase: 'Manual reconciliation', severity: 'severe' }, cite: { from: 0, to: 1000 }, quote: 'We reconcile invoices by hand every Friday.' },
    { kind: 'competitor_mention', payload: { name: 'Xero' }, cite: { from: 0, to: 1000 }, quote: 'We reconcile invoices by hand every Friday.' },
    { kind: 'demand_signal', payload: { signal: 'workaround' }, cite: { from: 0, to: 1000 }, quote: 'We reconcile invoices by hand every Friday.' },
  ] }));
  const id = await importedCall(f);
  await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
  const props = f.db.prepare('SELECT id, kind FROM validate_proposals WHERE session_id = ? ORDER BY id').all(id);
  assert.ok(props.length >= 2, `proposals stored: ${props.length}`);
  const pain = props.find((p: any) => p.kind === 'pain_severity');
  const acc = await call(f.env, 'POST', `/placements/${pain.id}/accept`, {});
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const severities = n(f.db, 'SELECT COUNT(*) n FROM interview_pain_severities');
  assert.equal(severities, 1, 'Accept wrote the module row');
  const pendingBefore = n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ? AND status = 'pending'", id);

  assert.equal((await call(f.env, 'PATCH', `/sessions/${id}/consent`, { status: 'declined' })).status, 200);
  const s = row(f.db, id);
  assert.deepEqual([s.summary, s.summary_citations_json, s.digest_json, s.digest_hash], [null, null, null, null]);
  assert.deepEqual([s.digest_status, s.digest_note], ['skipped', NOTES.withdrawn]);
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ? AND status = 'pending'", id), 0);
  const kept = f.db.prepare('SELECT status, citation_json FROM validate_proposals WHERE id = ?').get(pain.id);
  assert.deepEqual({ ...kept }, { status: 'accepted', citation_json: null });
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM interview_pain_severities'), severities, 'the module row is untouched');
  const log = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'interview_consent_withdrawn'").all();
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0].details), { session_uid: s.uid, pending_deleted: pendingBefore, decided_unquoted: 1 }, 'counts only, no text');

  const calls = f.ai.length;
  for (const trigger of ['chat_quiet', 'consent_given'] as const) await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger });
  assert.equal(f.ai.length, calls, 'a later trigger runs nothing');
  assert.equal(row(f.db, id).digest_note, NOTES.withdrawn, 'the withdrawal still says why');
});

// ── Bounded re-runs, no repeated suggestions ─────────────────────────────────

test('the quiet sweep counts summary receipts and the engine\'s own last attempt', async () => {
  // Mutation checked: removing either NOT EXISTS / digested_at clause sweeps that session.
  const f = world();
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const summarised = await openSession(f.env, scoped, 'telegram', 'text');
  const attempted = await openSession(f.env, scoped, 'telegram', 'text');
  const old = await openSession(f.env, scoped, 'whatsapp', 'text');
  f.db.exec(`UPDATE interview_sessions SET status = 'transcribed', updated_at = datetime('now', '-2 hours')`);
  f.db.exec(`INSERT INTO interview_summary_receipts (session_id, step, model, prompt_tokens, completion_tokens, cost_microusd, outcome, created_at)
             VALUES (${summarised.id}, 'summarised', 'm', 0, 0, 0, 'ok', datetime('now', '-1 hour')),
                    (${old.id}, 'summarised', 'm', 0, 0, 0, 'ok', datetime('now', '-7 hours'))`);
  f.db.exec(`UPDATE interview_sessions SET digested_at = datetime('now', '-1 hour'), digest_status = 'refused' WHERE id = ${attempted.id}`);
  // D754 (#1893): a WhatsApp chat is swept only once its consent is given.
  f.db.exec(`UPDATE interview_sessions SET digested_at = datetime('now', '-7 hours'), consent_status = 'given' WHERE id = ${old.id}`);
  assert.equal(await sweepQuietChats(f.env, new Date()), 1);
  assert.deepEqual(queued(f.db).map((q: any) => q.session_id), [old.id]);
});

test('an automatic run never re-proposes a finding already decided or proposed on the interview; a button does', async () => {
  // Mutation checked: dropping `dedupe: !force` stores the discarded pain again.
  const f = world();
  const id = await assignedChat(f);
  await drain(f);
  const first = f.db.prepare("SELECT id FROM validate_proposals WHERE session_id = ? AND kind = 'pain_severity'").all(id);
  assert.equal(first.length, 1);
  assert.equal((await call(f.env, 'POST', `/placements/${first[0].id}/discard`, {})).status, 200);
  await appendSegments(f.env, ME, id, [chatLine('Still by hand, every Friday.')], 'telegram');
  const out: any = await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'chat_quiet' });
  assert.equal(out.status, 'done');
  assert.equal(out.structure.stored, 0, 'the discarded pain is not proposed again');
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ? AND kind = 'pain_severity'", id), 1);
  // An assistant's proposal on the interview counts as already proposed too.
  f.db.exec(`UPDATE validate_proposals SET source = 'assistant', status = 'accepted' WHERE id = ${first[0].id}`);
  await appendSegments(f.env, ME, id, [chatLine('Yes, still.')], 'telegram');
  assert.equal(((await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'chat_quiet' })) as any).structure.stored, 0);
  // A founder's Structure keeps every placement, so Compare still works.
  const manual = await call(f.env, 'POST', `/sessions/${id}/structure`, {});
  assert.equal(manual.body.stored, 1);
  // Two interviews never dedupe each other.
  const other = await assignedChat(f, SECOND, 'chat-2');
  await drain(f);
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ? AND kind = 'pain_severity'", other), 1);
});

// ── Refusals, the recorder and the assistant ─────────────────────────────────

test('a conversation too long for one run is refused with the engine\'s sentence, no receipt and no charge', async () => {
  const f = world();
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, 'telegram', 'text');
  // Over the summary's parts bound (#1924: MAX_DIGEST_PARTS of 24 000 characters), so nothing runs at all.
  await appendSegments(f.env, ME, s.id, Array.from({ length: 150 }, (_, i) => chatLine(`${i} ${'x'.repeat(2000)}`)), 'telegram');
  const out: any = await digestSession(f.env, { sessionId: s.id, userId: ME, trigger: 'chat_quiet' });
  assert.deepEqual([out.status, out.reason, out.note], ['refused', 'transcript_too_large', NOTES.tooLarge]);
  assert.equal(f.ai.length, 0);
  assert.equal(summaryReceipts(f.db, s.id).length + structureRuns(f.db, s.id).length, 0);
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM ai_usage_logs'), 0, 'nothing charged');
  assert.deepEqual([row(f.db, s.id).digest_status, row(f.db, s.id).digest_note], ['refused', NOTES.tooLarge]);
  assert.ok(row(f.db, s.id).digested_at, 'the attempt bounds the quiet sweep');
});

test('a spent budget is refused with the router\'s sentence, and the transcript is kept', async () => {
  const f = world();
  for (const key of ['founder:free', 'other']) {
    f.db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, 0, 0, 1)').run(key);
  }
  const id = await importedCall(f);
  const out: any = await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' });
  assert.equal(out.status, 'refused');
  assert.match(out.refusal, /^budget_/);
  assert.ok(out.note.endsWith(NOTES.budgetTail), out.note);
  assert.equal(row(f.db, id).digest_hash, null, 'a refused run never records the hash');
});

test('the recorder\'s two calls: summarise leaves the placing stage due; a resumed run over the same transcript calls no model', async () => {
  const f = world();
  const id = await importedCall(f);
  const a = await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'recording_processed', stages: ['summarise'] });
  assert.equal(a.status, 'done');
  assert.deepEqual([row(f.db, id).digest_status, row(f.db, id).digest_hash], ['queued', null]);
  await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'recording_processed', stages: ['structure'] });
  assert.equal(row(f.db, id).digest_status, 'done');
  const calls = f.ai.length;
  assert.deepEqual(await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'recording_processed', stages: ['summarise'] }), { ok: true, status: 'unchanged' });
  assert.equal(f.ai.length, calls);
  const src = readFileSync(new URL('../src/services/interviewProcessing.ts', import.meta.url), 'utf8');
  assert.match(src, /trigger: 'recording_processed', stages: \['summarise'\]/);
  assert.match(src, /trigger: 'recording_processed', stages: \['structure'\]/);
  assert.match(src, /'The findings could not be placed\. The transcript is ready; try Structure again\.'/);
});

test('an assistant\'s submission gets StudioOS\'s summary only, never a second set of placements', async () => {
  // Mutation checked: running both stages for assistant_submitted stores StudioOS proposals.
  const f = world();
  const id = await importedCall(f);
  f.db.exec(`UPDATE interview_sessions SET submitted_summary = 'Their own words.' WHERE id = ${id}`);
  await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'assistant_submitted' });
  assert.ok(row(f.db, id).summary);
  assert.equal(summaryReceipts(f.db, id).length, 1);
  assert.equal(structureRuns(f.db, id).length, 0);
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ?', id), 0);
  assert.equal(row(f.db, id).submitted_summary, 'Their own words.');
  const src = readFileSync(new URL('../src/services/assistantInterviews.ts', import.meta.url), 'utf8');
  // D765 (#2090), D720 §6: the submission queues nothing; the summary is the founder's press.
  assert.doesNotMatch(src, /enqueueDigest\(/);
});

// ── Metering, claims and scope ───────────────────────────────────────────────

test('every model call goes through aiRouter.run with the member\'s id; the engine never calls Workers AI itself', async () => {
  // Mutation checked: an `env.AI.run` in validateEngine.ts fails the source check and adds an unlogged call.
  const f = world();
  const id = await importedCall(f);
  await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
  // D763: one row per model call; the guard's own rows (`guard_for` set) are its run's, on the same page.
  const logs = f.db.prepare('SELECT user_id, surface FROM ai_usage_logs WHERE guard_for IS NULL').all();
  assert.equal(logs.length, f.ai.length, 'one usage row per model call');
  for (const l of logs) assert.deepEqual({ ...l }, { user_id: ME, surface: SURFACE });
  const src = readFileSync(new URL('../src/services/validateEngine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /env\.AI\b/);
  assert.doesNotMatch(src, /import\s*\{[^}]*\brun\b[^}]*\}\s*from\s*'\.\/aiRouter'/);
});

test('busy: a running claim refuses a second run until it is stale', async () => {
  // Mutation checked: dropping the claim's WHERE lets both runs bill.
  const f = world();
  const id = await importedCall(f);
  f.db.exec(`UPDATE interview_sessions SET digest_status = 'running', digested_at = datetime('now') WHERE id = ${id}`);
  const out: any = await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' });
  assert.deepEqual([out.status, out.reason, out.note], ['refused', 'busy', NOTES.busy]);
  assert.equal(f.ai.length, 0);
  const r = await call(f.env, 'POST', `/sessions/${id}/summarise`, {});
  assert.deepEqual([r.status, r.body.error], [409, 'digest_running']);
  f.db.exec(`UPDATE interview_sessions SET digested_at = datetime('now', '-20 minutes') WHERE id = ${id}`);
  assert.equal((await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' })).status, 'done');

  const g = world();
  const gid = await importedCall(g);
  // Mutation checked: dropping the claim's hash condition bills the second run (AI calls 4).
  const both = await Promise.all([1, 2].map(() => digestSession(g.env, { sessionId: gid, userId: ME, trigger: 'call_imported' })));
  const said = both.map((o: any) => o.reason ?? o.status).sort();
  assert.ok(said.includes('done') && (said.includes('busy') || said.includes('unchanged')), said.join());
  assert.equal(g.ai.length, 3, 'one run\'s calls: the summary, and structure\'s two passes');
});

test('a member who lost the venture gets not_writable, and nothing is written or run', async () => {
  const f = world();
  const id = await importedCall(f);
  f.db.exec(`UPDATE projects SET founder_id = 99 WHERE id = ${PROJECT}`);
  assert.deepEqual(await digestSession(f.env, { sessionId: id, userId: ME, trigger: 'call_imported' }), { ok: false, status: 'not_writable' });
  assert.equal(row(f.db, id).digest_status, null);
  assert.equal(f.ai.length, 0);
});

test('nothing reaches a module without Accept', async () => {
  const f = world();
  await drain(f);
  await assignedChat(f);
  await importedCall(f);
  await drain(f);
  await runSessionStructureJob(f.env, { session_id: await importedCall(f), user_id: ME, trigger: 'call_imported' });
  assert.ok(n(f.db, 'SELECT COUNT(*) n FROM validate_proposals') > 0);
  assert.equal(n(f.db, "SELECT COUNT(*) n FROM validate_proposals WHERE status <> 'pending'"), 0);
  assert.equal(n(f.db, 'SELECT COUNT(*) n FROM discovery_interviews WHERE pains_json IS NOT NULL OR icp_fit IS NOT NULL'), 0);
  for (const t of ['interview_pain_severities', 'demand_signals', 'competitor_signals', 'customer_segments']) {
    assert.equal(n(f.db, `SELECT COUNT(*) n FROM ${t}`), 0, t);
  }
});

// ── The free-tier cap, for every creator ─────────────────────────────────────

test('the free-tier interview cap holds for "Create interview from this chat"; Growth and admins pass', async () => {
  // Mutation checked: removing the interviewCapRefusal call from createInterview lets the sixth through.
  const fill = (f: World) => {
    const have = n(f.db, 'SELECT COUNT(*) n FROM discovery_interviews WHERE project_id = ?', PROJECT);
    for (let i = have; i < FREE_TIER_LIMITS.discoveryInterviews; i += 1) {
      f.db.prepare('INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (?, ?)').run(PROJECT, `P${i}`);
    }
  };
  const create = async (f: World) => {
    const conn = (await connectionForTelegram(f.env, 'BC-ME'))!;
    await storeMessage(f.env, conn, msg());
    const [t] = await listThreads(f.env, ME);
    return assignThread(f.env, ME, t.uid, { projectId: PROJECT, intervieweeName: 'Sixth' });
  };
  {
    const f = world();
    fill(f);
    const before = n(f.db, 'SELECT COUNT(*) n FROM discovery_interviews');
    const err = await create(f).then(() => null, (e) => e);
    assert.ok(err instanceof IntakeError);
    assert.deepEqual([err.status, err.code], [402, 'tier_required']);
    assert.equal(n(f.db, 'SELECT COUNT(*) n FROM discovery_interviews'), before, 'nothing written');
  }
  {
    const f = world();
    fill(f);
    f.db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${ME}`);
    assert.ok((await create(f)).sessionId);
  }
  {
    const f = world();
    fill(f);
    f.db.exec(`UPDATE users SET role = 'admin' WHERE id = ${ME}`);
    assert.ok((await create(f)).sessionId);
  }
  void ADMIN;
});

test('every interview creator reads the one constant', () => {
  const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('middleware/requireTier.ts'), /FREE_TIER_LIMITS\.discoveryInterviews \? tierUpsell\('growth'\)/);
  assert.match(read('routes/founder_validate_sessions.ts'), /interviewCapRefusal\(c\.env, user\.id, projectId\)/);
  assert.match(read('services/interviewIntake.ts'), /interviewCapRefusal\(env, member\.id, project\.id\)/);
  assert.match(read('services/assistantInterviews.ts'), /interviewCapRefusal\(env, grant\.userId, project\.id\)/);
  assert.match(read('routes/progress.ts'), /FREE_TIER_LIMITS\.discoveryInterviews/);
  assert.match(read('routes/contacts.ts'), /FREE_TIER_LIMITS\.discoveryInterviews/);
});

test('D757 (#1923): pass B refused keeps pass A\'s suggestions, records its refusal, and says so in the note', async () => {
  const f = world();
  const run = f.env.AI.run;
  // The summary and pass A answer; every model asked for pass B fails.
  f.env.AI.run = async (model: string, input: any) => {
    if (/This pass reads for demand and evidence/.test(JSON.stringify(input))) throw new Error('capacity');
    return run(model, input);
  };
  const id = await importedCall(f);
  const out = await runSessionStructureJob(f.env, { session_id: id, user_id: ME, trigger: 'call_imported' });
  assert.equal(out.status, 'done');
  assert.ok(f.db.prepare('SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ?').get(id).n > 0, 'pass A\'s suggestions are stored');
  const lines = f.db.prepare('SELECT outcome FROM interview_structure_receipts WHERE session_id = ? ORDER BY id').all(id).map((r: any) => r.outcome);
  assert.equal(lines.at(-1), 'refused', 'pass B\'s refusal is on the receipt');
  assert.ok(lines.slice(0, -1).every((o: string) => o === 'ok'));
  assert.match(row(f.db, id).digest_note, /^Axal suggested what it heard about the problem, the person and the market, but not yet about demand and evidence: /);
});
