/**
 * The Programme Brief's live half — the six fields, and the reason there are
 * only six (D141).
 *
 * WHAT THIS FILE IS FOR. The brief is a PUBLIC marketing page: a prospective
 * founder reads it before they have an account, so every figure on it is read
 * by exactly the person who cannot authenticate. Two things therefore have to
 * hold, and neither is obvious from the handler:
 *
 *   1. THE ROUTE IS REACHABLE WITHOUT A TOKEN. `spinout_lab.ts`'s header says
 *      the file is "JWT-auth-gated for every route", which has not been true
 *      since `/stats` and `/cohort` shipped — auth here is per-handler, so a
 *      route is public by NOT calling `requireAuth`. That is easy to undo by
 *      accident, and undoing it empties the page for its whole audience.
 *   2. THE DATES SURVIVE AN EMPTY DATABASE. Five of the six come from
 *      `resolveApplicationTarget`, which is wall-clock arithmetic in
 *      `COHORT_TZ` and reads no table at all. The fixture below deliberately
 *      creates NO cohort tables, so if anybody later "improves" the route by
 *      reading a cycle row, this fails rather than the brief silently going
 *      blank on a database that has not run the cohort migrations.
 *
 * AND THE SIXTH IS THE ONLY ONE THAT TOUCHES D1. `places` comes through the
 * shared `getCohortSizeSettings`, which falls back to the product default —
 * which IS the operative number when nobody has overridden it, so the default
 * is the true answer rather than a stand-in for a missing one.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/spinout_brief_d141.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import spinoutLab from '../src/routes/spinout_lab.ts';
import { COHORT_TZ } from '../src/services/cohortTiming.ts';

const coerce = (x: any[]) => x.map((v) => (v === undefined ? null : v));

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const app = new Hono<any>();
app.route('/', spinoutLab);

/**
 * A database with NO cohort tables — the point of the exercise. `places` falls
 * back to the product default; every date still answers, because no date is
 * read from here.
 */
function emptyDb() { return new DatabaseSync(':memory:'); }

/** …and one where an operator HAS set the cohort size. */
function sizedDb(max: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE cohort_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare(`INSERT INTO cohort_settings (key, value) VALUES ('max_cohort_size', ?)`).run(String(max));
  return db;
}

const get = async (db: InstanceType<typeof DatabaseSync>) => {
  const res = await app.request('/brief', {}, { DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json() as any };
};

/**
 * THE SIX, exactly as the brief's design names them. Written as dotted paths
 * rather than as a nested object so the assertion reads like the design does,
 * and so a renamed key fails here rather than rendering as a blank on a page
 * nobody is testing.
 */
const LIVE_TOKENS = [
  'brief.generated_at',
  'brief.year',
  'cohort.name',
  'cohort.start_date',
  'cohort.close_at',
  'cohort.places',
];

const at = (obj: any, path: string) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

test('the route answers without a token — it is read by people who have no account', async () => {
  const { status } = await get(emptyDb());
  assert.equal(status, 200,
    'the brief route now requires auth, so every figure on a public marketing page is blank');
});

test('every one of the six tokens the design declares resolves to a key the route sends', async () => {
  const { body } = await get(emptyDb());
  const missing = LIVE_TOKENS.filter((t) => at(body, t) === undefined);
  assert.deepEqual(missing, [],
    'a token the brief prints has no field behind it — it would render as a literal or a blank');
});

test('the dates answer on a database with no cohort tables at all', async () => {
  // The whole reason five of the six are pure arithmetic. A route that read a
  // cycle row would return nulls here, and the brief would be dateless on any
  // deployment that has not run the cohort migrations.
  const { body } = await get(emptyDb());
  for (const t of ['cohort.name', 'cohort.start_date', 'cohort.close_at']) {
    assert.ok(at(body, t), `${t} is empty on a bare database — the route reads a table it should not`);
  }
  assert.match(body.brief.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(body.brief.year, /^\d{4}$/);
});

test('applications close BEFORE the cohort starts, which is the window the page describes', async () => {
  // Not a formatting check: if these ever cross, the brief tells a founder they
  // can still apply to a cohort that has already begun.
  const { body } = await get(emptyDb());
  const close = Date.parse(body.cohort.close_at);
  const start = Date.parse(body.cohort.start_date);
  assert.ok(Number.isFinite(close) && Number.isFinite(start), 'a date did not parse');
  assert.ok(close < start,
    'applications close at or after the cohort starts — the brief would invite a late application');
});

test('the zone the dates are enforced in is named, and it is the programme’s', async () => {
  const { body } = await get(emptyDb());
  assert.equal(body.zone, COHORT_TZ,
    'the brief either omits the zone or names one the programme does not run on');
});

test('places reflects what an operator set, and the default is the operative number otherwise', async () => {
  const set = await get(sizedDb(24));
  assert.equal(set.body.cohort.places, 24, 'an operator-set cohort size is not reported');
  const bare = await get(emptyDb());
  assert.ok(Number.isFinite(bare.body.cohort.places) && bare.body.cohort.places > 0,
    'with no setting the route reports no places at all, rather than the default that is actually in force');
});

test('the route sends ONLY the live half — the programme copy is not served from here', async () => {
  // The line this decision draws. Tracks, tools, gates, jurisdictions and
  // deliverables are the programme's own description and live in the SPA beside
  // the pages that already render them; a route that also served them would be
  // a store invented so a page could look dynamic.
  const { body } = await get(emptyDb());
  assert.deepEqual(Object.keys(body).sort(), ['applications_open', 'brief', 'cohort', 'zone']);
  for (const k of ['tracks', 'tools', 'groups', 'gates', 'jurs', 'deliverables', 'weeks', 'terms']) {
    assert.equal(body[k], undefined, `the route serves \`${k}\`, which is content rather than a measurement`);
  }
});
