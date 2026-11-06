/**
 * #4375 (D4375) — HQ takes down one deck image. Synthetic venture, images and
 * people on the real migrated schema; R2 is an in-memory map; `fetch` throws.
 *
 *   · the image no longer serves: its R2 object is deleted and its URL answers
 *     the neutral placeholder, never the bytes;
 *   · every render path shows the placeholder: the editor, Present and the PDF
 *     draw the image by that URL; the PowerPoint, .odp and HTML files embed
 *     what that URL answers;
 *   · a non-admin is 403; the reason is required; a second takedown is 409;
 *   · the founder is told with the reason; the admin audit log keeps it;
 *   · the image is no longer the founder's to keep, edit or upload again, and
 *     the daily sweep never removes its row;
 *   · the reports queue lists the images a report names, with their state.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminDeckImages from '../src/routes/admin_deck_images.ts';
import deckImages from '../src/routes/deck_images.ts';
import { mount as reportMounts, reportImageUids } from '../src/routes/deck_reports.ts';
import { REASON_MAX, REASON_MIN } from '../src/services/decks/imageTakedown.ts';
import { TAKEDOWN_HEIGHT, TAKEDOWN_WIDTH, takedownPng } from '../src/services/decks/takedownPlaceholder.ts';
import { imageSize } from '../src/services/decks/imageBytes.ts';
import { imageDataUri, sniffImage, writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { writeOdp } from '../src/services/decks/odp.ts';
import { sweepDeckImages } from '../src/services/decks/imageSweep.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-4375-only-not-a-real-credential'.repeat(2);
const KEPT = '3e1b4c85-9f2a-4d6b-8a5c-1d7e0f9b2a31';
const PROPOSED = '4f2c5d96-0a3b-4e7c-9b6d-2e8f1a0c3b42';
const OTHER = '5a3d6ea7-1b4c-4f8d-8c7e-3f9a2b1d4c53';
const ORIGINAL = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const SHA = 'a'.repeat(64);
const REASON = 'Reported as showing a person without their consent.';
const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };
const fileUrl = (uid: string) => `https://app.axal.vc/api/decks/images/${uid}/file`;

// 1 an HQ admin, 2 the venture's founder, 3 another founder, 4 an investor, 5 a second HQ admin.
async function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300], [4, 'investor', null], [5, 'admin', null]] as const) {
    u.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  const img = db.prepare(`INSERT INTO deck_images(uid, project_id, r2_key, mime, size_bytes, width, height, source, use, alt, state, sha256, created_at)
    VALUES (?, ?, ?, 'image/png', 68, 1, 1, 'upload', 'content', ?, ?, ?, datetime('now', '-30 days'))`);
  img.run(KEPT, 1, `deck-images/1/${KEPT}.png`, 'Synthetic team photo', 'kept', SHA);
  img.run(PROPOSED, 1, `deck-images/1/${PROPOSED}.png`, 'Synthetic proposal', 'proposed', 'b'.repeat(64));
  img.run(OTHER, 3, `deck-images/3/${OTHER}.png`, 'Other venture image', 'kept', 'c'.repeat(64));
  const r2 = new Map<string, Uint8Array>([[`deck-images/1/${KEPT}.png`, ORIGINAL], [`deck-images/1/${PROPOSED}.png`, ORIGINAL], [`deck-images/3/${OTHER}.png`, ORIGINAL]]);
  const FILES = {
    get: async (k: string) => (r2.has(k) ? { body: new Blob([r2.get(k)!]).stream() } : null),
    put: async (k: string, v: any) => { r2.set(k, new Uint8Array(await new Response(v).arrayBuffer())); },
    delete: async (k: string) => { r2.delete(k); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>()
    .route('/api/admin/deck-images', adminDeckImages)
    .route('/api/decks', deckImages);
  for (const m of reportMounts) app.route(m.path, m.router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  return { db, env, app, r2, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number | null, method: string, path: string, json?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await f.app.request(path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, bytes: buf, headers: res.headers };
}
const takedown = (f: F, who: number | null, uid: string, reason: unknown = REASON) => call(f, who, 'POST', `/api/admin/deck-images/${uid}/takedown`, { reason });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

test('the placeholder is a 1600 × 900 PNG an export embeds as a picture', () => {
  const png = takedownPng();
  assert.deepEqual(imageSize(png, 'image/png'), { width: TAKEDOWN_WIDTH, height: TAKEDOWN_HEIGHT });
  assert.equal(sniffImage(png), 'png', 'fetchImages keeps it: a raster the PowerPoint, .odp and HTML writers embed');
  assert.ok(png.length < 16_000);
});

test('KEY: after the takedown the image no longer serves: R2 is emptied and the URL answers the placeholder', async () => {
  // Mutations checked: the file route reading R2 before the mark; the R2 delete skipped.
  const f = await fixture();
  try {
    const before = await call(f, null, 'GET', `/api/decks/images/${KEPT}/file`);
    assert.ok(same(before.bytes, ORIGINAL), 'served before');
    const r = await takedown(f, 1, KEPT);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.image.uid, r.body.image.reason, r.body.image.r2_deleted], [KEPT, REASON, true]);
    assert.equal(f.r2.has(`deck-images/1/${KEPT}.png`), false, 'the R2 object is deleted');
    const row = f.db.prepare('SELECT taken_down_at, taken_down_by, taken_down_reason, state FROM deck_images WHERE uid = ?').get(KEPT) as any;
    assert.ok(row.taken_down_at);
    assert.deepEqual([row.taken_down_by, row.taken_down_reason, row.state], [1, REASON, 'kept']);
    const served = await call(f, null, 'GET', `/api/decks/images/${KEPT}/file`);
    assert.equal(served.status, 200);
    assert.ok(same(served.bytes, takedownPng()), 'the placeholder, never the removed bytes');
    assert.ok(!same(served.bytes, ORIGINAL));
    assert.deepEqual([served.headers.get('content-type'), served.headers.get('cache-control'), served.headers.get('x-axal-image-state')], ['image/png', 'no-store', 'taken-down']);
    // A proposal: even with no session, the placeholder (a proposal's own bytes are the venture's only).
    await takedown(f, 5, PROPOSED);
    assert.ok(same((await call(f, null, 'GET', `/api/decks/images/${PROPOSED}/file`)).bytes, takedownPng()));
    // The other venture's image is untouched.
    assert.ok(same((await call(f, null, 'GET', `/api/decks/images/${OTHER}/file`)).bytes, ORIGINAL));
  } finally { f.close(); }
});

test('every render path shows the placeholder: the PowerPoint, .odp and HTML files embed what the URL answers', async () => {
  // The editor, Present and the print page behind the PDF draw `<img src={image_url}>` (BlockGrid); the exports
  // embed what `fetchImages` reads from that same URL. Here the URL is read from the real file route.
  const f = await fixture();
  try {
    await takedown(f, 1, KEPT);
    const url = fileUrl(KEPT);
    const got = await call(f, null, 'GET', `/api/decks/images/${KEPT}/file`);
    const images = new Map<string, any>([[url, { kind: sniffImage(got.bytes), bytes: got.bytes }]]);
    const slides = [{ title: 'Team', blocks: [{ id: 'i1', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 4 }, image_url: url, image_id: KEPT, alt: 'Synthetic team photo' }] }];
    const unzip = (bytes: Uint8Array) => {
      const out = new Map<string, Uint8Array>();
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let i = 0;
      while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
        const size = v.getUint32(i + 18, true); const n = v.getUint16(i + 26, true); const extra = v.getUint16(i + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + n)); const start = i + 30 + n + extra;
        out.set(name, bytes.subarray(start, start + size)); i = start + size;
      }
      return out;
    };
    const pptx = unzip((await writeEditableDeck({ slides, renderable: [{ title: 'Team', fields: [] }] as any, brand: BRAND, notes: false, images, today: '2026-11-04' })).bytes);
    const media = [...pptx].filter(([n]) => n.startsWith('ppt/media/')).map(([, b]) => b);
    assert.equal(media.length, 1);
    assert.ok(same(media[0], takedownPng()), 'the PowerPoint carries the placeholder');
    const odp = unzip((await writeOdp({ title: 'Team', version: 1, slides, renderable: [{ title: 'Team', fields: [] } as any], images, brand: BRAND, notes: false, today: '2026-11-04' })).bytes);
    assert.ok([...odp].filter(([n]) => n.startsWith('Pictures/')).every(([, b]) => same(b, takedownPng())));
    const html = await writeOfflineDeck({
      title: 'Team', version: 1, slides, footer: null, watermark: null, notes: false, sources: false,
      images: new Map([...images].map(([u, v]) => [u, imageDataUri(v.kind, v.bytes)])),
    });
    const uris = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => new Uint8Array(Buffer.from(m[1], 'base64')));
    assert.equal(uris.length, 1);
    assert.ok(same(uris[0], takedownPng()), 'the HTML file carries the placeholder');
    assert.ok(!html.includes(Buffer.from(ORIGINAL).toString('base64')));
  } finally { f.close(); }
});

test('only an HQ admin takes an image down; the reason is required; once only; an unknown uid is 404', async () => {
  // Mutation checked: requireHqAdmin swapped for requireAuth (a founder takes down an image).
  const f = await fixture();
  try {
    for (const who of [2, 3, 4]) {
      const r = await takedown(f, who, KEPT);
      assert.equal(r.status, 403, `member ${who}`);
    }
    assert.equal((await takedown(f, null, KEPT)).status, 401);
    for (const bad of ['', 'too short', null, 42, 'x'.repeat(REASON_MAX + 1)]) {
      const r = await takedown(f, 1, KEPT, bad);
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal((await takedown(f, 1, KEPT, 'x'.repeat(REASON_MIN - 1))).body.error, 'reason_required');
    assert.ok(f.r2.has(`deck-images/1/${KEPT}.png`), 'nothing removed by a refused takedown');
    assert.equal((f.db.prepare('SELECT taken_down_at FROM deck_images WHERE uid = ?').get(KEPT) as any).taken_down_at, null);
    assert.equal((await takedown(f, 1, '00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await takedown(f, 1, 'not-a-uid')).status, 404);
    assert.equal((await takedown(f, 1, KEPT)).status, 200);
    const again = await takedown(f, 5, KEPT, 'A second admin, a second reason.');
    assert.deepEqual([again.status, again.body.error], [409, 'already_taken_down']);
    assert.equal((f.db.prepare('SELECT taken_down_by, taken_down_reason FROM deck_images WHERE uid = ?').get(KEPT) as any).taken_down_reason, REASON, 'the first takedown stands');
  } finally { f.close(); }
});

test('the founder is told with the reason; the admin audit log keeps it, never an email', async () => {
  // Mutations checked: the notify call dropped; the audit row dropped.
  const f = await fixture();
  try {
    await takedown(f, 1, KEPT);
    const n = f.db.prepare("SELECT user_id, title, body, link FROM notifications_inbox WHERE type = 'deck_image_taken_down'").all() as any[];
    assert.deepEqual(n.map((x) => x.user_id), [2], 'the venture\'s founder, nobody else');
    assert.match(n[0].body, new RegExp(REASON.replace('.', '\\.')));
    assert.match(n[0].body, /Image removed by Axal HQ/);
    const log = f.db.prepare("SELECT user_id, details FROM activity_logs WHERE action = 'deck_image_taken_down'").all() as any[];
    assert.equal(log.length, 1);
    assert.equal(log[0].user_id, 1);
    const details = JSON.parse(log[0].details);
    assert.deepEqual([details.image_uid, details.project_id, details.reason, details.r2_deleted], [KEPT, 1, REASON, true]);
    assert.ok(!log[0].details.includes('@'), 'no email in the audit');
  } finally { f.close(); }
});

test('a taken-down image is not the founder\'s to keep, edit, list or upload again; the sweep keeps its row', async () => {
  // Mutations checked: the imageOf guard dropped (a keep succeeds); the sweep's taken_down_at filter dropped.
  const f = await fixture();
  try {
    await takedown(f, 1, PROPOSED);
    const keep = await call(f, 2, 'POST', `/api/decks/images/${PROPOSED}/keep`, { use: 'content', alt: 'x' });
    assert.deepEqual([keep.status, keep.body.error], [410, 'image_taken_down']);
    assert.equal((await call(f, 2, 'POST', `/api/decks/images/${PROPOSED}/discard`)).status, 410);
    // The daily sweep would remove a 30-day-old proposal; this one stays as the record.
    await sweepDeckImages(f.env, new Date(Date.now() + 86400_000));
    assert.ok(f.db.prepare('SELECT 1 FROM deck_images WHERE uid = ?').get(PROPOSED), 'the row is the record of the takedown');
    assert.ok(same((await call(f, null, 'GET', `/api/decks/images/${PROPOSED}/file`)).bytes, takedownPng()), 'and still answers the placeholder');
  } finally { f.close(); }
});

test('the reports queue names the images a report\'s result and card carry, with whether HQ took them down', async () => {
  // Mutation checked: images left off the queue row (HQ has nothing to take down from the report).
  assert.deepEqual(reportImageUids({ after: { image_url: `/api/decks/images/${KEPT}/file` } }, [{ blocks: [{ image_id: PROPOSED }] }], { index: 0 }), [KEPT, PROPOSED]);
  assert.deepEqual(reportImageUids(null, [{ blocks: [{ image_url: fileUrl(KEPT) }] }], null), [], 'no card, no images from the deck');
  const f = await fixture();
  try {
    f.db.exec(`INSERT INTO pitch_decks(id, project_id, title, version, slides) VALUES (10, 1, 'Synthetic deck', 3, '${JSON.stringify([{ title: 'Team', blocks: [{ id: 'i1', kind: 'image', image_url: fileUrl(KEPT), image_id: KEPT }] }]).replace(/'/g, "''")}')`);
    f.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, model)
      VALUES ('p1', 2, 'Founder · Raise · Pitch deck', 'deck:image', 'deck:10', 'proposal', ?, '@cf/synthetic/model-a')`).run(JSON.stringify({ deck_id: 10, card: 0 }));
    const filed = await call(f, 2, 'POST', '/api/decks/proposals/p1/report', { reason: 'bad_image' });
    assert.equal(filed.status, 201, JSON.stringify(filed.body));
    const before = await call(f, 1, 'GET', '/api/admin/deck-reports?status=open');
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.deepEqual(before.body.reports[0].images, [{ uid: KEPT, url: `/api/decks/images/${KEPT}/file`, taken_down: false }]);
    await takedown(f, 1, KEPT);
    assert.equal((await call(f, 1, 'GET', '/api/admin/deck-reports?status=open')).body.reports[0].images[0].taken_down, true);
  } finally { f.close(); }
});
