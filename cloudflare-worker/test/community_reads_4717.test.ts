/**
 * #4717 package 5 — the Community reads on a LARGE community
 * (`_community_scale_fixture.ts`: three years, 60,000 registrations, 40,000
 * audit rows), measured three ways:
 *
 *   1. THE SAME ANSWERS. Recent activity is read through the old statements
 *      (the reference below, copied from the read before this package: one
 *      UNION per source, filtered and sorted outside) and the new arms, over a
 *      matrix of kinds, windows, searches and pages up to the 1,000-row cap,
 *      and the answers must be equal. D918's overview with seats for the
 *      events it reads is held equal to the overview with every event's
 *      seats; the counts moved into SQL are held to counts made in JS from
 *      every row.
 *   2. THE PLANS. Every statement the reads make is put through EXPLAIN QUERY
 *      PLAN: no history table is read whole, except where a count over all
 *      time is the definition, and then only from an index (COVERING).
 *   3. THE BUDGETS. How many statements each read makes is pinned.
 *
 * Timings are printed by `scripts/perf/community-bench.mjs`, never asserted.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_reads_4717.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { communityScale, SCALE, SCALE_NOW } from './_community_scale_fixture.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { ACTIVITY_SOURCES, communityActivity, shapeRow, sourcesFor, type ActivityQuery, type ActivitySource } from '../src/services/communityActivity.ts';
import { communityOverview } from '../src/services/communityOverview.ts';
import { readOverview } from '../src/services/adminEventsReads.ts';
import { likeNeedleLower } from '../src/util/likeSearch.ts';

let db: DatabaseSync;
let env: any;
/** Every statement the last read made, with its binds. */
const seen: { sql: string; binds: unknown[] }[] = [];

before(async () => {
  db = await communityScale();
  const base = d1Over(db);
  env = {
    DB: {
      ...base,
      prepare(sql: string) {
        const p = base.prepare(sql);
        const rec = { sql, binds: [] as unknown[] };
        seen.push(rec);
        const w: any = {
          bind(...a: unknown[]) { rec.binds = a; p.bind(...a); return w; },
          all: () => p.all(), first: (c?: string) => p.first(c), run: () => p.run(),
        };
        return w;
      },
    },
  };
});
after(() => db?.close());

async function recorded<T>(f: () => Promise<T>): Promise<{ out: T; statements: { sql: string; binds: unknown[] }[] }> {
  seen.length = 0;
  const out = await f();
  return { out, statements: [...seen] };
}

// ---------------------------------------------------------------------------
// The reference: Recent activity as it was read before #4717 package 5.

const WINDOW = `(? IS NULL OR datetime(at) >= datetime(?)) AND (? IS NULL OR datetime(at) < datetime(?, '+1 day'))
   AND (? IS NULL OR lower(coalesce(title, '')) LIKE ? ESCAPE '\\')`;

const EVENTS_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, e.title AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')
   WHERE a.report_type = 'events'
     AND a.action IN ('event_approved', 'event_rejected', 'event_unpublished', 'event_featured', 'event_cancelled')
  UNION ALL
  SELECT CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END, a.action, a.exported_at, e.title, NULL, a.id
    FROM admin_audit_log a
    LEFT JOIN events e ON e.id = json_extract(a.filters_json, '$.event_id')
    LEFT JOIN users u ON u.id = a.admin_user_id
   WHERE a.action = 'event_submitted'`;

const JOBS_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, j.title AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN job_postings j ON j.id = json_extract(a.filters_json, '$.posting_id')
   WHERE a.report_type = 'jobs' AND a.action IN ('job_approved', 'job_rejected', 'job_unpublished')
  UNION ALL
  SELECT 'member', CASE WHEN j.status = 'closed' THEN 'job_closed' ELSE 'job_submitted' END, j.updated_at, j.title, NULL, -j.id
    FROM job_postings j
   WHERE j.status IN ('pending_review', 'closed')`;

const CIRCLES_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, ci.name AS title,
         json_extract(a.filters_json, '$.featured') AS featured, a.id AS tiebreak
    FROM admin_audit_log a LEFT JOIN circles ci ON ci.id = json_extract(a.filters_json, '$.circle_id')
   WHERE a.report_type = 'circles'
     AND a.action IN ('circle_created', 'circle_published', 'circle_unpublished', 'circle_featured')`;

const REGISTRATIONS_SQL = `
  SELECT 'member' AS actor, 'registrations' AS action, MAX(r.registered_at) AS at, e.title AS title,
         COUNT(*) AS n, -MIN(r.id) AS tiebreak
    FROM event_registrations r JOIN events e ON e.id = r.event_id
   GROUP BY r.event_id, date(r.registered_at)`;

const WELLBEING_SQL = `
  SELECT 'admin' AS actor, a.action AS action, a.exported_at AS at, NULL AS title, NULL AS featured, a.id AS tiebreak
    FROM admin_audit_log a
   WHERE a.report_type = 'wellbeing'
     AND a.action IN ('expert_verified', 'expert_unverified', 'expert_hidden', 'expert_restored', 'expert_declined')`;

const BASE: Record<ActivitySource, string> = {
  events: EVENTS_SQL,
  jobs: JOBS_SQL,
  circles: CIRCLES_SQL,
  event_registrations: REGISTRATIONS_SQL,
  wellbeing: WELLBEING_SQL,
};

/** `admin` narrows to admins' acts in every source; a source with none is not asked. */
const ADMIN_FILTER = `(? IS NULL OR actor = 'admin')`;

function refRowsSql(src: ActivitySource): string {
  return `SELECT * FROM (${BASE[src]}) WHERE ${WINDOW} AND ${ADMIN_FILTER} ORDER BY datetime(at) DESC, tiebreak DESC LIMIT ?`;
}
function refCountSql(src: ActivitySource): string {
  return `SELECT COUNT(*) AS n FROM (${BASE[src]}) WHERE ${WINDOW} AND ${ADMIN_FILTER}`;
}


type Raw = { actor: string; action: string; at: string; title: string | null; featured?: unknown; n?: number; tiebreak: number };

async function referenceActivity(q: ActivityQuery) {
  const like = likeNeedleLower(q.q, 1);
  const b = [q.from, q.from, q.to, q.to, like, like, q.kind === 'admin' ? 1 : null];
  const window = q.offset + q.limit;
  const answers = sourcesFor(q.kind).map((src) => {
    const rows = db.prepare(refRowsSql(src)).all(...(b as any[]), window) as unknown as Raw[];
    const n = Number((db.prepare(refCountSql(src)).get(...(b as any[])) as { n: number }).n) || 0;
    return { src, rows: rows.map((r) => ({ row: shapeRow(src, r), tie: Number(r.tiebreak) || 0 })), n };
  });
  const merged = answers.flatMap((a) => a.rows.map((r) => ({ ...r, src: a.src })))
    .sort((x, y) => (y.row.at.localeCompare(x.row.at)) || (ACTIVITY_SOURCES.indexOf(x.src) - ACTIVITY_SOURCES.indexOf(y.src)) || (y.tie - x.tie));
  return { rows: merged.slice(q.offset, q.offset + q.limit).map((m) => m.row), total: answers.reduce((t, a) => t + a.n, 0) };
}

const Q = (over: Partial<ActivityQuery>): ActivityQuery => ({ kind: null, from: null, to: null, q: null, limit: 10, offset: 0, ...over });

// ---------------------------------------------------------------------------
// 1. The same answers.

const ACTIVITY_CASES: Array<Partial<ActivityQuery>> = [
  {}, // the dashboard's card
  { limit: 50, offset: 950 }, // the last page under the 1,000-row cap
  { kind: 'events', limit: 50, offset: 950 },
  { kind: 'events', from: '2026-09-01', to: '2026-09-30', limit: 25 },
  { kind: 'events', from: '2024-01-01', limit: 50, offset: 950 }, // more than 1,000 groups in the window
  { kind: 'admin', limit: 25, offset: 100 },
  { kind: 'admin', from: '2025-06-01', to: '2026-06-01', limit: 50, offset: 500 },
  { kind: 'jobs', to: '2025-12-31', limit: 25 },
  { kind: 'circles', from: '2026-01-01' },
  { kind: 'wellbeing', limit: 50, offset: 200 },
  { q: 'event 1', limit: 25 }, // a search reaches events and registrations by title, nothing else
  { q: 'event 1', from: '2026-01-01', to: '2026-10-21', limit: 50, offset: 300 },
  { kind: 'jobs', q: 'role 12', limit: 25 },
  { from: '2026-10-21', to: '2026-10-21' }, // one day
  { from: '2030-01-01' }, // nothing in the window
];

test('Recent activity answers as the old statements did, over every kind, window, search and page to the 1,000 cap', async () => {
  // Mutation checked: the registrations cut at the first of the N newest days instead of the N-th →
  // the last page differs; the `to` bound dropped from the arms → the windowed cases differ; the
  // event_submitted arm without its admin term → the admin cases differ.
  for (const c of ACTIVITY_CASES) {
    const q = Q(c);
    const [got, want] = [await communityActivity(env, q), await referenceActivity(q)];
    assert.deepEqual(got.unreadable, [], JSON.stringify(c));
    assert.equal(got.total, want.total, `total ${JSON.stringify(c)}`);
    assert.deepEqual(got.rows, want.rows, `rows ${JSON.stringify(c)}`);
  }
  // The cases reach what they claim: the cap's last page is full, and the wide window has more than 1,000 groups.
  assert.equal((await communityActivity(env, Q({ limit: 50, offset: 950 }))).rows.length, 50);
  assert.ok((await communityActivity(env, Q({ kind: 'events', from: '2024-01-01', limit: 1 }))).total > 1000);
});

test('registrations are cut to the window before they are grouped, and the newest groups never start at the beginning of history', async () => {
  const { statements } = await recorded(() => communityActivity(env, Q({ kind: 'events', from: '2026-09-01', to: '2026-09-30' })));
  const grouped = statements.filter((s) => /GROUP BY date\(r\.registered_at\), r\.event_id/.test(s.sql));
  assert.equal(grouped.length, 2, 'the rows and the count');
  for (const s of grouped) {
    assert.match(s.sql, /WHERE date\(r\.registered_at\) >= \? AND date\(r\.registered_at\) <= \?[\s\S]*GROUP BY/, 'the window is applied after the grouping');
    assert.ok(planOf(s).some((d) => /^SEARCH r USING (COVERING )?INDEX idx_event_registrations_day \(<expr>>\? AND <expr><\?\)/.test(d)), planOf(s).join(' | '));
  }
  // Unfiltered, the grouping starts at the N-th newest day that has a registration, read from the index.
  const dash = await recorded(() => communityActivity(env, Q({})));
  const days = dash.statements.find((s) => /SELECT DISTINCT date\(r\.registered_at\)/.test(s.sql))!;
  assert.ok(days, 'the day cut was not read');
  const rows = dash.statements.find((s) => /MAX\(r\.registered_at\)/.test(s.sql))!;
  assert.match(rows.sql, /date\(r\.registered_at\) >= \?/);
  assert.equal(rows.binds[0], (db.prepare(days.sql).all(...(days.binds as any[])) as { d: string }[]).at(-1)!.d);
});

test('D918\'s overview with seats for the events it reads equals the overview with every event\'s seats', async () => {
  // Mutation checked: cancelled events left out of overviewSeatsFor → paid tickets on cancelled events differ;
  // "starting from now" left out → an event whose ends_at is before its start loses its seats.
  for (const weeks of [4, 12, 52]) {
    const [got, want] = [await readOverview(env, weeks, SCALE_NOW), await readOverview(env, weeks, SCALE_NOW, { allSeats: true })];
    assert.deepEqual(got, want, `${weeks} weeks`);
  }
});

/** Every row of a table, its time parsed as the reads parse it (UTC when no zone is given). */
function times(sql: string): number[] {
  const at = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return Number.NaN;
    const s = v.trim();
    return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  };
  return (db.prepare(sql).all() as { t: unknown }[]).map((r) => at(r.t));
}

test('the counts moved into SQL equal the counts made in JS from every row', async () => {
  // Mutation checked: the period before counted with `<= start` or from `start` → previous_period differs;
  // the applications' two-period bound narrowed to the window → `previous` is 0.
  const WEEK = 7 * 86_400_000;
  const regs = times('SELECT registered_at AS t FROM event_registrations');
  const checks = times('SELECT checked_in_at AS t FROM event_checkins');
  const apps = times('SELECT created_at AS t FROM job_applications');
  const books = times(`SELECT b.created_at AS t FROM expert_bookings b JOIN experts e ON e.id = b.expert_id WHERE substr(e.uid, 1, 7) <> 'sample-'`);
  for (const weeks of [4, 12, 52] as const) {
    const o = await readOverview(env, weeks, SCALE_NOW);
    const monday = Date.parse(`${o.weekly.weeks.at(-1).week_start}T00:00:00Z`);
    const start = monday - (weeks - 1) * WEEK;
    const end = monday + WEEK;
    const prev = start - weeks * WEEK;
    const within = (xs: number[], a: number, b: number) => xs.filter((t) => t >= a && t < b).length;
    assert.equal(o.weekly.registrations.previous_period, within(regs, prev, start), `${weeks}: registrations before`);
    assert.equal(o.weekly.registrations.this_period, within(regs, start, end), `${weeks}: registrations`);
    assert.equal(o.weekly.weeks.reduce((n: number, w: any) => n + w.checkins, 0), within(checks, start, end), `${weeks}: check-ins`);

    const c = await communityOverview(env, weeks, SCALE_NOW);
    const from = Date.parse(`${c.window.from.replace(' ', 'T')}Z`);
    const to = Date.parse(`${c.window.to.replace(' ', 'T')}Z`);
    const pfrom = Date.parse(`${c.previous.from.replace(' ', 'T')}Z`);
    const pto = Date.parse(`${c.previous.to.replace(' ', 'T')}Z`);
    const jobs = c.blocks.jobs as any;
    assert.deepEqual([jobs.applications.window, jobs.applications.previous], [within(apps, from, to), within(apps, pfrom, pto)], `${weeks}: applications`);
    const bk = (c.blocks.wellbeing as any).bookings;
    assert.deepEqual([bk.window, bk.previous], [within(books, from, to), within(books, pfrom, pto)], `${weeks}: bookings`);
    assert.ok(jobs.applications.previous > 0 && bk.previous > 0, 'the period before is not empty, so the check means something');
  }
});

// ---------------------------------------------------------------------------
// 2. The plans.

/** The tables that grow with history. Catalog tables (users, events, postings, circles, experts, profiles) may be read whole. */
const HISTORY = new Set(['admin_audit_log', 'event_registrations', 'event_checkins', 'job_applications', 'expert_bookings', 'wellbeing_daily_pulses']);

/**
 * A count over ALL time is read whole by definition, and only from an index:
 *   - Recent activity's unfiltered total of registration groups, and the day cut (which stops at N days);
 *   - the Jobs card's most applications, every posting's applications of all time (D1121).
 */
const ALL_TIME_BY_DEFINITION = new Set(['idx_event_registrations_day', 'idx_job_applications_posting']);

const planOf = (s: { sql: string; binds: unknown[] }) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(...(s.binds as any[])) as { detail: string }[]).map((r) => r.detail);

/** alias → table, from the statement's FROM and JOIN clauses. */
function aliases(sql: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, table, alias] of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z_]+))?/gi)) {
    m.set(table, table);
    if (alias && !/^(ON|WHERE|LEFT|JOIN|GROUP|ORDER|LIMIT|INNER|USING)$/i.test(alias)) m.set(alias, table);
  }
  return m;
}

/** What is wrong with a statement's plan: a history table read whole, or read whole through an index it may not be. */
function wholeReads(s: { sql: string; binds: unknown[] }): string[] {
  const names = aliases(s.sql);
  const out: string[] = [];
  for (const d of planOf(s)) {
    const m = d.match(/^SCAN (\w+)(?: USING (COVERING )?INDEX (\w+))?/);
    if (!m) continue;
    const table = names.get(m[1]) ?? m[1];
    if (!HISTORY.has(table)) continue;
    if (m[2] && ALL_TIME_BY_DEFINITION.has(m[3])) continue;
    out.push(`${d}  ←  ${s.sql.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  return out;
}

const READS: Array<[string, () => Promise<unknown>]> = [
  ['activity: the card', () => communityActivity(env, Q({}))],
  ['activity: one month of events', () => communityActivity(env, Q({ kind: 'events', from: '2026-09-01', to: '2026-09-30', limit: 25 }))],
  ['activity: admins, a year', () => communityActivity(env, Q({ kind: 'admin', from: '2025-10-01', to: '2026-10-01', limit: 25 }))],
  ['activity: the last page', () => communityActivity(env, Q({ limit: 50, offset: 950 }))],
  ['activity: a search', () => communityActivity(env, Q({ q: 'event 1', limit: 25 }))],
  ['overview: 4 weeks', () => communityOverview(env, 4, SCALE_NOW)],
  ['overview: 12 weeks', () => communityOverview(env, 12, SCALE_NOW)],
  ['overview: 52 weeks', () => communityOverview(env, 52, SCALE_NOW)],
];

test('no Community read reads a history table whole, except an all-time count from its index', async () => {
  // Mutation checked: the migration's day index dropped → registrations are scanned; the arms' window back
  // outside a subquery → admin_audit_log is scanned; the applications' two-period WHERE removed → job_applications is scanned.
  const problems: string[] = [];
  for (const [name, read] of READS) {
    const { statements } = await recorded(read);
    for (const s of statements) for (const p of wholeReads(s)) problems.push(`${name}: ${p}`);
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// 3. The budgets.

/** read → statements, at this package. A read that makes more has to say why; one that makes fewer lowers it here. */
const BUDGETS: Record<string, number> = {
  'activity: the card': 15,
  'activity: one month of events': 6,
  'activity: admins, a year': 10,
  'activity: the last page': 15,
  'activity: a search': 15,
  'overview: 4 weeks': 22,
  'overview: 12 weeks': 22,
  'overview: 52 weeks': 22,
};

test('each Community read stays within its statement budget', async () => {
  assert.deepEqual(Object.keys(BUDGETS).sort(), READS.map(([n]) => n).sort());
  for (const [name, read] of READS) {
    const { statements } = await recorded(read);
    assert.equal(statements.length, BUDGETS[name], name);
  }
  assert.ok(SCALE.registrations >= 60000, 'the fixture is the large one');
});
