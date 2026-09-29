import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('frontend/src/pages/research/FundsZone.jsx', 'utf8');
const catalog = JSON.parse(readFileSync('frontend/src/data/fundDirectory.json', 'utf8'));


test('the fund directory is a substantial source-backed catalog, not placeholder rows', () => {
  assert.ok(Array.isArray(catalog.items));
  assert.ok(catalog.items.length >= 2000, `expected at least 2,000 deduplicated fund records, got ${catalog.items.length}`);
  assert.ok(catalog.generated_at, 'the catalog must carry a generated date');
  assert.equal(new Set(catalog.items.map((item) => item.id)).size, catalog.items.length, 'catalog ids must be unique');
  for (const item of catalog.items.slice(0, 50)) {
    assert.ok(item.name, 'every catalog row needs a name');
    assert.ok(item.source_label, 'every catalog row needs provenance');
    assert.ok(Array.isArray(item.sectors));
    assert.ok(Array.isArray(item.stages));
    assert.ok(Array.isArray(item.regions));
  }
});


test('the page lazy-loads the catalog and adds rows to the private shortlist explicitly', () => {
  assert.match(page, /import\('\.\.\/\.\.\/data\/fundDirectory\.json'\)/);
  assert.match(page, /Fund directory/);
  assert.match(page, /Add a row to your private research list/);
  assert.match(page, /fundCreate\(\{ name: fund\.name, source_url: fund\.website \|\| null \}\)/);
  assert.match(page, /Source: attached public mapping exports/);
  assert.match(page, /Records are not endorsements/);
});
