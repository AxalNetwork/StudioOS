import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('fund directory cards open public catalog profiles and private fund rows open dossiers', () => {
  const funds = read('pages/research/FundsZone.jsx');
  const router = read('App.jsx');
  assert.match(funds, /research\/funds\/catalog/);
  assert.match(funds, /role="link"/);
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
  assert.match(directory, /research\/companies\/company/);
  assert.match(directory, /role="link"/);
  assert.match(profile, /Company intelligence/);
  assert.match(profile, /Funding/);
  assert.match(profile, /Evidence required/);
});
