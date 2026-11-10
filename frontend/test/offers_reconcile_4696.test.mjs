/**
 * #4696 — the Offers overview, its destinations and the numbers on them
 * describe the same records, and say what each number is.
 *
 * ONE FIXTURE, REAL ROUTES. A single in-memory database is built from the
 * migrations that ship; the real routers answer on it (`/perks/partner`,
 * `/services/offerings`, `/offers/visibility`, `/offers/fit-rules`,
 * `/pipeline/leads`) and the real Offers board and the shared frontend view
 * models read those answers. Nothing here asserts on wording in a source file.
 *
 *   1. root and destination reconcile on the same perk listings, and the root
 *      never reads the viewer's claims on other firms' perks;
 *   2. a catalogue request is a COUNT by status and states no money, so a
 *      reprice restates nothing and a pending request is not booked;
 *   3. Won excludes cancelled work, at the price the quote was accepted at;
 *   4. the fit-rule response says Pipeline scores and ranks with the rules, and
 *      Pipeline does what it says: an excluded lead is listed, unscored, and
 *      nothing is declined for the firm;
 *   5. the signal filter selects one row set for table, list and export.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import perks from '../../cloudflare-worker/src/routes/perks.ts';
import services from '../../cloudflare-worker/src/routes/services.ts';
import partnerOffers from '../../cloudflare-worker/src/routes/partner_offers.ts';
import partnerPipeline from '../../cloudflare-worker/src/routes/partner_pipeline.ts';
import { JWT_SECRET, PARTNER, OTHER_PARTNER, FOUNDER, freshDb as perksDb, makeD1, addPerk, day, token } from '../../cloudflare-worker/test/_perks_harness.ts';
import {
  BOOKED_STATUSES, DELIVERED_STATUSES, INVOICED_STATUSES, PAID_STATUSES,
} from '../../cloudflare-worker/src/services/serviceMeasures.ts';
import { boardFor } from '../src/workspaces/boards/index.js';
import { perkListingBook, perkListingRows } from '../src/lib/perkListings.js';
import { requestTotals } from '../src/lib/serviceMeasures.js';
import { fitView } from '../src/lib/fitRuleView.js';

const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const migration = (n) => readFileSync(`${SQL}/migrations/${n}.sql`, 'utf8');
function baselineTable(name) {
  const sql = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
  const at = sql.indexOf(`CREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return sql.slice(at, sql.indexOf(');', at) + 2);
}

/** One CREATE TABLE out of a migration file, as shipped. */
function migrationTable(file, name) {
  const sql = migration(file);
  const at = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.ok(at >= 0, `${name} is not in ${file}`);
  return sql.slice(at, sql.indexOf(');', at) + 2);
}

const OUR_PARTNER_ID = 1;
const FOUNDER_USER = 40;

function fixture() {
  const db = perksDb();
  db.exec(`
    ALTER TABLE users ADD COLUMN partner_id INTEGER;
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
);
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, name TEXT NOT NULL);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
    ${baselineTable('founder_needs')}
    ${baselineTable('quotes')}
    ${baselineTable('engagements')}
    ${baselineTable('service_offerings')}
    ${migrationTable('034_unmounted_routes', 'service_engagements')}
  `);
  for (const m of ['188_engagement_invoices', '209_partner_offers_stores', '227_service_offering_model_and_cents',
    '229_fit_rule_signal', '233_partner_lead_passes']) db.exec(migration(m));
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(OUR_PARTNER_ID, 'p-1', 'Acme Studio', 'u10@example.test');
  db.prepare('UPDATE users SET partner_id = ? WHERE id = ?').run(OUR_PARTNER_ID, PARTNER);
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?,?,?)').run(FOUNDER_USER, 'Fran', 'f@example.test');
  return db;
}


const envOf = (db) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) });

async function ask(router, env, method, path, who, body) {
  const jwt = await token(who);
  const headers = { Authorization: `Bearer ${jwt}` };
  const init = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init).body = JSON.stringify(body); }
  const res = await router.request(path, init, env);
  assert.ok(res.status < 500, `${method} ${path} answered ${res.status}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The Offers board over the real routes; `spy` records every api method a section called. */
function offersBoard(env, spy = []) {
  const get = (router, path, who = PARTNER) => async () => (await ask(router, env, 'GET', path, who)).body;
  const note = (name, fn) => () => { spy.push(name); return fn(); };
  const api = {
    listServiceOfferings: note('listServiceOfferings', get(services, '/offerings?mine=1')),
    perksMine: note('perksMine', get(perks, '/mine')),
    perkSubmissions: note('perkSubmissions', get(perks, '/partner')),
    getPartnerVisibility: note('getPartnerVisibility', get(partnerOffers, '/visibility')),
    listPartnerProof: note('listPartnerProof', async () => ({ items: [] })),
    listPartnerFitRules: note('listPartnerFitRules', get(partnerOffers, '/fit-rules')),
  };
  return boardFor('partner', '/offers', api)       ;
}
const sectionOf = (board, slug) => board.sections.find((s) => s.slug === slug);

test('#4835: catalogue pages are stable and search finds a match outside the first page', async () => {
  const db = fixture();
  const insert = db.prepare('INSERT INTO service_offerings (id, owner_user_id, title, is_active) VALUES (?, ?, ?, 1)');
  for (let id = 1; id <= 201; id++) insert.run(id, PARTNER, id === 1 ? 'Rare match' : 'Ordinary offer');
  const env = envOf(db);
  const list = async (query) => (await ask(services, env, 'GET', `/offerings?mine=1&${query}`, PARTNER)).body;
  const first = await list('page=1');
  assert.equal(first.items.length, 200);
  assert.equal(first.total, 201);
  assert.equal(first.has_more, true);
  assert.equal(first.measures_scope, 'page');
  const next = await list('page=2');
  assert.deepEqual(next.items.map((item) => item.id), [1]);
  assert.equal(next.has_more, false);
  const searched = await list('q=RARE');
  assert.equal(searched.total, 1);
  assert.deepEqual(searched.items.map((item) => item.id), [1]);
});

// ── 1. root and destination reconcile ───────────────────────────────────────

test('the Offers root reads the firm’s own perk submissions, and reconciles with Perk deals', async () => {
  const db = fixture();
  const env = envOf(db);
  addPerk(db, 'ours-live', { offer: 'Two months of design retainer', status: 'live' });
  addPerk(db, 'ours-ending', { offer: 'Brand audit', status: 'live', ends_at: day(10) });
  addPerk(db, 'ours-ended', { offer: 'Launch kit', status: 'live', ends_at: day(-5) });
  addPerk(db, 'ours-review', { offer: 'Pricing workshop', status: 'in_review' });
  // Another firm's listing, and a claim the viewer made on it: the dataset the
  // root used to draw as if the firm had submitted it.
  addPerk(db, 'theirs', { offer: 'Their cloud credits', partner_user_id: OTHER_PARTNER, status: 'live' });
  const perkId = (db.prepare("SELECT id FROM perks WHERE uid = 'theirs'").get()).id;
  db.prepare("INSERT INTO perk_claims (uid, perk_id, user_id, status) VALUES ('c1', ?, ?, 'issued')").run(perkId, PARTNER);

  const spy = [];
  const board = offersBoard(env, spy);
  const sec = sectionOf(board, 'perk-deals');
  const root = await board.sources[sec.source]();
  const destination = (await ask(perks, env, 'GET', '/partner', PARTNER)).body;

  assert.equal(spy.includes('perksMine'), false, 'the root read the viewer’s claims');
  assert.deepEqual(spy, ['perkSubmissions']);

  // Names, review states and lifecycle states: row for row the destination's.
  const rootRows = sec.rows(root);
  const destRows = perkListingRows(destination.items);
  assert.deepEqual(rootRows.map((r) => r[0]).sort(), destRows.map((r) => r.name).sort());
  assert.equal(rootRows.length, 4);
  assert.ok(!rootRows.some((r) => /cloud credits/.test(r[0])), 'another firm’s perk is on the firm’s overview');
  const byName = Object.fromEntries(rootRows.map((r) => [r[0], r]));
  assert.deepEqual(byName['Pricing workshop'].slice(1), ['In review', 'Live']);
  assert.deepEqual(byName['Brand audit'].slice(1), ['Live', 'Expiring']);
  assert.deepEqual(byName['Launch kit'].slice(1), ['Live', 'Expired']);

  // The count: Live is approved AND not ended, on both pages.
  const book = perkListingBook(destination.items);
  assert.equal(book.live.length, 1);
  assert.equal(book.expiring.length, 1);
  assert.equal(book.expired.length, 1);
  assert.match(sec.summary(root), /4 listings · 1 live/);
  assert.equal(sec.total(root), 4);
});

test('the Offers root says it has no listing when the firm has submitted none', async () => {
  const db = fixture();
  addPerk(db, 'theirs', { offer: 'Their cloud credits', partner_user_id: OTHER_PARTNER });
  const env = envOf(db);
  const board = offersBoard(env);
  const sec = sectionOf(board, 'perk-deals');
  const root = await board.sources[sec.source]();
  assert.deepEqual(sec.rows(root), []);
  assert.equal(sec.summary(root), '0 listings · 0 live');
});

// ── 2. catalogue requests: counts by status, no money ───────────────────────

function seedCatalogue(db) {
  db.prepare('UPDATE users SET partner_id = ? WHERE id = ?').run(OUR_PARTNER_ID, PARTNER);
  db.prepare(`INSERT INTO service_offerings (id, owner_user_id, title, price_usd, price_cents, engagement_model, is_active)
              VALUES (1, ?, 'Brand sprint', 1000, 100000, 'fixed', 1)`).run(PARTNER);
  const req = db.prepare('INSERT INTO service_engagements (offering_id, requester_user_id, owner_user_id, status) VALUES (1, ?, ?, ?)');
  for (const s of ['pending', 'pending', 'cancelled', 'accepted', 'delivered', 'invoiced', 'paid']) req.run(FOUNDER, PARTNER, s);
}

test('catalogue requests are counts by status; a pending request is not booked and nothing is priced', async () => {
  const db = fixture(); seedCatalogue(db);
  const env = envOf(db);
  const r = (await ask(services, env, 'GET', '/offerings?mine=1', PARTNER)).body;
  assert.deepEqual(r.items[0].requests, {
    requested: 7, pending: 2, booked: 4, delivered: 3, invoiced: 2, paid: 1, cancelled: 1,
  });
  assert.equal('sold' in r.items[0], false, 'the sold count is back');
  assert.deepEqual(r.measures, r.items[0].requests, 'the total is not the sum of the rows');
  // No historical monetary measure: null, not zero and not requests x price.
  assert.equal(r.booked_value_cents, null);
  assert.match(r.booked_value_note, /Not recorded/);
  assert.ok(r.measures_basis.booked && r.measures_basis.paid, 'the basis of each measure is not served');
  // The shared frontend total is the worker's total.
  assert.deepEqual(requestTotals(r.items), r.measures);
});

test('the declared status ladders are the ones the catalogue read counts', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO service_offerings (id, owner_user_id, title, price_cents, is_active) VALUES (1, ?, 'Brand sprint', 100, 1)`).run(PARTNER);
  const every = ['pending', 'cancelled', ...BOOKED_STATUSES];
  const req = db.prepare('INSERT INTO service_engagements (offering_id, requester_user_id, owner_user_id, status) VALUES (1, ?, ?, ?)');
  for (const st of every) req.run(FOUNDER, PARTNER, st);
  const r = (await ask(services, envOf(db), 'GET', '/offerings?mine=1', PARTNER)).body.items[0].requests;
  assert.equal(r.requested, every.length);
  assert.equal(r.booked, BOOKED_STATUSES.length);
  assert.equal(r.delivered, DELIVERED_STATUSES.length);
  assert.equal(r.invoiced, INVOICED_STATUSES.length);
  assert.equal(r.paid, PAID_STATUSES.length);
  assert.equal(r.cancelled, 1);
  assert.equal(r.pending, 1);
});

test('repricing a catalogue entry restates no historical measure', async () => {
  const db = fixture(); seedCatalogue(db);
  const env = envOf(db);
  const before = (await ask(services, env, 'GET', '/offerings?mine=1', PARTNER)).body;
  const put = await ask(services, env, 'PUT', '/offerings/1', PARTNER, { price_usd: 99999 });
  assert.equal(put.status, 200);
  const after = (await ask(services, env, 'GET', '/offerings?mine=1', PARTNER)).body;
  assert.equal(after.items[0].price_cents, 9999900, 'the reprice did not land');
  assert.deepEqual(after.measures, before.measures);
  assert.deepEqual(after.items[0].requests, before.items[0].requests);
  assert.equal(after.booked_value_cents, null);
  assert.equal(JSON.stringify(after.measures).includes('9999900'), false);
});

test('the Offers root shows the catalogue’s request count, not a price multiple', async () => {
  const db = fixture(); seedCatalogue(db);
  const board = offersBoard(envOf(db));
  const sec = sectionOf(board, 'catalog');
  const data = await board.sources[sec.source]();
  assert.match(sec.summary(data), /1 offering · 7 requests/);
  assert.doesNotMatch(sec.summary(data), /\$/);
});

// ── 3. Won excludes cancelled work ──────────────────────────────────────────

function seedEngagements(db) {
  const eng = db.prepare(`INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, status, delivered_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`);
  eng.run(1, 'e1', 1, 1, OUR_PARTNER_ID, FOUNDER_USER, 1, 1000, 'accepted', null);
  eng.run(2, 'e2', 2, 2, OUR_PARTNER_ID, FOUNDER_USER, 1, 2500, 'invoiced', '2026-10-01');
  eng.run(3, 'e3', 3, 3, OUR_PARTNER_ID, FOUNDER_USER, 1, 7000, 'cancelled', '2026-09-01');
  // Delivered, and its invoice was voided to be reissued: delivered, not invoiced.
  eng.run(4, 'e4', 4, 4, OUR_PARTNER_ID, FOUNDER_USER, 1, 400, 'delivered', '2026-10-05');
  const inv = db.prepare(`INSERT INTO engagement_invoices (uid, invoice_number, engagement_id, status, paid_at) VALUES (?,?,?,?,?)`);
  inv.run('i2', 'AX-2026-0002', 2, 'paid', '2026-10-20');
  inv.run('i3', 'AX-2026-0003', 3, 'void', null);
  inv.run('i4', 'AX-2026-0004', 4, 'void', null);
  db.prepare("INSERT INTO partner_surfaces (id, uid, partner_id, name, kind) VALUES (1, 's1', ?, 'Directory', 'directory')").run(OUR_PARTNER_ID);
  const src = db.prepare('INSERT INTO engagement_sources (engagement_id, surface_id) VALUES (?, 1)');
  for (const id of [1, 2, 3, 4]) src.run(id);
}

test('cancelled work contributes to no measure labelled Won', async () => {
  const db = fixture(); seedEngagements(db);
  const env = envOf(db);
  const v = (await ask(partnerOffers, env, 'GET', '/visibility', PARTNER)).body;
  const s = v.items[0];
  assert.equal(s.engagement_count, 4, 'Engagements counts everything attributed');
  assert.equal(s.cancelled_count, 1);
  assert.equal(s.won_count, 3);
  assert.equal(s.won_value, 3900, 'the cancelled engagement’s 7000 is in Won');
  assert.equal(s.delivered_count, 2, 'a cancelled delivery is counted as delivered');
  assert.equal(s.invoiced_count, 1, 'a void invoice is counted as invoiced');
  assert.equal(s.paid_count, 1);
  assert.match(v.won_note, /Cancelled engagements are counted under Engagements/);
  assert.ok(v.measures_basis.won_value);

  // The board draws the same figure under the label that says what it is.
  const board = offersBoard(env);
  const sec = sectionOf(board, 'visibility');
  assert.equal(sec.columns[2], 'Won (not cancelled)');
  const rows = sec.rows(await board.sources[sec.source]());
  assert.equal(rows[0][1], 4);
  assert.equal(rows[0][2], '$3,900');

  // Cancelling accepted work takes it out of Won; nothing else moves.
  db.prepare("UPDATE engagements SET status = 'cancelled' WHERE id = 1").run();
  const after = (await ask(partnerOffers, env, 'GET', '/visibility', PARTNER)).body.items[0];
  assert.equal(after.won_value, 2900);
  assert.equal(after.won_count, 2);
  assert.equal(after.engagement_count, 4);
});

test('Won is the price accepted, so repricing the catalogue does not restate it', async () => {
  const db = fixture(); seedEngagements(db); seedCatalogue(db);
  const env = envOf(db);
  const before = (await ask(partnerOffers, env, 'GET', '/visibility', PARTNER)).body.items[0].won_value;
  await ask(services, env, 'PUT', '/offerings/1', PARTNER, { price_usd: 50 });
  const after = (await ask(partnerOffers, env, 'GET', '/visibility', PARTNER)).body.items[0].won_value;
  assert.equal(before, 3900);
  assert.equal(after, before);
});

// ── 4. fit rules: what they are used for ───────────────────────────────────

function seedLeads(db) {
  db.prepare("INSERT INTO projects (id, uid, name) VALUES (1, 'pr1', 'Acme')").run();
  const n = db.prepare(`INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, budget_max)
                        VALUES (?,?,?,?,?,?,?,?)`);
  n.run(1, 'n1', 1, FOUNDER_USER, 'design', 'Crypto exchange redesign', 'Brand work for a crypto exchange', 50000);
  n.run(2, 'n2', 1, FOUNDER_USER, 'design', 'Brand refresh', 'New identity', 50000);
  const r = db.prepare(`INSERT INTO partner_fit_rules (uid, partner_id, kind, value, statement, is_active)
                        VALUES (?,?,?,?,?,?)`);
  r.run('r1', OUR_PARTNER_ID, 'sector_declined', 'crypto', 'We do not take crypto work.', 1);
  r.run('r2', OUR_PARTNER_ID, 'best_fit', 'brand', 'Brand identity work.', 1);
  r.run('r3', OUR_PARTNER_ID, 'sector_declined', 'brand', 'Retired rule that would exclude every brand lead.', 0);
}

test('the fit-rule response says rules score and rank, and never decline; Pipeline does exactly that', async () => {
  const db = fixture(); seedLeads(db);
  const env = envOf(db);
  const fit = (await ask(partnerOffers, env, 'GET', '/fit-rules', PARTNER)).body;
  assert.equal(fit.enforcement, 'score_and_rank');
  assert.equal(fit.auto_decline, false);
  assert.doesNotMatch(fit.enforcement_note, /Nothing scores/);
  assert.match(fit.enforcement_note, /score leads/);
  assert.match(fit.enforcement_note, /ranking/);
  assert.match(fit.enforcement_note, /Nothing is auto-declined/);

  const leads = (await ask(partnerPipeline, env, 'GET', '/leads', PARTNER)).body;
  const crypto = leads.items.find((l) => l.need_id === 1);
  const brand = leads.items.find((l) => l.need_id === 2);
  // Scored against the rule…
  assert.equal(leads.scoring, 'fit_rules');
  assert.equal(typeof brand.score, 'number');
  // …excluded by the declined sector, with the firm's own sentence and no number…
  assert.equal(crypto.score, null);
  assert.equal(crypto.excluded_by, 'We do not take crypto work.');
  // …still listed, and never declined or passed on the firm's behalf.
  assert.equal(leads.open_count, 2);
  assert.equal(leads.excluded_count, 1);
  assert.equal(leads.passed_count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM partner_lead_passes').get().c, 0);
  // A retired rule is read by nothing: the brand lead is not excluded by it.
  assert.equal(brand.excluded_by, null);
  assert.match(leads.scoring_note, /left out of the ranking/);
  assert.match(leads.scoring_note, /never declined for you/);
});

test('the Offers root’s Audience fit section prints the worker’s sentence, not a contradiction', async () => {
  const db = fixture(); seedLeads(db);
  const board = offersBoard(envOf(db));
  const sec = sectionOf(board, 'audience-fit');
  const data = await board.sources[sec.source]();
  const foot = sec.footnote(data);
  assert.match(foot, /score leads/);
  assert.doesNotMatch(foot, /Nothing scores/);
  assert.equal(sec.summary(data), '2 in use');
});

// ── 5. the signal filter selects one row set ────────────────────────────────

test('a signal filter selects the same rows for the principal table, the list and the export', async () => {
  const db = fixture();
  const env = envOf(db);
  const add = (body) => ask(partnerOffers, env, 'POST', '/fit-rules', PARTNER, body);
  await add({ kind: 'best_fit', value: 'Series A with no design lead', signal: 'best_fit' });
  await add({ kind: 'best_fit', value: 'Seed with a deck', signal: 'qualified' });
  await add({ kind: 'best_fit', value: 'Pre-product founders', signal: 'weak_intent' });
  await add({ kind: 'best_fit', value: 'Ungraded profile' });
  await add({ kind: 'sector_declined', value: 'Gambling', statement: 'We pass.' });
  await add({ kind: 'budget_floor', floor_cents: 2500000 });
  const items = (await ask(partnerOffers, env, 'GET', '/fit-rules', PARTNER)).body.items;
  assert.equal(items.length, 6);

  for (const [signal, name] of [['best_fit', 'Series A'], ['qualified', 'Seed with'], ['weak_intent', 'Pre-product']]) {
    const v = fitView(items, signal);
    assert.equal(v.narrowed, true);
    const ids = (rows) => rows.map((r) => r.id).sort();
    assert.deepEqual(ids(v.profileRows), ids(v.ruleRows), `${signal}: table and list differ`);
    assert.deepEqual(ids(v.exportRows), ids(v.ruleRows), `${signal}: export and list differ`);
    assert.equal(v.profileRows.length, 1);
    assert.ok(v.profileRows[0].value.startsWith(name));
  }
  // Under All the table is the profile slice of the library; list and export are the library.
  const all = fitView(items, 'all');
  assert.equal(all.narrowed, false);
  assert.equal(all.profileRows.length, 4);
  assert.equal(all.ruleRows.length, 6);
  assert.deepEqual(all.exportRows, all.ruleRows);
  // The whole library is untouched by the filter: it is what the tiles count.
  assert.equal(fitView(items, 'weak_intent').total, 6);
  // An exclusion is never returned under a strength.
  assert.ok(!fitView(items, 'weak_intent').ruleRows.some((r) => r.kind !== 'best_fit'));
});
