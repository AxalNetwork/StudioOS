/**
 * D1199 (#3149) — a product-testing programme's logo: the upload and the serve
 * routes beside `routes/testing.ts`, on the SQLite D1 harness with migration
 * 516 and an in-memory R2 bucket. Every firm, person and image is made up.
 *
 * What these prove:
 *   · The bytes decide the type: a PNG and a square SVG are stored; a file that
 *     only says it is an image, a GIF, and text are refused as `not_an_image`.
 *   · An SVG with script, a handler, a `javascript:` link or `<foreignObject>`
 *     is refused; a clean one is stored as the sanitiser rebuilds it.
 *   · Not square, too big and empty are refused; nothing is stored or set.
 *   · A partner cannot set or remove another firm's logo (404, as a missing
 *     programme), and HQ's route reaches only HQ's own programmes.
 *   · A programme body cannot carry `logo_key`; only the upload sets it.
 *   · The serve route answers the image with nosniff and a cache header; a
 *     missing logo, or a draft's logo to a stranger, is 404.
 *   · Replacing a logo deletes the old object.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_logo_d1199.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { testing, partnerTesting, adminTesting } from '../src/routes/testing.ts';
import { LOGO_MAX_BYTES, checkLogo, pngSize, svgIsSquare, svgIsUnsafe, svgText } from '../src/services/testingLogo.ts';

const JWT_SECRET = 'unit-test-jwt-secret-logo-0123456789-abcdef'; // synthetic test fixture
const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const HQ = 1, ACME = 10, GLOBEX = 12, FRAN = 20;
const ACME_FIRM = 1, GLOBEX_FIRM = 2;

function coerce(a: any[]) { return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); }
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = coerce(x); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() { return api.runSync(); },
      runSync() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(xs: any[]) {
      db.exec('BEGIN');
      try { const out = xs.map((x) => x.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/** An in-memory R2 bucket: put, get and delete, with the content type kept. */
function fakeR2() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array, opts: any) { objects.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType }); },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: o.bytes, httpMetadata: { contentType: o.contentType } } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
}

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'partners', 'notifications_inbox', 'insight_subscriptions']) db.exec(ddl(t));
  db.exec(readFileSync(`${SQL}/migrations/515_newsletter_lists.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/migrations/516_product_testing.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/migrations/517_mail_link.sql`, 'utf8'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, partner_id) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, name, firm] of [
    [HQ, 'admin', 'Hana Q', null], [ACME, 'partner', 'Ada Acme', ACME_FIRM], [GLOBEX, 'partner', 'Gus Globex', GLOBEX_FIRM], [FRAN, 'founder', 'Fran Ruiz', null],
  ] as const) u.run(id, `u${id}@example.test`, name, role, firm);
  db.exec(`INSERT INTO partners (id, uid, name, company, email) VALUES (${ACME_FIRM}, 'p1', 'Ada Acme', 'Acme Labs', 'acme@example.test'),
    (${GLOBEX_FIRM}, 'p2', 'Gus Globex', 'Globex', 'globex@example.test');
    INSERT INTO super_admins (user_id) VALUES (${HQ});`);
  const app = new Hono();
  app.route('/api/testing', testing);
  app.route('/api/partner/testing', partnerTesting);
  app.route('/api/admin/testing', adminTesting);
  const files = fakeR2();
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), FILES: files } as any;
  return { db, app, env, files };
}

const ROLE: Record<number, string> = { [HQ]: 'admin', [ACME]: 'partner', [GLOBEX]: 'partner' };
const jwt = (who: number) => new SignJWT({ user_id: who, role: ROLE[who] ?? 'founder' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwt(who)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const saved = console.warn; console.warn = () => {};
  try {
    const res = await w.app.request(`/api${path}`, init, w.env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = saved; }
}

/** A multipart upload of `bytes` as `file`, declared as `type`. */
async function upload(w: any, who: number, path: string, bytes: Uint8Array, type = 'image/png') {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), 'logo');
  const saved = console.warn; console.warn = () => {};
  try {
    const res = await w.app.request(`/api${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${await jwt(who)}` }, body: form }, w.env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = saved; }
}

async function fetchLogo(w: any, who: number, uid: string) {
  const res = await w.app.request(`/api/testing/programmes/${uid}/logo`, { headers: { Authorization: `Bearer ${await jwt(who)}` } }, w.env);
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** An invented PNG header: the signature and an IHDR chunk of `w` × `h`, then padding. */
function png(width: number, height: number, pad = 64): Uint8Array {
  const b = new Uint8Array(33 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
const text = (s: string) => new TextEncoder().encode(s);
const SQUARE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#5b4bdb"/></svg>';

const PROGRAMME = {
  product_name: 'Ledger beta', summary: 'A new close process', tester_tasks: 'Run one month-end close',
  time_needed: '2 hours a week', places: 2, eligible_roles: ['founder'], questions: [],
};
const createAs = async (w: any, who: number, base: string) => (await call(w, who, 'POST', `${base}/programmes`, PROGRAMME)).body.programme.uid as string;
const logoKey = (w: any, uid: string) => (w.db.prepare('SELECT logo_key FROM testing_programmes WHERE uid = ?').get(uid) as any).logo_key;

test('a square PNG is stored under the Worker\'s key and served with nosniff and a cache header', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  const r = await upload(w, ACME, `/partner/testing/programmes/${uid}/logo`, png(128, 128));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.logo.content_type, 'image/png');
  const key = logoKey(w, uid);
  assert.ok(key.startsWith(`testing-logos/${uid}/`), key);
  assert.match(key.slice(`testing-logos/${uid}/`.length), /^[0-9a-f-]{36}\.png$/);
  assert.equal(r.body.logo.logo_key, key);
  assert.ok(w.files.objects.has(key));
  assert.deepEqual(w.db.prepare('SELECT action FROM testing_events ORDER BY id').all().map((e: any) => e.action), ['created', 'logo_set']);
  // The owner reads it while it is a draft.
  const served = await fetchLogo(w, ACME, uid);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('cache-control') || '', /max-age=\d+/);
  assert.deepEqual([...served.bytes], [...png(128, 128)]);
  // The programme read names the key.
  const list = await call(w, ACME, 'GET', '/partner/testing/programmes');
  assert.equal(list.body.items[0].logo_key, key);
});

test('the bytes decide the type: a declared image that is not one, a GIF and text are refused, and nothing is stored', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  for (const [bytes, type] of [
    [text('not an image at all'), 'image/png'],
    [(() => { const b = png(64, 64); b[0] = 0x00; b[1] = 0x41; return b; })(), 'image/png'],
    [text('GIF89a....'), 'image/gif'],
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]), 'image/jpeg'],
    [text('<html><body>hello</body></html>'), 'image/svg+xml'],
  ] as const) {
    const r = await upload(w, ACME, `/partner/testing/programmes/${uid}/logo`, bytes, type);
    assert.equal(r.status, 400, type);
    assert.equal(r.body.error, 'not_an_image', type);
  }
  assert.equal(logoKey(w, uid), null);
  assert.equal(w.files.objects.size, 0);
});

test('an SVG with script, a handler, a javascript: link or an embedded document is refused; a clean one is stored rebuilt', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/onmouseover=alert(1) width="10" height="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject><div>x</div></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.test/x.png"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 10 10"></svg>',
  ]) {
    const r = await upload(w, ACME, `/partner/testing/programmes/${uid}/logo`, text(bad), 'image/svg+xml');
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error, 'unsafe_svg', bad);
  }
  assert.equal(w.files.objects.size, 0);
  const withExtra = SQUARE_SVG.replace('</svg>', '<sodipodi:namedview pagecolor="#fff"/></svg>');
  const ok = await upload(w, ACME, `/partner/testing/programmes/${uid}/logo`, text(`<?xml version="1.0"?>\n${withExtra}`), 'text/plain');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.logo.content_type, 'image/svg+xml');
  const stored = new TextDecoder().decode(w.files.objects.get(logoKey(w, uid))!.bytes);
  assert.match(stored, /^<svg/);
  assert.match(stored, /<circle/);
  assert.ok(!/<\?xml/.test(stored), 'the stored SVG is the sanitiser\'s rebuild, not the upload');
  assert.ok(!/namedview/.test(stored), 'an element off the allowlist is not stored');
  const served = await fetchLogo(w, ACME, uid);
  assert.equal(served.headers.get('content-type'), 'image/svg+xml');
  assert.match(served.headers.get('content-security-policy') || '', /default-src 'none'/);
});

test('not square, too big and empty are refused', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  const path = `/partner/testing/programmes/${uid}/logo`;
  assert.equal((await upload(w, ACME, path, png(200, 100))).body.error, 'not_square');
  assert.equal((await upload(w, ACME, path, text('<svg viewBox="0 0 20 10"></svg>'), 'image/svg+xml')).body.error, 'not_square');
  assert.equal((await upload(w, ACME, path, text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).body.error, 'not_square', 'an SVG that says no size');
  const big = await upload(w, ACME, path, png(64, 64, LOGO_MAX_BYTES));
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'file_too_large');
  assert.equal((await upload(w, ACME, path, new Uint8Array(0))).body.error, 'empty_file');
  assert.equal(logoKey(w, uid), null);
  assert.equal(w.files.objects.size, 0);
});

test('a partner cannot set or remove another firm\'s logo, and HQ\'s route reaches only HQ\'s own', async () => {
  const w = world();
  const acme = await createAs(w, ACME, '/partner/testing');
  const hq = await createAs(w, HQ, '/admin/testing');
  const other = await upload(w, GLOBEX, `/partner/testing/programmes/${acme}/logo`, png(64, 64));
  assert.equal(other.status, 404);
  assert.equal((await call(w, GLOBEX, 'DELETE', `/partner/testing/programmes/${acme}/logo`)).status, 404);
  assert.equal((await upload(w, ACME, `/partner/testing/programmes/${hq}/logo`, png(64, 64))).status, 404, 'a partner never reaches HQ\'s programme');
  assert.equal((await upload(w, HQ, `/admin/testing/programmes/${acme}/logo`, png(64, 64))).status, 404, 'HQ\'s route is HQ\'s own programmes');
  assert.equal((await upload(w, FRAN, `/admin/testing/programmes/${hq}/logo`, png(64, 64))).status === 200, false, 'a member is not HQ');
  assert.equal(logoKey(w, acme), null);
  const mine = await upload(w, HQ, `/admin/testing/programmes/${hq}/logo`, png(64, 64));
  assert.equal(mine.status, 200);
  assert.equal(w.files.objects.size, 1);
});

test('only the upload sets logo_key: a programme body that carries one is refused', async () => {
  const w = world();
  const made = await call(w, ACME, 'POST', '/partner/testing/programmes', { ...PROGRAMME, logo_key: 'testing-logos/x/y.png' });
  assert.equal(made.status, 400);
  const uid = await createAs(w, ACME, '/partner/testing');
  const edit = await call(w, ACME, 'PATCH', `/partner/testing/programmes/${uid}`, { logo_key: 'kyc/1/passport.png' });
  assert.equal(edit.status, 400);
  assert.equal(logoKey(w, uid), null);
});

test('serving: a missing logo is 404, a draft\'s logo is the owner\'s alone, an open one any member\'s', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  assert.equal((await fetchLogo(w, ACME, uid)).status, 404, 'no logo yet: the page draws the initial letter');
  assert.equal((await fetchLogo(w, ACME, 'no-such-programme')).status, 404);
  await upload(w, ACME, `/partner/testing/programmes/${uid}/logo`, png(64, 64));
  assert.equal((await fetchLogo(w, FRAN, uid)).status, 404, 'a draft is not a member\'s to see');
  assert.equal((await fetchLogo(w, GLOBEX, uid)).status, 404, 'nor another firm\'s');
  assert.equal((await fetchLogo(w, HQ, uid)).status, 200, 'Super Admin reviews it');
  w.db.prepare("UPDATE testing_programmes SET status = 'open' WHERE uid = ?").run(uid);
  assert.equal((await fetchLogo(w, FRAN, uid)).status, 200);
  // A key outside the prefix is never served, whatever the row says.
  w.files.objects.set('kyc/1/passport.png', { bytes: png(8, 8), contentType: 'image/png' });
  w.db.prepare("UPDATE testing_programmes SET logo_key = 'kyc/1/passport.png' WHERE uid = ?").run(uid);
  assert.equal((await fetchLogo(w, HQ, uid)).status, 404);
});

test('replacing a logo deletes the old object; removing it clears the key; an approved programme is not editable', async () => {
  const w = world();
  const uid = await createAs(w, ACME, '/partner/testing');
  const path = `/partner/testing/programmes/${uid}/logo`;
  await upload(w, ACME, path, png(64, 64));
  const first = logoKey(w, uid);
  await upload(w, ACME, path, text(SQUARE_SVG), 'image/svg+xml');
  const second = logoKey(w, uid);
  assert.notEqual(first, second);
  assert.ok(!w.files.objects.has(first), 'the old object is gone');
  assert.deepEqual([...w.files.objects.keys()], [second]);
  const removed = await call(w, ACME, 'DELETE', path);
  assert.equal(removed.status, 200);
  assert.equal(logoKey(w, uid), null);
  assert.equal(w.files.objects.size, 0);
  await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`);
  const locked = await upload(w, ACME, path, png(64, 64));
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, 'not_editable');
  assert.equal(w.files.objects.size, 0, 'a refused upload stores nothing');
});

test('the checks alone', () => {
  assert.deepEqual(pngSize(png(48, 48)), { width: 48, height: 48 });
  assert.equal(pngSize(text('\x89PNG nope')), null);
  assert.equal(svgText(text('﻿<!-- a mark --><svg viewBox="0 0 1 1"/>'))?.startsWith('<svg'), true);
  assert.equal(svgText(new Uint8Array([0xff, 0xfe, 0x3c])), null, 'not UTF-8');
  assert.equal(svgIsSquare('<svg width="32px" height="32">'), true);
  assert.equal(svgIsSquare('<svg viewBox="0,0,10,20">'), false);
  assert.equal(svgIsSquare('<svg>'), null);
  assert.equal(svgIsUnsafe('<svg><use href="#a"/></svg>'), false, 'an in-document reference is fine');
  assert.equal(svgIsUnsafe('<svg><use xlink:href="data:image/svg+xml;base64,AAAA"/></svg>'), true);
  assert.throws(() => checkLogo(png(10, 11)), /square/);
  assert.throws(() => checkLogo(png(16, 16, LOGO_MAX_BYTES)), (e: any) => e.code === 'file_too_large' && e.status === 413, 'the check caps the size itself');
  assert.throws(() => checkLogo(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), /square viewBox/, 'an SVG that says no size is asked for a viewBox');
});

test('the source: the serve route reads only its prefix, and no log line carries a key', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/testingLogo.ts'), 'utf8');
  assert.match(src, /startsWith\(LOGO_PREFIX\)/);
  const calls = [...src.matchAll(/console\.(?:log|warn|error)\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 1);
  for (const args of calls) assert.match(args, /^'[^'$]*'$/, `a log line carries a value: ${args}`);
});
