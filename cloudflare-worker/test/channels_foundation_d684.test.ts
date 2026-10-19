/**
 * D684 (#1575) — the S01 foundation every interview channel builds on:
 * migration 449, the intake, event dedupe, connection tenancy, link codes,
 * outbound tracking, the pending-thread store and the job registry.
 *
 * What these prove:
 *   · an event is processed once; a released claim lets the retry through;
 *   · a link code works once, within ten minutes, and only its hash is stored;
 *   · a repeated client_key never sends twice, and another member's key is refused;
 *   · WhatsApp delivery only moves forward; 'failed' always lands;
 *   · tenancy comes from the connection: an unlinked or disabled Telegram
 *     business connection, or an inactive WhatsApp row, resolves to nobody;
 *   · pending text and contact names are stored encrypted, readable only by
 *     their member;
 *   · nothing reaches an interview until the member assigns the thread, and
 *     assignment moves every pending message into a session marked with the
 *     channel, deleting the pending copies;
 *   · a venture the member cannot write is not there (404), and nothing moves;
 *   · an inactive member's connection writes nothing;
 *   · a provider copy of Axal's own reply is a duplicate;
 *   · ignore deletes and drops, and holds while the contact keeps writing;
 *     purge keeps 30 days, and takes pending copies on any thread;
 *   · leftovers on an assigned chat are moved by the next assignment;
 *     "Create interview from this chat" leaves no empty interview behind;
 *   · a failed thread count takes its message with it; another member's reply
 *     is never this member's echo; two delivery reports at once never move a
 *     status backwards; the transcript mirror stops at its bound;
 *   · the per-connection counters live in D1: the minute limit trips and fails
 *     open, the daily transcription cap holds and fails closed;
 *   · a channel job reaches its provider's handler, and a provider that
 *     registered none fails loudly;
 *   · D685 §5.1: a channel session stores its call provider, the interview
 *     takes its channel only when it had none, and a chat's first text or an
 *     imported call transcript marks the interview held: once (two first
 *     messages at once included), only after the write lands, never at its
 *     cost, never again over a stage the member set, never re-dating an
 *     interview with no stage, and never on another venture's interview.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channels_foundation_d684.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { claimEvent, connectionOverLimit, finishEvent, releaseEvent, reserveTranscription } from '../src/services/channels/events.ts';
import { createLinkCode, consumeLinkCode } from '../src/services/channels/linkCodes.ts';
import { beginOutbound, finishOutbound, applyDeliveryStatus } from '../src/services/channels/outbound.ts';
import {
  availability, connectionForTelegram, connectionForWhatsApp, memberConnection, providerAvailable,
} from '../src/services/channels/connections.ts';
import {
  applyDelete, applyEdit, assignThread, forgetConnection, listThreads, purgeExpired, readThread, setThreadIgnored,
  storeMessage, type ThreadMessageInput,
} from '../src/services/channels/threads.ts';
import {
  IntakeError, TRANSCRIPT_MIRROR_MAX_BYTES, appendSegments, importTranscript, openSession, writableInterview,
} from '../src/services/interviewIntake.ts';
import { CHANNEL_LIMITS } from '../src/services/channels/types.ts';
import { registerChannelJob, runChannelJob, registerChannelSweep, runChannelSweeps } from '../src/services/channels/jobs.ts';
import { runSessionStructureJob, structureSession, sweepQuietChats } from '../src/services/sessionAutoStructure.ts';
import { callRefusal } from '../src/services/sessionSetup.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const ME = 2, OTHER = 3, GONE = 4, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101, THEIR_INTERVIEW = 501;
const TG_INT = 11, WA_INT = 12, GONE_INT = 13;

function world() {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id IN (${ME}, ${GONE});
    UPDATE users SET is_active = 0 WHERE id = ${GONE};
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
      (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz'), (${THEIR_INTERVIEW}, ${OTHER_PROJECT}, 'Theirs');
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', auth_type TEXT, credentials_enc TEXT, config_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, external_account_id) VALUES
      (${TG_INT}, 'tg-me', ${ME}, 'telegram', 'webhook', '555001'),
      (${WA_INT}, 'wa-me', ${ME}, 'whatsapp', 'oauth2', 'PNID-1'),
      (${GONE_INT}, 'tg-gone', ${GONE}, 'whatsapp', 'oauth2', 'PNID-GONE');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals', 'queue_jobs']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    // D685: openSession stores the call (call_provider), as production's 452 lets it.
    '452_record_session_setup.sql', '454_channel_voice_failures.sql', '458_channel_link_consent.sql',
    // D754 (#1893): the consent store and channel_threads.consent_state.
    '488_channel_consents.sql', '492_whatsapp_sender_links.sql']) db.exec(mig(m));
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
           VALUES ('bc-1', 'BC-ME', '555001', ${ME}, 1, 1), ('bc-2', 'BC-UNLINKED', '777', NULL, 1, 1),
                  ('bc-3', 'BC-OFF', '555001', ${ME}, 0, 1)`);
  const aiCalls: string[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', KEK_PII: 'k'.repeat(48),
    AI: {
      run: async (model: string) => {
        if (/guard/.test(model)) return { response: 'safe' };
        aiCalls.push(model);
        return { response: STRUCTURE_REPLY };
      },
    },
  };
  return { env, db, aiCalls };
}

/** What the Worker AI answers for a chat whose first message is the default one below. */
const STRUCTURE_REPLY = JSON.stringify({ placements: [
  { kind: 'pain_severity', payload: { phrase: 'Manual invoice reconciliation', severity: 'severe' }, cite: { from: 0, to: 1000 },
    quote: 'We reconcile invoices by hand every Friday.' },
] });

const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);

function msg(over: Partial<ThreadMessageInput> = {}): ThreadMessageInput {
  return {
    externalChatId: 'chat-1', externalMessageId: `m-${Math.random()}`, side: 'contact', contactName: 'Dana R.',
    text: 'We reconcile invoices by hand every Friday.', kind: 'text', sentAt: new Date().toISOString(), ...over,
  };
}

async function refused(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e) => e);
  assert.ok(err instanceof IntakeError, `expected IntakeError ${status}, got ${err}`);
  assert.equal(err.status, status, err.code);
  if (code) assert.equal(err.code, code);
}

test('migration 449 is idempotent and frees an identity on disconnect', () => {
  const { db } = world();
  db.exec(mig('449_interview_channels.sql'));
  assert.throws(() => db.exec(`INSERT INTO integrations (uid, user_id, provider_key, external_account_id) VALUES ('dup', 5, 'whatsapp', 'PNID-1')`));
  db.exec(`UPDATE integrations SET status = 'disconnected' WHERE id = ${WA_INT}`);
  db.exec(`INSERT INTO integrations (uid, user_id, provider_key, external_account_id) VALUES ('dup', 5, 'whatsapp', 'PNID-1')`);
});

test('migration 450 widens channel_events to the delete kind the adapter writes, keeping every row', async () => {
  // On 449 alone (what main applied first) the claim the Telegram adapter makes
  // for a deleted business message is refused by the CHECK.
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE integrations (id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, auth_type TEXT, external_account_id TEXT, status TEXT DEFAULT 'connected')`);
  raw.exec(`CREATE TABLE interview_sessions (id INTEGER PRIMARY KEY)`);
  raw.exec(mig('449_interview_channels.sql'));
  raw.exec(`INSERT INTO channel_events (uid, provider, external_event_id, kind, status) VALUES ('e1', 'telegram', 'h1', 'message', 'done')`);
  assert.throws(() => raw.exec(`INSERT INTO channel_events (uid, provider, external_event_id, kind) VALUES ('e2', 'telegram', 'h2', 'delete')`), /CHECK/);
  raw.exec(mig('450_channel_events_delete_kind.sql'));
  assert.deepEqual({ ...raw.prepare(`SELECT uid, kind, status FROM channel_events WHERE uid = 'e1'`).get() }, { uid: 'e1', kind: 'message', status: 'done' });
  raw.exec(`INSERT INTO channel_events (uid, provider, external_event_id, kind) VALUES ('e2', 'telegram', 'h2', 'delete')`);
  assert.throws(() => raw.exec(`INSERT INTO channel_events (uid, provider, external_event_id, kind) VALUES ('e3', 'telegram', 'h3', 'nonsense')`), /CHECK/);
  assert.throws(() => raw.exec(`INSERT INTO channel_events (uid, provider, external_event_id, kind) VALUES ('e4', 'telegram', 'h1', 'message')`), /UNIQUE/);
  assert.ok(raw.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_channel_events_user'`).get(), '449\'s index is gone');
  // And through the service, on the world every other test uses.
  const { env } = world();
  assert.ok(await claimEvent(env, 'telegram', 'del-1', 'delete'));
});

test('an event is claimed once; a released claim lets the retry through', async () => {
  const { env, db } = world();
  const id = await claimEvent(env, 'telegram', 'upd-1', 'message');
  assert.ok(id);
  assert.equal(await claimEvent(env, 'telegram', 'upd-1', 'message'), null);
  assert.ok(await claimEvent(env, 'whatsapp', 'upd-1', 'message'), 'dedupe is per provider');
  await releaseEvent(env, id!);
  const again = await claimEvent(env, 'telegram', 'upd-1', 'message');
  assert.ok(again);
  await finishEvent(env, again!, 'failed', { userId: ME, error: 'x'.repeat(500) });
  const row = db.prepare('SELECT status, user_id, error FROM channel_events WHERE id = ?').get(again);
  assert.equal(row.status, 'failed');
  assert.equal(row.user_id, ME);
  assert.equal(row.error.length, 80);
  assert.equal(await claimEvent(env, 'telegram', '', 'message'), null, 'no id, no claim');
});

test('a link code works once, in time, and only its hash is stored', async () => {
  const { env, db } = world();
  const { code } = await createLinkCode(env, ME, 'telegram');
  assert.match(code, /^[a-zA-Z2-9]{24}$/);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_link_codes WHERE code_hash = ?', code), 0);
  assert.equal(await consumeLinkCode(env, code, 'telegram'), ME);
  assert.equal(await consumeLinkCode(env, code, 'telegram'), null, 'once');

  const { code: first } = await createLinkCode(env, ME, 'telegram');
  const { code: second } = await createLinkCode(env, ME, 'telegram');
  assert.equal(await consumeLinkCode(env, first, 'telegram'), null, 'a newer code retires the older');
  db.exec(`UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z'`);
  assert.equal(await consumeLinkCode(env, second, 'telegram'), null, 'expired');
  assert.equal(await consumeLinkCode(env, "x' OR 1=1 --", 'telegram'), null);
});

test('outbound: a client_key sends once, belongs to one member, and delivery only moves forward', async () => {
  const { env, db } = world();
  const a = await beginOutbound(env, 'whatsapp', ME, null, 'key-1');
  assert.equal(a.existing, false);
  const b = await beginOutbound(env, 'whatsapp', ME, null, 'key-1');
  assert.equal(b.existing, true);
  assert.equal(b.row.id, a.row.id);
  await assert.rejects(beginOutbound(env, 'whatsapp', OTHER, null, 'key-1'), /client_key_conflict/);
  await assert.rejects(beginOutbound(env, 'whatsapp', ME, null, '  '), /client_key_required/);

  await finishOutbound(env, a.row.id, { ok: true, externalMessageId: 'wamid.1' });
  await applyDeliveryStatus(env, 'wamid.1', 'read', null);
  await applyDeliveryStatus(env, 'wamid.1', 'delivered', null);
  assert.equal(db.prepare('SELECT status FROM channel_outbound WHERE id = ?').get(a.row.id).status, 'read');
  await applyDeliveryStatus(env, 'wamid.1', 'failed', '131047');
  const row = db.prepare('SELECT status, error_code FROM channel_outbound WHERE id = ?').get(a.row.id);
  assert.deepEqual({ ...row }, { status: 'failed', error_code: '131047' });
  assert.equal(await applyDeliveryStatus(env, 'wamid.unknown', 'read', null), false);

  const tg = await beginOutbound(env, 'telegram', ME, null, 'key-2');
  await finishOutbound(env, tg.row.id, { ok: true, externalMessageId: '42' });
  assert.equal(await applyDeliveryStatus(env, '42', 'read', null), false, 'Telegram sends never become delivered');
});

test('tenancy comes only from the connection', async () => {
  const { env, db } = world();
  const tg = await connectionForTelegram(env, 'BC-ME');
  assert.equal(tg?.userId, ME);
  assert.equal(tg?.canReply, true);
  assert.equal(await connectionForTelegram(env, 'BC-UNLINKED'), null, 'not yet linked to a member');
  assert.equal(await connectionForTelegram(env, 'BC-OFF'), null, 'disabled');
  assert.equal(await connectionForTelegram(env, 'BC-NOPE'), null);
  assert.equal((await connectionForWhatsApp(env, 'PNID-1'))?.userId, ME);
  assert.equal(await connectionForWhatsApp(env, 'PNID-404'), null);
  assert.equal(await connectionForWhatsApp(env, 'PNID-GONE') != null, true, 'resolves; the intake refuses the inactive member');
  assert.equal(await memberConnection(env, OTHER, 'telegram'), null);
  db.exec(`UPDATE integrations SET status = 'paused' WHERE id = ${WA_INT}`);
  assert.equal(await connectionForWhatsApp(env, 'PNID-1'), null, 'a paused connection is nobody');
  db.exec(`UPDATE integrations SET status = 'paused' WHERE id = ${TG_INT}`);
  assert.equal(await connectionForTelegram(env, 'BC-ME'), null, 'linked, but the member switched it off');
});

test('availability names missing secrets and never returns a value', () => {
  const env: any = { TELEGRAM_CHANNEL_BOT_TOKEN: 'secret-value-123', TELEGRAM_CHANNEL_BOT_USERNAME: 'axal_bot' };
  const rows = availability(env);
  const tg = rows.find((r) => r.provider === 'telegram')!;
  assert.deepEqual(tg.missing, ['TELEGRAM_CHANNEL_WEBHOOK_SECRET']);
  assert.equal(JSON.stringify(rows).includes('secret-value-123'), false);
  env.TELEGRAM_CHANNEL_WEBHOOK_SECRET = 'w';
  assert.equal(providerAvailable(env, 'telegram'), true);
  assert.equal(providerAvailable(env, 'zoom'), false);
});

test('a pending message is stored encrypted and read only by its member', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  const out = await storeMessage(env, conn, msg({ externalMessageId: 'm1' }));
  assert.equal(out.stored, 'pending');
  assert.equal((await storeMessage(env, conn, msg({ externalMessageId: 'm1' }))).stored, 'duplicate');

  const raw = JSON.stringify(db.prepare('SELECT * FROM channel_thread_messages').all())
    + JSON.stringify(db.prepare('SELECT * FROM channel_threads').all())
    + JSON.stringify(db.prepare('SELECT * FROM channel_events').all());
  assert.equal(raw.includes('invoices'), false, 'no plaintext text');
  assert.equal(raw.includes('Dana R.'), false, 'no plaintext contact name');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0, 'nothing reaches an interview unasked');

  const [t] = await listThreads(env, ME);
  assert.equal(t.contact_name, 'Dana R.');
  assert.equal(t.message_count, 1);
  assert.equal(t.reply_window_open, true);
  const read = await readThread(env, ME, t.uid);
  assert.equal(read.messages[0].text, 'We reconcile invoices by hand every Friday.');
  await refused(readThread(env, OTHER, t.uid), 404, 'thread_not_found');
  assert.deepEqual(await listThreads(env, OTHER), []);
});

test('assigning moves every pending message into a channel session, and later ones follow', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1', sentAt: '2026-10-01T10:00:00.000Z', text: 'First, the pain.' }));
  await storeMessage(env, conn, msg({ externalMessageId: 'm2', sentAt: '2026-10-01T10:01:00.000Z', side: 'me', text: 'How often?', contactName: null }));
  const [t] = await listThreads(env, ME);

  await refused(assignThread(env, ME, t.uid, { interviewId: THEIR_INTERVIEW }), 404, 'interview_not_found');
  await refused(assignThread(env, OTHER, t.uid, { interviewId: INTERVIEW }), 404, 'thread_not_found');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 2, 'a refused assign moves nothing');

  const r = await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  assert.equal(r.moved, 2);
  const session = db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(r.sessionId);
  assert.equal(session.channel, 'text');
  assert.equal(session.status, 'transcribed');
  assert.equal(session.submitted_via, 'telegram');
  assert.equal(session.submitted_via_name, 'Telegram');
  const segs = db.prepare('SELECT speaker_label, text, model, source FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(r.sessionId);
  assert.deepEqual(segs.map((s: any) => [s.speaker_label, s.text]), [['Dana Ruiz', 'First, the pain.'], ['Me', 'How often?']]);
  assert.ok(segs.every((s: any) => s.source === 'final' && s.model === 'channel:telegram'));
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0, 'pending copies deleted');
  assert.match(db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, /First, the pain\./);

  const again = await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  assert.equal(again.sessionId, r.sessionId, 'the same interview twice is a no-op');

  const later = await storeMessage(env, conn, msg({ externalMessageId: 'm3', text: 'About four hours.' }));
  assert.equal(later.stored, 'session');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', r.sessionId), 3);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);
});

test('assigning can create the interview, only on a venture the member can write', async () => {
  const { env, db } = world();
  const conn = (await connectionForWhatsApp(env, 'PNID-1'))!;
  await storeMessage(env, conn, msg({ externalChatId: '4479', externalMessageId: 'wamid.a' }));
  const [t] = await listThreads(env, ME);
  await refused(assignThread(env, ME, t.uid, { projectId: OTHER_PROJECT, intervieweeName: 'X' }), 404, 'project_not_found');
  await refused(assignThread(env, ME, t.uid, { projectId: PROJECT, intervieweeName: '  ' }), 400, 'interviewee_required');
  const before = count(db, 'SELECT COUNT(*) n FROM discovery_interviews');
  const r = await assignThread(env, ME, t.uid, { projectId: PROJECT, intervieweeName: 'Sam from Acme' });
  assert.equal(count(db, 'SELECT COUNT(*) n FROM discovery_interviews'), before + 1);
  assert.equal(db.prepare('SELECT project_id FROM discovery_interviews WHERE id = ?').get(r.interviewId).project_id, PROJECT);
  assert.equal(db.prepare('SELECT submitted_via FROM interview_sessions WHERE id = ?').get(r.sessionId).submitted_via, 'whatsapp');
});

test('a thread whose interview is gone falls back to pending; an inactive member writes nothing', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1' }));
  const [t] = await listThreads(env, ME);
  await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  db.exec(`DELETE FROM discovery_interviews WHERE id = ${INTERVIEW}`);
  const out = await storeMessage(env, conn, msg({ externalMessageId: 'm2' }));
  assert.equal(out.stored, 'pending');
  assert.equal((await readThread(env, ME, t.uid)).thread.status, 'pending');

  db.exec(`UPDATE users SET is_active = 0 WHERE id = ${ME}`);
  await refused(assignThread(env, ME, t.uid, { interviewId: INTERVIEW }), 403, 'member_inactive');
  await refused(writableInterview(env, GONE, INTERVIEW), 403, 'member_inactive');
});

test("a provider copy of Axal's own reply is a duplicate; the reply route's record is not", async () => {
  const { env } = world();
  const conn = (await connectionForWhatsApp(env, 'PNID-1'))!;
  const o = await beginOutbound(env, 'whatsapp', ME, null, 'reply-1');
  await finishOutbound(env, o.row.id, { ok: true, externalMessageId: 'wamid.out' });
  const echo = await storeMessage(env, conn, msg({ externalMessageId: 'wamid.out', side: 'me', text: 'Thanks!' }));
  assert.equal(echo.stored, 'duplicate');
  const recorded = await storeMessage(env, conn, msg({ externalMessageId: 'wamid.out', side: 'me', text: 'Thanks!', origin: 'axal' }));
  assert.equal(recorded.stored, 'pending');
});

test('edits and deletions at the source change only pending copies', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1', text: 'typo' }));
  await storeMessage(env, conn, msg({ externalMessageId: 'm2', text: 'second' }));
  const base = { provider: 'telegram' as const, eventId: 'e', connectionRef: 'BC-ME', externalChatId: 'chat-1' };
  assert.equal(await applyEdit(env, conn, { ...base, kind: 'edit', externalMessageId: 'm1', text: 'fixed' }), true);
  const [t] = await listThreads(env, ME);
  assert.deepEqual((await readThread(env, ME, t.uid)).messages.map((m) => m.text), ['fixed', 'second']);
  assert.equal(await applyDelete(env, conn, { ...base, kind: 'delete', externalMessageIds: ['m2', 'm404'] }), 1);
  assert.equal((await listThreads(env, ME))[0].message_count, 1);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1);
});

test('ignore deletes the pending copies and drops later messages; un-ignoring resumes', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1' }));
  const [t] = await listThreads(env, ME);
  await refused(setThreadIgnored(env, OTHER, t.uid, true), 404);
  await setThreadIgnored(env, ME, t.uid, true);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);
  assert.equal((await storeMessage(env, conn, msg({ externalMessageId: 'm2' }))).stored, 'ignored');
  await setThreadIgnored(env, ME, t.uid, false);
  assert.equal((await storeMessage(env, conn, msg({ externalMessageId: 'm3' }))).stored, 'pending');
});

test('purge keeps 30 days of pending messages and never touches an assigned thread', async () => {
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalChatId: 'old', externalMessageId: 'o1', sentAt: '2026-08-01T00:00:00.000Z' }));
  await storeMessage(env, conn, msg({ externalChatId: 'new', externalMessageId: 'n1' }));
  await storeMessage(env, conn, msg({ externalChatId: 'kept', externalMessageId: 'k1' }));
  const kept = (await listThreads(env, ME)).find((t) => t.message_count && db.prepare('SELECT external_chat_id FROM channel_threads WHERE uid = ?').get(t.uid).external_chat_id === 'kept')!;
  await assignThread(env, ME, kept.uid, { interviewId: INTERVIEW });
  db.exec(`UPDATE channel_threads SET last_message_at = '2026-08-01T00:00:00.000Z' WHERE external_chat_id IN ('old', 'kept')`);
  const r = await purgeExpired(env, new Date());
  assert.equal(r.messages, 1);
  assert.equal(r.threads, 1);
  const chats = db.prepare('SELECT external_chat_id FROM channel_threads ORDER BY external_chat_id').all().map((x: any) => x.external_chat_id);
  assert.deepEqual(chats, ['kept', 'new']);
  assert.equal(await forgetConnection(env, TG_INT), 2);
  assert.ok(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments') > 0, 'what was assigned stays in the interview');
});

/** Reads that resolve only once `n` have been made (or 50 ms pass): two handlers reading before either writes. */
function readBarrier(DB: any, match: RegExp, n = 2) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; setTimeout(r, 50); });
  return {
    ...DB, batch: DB.batch.bind(DB),
    prepare(sql: string) {
      const st = DB.prepare(sql);
      if (!match.test(sql)) return st;
      return { bind: (...a: unknown[]) => {
        const b = st.bind(...a);
        return { all: () => b.all(), run: () => b.run(), first: async (c?: string) => { const v = await b.first(c); if (++arrived >= n) open(); await gate; return v; } };
      } };
    },
  };
}

test('two delivery reports handled at once never move a status backwards', async () => {
  // Review finding 16: 'read' and 'delivered' both read 'submitted', and the slower write won.
  const { env, db } = world();
  const a = await beginOutbound(env, 'whatsapp', ME, null, 'race-1');
  await finishOutbound(env, a.row.id, { ok: true, externalMessageId: 'wamid.R' });
  const racing: any = { ...env, DB: readBarrier(env.DB, /^\s*SELECT[\s\S]*FROM channel_outbound/) };
  const both = await Promise.all([applyDeliveryStatus(racing, 'wamid.R', 'read', null), applyDeliveryStatus(racing, 'wamid.R', 'delivered', null)]);
  assert.deepEqual(both, [true, true]);
  assert.equal(db.prepare('SELECT status FROM channel_outbound WHERE id = ?').get(a.row.id).status, 'read');
});

test("another member's reply is never taken for this member's own message", async () => {
  // Review finding 4: Telegram refs are `<chat>:<message_id>`, and two business
  // accounts writing to the same customer count message_ids separately.
  const { env } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  const theirs = await beginOutbound(env, 'telegram', OTHER, null, 'other-reply');
  await finishOutbound(env, theirs.row.id, { ok: true, externalMessageId: 'chat-1:4711' });
  const mine = await storeMessage(env, conn, msg({ externalMessageId: 'chat-1:4711', side: 'me', text: 'From my phone.', contactName: null }));
  assert.equal(mine.stored, 'pending');
});

test('a failed thread count takes its message with it, so the provider’s retry stores and counts both', async () => {
  // Review finding 15: the insert used to commit alone; the retry then hit the
  // unique key as a duplicate and the count (and WhatsApp's reply window) never moved.
  const { env, db } = world();
  const conn = (await connectionForWhatsApp(env, 'PNID-1'))!;
  await storeMessage(env, conn, msg({ externalChatId: '4479', externalMessageId: 'wamid.first' }));
  db.exec(`UPDATE channel_threads SET last_inbound_at = NULL`);
  db.exec(`CREATE TRIGGER fail_count BEFORE UPDATE OF message_count ON channel_threads BEGIN SELECT RAISE(ABORT, 'd1 hiccup'); END;`);
  await assert.rejects(storeMessage(env, conn, msg({ externalChatId: '4479', externalMessageId: 'wamid.second' })));
  db.exec('DROP TRIGGER fail_count');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1, 'nothing kept without its count');
  assert.equal((await storeMessage(env, conn, msg({ externalChatId: '4479', externalMessageId: 'wamid.second' }))).stored, 'pending');
  const t = db.prepare('SELECT message_count, last_inbound_at FROM channel_threads').get();
  assert.equal(t.message_count, 2);
  assert.ok(t.last_inbound_at, 'the reply window opens');
});

test('an ignored chat stays ignored while the contact keeps writing; a quiet one is purged after 30 days', async () => {
  // Review findings 6 and 11: the purge used to take an ignored chat 30 days
  // after its last stored message, however active it was, and the next message
  // reopened it as pending, text kept.
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalChatId: 'spouse', externalMessageId: 's1' }));
  await storeMessage(env, conn, msg({ externalChatId: 'gone-quiet', externalMessageId: 'q1' }));
  for (const t of await listThreads(env, ME)) await setThreadIgnored(env, ME, t.uid, true);
  db.exec(`UPDATE channel_threads SET last_message_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01 00:00:00'`);

  // The spouse writes today: dropped, but the tombstone hears it.
  assert.equal((await storeMessage(env, conn, msg({ externalChatId: 'spouse', externalMessageId: 's2', text: 'Dinner at 8?' }))).stored, 'ignored');
  const r = await purgeExpired(env, new Date());
  assert.equal(r.threads, 1, 'only the quiet ignored chat goes');
  assert.deepEqual(db.prepare('SELECT external_chat_id, status FROM channel_threads').all().map((x: any) => [x.external_chat_id, x.status]), [['spouse', 'ignored']]);
  assert.equal((await storeMessage(env, conn, msg({ externalChatId: 'spouse', externalMessageId: 's3', text: 'Call me.' }))).stored, 'ignored');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0, 'no text kept');
});

test('pending copies left on an assigned chat are moved by the next assignment, and purged at 30 days', async () => {
  // Review findings 8 and 14: rows that landed pending on an assigned thread
  // (an assignment in flight, or a move cut short) were never moved, and the
  // purge skipped every thread that was not pending.
  const { env, db } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1', text: 'First.' }));
  const [t] = await listThreads(env, ME);
  const r = await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  // What an assignment in flight leaves: a pending row on an assigned thread.
  const thread = db.prepare('SELECT * FROM channel_threads WHERE uid = ?').get(t.uid);
  db.prepare(`INSERT INTO channel_thread_messages (uid, thread_id, external_message_id, direction, kind, text_enc, sent_at)
              VALUES ('late', ?, 'h-late', 'in', 'text', ?, ?)`)
    .run(thread.id, await (await import('../src/services/columnCipher.ts')).encryptColumn(env, 'channel_thread_messages', 'text_enc', 'late', 'Landed late.'),
      new Date().toISOString());
  const again = await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  assert.deepEqual([again.sessionId, again.moved], [r.sessionId, 1]);
  assert.deepEqual(db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(r.sessionId).map((x: any) => x.text),
    ['First.', 'Landed late.']);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);

  db.prepare(`INSERT INTO channel_thread_messages (uid, thread_id, external_message_id, direction, kind, text_enc, sent_at)
              VALUES ('stale', ?, 'h-stale', 'in', 'text', 'x', '2026-01-01T00:00:00.000Z')`).run(thread.id);
  assert.equal((await purgeExpired(env, new Date())).messages, 1, 'a 30-day-old copy goes, whatever its thread');
});

test('"Create interview from this chat" leaves no interview behind when the chat is busy or the claim is lost', async () => {
  // Review finding 13.
  const { env, db } = world();
  const conn = (await connectionForWhatsApp(env, 'PNID-1'))!;
  await storeMessage(env, conn, msg({ externalChatId: '4479', externalMessageId: 'wamid.a' }));
  const [t] = await listThreads(env, ME);
  const before = count(db, 'SELECT COUNT(*) n FROM discovery_interviews');
  // An assignment in flight (claimed, no session yet): a second press is refused.
  db.exec(`UPDATE channel_threads SET status = 'assigned', interview_id = ${INTERVIEW}, session_id = NULL, updated_at = datetime('now')`);
  await refused(assignThread(env, ME, t.uid, { projectId: PROJECT, intervieweeName: 'Sam from Acme' }), 409, 'thread_busy');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM discovery_interviews'), before, 'no empty interview');

  // The claim lost to a concurrent change: the interview it made goes again.
  db.exec(`UPDATE channel_threads SET status = 'pending', interview_id = NULL, updated_at = datetime('now', '-5 minutes')`);
  db.exec(`CREATE TRIGGER steal_claim BEFORE UPDATE OF session_id ON channel_threads WHEN NEW.status = 'assigned' AND NEW.session_id IS NULL
           BEGIN SELECT RAISE(IGNORE); END;`);
  await refused(assignThread(env, ME, t.uid, { projectId: PROJECT, intervieweeName: 'Sam from Acme' }), 409, 'thread_busy');
  db.exec('DROP TRIGGER steal_claim');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM discovery_interviews'), before, 'no empty interview');
});

test('the interview transcript mirror stops growing at its bound; the session keeps every message', async () => {
  // Review finding 10: past D1's 2,000,000-byte value limit every later append
  // to the interview (every customer message, the member's replies) failed.
  const { env, db } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'telegram', 'text');
  db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run('x'.repeat(TRANSCRIPT_MIRROR_MAX_BYTES - 10), INTERVIEW);
  const seg = (text: string) => ({ start_ms: null, end_ms: null, speaker_raw: null, speaker_label: 'Dana Ruiz', text });
  assert.equal(await appendSegments(env, ME, s.id, [seg('This one does not fit in the mirror.')], 'telegram'), 1);
  const bytes = db.prepare('SELECT length(CAST(transcript AS BLOB)) AS n FROM discovery_interviews WHERE id = ?').get(INTERVIEW).n;
  assert.ok(bytes <= TRANSCRIPT_MIRROR_MAX_BYTES, `mirror is ${bytes} bytes`);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', s.id), 1);
  db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run('short', INTERVIEW);
  await appendSegments(env, ME, s.id, [seg('Fits.')], 'telegram');
  assert.equal(db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, 'short\nFits.');
});

test('per-connection counters live in D1: the minute limit trips, the day cap holds and fails closed', async () => {
  const { env, db } = world();
  const at = new Date('2026-10-13T10:05:00.000Z');
  for (let i = 0; i < CHANNEL_LIMITS.eventsPerMinute; i++) assert.equal(await connectionOverLimit(env, TG_INT, at), false);
  assert.equal(await connectionOverLimit(env, TG_INT, at), true, 'the next one is over');
  assert.equal(await connectionOverLimit(env, WA_INT, at), false, 'per connection');
  assert.equal(await connectionOverLimit(env, TG_INT, new Date('2026-10-13T10:06:00.000Z')), false, 'per minute');

  for (let i = 0; i < CHANNEL_LIMITS.transcriptionsPerDay; i++) assert.equal(await reserveTranscription(env, TG_INT, at), true);
  assert.equal(await reserveTranscription(env, TG_INT, at), false, 'the day is spent');
  assert.equal(await reserveTranscription(env, TG_INT, new Date('2026-10-14T00:00:01.000Z')), true, 'a new day');
  assert.equal(db.prepare(`SELECT n FROM channel_counters WHERE integration_id = ? AND counter = 'transcriptions_day' AND window_start = '2026-10-13'`).get(TG_INT).n,
    CHANNEL_LIMITS.transcriptionsPerDay);

  db.exec(`UPDATE channel_counters SET created_at = datetime('now', '-3 days')`);
  assert.equal((await purgeExpired(env, new Date())).counters, 5, 'three minute windows and two days');
  db.exec('DROP TABLE channel_counters');
  const error = console.error;
  console.error = () => {};
  try { assert.equal(await connectionOverLimit(env, TG_INT, at), false, 'the event limit fails open'); } finally { console.error = error; }
  await assert.rejects(reserveTranscription(env, TG_INT, at), 'the transcription cap fails closed');
});

test('a meeting transcript is imported once into its session, replacing what was there', async () => {
  const { env, db } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'zoom', 'video');
  assert.equal(s.status, 'draft');
  await refused(importTranscript(env, ME, s.id, [{ speaker: 'A', text: '  ', startMs: 0, endMs: 1 }], 'zoom'), 422, 'transcript_empty');
  await refused(importTranscript(env, OTHER, s.id, [{ speaker: 'A', text: 'x', startMs: 0, endMs: 1 }], 'zoom'), 404);
  const n = await importTranscript(env, ME, s.id, [
    { speaker: 'Dana Ruiz', text: 'We lose a day a month.', startMs: 1200, endMs: 4000 },
    { speaker: '', text: 'Who signs off?', startMs: null, endMs: null },
  ], 'zoom');
  assert.equal(n, 2);
  const row = db.prepare('SELECT status, final_model, submitted_via FROM interview_sessions WHERE id = ?').get(s.id);
  assert.deepEqual({ ...row }, { status: 'transcribed', final_model: 'zoom_transcript', submitted_via: 'zoom' });
  assert.equal(db.prepare("SELECT speaker_label FROM interview_transcript_segments WHERE text = 'Who signs off?'").get().speaker_label, 'Speaker ?');
});

test('a channel job reaches its provider handler; a provider without one fails loudly', async () => {
  const seen: unknown[] = [];
  registerChannelJob('meeting_import', 'zoom', async (_env, p) => { seen.push(p); });
  await runChannelJob({} as any, 'meeting_import', { provider: 'zoom', meetingUid: 'abc' });
  assert.deepEqual(seen, [{ provider: 'zoom', meetingUid: 'abc' }]);
  await assert.rejects(runChannelJob({} as any, 'meeting_import', { provider: 'telegram' }), /no meeting_import handler/);

  let ran = 0;
  registerChannelSweep('google_meet', async () => { throw new Error('boom'); });
  registerChannelSweep('zoom', async () => { ran++; });
  const failed = await runChannelSweeps({} as any, new Date());
  assert.deepEqual(failed, ['google_meet']);
  assert.equal(ran, 1, 'one sweep failing never stops another');

  const worker = readFileSync(new URL('../src/services/queueWorker.ts', import.meta.url), 'utf8');
  assert.match(worker, /case 'channel_followup':\s*case 'meeting_import':[\s\S]*?runChannelJob/);
});

// ── From the transcript to Validate, without a button ────────────────────────

const queued = (db: any, type: string) =>
  db.prepare('SELECT payload FROM queue_jobs WHERE job_type = ? ORDER BY id').all(type).map((r: any) => JSON.parse(r.payload));

test('assigning a chat queues the Worker AI\'s Structure pass, and the pass proposes the pain point for review', async () => {
  const { env, db, aiCalls } = world();
  const conn = (await connectionForTelegram(env, 'BC-ME'))!;
  await storeMessage(env, conn, msg({ externalMessageId: 'm1' }));
  const [t] = await listThreads(env, ME);
  const r = await assignThread(env, ME, t.uid, { interviewId: INTERVIEW });
  assert.deepEqual(queued(db, 'session_structure'), [{ session_id: r.sessionId, user_id: ME, trigger: 'chat_assigned' }]);
  assert.equal(aiCalls.length, 0, 'the request itself runs no model');

  const out = await runSessionStructureJob(env, queued(db, 'session_structure')[0]);
  assert.equal(out?.ok, true);
  const p = db.prepare('SELECT kind, payload_json, status, session_id, target_ref, created_by FROM validate_proposals').all();
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].kind, JSON.parse(p[0].payload_json).severity, p[0].status, p[0].session_id, p[0].target_ref, p[0].created_by],
    ['pain_severity', 'severe', 'pending', r.sessionId, `interview:${INTERVIEW}`, ME], 'a proposal awaiting review, never accepted');
  assert.equal(db.prepare('SELECT status FROM interview_sessions WHERE id = ?').get(r.sessionId).status, 'structured');
  assert.ok(count(db, 'SELECT COUNT(*) n FROM interview_structure_receipts WHERE session_id = ?', r.sessionId) >= 1, 'a receipt line per model call');
});

test('no consent, no AI: a call session without consent recorded is not structured', async () => {
  const { env, db, aiCalls } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const call = await openSession(env, scoped, 'zoom', 'video');
  await importTranscript(env, ME, call.id, [{ speaker: 'Dana Ruiz', text: 'We reconcile invoices by hand every Friday.', startMs: 0, endMs: 1000 }], 'zoom');
  assert.deepEqual(await structureSession(env, { sessionId: call.id, userId: ME, trigger: 'call_imported' }), { ok: false, reason: 'consent_not_recorded' });
  assert.equal(aiCalls.length, 0);

  const consented = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  await importTranscript(env, ME, consented.id, [{ speaker: 'Dana Ruiz', text: 'We reconcile invoices by hand every Friday.', startMs: 0, endMs: 1000 }], 'zoom');
  const ok = await structureSession(env, { sessionId: consented.id, userId: ME, trigger: 'call_imported' });
  assert.equal(ok.ok, true);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM validate_proposals WHERE session_id = ?', consented.id), 1);
});

test('a member who lost the venture, or a malformed job, runs nothing', async () => {
  const { env, db, aiCalls } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'telegram', 'text');
  db.exec(`UPDATE projects SET founder_id = 99 WHERE id = ${PROJECT}`);
  assert.deepEqual(await structureSession(env, { sessionId: s.id, userId: ME, trigger: 'chat_assigned' }), { ok: false, reason: 'not_writable' });
  assert.equal(await runSessionStructureJob(env, { session_id: 'x', user_id: ME, trigger: 'chat_assigned' }), null);
  assert.equal(await runSessionStructureJob(env, { session_id: s.id, user_id: ME, trigger: 'whatever' }), null);
  assert.equal(aiCalls.length, 0);
});

test('the quiet-chat sweep re-structures a chat with new text once it is quiet, at most every six hours', async () => {
  const { env, db } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  // D754 (#1893): a WhatsApp chat is structured only once its consent is given; without it the sweep skips it.
  const quiet = await openSession(env, scoped, 'whatsapp', 'text', { method: 'chat_reply' });
  const waiting = await openSession(env, scoped, 'whatsapp', 'text');
  const busy = await openSession(env, scoped, 'telegram', 'text');
  const recent = await openSession(env, scoped, 'telegram', 'text');
  const call = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  db.exec(`UPDATE interview_sessions SET status = 'transcribed', updated_at = datetime('now', '-2 hours')`);
  db.exec(`UPDATE interview_sessions SET updated_at = datetime('now', '-5 minutes') WHERE id = ${busy.id}`);
  db.exec(`INSERT INTO interview_structure_receipts (session_id, run_id, step, model, prompt_tokens, completion_tokens, cost_microusd, outcome, created_at)
           VALUES (${recent.id}, 'r1', 'structured', 'm', 0, 0, 0, 'refused', datetime('now', '-1 hour'))`);
  assert.equal(await sweepQuietChats(env, new Date()), 1);
  assert.deepEqual(queued(db, 'session_structure'), [{ session_id: quiet.id, user_id: ME, trigger: 'chat_quiet' }],
    'not the busy chat, not one run (or refused) within six hours, not a call, not a chat waiting for consent');
  void call; void waiting;
});

// ===========================================================================
// D685 §5.1 (#1583) — the intake records how the call is held, and the
// interview lands in Interviews once the conversation has happened.
// ===========================================================================

const interviewRow = (db: any, id = INTERVIEW) =>
  ({ ...db.prepare('SELECT stage, done_at, channel FROM discovery_interviews WHERE id = ?').get(id) });
/** Another venture's interview (seeded with no stage and no channel) is never written by this member's sessions. */
const theirsUntouched = (db: any) =>
  assert.deepEqual(interviewRow(db, THEIR_INTERVIEW), { stage: null, done_at: null, channel: null }, 'another venture\'s interview is untouched');
const heldRows = (db: any) => count(db, "SELECT COUNT(*) n FROM activity_logs WHERE action = 'interview_stage_set'");
const chatSeg = (text: string) => ({ start_ms: null, end_ms: null, speaker_raw: null, speaker_label: 'Dana Ruiz', text });
const callLine = [{ speaker: 'Dana Ruiz', text: 'We lose a day a month.', startMs: 0, endMs: 1000 }];

test('D685 §5.1.2: a channel session stores its call provider; the interview takes its channel only when it had none', async () => {
  const { env, db } = world();
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const pairs = [['zoom', 'video'], ['google_meet', 'video'], ['telegram', 'text'], ['whatsapp', 'text']] as const;
  for (const [provider, channel] of pairs) {
    const s = await openSession(env, scoped, provider, channel);
    assert.deepEqual({ ...db.prepare('SELECT channel, call_provider, submitted_via FROM interview_sessions WHERE id = ?').get(s.id) },
      { channel, call_provider: provider, submitted_via: provider }, `${provider} on ${channel}`);
    assert.equal(s.call_provider, provider, 'the row openSession returns carries it');
    assert.equal(callRefusal(channel, provider, null), null, `${provider} is a provider the Worker accepts on ${channel}`);
  }
  assert.equal(interviewRow(db).channel, 'video', 'the first session gave the interview its channel; later ones left it');
  theirsUntouched(db);

  db.prepare('UPDATE discovery_interviews SET channel = NULL WHERE id = ?').run(INTERVIEW);
  await openSession(env, scoped, 'telegram', 'text');
  assert.equal(interviewRow(db).channel, 'text', 'an interview with no channel takes the session\'s');
  db.prepare("UPDATE discovery_interviews SET channel = 'in_person' WHERE id = ?").run(INTERVIEW);
  await openSession(env, scoped, 'zoom', 'video');
  assert.equal(interviewRow(db).channel, 'in_person', 'an interview with a channel keeps it');
  assert.equal(interviewRow(db).stage, null, 'opening a session does not hold the interview');
  assert.equal(heldRows(db), 0);
  theirsUntouched(db);
});

test('D685 §5.1.6: a chat\'s first text marks the interview held, once', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked', channel = NULL WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'telegram', 'text');
  assert.equal(await appendSegments(env, ME, s.id, [chatSeg('   ')], 'telegram'), 0);
  assert.equal(interviewRow(db).stage, 'booked', 'an append with no text holds nothing');

  assert.equal(await appendSegments(env, ME, s.id, [chatSeg('We reconcile invoices by hand.')], 'telegram'), 1);
  const held = interviewRow(db);
  assert.equal(held.stage, 'done');
  assert.ok(held.done_at, 'done_at is stamped');
  assert.equal(held.channel, 'text');
  assert.equal(heldRows(db), 1);

  assert.equal(await appendSegments(env, ME, s.id, [chatSeg('Every Friday.')], 'telegram'), 1);
  assert.equal(heldRows(db), 1, 'a second append writes no second activity row');
  // Only the first move to transcribed holds it: once the member sets the
  // stage themselves, a later message on the same chat leaves it.
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  assert.equal(await appendSegments(env, ME, s.id, [chatSeg('About four hours.')], 'telegram'), 1);
  assert.equal(interviewRow(db).stage, 'booked');
  assert.equal(heldRows(db), 1);
  theirsUntouched(db);
});

test('D685 §5.1.6: new text on a structured chat does not hold the interview again over the member\'s stage', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'telegram', 'text');
  await appendSegments(env, ME, s.id, [chatSeg('Can we talk on Tuesday?')], 'telegram');
  assert.equal(interviewRow(db).stage, 'done');
  assert.equal(heldRows(db), 1);
  // The chat was only arranging the call: the member moves it back.
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  // The quiet-chat sweep structures it on its own (sessionAutoStructure.ts).
  db.prepare("UPDATE interview_sessions SET status = 'structured' WHERE id = ? AND status = 'transcribed'").run(s.id);
  assert.equal(await appendSegments(env, ME, s.id, [chatSeg('See you Tuesday.')], 'telegram'), 1);
  assert.equal(db.prepare('SELECT status FROM interview_sessions WHERE id = ?').get(s.id).status, 'transcribed',
    'new text still offers Structure on what is new');
  assert.equal(interviewRow(db).stage, 'booked', 'the member\'s stage stays');
  assert.equal(heldRows(db), 1, 'no second activity row');
});

test('D685 §5.1.6: two first messages delivered at once hold the interview once', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'telegram', 'text');
  // Both read the session as a draft before either batch lands.
  const counts = await Promise.all([
    appendSegments(env, ME, s.id, [chatSeg('Hi, it is Dana.')], 'telegram'),
    appendSegments(env, ME, s.id, [chatSeg('About the invoices.')], 'telegram'),
  ]);
  assert.deepEqual(counts, [1, 1]);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', s.id), 2);
  assert.equal(interviewRow(db).stage, 'done');
  assert.equal(heldRows(db), 1, 'one activity row, not one per message');
});

test('D685 §5.1.6: an interview with no stage keeps the date it was held on', async () => {
  // A hand-logged interview, or one made by "Create interview from this chat",
  // has no stage; every reader counts it as held on its interview_date.
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET interview_date = '2026-08-01' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const chat = await openSession(env, scoped, 'telegram', 'text');
  db.prepare('UPDATE discovery_interviews SET channel = NULL WHERE id = ?').run(INTERVIEW);
  assert.equal(await appendSegments(env, ME, chat.id, [chatSeg('We reconcile invoices by hand.')], 'telegram'), 1);
  assert.deepEqual(interviewRow(db), { stage: null, done_at: null, channel: 'text' }, 'no stage, no done_at; the channel is filled');
  const call = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  assert.equal(await importTranscript(env, ME, call.id, callLine, 'zoom'), 1);
  assert.deepEqual(interviewRow(db), { stage: null, done_at: null, channel: 'text' });
  assert.equal(db.prepare('SELECT interview_date FROM discovery_interviews WHERE id = ?').get(INTERVIEW).interview_date, '2026-08-01');
  assert.equal(heldRows(db), 0);
  theirsUntouched(db);
});

test('D685 §5.1.6: the interview is held only after the write lands — a failed append or import holds nothing', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const chat = await openSession(env, scoped, 'telegram', 'text');
  // A statement in the batch that D1 refuses (a duplicate primary key) rolls the whole batch back.
  const clash = env.DB.prepare('INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (?, ?, ?)')
    .bind(INTERVIEW, PROJECT, 'Duplicate');
  await assert.rejects(appendSegments(env, ME, chat.id, [chatSeg('Lost with the batch.')], 'telegram', [clash]));
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', chat.id), 0);
  assert.equal(db.prepare('SELECT status FROM interview_sessions WHERE id = ?').get(chat.id).status, 'draft');
  assert.equal(interviewRow(db).stage, 'booked', 'a failed append holds nothing');
  assert.equal(heldRows(db), 0);

  const call = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = async () => { throw new Error('D1 refused the batch'); };
  try {
    await assert.rejects(importTranscript(env, ME, call.id, callLine, 'zoom'), /D1 refused the batch/);
  } finally {
    env.DB.batch = batch;
  }
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', call.id), 0);
  assert.equal(interviewRow(db).stage, 'booked', 'a failed import holds nothing');
  assert.equal(heldRows(db), 0);

  // The same writes, landing, do hold it.
  assert.equal(await appendSegments(env, ME, chat.id, [chatSeg('Stored this time.')], 'telegram'), 1);
  assert.equal(interviewRow(db).stage, 'done');
  assert.equal(heldRows(db), 1);
  theirsUntouched(db);
});

test('D685 §5.1.6: an imported call transcript marks the interview held', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const s = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  assert.equal(interviewRow(db).stage, 'booked', 'a scheduled call is not yet held');
  await refused(importTranscript(env, ME, s.id, [{ speaker: 'A', text: ' ', startMs: 0, endMs: 1 }], 'zoom'), 422, 'transcript_empty');
  assert.equal(interviewRow(db).stage, 'booked', 'a refused import holds nothing');

  assert.equal(await importTranscript(env, ME, s.id, callLine, 'zoom'), 1);
  const held = interviewRow(db);
  assert.equal(held.stage, 'done');
  assert.ok(held.done_at);
  assert.equal(held.channel, 'video');
  assert.equal(heldRows(db), 1);
  // Only the first import holds it: importing again over the transcript
  // leaves a stage the member has since set.
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  assert.equal(await importTranscript(env, ME, s.id, callLine, 'zoom'), 1);
  assert.equal(interviewRow(db).stage, 'booked');
  assert.equal(heldRows(db), 1);
  theirsUntouched(db);
});

test('D685 §5.1.6: a failure while marking the interview held never fails the append or the import', async () => {
  const { env, db } = world();
  db.prepare("UPDATE discovery_interviews SET stage = 'booked' WHERE id = ?").run(INTERVIEW);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const chat = await openSession(env, scoped, 'telegram', 'text');
  const call = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  const prepare = env.DB.prepare.bind(env.DB);
  // The stage write is the one that fails; everything else reaches D1.
  env.DB.prepare = (sql: string) => {
    if (/SET stage/.test(sql)) throw new Error('D1 refused the stage write');
    return prepare(sql);
  };
  try {
    assert.equal(await appendSegments(env, ME, chat.id, [chatSeg('Still stored.')], 'telegram'), 1);
    assert.equal(await importTranscript(env, ME, call.id, callLine, 'zoom'), 1);
  } finally {
    env.DB.prepare = prepare;
  }
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', chat.id), 1);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', call.id), 1);
  assert.deepEqual(db.prepare('SELECT status FROM interview_sessions WHERE id IN (?, ?) ORDER BY id').all(chat.id, call.id).map((r: any) => r.status),
    ['transcribed', 'transcribed']);
  assert.equal(interviewRow(db).stage, 'booked', 'the failed stage write left the stage alone');
  assert.equal(heldRows(db), 0);
});
