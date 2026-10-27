// D1016 (#2853, part 1 of #2432) — the old simulator's faults that reached
// founders until part 14. D1029 (#2866) deleted the simulator (`CapTablePage`)
// and the Capital workspace's Cap Table tab, so what stays pinned here is the
// workspace's tab query. The holder record's "Model a round" is the Worker's
// (`cloudflare-worker/test/cycle_records_raise_d691.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('the Capital workspace is gone, so its tab query lives on the moved redirects', () => {
  // D1180 deleted the page after D1194 forwarded Pipeline. Venture keeping is
  // pinned on CapTableMovedRedirect, UseOfFundsMovedRedirect and capRelMovedTo.
  assert.equal(existsSync(new URL('../src/pages/CapitalWorkspacePage.jsx', import.meta.url)), false);
});

test('D1029: the old simulator is gone, and Capital has no Cap Table tab', () => {
  assert.equal(existsSync(new URL('../src/pages/CapTablePage.jsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/pages/CapitalWorkspacePage.jsx', import.meta.url)), false);
});
