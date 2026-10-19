/**
 * D754 way B, "Send to Axal" part 2 (#1938, wb2) — recordings a linked member
 * forwards to Axal's number wait, as encrypted media ids only, until the
 * member answers whether everyone recorded agreed. On the SQLite D1 harness;
 * Graph is mocked so that only a send from Axal's number answers, so any
 * media download fails the test: these prove nothing is ever fetched.
 *
 * What these prove:
 *   · Two forwarded voice notes make one capture and one question, with three
 *     buttons that carry the capture's uid; no media id is in clear.
 *   · "Yes, out loud" / "Yes, in writing" write one `channel_consents` row
 *     (member_attested, verbal | written) and mark the capture consented; a
 *     replayed or second press does nothing more.
 *   · "No" deletes the capture; so does `fetch_by`, in the purge, with its
 *     consent rows; STOP drops the captures still waiting.
 *   · The 21st file, or one past the 30 minutes, opens a new capture.
 *   · A file declared over 5 MB, an image, a PDF document get one reply each
 *     and no capture; an audio document joins one.
 *   · An unlinked sender's recording is ignored, with no reply.
 *   · "Agreed beforehand" through the route; another member's capture is 404.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_capture_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXAL_PNID, AXAL_TOKEN, ME, OTHER, SENDER, SENDER_2, call, count, everyValue, lastEvent, link, mockGraph, now, seen, waHook, world,
} from './_whatsapp_axal_fixture.ts';
import { purgeExpired } from '../src/services/channels/threads.ts';
import { captureItems } from '../src/services/channels/whatsappCapture.ts';

let msgId = 0;
const waMessage = (message: Record<string, unknown>, from = SENDER, id = `wamid.CAP${++msgId}`) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '3000002', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: AXAL_PNID },
    contacts: [{ profile: { name: 'Dana Ruiz' }, wa_id: from }],
    messages: [{ from, id, timestamp: String(now()), ...message }],
  } }] }],
});
const voice = (mediaId: string, o: { size?: number; from?: string; id?: string } = {}) =>
  waMessage({ type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true, ...(o.size != null ? { file_size: o.size } : {}) } }, o.from, o.id);
const documentMsg = (mediaId: string, mime: string) => waMessage({ type: 'document', document: { id: mediaId, mime_type: mime, filename: 'call.m4a' } });
const press = (buttonId: string, o: { from?: string; id?: string } = {}) =>
  waMessage({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } } }, o.from, o.id);

const captures = (db: any) => db.prepare('SELECT * FROM whatsapp_captures ORDER BY id').all();
const consents = (db: any) => db.prepare('SELECT * FROM channel_consents ORDER BY id').all();

test.afterEach(() => {
  const all = seen.join('\n');
  for (const s of [AXAL_TOKEN, SENDER, SENDER_2, 'MEDIA-']) assert.equal(all.includes(s), false, 'a secret, a number or a media id reached a response');
  seen.length = 0;
});

test('two voice notes make one capture and one question; "Yes, out loud" records the consent; nothing is downloaded', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1', { size: 40_000 }));
    await waHook(env, voice('MEDIA-2'));
    const [cap] = captures(db);
    assert.equal(captures(db).length, 1);
    assert.equal(cap.status, 'waiting');
    assert.equal(cap.item_count, 2);
    assert.equal(cap.user_id, ME);
    const fetchBy = Date.parse(cap.fetch_by) - Date.parse(cap.created_at);
    assert.ok(Math.abs(fetchBy - 7 * 86_400_000) < 5_000, 'fetch_by is the first file plus seven days');
    assert.deepEqual(await captureItems(env, cap), [
      { id: 'MEDIA-1', mime: 'audio/ogg; codecs=opus', size: 40_000, type: 'audio' },
      { id: 'MEDIA-2', mime: 'audio/ogg; codecs=opus', size: null, type: 'audio' },
    ]);
    assert.equal(everyValue(db).includes('MEDIA-'), false, 'media ids are encrypted');

    assert.equal(g.sent.length, 2, 'the link reply, then one question');
    const q = g.sent[1];
    assert.equal(q.to, SENDER);
    assert.equal(q.auth, `Bearer ${AXAL_TOKEN}`);
    assert.equal(q.body.type, 'interactive');
    assert.equal(q.text, 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?');
    assert.deepEqual(q.body.interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title]), [
      [`capture_verbal:${cap.uid}`, 'Yes, out loud'], [`capture_written:${cap.uid}`, 'Yes, in writing'], [`capture_no:${cap.uid}`, 'No'],
    ]);
    assert.equal(db.prepare('SELECT client_key FROM channel_outbound ORDER BY id DESC LIMIT 1').get().client_key, `wbcapture:${cap.uid}`);

    const yes = press(`capture_verbal:${cap.uid}`);
    await waHook(env, yes);
    const [consent] = consents(db);
    assert.equal(consents(db).length, 1);
    assert.deepEqual(
      { source: consent.source, method: consent.method, status: consent.status, capture_id: consent.capture_id, user_id: consent.user_id, provider: consent.provider },
      { source: 'member_attested', method: 'verbal', status: 'given', capture_id: cap.id, user_id: ME, provider: 'whatsapp' },
    );
    assert.ok(consent.answered_at);
    const after = captures(db)[0];
    assert.equal(after.status, 'consented');
    assert.equal(after.consent_id, consent.id);

    // A redelivery and a second press do nothing more.
    await waHook(env, yes);
    await waHook(env, press(`capture_written:${cap.uid}`));
    assert.equal(lastEvent(db).error, 'capture_not_waiting');
    assert.equal(consents(db).length, 1);
    assert.equal(consents(db)[0].method, 'verbal');
    assert.equal(g.sent.length, 2, 'no further message');
    assert.ok(g.sent.every((s) => s.url.endsWith(`/${AXAL_PNID}/messages`)), 'nothing but sends: no media was fetched');
  } finally { g.restore(); }
});

test('"Yes, in writing" records method written', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    await waHook(env, press(`capture_written:${captures(db)[0].uid}`));
    assert.equal(consents(db)[0].method, 'written');
  } finally { g.restore(); }
});

test('"No" deletes the capture, and nothing was downloaded', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    await waHook(env, press(`capture_no:${captures(db)[0].uid}`));
    assert.equal(captures(db).length, 0);
    assert.equal(consents(db).length, 0);
    assert.equal(lastEvent(db).status, 'done');
  } finally { g.restore(); }
});

test('no answer by fetch_by: the purge deletes the capture, and a consented one not imported, with its consent', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    const [waiting] = captures(db);
    db.prepare(`UPDATE whatsapp_captures SET created_at = '2020-01-01T00:00:00.000Z'`).run();
    await waHook(env, voice('MEDIA-2'));
    const second = captures(db)[1];
    await waHook(env, press(`capture_verbal:${second.uid}`));
    assert.equal(consents(db).length, 1);

    assert.equal((await purgeExpired(env)).captures, 0, 'nothing is due yet');
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE whatsapp_captures SET fetch_by = ?').run(past);
    // An answer after fetch_by does nothing: the files can no longer be fetched.
    await waHook(env, press(`capture_verbal:${waiting.uid}`));
    assert.equal(lastEvent(db).error, 'capture_not_waiting');
    assert.equal((await purgeExpired(env)).captures, 2);
    assert.equal(captures(db).length, 0);
    assert.equal(consents(db).length, 0);
  } finally { g.restore(); }
});

test('the 21st file opens a new capture with its own question; so does a file after 30 minutes', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    for (let i = 1; i <= 21; i++) await waHook(env, voice(`MEDIA-${i}`));
    assert.deepEqual(captures(db).map((c: any) => c.item_count), [20, 1]);
    assert.equal(g.sent.filter((s) => s.body.type === 'interactive').length, 2);

    db.prepare(`UPDATE whatsapp_captures SET created_at = ? WHERE id = ?`).run(new Date(Date.now() - 31 * 60_000).toISOString(), captures(db)[1].id);
    await waHook(env, voice('MEDIA-22'));
    assert.deepEqual(captures(db).map((c: any) => c.item_count), [20, 1, 1]);

    // An answered capture takes nothing more.
    await waHook(env, press(`capture_verbal:${captures(db)[2].uid}`));
    await waHook(env, voice('MEDIA-23'));
    assert.deepEqual(captures(db).map((c: any) => c.item_count), [20, 1, 1, 1]);
  } finally { g.restore(); }
});

test('over 5 MB declared, an image and a PDF get one reply each; an audio document joins a capture', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-BIG', { size: 6 * 1024 * 1024 }));
    assert.equal(lastEvent(db).error, 'too_large');
    assert.equal(g.sent.at(-1)!.text, 'This recording is larger than Axal can take from WhatsApp (5 MB). Record it with the in-app recorder instead.');
    await waHook(env, waMessage({ type: 'image', image: { id: 'MEDIA-IMG', mime_type: 'image/jpeg' } }));
    assert.equal(g.sent.at(-1)!.text, 'Axal takes voice notes and audio files here.');
    await waHook(env, documentMsg('MEDIA-PDF', 'application/pdf'));
    assert.equal(g.sent.at(-1)!.text, 'Axal takes voice notes and audio files here.');
    assert.equal(lastEvent(db).error, 'unsupported_type');
    assert.equal(g.sent.length, 4, 'the link reply and one reply each');
    assert.equal(captures(db).length, 0);

    await waHook(env, documentMsg('MEDIA-M4A', 'audio/x-m4a'));
    assert.equal(captures(db).length, 1);
    assert.deepEqual((await captureItems(env, captures(db)[0]))!.map((i) => i.type), ['document']);
  } finally { g.restore(); }
});

test("an unlinked sender's recording is ignored: no reply, no capture", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await waHook(env, voice('MEDIA-1', { from: SENDER_2 }));
    assert.equal(lastEvent(db).error, 'unlinked_sender');
    assert.equal(captures(db).length, 0);
    assert.equal(g.sent.length, 0);
  } finally { g.restore(); }
});

test("a button for another link's capture does nothing; STOP drops the captures still waiting", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env, ME, SENDER);
    await link(env, OTHER, SENDER_2);
    await waHook(env, voice('MEDIA-1', { from: SENDER }));
    const mine = captures(db)[0];
    await waHook(env, press(`capture_verbal:${mine.uid}`, { from: SENDER_2 }));
    assert.equal(lastEvent(db).error, 'capture_not_waiting');
    assert.equal(captures(db)[0].status, 'waiting');

    await waHook(env, voice('MEDIA-2', { from: SENDER_2 }));
    await waHook(env, press(`capture_verbal:${captures(db)[1].uid}`, { from: SENDER_2 }));
    await waHook(env, waMessage({ type: 'text', text: { body: 'STOP' } }, SENDER));
    assert.deepEqual(captures(db).map((c: any) => [c.user_id, c.status]), [[OTHER, 'consented']], "ME's waiting capture is gone");
  } finally { g.restore(); }
});

test('"Agreed beforehand" in Axal; another member\'s capture is not there; the list carries no media id', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    const uid = captures(db)[0].uid;

    const list = await call(env, ME, 'GET', '/whatsapp/captures');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((c: any) => [c.uid, c.item_count, c.status]), [[uid, 1, 'waiting']]);
    assert.deepEqual((await call(env, OTHER, 'GET', '/whatsapp/captures')).body.items, []);

    assert.equal((await call(env, ME, 'POST', `/whatsapp/captures/${uid}/consent`, { method: 'any' })).status, 400);
    const theirs = await call(env, OTHER, 'POST', `/whatsapp/captures/${uid}/consent`, { method: 'pre_agreed' });
    assert.equal(theirs.status, 404);
    assert.equal(theirs.body.code, 'capture_not_waiting');

    const ok = await call(env, ME, 'POST', `/whatsapp/captures/${uid}/consent`, { method: 'pre_agreed' });
    assert.deepEqual(ok.body, { ok: true, status: 'consented' });
    assert.equal(consents(db)[0].method, 'pre_agreed');
    assert.equal(consents(db)[0].source, 'member_attested');
    assert.equal((await call(env, ME, 'POST', `/whatsapp/captures/${uid}/consent`, { method: 'pre_agreed' })).status, 404, 'once');
    assert.equal(consents(db).length, 1);
    const after = (await call(env, ME, 'GET', '/whatsapp/captures')).body.items[0];
    assert.deepEqual([after.status, after.consent_method], ['consented', 'pre_agreed']);
  } finally { g.restore(); }
});

test('with Axal\'s number not set up, the capture routes are 503 and a forward is ignored', async () => {
  const { env, db } = world({ axal: { WHATSAPP_AXAL_ACCESS_TOKEN: '' } });
  const g = mockGraph();
  try {
    assert.equal((await call(env, ME, 'GET', '/whatsapp/captures')).status, 503);
    assert.equal((await call(env, ME, 'POST', '/whatsapp/captures/x/consent', { method: 'pre_agreed' })).status, 503);
    await waHook(env, voice('MEDIA-1'));
    assert.equal(lastEvent(db).error, 'not_available');
    assert.equal(captures(db).length, 0);
    assert.equal(g.sent.length, 0);
  } finally { g.restore(); }
});

test('YES and NO typed to Axal\'s number are never consent replies: a linked member gets the one reply', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, voice('MEDIA-1'));
    await waHook(env, waMessage({ type: 'text', text: { body: 'YES' } }));
    assert.equal(lastEvent(db).error, 'unsupported_type');
    assert.equal(captures(db)[0].status, 'waiting', 'a typed YES is not an answer for the capture');
    assert.equal(consents(db).length, 0);
  } finally { g.restore(); }
});
