import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('fund directory cards open public catalog profiles and private fund rows open dossiers', () => {
  // D535 steps 4–5: the directory moved to FundDirectory.jsx; a row opens the
  // canvas's drawer, and the drawer links to the catalog profile.
  const funds = read('pages/research/FundDirectory.jsx');
  const router = read('App.jsx');
  assert.match(funds, /to=\{`\/research\/funds\/catalog\/\$\{encodeURIComponent\(item\.uid\)\}`\}/);
  assert.match(funds, /aria-controls="fd-drawer"/);
  assert.match(router, /research\/funds\/catalog\/:id/);
  assert.match(router, /research\/funds\/:uid/);
});

test('fund dossier exposes source-backed quarterly reports rather than placeholder charts', () => {
  const panel = read('pages/research/FundReportsPanel.jsx');
  const api = read('lib/api.js');
  const migration = readFileSync(new URL('../../cloudflare-worker/sql/migrations/230_research_fund_reports.sql', import.meta.url), 'utf8');
  assert.match(panel, /At least two sourced quarterly observations/);
  assert.match(panel, /source_url/);
  assert.match(api, /fundReports/);
  assert.match(migration, /quarterly_return_bps/);
  assert.match(migration, /UNIQUE \(fund_uid, owner_user_id, period\)/);
});

test('company records navigate from the full row and profiles separate identity from diligence', () => {
  const directory = read('pages/research/CompanyDirectoryZone.jsx');
  const profile = read('pages/research/CompanyProfile.jsx');
  // D593 moved `companyHref` into the directory's view helpers, so the
  // analysis and competitor pages can link a profile without loading the zone.
  const view = read('lib/companyDirectoryView.js');
  assert.match(view, /export const companyHref = \(uid\) => `\/research\/companies\/company\/\$\{encodeURIComponent\(uid\)\}`;/);
  assert.match(directory, /onClick=\{\(\) => navigate\(companyHref\(x\.uid\)\)\}/);
  assert.match(directory, /role="link"/);
  // D534 (#1079): the profile is built to the Research · Company canvas. Each
  // metric shows its source and date or Not recorded. D7180 (D7046 option A):
  // the directory record's stored diligence status names no analysis, so the
  // profile no longer prints it; nothing infers one either.
  assert.match(profile, /<KeyMetrics /);
  assert.match(read('pages/research/companyProfileRead.js'), /title: 'Funding total'/);
  assert.doesNotMatch(profile, /Diligence status|diligence_status/);
});
