/**
 * D877 (#2524) — Meeting Capture's rollout gates for Zoom, Google Meet and an
 * uploaded recording, one scenario each, in D861's shape (#2506): each gate
 * runs against the real modules, then against an isolated source mutation
 * that removes or inverts it, which must fail the same scenario.
 *
 *   signature   Zoom's webhook HMAC: ok, mismatch, missing, stale.
 *   tenancy     a meeting Axal did not schedule is ignored with nothing
 *               stored; a known one queues its import by the ref alone, with
 *               nothing from the payload.
 *   scope       a Zoom grant wider than asked is overreach; Meet transcripts
 *               need `meetings.space.readonly` and nothing else grants them.
 *   consent     no recording consent, no audio work; Axal's notice is at
 *               /privacy/interviews; an upload needs the founder's attestation.
 *   metering    speech-to-text is charged on the AI token ledger by the audio's
 *               minutes, and refused, with no model call, without AI tokens.
 *   purge       a call's audio past its founder's retention goes; the text,
 *               the recorder's audio and a young call stay.
 *
 * These certify code behaviour, not the Zoom app, Google's verification or an
 * operator's switch-on (`documentation/operations/ZOOM_AND_MEET_TRANSCRIPTS.md`).
 * M1's Zoom audio (#2517, D870) adds its gates here when it merges.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/meeting_readiness_d877.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import * as zoom from '../src/services/channels/zoom.ts';
import * as googleMeet from '../src/services/channels/googleMeet.ts';
import * as connectorRules from '../src/integrations/connectorRules.ts';
import * as interviewSessions from '../src/services/interviewSessions.ts';
import * as consentNotice from '../src/services/channels/consentNotice.ts';
import * as interviewProcessing from '../src/services/interviewProcessing.ts';
import * as callAudioRetention from '../src/services/callAudioRetention.ts';
import sessionsRouter from '../src/routes/founder_validate_sessions.ts';
import { getDescriptor } from '../src/integrations/registry.ts';
import { world, ME, INTERVIEW as W_INTERVIEW, PROJECT as W_PROJECT } from './_channels_fixture.ts';
import { FOUNDER, INTERVIEW, JWT_SECRET, NOW, PROJECT, chunkCount, fixture, objectsOf, seed, segmentCount } from './_call_audio_fixture.ts';

type Api = {
  zoom: typeof zoom; googleMeet: typeof googleMeet; connectorRules: typeof connectorRules;
  interviewSessions: typeof interviewSessions; consentNotice: typeof consentNotice;
  interviewProcessing: typeof interviewProcessing; callAudioRetention: typeof callAudioRetention;
  sessions: { default: typeof sessionsRouter };
};
const original: Api = {
  zoom, googleMeet, connectorRules, interviewSessions, consentNotice, interviewProcessing, callAudioRetention,
  sessions: { default: sessionsRouter },
};

const WEBHOOK_SECRET = 'd877-readiness-webhook-secret';
const quiet = async <T>(f: () => Promise<T>) => {
  const s = [console.warn, console.error, console.info];
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await f(); } finally { [console.warn, console.error, console.info] = s; }
};
function signed(body: string, { ts = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET } = {}) {
  const sig = createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  return new Headers({ 'x-zm-signature': `v0=${sig}`, 'x-zm-request-timestamp': String(ts), 'content-type': 'application/json' });
}

// ─────────────────────────────────────────────────────────────────── the gates

async function signature(api = original) {
  const body = '{"event":"meeting.ended","payload":{"object":{"id":"1"}}}';
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  assert.equal(await api.zoom.verifyZoomSignature(WEBHOOK_SECRET, body, signed(body, { ts }), now), 'ok');
  assert.equal(await api.zoom.verifyZoomSignature(WEBHOOK_SECRET, body, signed(body, { ts, secret: 'not-the-secret' }), now), 'mismatch');
  assert.equal(await api.zoom.verifyZoomSignature(WEBHOOK_SECRET, body + ' ', signed(body, { ts }), now), 'mismatch');
  assert.equal(await api.zoom.verifyZoomSignature(WEBHOOK_SECRET, body, new Headers(), now), 'missing');
  assert.equal(await api.zoom.verifyZoomSignature(WEBHOOK_SECRET, body, signed(body, { ts: ts - 6 * 60 }), now), 'stale');
}

async function tenancy(api = original) {
  const w = await world({ seed: true });
  try {
    const env = { ...w.env, ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_SECRET };
    w.db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
                  VALUES ('d877-call', ?, ?, ?, 'video', 'draft', 'given')`).run(W_INTERVIEW, W_PROJECT, ME);
    const sid = Number((w.db.prepare(`SELECT id FROM interview_sessions WHERE uid = 'd877-call'`).get() as any).id);
    w.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, status)
                  VALUES ('d877-ref', 'zoom', '8800001', ?, ?, ?, 'ended')`).run(sid, W_INTERVIEW, ME);
    const hook = (id: string, extra: Record<string, unknown> = {}) => {
      const body = JSON.stringify({ event: 'recording.transcript_completed', event_ts: 1, payload: { account_id: 'someone-else', ...extra, object: { id, uuid: `u-${id}` } } });
      return quiet(() => api.zoom.handleZoomWebhook(env, body, signed(body)));
    };
    const events = () => Number((w.db.prepare('SELECT COUNT(*) AS n FROM channel_events').get() as any).n);
    // A meeting Axal did not schedule: ignored, nothing claimed, nothing queued.
    const unknown = await hook('9999999');
    assert.deepEqual(unknown, { status: 200, body: { ok: true, ignored: 'unknown_meeting' } });
    assert.equal(events(), 0);
    assert.equal(w.queued.length, 0);
    // A known meeting: the import is queued by the ref alone, whoever the payload names.
    const known = await hook('8800001', { user_id: 'payload-user' });
    assert.equal(known.status, 200, JSON.stringify(known.body));
    assert.equal(w.queued.length, 1);
    const job = JSON.stringify(w.queued[0]);
    assert.ok(job.includes('d877-ref'), 'the job names the ref');
    assert.ok(!job.includes('someone-else') && !job.includes('payload-user'), 'nothing from the payload rides on the job');
  } finally {
    w.db.close();
  }
}

async function scope(api = original) {
  const zoomDesc = getDescriptor('zoom')!;
  assert.ok(zoomDesc, 'Zoom is a registered connector');
  assert.equal(api.connectorRules.hasScopeOverreach(zoomDesc, zoomDesc.oauth_scopes || []), false, 'exactly what was asked is not overreach');
  assert.equal(api.connectorRules.hasScopeOverreach(zoomDesc, [...(zoomDesc.oauth_scopes || []), 'meeting:write:admin']), true);
  assert.equal(api.connectorRules.hasScopeOverreach(zoomDesc, ['recording:read']), true, 'a classic scope Axal did not ask for');
  const calendarOnly = 'https://www.googleapis.com/auth/calendar.events';
  assert.equal(api.googleMeet.transcriptAccess({ userId: 1, scope: calendarOnly }), 'missing');
  assert.equal(api.googleMeet.transcriptAccess({ userId: 1, scope: `${calendarOnly} ${api.googleMeet.MEET_TRANSCRIPT_SCOPE}` }), 'granted');
  assert.match(api.googleMeet.MEET_TRANSCRIPT_SCOPE, /\/meetings\.space\.readonly$/, 'Meet transcripts are read-only');
}

async function consent(api = original) {
  // No recording consent: no audio work on a call, recorded or uploaded.
  for (const status of ['not_recorded', 'declined']) {
    assert.ok(api.interviewSessions.consentBlocks('video', status, { hasAudio: true, submittedVia: null }));
    assert.ok(api.interviewSessions.consentBlocks('video', status, { hasAudio: true, submittedVia: 'upload' }));
  }
  assert.equal(api.interviewSessions.consentBlocks('video', 'given', { hasAudio: true, submittedVia: 'upload' }), null);
  // Axal's recording notice, which every in-chat notice links to (consentNotice.ts).
  assert.equal(api.consentNotice.CONSENT_NOTICE_PATH, '/privacy/interviews');
  assert.match(String(api.consentNotice.consentNoticeUrl({ PUBLIC_BASE_URL: 'https://axal.vc', APP_URL: 'https://app.axal.vc' } as any)), /^https:\/\/axal\.vc\/privacy\/interviews(\?|$)/);
  // An upload needs the founder's word that everyone recorded agreed.
  const w = fixture();
  const app = new Hono();
  app.route('/api/founder/validate', api.sessions.default as any);
  const tok = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const open = async (attestation: unknown) => {
    const res = await quiet(() => app.fetch(new Request('http://x/api/founder/validate/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: PROJECT, interview_id: INTERVIEW, channel: 'video', source: 'upload', duration_ms: 60_000, ...(attestation === undefined ? {} : { attestation }) }),
    }), w.env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  for (const bad of [undefined, { agreed: false, method: 'written' }, { agreed: true, method: 'assumed' }]) {
    const r = await open(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.detail, 'attestation_required');
  }
  const ok = await open({ agreed: true, method: 'written' });
  assert.ok(ok.status === 200 || ok.status === 201, JSON.stringify(ok.body));
}

async function metering(api = original) {
  const run = async (monthMicro: number) => {
    const w = fixture({ monthMicro });
    const id = seed(w, { ageDays: 0, chunks: 1 });
    // One minute of the upload format: 16 kHz mono 16-bit PCM after a 44-byte header.
    const bytes = 44 + 32_000 * 60;
    const key = (w.db.prepare('SELECT r2_key FROM interview_session_chunks WHERE session_id = ?').get(id) as any).r2_key;
    w.objects.set(key, new Uint8Array(bytes));
    w.db.prepare('UPDATE interview_session_chunks SET size_bytes = ? WHERE session_id = ?').run(bytes, id);
    const chunk = w.db.prepare('SELECT seq, r2_key, mime, size_bytes, start_ms FROM interview_session_chunks WHERE session_id = ?').get(id) as any;
    const r = await quiet(() => api.interviewProcessing.transcribeChunk(w.env, {
      session: { language: null, submitted_via: 'upload' }, userId: FOUNDER, chunk, model: '@cf/openai/whisper-large-v3-turbo',
      intervieweeName: 'Dana', offsetMs: 0,
    }));
    const charged = Number((w.db.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS c FROM ai_usage_logs').get() as any).c);
    return { r, charged, stt: w.stt.length };
  };
  const paid = await run(500_000_000);
  assert.equal(paid.r.ok, true, JSON.stringify(paid.r));
  assert.equal(paid.stt, 1);
  assert.ok(paid.charged > 0, 'the minute is charged on the AI token ledger');
  const broke = await run(0);
  assert.equal(broke.r.ok, false);
  assert.equal((broke.r as any).budget, true, 'refused for AI tokens, and says so');
  assert.equal(broke.stt, 0, 'no model call without AI tokens');
}

async function purge(api = original) {
  const w = fixture();
  const old = seed(w, { kind: 'zoom', ageDays: 31 });
  const young = seed(w, { kind: 'upload', ageDays: 29 });
  const recorder = seed(w, { kind: 'recorder', ageDays: 400 });
  await quiet(() => api.callAudioRetention.purgeExpiredCallAudio(w.env, NOW));
  assert.equal(chunkCount(w, old), 0);
  assert.equal(objectsOf(w, old), 0);
  assert.equal(segmentCount(w, old), 1, 'the text stays');
  assert.equal(chunkCount(w, young), 2);
  assert.equal(chunkCount(w, recorder), 2);
}

const cases = { signature, tenancy, scope, consent, metering, purge };
for (const [name, check] of Object.entries(cases)) test('D877 readiness: ' + name, () => check());

// ───────────────────────────────────────────────────────── isolated mutations
// As in D861 (whatsapp_readiness_d861): a source file is read, one gate is
// changed in memory, and the mutant is imported from a data: URL. No tracked
// file changes. The mutant must fail its gate; the real module must pass.
// (#2535 moves this helper into a shared harness; this copy follows it there.)
let serial = 0;
async function mutate(path: string, before: string, after: string) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8');
  assert.equal(source.split(before).length, 2, 'one mutation target');
  const { stripTypeScriptTypes } = await import('node:module');
  let changed = stripTypeScriptTypes(source.replace(before, () => after), { mode: 'strip' });
  changed = changed.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => prefix + (spec.startsWith('.')
      ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href
      : import.meta.resolve(spec)) + quote);
  return import('data:text/javascript;base64,' + Buffer.from(changed + '\n// D877 ' + ++serial).toString('base64'));
}

const mutations: Array<[string, keyof Api, string, string, string, (a: Api) => Promise<void>]> = [
  ['signature accepts a mismatch', 'zoom', 'services/channels/zoom.ts',
    "expected) ? 'ok' : 'mismatch';", "expected) ? 'ok' : 'ok';", signature],
  ['signature ignores the clock', 'zoom', 'services/channels/zoom.ts',
    "if (Math.abs(now - tsMs) > SIGNATURE_WINDOW_MS) return 'stale';", '', signature],
  ['an unscheduled meeting is taken', 'zoom', 'services/channels/zoom.ts',
    "const ref = meetingId ? await refByExternal(env, 'zoom', meetingId) : null;",
    "const ref = (meetingId ? await refByExternal(env, 'zoom', meetingId) : null) ?? await env.DB.prepare(\"SELECT * FROM interview_channel_refs WHERE provider = 'zoom' LIMIT 1\").first();",
    tenancy],
  ['the payload rides on the job', 'zoom', 'services/channels/zoom.ts',
    'refUid: ref.uid, meetingUuid: uuid || null,', 'refUid: ref.uid, meetingUuid: uuid || null, accountId: event.payload?.account_id,', tenancy],
  ['a wider grant is accepted', 'connectorRules', 'integrations/connectorRules.ts',
    'return granted.some((scope) => !requested.has(scope.toLowerCase()));', 'return false;', scope],
  ['Meet transcripts without the scope', 'googleMeet', 'services/channels/googleMeet.ts',
    "return scopes.includes(MEET_TRANSCRIPT_SCOPE) ? 'granted' : 'missing';", "return 'granted';", scope],
  ['audio work without consent', 'interviewSessions', 'services/interviewSessions.ts',
    "if (consentStatus === 'given') return null;", "if (consentStatus !== 'nobody') return null;", consent],
  ['the notice moved', 'consentNotice', 'services/channels/consentNotice.ts',
    "export const CONSENT_NOTICE_PATH = '/privacy/interviews';", "export const CONSENT_NOTICE_PATH = '/privacy';", consent],
  ['an upload without attestation', 'sessions', 'routes/founder_validate_sessions.ts',
    "if (body?.attestation?.agreed !== true || !(UPLOAD_ATTESTATIONS as readonly string[]).includes(method)) {",
    'if (false) {', consent],
  ['speech-to-text uncharged', 'interviewProcessing', 'services/interviewProcessing.ts',
    'audioMinutes: chunkAudioMinutes(opts.chunk, opts.session),', 'audioMinutes: 0,', metering],
  ['a budget refusal hidden', 'interviewProcessing', 'services/interviewProcessing.ts',
    "const budget = String(r.refusal || '').startsWith('budget') || r.refusal === 'spend_limit';", 'const budget = false;', metering],
  ['the purge keeps audio forever', 'callAudioRetention', 'services/callAudioRetention.ts',
    '>= COALESCE(m.call_audio_retention_days, ?2)', '>= COALESCE(m.call_audio_retention_days, ?2) * 1000', purge],
  ['the purge takes the recorder\'s audio', 'callAudioRetention', 'services/callAudioRetention.ts',
    "AND (s.submitted_via = 'upload' OR EXISTS (SELECT 1 FROM interview_channel_refs r WHERE r.session_id = s.id))", '', purge],
  ['the purge takes a young call', 'callAudioRetention', 'services/callAudioRetention.ts',
    '>= COALESCE(m.call_audio_retention_days, ?2)', '>= 0', purge],
];
for (const [name, key, file, before, after, check] of mutations) {
  test('D877 mutation: ' + name, async () => {
    const module = await mutate('../src/' + file, before, after);
    await assert.rejects(() => check({ ...original, [key]: module }), { name: 'AssertionError' });
    await check(original);
  });
}
