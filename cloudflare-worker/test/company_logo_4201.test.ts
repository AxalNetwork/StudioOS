/**
 * #4201 (#4152 G1) — a company's uploaded logo, on real SQLite: the
 * baseline's tables, migrations 597, 685, 757 and 202611031619 over them, and `company.ts`
 * mounted at /api as `index.ts` mounts it. R2 `COMPANY_LOGOS` is an in-memory
 * stand-in. Every person, company and image below is made up.
 *
 *   · PNG or SVG only, by the bytes; at most 2 MB; near-square (0.9–1.1);
 *   · an SVG that could run or reach outside itself is refused, a plain one kept;
 *   · the edit rule is PATCH /company/:uid's (`canEdit`), support sessions included;
 *   · replace deletes the old object; DELETE clears logo_url and the object;
 *   · GET serves members only, with nosniff, and a CSP for SVG;
 *   · an outside-host logo_url is never touched by a read;
 *   · each upload, replace and remove writes one logo_change membership event
 *     (migration 202611031619) saying the logo's kind before and after, never a URL;
 *     removing a company with no logo writes none.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_logo_4201.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import { storedLogoOf, checkLogo, svgSize, pngSize } from '../src/services/companyLogo.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
const M757 = readFileSync(new URL('../sql/migrations/757_company_default_currency.sql', import.meta.url), 'utf8');
const M4201 = readFileSync(new URL('../sql/migrations/202611031619_company_logo_change_event.sql', import.meta.url), 'utf8');

// Ada is Northwind's primary admin; Ben a plain member; Fay a Founder by role; Cy runs Southwind only; Eve a platform admin.
const ADA = 1, BEN = 2, CY = 3, EVE = 4, FAY = 5;
const NORTH = 1, SOUTH = 2;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'founder', [EVE]: 'admin', [FAY]: 'founder' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597); db.exec(M685); db.exec(M757); db.exec(M4201);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [CY, 'Cy'], [EVE, 'Eve'], [FAY, 'Fay']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, logo_url, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind', null); c.run(SOUTH, 'co-south', 'Southwind', null);
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Member', 1); l.run('l-2', NORTH, BEN, 'Member', 0); l.run('l-5', NORTH, FAY, 'Founder', 0);
  l.run('l-3', SOUTH, CY, 'Admin', 1);
  return db;
}

function r2() {
  const store = new Map<string, { bytes: Uint8Array; type: string }>();
  const deleted: string[] = [];
  return {
    store, deleted,
    async put(key: string, bytes: Uint8Array, o: any) { store.set(key, { bytes: new Uint8Array(bytes), type: o?.httpMetadata?.contentType }); },
    async get(key: string) {
      const v = store.get(key);
      return v ? { body: new Blob([v.bytes]).stream(), httpMetadata: { contentType: v.type } } : null;
    },
    async delete(key: string) { deleted.push(key); store.delete(key); },
  };
}

const envOf = (db: DatabaseSync, logos: any = r2()): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), COMPANY_LOGOS: logos ?? undefined });

async function call(env: any, who: number, method: string, path: string, body?: FormData, claims: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.route('/api', companyRoutes);
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}` }, ...(body ? { body } : {}) }, env);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text, bytes: buf, headers: res.headers };
}

/** A PNG signature and IHDR with this width and height, padded to `pad` bytes. */
function png(width: number, height: number, pad = 64) {
  const b = new Uint8Array(Math.max(pad, 33));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width); dv.setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
const svg = (inner: string, attrs = 'viewBox="0 0 64 64"') => new TextEncoder().encode(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00\x00\x00\x00;');

function form(bytes: Uint8Array, type = 'image/png', name = 'logo.png') {
  const f = new FormData();
  f.append('file', new File([bytes], name, { type }));
  return f;
}

const LOGO = '/api/company/co-north/logo';
/** The issue's limit, written out so a changed constant fails here. */
const TWO_MB = 2 * 1024 * 1024;
const logoUrl = (db: DatabaseSync, id = NORTH) => (db.prepare('SELECT logo_url FROM company_profiles WHERE id = ?').get(id) as any).logo_url;
const eventCount = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM company_membership_events').get() as any).n);

// ── Type, size and shape ────────────────────────────────────────────────────

test('a square PNG is stored under companies/<uid>/, and logo_url becomes its served path', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const res = await call(env, ADA, 'POST', LOGO, form(png(256, 256)));
  assert.equal(res.status, 200);
  const url = logoUrl(db);
  assert.match(url, /^\/api\/company\/co-north\/logo\?v=[0-9a-f]{32}\.png$/);
  assert.equal(res.body.logo_url, url, 'the answer is the company detail with the new logo_url');
  assert.deepEqual([...logos.store.keys()], [storedLogoOf('co-north', url)!.key]);
  assert.match([...logos.store.keys()][0], /^companies\/co-north\/logo-[0-9a-f]{32}\.png$/);
  assert.equal(logos.store.get([...logos.store.keys()][0])!.type, 'image/png');
});

test('size: exactly 2 MB is kept; 2 MB + 1 byte is refused 413 file_too_large and nothing is stored', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const big = await call(env, ADA, 'POST', LOGO, form(png(64, 64, TWO_MB + 1)));
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'file_too_large');
  assert.equal(logos.store.size, 0);
  assert.equal(logoUrl(db), null);
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(64, 64, TWO_MB)))).status, 200);
});

test('type: JPEG, GIF, a PNG declared but not PNG bytes, and an empty file are refused', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  for (const [bytes, type] of [[JPEG, 'image/jpeg'], [JPEG, 'image/png'], [GIF, 'image/gif'], [GIF, 'image/png'], [new TextEncoder().encode('not an image at all'), 'image/png']] as const) {
    const res = await call(env, ADA, 'POST', LOGO, form(bytes, type));
    assert.equal(res.status, 400, `${type} refused`);
    assert.equal(res.body.error, 'file_type_invalid');
    assert.equal(typeof res.body.message, 'string');
  }
  // Wrong magic bytes: one byte off the PNG signature is not a PNG.
  const offByOne = png(64, 64); offByOne[0] = 0x88;
  assert.equal((await call(env, ADA, 'POST', LOGO, form(offByOne))).body.error, 'file_type_invalid');
  // A real PNG declared as JPEG is refused too: a declared type outside PNG/SVG is not trusted.
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(64, 64), 'image/jpeg'))).body.error, 'file_type_invalid');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(new Uint8Array(0)))).body.error, 'file_empty');
  const noFile = new FormData(); noFile.append('other', 'x');
  assert.equal((await call(env, ADA, 'POST', LOGO, noFile)).body.error, 'file_required');
  assert.equal(logos.store.size, 0);
  assert.equal(logoUrl(db), null);
});

test('shape: 0.9–1.1 is kept, outside it is logo_not_square, unreadable dimensions are refused', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(200, 100)))).body.error, 'logo_not_square');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(100, 112)))).body.error, 'logo_not_square');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(112, 100)))).body.error, 'logo_not_square');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(svg('', 'viewBox="0 0 300 100"'), 'image/svg+xml', 'l.svg'))).body.error, 'logo_not_square');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(svg('', 'width="100%" height="100%"'), 'image/svg+xml', 'l.svg'))).body.error, 'logo_dimensions_unreadable');
  // A PNG whose first chunk is not IHDR has no readable size.
  const noIhdr = png(64, 64); noIhdr.set([0x74, 0x45, 0x58, 0x74], 12);
  assert.equal((await call(env, ADA, 'POST', LOGO, form(noIhdr))).body.error, 'logo_dimensions_unreadable');
  assert.equal(logos.store.size, 0);
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(100, 109)))).status, 200, '1 : 1.09 is near enough');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(109, 100)))).status, 200);
  assert.deepEqual(pngSize(png(300, 280)), { width: 300, height: 280 });
  assert.deepEqual(svgSize('<svg width="48px" height="48" viewBox="0 0 10 20">'), { width: 48, height: 48 }, 'width and height win over the viewBox');
  assert.deepEqual(svgSize('<svg viewBox="0,0,24,24">'), { width: 24, height: 24 });
});

// ── SVG ─────────────────────────────────────────────────────────────────────

test('SVG: script, handlers, javascript:, foreignObject, outside hrefs, DOCTYPE and outside url() are refused svg_unsafe', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const bad: Record<string, Uint8Array> = {
    script: svg('<script>alert(1)</script>'),
    scriptCase: svg('<SCRIPT type="text/javascript">x()</SCRIPT>'),
    onload: svg('<rect width="1" height="1"/>', 'viewBox="0 0 64 64" onload="alert(1)"'),
    onclick: svg('<circle r="4" onclick = "x()"/>'),
    javascriptHref: svg('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'),
    javascriptSplit: svg('<a xlink:href="java\tscript:alert(1)"><rect/></a>'),
    javascriptSet: svg('<a><set attributeName="href" to="javascript:alert(1)"/><rect/></a>'),
    vbscript: svg('<animate attributeName="href" values="vbscript:x"/>'),
    entitySet: svg('<a><set attributeName="href" to="&#106;avascript:alert(1)"/><rect/></a>'),
    entityEncoded: svg('<a href="&#106;avascript:alert(1)"><rect/></a>'),
    foreignObject: svg('<foreignObject width="10" height="10"><div>hi</div></foreignObject>'),
    iframe: svg('<iframe src="https://evil.example"/>'),
    externalHref: svg('<image href="https://evil.example/x.png" width="64" height="64"/>'),
    externalXlink: svg('<use xlink:href="https://evil.example/sprite.svg#a"/>'),
    dataHref: svg('<image href="data:image/png;base64,AAAA" width="64" height="64"/>'),
    unquotedHref: svg('<use href=#a />'),
    doctype: new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"></svg>'),
    cssImport: svg('<style>@import "https://evil.example/a.css";</style>'),
    cssUrl: svg('<rect style="fill:url(https://evil.example/p)" width="1" height="1"/>'),
  };
  for (const [name, bytes] of Object.entries(bad)) {
    const res = await call(env, ADA, 'POST', LOGO, form(bytes, 'image/svg+xml', 'l.svg'));
    assert.equal(res.status, 400, `${name} refused`);
    assert.equal(res.body.error, 'svg_unsafe', `${name} refused as svg_unsafe`);
  }
  assert.equal(logos.store.size, 0);
  assert.equal(logoUrl(db), null);
});

test('SVG: a plain SVG with gradients, fragment hrefs and url(#…) is kept and served with a CSP', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const clean = svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#7c3aed"/></linearGradient><path id="p" d="M0 0h64v64z"/></defs>'
    + '<style>.a{fill:url(#g)}</style><use href="#p" class="a"/><use xlink:href="#p"/><text x="4" y="40" font-family="Inter">NW</text>', 'width="64" height="64" viewBox="0 0 64 64"');
  const res = await call(env, ADA, 'POST', LOGO, form(clean, 'image/svg+xml', 'logo.svg'));
  assert.equal(res.status, 200, res.text);
  assert.match(logoUrl(db), /\.svg$/);
  const got = await call(env, BEN, 'GET', LOGO);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('Content-Type'), 'image/svg+xml');
  assert.equal(got.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(got.headers.get('Content-Security-Policy') || '', /^default-src 'none'; style-src 'unsafe-inline'/);
  assert.match(got.headers.get('Content-Disposition') || '', /^inline/);
  assert.match(got.headers.get('Cache-Control') || '', /^private, max-age=\d+$/);
  assert.deepEqual(got.bytes, clean);
  // An SVG declared as octet-stream (some pickers do) is judged by its bytes.
  assert.equal(checkLogo(clean, 'application/octet-stream').ok, true);
});

// ── The edit rule ───────────────────────────────────────────────────────────

test('edit rule: PATCH /company/:uid\'s — a plain member 403, an editor by role or as primary admin and a platform admin allowed, a non-member 403, an unknown uid 404', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const member = await call(env, BEN, 'POST', LOGO, form(png(64, 64)));
  assert.equal(member.status, 403);
  assert.deepEqual(member.body, { detail: 'Not authorized to edit this company' }, 'the same refusal PATCH gives');
  assert.equal((await call(env, BEN, 'DELETE', LOGO)).status, 403);
  assert.equal((await call(env, CY, 'POST', LOGO, form(png(64, 64)))).status, 403, 'a non-member: 403, as PATCH answers');
  assert.equal((await call(env, CY, 'POST', '/api/company/co-nowhere/logo', form(png(64, 64)))).status, 404);
  assert.equal(logos.store.size, 0);
  assert.equal((await call(env, FAY, 'POST', LOGO, form(png(64, 64)))).status, 200, 'a Founder by role edits');
  assert.equal((await call(env, ADA, 'POST', LOGO, form(png(64, 64)))).status, 200, 'the primary admin edits');
  assert.equal((await call(env, EVE, 'POST', LOGO, form(png(64, 64)))).status, 200, 'a platform admin edits, as PATCH allows');
  // The PATCH rule matches: the same people PATCH allows.
  const patch = (who: number) => {
    const app = new Hono(); app.route('/api', companyRoutes);
    return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET))
      .then((t) => app.request('/api/company/co-north', { method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'x' }) }, env))
      .then((r) => r.status);
  };
  assert.deepEqual(await Promise.all([BEN, FAY, ADA, EVE, CY].map(patch)), [403, 200, 200, 200, 403]);
});

test('edit rule: a support session acts as the person it impersonates, as PATCH does', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const asAda = await call(env, ADA, 'POST', LOGO, form(png(64, 64)), { impersonated_by: EVE });
  assert.equal(asAda.status, 200, 'impersonating an editor may replace the logo');
  const asBen = await call(env, BEN, 'POST', LOGO, form(png(64, 64)), { impersonated_by: EVE });
  assert.equal(asBen.status, 403, 'impersonating a plain member may not');
  assert.equal((await call(env, BEN, 'DELETE', LOGO, undefined, { impersonated_by: EVE })).status, 403);
});

// ── Replace, remove, events ─────────────────────────────────────────────────

const logoEvents = (db: DatabaseSync) => db.prepare("SELECT actor_user_id, before_json, after_json FROM company_membership_events WHERE kind = 'logo_change' AND company_id = ? ORDER BY id").all(NORTH)
  .map((r: any) => [r.actor_user_id, JSON.parse(r.before_json ?? 'null'), JSON.parse(r.after_json ?? 'null')]);

test('replace deletes the old object; DELETE clears logo_url and the object; each writes one logo_change event', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const before = eventCount(db);
  await call(env, ADA, 'POST', LOGO, form(png(64, 64)));
  const first = storedLogoOf('co-north', logoUrl(db))!.key;
  await call(env, ADA, 'POST', LOGO, form(svg(''), 'image/svg+xml', 'l.svg'));
  const second = storedLogoOf('co-north', logoUrl(db))!.key;
  assert.notEqual(first, second);
  assert.deepEqual([...logos.store.keys()], [second], 'only the current logo is stored');
  assert.deepEqual(logos.deleted, [first]);

  const del = await call(env, ADA, 'DELETE', LOGO);
  assert.equal(del.status, 200);
  assert.equal(del.body.logo_url, null);
  assert.equal(logoUrl(db), null);
  assert.equal(logos.store.size, 0);
  assert.deepEqual(logos.deleted, [first, second]);
  assert.equal((await call(env, BEN, 'GET', LOGO)).body.error, 'no_stored_logo');
  assert.equal(eventCount(db), before + 3, 'upload, replace, remove: one event each');
  assert.deepEqual(logoEvents(db), [
    [ADA, { logo: null }, { logo: 'stored' }],
    [ADA, { logo: 'stored' }, { logo: 'stored' }],
    [ADA, { logo: 'stored' }, { logo: null }],
  ]);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT before_json, after_json FROM company_membership_events').all()), /co-north|companies\/|\?v=/, 'never a URL or a key');
  // Removing again, with no logo, changes nothing and records nothing.
  assert.equal((await call(env, ADA, 'DELETE', LOGO)).status, 200);
  assert.equal(eventCount(db), before + 3);
});

test('an outside-host logo_url: reads leave it alone; GET says there is no stored logo; DELETE never deletes an object for it', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const outside = 'https://cdn.example.test/northwind.png';
  db.prepare('UPDATE company_profiles SET logo_url = ? WHERE id = ?').run(outside, NORTH);
  const got = await call(env, BEN, 'GET', LOGO);
  assert.equal(got.status, 404);
  assert.equal(got.body.error, 'no_stored_logo');
  assert.equal((await call(env, BEN, 'GET', '/api/company/co-north')).body.logo_url, outside);
  assert.equal((await call(env, BEN, 'GET', '/api/company/memberships')).body[0].logo_url, outside);
  assert.equal(logoUrl(db), outside, 'unchanged by reads');
  // A path naming another company's object is not this company's logo either.
  db.prepare('UPDATE company_profiles SET logo_url = ? WHERE id = ?').run(`/api/company/co-south/logo?v=${'a'.repeat(32)}.png`, NORTH);
  assert.equal(storedLogoOf('co-north', logoUrl(db)), null);
  assert.equal((await call(env, BEN, 'GET', LOGO)).body.error, 'no_stored_logo');
  // Our prefix with a malformed version is not a key either: nothing is read or deleted for it.
  db.prepare('UPDATE company_profiles SET logo_url = ? WHERE id = ?').run('/api/company/co-north/logo?v=../../co-south/logo-x.png', NORTH);
  assert.equal(storedLogoOf('co-north', logoUrl(db)), null);
  assert.equal((await call(env, ADA, 'DELETE', LOGO)).status, 200);
  assert.deepEqual(logos.deleted, []);
  db.prepare('UPDATE company_profiles SET logo_url = ? WHERE id = ?').run(outside, NORTH);
  assert.equal((await call(env, ADA, 'DELETE', LOGO)).status, 200);
  assert.equal(logoUrl(db), null, 'Remove clears an outside URL too');
  assert.deepEqual(logoEvents(db).at(-1), [ADA, { logo: 'outside' }, { logo: null }], 'the event says it was an outside logo, not which');
  assert.deepEqual(logos.deleted, [], 'and deletes no object for it');
});

// ── Reads ───────────────────────────────────────────────────────────────────

test('GET: members and platform admins read it; a member of another company gets the same 404 as an unknown uid', async () => {
  const db = fixture(); const logos = r2(); const env = envOf(db, logos);
  const bytes = png(64, 64);
  await call(env, ADA, 'POST', LOGO, form(bytes));
  const ben = await call(env, BEN, 'GET', LOGO);
  assert.equal(ben.status, 200);
  assert.equal(ben.headers.get('Content-Type'), 'image/png');
  assert.equal(ben.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(ben.headers.get('Content-Security-Policy'), null);
  assert.deepEqual(ben.bytes, bytes);
  assert.equal((await call(env, EVE, 'GET', LOGO)).status, 200);
  const cy = await call(env, CY, 'GET', LOGO);
  const unknown = await call(env, CY, 'GET', '/api/company/co-nowhere/logo');
  assert.equal(cy.status, 404);
  assert.deepEqual(cy.body, unknown.body, 'a non-member learns nothing an unknown uid would not say');
  // Even with the exact versioned URL.
  assert.equal((await call(env, CY, 'GET', logoUrl(db))).status, 404);
});

test('no bucket bound: POST answers 503 storage_unconfigured and writes nothing', async () => {
  const db = fixture(); const env = envOf(db, null);
  const res = await call(env, ADA, 'POST', LOGO, form(png(64, 64)));
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'storage_unconfigured');
  assert.equal(logoUrl(db), null);
});

test('wrangler.toml binds COMPANY_LOGOS to studioos-company-logos at the top level and under production', () => {
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const top = /\[\[r2_buckets\]\]\s*\nbinding\s*=\s*"COMPANY_LOGOS"\s*\nbucket_name\s*=\s*"studioos-company-logos"/;
  const prod = /\[\[env\.production\.r2_buckets\]\]\s*\nbinding\s*=\s*"COMPANY_LOGOS"\s*\nbucket_name\s*=\s*"studioos-company-logos"/;
  assert.match(toml, top);
  assert.match(toml, prod);
});
