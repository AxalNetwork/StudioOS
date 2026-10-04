/**
 * D534 (#1079) — the company directory pages on the server, so the market
 * sector card's "Open company directory (N matched)" must count every match
 * (`total`), not the rows on the page it asked for (limit 24).
 *
 * The Worker half is pinned in cloudflare-worker/test/research_company_directory_d534.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryPage } from '../src/lib/companyDirectoryPage.js';

test('the count is the server total, not the page length', () => {
  const items = Array.from({ length: 24 }, (_, k) => ({ uid: `c${k}` }));
  assert.deepEqual(directoryPage({ items, total: 251 }).total, 251);
  assert.equal(directoryPage({ items, total: 251 }).items.length, 24);
});

test('a response without a total (an older Worker) falls back to the rows it has', () => {
  assert.equal(directoryPage({ items: [{ uid: 'a' }, { uid: 'b' }] }).total, 2);
  assert.equal(directoryPage({ items: [{ uid: 'a' }], total: 0 }).total, 1, 'a total below the rows shown is never believed');
  assert.deepEqual(directoryPage(null), { items: [], total: 0 });
});
