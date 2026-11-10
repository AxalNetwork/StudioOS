/**
 * #4647 (D4647) — the reporting period a default resolves to, pages that are
 * pages, and totals over the whole population.
 *
 * WHAT IS PINNED
 *   · A default period is the last period that has ENDED, across every month
 *     and both year transitions. `currentPeriod` named the period today is
 *     INSIDE, so on 2 October a completion read measured a one-day-old Q4 and
 *     called the whole book delinquent.
 *   · A period states its window, and whether it has finished.
 *   · The support ledger's totals come from a query over the caller's whole
 *     authorized population, not from the page of entries it returns, and
 *     they do not move when the reader turns a page.
 *   · Entries past the first page are reachable, the ordering is stable, and
 *     an outstanding promise can be asked for directly.
 *   · A failed totals read says Unreadable rather than zero.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_periods_pages_4647.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';
import updates from '../src/routes/portfolio_updates.ts';
import {
  completedPeriod, currentPeriod, periodBounds, periodComplete,
} from '../src/services/portfolioMetrics.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 90, FOUNDER = 91;

// ── The period rules, as functions ──────────────────────────────────────────

// 1 ───────────────────────────────────────────────────────────────────────────
test('a default quarter is the last completed one, in every month and across the year boundary', () => {
  for (const [today, want] of [
    ['2026-01-01', '2025-Q4'], ['2026-02-14', '2025-Q4'], ['2026-03-31', '2025-Q4'],
    ['2026-04-01', '2026-Q1'], ['2026-06-30', '2026-Q1'],
    ['2026-07-01', '2026-Q2'], ['2026-09-30', '2026-Q2'],
    ['2026-10-01', '2026-Q3'], ['2026-10-02', '2026-Q3'], ['2026-12-31', '2026-Q3'],
  ] as const) {
    assert.equal(completedPeriod('quarterly', today), want, today);
  }
  // The defect, stated: on 2 October the old default was a Q4 one day old.
  assert.equal(currentPeriod('quarterly', '2026-10-02'), '2026-Q4');
  assert.equal(periodComplete('quarterly', '2026-Q4', '2026-10-02'), false, 'and it had not finished');
  assert.notEqual(completedPeriod('quarterly', '2026-10-02'), currentPeriod('quarterly', '2026-10-02'));
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a default month is the last completed one, and January reaches back a year', () => {
  for (const [today, want] of [
    ['2026-01-15', '2025-12'], ['2026-02-01', '2026-01'], ['2026-03-09', '2026-02'],
    ['2026-11-09', '2026-10'], ['2026-12-31', '2026-11'],
  ] as const) {
    assert.equal(completedPeriod('monthly', today), want, today);
  }
  assert.equal(completedPeriod('monthly', 'not-a-date'), null, 'an unreadable date resolves to nothing, never to a guess');
  assert.equal(completedPeriod('quarterly', ''), null);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a period states the window it covers, from the calendar', () => {
  assert.deepEqual(periodBounds('quarterly', '2026-Q1'), { from: '2026-01-01', until: '2026-03-31' });
  assert.deepEqual(periodBounds('quarterly', '2026-Q4'), { from: '2026-10-01', until: '2026-12-31' });
  assert.deepEqual(periodBounds('monthly', '2026-02'), { from: '2026-02-01', until: '2026-02-28' });
  // A leap February, from the calendar rather than a table of month lengths.
  assert.deepEqual(periodBounds('monthly', '2028-02'), { from: '2028-02-01', until: '2028-02-29' });
  assert.deepEqual(periodBounds('monthly', '2026-12'), { from: '2026-12-01', until: '2026-12-31' });
  assert.equal(periodBounds('quarterly', '2026-Q5'), null, 'there is no fifth quarter');
  assert.equal(periodBounds('monthly', '2026-13'), null);
  assert.equal(periodBounds('quarterly', '2026-09'), null, 'a month is not a quarter');

  // Complete is decided by the window's end, not by its label.
  assert.equal(periodComplete('quarterly', '2026-Q3', '2026-09-30'), true, 'the last day of the quarter completes it');
  assert.equal(periodComplete('quarterly', '2026-Q3', '2026-09-29'), false);
  assert.equal(periodComplete('monthly', '2028-02', '2028-02-29'), true);
  assert.equal(periodComplete('monthly', '2028-02', '2028-02-28'), false, 'a leap year has the extra day');
});

// ── The support ledger ──────────────────────────────────────────────────────

const app = new Hono<any>();
app.route('/api/portfolio-support', support);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

function fixture(entries: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, investor_id INTEGER,
                               is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, deleted_at TEXT);
           CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, uid TEXT, name TEXT);
           CREATE TABLE portfolio_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, fund_id INTEGER);`);
  db.exec(file('237'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(ADMIN, 'admin', 'Root', 'root@example.test');
  const p = db.prepare('INSERT INTO projects (id, uid, name) VALUES (?,?,?)');
  p.run(1, 'p-1', 'One');
  p.run(2, 'p-2', 'Two');
  // Entries alternate between the two companies and the three states, all with
  // the SAME `created_at`, which is what made the old ordering unstable.
  const ins = db.prepare(`INSERT INTO portfolio_support_entries
    (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const states = ['promised', 'delivered', 'withdrawn'];
  for (let i = 0; i < entries; i += 1) {
    ins.run(`sup-${i}`, (i % 2) + 1, 'intro', states[i % 3], i % 4 === 0 ? null : 2, `Entry ${i}`, ADMIN,
      '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');
  }
  return db;
}

async function get(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/portfolio-support${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { return { status: res.status, body: text as any }; }
}

// 4 ───────────────────────────────────────────────────────────────────────────
test('the totals describe every entry in scope, not the page of entries returned', async () => {
  const n = 450; // more than one page
  const db = fixture(n);
  const first = await get(db, '');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.entries.length, 400, 'one page');
  assert.equal(first.body.page.total, n, 'and the page says how many there are in all');
  assert.equal(first.body.page.next_offset, 400);
  assert.equal(first.body.totals.entries, n, 'the totals are over all 450');
  assert.equal(first.body.totals_basis, 'all_entries_in_scope');

  // Every state, counted over the whole population.
  const expect = { promised: 0, delivered: 0, withdrawn: 0 } as Record<string, number>;
  const states = ['promised', 'delivered', 'withdrawn'];
  let hours = 0; let withoutHours = 0;
  for (let i = 0; i < n; i += 1) {
    expect[states[i % 3]] += 1;
    if (i % 4 === 0) withoutHours += 1; else hours += 2;
  }
  assert.equal(first.body.totals.delivered, expect.delivered);
  assert.equal(first.body.totals.promised, expect.promised);
  assert.equal(first.body.totals.withdrawn, expect.withdrawn);
  assert.equal(first.body.totals.hours_recorded, hours, 'hours are summed over the whole ledger');
  assert.equal(first.body.totals.entries_without_hours, withoutHours,
    'and an entry with no hours is counted, not summed as zero');
  // The old code accumulated these from the 400 rows it returned.
  assert.notEqual(first.body.totals.entries, 400);

  // The second page shows the rest, and does not change what the ledger says
  // it holds — the defect was per-company counts that moved with the page.
  const second = await get(db, '?offset=400');
  assert.equal(second.body.entries.length, 50);
  assert.equal(second.body.page.next_offset, null, 'the last page says so');
  assert.deepEqual(second.body.totals, first.body.totals, 'the totals are the ledger\'s, not the page\'s');
  assert.deepEqual(
    second.body.companies.map((x: any) => [x.project_id, x.entries]),
    first.body.companies.map((x: any) => [x.project_id, x.entries]),
    'and so are the per-company counts',
  );
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('every entry is reachable, exactly once, with no row repeated between pages', async () => {
  const db = fixture(450);
  const seen: string[] = [];
  for (let offset = 0; ; ) {
    const page = await get(db, `?limit=100&offset=${offset}`);
    assert.equal(page.status, 200);
    seen.push(...page.body.entries.map((e: any) => e.uid));
    if (page.body.page.next_offset == null) break;
    offset = page.body.page.next_offset;
    assert.ok(offset <= 450, 'the walk terminates');
  }
  assert.equal(seen.length, 450, 'every entry was reached');
  assert.equal(new Set(seen).size, 450, 'and none twice — the order ends in a unique column');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('an outstanding promise can be asked for directly, however deep the history is', async () => {
  const db = fixture(450);
  const outstanding = await get(db, '?state=promised&limit=10');
  assert.equal(outstanding.status, 200);
  assert.ok(outstanding.body.entries.length > 0);
  assert.ok(outstanding.body.entries.every((e: any) => e.state === 'promised'), 'only promises');
  assert.equal(outstanding.body.filter.state, 'promised', 'the response says what it was filtered to');
  // A filtered page must not change what the ledger reports holding.
  const all = await get(db, '');
  assert.deepEqual(outstanding.body.totals, all.body.totals, 'the totals are unfiltered');
  assert.equal(outstanding.body.page.total, 450, 'and the page total is the ledger\'s population');
  // An unknown state is ignored rather than returning nothing.
  const bogus = await get(db, '?state=nonsense');
  assert.equal(bogus.body.filter.state, null);
  assert.equal(bogus.body.entries.length, 400);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('a failed figures read says Unreadable; it does not report an empty ledger', async () => {
  const db = fixture(10);
  // The page read and the figures read are separate statements. Dropping the
  // table makes both fail; the response must not then claim zero support.
  db.exec('DROP TABLE portfolio_support_entries');
  const res = await get(db, '');
  assert.equal(res.status, 200, 'the ledger still answers');
  assert.equal(res.body.totals, null, 'with no figures at all rather than zeros');
  assert.match(res.body.totals_reason, /^Unreadable/);
  assert.equal(res.body.page_state, 'unreadable');
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('both paged reads order by a unique column last', () => {
  // Case 5 walks every page and finds no row twice — but it cannot PROVE the
  // tiebreaker, because SQLite happens to return equal-key rows in rowid order
  // for a scan this simple, so the walk passes with the tiebreaker removed.
  // Whether it holds under another plan, another index or D1's own engine is
  // not something a local walk can decide, so the invariant is pinned where it
  // is actually guaranteed: in the SQL.
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const ledger = src('../src/routes/portfolio_support.ts');
  assert.match(ledger, /ORDER BY s\.created_at DESC, s\.id DESC/,
    'the ledger page breaks a created_at tie on the unique id');
  assert.ok(!/ORDER BY s\.created_at DESC\s*\n/.test(ledger), 'and nowhere orders on created_at alone');

  const history = src('../src/routes/portfolio_updates.ts');
  assert.match(history, /ORDER BY COALESCE\(submitted_at, updated_at\) DESC, id DESC/,
    'the update history breaks its timestamp tie on the unique id');
  // The same string appears in the per-company read's outer ORDER BY, so a
  // tiebreaker dropped from the paged read alone would still match above.
  assert.ok(!/ORDER BY COALESCE\(submitted_at, updated_at\) DESC\s*\n/.test(history),
    'and no read orders on the timestamp alone');
  assert.match(history, /ORDER BY COALESCE\(portfolio_updates\.submitted_at, portfolio_updates\.updated_at\) DESC,\s*\n\s*portfolio_updates\.id DESC\) AS rn/,
    'and so does the per-company latest, so which row is "latest" is deterministic');
  assert.match(history, /LIMIT \? OFFSET \?/, 'the history takes an offset: update 501 is reachable');
});

// ── The latest update per company ───────────────────────────────────────────

const updatesApp = new Hono<any>();
updatesApp.route('/api/portfolio-updates', updates);

/** A founder with two companies and a history long enough to bury one company's last update. */
function updatesFixture(perProject: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER,
                                  sector TEXT, stage TEXT, status TEXT, deleted_at TEXT);`);
  db.exec(file('125'));
  db.exec(file('437'));
  db.exec(file('202611091055'));
  db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)').run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'One', 10);
  p.run(2, 'p-2', 'Two', 10);
  const ins = db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, period, submitted_at, updated_at)
                          VALUES (?,?,?,?,'submitted',?,?,?)`);
  // Project 1's updates are all OLDER than project 2's, so in one global
  // history ordered by time every one of project 1's rows sits behind all of
  // project 2's. With a page shorter than project 2's run, project 1's latest
  // is unreachable from the history alone — which is the defect.
  for (let i = 0; i < perProject; i += 1) {
    const at = `2026-0${1 + (i % 2)}-${String(10 + (i % 18)).padStart(2, '0')}T00:00:00Z`;
    ins.run(`u1-${i}`, 1, FOUNDER, `One #${i}`, '2026-Q1', at, at);
  }
  for (let i = 0; i < perProject; i += 1) {
    const at = `2026-1${i % 2}-${String(10 + (i % 18)).padStart(2, '0')}T00:00:00Z`;
    ins.run(`u2-${i}`, 2, FOUNDER, `Two #${i}`, '2026-Q4', at, at);
  }
  return db;
}

async function getUpdates(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await updatesApp.fetch(new Request(`http://t/api/portfolio-updates${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { return { status: res.status, body: text as any }; }
}

// 9 ───────────────────────────────────────────────────────────────────────────
test('each company\'s latest update is readable without paging the whole history', async () => {
  const db = updatesFixture(30);
  const latest = await getUpdates(db, '/latest');
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.equal(latest.body.items.length, 2, 'one row per company, not one per history page');
  assert.equal(latest.body.companies, 2);
  assert.equal(latest.body.complete, true);
  const byProject = new Map(latest.body.items.map((u: any) => [u.project_id, u]));
  // Each is that company's own newest, by the same ordering the history uses.
  for (const pid of [1, 2]) {
    const mine = await getUpdates(db, `?project_id=${pid}&limit=1`);
    assert.equal((byProject.get(pid) as any).uid, mine.body.items[0].uid, `project ${pid}`);
  }

  // And it does not depend on where that row sits in the global history: a
  // page of 5 cannot reach project 1 at all, because project 2's 30 updates
  // are all newer.
  const page = await getUpdates(db, '?limit=5');
  assert.equal(page.body.items.length, 5);
  assert.ok(page.body.items.every((u: any) => u.project_id === 2), 'the first page is all one company');
  assert.equal(page.body.page.total, 60, 'the history says how long it is');
  assert.ok(page.body.page.next_offset != null, 'and where the next page starts');

  // One company on its own.
  const one = await getUpdates(db, '/latest?project_id=1');
  assert.equal(one.body.items.length, 1);
  assert.equal(one.body.items[0].project_id, 1);

  // A company with nothing readable is absent, not present with a null.
  db.exec('DELETE FROM portfolio_updates WHERE project_id = 1');
  const after = await getUpdates(db, '/latest');
  assert.equal(after.body.items.length, 1);
  assert.equal(after.body.items[0].project_id, 2);
  assert.equal(after.body.companies, 1);
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('the compliance read defaults to the completed period and states its window', () => {
  // The route needs most of the positions schema to answer; what is pinned
  // here is that it asks for the completed period and reports the window,
  // which is the wiring between the rules above (cases 1-3) and the response.
  const src = readFileSync(new URL('../src/routes/positions.ts', import.meta.url), 'utf8');
  assert.match(src, /const period = asked \|\| completedPeriod\(cadence, today\);/,
    'the default is the last completed period, not the one in progress');
  assert.match(src, /period_from: bounds\?\.from \?\? null/);
  assert.match(src, /period_until: bounds\?\.until \?\? null/);
  assert.match(src, /period_complete: period \? periodComplete\(cadence, period, today\) : null/,
    'and the response says whether the period it measured has finished');
  assert.match(src, /population: \{ basis: 'companies_held_in_book', period \}/,
    'the numerator and denominator name one population and one period');
  // An explicit period is still honoured, and a malformed one refused rather
  // than quietly resolved to something else.
  assert.match(src, /if \(asked && !bounds\)/);
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('a ledger whose every entry is untimed reports no hours and counts them all', async () => {
  // D56/D68, carried through #4647's move of these figures into the GROUP BY:
  // `null` hours is "nobody timed this" and `0` is "it took none". The totals
  // must keep the two apart at the extreme — a ledger where NOTHING was timed
  // reports `hours_recorded: 0` only alongside the count that explains it, so
  // the page can print "Not recorded" instead of a zero that reads as a
  // measurement. `investor_portfolio_ip3.test.mjs` pins the page's half.
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, investor_id INTEGER,
                               is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, deleted_at TEXT);
           CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, uid TEXT, name TEXT);
           CREATE TABLE portfolio_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, fund_id INTEGER);`);
  db.exec(file('237'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(ADMIN, 'admin', 'Root', 'root@example.test');
  db.prepare("INSERT INTO projects (id, uid, name) VALUES (1, 'p-1', 'One')").run();
  const ins = db.prepare(`INSERT INTO portfolio_support_entries
    (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
    VALUES (?,1,'intro','delivered',NULL,?,?,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')`);
  for (let i = 0; i < 5; i += 1) ins.run(`u-${i}`, `Entry ${i}`, ADMIN);

  const res = await get(db, '');
  assert.equal(res.status, 200);
  assert.equal(res.body.totals.entries, 5);
  assert.equal(res.body.totals.hours_recorded, 0, 'nothing was timed, so no hours are recorded');
  assert.equal(res.body.totals.entries_without_hours, 5, 'and every entry is counted as untimed');
  const company = res.body.companies.find((x: any) => x.project_id === 1);
  assert.equal(company.entries_without_hours, company.entries,
    'the per-company row says all of its entries are untimed');
  assert.equal(company.hours, 0);

  // One timed entry alongside them: the sum is that entry's hours only, and
  // the untimed ones are still counted rather than dragging the sum down.
  db.prepare(`INSERT INTO portfolio_support_entries
    (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
    VALUES ('u-timed',1,'intro','delivered',3,'Timed',?,'2026-11-02T00:00:00Z','2026-11-02T00:00:00Z')`).run(ADMIN);
  const mixed = await get(db, '');
  assert.equal(mixed.body.totals.hours_recorded, 3, 'only the recorded hours are summed');
  assert.equal(mixed.body.totals.entries_without_hours, 5);
  assert.equal(mixed.body.totals.entries, 6);
});
