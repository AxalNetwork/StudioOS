/**
 * D4964 (#4964) — Company settings: one shared company read, a canonical project address, accessible controls, and
 * structured matching fields.
 *
 * What is pinned:
 *   - the detail store makes one read however many subscribers start it, `reload` is one refetch, and a published
 *     row reaches every subscriber; the General page's head and form both read through it and nothing else;
 *   - `chooseProject`: no id redirects to the first project; an unknown id is not found, never the first project;
 *   - the logo tile is a button only when it does something; read-only it has no pointer;
 *   - region codes, revenue bands, links, the count and prose use controls fitting their data; the form saves codes
 *     as a list and checks a changed link the way the Worker does.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_settings_reads_4964.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCompanyDetail, publishCompanyDetail, resetCompanyDetails } from '../src/pages/account/companies/useCompanyDetail.js';
import { chooseProject } from '../src/pages/account/companies/CompanySettingsTabs.jsx';
import { LogoTile } from '../src/pages/account/companies/CompanyGeneralForm.jsx';
import { changes, formOf, problemOf, profileUrlOk, REGION_CODES, regionCodesIn } from '../src/pages/account/companies/generalFormModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8');

test('one read however many subscribers start it; reload is one more; a published row replaces it', async () => {
  resetCompanyDetails();
  let calls = 0;
  let release;
  const reader = () => { calls += 1; return new Promise((r) => { release = r; }); };
  const a = loadCompanyDetail('co-1', reader);
  const b = loadCompanyDetail('co-1', reader);
  assert.equal(a, b, 'the second start joins the first');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  release({ available: true, value: { uid: 'co-1', company_name: 'Northwind' } });
  const state = await a;
  assert.deepEqual([calls, state.status, state.row.company_name], [1, 'ready', 'Northwind']);
  const again = loadCompanyDetail('co-1', reader);
  await tick();
  release({ available: false, notFound: true });
  assert.deepEqual(await again, { status: 'notFound', row: null });
  assert.equal(calls, 2);
  publishCompanyDetail('co-1', { uid: 'co-1', company_name: 'Saved' });
  const fail = loadCompanyDetail('co-1', () => Promise.reject(new Error('down')));
  assert.equal((await fail).status, 'error', 'a failed read is an error, never a stale ready');
  resetCompanyDetails();
});

test('the General page reads the company once: the head and the form share the store, and neither reads on its own', () => {
  const at = read('pages/account/companies/CompanySettingsAt.jsx');
  const form = read('pages/account/companies/CompanyGeneralForm.jsx');
  assert.match(at, /const detail = useCompanyDetail\(uid\);/);
  assert.match(form, /const detail = useCompanyDetail\(uid,/);
  for (const [name, src] of [['at', at], ['form', form]]) assert.doesNotMatch(src, /teamsApi\.getCompany/, `${name} reads the company itself`);
  assert.match(form, /detail\.setRow\(next\.row\)/, 'a save publishes its answer to the head too');
  assert.match(form, /typeof row\?\.viewer_can_edit === 'boolean'/, 'the edit capability is the server\'s answer');
});

test('chooseProject: no id redirects to the first; an unknown id is not found, never the first project', () => {
  const kids = [{ id: '7', name: 'Alpha' }, { id: '9', name: 'Beta' }];
  assert.deepEqual(chooseProject(kids, undefined), { asked: null, chosen: null, redirectTo: '7', notFound: false });
  assert.deepEqual(chooseProject(kids, '9'), { asked: '9', chosen: kids[1], redirectTo: null, notFound: false });
  assert.deepEqual(chooseProject(kids, '42'), { asked: '42', chosen: null, redirectTo: null, notFound: true });
  assert.deepEqual(chooseProject([], undefined), { asked: null, chosen: null, redirectTo: null, notFound: false });
  const tabs = read('pages/account/companies/CompanySettingsTabs.jsx');
  assert.doesNotMatch(tabs, /\|\| children\[0\]/, 'no fallback to the first project');
  assert.match(tabs, /testId="company-project-not-found"/);
});

test('the logo tile is a button only when it does something; read-only it is the mark alone', () => {
  const props = { name: 'Northwind', row: { logo_url: null }, pending: null, onPick() {}, onRemove() {}, onUndo() {}, problem: null };
  const live = renderToStaticMarkup(React.createElement(LogoTile, { ...props, disabled: false }));
  assert.match(live, /<button type="button" data-testid="company-logo-tile" aria-label="Upload a logo"[^>]*cursor-pointer/);
  const ro = renderToStaticMarkup(React.createElement(LogoTile, { ...props, disabled: true }));
  assert.match(ro, /<div data-testid="company-logo-tile"/);
  assert.doesNotMatch(ro.slice(0, ro.indexOf('company-logo-tile') + 200), /cursor-pointer/);
});

test('matching fields: codes as a list, a changed link checked as the Worker does, legacy values left alone', () => {
  const row = { company_name: 'N', region_codes: ['uk_ireland', 'nope'], website: 'legacy.example', revenue_range: '£1m-ish' };
  const form = formOf(row);
  assert.deepEqual(form.region_codes, ['uk_ireland'], 'unknown codes never enter the form');
  assert.deepEqual(changes(form, row), {});
  assert.deepEqual(changes({ ...form, region_codes: ['oceania', 'uk_ireland', 'oceania'] }, row), { region_codes: ['uk_ireland', 'oceania'] });
  assert.deepEqual(regionCodesIn(['oceania', 'global']), ['global', 'oceania']);
  assert.ok(REGION_CODES.includes('global'));
  assert.equal(problemOf(form, row), null, 'a legacy link the editor did not touch blocks nothing');
  assert.match(problemOf({ ...form, website: 'northwind' }, row), /https:\/\//);
  assert.match(problemOf({ ...form, linkedin_url: 'https://example.com/x' }, row), /LinkedIn/);
  assert.match(problemOf({ ...form, current_products: 'x'.repeat(501) }, row), /at most 500/);
  assert.equal(profileUrlOk('https://www.linkedin.com/company/x', { linkedin: true }), true);
  const src = read('pages/account/companies/CompanyGeneralForm.jsx');
  // D4966 (#5312): the two link fields are `UrlField` now, in `CompanyGeneralFields.jsx`.
  assert.match(src, /<UrlField field=\{f\}/);
  assert.match(read('pages/account/companies/CompanyGeneralFields.jsx'), /type="url"/);
  assert.match(src, /type="number" min=\{0\} step=\{1\}/);
  assert.match(src, /<fieldset[^>]*data-testid="general-regions"/);
  assert.match(src, /data-testid="general-revenue-range"/);
  // D4966 (#5312): every field's label, hint, help and error are `FieldFrame`'s, in one place.
  assert.match(read('pages/account/companies/CompanyGeneralFields.jsx'), /<label htmlFor=\{htmlFor\}/, 'every field label names its control');
  assert.match(src, /<FieldFrame field=\{f\} htmlFor=\{id\} dirty=\{dirty\} error=\{error\}>/, 'and every other field goes through it');
});
