// D1134 (#2422) — Account › Companies and projects: the section, its address
// and the canvas. The pane's behaviour is D1138's (#3018) and is tested in
// companies_projects_d1138.test.mjs.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/companies_projects_d1134.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PATH_TO_SECTION, accountIndexGroups } from '../src/pages/account/accountPhone.js';

const read = (path) => readFileSync(path, 'utf8');

test('the section is second in Account, at /account/portfolio, with its phone index row', () => {
  const page = read('frontend/src/pages/SettingsPage.jsx');
  const block = page.slice(page.indexOf('const SECTIONS = ['), page.indexOf('];', page.indexOf('const SECTIONS = [')));
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 2), ['Profile and identity', 'Companies and projects']);
  // D1140 (#3020) passes "Your companies" (the KYB entity records) in as entityRecords.
  // The account's signing entity sits beside its companies (owner, 2026-10-28).
  assert.ok(page.includes("{safeActive === 'companies' && <CompaniesProjects role={role} entityRecords={<><YourCompaniesSection flash={flash} /><CorporateEntityCard flash={flash} /></>} />}"));
  assert.equal(PATH_TO_SECTION.companies, 'companies');
  const rows = accountIndexGroups({ role: 'founder' })[0].rows.map((r) => [r.title, r.to]);
  assert.deepEqual(rows.slice(0, 2), [['Profile and identity', '/account/profile'], ['Companies and projects', '/account/portfolio']]);
});

test('the canvas and decision are in', () => {
  for (const f of ['Companies Projects Page.dc.html', 'Companies and projects · Boards.dc.html']) {
    const s = read(`design/incoming/${f}`);
    assert.ok(s.includes('src="./support.js"'), f); // the runtime is the shared support.js, not inlined
  }
  assert.ok(read('design/incoming/Companies and projects · Boards.dc.html').includes('dc-import name="Companies Projects Page"'));
  assert.ok(read('design/incoming/Companies and projects · Boards.dc.html').includes('CMP19'));
  assert.ok(existsSync('documentation/architecture/decisions/D1134.md'));
});
