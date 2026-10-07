import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const page = readFileSync('frontend/src/pages/research/FundsZone.jsx', 'utf8');
const directory = readFileSync('frontend/src/pages/research/FundDirectory.jsx', 'utf8');
const M378 = readFileSync('cloudflare-worker/sql/migrations/378_research_fund_directory_rebuild.sql', 'utf8');

/** The directory rows migration 378 writes: uid, name and the list each came from. */
function rowsOf378() {
  const head = 'INSERT OR REPLACE INTO research_fund_directory (uid,name,website,linkedin,hq,fund_number,fund_size_cents,fund_date,quarter,fund_year,sector_focus,notable_lps,eif_flag,eifo_flag,source_name,source_url,as_of) VALUES (';
  const rows = [];
  for (const line of M378.split('\n')) {
    if (!line.startsWith(head)) continue;
    // Each value is a quoted string, a number or NULL; '' is an escaped quote.
    const values = line.slice(head.length).match(/'(?:[^']|'')*'|NULL|-?\d+(?:\.\d+)?/g) || [];
    const text = (v) => (v && v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : null);
    rows.push({ uid: text(values[0]), name: text(values[1]), source_name: text(values[14]), source_url: text(values[15]) });
  }
  return rows;
}

test('the fund directory is D1\'s, rebuilt by migration 378, every row named and cited', () => {
  // #1077 gap 3 (D535, 2026-10-07): the bundled `fundDirectory.json` is gone.
  // What it held is migration 378's rows, which the Worker serves.
  const rows = rowsOf378();
  assert.equal(rows.length, 2616, 'migration 378 writes 2,616 directory rows');
  assert.equal(new Set(rows.map((r) => r.uid)).size, rows.length, 'uids are unique');
  for (const r of rows) {
    assert.ok(r.uid && r.name, `a row with no uid or name: ${JSON.stringify(r)}`);
    assert.ok(r.source_name && /^https:\/\//.test(r.source_url || ''), `a row with no cited list: ${r.uid}`);
  }
  assert.deepEqual(
    [...new Set(rows.map((r) => r.source_name))].sort(),
    ['Deep Tech Investors Mapping (public spreadsheet)', 'EuroTech VC Funds (public spreadsheet)'],
  );
});

test('the bundle and the two scripts that wrote it are gone, and nothing reads them', () => {
  for (const f of ['frontend/src/data/fundDirectory.json', 'scripts/build-fund-directory.py', 'scripts/import-eurotech-funds.py']) {
    assert.equal(existsSync(f), false, `${f} is back`);
  }
  assert.doesNotMatch(readFileSync('scripts/import-research-funds.py', 'utf8'), /fundDirectory\.json/,
    'the importer that rebuilt 378 reads the spreadsheets, never the bundle');
});

test('the directory is read from the Worker, and its rows are added to the private shortlist explicitly', () => {
  // D535 steps 4–5: the page filtered the bundled file in the browser, 48 rows
  // at a time. The directory now comes from the Worker, paged.
  assert.doesNotMatch(page, /data\/fundDirectory\.json/, 'FundsZone still reads the bundled catalog');
  assert.doesNotMatch(directory, /data\/fundDirectory\.json/, 'FundDirectory still reads the bundled catalog');
  assert.match(directory, /researchFundsApi\.list\(toParams\(query\)\)/);
  assert.match(page, /<FundDirectory researchedNames=\{researchedNames\} onAdd=\{addDirectoryFund\}/);
  assert.match(page, /fundCreate\(\{ name: fund\.name, source_url: fund\.website \|\| null \}\)/);
  // D593: the canvas's F0 names the button "Add to my funds".
  assert.match(directory, /'Add to my funds'/);
});
