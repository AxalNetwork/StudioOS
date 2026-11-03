// D4152 (#4152) — Settings, simplified: one sidebar entry, one header and one
// General form per company, no internal path, no "Coming later", no app
// explanations, and no Legal for a standalone project.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/settings_simplified_d4152.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  FIELDS, LEAVE_PROMPT, canEditCompany, changes, formOf, problemOf, readOnlyLine, regionsOf, regionsText, unsavedLine,
} from '../src/pages/account/companies/generalFormModel.js';
import { SettingsHead } from '../src/pages/account/companies/CompanySettingsTabs.jsx';
import { scopeFor, settingsEntry } from '../src/lib/settingsScope.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const ROW = { uid: 'acme', company_name: 'Acme', stage: 'seed', website: 'acme.example', linkedin_url: null, international_presence: 'Europe, North America', description: 'Scheduling software.', members: [{ user_id: 3, role_in_company: 'Owner', is_primary_admin: true }, { user_id: 4, role_in_company: 'CTO', is_primary_admin: false }] };

test('one General form: only what changed is saved, trimmed, an empty field as null', () => {
  const form = formOf(ROW);
  assert.equal(form.linkedin_url, '', 'an absent value is empty inside a form, never "Not recorded"');
  assert.deepEqual(changes(form, ROW), {});
  assert.deepEqual(changes({ ...form, company_name: '  Acme Field ' }, ROW), { company_name: 'Acme Field' });
  assert.deepEqual(changes({ ...form, website: '' }, ROW), { website: null });
  assert.deepEqual(changes({ ...form, international_presence: 'Europe ,North America' }, ROW), {}, 'the same regions are no change');
  assert.deepEqual(changes({ ...form, employee_count: '12' }, ROW), { employee_count: 12 });
  assert.equal(unsavedLine({ a: 1 }), '1 unsaved change');
  assert.equal(unsavedLine({}), null);
  assert.ok(FIELDS.includes('description') && !FIELDS.includes('logo_url'), 'the logo is a tile, never a URL field (#4201)');
});

test('the form refuses a blank name and a non-whole employee count; regions are chips over one column', () => {
  assert.equal(problemOf({ ...formOf(ROW), company_name: '  ' }), 'Enter a company name.');
  assert.equal(problemOf({ ...formOf(ROW), employee_count: '2.5' }), 'Employee count is a whole number.');
  assert.equal(problemOf(formOf(ROW)), null);
  assert.deepEqual(regionsOf('Europe, North America,,'), ['Europe', 'North America']);
  assert.equal(regionsText(['Europe', 'Europe', ' APAC ']), 'Europe, APAC');
});

test('who may edit mirrors the route: platform admin, primary admin, Owner, Admin or Founder; a title is not a role', () => {
  assert.equal(canEditCompany(ROW, { id: 3, role: 'founder' }), true);
  assert.equal(canEditCompany(ROW, { id: 4, role: 'founder' }), false, 'a CTO title edits nothing');
  assert.equal(canEditCompany(ROW, { id: 9, role: 'admin' }), true);
  assert.equal(readOnlyLine('Acme'), 'Only Owners, Admins and Founders of Acme can edit these settings.');
  assert.match(LEAVE_PROMPT, /^Leave without saving\?/);
});

test('one header: the mark, the name, a "Settings" eyebrow and four tabs; no internal path, no back banner', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/portfolio/acme/settings'] }, h(SettingsHead, { uid: 'acme', name: 'Acme', tab: 'general' })));
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.deepEqual([...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Team', 'General', 'Legal', 'Projects']);
  assert.match(html, /href="\/account\/companies\/acme\/settings\/team"/);
  assert.doesNotMatch(html, /\/c\/|‹ Acme/);
});

test('the page draws one header and one form, never the old page under the tabs', () => {
  const at = codeOnly(read('pages/account/companies/CompanySettingsAt.jsx'));
  const withUid = at.slice(at.indexOf('data-testid="company-settings-general"'));
  assert.equal((withUid.match(/<SettingsHead /g) || []).length, 1);
  assert.equal((withUid.match(/<CompanyGeneralForm /g) || []).length, 1);
  assert.doesNotMatch(withUid, /<CompanySettingsPage|GeneralCard/);
  const tabs = codeOnly(read('pages/account/companies/CompanySettingsTabs.jsx'));
  const form = codeOnly(read('pages/account/companies/CompanyGeneralForm.jsx'));
  for (const [name, src] of [['tabs', tabs], ['form', form], ['at', at]]) {
    assert.doesNotMatch(src, /Coming later|A company is a legal entity|This sidebar is scoped|SlugChip|Logo URL/, name);
  }
  assert.match(form, /api\.updateCompany\(uid, patch\)/, 'one save, with only what changed');
});

test('a standalone project has no Legal anywhere; the Settings entry opens Project settings', () => {
  const solo = scopeFor({ project: { id: 9, name: 'Pilot app', company: null } });
  assert.equal(settingsEntry(solo).path, '/projects/9/settings');
  assert.doesNotMatch(JSON.stringify(solo.entries), /Legal|legal/);
  assert.doesNotMatch(codeOnly(read('pages/team/ProjectSettingsPage.jsx')), /companyLegalPath|>Legal</);
});
