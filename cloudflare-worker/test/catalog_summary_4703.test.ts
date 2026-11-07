/**
 * D4703 (#4703) part 3: the catalog mirror summary says whether it is the
 * whole mirror, when it was read, and how many "active" prices sit under an
 * archived product and so cannot be bought.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readCatalogMirrorSummary } from '../src/services/catalog.ts';
import { d1Over } from './_d1_sqlite.mjs';

test('the summary separates prices that cannot be bought, and says when it is incomplete', async () => {
  // Mutation checked: the archived-product check dropped → active_under_inactive_products reads 0.
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, active INTEGER, prices_json TEXT, synced_at TEXT);
    INSERT INTO stripe_products VALUES
      ('prod_live', 1, '[{"id":"price_a","active":true},{"id":"price_b","active":false}]', '2026-11-07T08:00:00Z'),
      ('prod_archived', 0, '[{"id":"price_c","active":true}]', '2026-11-06 08:00:00');`);
  const whole: any = await readCatalogMirrorSummary({ DB: d1Over(db) } as any);
  assert.deepEqual(whole.prices, { all: 3, active: 2, active_under_inactive_products: 1 });
  assert.equal(whole.complete, true);
  assert.match(whole.read_at, /^\d{4}-\d{2}-\d{2}T/);
  db.exec(`INSERT INTO stripe_products VALUES ('prod_bad', 1, 'not json', '2026-11-05 08:00:00')`);
  const part: any = await readCatalogMirrorSummary({ DB: d1Over(db) } as any);
  assert.deepEqual([part.complete, part.unreadable_price_rows], [false, 1]);
});
