// D1497 (#3727, TM1e–TM1i) — who governs a Team page, and what the sidebar's
// bottom block reads: "Company settings" (Team · Company settings · Projects)
// in a company or a project inside one; "Project settings" (Team · Project
// settings) in a standalone project, which has no Legal entry anywhere.
// Every name is the canvas's own sample, used here as a fixture only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/settings_scope_d1497.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import SidebarNav, { SettingsScopeBlock } from '../src/ui/SidebarNav.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import {
  BILLING_PATH, COMPANY_SETTINGS, PROJECT_SETTINGS, entryLabels, fromSettingsScope, projectCompany, projectsOfCompany, publishScope, readSettingsScope, scopeFor,
} from '../src/lib/settingsScope.js';
import { renderedText } from './_renderedText.mjs';

const h = React.createElement;
const NORTHWIND = { uid: 'nw1', company_name: '[Northwind Labs]' };

test('a company: "Company settings" with Team, Company settings (General, Legal) and Projects', () => {
  const s = scopeFor({ company: NORTHWIND });
  assert.equal(s.kind, 'company');
  assert.equal(s.label, COMPANY_SETTINGS);
  assert.equal(s.team, '/account/companies/nw1/settings/team');
  assert.deepEqual(s.entries.map((e) => e.label), ['Team', 'Company settings', 'Projects']);
  assert.deepEqual(entryLabels(s), ['Team', 'Company settings', 'General', 'Legal', 'Projects']);
  const legal = s.entries[1].children.find((c) => c.key === 'legal');
  assert.equal(legal.path, null, 'Legal has no page on this base, so it is not a link');
  assert.match(legal.reason, /not open yet/);
});

test('a project inside a company is governed by it: the company\'s block, with the project under Projects', () => {
  const s = scopeFor({ company: { uid: 'other', company_name: 'Somewhere else' }, project: { id: 7, name: '[Atlas Pilot]', company: { uid: 'nw1', name: '[Northwind Labs]' } } });
  assert.equal(s.kind, 'company_project');
  assert.equal(s.label, COMPANY_SETTINGS, 'the project page names its own company, whichever is active');
  assert.equal(s.eyebrow, 'Project · in [Northwind Labs]');
  assert.equal(s.team, '/account/companies/nw1/settings/projects/7/team');
  assert.deepEqual(entryLabels(s), ['Team', 'Company settings', 'General', 'Legal', 'Projects', '[Atlas Pilot]', 'Team', 'Settings']);
  // A company this account cannot name still governs: never drawn as standalone.
  const unnamed = scopeFor({ project: { id: 7, name: '[Atlas Pilot]', company: { uid: null } } });
  assert.equal(unnamed.kind, 'company_project');
  assert.equal(unnamed.label, COMPANY_SETTINGS);
});

test('a standalone project: "Project settings" with Team and Project settings, and no Legal anywhere', () => {
  const s = scopeFor({ company: NORTHWIND, project: { id: 9, name: '[Lantern]', company: null } });
  assert.equal(s.kind, 'project');
  assert.equal(s.label, PROJECT_SETTINGS);
  assert.equal(s.eyebrow, 'Project');
  assert.deepEqual(entryLabels(s), ['Team', 'Project settings', 'General']);
  assert.ok(!JSON.stringify(s).includes('Legal'), 'a standalone project is not a legal entity');
  assert.equal(s.team, '/projects/9/settings/team');
  assert.equal(scopeFor({}), null, 'nothing in view, no block');
  assert.ok(!entryLabels(scopeFor({ company: NORTHWIND })).some((l) => /Billing/.test(l)), 'Billing is not in the block');
});

test('#3697 part 2\'s answer maps onto the same shape, and the seam is closed until it exists', async () => {
  const answer = {
    scope: 'company_project', label: 'Company settings', company: { uid: 'nw1', name: '[Northwind Labs]' }, project: { id: 7, name: '[Atlas Pilot]' },
    company_editors: [{ uid: 'u2', name: '[Jordan Reyes]', role_in_company: 'Admin' }], my_authority: 'editor',
  };
  const s = fromSettingsScope(answer);
  assert.equal(s.kind, 'company_project');
  assert.deepEqual(entryLabels(s), entryLabels(scopeFor({ project: { id: 7, name: '[Atlas Pilot]', company: { uid: 'nw1', name: '[Northwind Labs]' } } })));
  assert.deepEqual(s.companyEditors, { available: true, value: [{ uid: 'u2', name: '[Jordan Reyes]', role: 'Admin' }] });
  const solo = fromSettingsScope({ scope: 'project', company: null, project: { id: 9, name: '[Lantern]' } });
  assert.equal(solo.label, PROJECT_SETTINGS);
  assert.ok(!entryLabels(solo).includes('Legal'));
  assert.deepEqual(solo.companyEditors, { available: false });
  assert.equal((await readSettingsScope()).available, false);
});

function sidebar(company) {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/studio'] },
    h(ActiveCompanyContext.Provider, { value: { company, setCompany() {}, companies: company ? [company] : [], setCompanies() {} } },
      h(SidebarNav, { groups: [], role: 'founder', user: { role: 'founder' } }))));
}

test('the sidebar draws the block by scope, keeps "Companies and projects", and Billing is a link under it', () => {
  const co = sidebar(NORTHWIND);
  const text = renderedText(co);
  assert.match(co, /data-testid="settings-scope-block" data-scope="company"/);
  assert.match(co, /data-testid="settings-scope-label">Company settings</);
  assert.match(co, /href="\/account\/companies\/nw1\/settings\/team"/);
  assert.match(co, /aria-disabled="true" title="The company’s Legal page is not open yet\."/);
  assert.match(text, /Companies and projects/);
  assert.match(co, /data-testid="settings-scope-billing"[^>]*>Billing · in Account/);
  assert.match(co, new RegExp(`data-testid="settings-scope-billing"[^>]*href="${BILLING_PATH}"`));
  assert.match(co, /data-testid="settings-scope-billing-pending">pending owner</, 'Billing\'s place is the owner\'s call');
  assert.doesNotMatch(co, /scope-row-billing/, 'Billing is never one of the block\'s rows');

  publishScope(scopeFor({ project: { id: 9, name: '[Lantern]', company: null } }));
  try {
    const solo = sidebar(NORTHWIND);
    assert.match(solo, /data-scope="project"/);
    assert.match(solo, /data-testid="settings-scope-label">Project settings</);
    assert.doesNotMatch(renderedText(solo), /Legal/, 'no Legal entry in a standalone project');
    assert.match(solo, /href="\/projects\/9\/settings\/team"/);
  } finally { publishScope(null); }

  assert.doesNotMatch(sidebar(null), /settings-scope-block/, 'no company and no project: the block is not drawn');
});

// ---------------------------------------------------------------- review fixes

const ATLAS = { id: 7, name: '[Atlas Pilot]', company: { uid: 'nw1', name: '[Northwind Labs]' } };
const ROWS = [
  { id: 7, name: '[Atlas Pilot]', company_uid: 'nw1', company_name: '[Northwind Labs]' },
  { id: 8, name: '[Orbit]', company_uid: 'nw1', company_name: '[Northwind Labs]' },
  { id: 9, name: '[Lantern]', company_uid: null },
];

test('Projects lists every project of the company, the one in view with its Team and Settings', () => {
  const projects = projectsOfCompany(ROWS, 'nw1');
  assert.deepEqual(projects, [{ id: 7, name: '[Atlas Pilot]' }, { id: 8, name: '[Orbit]' }]);
  const co = scopeFor({ company: { uid: 'nw1', name: '[Northwind Labs]' }, projects });
  assert.deepEqual(entryLabels(co), ['Team', 'Company settings', 'General', 'Legal', 'Projects', '[Atlas Pilot]', '[Orbit]']);
  assert.equal(co.entries[2].count, 2);
  assert.equal(co.entries[2].children[1].path, '/account/companies/nw1/settings/projects/8/team');
  const inView = scopeFor({ project: ATLAS, projects });
  assert.deepEqual(entryLabels(inView), ['Team', 'Company settings', 'General', 'Legal', 'Projects', '[Atlas Pilot]', 'Team', 'Settings', '[Orbit]']);
  assert.equal(projectsOfCompany(null, 'nw1'), null, 'an unread list is not "none"');
  assert.equal(scopeFor({ company: { uid: 'nw1', name: 'x' } }).entries[2].count, null);
});

test('projectCompany: the read\'s company, else the switcher\'s, else governed but unnamed; none for a standalone', () => {
  assert.deepEqual(projectCompany({ company_id: 9 }, { row: ROWS[0] }), { uid: 'nw1', name: '[Northwind Labs]' });
  assert.deepEqual(projectCompany({ company_id: 9 }, { companies: [{ id: 9, uid: 'nw1', company_name: '[Northwind Labs]' }] }), { uid: 'nw1', name: '[Northwind Labs]' });
  assert.deepEqual(projectCompany({ company_id: 9 }, {}), { uid: null, name: null });
  assert.equal(projectCompany({ company_id: null }, { companies: [{ id: 9, uid: 'nw1' }] }), null);
});

const block = (props) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/companies/nw1/settings'] }, h(SettingsScopeBlock, props)));

test('one page lights one row: "Company settings" is the label of General, not a second link to it', () => {
  const html = block({ scope: scopeFor({ company: { uid: 'nw1', name: 'x' } }), drawer: false, activeUid: 'nw1' });
  assert.equal((html.match(/href="\/account\/companies\/nw1\/settings"/g) || []).length, 1, 'only General links to the settings page');
  assert.match(html, /<span class="[^"]*" data-testid="scope-row-company">/);
  assert.match(html, /max-h-\[38vh\] overflow-y-auto/, 'the block scrolls on its own on a desktop');
});

test('the phone drawer: one row per entry, its sub-label right-aligned, no children (TM1i)', () => {
  const projects = projectsOfCompany(ROWS, 'nw1');
  const html = block({ scope: scopeFor({ company: { uid: 'nw1', name: 'x' }, projects }), drawer: true, activeUid: 'nw1' });
  const text = renderedText(html);
  assert.match(html, /data-form="drawer"/);
  assert.match(text, /Company settingsGeneral · Legal/);
  assert.match(text, /Projects\[2\]/);
  assert.doesNotMatch(html, /scope-row-general|scope-row-legal|scope-row-project-7/, 'children are hidden in the drawer');
});

test('Company settings for a company not active here is off with its reason, never a dead end', () => {
  const html = block({ scope: scopeFor({ company: { uid: 'nw1', name: 'x' } }), drawer: false, activeUid: 'other' });
  assert.doesNotMatch(html, /href="\/account\/companies\/nw1\/settings"/);
  assert.match(html, /data-testid="scope-row-general"[^>]*>|aria-disabled="true" title="Full company settings open for the company active on this device/);
  assert.match(html, /title="Full company settings open for the company active on this device\. Make it active from its page\."/);
  assert.match(html, /href="\/account\/companies\/nw1\/settings\/team"/, 'Team serves any company');
});

test('the collapsed block\'s links are named in full for a screen reader', () => {
  const html = block({ scope: scopeFor({ company: { uid: 'nw1', name: 'x' } }), collapsed: true, activeUid: 'nw1' });
  assert.match(html, /aria-label="Company settings · Team"/);
  assert.match(html, /aria-label="Company settings"/);
  assert.match(html, /<span class="[^"]*" aria-hidden="true">Set\.<\/span>/);
});

test('the project page publishes its own scope, so a standalone project reads "Project settings" there too', () => {
  const src = readFileSync('frontend/src/pages/ProjectDetail.jsx', 'utf8');
  assert.match(src, /usePublishScope\(project && project\.id != null \? scopeFor\(\{ project: \{ id: project\.id, name: project\.name, company: projectCompany\(project, \{ companies \}\) \} \}\) : null\)/);
  publishScope(scopeFor({ project: { id: 9, name: '[Lantern]', company: projectCompany({ company_id: null }, {}) } }));
  try {
    assert.match(sidebar(NORTHWIND), /data-testid="settings-scope-label">Project settings</, 'not the active company\'s block');
  } finally { publishScope(null); }
});
