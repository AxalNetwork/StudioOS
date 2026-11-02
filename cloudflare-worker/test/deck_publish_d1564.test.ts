/**
 * D1564 (#3811, deck builder v2 D3) — a share link published as a web page.
 *
 *   1. A 506(b) round cannot publish (409 `exemption_506b`), and nothing is written; 506(c) can, with the email gate.
 *   2. An unstated exemption is refused; a stored state that is not 506(c) never reads as published.
 *   3. Public (un-gated) views are off until T: an un-gated publish is refused, and a published link's read
 *      sends no card and uses no view until this browser gives an email, even when the stored gate says none.
 *   4. `/embed/:token` answers only a frame from a listed origin, with `frame-ancestors` and no X-Frame-Options;
 *      the SPA's `_headers` deny stays, and both `run_worker_first` lists carry `/embed/*`.
 *   5. og:image per link: only while public views are on; until then the private card stays.
 *   6. The include switches survive publishing; the deck gate (another venture's founder, no session).
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import deckPublish, { serveDeckEmbed, serveDeckShareCard } from '../src/routes/deck_publish.ts';
import decks from '../src/routes/decks.ts';
import {
  PUBLIC_VIEWS_ON, cleanEmail, cleanEmbedOrigins, embedAllowed, gateFor, linkOgImage, publishOf, publishRefusal, withPublish,
} from '../src/services/decks/publish.ts';
import { parseShareInclude } from '../src/services/decks/shareInclude.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1564-publish-0123456789abcdef';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const ADMIN = 1, FOUNDER = 3, OTHER = 4;
const P = 5, OTHER_P = 6, DECK = 6, PROSPECT = 7;
const SITE = 'https://partner.example.test';

const SLIDES = [
  { title: 'Kestrel Labs', blocks: [
    { id: 'b1', kind: 'image', image_url: 'https://img.example.test/cover.png', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } },
  ] },
  { title: 'Traction', fields: [{ key: 'traction_grid', label: 'Traction', kind: 'metric_grid', value: [{ label: 'Customers', value: '38' }], source: 'data' }] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, FOUNDER, OTHER]) ss.run(id, `j-${id}`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed'), (${OTHER_P}, 'Other', 1002, 'Health', 'seed')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 2, ?, ?, 1, ?)')
    .run(DECK, P, JSON.stringify(SLIDES), 'Seed deck', '2026-10-21 09:00:00');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PROSPECT, P);
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckInvestorLinks);
app.route('/api/decks', deckPublish);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any);
async function req(db: DatabaseSync, method: string, path: string, as: number | null = null, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) {
    const role = as === ADMIN ? 'admin' : 'founder';
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  if (cookie) headers.Cookie = cookie;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, envOf(db));
  return { status: res.status, body: await res.json().catch(() => null) as any, setCookie: res.headers.get('set-cookie') };
}
const tokenOf = (sharePath: string) => sharePath.replace('/share/deck/', '');
const make = (db: DatabaseSync, body: Record<string, unknown> = {}) =>
  req(db, 'POST', `/api/decks/${DECK}/investor-links`, ADMIN, { prospect_id: PROSPECT, expires_days: 14, view_limit: null, ...body });
const publish = (db: DatabaseSync, id: number, body: Record<string, unknown>, as = ADMIN) => req(db, 'PUT', `/api/decks/${DECK}/investor-links/${id}/publish`, as, body);
const stored = (db: DatabaseSync, id: number) => (db.prepare('SELECT include_json FROM pitch_deck_share_tokens WHERE id = ?').get(id) as any).include_json as string | null;
const views = (db: DatabaseSync, id: number) => Number((db.prepare('SELECT view_count FROM pitch_deck_share_tokens WHERE id = ?').get(id) as any).view_count);

test('D1564: a 506(b) round cannot publish, and nothing is written', async () => {
  const db = fixture();
  const made = await make(db);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const before = stored(db, made.body.link.id);
  const no = await publish(db, made.body.link.id, { on: true, exemption: '506b', gate: 'email' });
  assert.equal(no.status, 409);
  assert.equal(no.body.error, 'exemption_506b');
  assert.match(no.body.message, /506\(b\)/);
  assert.equal(stored(db, made.body.link.id), before, 'a refused publish writes nothing');
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/${made.body.link.id}/publish`, ADMIN)).body.publish, null);
  // The pure rule, whatever the gate or the switch.
  assert.equal(publishRefusal({ exemption: '506b', gate: 'email' }, true)?.code, 'exemption_506b');
  // 506(c) publishes, with the email gate.
  const yes = await publish(db, made.body.link.id, { on: true, exemption: '506c' });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.publish.exemption, '506c');
  assert.equal(yes.body.gate, 'email');
  assert.equal(yes.body.public_views, false);
  assert.match(yes.body.note, /counsel/);
});

test('D1564: an unstated exemption is refused; a stored state that is not 506(c) never reads as published', async () => {
  const db = fixture();
  const made = await make(db);
  const no = await publish(db, made.body.link.id, { on: true });
  assert.equal(no.status, 422);
  assert.equal(no.body.error, 'exemption_missing');
  assert.equal(publishOf(JSON.stringify({ publish: { on: true, exemption: '506b', gate: 'email' } })), null);
  assert.equal(publishOf(JSON.stringify({ publish: { on: true, gate: 'email' } })), null);
  assert.equal(publishOf('not json'), null);
  // A 506(b) state written by hand opens as an investor link, never as a page.
  db.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').run(JSON.stringify({ publish: { on: true, exemption: '506b', gate: 'none' } }), made.body.link.id);
  const open = await req(db, 'GET', `/api/decks/share/${tokenOf(made.body.share_path)}`);
  assert.equal(open.body.published, null);
  assert.equal((await publish(db, made.body.link.id, { on: true, exemption: '506c', embed_origins: ['http://insecure.example.test'] })).body.error, 'embed_origins_invalid');
});

test('D1564: public (un-gated) views are off until T, enforced in the Worker', async () => {
  assert.equal(PUBLIC_VIEWS_ON, false, 'owner decision T: public views stay off until counsel\'s wording lands');
  const db = fixture();
  const made = await make(db);
  const id = made.body.link.id;
  const token = tokenOf(made.body.share_path);
  const ungated = await publish(db, id, { on: true, exemption: '506c', gate: 'none' });
  assert.equal(ungated.status, 409);
  assert.equal(ungated.body.error, 'public_views_off');
  assert.equal(publishRefusal({ exemption: '506c', gate: 'none' }, true), null, 'the same request once T is answered');
  assert.equal((await publish(db, id, { on: true, exemption: '506c', gate: 'email' })).status, 200);
  // Even a stored "none" is gated while public views are off.
  db.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').run(withPublish(stored(db, id), { on: true, gate: 'none', exemption: '506c', embed_origins: [], at: 'x' }), id);
  assert.equal(gateFor(publishOf(stored(db, id))!), 'email');
  assert.equal(gateFor(publishOf(stored(db, id))!, true), 'none');
  const gated = await req(db, 'GET', `/api/decks/share/${token}`);
  assert.equal(gated.status, 200);
  assert.equal(gated.body.gate, 'email');
  assert.equal(gated.body.slides, undefined, 'no card before the email');
  assert.equal(gated.body.project_name, 'Kestrel Labs');
  assert.equal(views(db, id), 0, 'the gate uses no view');
  assert.equal((await req(db, 'POST', `/api/decks/share/${token}/email`, null, { email: 'not an email' })).body.error, 'email_invalid');
  const passed = await req(db, 'POST', `/api/decks/share/${token}/email`, null, { email: 'Reader@Example.test' });
  assert.equal(passed.status, 200);
  const cookie = String(passed.setCookie || '');
  assert.match(cookie, /^axal_deck_gate=[A-Za-z0-9_-]{16,}; Path=\/api\/decks\/share; HttpOnly; Secure; SameSite=None; Partitioned/);
  const row = db.prepare("SELECT ref_id FROM deck_share_conversions WHERE share_token_id = ? AND type = 'email_gate'").get(id) as any;
  assert.equal(JSON.parse(row.ref_id).e, 'reader@example.test');
  const open = await req(db, 'GET', `/api/decks/share/${token}`, null, undefined, cookie.split(';')[0]);
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.slides.map((s: any) => s.title), ['Kestrel Labs', 'Traction']);
  assert.deepEqual(open.body.published, { gate: 'email' });
  assert.equal(views(db, id), 1);
  // Another browser's cookie does not pass.
  assert.equal((await req(db, 'GET', `/api/decks/share/${token}`, null, undefined, 'axal_deck_gate=AAAAAAAAAAAAAAAAAAAAAAAA')).body.gate, 'email');
  // An unpublished link has no gate to pass.
  const plain = await make(db);
  assert.equal((await req(db, 'POST', `/api/decks/share/${tokenOf(plain.body.share_path)}/email`, null, { email: 'a@b.test' })).status, 404);
  assert.equal((await req(db, 'GET', `/api/decks/share/${tokenOf(plain.body.share_path)}`)).body.published, null);
  // Unpublishing turns the gate off again.
  assert.equal((await publish(db, id, { on: false })).body.publish, null);
  assert.ok(Array.isArray((await req(db, 'GET', `/api/decks/share/${token}`)).body.slides));
});

const SHELL = '<!doctype html><html><head>\n  <!-- BEGIN og:managed — x -->\n  <title>Axal</title>\n  <!-- END og:managed -->\n</head><body><div id="root"></div></body></html>';
const assets = { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' } }) };

test('D1564: /embed/:token answers only a frame from a listed origin, with frame-ancestors for that path alone', async () => {
  const db = fixture();
  const made = await make(db);
  const id = made.body.link.id;
  const token = tokenOf(made.body.share_path);
  const env = envOf(db, { ASSETS: assets });
  const frame = (headers: Record<string, string>) => serveDeckEmbed(new Request(`https://axal.vc/embed/${token}`, { headers }), env);
  const from = { referer: `${SITE}/portfolio`, 'sec-fetch-dest': 'iframe' };
  assert.equal((await frame(from)).status, 404, 'an unpublished link is not embeddable');
  assert.equal((await publish(db, id, { on: true, exemption: '506c', embed_origins: [SITE, `${SITE}/`] })).body.publish.embed_origins.length, 1);
  const ok = await frame(from);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-security-policy'), `frame-ancestors ${SITE}`);
  assert.equal(ok.headers.get('x-frame-options'), null, 'no X-Frame-Options on the embed');
  assert.equal(ok.headers.get('x-robots-tag'), 'noindex');
  assert.match(await ok.text(), /id="root"/);
  const elsewhere = await frame({ referer: 'https://evil.example.test/', 'sec-fetch-dest': 'iframe' });
  assert.equal(elsewhere.status, 403);
  assert.equal(elsewhere.headers.get('x-frame-options'), 'DENY');
  assert.equal((await frame({ 'sec-fetch-dest': 'iframe' })).status, 403, 'no referer, no frame');
  assert.equal((await frame({ referer: `${SITE}/`, 'sec-fetch-dest': 'document' })).status, 403, 'a top-level visit is not a frame');
  assert.equal((await serveDeckEmbed(new Request('https://axal.vc/embed/not-a-token-at-all-xx', { headers: from }), env)).status, 404);
  assert.equal(embedAllowed(null, `${SITE}/`, 'iframe'), false);
  assert.deepEqual(cleanEmbedOrigins(['https://a.test/', 'https://a.test']), ['https://a.test']);
  assert.equal(cleanEmbedOrigins(['https://*.a.test']), null);
  assert.equal(cleanEmbedOrigins(['https://a.test/path']), null);
  // Withdrawn: no embed.
  await req(db, 'POST', `/api/decks/${DECK}/investor-links/${id}/withdraw`, ADMIN);
  assert.equal((await frame(from)).status, 404);
  // The SPA's static deny stays for every other path, and the Worker runs first for /embed/* on both hosts.
  const headersFile = readFileSync('frontend/public/_headers', 'utf8');
  assert.match(headersFile, /^\/\*\n(?:.*\n)*?\s+X-Frame-Options: DENY/m);
  const lists = [...readFileSync('wrangler.toml', 'utf8').matchAll(/^run_worker_first = (\[.*\])$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(lists.length, 2);
  for (const l of lists) assert.ok(l.includes('/embed/*'));
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.match(index, /pathname\.startsWith\('\/embed\/'\)\) return serveDeckEmbed\(request, env\)/);
});

test('D1564: og:image per link, only while public views are on; until then the private card stays', async () => {
  const db = fixture();
  const made = await make(db);
  const token = tokenOf(made.body.share_path);
  await publish(db, made.body.link.id, { on: true, exemption: '506c' });
  const env = envOf(db, { ASSETS: assets });
  const url = `https://axal.vc/share/deck/${token}`;
  assert.equal(await serveDeckShareCard(new Request(url), env), null, 'off: Part D\'s static card answers');
  const on = await serveDeckShareCard(new Request(url), env, true);
  assert.ok(on);
  const html = await on!.text();
  assert.match(html, /<meta property="og:image" content="https:\/\/img\.example\.test\/cover\.png" \/>/);
  assert.match(html, /og:title" content="Kestrel Labs · Seed deck"/);
  assert.equal(on!.headers.get('x-robots-tag'), 'noindex');
  // An unpublished link never previews as itself, even with public views on.
  const plain = await make(db);
  assert.equal(await serveDeckShareCard(new Request(`https://axal.vc/share/deck/${tokenOf(plain.body.share_path)}`), env, true), null);
  assert.equal(linkOgImage([{ blocks: [{ kind: 'image', image_url: 'http://x.test/a.png' }] }]), null, 'https only');
  assert.equal(linkOgImage([{ image_url: 'https://x.test/a.png' }]), 'https://x.test/a.png');
});

test('D1564: the include switches survive publishing; the deck gate', async () => {
  const db = fixture();
  const made = await make(db, { include: { figures: false, sources: true, notes: true, bands: false } });
  const id = made.body.link.id;
  const before = parseShareInclude(stored(db, id));
  await publish(db, id, { on: true, exemption: '506c' });
  assert.deepEqual(parseShareInclude(stored(db, id)), before);
  await publish(db, id, { on: false });
  assert.deepEqual(parseShareInclude(stored(db, id)), before);
  assert.equal(JSON.parse(stored(db, id)!).publish, undefined);
  assert.equal((await publish(db, id, { on: true, exemption: '506c' }, OTHER)).status, 403);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/${id}/publish`, OTHER)).status, 403);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/${id}/publish`)).status, 401);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/9999/publish`, ADMIN)).status, 404);
  assert.equal((await req(db, 'GET', `/api/decks/${DECK}/investor-links/${id}/publish`, FOUNDER)).status, 200, 'the venture\'s founder reads it');
  // A withdrawn link cannot be published.
  await req(db, 'POST', `/api/decks/${DECK}/investor-links/${id}/withdraw`, ADMIN);
  const closed = await publish(db, id, { on: true, exemption: '506c' });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error, 'link_closed');
  assert.equal(cleanEmail('a@b.co'), 'a@b.co');
  assert.equal(cleanEmail('<a@b.co>'), null);
});
