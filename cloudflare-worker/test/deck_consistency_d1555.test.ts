/**
 * D1555 (#3802, deck v2 C7) — the deck's consistency rules across its cards.
 *
 * Each rule has a failing fixture and a passing one (pure, `deckConsistency`),
 * then the rules on the real check routes: both replies carry `consistency`,
 * the founder's only, with nothing written and no model run.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_consistency_d1555.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckCheck from '../src/routes/deck_check.ts';
import { deckConsistency, CONSISTENCY_RULES } from '../src/services/deckCheck.ts';
import { lineFacts } from '../src/services/deckConsistency.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const para = (value: string) => ({ key: 'body', label: 'Body', kind: 'paragraph', value });
const card = (title: string, ...lines: string[]) => ({ title, fields: lines.map(para) });
const metric = (label: string, value: string, source_key?: string) => ({ id: `m${Math.abs(label.length * 31 + value.length)}`, kind: 'metric', grid: { col: 1, row: 1, w: 4, h: 2 }, label, value, ...(source_key ? { binding: { source_key } } : {}) });
const blocks = (title: string, ...bs: any[]) => ({ title, fields: [], blocks: bs });
const rules = (slides: unknown) => deckConsistency(slides).findings.map((f) => f.rule);
const only = (slides: unknown) => deckConsistency(slides).findings;

test('D1555: the five rules, named once', () => {
  assert.deepEqual([...CONSISTENCY_RULES], ['one_value', 'use_of_funds', 'runway', 'round', 'forecast']);
});

test('one_value: two values for one metric across cards fail, naming both cards; agreeing values pass', () => {
  const fail = [card('Traction', 'We have $1.2M ARR.'), card('Team', 'Synthetic team.'), card('Ask', 'Our ARR is $1.5M today.')];
  const f = only(fail);
  assert.deepEqual(f.map((x) => [x.rule, x.key, x.cards]), [['one_value', 'one_value:arr', [1, 3]]]);
  assert.equal(f[0].message, 'ARR is $1.2M on card 1 and $1.5M on card 3.');
  // Within 2% (D1264's rounding) is one value, written two ways.
  assert.deepEqual(rules([card('Traction', 'We have $1.2M ARR.'), card('Ask', 'ARR of $1,200,000.')]), []);
  // A bound metric block is read as its slot, whatever its label says.
  assert.deepEqual(only([blocks('Traction', metric('Revenue run-rate', '$1.2M', 'grow.arr')), card('Ask', 'ARR $900k')]).map((x) => x.cards), [[1, 2]]);
  // A forward-looking line states no current figure.
  assert.deepEqual(rules([card('Traction', 'We have $1.2M ARR.'), card('Plan', 'Projected ARR of $5M by 2027.')]), []);
});

test('use_of_funds: allocations that do not add up to the raise fail; adding up passes; shares must make 100%', () => {
  const fail = [card('Ask', 'Raising $2.0M seed.'), card('Use of funds', 'Engineering $1.0M', 'Sales $0.5M', 'Operations $0.3M')];
  const f = only(fail);
  assert.deepEqual(f.map((x) => [x.rule, x.cards]), [['use_of_funds', [1, 2]]]);
  assert.equal(f[0].message, 'Use of funds $1.8M does not match the raise $2M.');
  assert.deepEqual(rules([card('Ask', 'Raising $2.0M seed.'), card('Use of funds', 'Engineering $1.2M', 'Sales $0.5M', 'Operations $0.3M')]), []);
  // A stated total wins over the lines.
  assert.deepEqual(rules([card('Ask', 'Raising $2M.'), card('Use of funds', 'Use of funds: $2.5M', 'Engineering $1M', 'Sales $1M')]), ['use_of_funds']);
  // Shares.
  const shares = only([card('Use of funds', 'Engineering 50%', 'Sales 30%', 'Operations 10%')]);
  assert.deepEqual(shares.map((x) => [x.key, x.message]), [['use_of_funds:shares:1', 'Use of funds adds up to 90%, not 100%.']]);
  assert.deepEqual(rules([card('Use of funds', 'Engineering 50%', 'Sales 30%', 'Operations 20%')]), []);
  // With no raise stated, an amount total has nothing to match.
  assert.deepEqual(rules([card('Use of funds', 'Engineering $1M', 'Sales $0.5M')]), []);
});

test('runway: runway that is not cash ÷ burn fails; matching passes; a missing figure says nothing', () => {
  const f = only([card('Finance', 'Cash of $1.2M in the bank.', 'Net burn of $100k a month.'), card('Ask', '18 months of runway.')]);
  assert.deepEqual(f.map((x) => [x.rule, x.cards]), [['runway', [1, 2]]]);
  assert.match(f[0].message, /^Runway does not equal cash ÷ burn: \$1\.2M ÷ \$100k a month is 12 months; the deck says 18 months\.$/);
  assert.deepEqual(rules([card('Finance', 'Cash of $1.2M.', 'Burn of $100k.'), card('Ask', '12 months of runway.')]), []);
  assert.deepEqual(rules([card('Finance', 'Burn of $100k.'), card('Ask', '18 months of runway.')]), [], 'no cash: nothing to check');
});

test('round: post-money is pre-money plus the raise; dilution is raise ÷ post-money; agreeing terms pass', () => {
  const pp = only([card('Round', 'Raising $2M.', 'Pre-money valuation of $8M.', 'Post-money $12M.')]);
  assert.deepEqual(pp.map((x) => x.key), ['round:pre_post']);
  const dil = only([card('Round', 'Raising $2M at a $8M pre-money.'), card('Terms', '25% dilution.')]);
  assert.deepEqual(dil.map((x) => [x.key, x.cards]), [['round:dilution', [1, 2]]]);
  assert.equal(dil[0].message, 'The raise $2M at pre-money $8M is 20% dilution, not 25%.');
  assert.deepEqual(rules([card('Round', 'Raising $2M.', 'Pre-money of $8M.', 'Post-money valuation $10M.', '20% dilution.')]), []);
  // A plain valuation agrees if it is either pre- or post-money.
  assert.deepEqual(rules([card('Round', 'Raising $2M at a $10M valuation.', 'Selling 20%')]), [], 'post-money reading');
  assert.deepEqual(rules([card('Round', 'Raising $2M at a $8M valuation.', 'Selling 20%')]), [], 'pre-money reading');
  assert.deepEqual(rules([card('Round', 'Raising $2M at a $8M valuation.', 'Selling 35%')]), ['round']);
});

test('forecast: year 1 of the forecast must equal current ARR; matching passes', () => {
  const f = only([card('Traction', '$1.2M ARR today.'), card('Financials', 'Year 1 revenue: $2M')]);
  assert.deepEqual(f.map((x) => [x.rule, x.message, x.cards]), [['forecast', 'Forecast year 1 $2M does not match current ARR $1.2M.', [1, 2]]]);
  assert.deepEqual(rules([card('Traction', '$1.2M ARR today.'), card('Financials', 'Year 1 revenue: $1.2M')]), []);
  // The bound 12-month projection is year 1, and a projected line still states it.
  assert.deepEqual(rules([card('Traction', '$1.2M ARR.'), blocks('Financials', metric('Projected revenue, next 12 months', '$3M', 'raise.projection_revenue_12m'))]), ['forecast']);
  assert.deepEqual(lineFacts('Projected year 1 revenue of $3M').map((x) => x.metric), ['forecast_y1']);
});

test('a metric stated twice is reported once, by one_value, and the rules that need it skip it', () => {
  const f = only([card('Ask', 'Raising $2M.'), card('Close', 'Raising $3M.'), card('Use of funds', 'Engineering $1M', 'Sales $0.5M')]);
  assert.deepEqual(f.map((x) => x.rule), ['one_value']);
});

test('speaker notes and image text are never read; slides that are not a list are unreadable, not consistent', () => {
  assert.deepEqual(rules([{ ...card('Traction', '$1.2M ARR.'), notes: 'Say ARR of $1.5M if asked.' }]), []);
  assert.deepEqual(deckConsistency(null), { state: 'unreadable', findings: [] });
  assert.deepEqual(deckConsistency({ slides: [] }), { state: 'unreadable', findings: [] });
  assert.deepEqual(deckConsistency([]), { state: 'ok', findings: [] });
  // A bare number is never a figure.
  assert.deepEqual(lineFacts('We closed 1,200 tickets and 1,500 more.'), []);
});

// ------------------------------------------------------------------ the routes

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1555-consistency-0123456789-abcdef';
const OWNER = 1, ADMIN = 4, OTHER = 5, PID = 7;
const INCONSISTENT = [card('Ask', 'Raising $2.0M seed.'), card('Use of funds', 'Engineering $1.0M', 'Sales $0.5M', 'Operations $0.3M')];

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) db.exec(readFileSync(resolve(M, name), 'utf8'));
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10), (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PID}, ${OWNER}, 'owner', 'accepted');`);
  const insert = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(21, PID, 1, JSON.stringify(INCONSISTENT), 'Synthetic deck', 1, OWNER);
  insert.run(22, PID, 2, JSON.stringify([card('Ask', 'Raising $2M.'), card('Use of funds', 'Engineering $1.5M', 'Sales $0.5M')]), 'Synthetic deck', 0, OWNER);
  return db;
}
async function call(db: any, who: number, method: string, path: string) {
  const app = new Hono<any>().route('/api/decks', deckCheck);
  app.onError((err: any, c: any) => c.json({ detail: String(err?.message) }, 500));
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, ...(method === 'POST' ? { body: '{}' } : {}) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D1555 route: the founder\'s read and run both carry the findings with their cards; a consistent version is ok with none', async () => {
  const db = fixture();
  for (const method of ['GET', 'POST']) {
    const r = await call(db, OWNER, method, '/api/decks/21/check');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.consistency, { state: 'ok', findings: [{ key: 'use_of_funds:raise', rule: 'use_of_funds', message: 'Use of funds $1.8M does not match the raise $2M.', cards: [1, 2] }] }, method);
  }
  assert.deepEqual((await call(db, OWNER, 'GET', '/api/decks/22/check')).body.consistency, { state: 'ok', findings: [] });
  // Nothing about consistency is stored: the claims table holds only D1264's figures.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM raise_claims WHERE claim_kind LIKE 'use_of_funds%' OR field_key LIKE '%consistency%'").get() as any).n, 0);
});

test('D1555 route: a reader who is not the founder gets no findings (they quote figures); a stranger reaches nothing', async () => {
  const db = fixture();
  const admin = await call(db, ADMIN, 'GET', '/api/decks/21/check');
  assert.equal(admin.status, 200);
  assert.equal(admin.body.consistency, null);
  assert.doesNotMatch(JSON.stringify(admin.body), /\$1\.8M|\$2M/);
  assert.notEqual((await call(db, OTHER, 'GET', '/api/decks/21/check')).status, 200);
});
