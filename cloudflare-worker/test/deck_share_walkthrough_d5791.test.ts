/**
 * D5791 (#5791) — an investor plays the walkthrough attached to their share link.
 *
 *   1. The attached link reads the maker's newest take of each card it sends,
 *      with captions and nothing of the member, matching
 *      `deckShareWalkthrough.schema.json`; a hidden card, and an appendix card
 *      on a link without sources, play nothing; nothing attached is
 *      `{ attached: false, takes: [] }`. Nothing uses a view.
 *   2. A gated link gets nothing: the NDA not accepted (signed out, or signed
 *      in without accepting), and a published link's email gate not passed.
 *   3. A withdrawn or expired link gets nothing, and neither does its media.
 *   4. Another link's takes are never served: a link of the same version that
 *      is not attached, another version's takes, and another member's takes.
 *   5. `deck:walkthrough` off, as the maker reads it, answers "Not switched on yet".
 *   6. Media streams only for a take this link plays, whole or by range.
 *   7. The rate-limit bucket covers both routes and no sibling share route.
 *
 * On the real migrated schema (`_storage_schema.ts`). Every name is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_share_walkthrough_d5791.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import decks from '../src/routes/decks.ts';
import deckShareWalkthrough, { byteRange } from '../src/routes/deck_share_walkthrough.ts';
import { createDeckLink } from '../src/services/raiseWriters.ts';
import { DECK_SHARE_WALKTHROUGH } from '../src/middleware/rateLimit.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(() => removeMigratedDatabases());

const SCHEMA = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/contracts/deckShareWalkthrough.schema.json'), 'utf8'));
const JWT_SECRET = 'unit-test-jwt-secret-d5791-walkthrough-0123456';
const P = 1;
const DECK = 5, OTHER_DECK = 6;
const ADMIN = 30, INVESTOR = 40, FOUNDER = 50, COFOUNDER = 51;
// Card 2 is hidden from the version; card 4 is an appendix card, sent only with sources on.
const SLIDES = [
  { uid: 'card-kestrel', title: 'Kestrel' },
  { uid: 'card-secret', title: 'Hidden', hidden: true },
  { uid: 'card-traction', title: 'Traction' },
  { uid: 'card-appendix', title: 'Appendix', appendix: true },
];
const CUES = [{ start_ms: 320, end_ms: 2900, text: 'This is the problem we solve.' }];
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 1, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivo Investor', 'ivo@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(COFOUNDER, 'founder', 'Cal Cofounder', 'cal@example.test', 1001);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, INVESTOR, FOUNDER, COFOUNDER]) ss.run(id, `j-${id}`);
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (${P}, 'proj-kestrel', 'Kestrel Labs', 1001)`);
  const d = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  d.run(DECK, P, 1, JSON.stringify(SLIDES), 'Seed deck', 1, '2026-11-01 09:00:00');
  d.run(OTHER_DECK, P, 2, JSON.stringify(SLIDES), 'Seed deck v2', 0, '2026-11-02 09:00:00');
  const t = db.prepare(`INSERT INTO deck_recordings (uid, deck_id, project_id, user_id, card, take, duration_ms, media_r2_key, media_mime, media_bytes,
    captions_json, caption_model, charged_microusd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'video/webm', ?, ?, 'whisper-test', 1234)`);
  // The founder's takes of DECK: card 1 twice (take 2 is newest), the hidden card, card 3 (captions not recorded) and the appendix.
  t.run(U(1), DECK, P, FOUNDER, 1, 1, 4000, `deck-recordings/1/${U(1)}.webm`, 10, JSON.stringify(CUES));
  t.run(U(2), DECK, P, FOUNDER, 1, 2, 5000, `deck-recordings/1/${U(2)}.webm`, 10, JSON.stringify(CUES));
  t.run(U(3), DECK, P, FOUNDER, 2, 1, 5000, `deck-recordings/1/${U(3)}.webm`, 10, JSON.stringify(CUES));
  t.run(U(4), DECK, P, FOUNDER, 3, 1, 6000, `deck-recordings/1/${U(4)}.webm`, 10, null);
  t.run(U(5), DECK, P, FOUNDER, 4, 1, 6000, `deck-recordings/1/${U(5)}.webm`, 10, JSON.stringify(CUES));
  // The co-founder's own take of card 3 (numbered after the founder's, so newest if makers were mixed), and the founder's take of another version.
  t.run(U(6), DECK, P, COFOUNDER, 3, 2, 4000, `deck-recordings/1/${U(6)}.webm`, 10, JSON.stringify(CUES));
  t.run(U(7), OTHER_DECK, P, FOUNDER, 1, 1, 4000, `deck-recordings/1/${U(7)}.webm`, 10, JSON.stringify(CUES));
  return db;
}

/** R2 with every take's ten bytes, 0..9, honouring a range. */
function bucket() {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const reads: string[] = [];
  return {
    reads,
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      reads.push(key);
      if (!key.startsWith('deck-recordings/')) return null;
      const r = opts?.range;
      return { body: r ? bytes.slice(r.offset, r.offset + r.length) : bytes, size: bytes.byteLength };
    },
  };
}

const app = new Hono<any>();
app.route('/api/decks', deckShareWalkthrough);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function bearer(as: number) {
  return new SignJWT({ user_id: as, role: as === ADMIN ? 'admin' : as === INVESTOR ? 'investor' : 'founder', jti: `j-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function get(db: DatabaseSync, FILES: any, path: string, { as = null as number | null, range = null as string | null } = {}) {
  const headers: Record<string, string> = {};
  if (as) headers.Authorization = `Bearer ${await bearer(as)}`;
  if (range) headers.Range = range;
  const res = await app.request(path, { method: 'GET', headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES } as any);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() as any : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, body, headers: res.headers };
}

const admin = { id: ADMIN, role: 'admin', email: 'ada@example.test' } as any;
async function link(db: DatabaseSync, body: Record<string, unknown> = {}, deckId = DECK) {
  const out = await createDeckLink({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, {
    projectId: P, user: admin, body: { deck_id: deckId, investor_label: 'Fund A', expires_days: 14, ...body },
  });
  return { id: Number(out.id), token: out.share_path.replace('/share/deck/', '') };
}
const attach = (db: DatabaseSync, linkId: number, deckId = DECK, userId = FOUNDER) =>
  db.prepare('INSERT INTO deck_recording_links (share_token_id, deck_id, user_id) VALUES (?, ?, ?)').run(linkId, deckId, userId);
const acceptNda = (db: DatabaseSync, linkId: number, userId: number) =>
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, project_id, user_id, type) VALUES (?, ?, ?, ?, 'nda_signed')").run(linkId, DECK, P, userId);
const read = (db: DatabaseSync, FILES: any, token: string, as: number | null = null) => get(db, FILES, `/api/decks/share/${token}/walkthrough`, { as });
const media = (db: DatabaseSync, FILES: any, token: string, uid: string, opts: { as?: number | null; range?: string | null } = {}) =>
  get(db, FILES, `/api/decks/share/${token}/walkthrough/${uid}/media`, opts);
const views = (db: DatabaseSync, id: number) => Number((db.prepare('SELECT view_count FROM pitch_deck_share_tokens WHERE id = ?').get(id) as any).view_count);

// ---------------------------------------------------------------------------

test('1. the attached link reads the newest take of each card it sends, with captions and nothing of the member', async () => {
  // Mutation checked: sharedWalkthroughOf without the sent-card filter → the hidden card's take (U3) is served;
  // reading takeView whole → caption_model and charged_microusd leave and the contract fails;
  // the attachment read without `share_token_id = ?` → the unattached link plays the walkthrough.
  const db = fixture(); const FILES = bucket();
  try {
    const l = await link(db);
    attach(db, l.id);
    const r = await read(db, FILES, l.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(contractErrors(SCHEMA, r.body), [], 'the reply matches deckShareWalkthrough');
    assert.equal(r.body.attached, true);
    assert.deepEqual(r.body.takes.map((t: any) => [t.card, t.card_uid, t.take, t.uid]),
      [[1, 'card-kestrel', 2, U(2)], [3, 'card-traction', 1, U(4)], [4, 'card-appendix', 1, U(5)]]);
    assert.deepEqual(r.body.takes[0].captions, CUES);
    assert.equal(r.body.takes[1].captions, null, 'captions not recorded are null, never []');
    assert.ok(!JSON.stringify(r.body).includes('whisper-test') && !JSON.stringify(r.body).includes('1234'), 'no caption model, no charge');
    assert.equal(views(db, l.id), 0, 'the walkthrough uses no view');

    // A link without sources does not send the appendix card, so it does not play its take.
    const noSources = await link(db, { include: { sources: false } });
    attach(db, noSources.id);
    assert.deepEqual((await read(db, FILES, noSources.token)).body.takes.map((t: any) => t.card), [1, 3]);

    // Nothing attached draws nothing.
    const bare = await link(db);
    const none = await read(db, FILES, bare.token);
    assert.equal(none.status, 200);
    assert.deepEqual(none.body, { attached: false, takes: [] });
    assert.deepEqual(contractErrors(SCHEMA, none.body), []);
  } finally { db.close(); }
});

test('2. a gated link gets nothing until its NDA is accepted, or its email gate passed', async () => {
  // Mutation checked: the NDA check removed → the signed-out read and the unaccepted read answer 200 with takes;
  // the email gate removed → the published link answers 200 with takes.
  const db = fixture(); const FILES = bucket();
  try {
    const l = await link(db, { nda_required: true });
    attach(db, l.id);
    const out = await read(db, FILES, l.token, null);
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'nda_required');
    assert.equal(out.body.takes, undefined, 'no take leaves before the NDA');
    const unaccepted = await read(db, FILES, l.token, INVESTOR);
    assert.equal(unaccepted.status, 403);
    assert.equal(unaccepted.body.error, 'nda_required');
    assert.equal(unaccepted.body.signed_in, true);
    const m = await media(db, FILES, l.token, U(2), { as: INVESTOR });
    assert.equal(m.status, 403);
    assert.equal(FILES.reads.length, 0, 'no file is read behind the NDA');

    acceptNda(db, l.id, INVESTOR);
    const ok = await read(db, FILES, l.token, INVESTOR);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.takes.length, 3);
    assert.equal((await media(db, FILES, l.token, U(2), { as: INVESTOR })).status, 200);

    // A published link: the reader gives their email first.
    const pub = await link(db);
    attach(db, pub.id);
    db.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?')
      .run(JSON.stringify({ publish: { on: true, gate: 'email', exemption: '506c', embed_origins: [], at: '2026-11-01' } }), pub.id);
    const gated = await read(db, FILES, pub.token);
    assert.equal(gated.status, 403);
    assert.equal(gated.body.error, 'email_required');
    assert.equal((await media(db, FILES, pub.token, U(2))).status, 403);
  } finally { db.close(); }
});

test('3. a withdrawn or expired link gets nothing, and neither does its media', async () => {
  // Mutation checked: shareLinkLive skipped (the link row read by hash alone) → the withdrawn and expired links answer 200.
  const db = fixture(); const FILES = bucket();
  try {
    const withdrawn = await link(db);
    attach(db, withdrawn.id);
    assert.equal((await read(db, FILES, withdrawn.token)).status, 200);
    db.prepare('UPDATE pitch_deck_share_tokens SET revoked_at = datetime(\'now\') WHERE id = ?').run(withdrawn.id);
    const w = await read(db, FILES, withdrawn.token);
    assert.equal(w.status, 410);
    assert.equal(w.body.error, 'link_closed');
    assert.equal(w.body.takes, undefined);
    assert.equal((await media(db, FILES, withdrawn.token, U(2))).status, 410);

    const expired = await link(db);
    attach(db, expired.id);
    db.prepare("UPDATE pitch_deck_share_tokens SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(expired.id);
    const e = await read(db, FILES, expired.token);
    assert.equal(e.status, 410);
    assert.equal(e.body.error, 'link_closed');
    assert.equal((await media(db, FILES, expired.token, U(2))).status, 410);
    assert.equal(FILES.reads.length, 0);
  } finally { db.close(); }
});

test('4. another link\'s takes are never served', async () => {
  // Mutation checked: the media route not checking the take is one this link plays (row read by uid alone) →
  // the other version's take and the co-founder's take stream; the takes read without `user_id = ?` → the co-founder's take is newest of card 3 and plays.
  const db = fixture(); const FILES = bucket();
  try {
    const mine = await link(db);
    attach(db, mine.id);
    // The other version's link, attached to its own walkthrough.
    const theirs = await link(db, {}, OTHER_DECK);
    attach(db, theirs.id, OTHER_DECK);
    // A link of the same version that is not attached.
    const unattached = await link(db);

    const r = await read(db, FILES, mine.token);
    assert.ok(!r.body.takes.some((t: any) => t.uid === U(6) || t.uid === U(7)), 'neither the co-founder\'s nor another version\'s take');
    assert.deepEqual((await read(db, FILES, theirs.token)).body.takes.map((t: any) => t.uid), [U(7)]);

    for (const uid of [U(7), U(6), U(3), U(1)]) {
      const m = await media(db, FILES, mine.token, uid);
      assert.equal(m.status, 404, `${uid} is not a take this link plays`);
      assert.equal(m.body.error, 'not_found');
    }
    assert.equal((await media(db, FILES, theirs.token, U(2))).status, 404, 'my take never plays on their link');
    assert.equal((await media(db, FILES, unattached.token, U(2))).status, 404, 'nor on a link it is not attached to');
    assert.deepEqual((await read(db, FILES, unattached.token)).body, { attached: false, takes: [] });
    assert.equal(FILES.reads.length, 0, 'no refused take read its file');
  } finally { db.close(); }
});

test('5. deck:walkthrough off, as the maker reads it, answers "Not switched on yet"', async () => {
  // Mutation checked: the flag check removed → 200 with takes; the flag read for no one (flagsFor(env, null)) → the
  // maker's own user row does not switch it off.
  const db = fixture(); const FILES = bucket();
  try {
    const l = await link(db);
    attach(db, l.id);
    db.prepare("INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('deck:walkthrough', 'global', '', 0)").run();
    const off = await read(db, FILES, l.token);
    assert.equal(off.status, 404);
    assert.equal(off.body.error, 'not_switched_on');
    assert.equal(off.body.message, 'Not switched on yet.');
    assert.equal((await media(db, FILES, l.token, U(2))).body.error, 'not_switched_on');

    // HQ switches it off for the maker alone.
    db.prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'deck:walkthrough'").run();
    assert.equal((await read(db, FILES, l.token)).status, 200);
    db.prepare("INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('deck:walkthrough', 'user', ?, 0)").run(String(FOUNDER));
    assert.equal((await read(db, FILES, l.token)).body.error, 'not_switched_on');
    assert.equal(FILES.reads.length, 0);
  } finally { db.close(); }
});

test('6. media streams only for a take this link plays, whole or by range', async () => {
  // Mutation checked: the Range header ignored → 200 with all ten bytes where 206 and three are expected.
  const db = fixture(); const FILES = bucket();
  try {
    const l = await link(db);
    attach(db, l.id);
    const whole = await media(db, FILES, l.token, U(2));
    assert.equal(whole.status, 200);
    assert.deepEqual([...whole.body], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(whole.headers.get('content-type'), 'video/webm');
    assert.equal(whole.headers.get('cache-control'), 'private, no-store');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(FILES.reads, [`deck-recordings/1/${U(2)}.webm`]);

    const part = await media(db, FILES, l.token, U(2), { range: 'bytes=2-4' });
    assert.equal(part.status, 206);
    assert.deepEqual([...part.body], [2, 3, 4]);
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal((await media(db, FILES, l.token, U(2), { range: 'bytes=40-' })).status, 416);

    assert.equal((await media(db, FILES, l.token, 'not-a-uid')).status, 404);
    assert.deepEqual(byteRange('bytes=-3', 10), { offset: 7, length: 3 });
    assert.deepEqual(byteRange('bytes=8-', 10), { offset: 8, length: 2 });
    assert.equal(byteRange('items=1-2', 10), null);
  } finally { db.close(); }
});

test('7. the rate-limit bucket covers both walkthrough routes and no sibling share route', () => {
  // Mutation checked: the pattern without its `$` anchor → `/walkthrough/x/media/extra` would be capped.
  assert.ok(DECK_SHARE_WALKTHROUGH.test('/api/decks/share/abc.def/walkthrough'));
  assert.ok(DECK_SHARE_WALKTHROUGH.test(`/api/decks/share/abc.def/walkthrough/${U(2)}/media`));
  for (const p of ['/api/decks/share/abc.def', '/api/decks/share/abc.def/nda', '/api/decks/share/abc.def/signup',
    '/api/decks/5/recordings', `/api/decks/share/abc.def/walkthrough/${U(2)}/media/extra`]) {
    assert.ok(!DECK_SHARE_WALKTHROUGH.test(p), `${p} is not the walkthrough`);
  }
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/middleware/rateLimit.ts'), 'utf8');
  assert.match(src, /name: 'deck_share_walkthrough',[\s\S]{0,120}scope: 'ip'/);
});
