/**
 * #4708 part 2 (D4708-p2) — HQ Security's evidence reads on a LARGE ledger (`_security_scale_fixture.ts`: two
 * years, 30,000 audit rows, 100,000 activity rows, 40,000 security events, 6,000 licence events, 4,000 support
 * sessions), held three ways:
 *
 *   1. BOUNDED. Every list statement `/governance` and `/overview` make against the five ledger stores carries a
 *      LIMIT, and every list in the replies is within its stated cap, whatever the filter.
 *   2. THE PLANS. Each ledger store is read newest first from an index on the expression its ORDER BY names
 *      (migration 202611151527_4708_security_evidence_indexes.sql), never read whole and sorted; the
 *      admin-side activity arm reads only its listed actions.
 *   3. THE SAME ANSWERS. The replies with the new indexes equal the replies with them dropped: an index changes
 *      the plan, never the rows.
 *
 * Timings are printed by `scripts/perf/security-bench.mjs`, never asserted.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/security_evidence_scale_4708.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { securityScale, SECURITY_SCALE_NOW, EVIDENCE_INDEXES } from './_security_scale_fixture.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadGovernance, FEED_LIMIT } from '../src/services/adminSecurity/governanceFeed.ts';
import { parseFeedQuery } from '../src/services/adminSecurity/feedQuery.ts';
import { loadSecurityOverview, IMPERSONATION_LIMIT, ADMIN_MFA_GAP_LIMIT } from '../src/services/adminSecurity/overview.ts';
import { DATA_ACCESS_LIMIT } from '../src/services/adminSecurity/dataAccess.ts';

let db: DatabaseSync;
let env: any;
/** Every statement the last read made, with its binds. */
const seen: { sql: string; binds: unknown[] }[] = [];

before(async () => {
  db = await securityScale();
  const base = d1Over(db);
  env = {
    DB: {
      ...base,
      prepare(sql: string) {
        const p = base.prepare(sql);
        const rec = { sql, binds: [] as unknown[] };
        seen.push(rec);
        const w: any = {
          bind(...a: unknown[]) { rec.binds = a.map((v) => (v === undefined ? null : v)); p.bind(...a); return w; },
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

const query = (q: Record<string, string>) => {
  const p = parseFeedQuery((k) => q[k]);
  assert.ok(p.ok, JSON.stringify(q));
  return p.ok ? p.query : (null as never);
};

/** The ledger reads exercised: each quick category, a cursor, a search, a date range, an actor and an outcome. */
const LEDGER: Array<[string, string, Record<string, string>]> = [
  ['all', 'all', {}],
  ['exports', 'exports', {}],
  ['suspensions', 'suspensions', {}],
  ['impersonations', 'impersonations', {}],
  ['licence changes', 'licence_changes', {}],
  ['auth', 'auth', {}],
  ['a cursor a year back', 'all', { before: '2025-11-10 12:00:00' }],
  ['a search', 'all', { q: 'Synthetic 7' }],
  ['one month', 'all', { from: '2026-03-01', to: '2026-03-31' }],
  ['one actor', 'all', { actor: '7' }],
  ['refused only', 'all', { outcome: 'refused' }],
  ['open support sessions', 'impersonations', { outcome: 'not_closed' }],
];

/** The tables that grow with history: the five ledger stores. */
const STORES = ['admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events', 'security_events'];
// One literal pattern naming the same five stores (kept in step with STORES by the assertion below).
const STORE_FROM = /\bFROM (admin_audit_log|activity_logs|impersonation_sessions|licence_events|security_events)\b/;
const readsStore = (sql: string) => STORE_FROM.test(sql);
test('the store pattern names exactly the five ledger stores', () => {
  for (const t of STORES) assert.ok(readsStore(`SELECT 1 FROM ${t} WHERE 1`), t);
  assert.equal(STORE_FROM.source.split('|').length, STORES.length);
  assert.ok(!readsStore('SELECT 1 FROM admin_audit_logs'), 'a longer table name is not a store');
});
const isList = (sql: string) => /^\s*SELECT/i.test(sql) && !/\b(COUNT|SUM|MAX|MIN)\(/i.test(sql.split(/\bFROM\b/i)[0]);
const planOf = (s: { sql: string; binds: unknown[] }) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(...(s.binds as any[])) as { detail: string }[]).map((r) => r.detail);
const short = (sql: string) => sql.replace(/\s+/g, ' ').slice(0, 90);

// ---------------------------------------------------------------------------
// 1. Bounded.

/** `/governance`'s top-level keys as `main` returned them before this package. */
const REPLY_KEYS = [
  'applied', 'cursor', 'data_access', 'filter', 'filters', 'guardrails', 'limit', 'more', 'outcomes', 'page_split_second',
  'rows', 'sources', 'stores', 'tenant_available', 'tenant_reason', 'tenant_view_available', 'tenant_view_reason',
];

test('every list statement against a ledger store carries a LIMIT, and every list in the reply is within its cap', async () => {
  for (const [name, filter, q] of LEDGER) {
    const { out, statements } = await recorded(() => loadGovernance(env, filter, query(q), SECURITY_SCALE_NOW));
    for (const s of statements.filter((x) => readsStore(x.sql) && isList(x.sql))) {
      assert.match(s.sql, /\bLIMIT \?/, `${name}: an unbounded list read — ${short(s.sql)}`);
      assert.ok(Number(s.binds.at(-1)) <= FEED_LIMIT, `${name}: a page larger than the feed's — ${short(s.sql)}`);
    }
    const r = out as any;
    assert.ok(r.rows.length <= FEED_LIMIT, `${name}: ${r.rows.length} rows`);
    for (const src of r.sources) assert.ok(!src.available || src.rows <= FEED_LIMIT, `${name}: ${src.table} returned ${src.rows}`);
    assert.ok(r.data_access.impersonations.items.length <= DATA_ACCESS_LIMIT);
    assert.ok(r.data_access.exports.items.length <= DATA_ACCESS_LIMIT);
    // The shape the page reads, unchanged by this package.
    assert.deepEqual(Object.keys(r).sort(), REPLY_KEYS, `${name}: the reply's keys`);
    if (['all', 'exports', 'auth', 'suspensions'].includes(name)) {
      // A page can end a row or two short: the boundary second is held back to the next page (D4803).
      assert.ok(r.rows.length > FEED_LIMIT - 5, `${name}: the fixture fills a page (${r.rows.length})`);
      assert.equal(r.more, true, `${name}: older rows are held`);
      assert.ok(r.cursor?.before, `${name}: Load older has a cursor`);
    }
  }

  const { out, statements } = await recorded(() => loadSecurityOverview(env));
  for (const s of statements.filter((x) => readsStore(x.sql) && isList(x.sql))) {
    assert.match(s.sql, /\bLIMIT \?/, `overview: an unbounded list read — ${short(s.sql)}`);
  }
  const o = out as any;
  assert.ok(o.impersonations.recent.length <= IMPERSONATION_LIMIT);
  assert.ok(o.mfa.admins_without_mfa.length <= ADMIN_MFA_GAP_LIMIT);
  assert.equal(o.impersonations.recent.length, IMPERSONATION_LIMIT, 'the fixture fills the recent sessions');
});

// ---------------------------------------------------------------------------
// 2. The plans.

/** The index each store's newest-first read must be served by. */
const SERVED_BY: Record<string, RegExp> = {
  admin_audit_log: /USING (COVERING )?INDEX (idx_admin_audit_feed_at|idx_admin_audit_exported)\b/,
  impersonation_sessions: /USING (COVERING )?INDEX (idx_impersonation_feed_at|idx_impersonation_started|ix_imp_admin)\b/,
  licence_events: /USING (COVERING )?INDEX idx_licence_events_feed_at\b/,
  security_events: /USING (COVERING )?INDEX (idx_security_events_feed_at|idx_security_events_user)\b/,
  // The admin-side arm filters on its action list first; the plan reads only those actions.
  activity_logs: /USING (COVERING )?INDEX (idx_activity_action_created|idx_al_user|idx_activity_user)\b/,
};

function storeOf(sql: string): string {
  const m = sql.match(/\bFROM (admin_audit_log|activity_logs|impersonation_sessions|licence_events|security_events)\b/);
  return m ? m[1] : '';
}

/** What is wrong with a ledger statement's plan: the store read whole, or read and then sorted for a page. */
function planProblems(s: { sql: string; binds: unknown[] }): string[] {
  const store = storeOf(s.sql);
  const plan = planOf(s);
  const out: string[] = [];
  const first = plan.find((d) => /^(SCAN|SEARCH) /.test(d)) ?? '';
  if (!SERVED_BY[store].test(first)) out.push(`${store} not read through its index: ${first}`);
  if (store !== 'activity_logs' && /\bORDER BY\b/.test(s.sql) && plan.some((d) => /TEMP B-TREE FOR ORDER BY/.test(d))) {
    out.push(`${store} read and then sorted for one page`);
  }
  return out.map((p) => `${p}  ←  ${short(s.sql)}`);
}

test('each ledger store is read newest first from its index, never read whole and sorted for one page', async () => {
  const problems: string[] = [];
  let checked = 0;
  for (const [name, filter, q] of LEDGER) {
    const { statements } = await recorded(() => loadGovernance(env, filter, query(q), SECURITY_SCALE_NOW));
    for (const s of statements.filter((x) => readsStore(x.sql) && isList(x.sql))) {
      checked += 1;
      problems.push(...planProblems(s).map((p) => `${name}: ${p}`));
    }
  }
  assert.ok(checked >= 40, `only ${checked} ledger statements were checked`);
  assert.deepEqual(problems, []);
});

test('the Overview reads the ledger stores from an index, and counts the last day from the time index', async () => {
  const { statements } = await recorded(() => loadSecurityOverview(env));
  const problems: string[] = [];
  for (const s of statements.filter((x) => readsStore(x.sql) && isList(x.sql))) problems.push(...planProblems(s));
  assert.deepEqual(problems, []);
  const counts = statements.find((s) => /AS failed_signins_24h/.test(s.sql));
  assert.ok(counts, 'the security event counts were not read');
  const plan = planOf(counts!).join(' | ');
  assert.match(plan, /SEARCH security_events USING (COVERING )?INDEX idx_security_events_feed_at/, plan);
});

test('the migration names every index the fixture drops, and each one exists on the migrated schema', () => {
  const names = new Set((db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'index'`).all() as { name: string }[]).map((r) => r.name));
  for (const i of EVIDENCE_INDEXES) assert.ok(names.has(i), `${i} is not on the migrated schema`);
});

// ---------------------------------------------------------------------------
// 3. The same answers. Last, because it drops the indexes.

test('the replies with the new indexes equal the replies without them', async () => {
  // `sources` carries each store's freshness stamp, written at read time; the rows, cursor and flags are the answer.
  const answer = (r: any) => JSON.stringify({ rows: r.rows, cursor: r.cursor, more: r.more, split: r.page_split_second, access: r.data_access });
  const withIndexes: string[] = [];
  for (const [, filter, q] of LEDGER) withIndexes.push(answer(await loadGovernance(env, filter, query(q), SECURITY_SCALE_NOW)));
  for (const i of EVIDENCE_INDEXES) db.exec(`DROP INDEX IF EXISTS ${i}`);
  const sample = await recorded(() => loadGovernance(env, 'auth', query({}), SECURITY_SCALE_NOW));
  const sec = sample.statements.find((s) => storeOf(s.sql) === 'security_events' && isList(s.sql))!;
  assert.ok(planOf(sec).some((d) => /TEMP B-TREE FOR ORDER BY/.test(d)), 'the indexes were not dropped, so the comparison means nothing');
  for (const [k, [name, filter, q]] of LEDGER.entries()) {
    assert.equal(answer(await loadGovernance(env, filter, query(q), SECURITY_SCALE_NOW)), withIndexes[k], `${name}: an index changed the answer`);
  }
});
