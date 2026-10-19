/**
 * D754 way B, "Send to Axal" part 1 (#1937, wb1) — a member links their own
 * WhatsApp through Axal's own number, proven from both sides, on the SQLite
 * D1 harness. Graph is a mocked `globalThis.fetch` with fixture ids: an
 * unexpected URL fails the test, and nothing reaches Meta.
 *
 * What these prove:
 *   · Migration 492 keeps every Telegram code and index through its rebuild,
 *     admits 'whatsapp_link' codes, and allows one active link per number and
 *     one per member.
 *   · The link: a code; `LINK <code>` from the sender records the claim and
 *     sends one reply from Axal's number with Axal's token; Axal's confirm
 *     makes the link, with an HMAC and a mask and no clear number anywhere in
 *     the database; a replayed webhook sends nothing more.
 *   · Refusals: an expired, spent or wrong code gets no reply (a wrong one is
 *     counted); the hourly limits per sender and per member; another member's
 *     claim is 404; a number another member holds is refused; with any one of
 *     the four Axal settings unset every route is 503 and the webhook sends
 *     nothing.
 *   · Unlinking: STOP with one reply, DELETE, and the 180-day lapse.
 *   · An unlinked sender's message gets no reply and stores no text.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_axal_link_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXAL, AXAL_PNID, AXAL_TOKEN, ME, MEMBER_PNID, OTHER, SECRETS, SENDER, SENDER_2,
  call, count, everyValue, lastEvent, link, mig, mockGraph, now, refCode, seen, waHook, waText, world,
} from './_whatsapp_axal_fixture.ts';
import { decryptCredentials } from '../src/integrations/secrets.ts';
import { purgeExpired } from '../src/services/channels/threads.ts';
import { senderRef } from '../src/services/channels/whatsappLink.ts';
import { indexHmac } from '../src/services/columnCipher.ts';

test.afterEach(() => {
  const all = seen.join('\n');
  for (const s of [AXAL_TOKEN, SECRETS.WHATSAPP_APP_SECRET, SENDER, SENDER_2]) assert.equal(all.includes(s), false, 'a secret or a number reached a response');
  seen.length = 0;
});

// ---------------------------------------------------------------------------
// Migration 492
// ---------------------------------------------------------------------------

test('492: Telegram codes and their indexes survive the rebuild; whatsapp_link codes insert; nothing else does', () => {
  const { db } = world({ upTo492: false });
  db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at, used_at, telegram_user_id, confirmed_at,
      claim_details_enc, axal_confirmed_at, activated_at, cancelled_at)
    VALUES ('tg-code', 'h1', ?, 'telegram', '2099-01-01T00:00:00.000Z', '2026-10-01 00:00:00', '555001', '2026-10-01 00:01:00',
      'v1.x', '2026-10-01 00:02:00', '2026-10-01 00:03:00', NULL)`).run(ME);
  const before = db.prepare('SELECT * FROM channel_link_codes').all();
  db.exec(mig('492_whatsapp_sender_links.sql'));
  assert.deepEqual(db.prepare('SELECT * FROM channel_link_codes').all(), before, 'every column of a Telegram code survives');
  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'channel_link_codes' AND name LIKE 'idx_%' ORDER BY name`)
    .all().map((r: any) => r.name);
  assert.deepEqual(indexes, ['idx_channel_link_codes_member', 'idx_channel_link_codes_tg_user', 'idx_channel_link_codes_user']);
  db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES ('wa-code', 'h2', ?, 'whatsapp_link', '2099-01-01')`).run(ME);
  assert.throws(() => db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES ('x', 'h3', ?, 'sms', '2099-01-01')`).run(ME),
    /CHECK constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES ('wa-code', 'h4', ?, 'whatsapp_link', '2099-01-01')`).run(ME),
    /UNIQUE constraint failed/, 'uid is still unique');
});

test('492: one active link per number, one link per member; a disconnected link holds nothing', () => {
  const { db } = world();
  const add = (uid: string, user: number, ext: string, status = 'active') => db.prepare(
    `INSERT INTO integrations (uid, user_id, provider_key, auth_type, status, external_account_id) VALUES (?, ?, 'whatsapp_link', 'webhook', ?, ?)`,
  ).run(uid, user, status, ext);
  add('l1', ME, 'hmac-a');
  assert.throws(() => add('l2', OTHER, 'hmac-a'), /UNIQUE constraint failed/, 'a second member for one number');
  assert.throws(() => add('l3', ME, 'hmac-b'), /UNIQUE constraint failed/, 'a second number for one member');
  db.prepare(`UPDATE integrations SET status = 'disconnected' WHERE uid = 'l1'`).run();
  add('l4', OTHER, 'hmac-a');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM integrations WHERE external_account_id = 'hmac-a'`), 2);
  // A member's own WhatsApp Business number is not this index's business.
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id) VALUES ('wa', ?, 'whatsapp', 'oauth2', 'hmac-a')`).run(OTHER);
});

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

test('a code, LINK from the sender, one reply, Axal confirms: the link holds an HMAC and a mask, and no clear number anywhere', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const made = await call(env, ME, 'POST', '/whatsapp/link');
    assert.equal(made.status, 200);
    assert.match(made.body.code, /^[A-Za-z0-9]{24}$/);
    assert.equal(made.body.wa_link, `https://wa.me/15550009999?text=LINK%20${made.body.code}`);
    assert.ok(Date.parse(made.body.expires_at) > Date.now());
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM channel_link_codes WHERE code_hash = ? AND provider = 'whatsapp_link'`, refCode(made.body.code)), 1);

    assert.equal((await call(env, ME, 'GET', '/whatsapp/link')).body.claim.status, 'waiting_whatsapp');

    const payload = waText(`link   ${made.body.code}`);
    assert.equal((await waHook(env, payload)).status, 200);
    assert.equal(g.sent.length, 1, 'one reply');
    const { body: _sent, ...first } = g.sent[0];
    assert.deepEqual(first, {
      url: `https://graph.facebook.com/v23.0/${AXAL_PNID}/messages`, to: SENDER,
      text: 'Confirm in Axal to finish linking this WhatsApp.', auth: `Bearer ${AXAL_TOKEN}`,
    });
    assert.deepEqual(db.prepare(`SELECT client_key, status, user_id FROM channel_outbound`).all().map((r: any) => ({ ...r })),
      [{ client_key: `wblink:${db.prepare('SELECT uid FROM channel_link_codes').get().uid}`, status: 'submitted', user_id: ME }]);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'whatsapp_link'`), 0, 'the code alone links nothing');

    // A replayed delivery is claimed already: nothing more is sent.
    await waHook(env, payload);
    assert.equal(g.sent.length, 1, 'a replay sends no second reply');

    const view = (await call(env, ME, 'GET', '/whatsapp/link')).body;
    assert.equal(view.claim.status, 'waiting_axal');
    assert.equal(view.claim.number_masked, '•••• 0456');
    assert.equal(view.link, null);

    const ok = await call(env, ME, 'POST', `/whatsapp/link/${view.claim.uid}/confirm`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.linked, true);
    assert.equal(ok.body.link.number_masked, '•••• 0456');

    const row = db.prepare(`SELECT * FROM integrations WHERE provider_key = 'whatsapp_link'`).get();
    assert.equal(row.status, 'active');
    assert.equal(row.user_id, ME);
    assert.equal(row.external_account_id, await senderRef(env, SENDER));
    assert.match(row.external_account_id, /^[0-9a-f]{64}$/);
    assert.equal(row.external_account_name, '•••• 0456');
    assert.equal(JSON.parse(row.config_json).number_masked, '•••• 0456');
    assert.equal((await decryptCredentials(env, row.uid, row.credentials_enc))?.wa_id, SENDER, 'the id is kept, encrypted');
    assert.equal(everyValue(db).includes(SENDER), false, 'no clear number anywhere in the database');
    assert.equal(everyValue(db).includes(SENDER.slice(-7)), false, 'nor any long run of it');

    // Confirming again is idempotent.
    assert.equal((await call(env, ME, 'POST', `/whatsapp/link/${view.claim.uid}/confirm`)).status, 200);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'whatsapp_link'`), 1);
  } finally { g.restore(); }
});

test('relinking moves the member to the new number; the old one is free', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env, ME, SENDER);
    const again = await link(env, ME, SENDER_2);
    assert.equal(again.confirm.status, 200);
    const row = db.prepare(`SELECT external_account_id, credentials_enc, uid FROM integrations WHERE provider_key = 'whatsapp_link'`).get();
    assert.equal(row.external_account_id, await senderRef(env, SENDER_2));
    assert.equal((await decryptCredentials(env, row.uid, row.credentials_enc))?.wa_id, SENDER_2, 'credentials stay bound to the row');
    assert.equal((await link(env, OTHER, SENDER)).confirm.status, 200, 'the first number is free for another member');
  } finally { g.restore(); }
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test('an expired code, a spent code and a wrong code get no reply; tries are counted per sender', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const first = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    db.prepare(`UPDATE channel_link_codes SET expires_at = '2020-01-01T00:00:00.000Z'`).run();
    await waHook(env, waText(`LINK ${first}`));
    assert.equal(lastEvent(db).error, 'code_invalid');

    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, waText(`LINK ${code}`));
    assert.equal(g.sent.length, 1);
    await waHook(env, waText(`LINK ${code}`, SENDER_2));
    assert.equal(lastEvent(db).error, 'code_invalid', 'a spent code');
    const claim = db.prepare(`SELECT telegram_user_id FROM channel_link_codes WHERE code_hash = ?`).get(refCode(code));
    assert.equal(claim.telegram_user_id, await senderRef(env, SENDER), 'the second sender did not take the claim');

    await waHook(env, waText('LINK abcdefghjkmnpqrstuvwxyzA'));
    assert.equal(lastEvent(db).error, 'code_invalid');
    assert.equal(g.sent.length, 1, 'no reply to any of them');
    const tries = async (who: string) => count(db, 'SELECT n FROM channel_link_attempts WHERE subject_hash = ?',
      await indexHmac(env, 'channel_link_attempts', 'subject_hash', `whatsapp_link:sender:${who}`));
    assert.equal(await tries(SENDER), 3, 'each LINK counted on a hashed sender');
    assert.equal(await tries(SENDER_2), 1);
    assert.equal(everyValue(db).includes(SENDER), false);
  } finally { g.restore(); }
});

test('over the hourly limits: a sender after five tries, a member after ten codes', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    for (let i = 0; i < 5; i++) await waHook(env, waText('LINK abcdefghjkmnpqrstuvwxyzA'));
    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, waText(`LINK ${code}`));
    assert.equal(lastEvent(db).error, 'rate_limited');
    assert.equal(g.sent.length, 0);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM channel_link_codes WHERE used_at IS NOT NULL`), 0, 'the code is not spent');
    await waHook(env, waText(`LINK ${code}`, SENDER_2));
    assert.equal(g.sent.length, 1, 'another sender is not held back');

    for (let i = 0; i < 10; i++) assert.equal((await call(env, OTHER, 'POST', '/whatsapp/link')).status, 200);
    const over = await call(env, OTHER, 'POST', '/whatsapp/link');
    assert.equal(over.status, 429);
    assert.equal(over.body.code, 'rate_limited');
  } finally { g.restore(); }
});

test("another member's claim is not there; a number another member holds is refused on both sides", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const mine = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, waText(`LINK ${mine}`));
    const uid = (await call(env, ME, 'GET', '/whatsapp/link')).body.claim.uid;
    const theirs = await call(env, OTHER, 'POST', `/whatsapp/link/${uid}/confirm`);
    assert.equal(theirs.status, 404);
    assert.equal(theirs.body.code, 'link_not_found');
    assert.equal((await call(env, ME, 'POST', `/whatsapp/link/${uid}/confirm`)).status, 200);

    // OTHER's code, sent from ME's number: no reply, and Axal will not link it.
    const other = (await call(env, OTHER, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, waText(`LINK ${other}`));
    assert.equal(lastEvent(db).error, 'identity_taken');
    assert.equal(g.sent.length, 1, 'no reply');
    const otherUid = (await call(env, OTHER, 'GET', '/whatsapp/link')).body.claim.uid;
    const taken = await call(env, OTHER, 'POST', `/whatsapp/link/${otherUid}/confirm`);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.code, 'number_taken');
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'whatsapp_link' AND user_id = ?`, OTHER), 0);
  } finally { g.restore(); }
});

test('Axal confirms only a claim the sender made, inside ten minutes', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await call(env, ME, 'POST', '/whatsapp/link');
    const uid = db.prepare('SELECT uid FROM channel_link_codes').get().uid;
    const early = await call(env, ME, 'POST', `/whatsapp/link/${uid}/confirm`);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'link_not_claimed');

    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    assert.equal(db.prepare('SELECT cancelled_at FROM channel_link_codes WHERE uid = ?').get(uid).cancelled_at !== null, true, 'a new code retires the old');
    await waHook(env, waText(`LINK ${code}`));
    db.prepare(`UPDATE channel_link_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE code_hash = ?`).run(refCode(code));
    const late = (await call(env, ME, 'GET', '/whatsapp/link')).body.claim;
    assert.equal(late.status, 'expired');
    const r = await call(env, ME, 'POST', `/whatsapp/link/${late.uid}/confirm`);
    assert.equal(r.status, 410);
    assert.equal(r.body.code, 'link_expired');
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'whatsapp_link'`), 0);
  } finally { g.restore(); }
});

test('an inactive member links nothing', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ME);
    await waHook(env, waText(`LINK ${code}`));
    assert.equal(lastEvent(db).error, 'member_inactive');
    assert.equal(g.sent.length, 0);
  } finally { g.restore(); }
});

for (const unset of Object.keys(AXAL) as (keyof typeof AXAL)[]) {
  test(`with ${unset} unset, every way-B route is 503 and the webhook sends nothing`, async () => {
    const { env, db } = world({ axal: { [unset]: '' } });
    const g = mockGraph();
    try {
      for (const [method, path] of [['POST', '/whatsapp/link'], ['GET', '/whatsapp/link'], ['POST', '/whatsapp/link/x/confirm'], ['DELETE', '/whatsapp/link']]) {
        const r = await call(env, ME, method, path);
        assert.equal(r.status, 503, `${method} ${path}`);
        assert.equal(r.body.code, 'not_available');
      }
      // A code made while the number was set, sent once it is not.
      db.prepare(`INSERT INTO channel_link_codes (uid, code_hash, user_id, provider, expires_at) VALUES ('c', ?, ?, 'whatsapp_link', '2099-01-01T00:00:00.000Z')`)
        .run(refCode('abcdefghjkmnpqrstuvwxyzA'), ME);
      assert.equal((await waHook(env, waText('LINK abcdefghjkmnpqrstuvwxyzA'))).status, 200);
      assert.equal(g.sent.length, 0);
      assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_link_codes WHERE used_at IS NOT NULL'), 0, 'the code is untouched');
      assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_thread_messages'), 0);
    } finally { g.restore(); }
  });
}

// ---------------------------------------------------------------------------
// Unlinking
// ---------------------------------------------------------------------------

test('STOP from a linked sender unlinks with one reply; a second STOP is an unlinked sender', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    const stop = waText('Stop.');
    await waHook(env, stop);
    assert.equal(g.sent.length, 2);
    assert.equal(g.sent[1].text, 'Unlinked. Axal will not read what you send here.');
    assert.equal(g.sent[1].to, SENDER);
    const row = db.prepare(`SELECT status, credentials_enc, external_account_id FROM integrations WHERE provider_key = 'whatsapp_link'`).get();
    assert.deepEqual({ ...row }, { status: 'disconnected', credentials_enc: null, external_account_id: null });
    await waHook(env, stop);
    await waHook(env, waText('STOP'));
    assert.equal(g.sent.length, 2, 'one reply only');
    assert.equal(lastEvent(db).error, 'unlinked_sender');
    assert.equal((await call(env, ME, 'GET', '/whatsapp/link')).body.link, null);
  } finally { g.restore(); }
});

test('DELETE unlinks, once', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await call(env, ME, 'POST', '/whatsapp/link');
    const r = await call(env, ME, 'DELETE', '/whatsapp/link');
    assert.deepEqual(r.body, { ok: true, unlinked: true });
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM channel_link_codes WHERE activated_at IS NULL AND cancelled_at IS NULL`), 0,
      'a code still waiting is cancelled too');
    assert.equal(db.prepare(`SELECT status FROM integrations WHERE provider_key = 'whatsapp_link'`).get().status, 'disconnected');
    assert.deepEqual((await call(env, ME, 'DELETE', '/whatsapp/link')).body, { ok: true, unlinked: false });
    await waHook(env, waText('Here is the recording'));
    assert.equal(lastEvent(db).error, 'unlinked_sender', 'the sender is nobody now');
    assert.equal(g.sent.length, 1);
  } finally { g.restore(); }
});

test('a link unused for 180 days lapses in the purge; a used one stays', async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env, ME, SENDER);
    await link(env, OTHER, SENDER_2);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    db.prepare(`UPDATE integrations SET last_synced_at = ?, updated_at = ? WHERE user_id = ?`).run(ago(181), ago(181), ME);
    db.prepare(`UPDATE integrations SET last_synced_at = ?, updated_at = ? WHERE user_id = ?`).run(ago(179), ago(181), OTHER);
    const r = await purgeExpired(env);
    assert.equal(r.lapsed, 1);
    const status = (u: number) => db.prepare(`SELECT status, credentials_enc FROM integrations WHERE user_id = ?`).get(u);
    assert.deepEqual({ ...status(ME) }, { status: 'disconnected', credentials_enc: null });
    assert.equal(status(OTHER).status, 'active');

    // A message from a linked sender counts as use.
    db.prepare(`UPDATE integrations SET last_synced_at = ?, updated_at = ? WHERE user_id = ?`).run(ago(200), ago(200), OTHER);
    await waHook(env, waText('a recording, soon', SENDER_2));
    assert.equal(lastEvent(db).error, 'unsupported_type');
    assert.equal((await purgeExpired(env)).lapsed, 0);
    assert.equal(status(OTHER).status, 'active');
  } finally { g.restore(); }
});

// ---------------------------------------------------------------------------
// Unrelated messages
// ---------------------------------------------------------------------------

test("an unlinked sender's message gets no reply and stores no text", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await waHook(env, waText('Hello, is this Axal? Our close takes four days.'));
    assert.equal(g.sent.length, 0);
    assert.deepEqual({ ...lastEvent(db) }, { status: 'ignored', error: 'unlinked_sender', user_id: null });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_threads'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_thread_messages'), 0);
    assert.equal(everyValue(db).includes('four days'), false, 'no text anywhere');
    assert.equal(everyValue(db).includes(SENDER), false, 'no number anywhere');
  } finally { g.restore(); }
});

test("a linked sender's text gets the one reply saying what Axal takes, and keeps no text", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    await link(env);
    await waHook(env, waText('Forwarding the call recording now'));
    assert.equal(g.sent.length, 2);
    assert.equal(g.sent[1].text, 'Axal takes voice notes and audio files here.');
    assert.deepEqual({ ...lastEvent(db) }, { status: 'ignored', error: 'unsupported_type', user_id: ME });
    assert.equal(everyValue(db).includes('Forwarding'), false);
  } finally { g.restore(); }
});

test("a member's own business number is untouched by way B", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, waText(`LINK ${code}`, SENDER, { pnid: MEMBER_PNID }));
    assert.equal(lastEvent(db).error, 'unknown_connection', 'resolved as a member connection, not as Axal');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_link_codes WHERE used_at IS NOT NULL'), 0);
    assert.equal(g.sent.length, 0);
  } finally { g.restore(); }
});

test("an echo on Axal's number is never a claim; a delivery report on Axal's reply is applied", async () => {
  const { env, db } = world();
  const g = mockGraph();
  try {
    const code = (await call(env, ME, 'POST', '/whatsapp/link')).body.code;
    await waHook(env, {
      object: 'whatsapp_business_account',
      entry: [{ id: '3000002', changes: [{ field: 'smb_message_echoes', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: AXAL_PNID },
        message_echoes: [{ from: '15550009999', to: SENDER, id: 'wamid.ECHO1', timestamp: String(now()), type: 'text', text: { body: `LINK ${code}` } }],
      } }] }],
    });
    assert.equal(lastEvent(db).error, 'unsupported');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM channel_link_codes WHERE used_at IS NOT NULL'), 0);

    await waHook(env, waText(`LINK ${code}`));
    assert.equal(g.sent.length, 1);
    await waHook(env, {
      object: 'whatsapp_business_account',
      entry: [{ id: '3000002', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: AXAL_PNID },
        statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: String(now()), recipient_id: SENDER }],
      } }] }],
    });
    assert.equal(db.prepare('SELECT status FROM channel_outbound').get().status, 'delivered');
  } finally { g.restore(); }
});
