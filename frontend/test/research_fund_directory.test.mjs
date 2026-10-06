import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('frontend/src/pages/research/FundsZone.jsx', 'utf8');
const directory = readFileSync('frontend/src/pages/research/FundDirectory.jsx', 'utf8');
const catalog = JSON.parse(readFileSync('frontend/src/data/fundDirectory.json', 'utf8'));


test('the bundled fund catalog stays a substantial source-backed file, not placeholder rows', () => {
  // D535 steps 4–5: no page reads it any more — the directory is the Worker's —
  // but `scripts/build-fund-directory.py` still writes it, so it keeps its shape.
  assert.ok(Array.isArray(catalog.items));
  assert.ok(catalog.items.length >= 2000, `expected at least 2,000 deduplicated fund records, got ${catalog.items.length}`);
  assert.ok(catalog.generated_at, 'the catalog must carry a generated date');
  assert.equal(new Set(catalog.items.map((item) => item.id)).size, catalog.items.length, 'catalog ids must be unique');
  for (const item of catalog.items.slice(0, 50)) {
    assert.ok(item.name, 'every catalog row needs a name');
    assert.ok(item.source_label, 'every catalog row needs provenance');
  }
});


test('the directory is read from the Worker, and its rows are added to the private shortlist explicitly', () => {
  // D535 steps 4–5: the page filtered the bundled file in the browser, 48 rows
  // at a time. The directory now comes from the Worker, paged.
  assert.doesNotMatch(page, /data\/fundDirectory\.json/, 'FundsZone still reads the bundled catalog');
  assert.doesNotMatch(directory, /data\/fundDirectory\.json/, 'FundDirectory still reads the bundled catalog');
  assert.match(directory, /researchFundsApi\.list\(toParams\(query\)\)/);
  assert.match(page, /<FundDirectory researchedNames=\{researchedNames\} onAdd=\{addDirectoryFund\}/);
  assert.match(page, /fundCreate\(\{ name: fund\.name, source_url: fund\.website \|\| null \}\)/);
  assert.match(directory, /'Add to my list'/);
});
