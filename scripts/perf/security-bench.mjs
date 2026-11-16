#!/usr/bin/env node
/**
 * #4708 part 2 — HQ Security's evidence reads (the ledger under each quick category, a cursor and a search,
 * and the Overview) timed on the large synthetic ledger (cloudflare-worker/test/_security_scale_fixture.ts),
 * with and without the indexes of migration 202611151527_4708_security_evidence_indexes.sql, and each
 * read's statement count. No network, no model.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     scripts/perf/security-bench.mjs [--iterations=20]
 *
 * READ THE TIMINGS AS RELATIVE ONLY, as api-bench.mjs says: node:sqlite in the same process, no D1 round
 * trip. They show what an index moved on one machine. The query plans are what the tests pin
 * (security_evidence_scale_4708.test.ts); the timings are never asserted.
 */
import { securityScale, SECURITY_SCALE, SECURITY_SCALE_NOW, EVIDENCE_INDEXES } from '../../cloudflare-worker/test/_security_scale_fixture.ts';
import { d1Over } from '../../cloudflare-worker/test/_d1_sqlite.mjs';
import { loadGovernance } from '../../cloudflare-worker/src/services/adminSecurity/governanceFeed.ts';
import { parseFeedQuery } from '../../cloudflare-worker/src/services/adminSecurity/feedQuery.ts';
import { loadSecurityOverview } from '../../cloudflare-worker/src/services/adminSecurity/overview.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const iterations = Number(arg('iterations', '20')) || 20;
const median = (xs) => { const s = [...xs].sort((a, z) => a - z); return s[Math.floor(s.length / 2)]; };

const db = await securityScale();
const base = d1Over(db);
let statements = 0;
const env = { DB: { ...base, prepare(sql) { statements += 1; return base.prepare(sql); } } };
const fq = (q) => { const p = parseFeedQuery((k) => q[k]); if (!p.ok) throw new Error(p.message); return p.query; };

const READS = [
  ['ledger, all actions', () => loadGovernance(env, 'all', fq({}), SECURITY_SCALE_NOW)],
  ['ledger, exports', () => loadGovernance(env, 'exports', fq({}), SECURITY_SCALE_NOW)],
  ['ledger, suspensions', () => loadGovernance(env, 'suspensions', fq({}), SECURITY_SCALE_NOW)],
  ['ledger, sign-ins and step-ups', () => loadGovernance(env, 'auth', fq({}), SECURITY_SCALE_NOW)],
  ['ledger, Load older a year back', () => loadGovernance(env, 'all', fq({ before: '2025-11-10 12:00:00' }), SECURITY_SCALE_NOW)],
  ['ledger, a search', () => loadGovernance(env, 'all', fq({ q: 'Synthetic 7' }), SECURITY_SCALE_NOW)],
  ['overview', () => loadSecurityOverview(env)],
];

console.log(`HQ Security reads on ${SECURITY_SCALE.audit.toLocaleString('en-US')} audit rows, ${SECURITY_SCALE.activity.toLocaleString('en-US')} activity rows, `
  + `${SECURITY_SCALE.security.toLocaleString('en-US')} security events; median of ${iterations}.`);
for (const mode of ['with the indexes', 'without them']) {
  if (mode === 'without them') for (const i of EVIDENCE_INDEXES) db.exec(`DROP INDEX IF EXISTS ${i}`);
  console.log(`— ${mode}`);
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
    console.log(`${name.padEnd(34)} ${median(times).toFixed(1).padStart(8)} ms  ${String(count).padStart(3)} statements`);
  }
}
db.close();
