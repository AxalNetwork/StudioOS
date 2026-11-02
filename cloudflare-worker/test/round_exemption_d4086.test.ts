/**
 * D4086 (#4086, #4087) — a round's securities exemption, recorded on the round.
 *
 *   1. The migration adds `raise_rounds.exemption` with no default; existing rows read NULL; the CHECK holds the list.
 *   2. The round write records it as the founder's statement: kept when left out, cleared by null, refused when off the
 *      list, and logged for Activity by field name.
 *   3. A round recorded as 506(b) cannot publish, whatever a request states; a round with none recorded cannot publish,
 *      and the refusal names Raise; a deck with no round, or a Reg CF round, cannot either. The read shows the round.
 *   4. A round changed to 506(b) unpublishes its decks' published links (and only those), with a notice to the founder;
 *      the link still opens as a private link.
 *   5. A link published before the round records an exemption keeps working; once the round records one that is not
 *      506(c), every read of the link (share read, email gate, embed) stops treating it as published.
 *   6. A round that cannot be read refuses publishing (503) and leaves an existing link as it was.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/round_exemption_d4086.test.ts
 *
 * In-memory SQLite: the baseline and every post-cutoff migration. Synthetic names only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import contacts from '../src/routes/contacts.ts';
import deckInvestorLinks from '../src/routes/deck_investor_links.ts';
import deckPublish, { serveDeckEmbed } from '../src/routes/deck_publish.ts';
import decks from '../src/routes/decks.ts';
import { linkStands, publishOf, roundRefusal } from '../src/services/decks/publish.ts';
import { exemptionInput, unpublishes } from '../src/services/decks/roundExemption.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d4086-exemption-0123456789abcdef';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const FILE = '202611022116_raise_rounds_exemption.sql';
const ALL = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);
const ADMIN = 1, FOUNDER = 3, OTHER = 4;
const P = 5, DECK = 6, DECK_OTHER_ROUND = 8, DECK_NO_ROUND = 9, PROSPECT = 7;
const ROUND = 'r-seed-0001', OLD_ROUND = 'r-pre-0001';
const SITE = 'https://partner.example.test';
const SLIDES = [{ title: 'Kestrel Labs' }, { title: 'Traction' }];

function fixture({ exemption = '506c' as string | null, upTo = null as string | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  if (upTo) {
    // The migration's own test: the schema just before it, built here.
    db.exec(BASELINE);
    for (const n of ALL) { if (compareMigrations(n, upTo) >= 0) break; db.exec(readFileSync(`${DIR}/${n}`, 'utf8')); }
    return db;
  }
  loadSchema(db); // the baseline and every migration, built once per run (D4133)
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, 1, ?, 'studio')");
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, FOUNDER, OTHER]) ss.run(id, `j-${id}`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.exec(`INSERT INTO projects (id, name, founder_id, sector, stage) VALUES (${P}, 'Kestrel Labs', 1001, 'Fintech', 'seed')`);
  db.prepare("INSERT INTO raise_rounds (uid, project_id, name, status, exemption) VALUES (?, ?, 'Seed', 'active', ?)").run(ROUND, P, exemption);
  db.prepare("INSERT INTO raise_rounds (uid, project_id, name, status, exemption) VALUES (?, ?, 'Pre-seed', 'closed', '506c')").run(OLD_ROUND, P);
  // Three versions of the venture's deck, each written for a different round (or none).
  const d = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at, round_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  d.run(DECK, P, 3, JSON.stringify(SLIDES), 'Seed deck', 1, '2026-10-21 09:00:00', ROUND);
  d.run(DECK_OTHER_ROUND, P, 1, JSON.stringify(SLIDES), 'Pre-seed deck', 0, '2026-06-01 09:00:00', OLD_ROUND);
  d.run(DECK_NO_ROUND, P, 2, JSON.stringify(SLIDES), 'Loose deck', 0, '2026-06-02 09:00:00', null);
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PROSPECT, P);
  return db;
}

const app = new Hono<any>();
app.route('/api/contacts', contacts);
app.route('/api/decks', deckInvestorLinks);
app.route('/api/decks', deckPublish);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra } as any);
async function req(db: DatabaseSync, method: string, path: string, as: number | null = null, body?: unknown, env?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) {
    const role = as === ADMIN ? 'admin' : 'founder';
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role, jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env ?? envOf(db));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const tokenOf = (sharePath: string) => sharePath.replace('/share/deck/', '');
const make = (db: DatabaseSync, deck = DECK) =>
  req(db, 'POST', `/api/decks/${deck}/investor-links`, ADMIN, { prospect_id: PROSPECT, expires_days: 14, view_limit: null });
const publish = (db: DatabaseSync, id: number, body: Record<string, unknown> = { on: true }, deck = DECK) =>
  req(db, 'PUT', `/api/decks/${deck}/investor-links/${id}/publish`, ADMIN, body);
const readPublish = (db: DatabaseSync, id: number, deck = DECK) => req(db, 'GET', `/api/decks/${deck}/investor-links/${id}/publish`, ADMIN);
const stored = (db: DatabaseSync, id: number) => (db.prepare('SELECT include_json FROM pitch_deck_share_tokens WHERE id = ?').get(id) as any).include_json as string | null;
const round = (db: DatabaseSync) => db.prepare('SELECT * FROM raise_rounds WHERE uid = ?').get(ROUND) as any;
const saveRound = (db: DatabaseSync, body: Record<string, unknown>, as = FOUNDER) => req(db, 'PUT', '/api/contacts/raise-round', as, { project_id: P, ...body });
const notices = (db: DatabaseSync) => {
  try { return db.prepare("SELECT user_id, title, body FROM notifications_inbox WHERE type = 'deck_link_unpublished' ORDER BY id").all() as any[]; } catch { return []; }
};

test('D4086: the migration adds the column with no default; existing rows read NULL; the CHECK holds the list', () => {
  const before = fixture({ upTo: FILE });
  before.prepare("INSERT INTO raise_rounds (uid, project_id, name, status) VALUES ('r-old', 1, 'Old', 'active')").run();
  before.exec(readFileSync(`${DIR}/${FILE}`, 'utf8'));
  const col = (before.prepare('PRAGMA table_info(raise_rounds)').all() as any[]).find((c) => c.name === 'exemption');
  assert.ok(col, 'the column exists');
  assert.equal(col.dflt_value, null, 'no default');
  assert.equal(col.notnull, 0);
  assert.equal((before.prepare("SELECT exemption FROM raise_rounds WHERE uid = 'r-old'").get() as any).exemption, null, 'an existing round reads NULL');
  for (const ok of ['506b', '506c', 'reg_cf', 'reg_s', 'other']) before.prepare('UPDATE raise_rounds SET exemption = ? WHERE uid = ?').run(ok, 'r-old');
  assert.throws(() => before.prepare("UPDATE raise_rounds SET exemption = '506' WHERE uid = 'r-old'").run(), /CHECK/);
  // A round made today, with no exemption given, reads NULL too.
  before.prepare("INSERT INTO raise_rounds (uid, project_id, name, status) VALUES ('r-new', 2, 'New', 'active')").run();
  assert.equal((before.prepare("SELECT exemption FROM raise_rounds WHERE uid = 'r-new'").get() as any).exemption, null);
});

test('D4086: the round write records the founder\'s statement, keeps it when left out, clears it with null, refuses one off the list', async () => {
  const db = fixture({ exemption: null });
  assert.equal((await saveRound(db, { name: 'Seed' })).status, 200);
  assert.equal(round(db).exemption, null, 'nothing is defaulted');
  const bad = await saveRound(db, { exemption: '506' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /506b, 506c, reg_cf, reg_s or other/);
  assert.equal(round(db).exemption, null, 'a refused write writes nothing');
  const set = await saveRound(db, { exemption: '506c' });
  assert.equal(set.status, 200);
  assert.equal(set.body.exemption, '506c');
  assert.equal((await saveRound(db, { name: 'Seed round' })).body.exemption, '506c', 'left out, it is kept');
  assert.equal((await saveRound(db, { exemption: null })).body.exemption, null, 'null clears it');
  const log = db.prepare("SELECT details AS summary FROM activity_logs WHERE action = 'round_updated' ORDER BY id").all() as any[];
  assert.ok(log.some((l) => /exemption/.test(l.summary)), 'Activity names the field');
  assert.deepEqual(exemptionInput('reg_s'), { value: 'reg_s' });
  assert.deepEqual(exemptionInput(undefined), { value: undefined });
  assert.ok('error' in exemptionInput('506(c)'));
  // A new round can be made with one.
  const fresh = fixture();
  fresh.prepare("UPDATE raise_rounds SET status = 'closed' WHERE uid = ?").run(ROUND);
  const made = await saveRound(fresh, { name: 'Series A', exemption: 'reg_cf' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.exemption, 'reg_cf');
});

test('D4086: 506(b), not recorded, no round and Reg CF cannot publish; the read shows the round read-only', async () => {
  const db = fixture({ exemption: '506b' });
  const made = await make(db);
  const id = made.body.link.id;
  const before = stored(db, id);
  const b = await publish(db, id, { on: true, exemption: '506c' });
  assert.equal(b.status, 409);
  assert.equal(b.body.error, 'exemption_506b', 'the round says 506(b), whatever the request states');
  assert.equal(stored(db, id), before, 'nothing is written');
  const read = await readPublish(db, id);
  assert.deepEqual(read.body.round, { uid: ROUND, name: 'Seed', exemption: '506b' });
  assert.equal(read.body.refusal.code, 'exemption_506b');

  db.prepare('UPDATE raise_rounds SET exemption = NULL WHERE uid = ?').run(ROUND);
  const none = await publish(db, id, { on: true, exemption: '506c' });
  assert.equal(none.status, 409);
  assert.equal(none.body.error, 'exemption_not_recorded');
  assert.equal(none.body.message, 'Record this round\'s exemption in Raise first.');
  assert.equal((await readPublish(db, id)).body.round.exemption, null);

  db.prepare("UPDATE raise_rounds SET exemption = 'reg_cf' WHERE uid = ?").run(ROUND);
  assert.equal((await publish(db, id)).body.error, 'exemption_not_publishable');

  const loose = await make(db, DECK_NO_ROUND);
  const noRound = await publish(db, loose.body.link.id, { on: true }, DECK_NO_ROUND);
  assert.equal(noRound.status, 409);
  assert.equal(noRound.body.error, 'round_not_linked');
  assert.equal((await readPublish(db, loose.body.link.id, DECK_NO_ROUND)).body.round, null);

  db.prepare("UPDATE raise_rounds SET exemption = '506c' WHERE uid = ?").run(ROUND);
  const yes = await publish(db, id);
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.publish.exemption, '506c');
  assert.equal(yes.body.refusal, null);
  assert.equal(roundRefusal({ uid: 'x', name: null, exemption: 'other' })?.code, 'exemption_not_publishable');
  assert.equal(roundRefusal({ uid: 'x', name: null, exemption: '506c' }), null);
});

test('D4086: a round changed to 506(b) unpublishes its decks\' published links, with a notice to the founder', async () => {
  const db = fixture();
  const a = (await make(db)).body;
  const b = (await make(db)).body;
  const other = (await make(db, DECK_OTHER_ROUND)).body;
  const plain = (await make(db)).body;
  assert.equal((await publish(db, a.link.id)).status, 200);
  assert.equal((await publish(db, b.link.id)).status, 200);
  assert.equal((await publish(db, other.link.id, { on: true }, DECK_OTHER_ROUND)).status, 200);
  const plainBefore = stored(db, plain.link.id);
  // Recording 506(c) again unpublishes nothing.
  assert.equal((await saveRound(db, { exemption: '506c' })).body.unpublished_links, undefined);
  assert.ok(publishOf(stored(db, a.link.id)));
  const changed = await saveRound(db, { exemption: '506b' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.exemption, '506b');
  assert.equal(changed.body.unpublished_links, 2);
  assert.equal(publishOf(stored(db, a.link.id)), null);
  assert.equal(publishOf(stored(db, b.link.id)), null);
  assert.ok(publishOf(stored(db, other.link.id)), 'another round\'s link is untouched');
  assert.equal(stored(db, plain.link.id), plainBefore, 'an unpublished link is untouched');
  const n = notices(db);
  assert.equal(n.length, 1);
  assert.equal(n[0].user_id, FOUNDER, 'the venture\'s founder is told');
  assert.match(n[0].body, /2 published deck links were unpublished because the round is now recorded as Rule 506\(b\)/);
  assert.ok(!/fay@|Fay/.test(n[0].body), 'no name or email in the notice');
  const log = db.prepare("SELECT details AS summary FROM activity_logs WHERE action = 'deck_link_unpublished'").all() as any[];
  assert.equal(log.length, 1);
  // The link still opens, as the private link it was.
  const open = await req(db, 'GET', `/api/decks/share/${tokenOf(a.share_path)}`);
  assert.equal(open.status, 200);
  assert.equal(open.body.published, null);
  assert.ok(Array.isArray(open.body.slides));
  assert.equal(unpublishes('506c', '506c'), false);
  assert.equal(unpublishes(null, 'reg_s'), true);
  assert.equal(unpublishes('506b', null), false);
});

test('D4086: a link published before the round records an exemption stands until it records one that is not 506(c)', async () => {
  const db = fixture();
  const made = (await make(db)).body;
  const id = made.link.id;
  const token = tokenOf(made.share_path);
  assert.equal((await publish(db, id, { on: true, embed_origins: [SITE] })).status, 200);
  // As if published under D1564's per-link statement: the round has none recorded.
  db.prepare('UPDATE raise_rounds SET exemption = NULL WHERE uid = ?').run(ROUND);
  const env = envOf(db, { ASSETS: { fetch: async () => new Response('<html><div id="root"></div></html>', { status: 200, headers: { 'content-type': 'text/html' } }) } });
  const frame = () => serveDeckEmbed(new Request(`https://axal.vc/embed/${token}`, { headers: { referer: `${SITE}/`, 'sec-fetch-dest': 'iframe' } }), env);
  assert.equal((await req(db, 'GET', `/api/decks/share/${token}`)).body.gate, 'email', 'it keeps working');
  assert.equal((await frame()).status, 200);
  assert.ok((await readPublish(db, id)).body.publish);
  // Recorded under Reg S without the round write (an import, a hand edit): every read re-checks the round.
  db.prepare("UPDATE raise_rounds SET exemption = 'reg_s' WHERE uid = ?").run(ROUND);
  const open = await req(db, 'GET', `/api/decks/share/${token}`);
  assert.equal(open.body.gate, undefined, 'no email gate: it is no longer a page');
  assert.equal(open.body.published, null);
  assert.equal((await frame()).status, 404, 'no embed');
  assert.equal((await req(db, 'POST', `/api/decks/share/${token}/email`, null, { email: 'r@example.test' })).status, 404);
  assert.equal((await readPublish(db, id)).body.publish, null);
  assert.equal(linkStands(null), true);
  assert.equal(linkStands({ uid: 'x', name: null, exemption: null }), true);
  assert.equal(linkStands({ uid: 'x', name: null, exemption: '506b' }), false);
  assert.equal(linkStands('unreadable'), true);
});

test('D4086: a round that cannot be read refuses publishing and leaves an existing link as it was', async () => {
  const db = fixture();
  const made = (await make(db)).body;
  const id = made.link.id;
  assert.equal((await publish(db, id)).status, 200);
  const second = (await make(db)).body;
  // A database whose round has no exemption column (not migrated): the read fails.
  db.exec('ALTER TABLE raise_rounds RENAME COLUMN exemption TO exemption_gone');
  const no = await publish(db, second.link.id);
  assert.equal(no.status, 503);
  assert.equal(no.body.error, 'round_unreadable');
  assert.equal(publishOf(stored(db, second.link.id)), null, 'nothing is written');
  const read = await readPublish(db, id);
  assert.ok(read.body.publish, 'the published link stands');
  assert.equal(read.body.round_readable, false);
  assert.equal((await req(db, 'GET', `/api/decks/share/${tokenOf(made.share_path)}`)).body.gate, 'email');
});

test('D4086: another venture\'s founder cannot record a round\'s exemption', async () => {
  const db = fixture({ exemption: null });
  const r = await saveRound(db, { exemption: '506b' }, OTHER);
  assert.equal(r.status, 403);
  assert.equal(round(db).exemption, null);
});
