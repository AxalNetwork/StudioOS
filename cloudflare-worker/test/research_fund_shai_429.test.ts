/**
 * D535 (#1081) — migration 429, the third fund list, applied after the lists'
 * review (406, 413), on real SQLite.
 *
 * What is pinned:
 *   - the directory holds the three lists, the third one exactly as the
 *     repository rebuilds it, and its review names the committed copy, which
 *     exists;
 *   - an old row of that list under an unreproducible uid is gone, and no
 *     other list's row is deleted;
 *   - the third list is cite only and served, while Deep Tech stays withheld;
 *   - re-running 429 changes nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_fund_shai_429.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { EUR_SOURCE, SERVED_FUNDS } from '../src/services/researchFundDirectory.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const MIGRATIONS = resolve(here, '../sql/migrations');
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8');
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const SHAI = 'Shai Goldman — new VC funds at/below $200M';
const M429 = readdirSync(MIGRATIONS).find((f) => f.startsWith('429_'))!;

function directory(before?: (db: DatabaseSync) => void) {
  // D1 does not enforce foreign keys inside a batch, so neither does this: a
  // report row goes only if 429 deletes it itself, not through the cascade.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(read('378_research_fund_directory_rebuild.sql'));
  db.exec(read(readdirSync(MIGRATIONS).find((f) => f.startsWith('406_'))!));
  db.exec(read('413_research_fund_source_terms_review.sql'));
  before?.(db);
  db.exec(read(M429));
  return db;
}
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).n);

test('429 holds the third list as the repository rebuilds it, and its review names the committed copy', () => {
  const db = directory();
  const bySource = Object.fromEntries((db.prepare('SELECT source_name AS s, COUNT(*) AS n FROM research_fund_directory GROUP BY 1').all() as any[])
    .map((r) => [r.s, Number(r.n)]));
  assert.deepEqual(bySource, { [EUR_SOURCE]: 1076, [DEEP]: 1538, [SHAI]: 890 });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM research_fund_directory WHERE source_name = ? AND fund_size_cents IS NOT NULL', SHAI), 886);
  const review = db.prepare('SELECT verdict, repo_copy FROM research_fund_sources WHERE source_name = ?').get(SHAI) as any;
  assert.equal(review.verdict, 'cite only');
  assert.equal(review.repo_copy, 'attached_assets/shai-goldman-new-vc-funds.csv');
  assert.ok(existsSync(resolve(ROOT, review.repo_copy)), 'the committed copy is in the repository');
});

test('429 removes the list\'s unrebuildable rows, and only that list\'s', () => {
  const db = directory((d) => {
    d.prepare(`INSERT INTO research_fund_directory (uid, name, source_name, source_url, as_of) VALUES (?, ?, ?, 'u', '2026-01-01')`)
      .run('prod-only-uid', 'An old production row', SHAI);
    d.prepare(`INSERT INTO research_fund_directory_reports (fund_uid, period, source_url) VALUES ('prod-only-uid', '2025-Q4', 'u')`).run();
  });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM research_fund_directory WHERE uid = 'prod-only-uid'"), 0, 'a row nobody can rebuild survived');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM research_fund_directory_reports WHERE fund_uid = 'prod-only-uid'"), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM research_fund_directory WHERE source_name = ?', EUR_SOURCE), 1076);
  assert.ok(count(db, 'SELECT COUNT(*) AS n FROM research_fund_directory_reports') > 0, 'another list\'s reports were deleted');
});

test('the third list is served and Deep Tech stays withheld; a replay changes nothing', () => {
  const db = directory();
  const served = () => count(db, `SELECT COUNT(*) AS n FROM ${SERVED_FUNDS} AS f`);
  assert.equal(served(), 1076 + 890);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${SERVED_FUNDS} AS f WHERE source_name = ?`, DEEP), 0);
  const before = (db.prepare('SELECT uid, source_name, fund_size_cents FROM research_fund_directory ORDER BY uid').all() as any[]).map((r) => ({ ...r }));
  db.exec(read(M429));
  const after = (db.prepare('SELECT uid, source_name, fund_size_cents FROM research_fund_directory ORDER BY uid').all() as any[]).map((r) => ({ ...r }));
  assert.deepEqual(after, before);
  assert.equal(served(), 1966);
});
