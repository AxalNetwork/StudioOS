/**
 * D974 (#2760) — the Advisors & Partners roster store, through the real
 * `admin_network_profiles.ts` routes on `node:sqlite` (the baseline's
 * `network_profiles`, then migration 551 from its file).
 *
 *   1. Migration 551 keeps every hidden row hidden: none becomes archived.
 *   2. The list takes `state`, `q` and `limit`, counts each state, and never
 *      carries the R2 key.
 *   3. Each row's deck reach is the deck's own rule over the rows the deck
 *      reads, whatever the filter or the limit.
 *   4. Hide and Archive are two states: archive, restore (as hidden), and the
 *      refusals between them.
 *   5. Every write reaches `admin_audit_log`, each act under its own name, with
 *      the linked member as its target.
 *   6. A member link must be an account; the creator is recorded.
 *   7. An admin reads the photo of a hidden or archived row; nobody else does,
 *      and the public proxy still serves shown rows only.
 *
 * Every person and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/admin_network_profiles_d974.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import networkProfiles from '../src/routes/admin_network_profiles.ts';
import networkPublic from '../src/routes/network_public.ts';
import { loadNetworkProfiles } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { DECK_ROSTER_PROFILES } from '../src/services/decks/deckRoster.ts';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 900, MEMBER = 901, FOUNDER = 902, GONE = 903;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/551_network_profiles_roster.sql');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function makeR2() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array, opts: any) { objects.set(key, { bytes, type: opts?.httpMetadata?.contentType }); },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: o.bytes, httpMetadata: { contentType: o.type } } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
}

/** The roster before 551: shown and hidden rows, two of them hidden, one with a photo. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partners', 'network_profiles', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 1);
  u.run(MEMBER, 'partner', 'Pat Partner', 'pat@example.test', 1);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1);
  u.run(GONE, 'partner', 'Gil Gone', 'gil@example.test', 0);
  const p = db.prepare('INSERT INTO network_profiles (id, name, kind, role, company, display_order, is_active, photo_r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  // Ten shown rows in deck order (one with no name), and two hidden ones.
  const shown = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', '', 'Hazel', 'Ivy'];
  shown.forEach((n, i) => p.run(i + 1, n, 'advisor', i === 2 ? 'Partner at 50% Capital' : 'Advisor', i === 3 ? 'Synthetic Bank' : null, i, 1, null));
  p.run(20, 'Juniper', 'partner', 'Operator', null, 20, 0, 'network/juniper.png');
  p.run(21, 'Kauri', 'investor', null, null, 21, 0, null);
  db.exec(MIGRATION);
  const files = makeR2();
  files.objects.set('network/juniper.png', { bytes: PNG, type: 'image/png' });
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), FILES: files };
  return { db, env, files };
}

async function token(who: number, role: string) {
  return new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** index.ts maps requireAuth's and requireAdmin's refusals to 401 and 403; the mount here does the same. */
function mounted(router: any) {
  const app = new Hono<any>().route('/', router);
  app.onError((err: any, c: any) => {
    const m = String(err?.message || '');
    return c.json({ error: m }, m === 'Unauthorized' ? 401 : m === 'Admin required' ? 403 : 500);
  });
  return app;
}
const ADMIN_APP = mounted(networkProfiles);
const PUBLIC_APP = mounted(networkPublic);

async function call(f: any, method: string, path: string, body?: unknown, who: [number, string] | null = [ADMIN, 'admin'], app: any = ADMIN_APP) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await token(...who)}`;
  const res = await app.fetch(new Request(`http://x${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), f.env);
  const type = res.headers.get('content-type') || '';
  const raw = new Uint8Array(await res.arrayBuffer());
  let json: any = null;
  if (type.includes('json')) { try { json = JSON.parse(new TextDecoder().decode(raw)); } catch { /* status says it */ } }
  return { status: res.status, body: json, raw, headers: res.headers };
}

const audit = (f: any) => (f.db.prepare('SELECT action, viewed_user_id, filters_json FROM admin_audit_log ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const names = (r: any) => r.body.profiles.map((p: any) => p.name);

test('1. migration 551 keeps every hidden row hidden: none becomes archived', async () => {
  const f = fixture();
  const r = await call(f, 'GET', '/?state=hidden');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(names(r), ['Juniper', 'Kauri']);
  assert.ok(r.body.profiles.every((p: any) => p.state === 'hidden' && p.archived_at === null));
  assert.deepEqual(r.body.counts, { shown: 10, hidden: 2, archived: 0 });
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_profiles WHERE archived_at IS NOT NULL').get() as any).n, 0);
});

test('2. the list takes state, q and limit, and never carries the R2 key', async () => {
  const f = fixture();
  const all = await call(f, 'GET', '/');
  assert.equal(all.body.count, 12, 'shown and hidden by default');
  assert.equal(all.body.truncated, false);
  assert.doesNotMatch(new TextDecoder().decode(all.raw), /photo_r2_key|network\/juniper/, 'the R2 key stays in the Worker');
  const juniper = all.body.profiles.find((p: any) => p.id === 20);
  assert.equal(juniper.has_photo, true);
  assert.equal(juniper.photo_url, '/api/admin/network-profiles/20/photo');
  assert.equal(juniper.public_photo_url, null, 'a hidden row has no public photo');
  assert.deepEqual(names(await call(f, 'GET', '/?state=shown&limit=3')), ['Alder', 'Birch', 'Cedar']);
  const capped = await call(f, 'GET', '/?state=shown&limit=3');
  assert.equal(capped.body.truncated, true);
  assert.deepEqual(names(await call(f, 'GET', '/?q=elm')), ['Elm']);
  assert.deepEqual(names(await call(f, 'GET', '/?q=Synthetic%20Bank')), ['Dogwood'], 'q reads the company');
  assert.deepEqual(names(await call(f, 'GET', '/?q=50%25')), ['Cedar'], 'a % in q is a percent sign, not a wildcard');
  assert.deepEqual(names(await call(f, 'GET', '/?q=_')), [], 'an underscore is an underscore');
  assert.deepEqual(names(await call(f, 'GET', '/?q=operator&state=hidden')), ['Juniper'], 'q reads the role, within the state');
  for (const bad of ['/?state=deleted', '/?limit=0', '/?limit=501', '/?limit=ten']) {
    assert.equal((await call(f, 'GET', bad)).status, 400, bad);
  }
  for (const who of [[FOUNDER, 'founder'], [MEMBER, 'partner']] as Array<[number, string]>) {
    assert.equal((await call(f, 'GET', '/', undefined, who)).status, 403, `${who[1]} reads nothing`);
  }
});

test('3. deck reach is the deck\'s own rule over the rows it reads, whatever the filter or the limit', async () => {
  const f = fixture();
  const r = await call(f, 'GET', '/');
  const reach = Object.fromEntries(r.body.profiles.map((p: any) => [p.id, p.deck_reach]));
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => reach[i]), Array(6).fill('on_slide'));
  assert.deepEqual([7, 9, 10].map((i) => reach[i]), ['name_only', 'name_only', 'counted'], 'eight names: six on the slide, then Ginkgo and Hazel');
  assert.equal(reach[8], 'counted', 'a row with no name is never named');
  assert.equal(reach[20], 'not_on_deck');
  // The deck itself draws exactly the rows marked on_slide.
  const deck = await loadNetworkProfiles(f.env);
  assert.deepEqual(deck.rows.slice(0, DECK_ROSTER_PROFILES).map((p: any) => p.name), r.body.profiles.filter((p: any) => p.deck_reach === 'on_slide').map((p: any) => p.name));
  // A filter or a limit does not move a row's reach.
  const ivy = (await call(f, 'GET', '/?q=ivy')).body.profiles[0];
  assert.equal(ivy.deck_reach, 'counted');
  const ginkgo = (await call(f, 'GET', '/?q=ginkgo&limit=1')).body.profiles[0];
  assert.equal(ginkgo.deck_reach, 'name_only');
});

test('4. Hide and Archive are two states', async () => {
  const f = fixture();
  assert.equal((await call(f, 'PUT', '/1', { is_active: false })).status, 200);
  let alder = (await call(f, 'GET', '/?q=alder')).body.profiles[0];
  assert.deepEqual([alder.state, alder.deck_reach], ['hidden', 'not_on_deck']);
  const a = await call(f, 'POST', '/1/archive');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await call(f, 'GET', '/?q=alder')).body.count, 0, 'an archived row leaves the working list');
  alder = (await call(f, 'GET', '/?state=archived')).body.profiles[0];
  assert.equal(alder.state, 'archived');
  assert.match(alder.archived_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal((await call(f, 'POST', '/1/archive')).status, 409, 'archiving twice is refused');
  const show = await call(f, 'PUT', '/1', { is_active: true });
  assert.equal(show.status, 409, 'an archived row is not shown without a restore');
  assert.equal((f.db.prepare('SELECT is_active FROM network_profiles WHERE id = 1').get() as any).is_active, 0);
  const back = await call(f, 'POST', '/1/restore');
  assert.deepEqual([back.status, back.body.state], [200, 'hidden'], 'restore returns it hidden, not on the deck');
  const restored = (await call(f, 'GET', '/?q=alder')).body.profiles[0];
  assert.deepEqual([restored.state, restored.deck_reach], ['hidden', 'not_on_deck'], 'and the row reads hidden');
  assert.equal((await call(f, 'POST', '/1/restore')).status, 409, 'restoring a row that is not archived is refused');
  assert.equal((await call(f, 'PUT', '/1', { is_active: true })).status, 200);
  assert.equal((await call(f, 'GET', '/?q=alder')).body.profiles[0].deck_reach, 'on_slide');
  // DELETE, which the console calls today, archives.
  assert.equal((await call(f, 'DELETE', '/2')).status, 200);
  assert.equal((await call(f, 'GET', '/?state=archived')).body.profiles[0].name, 'Birch');
  assert.equal((await call(f, 'POST', '/999/archive')).status, 404);
  assert.equal((await call(f, 'POST', '/999/restore')).status, 404);
  assert.deepEqual((await call(f, 'GET', '/')).body.counts, { shown: 9, hidden: 2, archived: 1 });
});

test('5. every write reaches admin_audit_log, each act under its own name, the linked member as its target', async () => {
  const f = fixture();
  await call(f, 'POST', '/', { name: 'Larch', kind: 'partner', linked_user_id: MEMBER });
  const created = (f.db.prepare("SELECT id FROM network_profiles WHERE name = 'Larch'").get() as any).id;
  await call(f, 'PUT', `/${created}`, { role: 'Operating partner' });
  await call(f, 'PUT', `/${created}`, { is_active: false });
  await call(f, 'PUT', `/${created}`, { is_active: false });
  await call(f, 'PUT', `/${created}`, { is_active: true });
  await call(f, 'POST', `/${created}/archive`);
  await call(f, 'POST', `/${created}/restore`);
  await call(f, 'POST', `/${created}/photo`, { data_uri: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}` });
  await call(f, 'POST', '/reorder', { order: [created, 1, 2] });
  const rows = audit(f);
  assert.deepEqual(rows.map((r) => r.action), [
    'network_profile_created', 'network_profile_updated', 'network_profile_hidden', 'network_profile_shown',
    'network_profile_archived', 'network_profile_restored', 'network_profile_photo_uploaded', 'network_profiles_reordered',
  ], 'hiding a hidden row is not an act; each other write is one');
  assert.deepEqual(rows.slice(0, 2).map((r) => r.viewed_user_id), [MEMBER, MEMBER], 'the linked member is the target');
  for (const r of rows) assert.doesNotMatch(String(r.filters_json), /pat@example|network\//, 'no email, no R2 key');
  // The activity log still gets its hashed-actor row for each.
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'network_profile%'").get() as any).n, rows.length);
});

test('6. a member link must be an account; the creator is recorded', async () => {
  const f = fixture();
  for (const bad of [GONE, 99999, 'pat', -1]) {
    const r = await call(f, 'POST', '/', { name: 'Maple', linked_user_id: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'invalid_linked_user');
  }
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM network_profiles WHERE name = 'Maple'").get() as any).n, 0);
  const r = await call(f, 'POST', '/', { name: 'Maple', linked_user_id: MEMBER });
  assert.equal(r.status, 201);
  const maple = (await call(f, 'GET', '/?q=maple')).body.profiles[0];
  // D1125 (AP8b): the linked account's own fields ride along, read only; none is recorded on this account but its name.
  assert.deepEqual(maple.linked_user, { id: MEMBER, name: 'Pat Partner', account: { name: 'Pat Partner', headline: null, company: null, has_photo: false } });
  assert.deepEqual(maple.created_by, { id: ADMIN, name: 'Ada Admin' });
  assert.equal((await call(f, 'PUT', `/${r.body.id}`, { linked_user_id: GONE })).status, 400);
  assert.equal((await call(f, 'PUT', `/${r.body.id}`, { linked_user_id: null })).status, 200);
  assert.equal((await call(f, 'GET', '/?q=maple')).body.profiles[0].linked_user, null);
  // A row from before 551 has no creator: null, never a guess.
  assert.equal((await call(f, 'GET', '/?q=alder')).body.profiles[0].created_by, null);
});

test('D1125 (AP8b): a linked card carries what the account says — its name, headline, firm and whether it has a photo — and never the photo key', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO partners (id, name, email) VALUES (77, 'Sample Ventures', 'firm@example.test')");
  f.db.prepare('UPDATE users SET display_name = ?, headline = ?, partner_id = ?, headshot_r2_key = ? WHERE id = ?')
    .run('Pat P.', 'Operating partner, GTM', 77, 'headshots/pat-private.png', MEMBER);
  const r = await call(f, 'POST', '/', { name: 'Card name', role: 'Card role', linked_user_id: MEMBER });
  assert.equal(r.status, 201);
  const body = (await call(f, 'GET', '/?q=card')).body;
  const card = body.profiles[0];
  assert.deepEqual(card.linked_user.account, { name: 'Pat P.', headline: 'Operating partner, GTM', company: 'Sample Ventures', has_photo: true });
  assert.equal(card.name, 'Card name', 'the card keeps its own fields');
  assert.doesNotMatch(JSON.stringify(body), /headshots\/|pat-private|firm@example|pat@example/, 'no key or email');
  // An unlinked card carries no account at all.
  assert.equal((await call(f, 'GET', '/?q=alder')).body.profiles[0].linked_user, null);
});

test('7. an admin reads the photo of a hidden or archived row; nobody else does; the public proxy serves shown rows only', async () => {
  const f = fixture();
  const hidden = await call(f, 'GET', '/20/photo');
  assert.equal(hidden.status, 200);
  assert.deepEqual([...hidden.raw], [...PNG]);
  assert.equal(hidden.headers.get('content-type'), 'image/png');
  assert.equal(hidden.headers.get('cache-control'), 'private, no-store');
  await call(f, 'POST', '/20/archive');
  assert.equal((await call(f, 'GET', '/20/photo')).status, 200, 'archived too');
  assert.equal((await call(f, 'GET', '/1/photo')).status, 404, 'no photo');
  assert.equal((await call(f, 'GET', '/999/photo')).status, 404);
  for (const who of [[FOUNDER, 'founder'], [MEMBER, 'partner']] as Array<[number, string]>) {
    assert.equal((await call(f, 'GET', '/20/photo', undefined, who)).status, 403, who[1]);
  }
  assert.ok([401, 403].includes((await call(f, 'GET', '/20/photo', undefined, null)).status), 'signed out');
  assert.equal((await call(f, 'GET', '/network/20/photo', undefined, null, PUBLIC_APP)).status, 404, 'the public proxy keeps refusing it');
  await call(f, 'POST', '/20/restore');
  await call(f, 'PUT', '/20', { is_active: true });
  assert.equal((await call(f, 'GET', '/network/20/photo', undefined, null, PUBLIC_APP)).status, 200, 'shown again, served again');
});
