/**
 * D4858 (#4858) — one read contract for HQ · Platform, and the catalogue's sync facts owned by the catalogue.
 *
 * What is pinned:
 *   - `readMeta` / `operationalRead`: ready, partial and unavailable, each with its one rule; a state that needs a
 *     reason never goes out without one; `data` is null exactly when unavailable;
 *   - the summary's `reads` gives every panel that shape, composite panels partial when one part is unreadable,
 *     and a reader that fails reads `unavailable` with its block's own reason;
 *   - the catalogue's sync facts: `CATALOG_SYNC_CAPABILITY`'s actions are the ones `routes/catalog.ts` writes and
 *     `paymentsChangeLog.ts` reads, the basis says failures are recorded, and no Worker or page copy says otherwise;
 *   - the last manual sync of each outcome is read from the audit log, and an unreadable log is Not recorded, never
 *     "never failed".
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/platform_read_contract_4858.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { readMeta, operationalRead, laterOf, UNAVAILABLE_FALLBACK_REASON, PARTIAL_FALLBACK_REASON } from '../src/util/operationalRead.ts';
import {
  CATALOG_SYNC_BASIS, CATALOG_SYNC_CAPABILITY, catalogSyncStateOf, readCatalogMirrorSummary, readCatalogSyncHistory,
} from '../src/services/catalog.ts';
import { CHANGE_ACTIONS } from '../src/services/paymentsChangeLog.ts';
import { SYNC_LAG_UNREADABLE } from '../src/services/supportQueues.ts';
import { blockReadMeta, PLATFORM_READ_SOURCES, PLATFORM_SUMMARY_READERS, readPlatformSummary, type PlatformSummaryReaders } from '../src/services/platformSummary.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const AT = '2026-11-07T12:00:00.000Z';

const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db); return db; })();
function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an absent object */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
const envOf = (db: DatabaseSync) => ({ DB: d1Over(db), RATE_LIMITS: kv, STRIPE_SECRET_KEY: 'sk_test_x' }) as any;
const audit = (db: DatabaseSync, action: string, at: string) => db.prepare(
  `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES (1, ?, 'billing', '{}', ?)`,
).run(action, at);

// ── the contract ──────────────────────────────────────────────────────────

test('readMeta: ready is complete with no reason; partial and unavailable always carry one', () => {
  const ready = readMeta({ answered: true, read_at: AT, source: 's', reason: 'ignored' });
  assert.deepEqual(ready, { status: 'ready', read_at: AT, source_updated_at: null, complete: true, completeness_reason: null, source: 's' });
  const partial = readMeta({ answered: true, complete: false, read_at: AT, source: 's' });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.complete, false);
  assert.equal(partial.completeness_reason, PARTIAL_FALLBACK_REASON);
  const down = readMeta({ answered: false, read_at: AT, source: 's', reason: '  ' });
  assert.equal(down.status, 'unavailable');
  assert.equal(down.complete, false);
  assert.equal(down.completeness_reason, UNAVAILABLE_FALLBACK_REASON, 'a blank reason is filled, never sent blank');
  assert.equal(readMeta({ answered: false, read_at: AT, source: 's', reason: 'Gone.' }).completeness_reason, 'Gone.');
  // `answered: false` wins over `complete: true`.
  assert.equal(readMeta({ answered: false, complete: true, read_at: AT, source: 's' }).status, 'unavailable');
});

test('operationalRead: data is null exactly when the read is unavailable', () => {
  const r = operationalRead({ n: 1 }, { read_at: AT, source: 's', source_updated_at: '2026-11-06 10:00:00' });
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.data, { n: 1 });
  assert.equal(r.source_updated_at, '2026-11-06 10:00:00');
  const none = operationalRead(null, { read_at: AT, source: 's', complete: true });
  assert.equal(none.status, 'unavailable');
  assert.equal(none.data, null);
  const part = operationalRead([1], { read_at: AT, source: 's', complete: false, completeness_reason: undefined, reason: 'Half.' } as any);
  assert.equal(part.status, 'partial');
  assert.deepEqual(part.data, [1], 'a partial read keeps what it read');
});

test('laterOf compares SQL and ISO stamps as one format', () => {
  assert.equal(laterOf('2026-11-07 09:00:00', '2026-11-07T08:00:00Z'), '2026-11-07 09:00:00', "' ' < 'T' must not decide it");
  assert.equal(laterOf(null, '2026-11-07 09:00:00'), '2026-11-07 09:00:00');
  assert.equal(laterOf('garbage', null), null);
  assert.equal(laterOf(null, undefined), null);
});

// ── the summary's reads ───────────────────────────────────────────────────

const stub = (over: Partial<Record<keyof PlatformSummaryReaders, () => Promise<unknown>>> = {}): PlatformSummaryReaders => {
  const base = Object.fromEntries(Object.keys(PLATFORM_SUMMARY_READERS).map((k) => [k, async () => ({ available: true })])) as any;
  base.github_sync = async () => ({ window: { available: true }, recent: { available: true } });
  // D4854: telemetry reports a status, not `available`.
  base.telemetry = async () => ({ status: 'healthy', last_event_at: '2026-11-07 11:59:00' });
  base.payments_catalog = async () => ({ publishable: {}, catalog: { available: true, complete: true, last_written_at: '2026-11-06 10:00:00' }, webhook: { available: true } });
  return { ...base, ...over };
};

test('every panel has a read, with its source, in the one shape', async () => {
  const out: any = await readPlatformSummary(envOf(fresh()), { readers: stub() });
  assert.deepEqual(Object.keys(out.reads).sort(), Object.keys(PLATFORM_SUMMARY_READERS).sort());
  for (const [k, m] of Object.entries<any>(out.reads)) {
    assert.deepEqual(Object.keys(m).sort(), ['complete', 'completeness_reason', 'read_at', 'source', 'source_updated_at', 'status'], k);
    assert.equal(m.status, 'ready', k);
    assert.equal(m.source, (PLATFORM_READ_SOURCES as any)[k], k);
    assert.ok(!Number.isNaN(Date.parse(m.read_at)), k);
  }
  assert.equal(out.reads.payments_catalog.source_updated_at, '2026-11-06 10:00:00', 'the mirror\'s last write is its source time');
  assert.match(out.reads.payments_catalog.source, /Payments change log/, 'the catalogue names its own source');
});

test('a failed reader reads unavailable with its own block\'s reason; a composite with one part down is partial', async () => {
  const out: any = await readPlatformSummary(envOf(fresh()), {
    readers: stub({
      jobs: () => Promise.reject(new Error('boom')),
      github_sync: async () => ({ window: { available: true }, recent: { available: false, reason: 'Recent attempts unreadable.' } }),
      payments_catalog: async () => ({ catalog: { available: true, complete: false }, webhook: { available: true } }),
    }),
  });
  assert.deepEqual([out.reads.jobs.status, out.reads.jobs.completeness_reason], ['unavailable', 'The scheduled-run history could not be read.']);
  assert.deepEqual([out.reads.github_sync.status, out.reads.github_sync.completeness_reason], ['partial', 'Recent attempts unreadable.']);
  assert.equal(out.reads.payments_catalog.status, 'partial', 'an incomplete price list is a partial read');
  assert.match(out.reads.payments_catalog.completeness_reason, /price list/);
  assert.equal(out.reads.integrations.status, 'ready', 'one panel failing leaves the others ready');
});

test('blockReadMeta: both parts of a composite down is unavailable; integration keys partial on an unreadable table', () => {
  const gh = blockReadMeta('github_sync', { window: { available: false, reason: 'W.' }, recent: { available: false, reason: 'R.' } }, AT);
  assert.deepEqual([gh.status, gh.completeness_reason], ['unavailable', 'W.']);
  const keys = blockReadMeta('integration_keys', { available: true, db_readable: false, db_reason: 'Key table unreadable.', last_set_available: true }, AT);
  assert.deepEqual([keys.status, keys.completeness_reason], ['partial', 'Key table unreadable.']);
  const jobs = blockReadMeta('jobs', { available: true, triggers: [{ last_finished_at: '2026-11-07 08:00:00' }, { last_started_at: '2026-11-07 09:30:00' }, {}] }, AT);
  assert.equal(jobs.source_updated_at, '2026-11-07 09:30:00', 'the latest run across triggers');
  assert.equal(blockReadMeta('promo_codes', null, AT).status, 'unavailable', 'a missing block is not ready');
});

test('blockReadMeta: GitHub sync is partial when counts answer but the nested lag event log does not', () => {
  const meta = blockReadMeta('github_sync', {
    window: { available: true, synced: 2, failed: 1, lag: { value: null, reason: SYNC_LAG_UNREADABLE } },
    recent: { available: true, items: [] },
  }, AT);
  assert.deepEqual([meta.status, meta.complete, meta.completeness_reason], ['partial', false, SYNC_LAG_UNREADABLE]);

  const noMirrors = blockReadMeta('github_sync', {
    window: { available: true, synced: 0, failed: 0, lag: { value: null, reason: 'Not recorded: no mirrored ticket.' } },
    recent: { available: true, items: [] },
  }, AT);
  assert.equal(noMirrors.status, 'ready', 'no measured lag is complete when its event log answered');
});

// ── the catalogue's own sync facts ────────────────────────────────────────

test('the capability names the actions the catalogue route writes and the change log reads', () => {
  const { succeeded, failed } = CATALOG_SYNC_CAPABILITY.recorded_actions;
  const route = read('cloudflare-worker/src/routes/catalog.ts');
  assert.match(route, new RegExp(`writeAdminAudit\\(c\\.env, admin\\.id, '${succeeded}'`));
  assert.match(route, new RegExp(`writeAdminAudit\\(c\\.env, admin\\.id, '${failed}'`));
  assert.equal(CHANGE_ACTIONS[succeeded], 'sync');
  assert.equal(CHANGE_ACTIONS[failed], 'sync', 'Payments\' change log reads the failure Platform says is recorded');
  const payModel = read('frontend/src/pages/admin/payments/payModel.js');
  assert.match(payModel, new RegExp(`${failed}: '`), 'Payments names the failure in words');
  assert.equal(CATALOG_SYNC_CAPABILITY.failed_syncs_recorded, true);
  assert.equal(CATALOG_SYNC_CAPABILITY.scheduled, false);
});

test('no copy says a failed sync leaves no record while the capability says it is recorded', () => {
  assert.match(CATALOG_SYNC_BASIS, /whether it succeeds or fails/);
  const stale = /fail[a-z]* (?:sync )?leaves no record|only a manual sync that succeeded is audited|whether a sync is running or failed is not stored/i;
  assert.ok(!stale.test(CATALOG_SYNC_BASIS), CATALOG_SYNC_BASIS);
  for (const p of ['cloudflare-worker/src/services/catalog.ts', 'cloudflare-worker/src/services/platformSummary.ts', 'frontend/src/pages/hq/PlatformPage.jsx', 'frontend/src/pages/admin/payments/payModel.js']) {
    const src = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!stale.test(src), `${p} still says failed syncs are not recorded`);
  }
});

test('the sync history: last of each outcome, the latest decides the state, and an unreadable log is Not recorded', async () => {
  const db = fresh();
  const env = envOf(db);
  const none = await readCatalogSyncHistory(env);
  assert.deepEqual([none.history_readable, none.last_succeeded_at, none.last_failed_at, catalogSyncStateOf(none)], [true, null, null, 'not_recorded']);
  audit(db, 'catalog_sync', '2026-11-05 10:00:00');
  audit(db, 'catalog_sync', '2026-11-06 10:00:00');
  audit(db, 'catalog_sync_failed', '2026-11-06T11:00:00.000Z');
  audit(db, 'catalog_product_update', '2026-11-07 10:00:00');
  const h = await readCatalogSyncHistory(env);
  assert.equal(h.last_succeeded_at, '2026-11-06 10:00:00');
  assert.equal(h.last_failed_at, '2026-11-06 11:00:00', 'an ISO stamp is normalised before it is compared');
  assert.equal(catalogSyncStateOf(h), 'failed');
  audit(db, 'catalog_sync', '2026-11-06 12:00:00');
  assert.equal(catalogSyncStateOf(await readCatalogSyncHistory(env)), 'succeeded');
  const summary: any = await readCatalogMirrorSummary(env);
  assert.equal(summary.sync_state, 'succeeded');
  assert.equal(summary.sync.last_failed_at, '2026-11-06 11:00:00');
  db.exec('DROP TABLE admin_audit_log');
  const gone = await readCatalogSyncHistory(env);
  assert.deepEqual([gone.history_readable, gone.last_failed_at, catalogSyncStateOf(gone)], [false, null, 'not_recorded']);
  assert.equal((await readCatalogMirrorSummary(env) as any).available, true, 'an unreadable log leaves the mirror counts standing');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'admin_audit_log'`).get()!.n, 0, 'a read creates no table');
});
