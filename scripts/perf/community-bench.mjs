#!/usr/bin/env node
/**
 * #4717 package 5 — the Community reads (the overview at 4, 12 and 52 weeks,
 * and Recent activity) timed on the large synthetic community
 * (cloudflare-worker/test/_community_scale_fixture.ts), with each read's
 * statement count. No network, no model.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     scripts/perf/community-bench.mjs [--iterations=20]
 *
 * READ THE TIMINGS AS RELATIVE ONLY, as api-bench.mjs says: node:sqlite in the
 * same process, no D1 round trip. They show what an index or a predicate moved
 * on one machine. The statement counts and the query plans are what the tests
 * pin (community_reads_4717.test.ts); the timings are never asserted.
 */
import { communityScale, SCALE, SCALE_NOW } from '../../cloudflare-worker/test/_community_scale_fixture.ts';
import { d1Over } from '../../cloudflare-worker/test/_d1_sqlite.mjs';
import { communityOverview } from '../../cloudflare-worker/src/services/communityOverview.ts';
import { communityActivity } from '../../cloudflare-worker/src/services/communityActivity.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const iterations = Number(arg('iterations', '20')) || 20;
const median = (xs) => { const s = [...xs].sort((a, z) => a - z); return s[Math.floor(s.length / 2)]; };

const db = await communityScale();
const base = d1Over(db);
let statements = 0;
const env = { DB: { ...base, prepare(sql) { statements += 1; return base.prepare(sql); } } };
const Q = (over) => ({ kind: null, from: null, to: null, q: null, limit: 10, offset: 0, ...over });

const READS = [
  ['overview, 4 weeks', () => communityOverview(env, 4, SCALE_NOW)],
  ['overview, 12 weeks', () => communityOverview(env, 12, SCALE_NOW)],
  ['overview, 52 weeks', () => communityOverview(env, 52, SCALE_NOW)],
  ['activity, the card', () => communityActivity(env, Q({}))],
  ['activity, one month of events', () => communityActivity(env, Q({ kind: 'events', from: '2026-09-01', to: '2026-09-30', limit: 25 }))],
  ['activity, the last page (950–1,000)', () => communityActivity(env, Q({ limit: 50, offset: 950 }))],
];

console.log(`Community reads on ${SCALE.registrations.toLocaleString('en-US')} registrations, ${SCALE.audit.toLocaleString('en-US')} audit rows, `
  + `${SCALE.applications.toLocaleString('en-US')} applications; median of ${iterations}.`);
for (const [name, read] of READS) {
  await read(); // warm the statement cache once
  const times = [];
  let count = 0;
  for (let i = 0; i < iterations; i += 1) {
    statements = 0;
    const t = performance.now();
    await read();
    times.push(performance.now() - t);
    count = statements;
  }
  console.log(`${name.padEnd(40)} ${median(times).toFixed(1).padStart(8)} ms  ${String(count).padStart(3)} statements`);
}
db.close();
