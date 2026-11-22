/**
 * D7723 (#7723) — a competitor's price is stored on stated terms with its
 * capture date and source, survives a rerun and a deleted analysis, and keeps
 * its earlier values.
 *
 * Real SQLite with foreign keys on (the baseline plus every migration above
 * BASELINE_CUTOFF, this issue's included), the mounted routers, invented
 * companies on `.example` domains and invented prices. No network.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/competitor_prices_7723.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import competitorPrices from '../src/routes/competitor_prices.ts';
import competitors from '../src/routes/competitors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'unit-test-jwt-secret-7723-competitor-prices-0123456789';
const OWNER = 1;      // founder of venture 1, ran the analyses
const COMEMBER = 2;   // the same founder record: a co-member of venture 1
const STRANGER = 3;   // another founder, no tie to venture 1
const INVESTOR = 4;
const OTHER = 5;      // founder of venture 2

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  loadSchema(db);
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (100, 'Fern Founder', 'fern@founders.example'),
      (300, 'Sol Stranger', 'sol@founders.example'), (500, 'Oto Other', 'oto@founders.example');
    INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES
      (${OWNER}, 'owner@example.test', 'Ola Owner', 'founder', 100, 1),
      (${COMEMBER}, 'co@example.test', 'Cai Comember', 'founder', 100, 1),
      (${STRANGER}, 'stranger@example.test', 'Sol Stranger', 'founder', 300, 1),
      (${INVESTOR}, 'investor@example.test', 'Ivo Investor', 'investor', NULL, 1),
      (${OTHER}, 'other@example.test', 'Oto Other', 'founder', 500, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Freightly', 100), (2, 'Otherwise', 500);
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (11, 1, 'Synthetic Buyer'), (22, 2, 'Other Buyer');
    INSERT INTO competitor_analyses (id, user_id, project_id, mode, title, status) VALUES
      ('an-venture', ${OWNER}, 1, 'custom', 'Freight back office', 'complete'),
      ('an-solo', ${OWNER}, NULL, 'custom', 'Bookkeeping', 'complete');
    INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, details_json, position) VALUES
      ('cand-ledger', 'an-venture', 'Ledgerline', 'ledgerline.example', 'https://ledgerline.example',
        '{"pricing":["$49/mo","Contact sales / enterprise"],"features":["Invoices"]}', 0),
      ('cand-plain', 'an-venture', 'Plainrow', 'plainrow.example', NULL, '{"features":["Rows"]}', 1),
      ('cand-quill', 'an-solo', 'Quillstack', 'quillstack.example', NULL, '{"pricing":["$0.0004 per call"]}', 0);
    INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at) VALUES
      ('src-1', 'an-venture', 'cand-ledger', 'https://ledgerline.example/pricing', 'pricing', 'Ledgerline pricing', 200, '2026-11-01T10:00:00Z'),
      ('src-2', 'an-venture', 'cand-ledger', 'https://ledgerline.example/careers', 'careers', 'Careers', 404, '2026-11-01T10:00:00Z');
    INSERT INTO competitor_cached_fetches (url_hash, url, status, title, pricing_json, fetched_at, expires_at) VALUES
      ('h-shared', 'https://ledgerline.example/enterprise', 200, 'Enterprise', '["$999/mo shared cache"]', '2026-11-01', '2099-01-01');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/competitor-prices', competitorPrices);
app.route('/api/competitors', competitors);

async function call(db: any, method: string, path: string, json?: unknown, who = OWNER) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const res = await app.fetch(new Request(`http://t/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  }), { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const rows = (db: any) => db.prepare('SELECT * FROM competitor_price_observations ORDER BY id').all() as any[];
const count = (db: any) => rows(db).length;

/** Every term stated, for a price added by hand with no venture. */
const terms = (over: Record<string, unknown> = {}) => ({
  competitor_name: 'Ledgerline', competitor_domain: 'ledgerline.example',
  product: 'Ledgerline Books', plan: 'Team', charge_type: 'subscription', amount: '49', currency: 'USD',
  pricing_unit: 'per_seat', billing_period: 'monthly', contract_term: 'no_commitment', region: 'north_america',
  captured_on: '2026-10-01', source_kind: 'official_page', source_url: 'https://ledgerline.example/pricing',
  source_use_confirmed: true, ...over,
});

const REQUIRED = ['product', 'plan', 'charge_type', 'amount', 'currency', 'pricing_unit', 'billing_period',
  'contract_term', 'region', 'captured_on', 'source_kind', 'source_url'];

test('a save is refused when any required term is missing, and nothing is written', async () => {
  const db = fixture();
  for (const key of REQUIRED) {
    const b: Record<string, unknown> = terms();
    delete b[key];
    const r = await call(db, 'POST', '/competitor-prices', b);
    assert.equal(r.status, 400, `${key}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'terms_missing', key);
    assert.ok(r.body.missing.includes(key), `${key} is named as missing: ${JSON.stringify(r.body.missing)}`);
  }
  const usage = await call(db, 'POST', '/competitor-prices', terms({ charge_type: 'usage', pricing_unit: 'per_use', billing_period: 'per_use' }));
  assert.equal(usage.status, 400);
  assert.deepEqual(usage.body.missing, ['unit_quantity', 'unit_label'], 'a usage price states what one unit is');
  assert.equal(count(db), 0);
});

test('a save is refused without the source-use confirmation, and a quotation also needs leave to share', async () => {
  const db = fixture();
  for (const v of [undefined, false, 'true', 1]) {
    const b: Record<string, unknown> = terms({ source_use_confirmed: v });
    const r = await call(db, 'POST', '/competitor-prices', b);
    assert.equal(r.status, 400, String(v));
    assert.equal(r.body.error, 'source_use_unconfirmed', String(v));
  }
  const quote = await call(db, 'POST', '/competitor-prices', terms({ source_kind: 'permitted_quotation', source_url: undefined }));
  assert.equal(quote.status, 400);
  assert.equal(quote.body.error, 'quotation_share_unconfirmed');
  assert.equal(count(db), 0);
  const shared = await call(db, 'POST', '/competitor-prices', terms({ source_kind: 'permitted_quotation', source_url: undefined, source_share_confirmed: true }));
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  const row = rows(db)[0];
  assert.equal(row.source_use_confirmed, 1);
  assert.equal(row.source_share_confirmed, 1);
  assert.equal(row.entered_by, OWNER, 'the confirmation records who');
  assert.ok(row.entered_at, 'and when');
});

test('closed vocabularies: a term outside its set is refused by name', async () => {
  const db = fixture();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ charge_type: 'donation' }, 'charge_type'],
    [{ pricing_unit: 'per_vibe' }, 'pricing_unit'],
    [{ billing_period: 'fortnightly' }, 'billing_period'],
    [{ billing_period: 'not_stated' }, 'billing_period'],
    [{ contract_term: 'forever' }, 'contract_term'],
    [{ region: 'mars' }, 'region'],
    [{ currency: 'ABC' }, 'currency'],
    [{ source_kind: 'rumour' }, 'source_kind'],
    [{ source_url: 'ftp://ledgerline.example/p' }, 'source_url'],
    [{ captured_on: '2026-02-30' }, 'captured_on'],
    [{ captured_on: '2999-01-01' }, 'captured_on'],
    [{ amount: 49 }, 'amount'],
    [{ amount: '1,000' }, 'amount'],
    [{ amount: '-5' }, 'amount'],
  ];
  for (const [over, field] of cases) {
    const r = await call(db, 'POST', '/competitor-prices', terms(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.error, 'invalid_term', JSON.stringify(over));
    assert.equal(r.body.field, field, JSON.stringify(over));
  }
  assert.equal(count(db), 0);
  const quote = await call(db, 'POST', '/competitor-prices', terms({ charge_type: 'quote', amount: undefined, billing_period: 'not_stated', contract_term: 'not_stated' }));
  assert.equal(quote.status, 201, 'a quote with no public figure has no amount');
  assert.equal(quote.body.price.amount, null);
  const free = await call(db, 'POST', '/competitor-prices', terms({ plan: 'Free', amount: '0' }));
  assert.equal(free.status, 201);
  assert.equal(free.body.price.amount, '0', '0 is a stated free price, not a missing one');
});

test('the hint list saves nothing and prefills nothing, and reads only the analysis’s own candidates', async () => {
  const db = fixture();
  const r = await call(db, 'GET', '/competitor-prices/proposals?analysis=an-venture');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saved, false);
  assert.equal(count(db), 0, 'listing hints writes no row');
  assert.deepEqual(r.body.proposals.map((p: any) => p.candidate_id), ['cand-ledger'], 'a competitor with no hint has no proposal');
  const [p] = r.body.proposals;
  assert.deepEqual(Object.keys(p).sort(), ['candidate_id', 'competitor_domain', 'competitor_name', 'hints', 'pages']);
  assert.deepEqual(p.hints, [{ hint_text: '$49/mo' }, { hint_text: 'Contact sales / enterprise' }], 'each hint is its text and nothing parsed from it');
  assert.deepEqual(p.pages.map((g: any) => g.url), ['https://ledgerline.example/pricing'], 'the pages that answered');
  assert.doesNotMatch(JSON.stringify(r.body), /shared cache|\$999/, 'never the fetch cache shared across members');
  assert.doesNotMatch(JSON.stringify(r.body), /"(amount|currency|pricing_unit|billing_period|contract_term|region|captured_on|charge_type)"/);
});

test('only the member who ran an analysis can list its hints', async () => {
  const db = fixture();
  for (const who of [COMEMBER, STRANGER, INVESTOR, OTHER]) {
    const r = await call(db, 'GET', '/competitor-prices/proposals?analysis=an-venture', undefined, who);
    assert.equal(r.status, 404, `user ${who}`);
    assert.equal(r.body.error, 'analysis_not_found');
    assert.doesNotMatch(JSON.stringify(r.body), /49/);
  }
});

test('a usage price below one minor unit is stored and read back exactly as stated', async () => {
  const db = fixture();
  const saved = await call(db, 'POST', '/competitor-prices', terms({
    analysis_id: 'an-solo', candidate_id: 'cand-quill', hint_text: '$0.0004 per call', competitor_name: undefined, competitor_domain: undefined,
    product: 'Quill API', plan: 'Pay as you go', charge_type: 'usage', amount: '0.0004', pricing_unit: 'per_use',
    unit_quantity: '1', unit_label: 'API call', billing_period: 'per_use', source_url: 'https://quillstack.example/pricing',
  }));
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.price.amount, '0.0004');
  assert.equal(typeof rows(db)[0].amount, 'string', 'stored as text, never a float');
  assert.equal(rows(db)[0].amount, '0.0004');
  const read = await call(db, 'GET', '/competitor-prices?competitor=quillstack.example');
  assert.equal(read.status, 200);
  assert.equal(read.body.current[0].amount, '0.0004');
  assert.equal(read.body.current[0].unit_quantity, '1');
  assert.equal(read.body.current[0].hint_text, '$0.0004 per call');
  assert.equal(read.body.current[0].competitor_name, 'Quillstack', 'the name is copied from the candidate');
});

test('a saved hint must be one the analysis found, and the venture comes from the analysis', async () => {
  const db = fixture();
  const invented = await call(db, 'POST', '/competitor-prices', terms({ analysis_id: 'an-venture', candidate_id: 'cand-ledger', hint_text: '$1/mo' }));
  assert.equal(invented.status, 400);
  assert.equal(invented.body.error, 'hint_not_in_analysis');
  const moved = await call(db, 'POST', '/competitor-prices', terms({ analysis_id: 'an-venture', candidate_id: 'cand-ledger', project_id: 2 }));
  assert.equal(moved.status, 400);
  assert.equal(moved.body.error, 'project_mismatch');
  const notMine = await call(db, 'POST', '/competitor-prices', terms({ analysis_id: 'an-venture', candidate_id: 'cand-ledger' }), COMEMBER);
  assert.equal(notMine.status, 404, 'another member cannot save from an analysis they did not run');
  assert.equal(count(db), 0);
  const ok = await call(db, 'POST', '/competitor-prices', terms({ analysis_id: 'an-venture', candidate_id: 'cand-ledger', hint_text: '$49/mo', competitor_name: 'Spoofed' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.price.project_id, 1);
  assert.equal(ok.body.price.competitor_name, 'Ledgerline');
  assert.equal(ok.body.price.hint_text, '$49/mo');
});

test('a second capture keeps the first in the series; a correction leaves current and stays readable', async () => {
  const db = fixture();
  const first = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1, captured_on: '2026-10-01', amount: '49' }));
  const second = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1, captured_on: '2026-11-01', amount: '59' }));
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  let cur = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=1');
  assert.deepEqual(cur.body.current.map((p: any) => p.amount), ['59']);
  let series = await call(db, 'GET', '/competitor-prices/series?competitor=ledgerline.example&product=ledgerline%20books&plan=team&project=1');
  assert.deepEqual(series.body.series.map((p: any) => [p.captured_on, p.amount, p.current]), [['2026-10-01', '49', false], ['2026-11-01', '59', true]]);

  // The correction states the true capture date, earlier than the row it replaces: only the
  // replacement, not the date, takes the replaced row out of current.
  const fix = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1, captured_on: '2026-10-15', amount: '55', corrects: second.body.price.uid }));
  assert.equal(fix.status, 201, JSON.stringify(fix.body));
  assert.equal(fix.body.price.corrects, second.body.price.uid);
  cur = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=1');
  assert.deepEqual(cur.body.current.map((p: any) => p.amount), ['55'], 'the replaced row left current');
  series = await call(db, 'GET', '/competitor-prices/series?competitor=Ledgerline&product=Ledgerline%20Books&plan=Team&project=1');
  const replaced = series.body.series.find((p: any) => p.uid === second.body.price.uid);
  assert.equal(replaced.amount, '59', 'the replaced row stays readable');
  assert.equal(replaced.current, false);
  assert.equal(replaced.replaced_by, fix.body.price.uid);
  assert.equal(series.body.series.length, 3);
  const again = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1, amount: '56', corrects: second.body.price.uid }));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_corrected');
  const elsewhere = await call(db, 'POST', '/competitor-prices', terms({ amount: '56', corrects: first.body.price.uid }));
  assert.equal(elsewhere.status, 404, 'a correction stays in the replaced row’s venture');
});

test('a rerun that drops the candidate and deleting the analysis both leave the price rows with the competitor’s name', async () => {
  const db = fixture();
  const saved = await call(db, 'POST', '/competitor-prices', terms({ analysis_id: 'an-venture', candidate_id: 'cand-ledger', hint_text: '$49/mo' }));
  assert.equal(saved.status, 201);
  // What a rerun's apply runs for a removed candidate (routes/competitors.ts).
  db.prepare('DELETE FROM competitor_candidates WHERE analysis_id = ? AND id = ?').run('an-venture', 'cand-ledger');
  assert.equal(count(db), 1);
  const gone = await call(db, 'DELETE', '/competitors/an-venture');
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM competitor_analyses WHERE id = ?').get('an-venture') as any).n, 0);
  const [row] = rows(db);
  assert.equal(row.competitor_name, 'Ledgerline');
  assert.equal(row.analysis_id, 'an-venture');
  assert.equal(row.candidate_id, 'cand-ledger');
  const read = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=1');
  assert.equal(read.body.current[0].amount, '49');
});

test('an UPDATE that changes a recorded field is refused, and no route edits or deletes a price', async () => {
  const db = fixture();
  const saved = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1 }));
  const uid = saved.body.price.uid;
  for (const set of ["amount = '1'", "product = 'Other'", "captured_on = '2026-01-01'", "source_url = 'https://ledgerline.example/x'",
    "region = 'europe'", "corrects_uid = 'abc'", "withdrawn_at = datetime('now'), withdrawn_reason = 'x'",
    `entered_by = ${COMEMBER}`, `withdrawn_by = ${OWNER}`]) {
    assert.throws(() => db.prepare(`UPDATE competitor_price_observations SET ${set} WHERE uid = ?`).run(uid), /append-only/, set);
  }
  assert.equal(rows(db)[0].amount, '49');
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    const r = await call(db, method, `/competitor-prices/${uid}`, { amount: '1' });
    assert.equal(r.status, 404, method);
  }
  assert.equal(rows(db)[0].amount, '49');
});

test('a withdrawal clears the amount and source link once, every read then returns no amount, and an account deletion still succeeds', async () => {
  const db = fixture();
  const saved = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1 }));
  const solo = await call(db, 'POST', '/competitor-prices', terms({ competitor_name: 'Quillstack', competitor_domain: 'quillstack.example' }));
  const uid = saved.body.price.uid;
  const noReason = await call(db, 'POST', `/competitor-prices/${uid}/withdraw`, {});
  assert.equal(noReason.status, 400);
  const outsider = await call(db, 'POST', `/competitor-prices/${uid}/withdraw`, { reason: 'x' }, STRANGER);
  assert.equal(outsider.status, 404);
  const notAuthor = await call(db, 'POST', `/competitor-prices/${solo.body.price.uid}/withdraw`, { reason: 'x' }, COMEMBER);
  assert.equal(notAuthor.status, 404, 'an unattached price is withdrawn only by its author');
  const w =await call(db, 'POST', `/competitor-prices/${uid}/withdraw`, { reason: 'The page’s terms forbid keeping prices.' });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.equal(w.body.price.amount, null);
  assert.equal(w.body.price.source_url, null);
  assert.equal(w.body.price.withdrawn.reason, 'The page’s terms forbid keeping prices.');
  const row = rows(db).find((r) => r.uid === uid);
  assert.equal(row.amount, null); assert.equal(row.source_url, null); assert.equal(row.withdrawn_by, OWNER);
  const twice = await call(db, 'POST', `/competitor-prices/${uid}/withdraw`, { reason: 'again' });
  assert.equal(twice.status, 409);
  assert.throws(() => db.prepare("UPDATE competitor_price_observations SET withdrawn_reason = 'edited' WHERE uid = ?").run(uid), /append-only/);

  const cur = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=1');
  assert.deepEqual(cur.body.current, []);
  const series = await call(db, 'GET', '/competitor-prices/series?competitor=Ledgerline&product=Ledgerline%20Books&plan=Team&project=1');
  assert.equal(series.body.series.length, 1);
  assert.equal(series.body.series[0].amount, null);
  assert.equal(series.body.series[0].source_url, null);
  assert.ok(series.body.series[0].withdrawn);
  assert.doesNotMatch(JSON.stringify([cur.body, series.body]), /"49"|ledgerline\.example\/pricing/);

  db.prepare('DELETE FROM users WHERE id = ?').run(OWNER);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(OWNER) as any).n, 0, 'the account deletion succeeded');
  const after = rows(db);
  assert.equal(after.length, 2, 'the rows stay');
  assert.ok(after.every((r) => r.entered_by == null && (r.withdrawn_by == null)));
  const team = await call(db, 'GET', '/competitor-prices/series?competitor=Ledgerline&product=Ledgerline%20Books&plan=Team&project=1', undefined, COMEMBER);
  assert.equal(team.body.series.length, 1, 'the venture still reads its row');
  const orphan = await call(db, 'GET', '/competitor-prices?competitor=Quillstack', undefined, COMEMBER);
  assert.deepEqual(orphan.body.current, [], 'an unattached row whose author is gone is read by nobody');
  assert.ok(solo.body.price.uid);
});

test('answer A: a co-member reads a venture price; a stranger and an investor do not; another venture’s prices are never returned; an unattached price is read only by its author', async () => {
  const db = fixture();
  assert.equal((await call(db, 'POST', '/competitor-prices', terms({ project_id: 1, amount: '49' }))).status, 201);
  assert.equal((await call(db, 'POST', '/competitor-prices', terms({ project_id: 2, amount: '77' }), OTHER)).status, 201);
  assert.equal((await call(db, 'POST', '/competitor-prices', terms({ amount: '88' }))).status, 201);

  const co = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=1', undefined, COMEMBER);
  assert.equal(co.status, 200);
  assert.deepEqual(co.body.current.map((p: any) => p.amount), ['49'], 'only venture 1’s price, never venture 2’s');
  const coSeries = await call(db, 'GET', '/competitor-prices/series?competitor=Ledgerline&product=Ledgerline%20Books&plan=Team&project=1', undefined, COMEMBER);
  assert.deepEqual(coSeries.body.series.map((p: any) => p.amount), ['49']);
  for (const who of [STRANGER, INVESTOR]) {
    for (const path of ['/competitor-prices?competitor=Ledgerline&project=1',
      '/competitor-prices/series?competitor=Ledgerline&product=Ledgerline%20Books&plan=Team&project=1']) {
      const r = await call(db, 'GET', path, undefined, who);
      assert.equal(r.status, 403, `user ${who} ${path}`);
      assert.doesNotMatch(JSON.stringify(r.body), /"49"/);
    }
  }
  const mine = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline');
  assert.deepEqual(mine.body.current.map((p: any) => p.amount), ['88'], 'the author reads the unattached price');
  for (const who of [COMEMBER, STRANGER, INVESTOR, OTHER]) {
    const r = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline', undefined, who);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.current, [], `user ${who} reads no unattached price of another`);
  }
  const theirs = await call(db, 'GET', '/competitor-prices?competitor=Ledgerline&project=2');
  assert.equal(theirs.status, 403, 'venture 2 is not venture 1’s');
});

test('writing to a venture needs canWrite; an interview-sourced price needs that venture’s interview and holds no name', async () => {
  const db = fixture();
  for (const who of [STRANGER, INVESTOR]) {
    const r = await call(db, 'POST', '/competitor-prices', terms({ project_id: 1 }), who);
    assert.equal(r.status, 403, `user ${who}`);
  }
  const iv = { source_kind: 'interview', source_url: undefined };
  const unattached = await call(db, 'POST', '/competitor-prices', terms({ ...iv, interview_id: 11 }));
  assert.equal(unattached.status, 400);
  assert.equal(unattached.body.error, 'interview_needs_venture');
  const otherVenture = await call(db, 'POST', '/competitor-prices', terms({ ...iv, project_id: 1, interview_id: 22 }));
  assert.equal(otherVenture.status, 404);
  const withLink = await call(db, 'POST', '/competitor-prices', terms({ ...iv, project_id: 1, interview_id: 11, source_url: 'https://ledgerline.example/' }));
  assert.equal(withLink.status, 400);
  assert.equal(count(db), 0);
  const ok = await call(db, 'POST', '/competitor-prices', terms({ ...iv, project_id: 1, interview_id: 11 }), COMEMBER);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.price.interview_id, 11);
  assert.doesNotMatch(JSON.stringify(ok.body), /Synthetic Buyer/);
});
