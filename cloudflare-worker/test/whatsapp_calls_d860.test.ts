/**
 * D860 (#2505) — WhatsApp calls groundwork, behind WHATSAPP_CALLS (off).
 *
 * A `calls` delivery is verified like any WhatsApp POST (X-Hub-Signature-256
 * over the raw body), read into events that never carry the SDP or a name,
 * and moves nothing through the message pipeline. A ring is ignored with the
 * flag off and declined, consent first, with it on: no consent, consent under
 * a notice that does not name calls, and (until the media path is built)
 * every other case. Stubs only: no Meta call, no number or secret of anyone's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/whatsapp_calls_d860.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { verifyWhatsAppSignature, normaliseWhatsAppPayload } from '../src/services/channels/whatsapp.ts';
import {
  CALL_NOTICE_VERSIONS, RECORDING_RULE, decideCall, normaliseCallEvents, whatsappCallsEnabled,
} from '../src/services/channels/whatsappCalls.ts';

const APP_SECRET = 'd860-fixture-app-secret';
const NUMBER_ID = '100000000000001';
const CONTACT = '15550000001';
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

const connect = (over: Record<string, unknown> = {}) => ({
  id: 'wacid.fixture-1', from: CONTACT, to: NUMBER_ID, event: 'connect', direction: 'USER_INITIATED',
  timestamp: '1792000000', session: { sdp_type: 'offer', sdp: SDP }, ...over,
});
const delivery = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba-fixture', changes: [{ field: 'calls', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMBER_ID, display_phone_number: '15550000000' }, ...value } }] }],
});
const on = { WHATSAPP_CALLS: 'true' } as any;
const off = {} as any;
const given = (notice_version: number | null = 1) => ({ status: 'given' as const, notice_version });

test('D860 a calls delivery is verified like any WhatsApp POST: signed passes, tampered or unsigned does not', async () => {
  const env = { WHATSAPP_APP_SECRET: APP_SECRET } as any;
  const raw = new TextEncoder().encode(JSON.stringify(delivery({ calls: [connect()] })));
  const sig = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  assert.equal(await verifyWhatsAppSignature(env, raw.buffer, sig), 'ok');
  const tampered = new TextEncoder().encode(JSON.stringify(delivery({ calls: [connect({ from: '15550000002' })] })));
  assert.equal(await verifyWhatsAppSignature(env, tampered.buffer, sig), 'mismatch');
  assert.equal(await verifyWhatsAppSignature(env, raw.buffer, null), 'missing');
  assert.equal(await verifyWhatsAppSignature({} as any, raw.buffer, sig), 'unconfigured');
});

test('D860 a calls delivery moves nothing through the message pipeline', () => {
  assert.deepEqual(normaliseWhatsAppPayload(delivery({ calls: [connect()] })), []);
});

test('D860 call events: connect, terminate and status read; the SDP is never copied', () => {
  const evs = normaliseCallEvents(delivery({
    calls: [connect(), { id: 'wacid.fixture-1', from: CONTACT, event: 'terminate', direction: 'USER_INITIATED', timestamp: '1792000060', status: 'Completed', duration: 59 }],
    statuses: [{ id: 'wacid.fixture-1', type: 'call', status: 'RINGING', recipient_id: CONTACT, timestamp: '1792000001' }],
  }));
  assert.deepEqual(evs.map((e) => [e.event, e.direction, e.hasSdp, e.status, e.durationSec]), [
    ['connect', 'user_initiated', true, null, null],
    ['terminate', 'user_initiated', false, 'COMPLETED', 59],
    ['status', null, false, 'RINGING', null],
  ]);
  assert.ok(evs.every((e) => e.callId === 'wacid.fixture-1' && e.phoneNumberId === NUMBER_ID && e.contact === CONTACT));
  assert.equal(evs[0].at, new Date(1792000000 * 1000).toISOString());
  assert.ok(!JSON.stringify(evs).includes('opus'), 'no SDP in any event');
  // A business-initiated call's other party is `to`.
  assert.equal(normaliseCallEvents(delivery({ calls: [connect({ direction: 'BUSINESS_INITIATED', from: NUMBER_ID, to: CONTACT })] }))[0].contact, CONTACT);
});

test('D860 shapes it does not know are skipped, never guessed', () => {
  assert.deepEqual(normaliseCallEvents({ ...delivery({ calls: [connect()] }), object: 'page' }), [], 'not a WhatsApp delivery');
  assert.deepEqual(normaliseCallEvents({ ...delivery({ calls: [connect()] }), entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: NUMBER_ID }, calls: [connect()] } }] }] }), []);
  assert.deepEqual(normaliseCallEvents(delivery({ metadata: {}, calls: [connect()] })), [], 'no number id');
  assert.deepEqual(normaliseCallEvents(delivery({ calls: [connect({ id: '' }), connect({ event: 'ring' })] })), []);
  assert.deepEqual(normaliseCallEvents(delivery({ statuses: [{ id: 'm1', type: 'message', status: 'read' }] })), []);
  assert.deepEqual(normaliseCallEvents(delivery({ calls: [connect({ session: { sdp_type: 'offer' } }), connect({ session: { sdp: '' } })] })).map((e) => e.hasSdp), [false, false], 'a session with no SDP is no offer');
  const bad = normaliseCallEvents(delivery({ calls: [{ id: 'c', event: 'terminate', duration: -3, status: 'not a word!' }] }))[0];
  assert.deepEqual([bad.durationSec, bad.status, bad.direction], [null, null, null]);
});

test('D860 the flag: off unless exactly "true", and off ignores every ring', () => {
  assert.equal(whatsappCallsEnabled(off), false);
  assert.equal(whatsappCallsEnabled({ WHATSAPP_CALLS: 'TRUE' } as any), false);
  assert.equal(whatsappCallsEnabled(on), true);
  const wrangler = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const lines = wrangler.match(/^WHATSAPP_CALLS = .*$/gm) || [];
  assert.equal(lines.length, 3, 'top-level, production and preview vars');
  assert.ok(lines.every((l) => l === 'WHATSAPP_CALLS = "false"'));
  assert.deepEqual(decideCall(off, { event: 'connect', direction: 'user_initiated', hasSdp: true }, given(1), new Set([1])), { action: 'ignore', reason: 'calls_off' });
});

test('D860 consent first: a ring is declined without consent, and with consent under a notice that does not name calls', () => {
  const ring = { event: 'connect' as const, direction: 'user_initiated' as const, hasSdp: true };
  assert.deepEqual(decideCall(on, { ...ring, event: 'terminate' }, given()), { action: 'ignore', reason: 'not_a_ring' });
  assert.deepEqual(decideCall(on, { ...ring, direction: 'business_initiated' }, given()), { action: 'ignore', reason: 'not_a_ring' });
  assert.deepEqual(decideCall(on, { ...ring, hasSdp: false }, given()), { action: 'decline', reason: 'no_offer' });
  for (const consent of [null, { status: 'not_asked' as const, notice_version: null }, { status: 'requested' as const, notice_version: 1 },
    { status: 'declined' as const, notice_version: 1 }, { status: 'withdrawn' as const, notice_version: 1 }]) {
    assert.deepEqual(decideCall(on, ring, consent, new Set([1])), { action: 'decline', reason: 'no_consent' }, String(consent?.status));
  }
  assert.deepEqual(decideCall(on, ring, given(1)), { action: 'decline', reason: 'notice_not_for_calls' }, 'no notice names calls yet');
  assert.deepEqual(decideCall(on, ring, given(null), new Set([1])), { action: 'decline', reason: 'notice_not_for_calls' });
  assert.deepEqual(decideCall(on, ring, given(2), new Set([1])), { action: 'decline', reason: 'notice_not_for_calls' });
  assert.deepEqual(decideCall(on, ring, given(1), new Set([1])), { action: 'decline', reason: 'not_built' }, 'nothing answers a call yet');
});

test('D860 the defaults: no notice names calls, and every party is told', () => {
  assert.equal(CALL_NOTICE_VERSIONS.size, 0);
  assert.equal(RECORDING_RULE, 'all_party');
});
