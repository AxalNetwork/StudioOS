// D1016 (#2853, part 1 of #2432) — the old simulator's faults that reached
// founders until part 14. D1029 (#2866) deleted the simulator (`CapTablePage`)
// and the Capital workspace's Cap Table tab, so what stays pinned here is the
// workspace's tab query. The holder record's "Model a round" is the Worker's
// (`cloudflare-worker/test/cycle_records_raise_d691.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tabHref } from '../src/pages/CapitalWorkspacePage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the Capital tabs keep the venture and nothing else', () => {
  assert.equal(tabHref('/raise/capital/model', '?project=7'), '/raise/capital/model?project=7');
  assert.equal(tabHref('/raise/capital/pipeline', '?project_id=7&tab=x#y'), '/raise/capital/pipeline?project_id=7');
  assert.equal(tabHref('/raise/capital/pipeline', '?project=7&project_id=7'), '/raise/capital/pipeline?project=7&project_id=7');
  assert.equal(tabHref('/raise/capital/model', ''), '/raise/capital/model');
  assert.equal(tabHref('/raise/capital/model', '?other=1'), '/raise/capital/model');
  assert.match(read('../src/pages/CapitalWorkspacePage.jsx'), /navigate\(tabHref\(t\.to, location\.search\)\)/);
});

test('D1029: the old simulator is gone, and Capital has no Cap Table tab', () => {
  assert.equal(existsSync(new URL('../src/pages/CapTablePage.jsx', import.meta.url)), false);
  const ws = read('../src/pages/CapitalWorkspacePage.jsx');
  assert.doesNotMatch(codeOnly(ws), /CapTablePage|'cap-table'|\/raise\/capital\/cap-table/);
});
