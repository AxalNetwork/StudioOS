/**
 * D211 — the D210 review's verified findings, held where a page test cannot
 * hold them.
 *
 * WHAT THIS HOLDS, AND WHY EACH IS HERE:
 *
 *   · the week a row belongs to. The branch reader groups with SQLite's
 *     `date(created_at, '-6 days', 'weekday 1')` and HQ folds days in JS, and
 *     the two tiers only agree if a Tuesday and a Sunday one second before
 *     midnight land in their own week on the branch. D210 tested the fold and
 *     never the SQL (A1);
 *   · the aliases HQ's SQL returns are the names the fold reads. The fold
 *     reads `branch`, `uid` and `weight` by name, so an alias renamed in the
 *     query would reach the fold as `undefined` and every row would count as
 *     the anonymous account (A2);
 *   · the whole-week rule, `partialWeekReason`, on its own and through its
 *     three readers — the median's input, the KPI's four-week change, and
 *     (in `analytics_d210`) the branch's own figure beside the median;
 *   · the four-week change refused for the reason that holds for that week —
 *     the row cap, the store's floor, or a change in who is counted — and
 *     never "two populations" for a week the read did not reach;
 *   · the code `hq` reserved in every copy of the branch-code rule, since HQ's
 *     own analytics rows ARE the rows coded `hq`.
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/analytics_d211.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  weekAxis, foldDailyActives, seriesValues, weeklyKpi, gapNotes, partialWeekReason,
  loadBranchWeeklyActives, activeAccountsInWeek, GAP_ORDER, GAP_SENTENCES, ACTIVE_ACCOUNT_BASIS,
  SKIP_ACTIVITY_LOG_PATHS,
} from '../src/services/activeAccounts.ts';
import { loadActiveAccountsByBranchWeek, AE_ACTIVE_ROW_CAP } from '../src/services/analyticsReports.ts';
import { BRANCH_CODE_RE, branchOf } from '../src/util/branch.ts';
import { branchBindings } from '../src/services/branches.ts';
import { BRANCH_CODE_RE as SCRIPT_BRANCH_CODE_RE } from '../../scripts/lib/branchConfig.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

// Frozen half a second before Monday, as the D210 files are: every axis in
// this file is built from one instant, and it is the one where a drifting
// clock would change the week.
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-27T23:59:59.500Z') });

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function logDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'activity_logs')));
  return db;
}
function logged(db: InstanceType<typeof DatabaseSync>, userId: number, at: string) {
  db.prepare(
    `INSERT INTO activity_logs (user_id, action, endpoint, method, status_code, created_at)
     VALUES (?, 'http_get', '/api/projects', 'GET', 200, ?)`,
  ).run(userId, at);
}
const addDays = (monday: string, n: number) =>
  new Date(Date.parse(`${monday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ───────────────────────────────────────────────── A1 · the branch's week ──

test('A1 · the branch groups a Tuesday and a Sunday at 23:59:59 into their own weeks', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const db = logDb();
  logged(db, 7, `${axis.weeks[1]} 09:00:00`);                       // the log begins on a Monday
  logged(db, 8, `${addDays(axis.weeks[3], 1)} 10:00:00`);           // a Tuesday
  logged(db, 9, `${addDays(axis.weeks[4], 6)} 23:59:59`);           // the last second of a Sunday
  const read = await loadBranchWeeklyActives({ DB: d1Over(db) } as any, axis);
  assert.equal(read.available, true);
  if (!read.available) return;
  assert.deepEqual(read.values, [null, 1, 0, 1, 1, 0, 0, 0],
    'a Sunday row counted into the next week would move one account a week later on one tier only');
  assert.deepEqual(read.gaps, ['before_series', null, null, null, null, null, null, null]);
  assert.equal(read.first_day, axis.weeks[1]);
  assert.equal(read.first_week, axis.weeks[1]);
});

// ──────────────────────────────────────────── A2 · HQ's aliases, by name ──

async function withAe<T>(answer: () => Response, run: (sent: string[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_u: any, init: any) => { sent.push(String(init?.body ?? '')); return answer(); }) as any;
  try { return await run(sent); } finally { globalThis.fetch = real; }
}
const AE_ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AE_API_TOKEN: 'tok' } as any;

test('A2 · HQ\'s SQL returns exactly the names the fold reads, grouped per account per branch per day', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const rows = [
    { day: `${axis.weeks[2]} 00:00:00`, branch: 'fr', uid: 11, n: 3, weight: 3 },
    { day: `${axis.weeks[2]} 00:00:00`, branch: 'fr', uid: 12, n: 1, weight: 1 },
    { day: `${axis.weeks[5]} 00:00:00`, branch: 'fr', uid: 11, n: 1, weight: 1 },
  ];
  const read = await withAe(
    () => new Response(JSON.stringify({ data: rows }), { status: 200 }),
    async (sent) => {
      const r = await loadActiveAccountsByBranchWeek(AE_ENV, axis);
      assert.equal(sent.length, 1);
      const sql = sent[0];
      for (const piece of ['blob6 AS branch', 'double3 AS uid', 'count() AS n', 'sum(_sample_interval) AS weight',
        'toStartOfDay(timestamp) AS day', 'GROUP BY day, branch, uid']) {
        assert.ok(sql.includes(piece), `the query must carry ${piece}`);
      }
      // The aliases, read out of the SQL, are the fold's field names — no more.
      const aliases = [...sql.matchAll(/\bAS (\w+)/g)].map((m) => m[1]);
      assert.deepEqual(aliases, ['day', 'branch', 'uid', 'n', 'weight']);
      return r;
    },
  );
  assert.equal(read.available, true);
  if (!read.available) return;
  const fr = read.fold.byBranch.get('fr')!;
  assert.equal(fr.get(axis.weeks[2])!.size, 2, 'two accounts that week, read by the alias the SQL gives');
  assert.equal(fr.get(axis.weeks[5])!.size, 1);
  assert.equal(read.cap_day, null);
  assert.equal(read.row_cap, AE_ACTIVE_ROW_CAP);
});

test('A3 · a read that hits the row cap names the day it stopped, and the weeks before it are cap gaps', async () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const rows = Array.from({ length: AE_ACTIVE_ROW_CAP }, (_, k) => ({
    day: `${axis.weeks[4 + (k % 3)]} 00:00:00`, branch: 'fr', uid: k + 1, n: 1, weight: 1,
  }));
  const read = await withAe(
    () => new Response(JSON.stringify({ data: rows }), { status: 200 }),
    () => loadActiveAccountsByBranchWeek(AE_ENV, axis),
  );
  assert.equal(read.available, true);
  if (!read.available) return;
  assert.equal(read.cap_day, axis.weeks[4], 'the oldest day the capped read reached');
  const v = seriesValues(read.fold, axis, 'fr', read.cap_day);
  assert.deepEqual(v.gaps.slice(0, 5), ['cap', 'cap', 'cap', 'cap', 'cap'],
    'a week the read reached only part of is not a count');
  assert.equal(v.values[4], null);
  assert.ok((v.values[5] ?? 0) > 3000);
  assert.deepEqual(gapNotes([v.gaps]).map((n) => n.gap), ['cap']);
  const kpi = weeklyKpi(axis, [v]);
  assert.equal(kpi.delta, null);
  assert.match(kpi.delta_reason ?? '', /row cap/, 'the cap is why — not a change in who is counted');
});

// ───────────────────────────────────────── the whole-week rule and readers ──

test('partialWeekReason: a week is whole only if the log began before its Monday', () => {
  const monday = '2026-09-07';
  assert.equal(partialWeekReason('2026-09-06', monday), null, 'the Sunday before is a whole week later');
  assert.match(partialWeekReason('2026-09-07', monday) ?? '', /inside that week/,
    'a Monday start is partial too: Analytics Engine answers by the day and cannot see the hour');
  assert.match(partialWeekReason('2026-09-09', monday) ?? '', /inside that week/);
  assert.match(partialWeekReason('2026-09-13', monday) ?? '', /inside that week/, 'the Sunday is still that week');
  assert.match(partialWeekReason('2026-09-14', monday) ?? '', /after that week had ended/);
  assert.match(partialWeekReason(null, monday) ?? '', /logged no request/);
});

test('the median\'s input refuses a week whose log began on its Monday — D210 let it through', async () => {
  const db = logDb();
  logged(db, 7, '2026-09-07 00:00:00');
  logged(db, 8, '2026-09-10 12:00:00');
  const env = { DB: d1Over(db) } as any;
  const monday = await activeAccountsInWeek(env, '2026-09-07');
  assert.equal(monday.value, null, 'D210 compared with `>`, so a Monday start counted as a whole week');
  assert.match(monday.reason ?? '', /inside that week/);
  const next = await activeAccountsInWeek(env, '2026-09-14');
  assert.equal(next.value, 0, 'the week after is whole, and nobody in it is a measured zero');
});

test('the four-week change is refused across a week holding a line\'s first request, at either end', () => {
  const axis = weekAxis(new Date().toISOString(), 8);   // i = 6, j = 2
  const atThen = weeklyKpi(axis, [{ values: [null, null, 3, 4, 5, 6, 7, 1], first_week: axis.weeks[2] }]);
  assert.equal(atThen.value, 7);
  assert.equal(atThen.delta, null);
  assert.ok((atThen.delta_reason ?? '').includes(`week of ${axis.weeks[2]} holds the first request`),
    'the refusal names the week, so a reader can find the partial one on the chart');
  const atNow = weeklyKpi(axis, [
    { values: [null, 2, 2, 2, 2, 2, 2, 0], first_week: axis.weeks[1] },
    { values: [null, null, null, null, null, null, 4, 1], first_week: axis.weeks[6] },
  ]);
  assert.equal(atNow.delta, null, 'the second line is blank then and partial now — not growth');
  const whole = weeklyKpi(axis, [{ values: [null, 1, 3, 4, 5, 6, 7, 1], first_week: axis.weeks[1] }]);
  assert.equal(whole.delta, 7 - 3, 'both ends whole: the change is drawn');
  const unseen = weeklyKpi(axis, [{ values: [3, 3, 3, 4, 5, 6, 7, 1], first_week: null }]);
  assert.equal(unseen.delta, 7 - 3, 'a line whose first week the read cannot see is not refused for it');
});

test('the change is refused for the reason that holds that week, never "two populations" for an unread one', () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const values = [null, null, null, null, 5, 6, 7, 1];
  const cap = weeklyKpi(axis, [{ values, gaps: ['cap', 'cap', 'cap', 'cap', null, null, null, null] }]);
  assert.match(cap.delta_reason ?? '', /row cap/);
  assert.ok(!/populations/.test(cap.delta_reason ?? ''));
  const floor = weeklyKpi(axis, [{ values, gaps: ['before_store', 'before_store', 'before_store', 'before_store', null, null, null, null] }]);
  assert.match(floor.delta_reason ?? '', /history in this range begins after/);
  const joined = weeklyKpi(axis, [{ values, gaps: ['before_series', 'before_series', 'before_series', 'before_series', null, null, null, null] }]);
  assert.match(joined.delta_reason ?? '', /two different populations/);
  // The cap outranks the others: a read that stopped short is the first thing to say.
  const both = weeklyKpi(axis, [
    { values, gaps: ['cap', 'cap', 'cap', 'cap', null, null, null, null] },
    { values, gaps: ['before_series', 'before_series', 'before_series', 'before_series', null, null, null, null] },
  ]);
  assert.match(both.delta_reason ?? '', /row cap/);
});

test('gapNotes says each reason once, in GAP_ORDER, keyed by what it is', () => {
  const notes = gapNotes([
    ['before_series', 'before_series', null],
    ['no_rows', 'no_rows', 'no_rows'],
    ['cap', null, null],
    ['before_series', null, null],
  ]);
  assert.deepEqual(notes.map((n) => n.gap), ['cap', 'no_rows', 'before_series']);
  for (const n of notes) assert.equal(n.sentence, GAP_SENTENCES[n.gap]);
  assert.deepEqual(gapNotes([[null, null]]), [], 'a chart with no blank week prints no note');
  assert.deepEqual([...GAP_ORDER].sort(), Object.keys(GAP_SENTENCES).sort());
});

test('HQ states a line\'s first week only when the read can see it began', () => {
  const axis = weekAxis(new Date().toISOString(), 8);
  const fold = foldDailyActives([
    { day: `${axis.weeks[1]} 00:00:00`, branch: 'fr', uid: 0, n: 1, weight: 1 },     // the store's first row
    { day: `${addDays(axis.weeks[3], 2)} 00:00:00`, branch: 'de', uid: 5, n: 1, weight: 1 },
  ], axis)!;
  assert.equal(seriesValues(fold, axis, 'fr', null).first_week, null,
    'fr\'s first row is the store\'s first row, so fr may have begun before the store keeps');
  assert.equal(seriesValues(fold, axis, 'de', null).first_week, axis.weeks[3]);
});

// ─────────────────────────────────────────────── the basis, in one sentence ──

test('the basis sentence names the skipped prefixes as the rule matches them, writes included', () => {
  assert.ok(ACTIVE_ACCOUNT_BASIS.includes('/api/monitoring/'));
  assert.ok(ACTIVE_ACCOUNT_BASIS.includes('/api/activity'));
  assert.match(ACTIVE_ACCOUNT_BASIS, /writes as well as reads/);
  assert.ok(!/monitoring polls/.test(ACTIVE_ACCOUNT_BASIS),
    'the skip is by prefix and ignores the method, so "polls" understated what it drops');
  assert.ok(SKIP_ACTIVITY_LOG_PATHS.includes('/api/monitoring/') && SKIP_ACTIVITY_LOG_PATHS.includes('/api/activity'));
});

// ──────────────────────────────────────── "hq" is reserved in every copy ──

test('the code hq is refused by every copy of the branch-code rule, and hq-prefixed codes are not', () => {
  for (const re of [BRANCH_CODE_RE, SCRIPT_BRANCH_CODE_RE]) {
    assert.equal(re.test('hq'), false, `${re} must refuse hq`);
    for (const ok of ['hq-north', 'hqx', 'fr', 'nordics-2']) assert.equal(re.test(ok), true, `${re} must accept ${ok}`);
  }
  assert.equal(String(BRANCH_CODE_RE), String(SCRIPT_BRANCH_CODE_RE), 'the worker and the scripts hold one rule');
  // The SPA's copy is read as text: the same literal, not an approximation of it.
  const licences = src('../../frontend/src/pages/admin/AdminLicences.jsx');
  assert.ok(licences.includes(`const BRANCH_CODE_RE = ${String(BRANCH_CODE_RE)};`),
    'AdminLicences.jsx carries the same rule the deploy route enforces');
});

test('a Worker deployed with BRANCH_CODE=hq refuses to run as a branch, and BRANCH_HQ is not a branch binding', () => {
  assert.throws(() => branchOf({ BRANCH_CODE: 'hq' } as any), /not a branch code/,
    'running as a branch coded hq would count its rows into HQ\'s own line');
  assert.equal(branchOf({ BRANCH_CODE: 'fr' } as any), 'fr');
  const env = { BRANCH_HQ: { overview() {} }, BRANCH_FR: { overview() {} } } as any;
  assert.deepEqual(branchBindings(env).map((b) => b.code), ['fr']);
});

test('both workflows that take a branch code refuse hq before any command is built from it', () => {
  const provision = src('../../.github/workflows/branch-provision.yml');
  const validate = provision.slice(provision.indexOf('- name: Validate every input'));
  const firstStep = validate.slice(0, validate.indexOf('\n      - name:', 10));
  assert.match(firstStep, /\[\[ "\$BRANCH" != hq \]\] \|\| fail/, 'the first step refuses hq by name');
  const record = provision.slice(provision.indexOf('- name: Record the RPC secret hash at HQ'));
  assert.match(record.slice(0, 400), /"\$BRANCH" != hq/, 'and so does the step that writes HQ\'s registry');
  const migrate = src('../../.github/workflows/d1-migrate.yml');
  assert.match(migrate, /\|\| "\$BRANCH" == hq \]\]; then/);
});

// ─────────────────────────────── a catch is a read that failed, and says so ──

/** The block a `{` at `open` starts, through its matching `}`. */
function block(text: string, open: number): string {
  let depth = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === '{') depth += 1;
    else if (text[k] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, k + 1);
    }
  }
  throw new Error('unbalanced block');
}

test('every refusal the branch analytics route builds in a catch is marked unreadable', () => {
  // A catch in this handler is a read that FAILED, and the page draws a failed
  // read as Unreadable with a retry. The revenue summary's catch cannot be
  // reached from any fixture today — `branchRevenueSummary` catches its own
  // reads — so its mark is held here by the rule rather than by a request:
  // every `available: false` a catch builds carries `unreadable: true`.
  const route = src('../src/routes/branch_insights.ts');
  const start = route.indexOf("r.get('/analytics'");
  assert.ok(start > 0, 'the analytics handler is where this reads');
  const handler = route.slice(start, route.indexOf('export default r;'))
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const refusals: string[] = [];
  for (let at = handler.indexOf('catch (e) {'); at >= 0; at = handler.indexOf('catch (e) {', at + 1)) {
    const body = block(handler, handler.indexOf('{', at));
    if (body.includes('available: false')) refusals.push(body);
  }
  assert.ok(refusals.length >= 4,
    `the referral, escalation, benchmark and revenue reads each refuse in a catch — found ${refusals.length}`);
  for (const r of refusals) {
    assert.ok(r.includes('unreadable: true'), `a catch builds a refusal with no unreadable mark:\n${r}`);
  }
  assert.ok(refusals.some((r) => r.includes('The revenue summary could not be built')),
    'the revenue summary is one of them');
});
