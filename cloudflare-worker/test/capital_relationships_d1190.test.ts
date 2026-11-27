/**
 * D1190 (#3124): Capital relationships part 2. Migration 607 (cents with a
 * currency, and a meeting's start), the commitments read, the match read, and
 * the "Investor meeting" Calendar item.
 *
 * Real SQL on node:sqlite through the real routes. Every name, email and
 * amount is invented: `example.test` addresses, `Fixture` names.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/capital_relationships_d1190.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import raise from '../src/routes/cycle_raise.ts';
import { commitmentsRead, dollarsToCents, COUNTED } from '../src/services/capRelReads.ts';
import { logProspectEvent, WriterError } from '../src/services/raiseWriters.ts';
import * as calendar from '../src/services/calendar.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const mig = (n: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${n}`), 'utf8');
const ddl = (n: string) => mig(n).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const P = 101; // the venture (202 is another venture, seeded inline)
const FOUNDER = 1;
const OTHER_FOUNDER = 2;
const ADMIN = 30;

function schema(db: DatabaseSync) {
  for (const t of ['users', 'projects', 'activity_logs', 'raise_prospects', 'raise_rounds', 'raise_closes', 'raise_pro_rata', 'deals', 'commitments',
    'investor_profiles', 'network_connections', 'pitch_deck_share_tokens', 'data_room_files', 'dd_requests', 'calendar_events']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec(mig('436_round_calls.sql'));
  db.exec(mig('463_raise_record_stores.sql'));
  db.exec(mig('599_deal_currency.sql'));
  db.exec(mig('311_revenue_entries.sql'));
  const personal = mig('477_mercury_personal.sql');
  const start = personal.indexOf('CREATE TABLE IF NOT EXISTS mercury_personal_matches');
  db.exec(personal.slice(start, personal.indexOf('\n', personal.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_target'))));
  db.exec(mig('490_mercury_raise_receipts.sql'));
  // The fund directory (D535, D597) and the crosswalk (#1080).
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(mig('406_research_fund_sources.sql'));
  db.exec(mig('376_research_taxonomy.sql'));
  db.exec(ddl('229_research_market_directory.sql'));
  db.exec(`CREATE TABLE IF NOT EXISTS integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT, credentials_enc TEXT);
           CREATE TABLE IF NOT EXISTS user_company_links(user_id INTEGER, company_id INTEGER);
           CREATE TABLE IF NOT EXISTS company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);`);
}

function fixture(o: { before607?: (db: DatabaseSync) => void } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  schema(db);
  o.before607?.(db);
  db.exec(mig('607_raise_money_cents.sql'));
  db.exec(`
    INSERT INTO users (id, role, founder_id, name, email, is_active, kyc_status) VALUES
      (1, 'founder', 11, 'Fixture Founder', 'founder@example.test', 1, 'approved'),
      (2, 'founder', 22, 'Fixture Other', 'other@example.test', 1, 'approved'),
      (30, 'admin', NULL, 'Fixture Admin', 'admin@example.test', 1, 'approved'),
      (61, 'investor', NULL, 'Fixture Bluefern Partner', 'bluefern@example.test', 1, 'approved'),
      (62, 'investor', NULL, 'Fixture Fund L Partner', 'fundl@example.test', 1, 'approved'),
      (63, 'investor', NULL, 'Fixture Sixty-Three', 'sixty3@example.test', 1, 'approved'),
      (64, 'investor', NULL, 'Fixture Euro', 'euro@example.test', 1, 'approved'),
      (65, 'investor', NULL, 'Fixture Angel A', 'anglea@example.test', 1, 'approved'),
      (71, 'investor', NULL, 'Fixture Fits Privately', 'fits@example.test', 1, 'approved'),
      (72, 'investor', NULL, 'Fixture Unverified', 'pending@example.test', 1, 'pending'),
      (73, 'investor', NULL, 'Fixture Fintech Only', 'fintech@example.test', 1, 'approved'),
      (74, 'investor', NULL, 'Fixture Anti Thesis', 'anti@example.test', 1, 'approved');
    INSERT INTO projects (id, uid, name, founder_id, company_id, sector) VALUES
      (101, 'p-101', 'Fixture AI Co', 11, 10, 'artificial intelligence'), (202, 'p-202', 'Fixture Other Co', 22, 20, 'Fintech');
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  return { db, env };
}

/** The commitments world for venture 101, and one row for venture 202. */
function seedCommitments(db: DatabaseSync) {
  db.exec(`
    INSERT INTO raise_rounds (id, uid, project_id, name, target_amount, status) VALUES (1, 'r-1', 101, 'Seed', 1500000, 'active'), (2, 'r-2', 202, 'Seed', 900000, 'active');
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage, amount, commit_status) VALUES
      (1, 'pk', 101, 'Fixture K', 'Fund K', 'fundk@example.test', 'committed', 250000, 'signed'),
      (2, 'pn', 101, 'Fixture N', 'Northwind Angels', 'northwind@example.test', 'committed', 100000, NULL),
      (3, 'pa', 101, 'Fixture A', 'Angel A', 'anglea@example.test', 'committed', 75000, 'soft'),
      (4, 'pb', 101, 'Fixture B', 'Bluefern Capital', 'bluefern@example.test', 'diligence', 250000, NULL),
      (5, 'pm', 101, 'Fixture M', 'Angel M', 'angelm@example.test', 'committed', 150000, 'wired'),
      (6, 'pl', 101, 'Fixture L', 'Fund L', 'fundl@example.test', 'meeting', NULL, NULL),
      (7, 'pz', 101, 'Fixture Z', 'Fund Z', NULL, 'committed', NULL, 'signed'),
      (9, 'pother', 202, 'Fixture Other', 'Other Fund', 'otherfund@example.test', 'committed', 1000000, 'signed');
    INSERT INTO round_calls (id, uid, project_id, round_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, state, terms_hash, created_by)
      VALUES (1, 'call-1', 101, 1, 'Seed extension', 50000000, 'safe', 'Fixture terms', 1000000, '2026-12-31', 'sent', 'h', 1),
             (2, 'call-2', 202, 2, 'Other call', 50000000, 'safe', 'Fixture terms', 1000000, '2026-12-31', 'sent', 'h', 2);
    INSERT INTO round_call_recipients (call_id, investor_user_id, origin, commitment_cents, responded_at) VALUES
      (1, 61, 'chosen', 20000000, '2026-10-19T10:00:00Z'),
      (1, 65, 'chosen', 7500000, '2026-10-12T10:00:00Z'),
      (1, 63, 'match', NULL, NULL),
      (2, 63, 'chosen', 99900000, '2026-10-12T10:00:00Z');
    INSERT INTO deals (id, project_id, status, currency) VALUES (1, 101, 'active', 'USD'), (2, 101, 'active', 'EUR'), (3, 202, 'active', 'USD');
    INSERT INTO commitments (uid, deal_id, investor_user_id, amount, status) VALUES
      ('c-l', 1, 62, 200000, 'pending'),
      ('c-63', 1, 63, 50000, 'confirmed'),
      ('c-gone', 1, 63, 999, 'withdrawn'),
      ('c-eur', 2, 64, 10000, 'pending'),
      ('c-b', 3, 63, 7777777, 'confirmed');
    INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id, state)
      VALUES ('m-1', 1, 41, 'tx-fixture-1', '0000', 15000000, '2026-10-02', 'raise_prospect', 5, 'confirmed'),
      -- Another member's match on this venture's prospect: never the founder's Received.
             ('m-2', 2, 42, 'tx-fixture-2', '0001', 7500000, '2026-10-03', 'raise_prospect', 3, 'confirmed');
  `);
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/raise', raise);
  a.onError((e, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 500));
  return a;
})();

async function call(env: any, path: string, who: number | null = FOUNDER, company?: string) {
  const headers: Record<string, string> = { 'X-Company-Id': company ?? (who === OTHER_FOUNDER ? '20' : '10') };
  if (who != null) {
    const role = who === ADMIN ? 'admin' : 'founder';
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  }
  const r = await app.request(path, { headers }, env);
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, body, text };
}

const commitments = (env: any, who: number | null = FOUNDER, project = P) => call(env, `/api/cycles/raise/capital-relationships/commitments?project=${project}`, who);
const byKey = (body: any) => new Map((body.investors as any[]).map((i) => [i.key, i]));

// ───────────────────────────────────────────────────────────── migration 607

test('migration 607: a bound copy from dollars, a missing amount stays null, never 0, and the CHECKs', () => {
  const { db } = fixture({ before607: (d) => d.exec(`
    INSERT INTO raise_prospects (uid, project_id, stage, amount) VALUES ('a', 101, 'committed', 1234.56), ('b', 101, 'committed', NULL), ('c', 101, 'committed', -5), ('d', 101, 'committed', 0);
    INSERT INTO raise_rounds (uid, project_id, target_amount, status) VALUES ('r', 101, 1500000.5, 'active');
    INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, taking_amount) VALUES ('pr', 101, 1, 'Fixture Holder', 25000.25), ('pr2', 101, 1, 'Fixture None', NULL);
    INSERT INTO raise_closes (uid, project_id, round_id, name) VALUES ('cl', 101, 1, 'First close');
  `) });
  const p = (uid: string) => db.prepare('SELECT amount_cents, currency FROM raise_prospects WHERE uid = ?').get(uid) as any;
  assert.deepEqual({ ...p('a') }, { amount_cents: 123456, currency: 'USD' });
  assert.equal(p('b').amount_cents, null, 'a missing amount stays null');
  assert.equal(p('c').amount_cents, null, 'a negative amount has no true cents');
  assert.equal(p('d').amount_cents, 0, 'a recorded zero is a zero');
  assert.deepEqual({ ...(db.prepare('SELECT target_cents, currency FROM raise_rounds').get() as any) }, { target_cents: 150000050, currency: 'USD' });
  assert.deepEqual(db.prepare('SELECT taking_cents FROM raise_pro_rata ORDER BY uid').all().map((r: any) => r.taking_cents), [2500025, null]);
  assert.equal((db.prepare('SELECT currency FROM raise_closes').get() as any).currency, 'USD');
  for (const bad of ['usd', 'US', 'DOLLARS', '']) {
    assert.throws(() => db.prepare("INSERT INTO raise_prospects (uid, project_id, currency) VALUES ('x', 101, ?)").run(bad), /CHECK/, bad);
  }
  assert.throws(() => db.prepare("UPDATE raise_prospects SET amount_cents = -1 WHERE uid = 'a'").run(), /CHECK/);
  // The meeting columns, and one Calendar item id per step.
  const cols = new Set(db.prepare('SELECT name FROM pragma_table_info(?)').all('raise_prospect_events').map((r: any) => r.name));
  assert.ok(cols.has('starts_at') && cols.has('calendar_item_uid'));
  db.exec("INSERT INTO raise_prospect_events (prospect_id, kind, calendar_item_uid) VALUES (1, 'meeting', 'investor-meeting-x')");
  assert.throws(() => db.exec("INSERT INTO raise_prospect_events (prospect_id, kind, calendar_item_uid) VALUES (1, 'call', 'investor-meeting-x')"), /UNIQUE/);
});

test('cents round-trip exactly, and the triggers keep them in step with every dollar write', () => {
  const { db } = fixture();
  const typed = ['0.01', '0.1', '0.29', '19.99', '1234567.89', '9999999999.99', '75000', '250000.5'];
  for (const [i, t] of typed.entries()) db.prepare('INSERT INTO raise_prospects (uid, project_id, stage, amount) VALUES (?, 101, ?, ?)').run(`t${i}`, 'committed', Number(t));
  const rows = db.prepare('SELECT uid, amount_cents FROM raise_prospects ORDER BY id').all() as any[];
  const back = rows.map((r) => (r.amount_cents / 100).toFixed(2));
  assert.deepEqual(back, typed.map((t) => Number(t).toFixed(2)), 'each typed amount comes back to the cent');
  assert.ok(rows.every((r) => Number.isInteger(r.amount_cents)));
  // The same rule in the read's own conversion.
  for (const t of typed) assert.equal(dollarsToCents(Number(t)), Math.round(Number(t) * 100));
  for (const v of [null, undefined, '', -1, Number.NaN, 1e14, 'twelve']) assert.equal(dollarsToCents(v), null, String(v));

  // Every writer still writes dollars: an update, a clear, the Mercury credit's direct UPDATE.
  db.exec("UPDATE raise_prospects SET amount = 50.05 WHERE uid = 't0'");
  db.exec("UPDATE raise_prospects SET amount = NULL WHERE uid = 't1'");
  db.exec("UPDATE raise_prospects SET stage = 'committed', amount = 150000, updated_at = datetime('now') WHERE uid = 't2'");
  const now = (uid: string) => (db.prepare('SELECT amount_cents FROM raise_prospects WHERE uid = ?').get(uid) as any).amount_cents;
  assert.equal(now('t0'), 5005);
  assert.equal(now('t1'), null, 'a cleared amount clears its cents, never 0');
  assert.equal(now('t2'), 15000000);
  db.exec("INSERT INTO raise_rounds (uid, project_id, target_amount, status) VALUES ('rr', 101, 2000000, 'active')");
  db.exec("UPDATE raise_rounds SET target_amount = 2500000.75 WHERE uid = 'rr'");
  assert.equal((db.prepare("SELECT target_cents FROM raise_rounds WHERE uid = 'rr'").get() as any).target_cents, 250000075);
  db.exec("INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, taking_amount) VALUES ('q', 101, 1, 'Fixture', 10.1)");
  db.exec("UPDATE raise_pro_rata SET taking_amount = 20.2 WHERE uid = 'q'");
  assert.equal((db.prepare("SELECT taking_cents FROM raise_pro_rata WHERE uid = 'q'").get() as any).taking_cents, 2020);
});

// ──────────────────────────────────────────────────────────── commitments read

test('commitments: every store read, each investor counted once by their strongest line, soft and unrecorded never committed', async () => {
  const { db, env } = fixture();
  seedCommitments(db);
  const r = await commitments(env);
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.equal(b.currency, 'USD');
  assert.deepEqual(b.round, { name: 'Seed', close_date: null, target_cents: 150000000, currency: 'USD' });
  const inv = byKey(b);

  // Typed signed counts; Status not recorded and Soft never do.
  assert.equal(inv.get('prospect:1').chosen.status, 'signed');
  assert.equal(inv.get('prospect:1').chosen.counted, true);
  assert.equal(inv.get('prospect:2').chosen.status, 'not_recorded');
  assert.equal(inv.get('prospect:2').chosen.status_label, 'Status not recorded');
  assert.equal(inv.get('prospect:2').chosen.counted, false);
  // Angel A: typed Soft and a call's indication of the same money: one investor, the indication chosen, never counted.
  const a = inv.get('prospect:3');
  assert.deepEqual(a.lines.map((l: any) => l.status), ['indicated', 'soft']);
  assert.equal(a.chosen.counted, false);
  assert.equal(a.chosen.cents, 7500000);
  // Bluefern: only the call's indication (the prospect is at Diligence, so no typed commitment).
  assert.equal(inv.get('prospect:4').chosen.status_label, 'Indicated through a call');
  assert.equal(inv.get('prospect:4').chosen.source_label, 'Recorded');
  assert.equal(inv.get('prospect:4').chosen.via, 'Seed extension');
  // Angel M: typed Wired and Mercury's received credit: one investor, Received chosen, counted once.
  const m = inv.get('prospect:5');
  assert.deepEqual(m.lines.map((l: any) => [l.status, l.source]), [['received', 'connector'], ['wired', 'typed']]);
  assert.equal(m.chosen.source_label, 'Connector · Mercury');
  // Fund L: a deal commitment found by the prospect's email, Pending, counted.
  assert.equal(inv.get('prospect:6').chosen.status, 'pending');
  assert.equal(inv.get('prospect:6').chosen.counted, true);
  // A deal investor with no prospect keeps their own row, named, never by email.
  assert.equal(inv.get('investor:63').name, 'Fixture Sixty-Three');
  assert.equal(inv.get('investor:63').chosen.status, 'confirmed');
  assert.ok(!r.text.includes('sixty3@example.test'), 'no investor email in the read');
  // A withdrawn commitment is gone; a committed prospect with no amount is listed with null, never 0.
  assert.ok(!r.text.includes('c-gone'));
  assert.equal(inv.get('prospect:7').chosen.cents, null);
  // Another currency is listed and never summed.
  assert.equal(inv.get('investor:64').chosen.currency, 'EUR');
  assert.equal(inv.get('investor:64').chosen.counted, false);
  assert.match(inv.get('investor:64').chosen.why_not_counted, /another currency/);

  // The totals: 250,000 signed + 150,000 received + 200,000 pending + 50,000 confirmed.
  assert.equal(b.totals.counted_cents, 65000000);
  assert.equal(b.totals.counted_amount_not_recorded, 1);
  assert.equal(b.totals.not_counted_cents, 10000000 + 20000000 + 7500000);
  assert.deepEqual({ ...b.totals.by_status.indicated }, { cents: 27500000, investors: 2, amount_not_recorded: 0 });
  assert.deepEqual({ ...b.totals.by_status.soft }, { cents: 0, investors: 0, amount_not_recorded: 0 }, 'Soft lost to the indication of the same money');
  assert.equal(b.totals.by_status.not_recorded.cents, 10000000);
  assert.equal(b.totals.other_currency, 1);
  assert.equal(b.totals.percent_of_target, 43.3);
  assert.equal(b.totals.partial, false);
  for (const s of ['soft', 'not_recorded', 'indicated']) assert.ok(!COUNTED.has(s as any), `${s} is never committed`);

  // Nothing of venture 202.
  assert.ok(!r.text.includes('Other Fund') && !r.text.includes('Other call') && !r.text.includes('c-b'));
  assert.deepEqual(Object.keys(b.sources).sort(), ['closings', 'deals', 'mercury', 'prospects', 'round_calls']);
  assert.equal(b.sources.closings.state, 'not_recorded');
  assert.equal(b.sources.mercury.state, 'ok');
});

test('commitments: D1191 refuses unaudited staff detail; the non-founder projection still withholds Mercury', async () => {
  const { db, env } = fixture();
  seedCommitments(db);
  const r = await commitments(env, ADMIN);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.body.error, 'support_read_required');
  const projected = await commitmentsRead(env, P, null);
  assert.equal(projected.sources.mercury.state, 'founder_only');
  const m = byKey(projected).get('prospect:5');
  assert.deepEqual(m.lines.map((l: any) => l.status), ['wired']);
  assert.ok(!r.text.includes('tx-fixture-1') && !r.text.includes('m-1'), 'no Mercury line reaches an admin');
  assert.equal(projected.totals.counted_cents, 65000000, 'the same money, counted once');
});

test('commitments: who may read it, and a failed block degrades the read instead of blanking it', async () => {
  const { db, env } = fixture();
  seedCommitments(db);
  assert.equal((await commitments(env, null)).status, 401);
  assert.equal((await commitments(env, OTHER_FOUNDER)).status, 403, 'another venture’s founder');
  assert.equal((await call(env, '/api/cycles/raise/capital-relationships/commitments')).status, 400, 'no project');
  assert.equal((await commitments(env, FOUNDER, 999)).status, 404);
  db.exec('DROP TABLE round_call_recipients');
  const r = await commitments(env);
  assert.equal(r.status, 200);
  assert.equal(r.body.sources.round_calls.state, 'unreadable');
  assert.match(r.body.sources.round_calls.reason, /Calls for Capital/);
  assert.equal(r.body.totals.partial, true);
  assert.equal(byKey(r.body).get('prospect:1').chosen.status, 'signed', 'the other blocks still answer');
  assert.ok(!r.text.includes('no such table'), 'no raw error text');
});

test('commitments: with no round there is no target, and the currency says why it is USD', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO raise_prospects (uid, project_id, stage, amount, commit_status) VALUES ('s', 101, 'committed', 10, 'signed')");
  const r = await commitments(env);
  assert.equal(r.body.round, null);
  assert.match(r.body.round_reason, /No active round/);
  assert.equal(r.body.totals.percent_of_target, null);
  assert.match(r.body.currency_basis, /USD/);
  assert.equal(r.body.totals.counted_cents, 1000);
});

// ────────────────────────────────────────────────────────────────── match read

function seedDirectory(db: DatabaseSync) {
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, fund_size_cents, fund_year, sector_focus, notable_lps, eif_flag, eifo_flag, source_name, source_url, as_of)
    VALUES (?, ?, ?, NULL, NULL, ?, NULL, 0, 0, 'EuroTech VC Funds (public spreadsheet)', 'https://example.org/sheet', '2026-10-04')`);
  ins.run('beta', 'Beta Capital', 'Berlin', 'AI · Fintech');
  ins.run('alpha', 'Alpha Ventures', 'Berlin', 'Fintech');
  ins.run('gen', 'Gen Fund', 'Paris', 'Generalist');
  ins.run('eps', 'Eps Fund', 'Paris', null);
  db.exec(`
    INSERT INTO network_connections (user_id, name, title, company) VALUES
      (1, 'Fixture Friend', 'Partner', 'beta capital'), (1, 'Fixture Nobody', NULL, 'Some Shop'), (2, 'Fixture Theirs', 'Partner', 'Alpha Ventures');
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage, research_fund_uid) VALUES (40, 'pbeta', 101, 'Beta Capital', 'Beta Capital', 'to_contact', 'beta');
    INSERT INTO investor_profiles (user_id, sectors_json, stages_json, anti_thesis_sectors_json) VALUES
      (71, '["AI"]', '["seed"]', '[]'), (72, '["AI"]', '["seed"]', '[]'),
      (73, '["Fintech"]', '["seed"]', '[]'), (74, '["AI"]', '["seed"]', '["artificial intelligence"]');
  `);
}
const match = (env: any, qs = '', who: number = FOUNDER) => call(env, `/api/cycles/raise/capital-relationships/match?project=${P}${qs}`, who);
const names = (b: any) => (b.items as any[]).map((f) => f.name).sort();

test('match: the directory with each fund’s Fit, the caller’s own warm paths, what the venture tracks, and a count of verified investors, never names', async () => {
  const { db, env } = fixture();
  seedDirectory(db);
  const r = await match(env);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(names(r.body), ['Alpha Ventures', 'Beta Capital', 'Eps Fund', 'Gen Fund']);
  const f = new Map((r.body.items as any[]).map((x) => [x.uid, x]));
  assert.equal(f.get('beta').fit.code, 'fits');
  assert.equal(f.get('beta').fit.label, 'Fits');
  assert.equal(f.get('beta').fit.your_sector, 'artificial intelligence');
  assert.equal(f.get('alpha').fit.code, 'outside');
  assert.equal(f.get('gen').fit.code, 'fits', 'a generalist fits');
  assert.equal(f.get('eps').fit.code, 'unclear', 'no recorded focus is unclear, never a fit');
  assert.deepEqual(f.get('beta').warm_paths, [{ name: 'Fixture Friend', title: 'Partner', sentence: 'Fixture Friend works there' }]);
  assert.deepEqual(f.get('alpha').warm_paths, [], 'another member’s network is never read');
  assert.ok(!r.text.includes('Fixture Theirs'));
  assert.deepEqual(f.get('beta').in_pipeline, { prospect_id: 40 });
  assert.equal(f.get('alpha').in_pipeline, null);
  assert.equal(f.get('beta').stage, null);
  assert.match(f.get('beta').stage_reason, /records no stage/);
  // One verified investor fits: unverified, outside and anti-thesis are not counted.
  assert.equal(r.body.verified_investors.count, 1);
  for (const n of ['Fixture Fits Privately', 'fits@example.test', 'Fixture Unverified', 'Fixture Anti Thesis']) assert.ok(!r.text.includes(n), `${n} named`);
});

test('match: the Fit and warm-path filters page with the directory, and bad filters are refused', async () => {
  const { db, env } = fixture();
  seedDirectory(db);
  const fits = await match(env, '&fit=fits');
  assert.deepEqual(names(fits.body), ['Beta Capital', 'Gen Fund']);
  assert.equal(fits.body.total, 2, 'the total is the filtered one');
  assert.deepEqual(names((await match(env, '&fit=outside')).body), ['Alpha Ventures']);
  assert.deepEqual(names((await match(env, '&fit=unclear')).body), ['Eps Fund']);
  const warm = await match(env, '&warm=1');
  assert.deepEqual(names(warm.body), ['Beta Capital']);
  assert.equal(warm.body.total, 1);
  assert.deepEqual(names((await match(env, '&fit=fits&warm=1')).body), ['Beta Capital']);
  for (const [qs, field] of [['&stage=seed', 'stage'], ['&fit=great', 'fit'], ['&warm=0', 'warm'], ['&sort=random', 'sort']] as const) {
    const bad = await match(env, qs);
    assert.equal(bad.status, 400, qs);
    assert.equal(bad.body.field, field, qs);
  }
  assert.equal((await match(env, '', OTHER_FOUNDER)).status, 403);
});

test('match: a venture with no sector reads every Fit as Unclear and counts no investors, saying why', async () => {
  const { db, env } = fixture();
  seedDirectory(db);
  db.exec('UPDATE projects SET sector = NULL WHERE id = 101');
  const r = await match(env);
  assert.ok((r.body.items as any[]).filter((x) => x.uid !== 'gen').every((x) => x.fit.code === 'unclear'));
  assert.match(r.body.sector_reason, /not recorded/);
  assert.equal(r.body.verified_investors.count, null);
  assert.match(r.body.verified_investors.reason, /sector is not recorded/);
});

// ──────────────────────────────────────────────────────── the Calendar item

async function refusedWith(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof WriterError) return `${e.status} ${e.sentence}`; throw e; }
  return assert.fail('not refused');
}

test('a meeting or call with a start becomes an Investor meeting on the founder’s calendar, and on nobody else’s', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage) VALUES (4, 'pb', 101, 'Fixture B', 'Bluefern Capital', 'bluefern@example.test', 'meeting')");
  const soon = new Date(Date.now() + 3 * 86_400_000);
  soon.setUTCHours(14, 0, 0, 0);
  const at = soon.toISOString();
  await logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'meeting', note: 'Partner meeting', starts_at: at.replace('.000Z', 'Z') } });
  await logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'call', starts_at: at.replace('Z', '+00:00').replace('T14', 'T16').replace('.000', '') } });
  await logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'email', note: 'No start' } });
  const evs = db.prepare('SELECT kind, starts_at, calendar_item_uid, due_on FROM raise_prospect_events ORDER BY id').all() as any[];
  assert.equal(evs[0].starts_at, at);
  assert.match(evs[0].calendar_item_uid, /^investor-meeting-[0-9a-f]{32}$/);
  assert.equal(evs[0].due_on, at.slice(0, 10), 'its day is the step’s day');
  assert.equal(evs[2].calendar_item_uid, null, 'a step with no start has no Calendar item');

  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const mine = await calendar.fetchUserEvents(env, FOUNDER, 'founder', from, to, ['investor_meeting']);
  assert.deepEqual(mine.map((e) => e.title), ['Investor meeting · Bluefern Capital', 'Investor call · Bluefern Capital']);
  assert.equal(mine[0].source_uid, evs[0].calendar_item_uid);
  assert.equal(mine[0].end_at, mine[0].start_at, 'no invented hour');
  assert.deepEqual(mine[0].attendees, [], 'nobody is invited');
  assert.equal(mine[0].organizer_email, null);
  assert.match(String(mine[0].notes), /Partner meeting/);
  assert.equal(mine[0].project_id, P);
  for (const who of [OTHER_FOUNDER, ADMIN]) {
    assert.deepEqual(await calendar.fetchUserEvents(env, who, who === ADMIN ? 'admin' : 'founder', from, to, ['investor_meeting']), [], `user ${who}`);
  }
  // In the .ics, as every kind.
  assert.match(calendar.eventsToIcs(mine), /Investor meeting · Bluefern Capital/);

  // Refusals: a start on a kind that has none, a time with no zone, a different day.
  assert.match(await refusedWith(logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'note', starts_at: at } })), /^400 Only a meeting or a call/);
  assert.match(await refusedWith(logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'meeting', starts_at: '2026-11-14T14:00' } })), /^400 starts_at is a date and time with its zone/);
  assert.match(await refusedWith(logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'meeting', starts_at: '2026-11-14T14:00Z', on: '2026-11-15' } })), /^400 on and starts_at/);
  assert.match(await refusedWith(logProspectEvent(env, { projectId: P, userId: FOUNDER, prospectId: 4, body: { kind: 'meeting', starts_at: '2026-13-40T99:00Z' } })), /^400 starts_at is not a real/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM raise_prospect_events').get() as any).n, 3, 'a refusal writes nothing');
});
