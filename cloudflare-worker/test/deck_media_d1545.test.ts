/**
 * D1545 (#3788, deck v2 B12): media and structure on the Worker. Synthetic
 * data, the mounted routes and the real migrated schema in memory; R2 is a
 * map and `fetch` throws (no test reaches a provider host).
 *
 *   · the model: a Loom link, an MP4 uploaded to the deck (its loop), a
 *     button; anything else is refused in words;
 *   · hidden cards: in no share, Present, PDF, PowerPoint, .odp, Google
 *     Slides or HTML; notes pair by uid; the heartbeat names cards by the
 *     link's own list;
 *   · the upload: write access, 50 MB, an MP4's signature; the file is the
 *     venture's own until a saved version names it, then public, with Range;
 *   · paste: sanitized as a save, no uid, status, assignee or notes, and
 *     across ventures no `image_id`;
 *   · a button press: on this link's deck only, once per view, read by the
 *     founder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckMedia, { VIDEO_MAX_BYTES, isMp4, pastedCards, rangeOf, videoKey } from '../src/routes/deck_media.ts';
import deckShareActions from '../src/routes/deck_share_actions.ts';
import decks, { exportDeckOf, linkSentCards, printDeckOf, publicDeckOf, sanitizeImageUrl, sanitizeSlides } from '../src/routes/decks.ts';
import { BLOCK_KINDS, VIDEO_FILE_PATH, VIDEO_PROVIDERS, modelProblems, visibleCards } from '../src/services/decks/slideModel.ts';
import { BLOCK_KIND_GATES, DEFAULT_SHARE_INCLUDE, shareSlides } from '../src/services/decks/shareInclude.ts';
import { checkVideoLink } from '../src/services/decks/videoLink.ts';
import { recordSlideCardUids } from '../src/services/deckSlideDwell.ts';
import { createDeckLink } from '../src/services/raiseWriters.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-d1545-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const FOUNDER = 2, OTHER = 3, ADMIN = 9;
const DECK = 7, OTHER_DECK = 8;
const VID = '0b7e3a52-6d1f-4c3a-9e2b-5f4d8c7a1b20';
const LOOM = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef';
/** The first bytes of an MP4: a box size, then `ftyp`, then a brand. */
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8]);

const SLIDES = [
  { uid: 'k-cover', title: 'Synthetic cover', notes: 'Say the cover.', blocks: [{ id: 'b1', kind: 'button', url: 'https://example.com/book', label: 'Book a call', grid: { c1: 1, r1: 5, c2: 3, r2: 5 } }, { id: 'b2', kind: 'text', style: 'paragraph', text: 'Synthetic words', grid: { c1: 1, r1: 1, c2: 12, r2: 2 } }] },
  { uid: 'k-gone', title: 'Synthetic hidden', hidden: true, notes: 'Never said.', blocks: [{ id: 'b1', kind: 'button', url: 'https://example.com/secret', label: 'Hidden button', grid: { c1: 1, r1: 5, c2: 3, r2: 5 } }] },
  { uid: 'k-ask', title: 'Synthetic ask', notes: 'Say the ask.', section: 'Synthetic close', blocks: [] },
];

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[FOUNDER, 'founder', 100], [OTHER, 'founder', 300], [ADMIN, 'admin', null]] as const) {
    insert.run(id, role, fid, `Synthetic ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, 1, 3, ?, ?, 1)').run(DECK, JSON.stringify(SLIDES), 'Synthetic deck');
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, 3, 1, ?, ?, 1)').run(OTHER_DECK, JSON.stringify([{ uid: 'o-1', title: 'Theirs', blocks: [] }]), 'Other deck');
  const r2 = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array, o: any) => { r2.set(key, { bytes: new Uint8Array(bytes), meta: o?.customMetadata || {} }); },
    head: async (key: string) => (r2.has(key) ? { size: r2.get(key)!.bytes.length, customMetadata: r2.get(key)!.meta } : null),
    get: async (key: string, o?: { range?: { offset: number; length: number } }) => {
      const f = r2.get(key);
      if (!f) return null;
      const bytes = o?.range ? f.bytes.slice(o.range.offset, o.range.offset + o.range.length) : f.bytes;
      return { body: new Blob([bytes]).stream() };
    },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckMedia).route('/api/decks', deckShareActions).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  return { db, env, app, r2, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const bearer = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number | null, path: string, init: { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers || {}), ...(who ? { Authorization: `Bearer ${await bearer(who)}` } : {}) };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET'), headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) }, f.env);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, body: body as any, headers: res.headers };
}
const form = (bytes: Uint8Array, name = 'synthetic.mp4') => { const f = new FormData(); f.append('file', new File([bytes], name, { type: 'video/mp4' })); return f; };
const blockOf = (block: Record<string, unknown>) => sanitizeSlides([{ title: 'x', blocks: [{ id: 'b', grid: { c1: 1, r1: 1, c2: 6, r2: 3 }, ...block }] }])[0].blocks;

// ─────────────────────────────────────────────────────────── the model

test('a Loom link, an MP4 uploaded to the deck (and its loop) and a button are kept; anything else is refused in words', () => {
  assert.ok(BLOCK_KINDS.includes('button'));
  assert.deepEqual([...VIDEO_PROVIDERS], ['youtube', 'vimeo', 'loom', 'mp4']);
  assert.equal(BLOCK_KIND_GATES.button, 'none', 'a button is on every share');
  const [loom] = blockOf({ kind: 'video', url: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef?t=3' });
  assert.deepEqual([loom.provider, loom.url], ['loom', LOOM]);
  const url = `${ORIGIN}${VIDEO_FILE_PATH(VID)}`;
  const [mp4] = blockOf({ kind: 'video', provider: 'mp4', video_id: VID, url, poster_url: 'https://axal.vc/p.jpg', loop: true });
  assert.deepEqual([mp4.provider, mp4.video_id, mp4.url, mp4.loop], ['mp4', VID, url, true]);
  assert.equal(blockOf({ kind: 'video', url: LOOM, loop: true })[0].loop, undefined, 'a provider\'s player decides its own loop');
  assert.deepEqual(blockOf({ kind: 'video', provider: 'mp4', video_id: VID, url: `${ORIGIN}/api/decks/videos/${'1'.repeat(8)}-0000-0000-0000-000000000000/file` }), [], 'a file address must be its own id\'s');
  assert.deepEqual(blockOf({ kind: 'video', provider: 'mp4', video_id: VID, url: 'https://example.com/v.mp4' }), [], 'an MP4 elsewhere is not an upload');
  assert.deepEqual(blockOf({ kind: 'button', url: 'https://example.com/book', label: 'Book a call', style: 'secondary' })[0], { id: 'b', kind: 'button', grid: { c1: 1, r1: 1, c2: 6, r2: 3 }, url: 'https://example.com/book', label: 'Book a call', style: 'secondary' });
  assert.equal(blockOf({ kind: 'button', url: 'https://example.com', label: 'Go', style: 'loud' })[0].style, 'primary');
  assert.deepEqual(blockOf({ kind: 'button', url: 'http://example.com', label: 'Go' }), [], 'https only');
  assert.deepEqual(blockOf({ kind: 'button', url: 'https://example.com', label: '' }), [], 'a button needs its words');
  const why = modelProblems([{ title: 'x', blocks: [{ id: 'b', kind: 'button', url: 'javascript:alert(1)', label: 'x', grid: { c1: 1, r1: 1, c2: 2, r2: 1 } }, { id: 'c', kind: 'video', url: 'https://example.com/v', grid: { c1: 3, r1: 1, c2: 4, r2: 1 } }] }], sanitizeImageUrl);
  assert.ok(why.some((l: string) => /a button needs its words \(at most 60 characters\) and a link that is https on a public host/.test(l)), why.join(' | '));
  assert.ok(why.some((l: string) => /YouTube, Vimeo or Loom link, or a video uploaded to this deck/.test(l)), why.join(' | '));
});

test('a Loom link is checked against Loom\'s own oEmbed, its poster only from cdn.loom.com; no other host is asked', async () => {
  const asked: string[] = [];
  const fake = (async (u: string) => {
    asked.push(String(u));
    return new Response(JSON.stringify({ title: 'Synthetic walkthrough', thumbnail_url: 'https://cdn.loom.com/sessions/thumbnails/synthetic.gif' }), { headers: { 'content-type': 'application/json' } });
  }) as any;
  const ok = await checkVideoLink(LOOM, (u) => u ?? null, fake);
  assert.equal(ok.state, 'ok');
  assert.deepEqual([(ok as any).provider, (ok as any).title, (ok as any).poster_url], ['loom', 'Synthetic walkthrough', 'https://cdn.loom.com/sessions/thumbnails/synthetic.gif']);
  assert.match(asked[0], /^https:\/\/www\.loom\.com\/v1\/oembed\?url=/);
  const elsewhere = (async () => new Response(JSON.stringify({ title: 'x', thumbnail_url: 'https://evil.example/p.gif' }), { headers: { 'content-type': 'application/json' } })) as any;
  assert.equal(((await checkVideoLink(LOOM, (u) => u ?? null, elsewhere)) as any).poster_url, null);
});

// ─────────────────────────────────────────────────────────── hidden cards

test('a hidden card is on no share, Present or print, and in no PowerPoint, .odp, Google Slides or HTML export', () => {
  const row = { id: DECK, project_id: 1, version: 3, title: 'Synthetic deck', is_current: 1, slides: JSON.stringify(SLIDES) };
  assert.deepEqual(visibleCards(SLIDES).map((s: any) => s.uid), ['k-cover', 'k-ask']);
  assert.deepEqual(shareSlides(SLIDES, DEFAULT_SHARE_INCLUDE).map((s: any) => s.uid), ['k-cover', 'k-ask'], 'share, publish, derive and grants');
  assert.deepEqual(publicDeckOf(row).slides.map((s: any) => s.title), ['Synthetic cover', 'Synthetic ask'], 'Present and the print page');
  const printed = printDeckOf(row, { notes: true, sources: false });
  assert.deepEqual(printed.slides.map((s: any) => s.notes), ['Say the cover.', 'Say the ask.'], 'notes pair by uid, never shifted onto the next card');
  assert.deepEqual(exportDeckOf(row, { notes: false, sources: false }).slides.map((s: any) => s.title), ['Synthetic cover', 'Synthetic ask'], 'PowerPoint, .odp, Google Slides');
  assert.match(readFileSync(new URL('../src/routes/deck_exports.ts', import.meta.url), 'utf8'), /slides = visibleCards\(slides\)\.slice\(0, 60\)/, 'the HTML file');
  assert.equal(publicDeckOf(row).slides.some((s: any) => /Never said|Hidden button/.test(JSON.stringify(s))), false);
});

test('the heartbeat names each seen slide by the card the link sent, past a hidden card', async () => {
  const f = await fixture();
  try {
    const link = await createDeckLink(f.env, { projectId: 1, user: { id: ADMIN, role: 'admin', email: 'synthetic-9@example.invalid' } as any, body: { deck_id: DECK, investor_label: 'Synthetic Capital', expires_days: 14 } });
    const tokenId = Number(f.db.prepare('SELECT id FROM pitch_deck_share_tokens ORDER BY id DESC LIMIT 1').get()!.id);
    f.db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id) VALUES (1, ?, ?)').run(tokenId, DECK);
    f.db.prepare('INSERT INTO deck_view_slides (view_id, slide_index, seconds) VALUES (1, 0, 4), (1, 1, 6)').run();
    const linkRow = f.db.prepare('SELECT include_json, variant_id FROM pitch_deck_share_tokens WHERE id = ?').get(tokenId) as any;
    // As the heartbeat calls it (D1573): against the cards this link sends, which never hold a hidden card.
    await recordSlideCardUids(f.env, 1, DECK, [0, 1], async () => linkSentCards(f.env, f.db.prepare('SELECT * FROM pitch_decks WHERE id = ?').get(DECK), linkRow));
    const named = f.db.prepare('SELECT slide_index, card_uid FROM deck_view_slides WHERE view_id = 1 ORDER BY slide_index').all() as any[];
    assert.deepEqual(named.map((r) => r.card_uid), ['k-cover', 'k-ask'], 'slide 1 on the link is the ask, not the hidden card');
    assert.ok(link);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the upload and the file

test('pure: an MP4\'s signature, the 50 MB cap and the byte ranges a player asks for', () => {
  assert.equal(isMp4(MP4), true);
  assert.equal(isMp4(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  assert.equal(VIDEO_MAX_BYTES, 50 * 1024 * 1024);
  assert.deepEqual(rangeOf('bytes=0-3', 24), { offset: 0, length: 4 });
  assert.deepEqual(rangeOf('bytes=20-', 24), { offset: 20, length: 4 });
  assert.deepEqual(rangeOf('bytes=-4', 24), { offset: 20, length: 4 });
  assert.deepEqual(rangeOf('bytes=10-999', 24), { offset: 10, length: 14 });
  for (const bad of [null, '', 'bytes=-', 'bytes=30-', 'bytes=5-2', 'items=0-1']) assert.equal(rangeOf(bad, 24), null, String(bad));
  assert.equal(videoKey(VID), `deck-videos/${VID}.mp4`);
});

test('an upload needs write access and an MP4 of at most 50 MB; it lives in R2 with its venture, and says where', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, null, `/api/decks/${DECK}/videos/upload`, { form: form(MP4) })).status, 401);
    assert.equal((await call(f, OTHER, `/api/decks/${DECK}/videos/upload`, { form: form(MP4) })).status, 403, 'another venture\'s founder');
    const png = await call(f, FOUNDER, `/api/decks/${DECK}/videos/upload`, { form: form(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), 'x.png') });
    assert.deepEqual([png.status, png.body.error], [415, 'not_mp4']);
    const big = await call(f, FOUNDER, `/api/decks/${DECK}/videos/upload`, { form: form(new Uint8Array(VIDEO_MAX_BYTES + 1)) });
    assert.deepEqual([big.status, big.body.error], [413, 'video_too_large']);
    assert.equal(f.r2.size, 0, 'nothing refused is stored');
    const ok = await call(f, FOUNDER, `/api/decks/${DECK}/videos/upload`, { form: form(MP4) });
    assert.equal(ok.status, 201);
    const v = ok.body.video;
    assert.equal(v.provider, 'mp4');
    assert.match(v.video_id, /^[0-9a-f-]{36}$/);
    assert.equal(v.url, `${ORIGIN}${VIDEO_FILE_PATH(v.video_id)}`);
    assert.deepEqual(f.r2.get(videoKey(v.video_id))!.meta, { projectId: '1', deckId: String(DECK), userId: String(FOUNDER) });
    assert.deepEqual(blockOf({ kind: 'video', ...v })[0].video_id, v.video_id, 'what the upload answers is a block a save keeps');
    const contract = JSON.parse(readFileSync(new URL(`../src/contracts/${(CONTRACTS as any).media.schema}`, import.meta.url), 'utf8'));
    assert.deepEqual(contract.properties.video.properties.provider.enum, ['mp4']);
  } finally { f.close(); }
});

test('the file is the venture\'s own until a saved version names it, then public and cached; a Range is served as 206', async () => {
  const f = await fixture();
  try {
    const v = (await call(f, FOUNDER, `/api/decks/${DECK}/videos/upload`, { form: form(MP4) })).body.video;
    const path = VIDEO_FILE_PATH(v.video_id);
    assert.equal((await call(f, null, path)).status, 404, 'not named yet: nobody outside the venture');
    assert.equal((await call(f, OTHER, path)).status, 404);
    const own = await call(f, FOUNDER, path);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual([...own.body], [...MP4]);
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = ?').run(JSON.stringify([...SLIDES, { uid: 'k-vid', title: 'Demo', blocks: [{ id: 'v', kind: 'video', ...v }] }]), DECK);
    const pub = await call(f, null, path);
    assert.equal(pub.status, 200);
    assert.match(pub.headers.get('cache-control')!, /public, max-age=31536000, immutable/);
    assert.deepEqual([pub.headers.get('content-type'), pub.headers.get('x-content-type-options'), pub.headers.get('accept-ranges')], ['video/mp4', 'nosniff', 'bytes']);
    const part = await call(f, null, path, { headers: { range: 'bytes=4-7' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 4-7/${MP4.length}`);
    assert.deepEqual([...part.body], [0x66, 0x74, 0x79, 0x70]);
    assert.equal((await call(f, null, '/api/decks/videos/not-a-uid/file')).status, 404);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── paste

test('a paste carries the cards as a save keeps them, without their working state; across ventures, without image ids', () => {
  const IMG = '0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d';
  const source = [
    { uid: 'p1', title: 'Synthetic one', status: 'done', assignee: 2, notes: 'Private words.', blocks: [{ id: 'b1', kind: 'image', image_url: `https://axal.vc/api/decks/images/${IMG}/file`, image_id: IMG, grid: { c1: 1, r1: 1, c2: 6, r2: 6 } }], background: { image_url: `https://axal.vc/api/decks/images/${IMG}/file`, image_id: IMG, overlay: 'strong' } },
    { uid: 'p2', title: 'Synthetic two', blocks: [{ id: 'b1', kind: 'button', url: 'javascript:alert(1)', label: 'x', grid: { c1: 1, r1: 1, c2: 2, r2: 1 } }] },
  ];
  const same = pastedCards(source, ['p1', 'p2', 'gone'], true);
  assert.equal(same.missing, 1);
  assert.deepEqual(same.cards.map((c: any) => c.title), ['Synthetic one', 'Synthetic two']);
  for (const c of same.cards) for (const k of ['uid', 'status', 'assignee', 'notes']) assert.equal(k in c, false, k);
  assert.equal(same.cards[0].blocks[0].image_id, IMG, 'the same venture keeps its image');
  assert.deepEqual(same.cards[1].blocks, [], 'a block a save refuses is not pasted either');
  const other = pastedCards(source, ['p1'], false);
  assert.equal('image_id' in other.cards[0].blocks[0], false);
  assert.equal(other.cards[0].blocks[0].image_url, `https://axal.vc/api/decks/images/${IMG}/file`, 'the picture keeps its address');
  assert.equal('image_id' in (other.cards[0].background || {}), false);
});

test('the paste route needs write on the target and read on the source, and saves nothing', async () => {
  const f = await fixture();
  try {
    const before = f.db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(DECK) as any;
    const r = await call(f, FOUNDER, `/api/decks/${DECK}/paste`, { json: { from_deck_id: DECK, card_uids: ['k-ask', 'k-nope'] } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.cards.map((c: any) => c.title), r.body.missing], [['Synthetic ask'], 1]);
    assert.equal(r.body.cards[0].section, 'Synthetic close', 'its section travels');
    assert.equal((f.db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(DECK) as any).slides, before.slides, 'nothing saved');
    assert.equal((await call(f, FOUNDER, `/api/decks/${DECK}/paste`, { json: { from_deck_id: OTHER_DECK, card_uids: ['o-1'] } })).status, 403, 'another venture\'s deck it may not read');
    assert.equal((await call(f, OTHER, `/api/decks/${DECK}/paste`, { json: { from_deck_id: OTHER_DECK, card_uids: ['o-1'] } })).status, 403, 'a target it may not write');
    assert.equal((await call(f, FOUNDER, `/api/decks/${DECK}/paste`, { json: { from_deck_id: DECK, card_uids: [] } })).body.error, 'cards_required');
    assert.equal((await call(f, FOUNDER, `/api/decks/${DECK}/paste`, { json: { card_uids: ['k-ask'] } })).body.error, 'from_deck_required');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── a button press

test('a press counts once per view, only for a button on the cards the link sends, and the founder reads it', async () => {
  const f = await fixture();
  try {
    const link = await createDeckLink(f.env, { projectId: 1, user: { id: ADMIN, role: 'admin', email: 'synthetic-9@example.invalid' } as any, body: { deck_id: DECK, investor_label: 'Synthetic Capital', expires_days: 14 } });
    const token = String((link as any).share_path || (link as any).url || '').split('/share/deck/').pop()!;
    assert.ok(token.length > 20, 'a signed link token');
    const tokenId = Number(f.db.prepare('SELECT id FROM pitch_deck_share_tokens ORDER BY id DESC LIMIT 1').get()!.id);
    f.db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id) VALUES (5, ?, ?)').run(tokenId, DECK);
    const press = (body: unknown) => call(f, null, `/api/decks/share/${token}/click`, { json: body });
    assert.equal((await call(f, null, '/api/decks/share/not-a-token/click', { json: { card_uid: 'k-cover', block_id: 'b1' } })).status, 401);
    assert.equal((await press({ card_uid: 'k-gone', block_id: 'b1' })).body.error, 'button_not_found', 'a hidden card\'s button is not on the link');
    assert.equal((await press({ card_uid: 'k-ask', block_id: 'b1' })).status, 404);
    assert.equal((await press({ card_uid: 'k-cover', block_id: 'b2' })).body.error, 'button_not_found', 'a block that is not a button');
    assert.equal((await press({ card_uid: 'k-cover' })).body.error, 'button_required');
    for (let i = 0; i < 3; i += 1) assert.equal((await press({ card_uid: 'k-cover', block_id: 'b1', view_id: 5 })).status, 200);
    assert.equal((await press({ card_uid: 'k-cover', block_id: 'b1', view_id: 999 })).status, 200, 'a view of nothing is kept without one');
    const rows = f.db.prepare("SELECT view_id, ref_id FROM deck_share_conversions WHERE type = 'button_click' ORDER BY id").all() as any[];
    assert.deepEqual(rows.map((r) => [r.view_id, r.ref_id]), [[5, 'k-cover:b1'], [null, 'k-cover:b1']], 'once per view');
    assert.equal((await call(f, OTHER, `/api/decks/${DECK}/button-clicks`)).status, 403);
    const read = await call(f, FOUNDER, `/api/decks/${DECK}/button-clicks`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.buttons, [{ card_uid: 'k-cover', block_id: 'b1', clicks: 2, viewers: 1 }]);
    const contract = JSON.parse(readFileSync(new URL(`../src/contracts/${(CONTRACTS as any).buttonClicks.schema}`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(contract.properties.buttons.items.properties).sort(), ['block_id', 'card_uid', 'clicks', 'viewers']);
  } finally { f.close(); }
});
