// D1497 (#3727, TM1e–TM1i) — who governs a Team page and a scope's entries
// ("Company settings": Team · Company settings · Projects; "Project settings"
// for a standalone project, which has no Legal entry anywhere). Since D4152
// (#4152, ST1) the sidebar draws them as ONE "Settings" entry with the scope
// under it; the tabs live on the settings page.
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
  COMPANY_SETTINGS, PROJECT_SETTINGS, entryLabels, settingsActive, settingsEntry, withPortfolioRow, fromSettingsScope, projectCompany, projectsOfCompany, publishScope, readSettingsScope, scopeFor,
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
  assert.deepEqual(entryLabels(s), ['Team', 'Company settings', 'General', 'Legal', 'Compliance', 'Projects']);
  const legal = s.entries[1].children.find((c) => c.key === 'legal');
  // D1413 (#3696, PF6a/PF8): Legal is Company settings › Legal, a page of its own now.
  assert.equal(legal.path, '/account/portfolio/nw1/settings/legal');
  assert.equal(legal.reason, undefined);
  assert.equal(s.entries[2].path, '/account/portfolio/nw1/settings/projects', 'Projects is Company settings › Projects (PF6c)');
});

test('a project inside a company is governed by it: the company\'s block, with the project under Projects', () => {
  const s = scopeFor({ company: { uid: 'other', company_name: 'Somewhere else' }, project: { id: 7, name: '[Atlas Pilot]', company: { uid: 'nw1', name: '[Northwind Labs]' } } });
  assert.equal(s.kind, 'company_project');
  assert.equal(s.label, COMPANY_SETTINGS, 'the project page names its own company, whichever is active');
  assert.equal(s.eyebrow, 'Project · in [Northwind Labs]');
  assert.equal(s.team, '/account/companies/nw1/settings/projects/7/team');
  assert.deepEqual(entryLabels(s), ['Team', 'Company settings', 'General', 'Legal', 'Compliance', 'Projects', '[Atlas Pilot]', 'Team', 'Settings']);
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
  // D1614 CO5 (#3976): and has no compliance anywhere.
  assert.ok(!JSON.stringify(s).includes('Compliance'), 'a standalone project shows Compliance');
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
  assert.ok(!entryLabels(solo).includes('Compliance'));
  assert.deepEqual(solo.companyEditors, { available: false });
  assert.equal((await readSettingsScope()).available, false);
  // #3697 part 2 is on main: the seam reads the route through its client.
  const asked = [];
  const api = { settingsScope: async (q) => { asked.push(q); return { scope: 'project', label: 'Project settings', company: null, project: { id: 9, name: '[Lantern]' } }; } };
  const read = await readSettingsScope({ project: 9, api });
  assert.deepEqual(asked, [{ company: undefined, project: 9 }]);
  assert.equal(read.available, true);
  assert.equal(read.value.label, PROJECT_SETTINGS);
  assert.ok(!entryLabels(read.value).includes('Legal'));
  const broken = await readSettingsScope({ company: 'nw1', api: { settingsScope: async () => { throw new Error('500'); } } });
  assert.equal(broken.available, false);
});

function sidebar(company) {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/studio'] },
    h(ActiveCompanyContext.Provider, { value: { company, setCompany() {}, companies: company ? [company] : [], setCompanies() {} } },
      h(SidebarNav, { groups: [], role: 'founder', user: { role: 'founder' } }))));
}

test('D4152 ST1: the sidebar draws one "Settings" entry with the scope under it; no Billing, no Portfolio in it', () => {
  const co = sidebar(NORTHWIND);
  assert.equal((co.match(/data-testid="settings-entry"/g) || []).length, 1, 'exactly one Settings entry');
  assert.match(co, /data-testid="settings-entry" data-scope="company"/);
  assert.match(co, /data-testid="settings-entry-scope">\[Northwind Labs\]</);
  assert.match(co, /href="\/account\/portfolio\/nw1\/settings"[^>]*data-testid="settings-entry"|data-testid="settings-entry"[^>]*href="\/account\/portfolio\/nw1\/settings"/);
  assert.doesNotMatch(co, /settings-scope-billing|Billing · in Account|pending owner/, 'Billing is in the Account menu');
  assert.doesNotMatch(co, /scope-row-|settings-scope-label/, 'the old block\'s rows are gone');
  assert.match(readFileSync('frontend/src/App.jsx', 'utf8'), /<Link to="\/account\/billing" onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,200}Billing\s*<\/Link>/, 'Billing in the Account menu');

  publishScope(scopeFor({ project: { id: 9, name: '[Lantern]', company: null } }));
  try {
    const solo = sidebar(NORTHWIND);
    assert.match(solo, /data-scope="project"/);
    assert.match(solo, /data-testid="settings-entry-scope">\[Lantern\]</);
    assert.match(solo, /href="\/projects\/9\/settings"/);
  } finally { publishScope(null); }

  assert.doesNotMatch(sidebar(null), /settings-entry/, 'no company and no project: no Settings entry');
});

test('D4152 §3: Portfolio is a main-navigation row after Studio; a shell with no Studio row keeps it at the foot', () => {
  const ICON = () => null;
  const founder = [{ key: 'home', items: [{ to: '/studio', label: 'Studio' }, { to: '/build', label: 'Build' }] }];
  const out = withPortfolioRow(founder, ICON);
  assert.equal(out.portfolioInNav, true);
  assert.deepEqual(out.groups[0].items.map((i) => i.label), ['Studio', 'Portfolio', 'Build']);
  assert.equal(out.groups[0].items[1].to, '/account/portfolio');
  const investor = [{ key: 'home', items: [{ to: '/studio', label: 'Studio' }, { to: '/portfolio', label: 'Portfolio' }] }];
  assert.deepEqual(withPortfolioRow(investor).groups[0].items.map((i) => i.label), ['Studio', 'Companies', 'Portfolio'], 'two rows never share a name');
  const hq = [{ key: 'hq', items: [{ to: '/hq', label: 'Home' }] }];
  assert.equal(withPortfolioRow(hq).portfolioInNav, false);
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/studio'] },
    h(ActiveCompanyContext.Provider, { value: { company: null, setCompany() {}, companies: [], setCompanies() {} } },
      h(SidebarNav, { groups: founder, role: 'founder', user: { role: 'founder' } }))));
  assert.equal((renderedText(html).match(/Portfolio/g) || []).length, 1, 'Portfolio once, in the main navigation');
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
  assert.deepEqual(entryLabels(co), ['Team', 'Company settings', 'General', 'Legal', 'Compliance', 'Projects', '[Atlas Pilot]', '[Orbit]']);
  assert.equal(co.entries[2].count, 2);
  // D1413 (PF6c): a project under Projects opens its settings inside the company.
  assert.equal(co.entries[2].children[1].path, '/account/portfolio/nw1/settings/projects/8');
  const inView = scopeFor({ project: ATLAS, projects });
  assert.deepEqual(entryLabels(inView), ['Team', 'Company settings', 'General', 'Legal', 'Compliance', 'Projects', '[Atlas Pilot]', 'Team', 'Settings', '[Orbit]']);
  assert.equal(projectsOfCompany(null, 'nw1'), null, 'an unread list is not "none"');
  assert.equal(scopeFor({ company: { uid: 'nw1', name: 'x' } }).entries[2].count, null);
});

test('projectCompany: the read\'s company, else the switcher\'s, else governed but unnamed; none for a standalone', () => {
  assert.deepEqual(projectCompany({ company_id: 9 }, { row: ROWS[0] }), { uid: 'nw1', name: '[Northwind Labs]' });
  assert.deepEqual(projectCompany({ company_id: 9 }, { companies: [{ id: 9, uid: 'nw1', company_name: '[Northwind Labs]' }] }), { uid: 'nw1', name: '[Northwind Labs]' });
  assert.deepEqual(projectCompany({ company_id: 9 }, {}), { uid: null, name: null });
  assert.equal(projectCompany({ company_id: null }, { companies: [{ id: 9, uid: 'nw1' }] }), null);
});

const entryAt = (scope, url) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(SettingsScopeBlock, { scope })));

test('D4152 ST1: the entry opens the scope\'s settings and is lit on any of its tabs', () => {
  const co = scopeFor({ company: { uid: 'nw1', name: '[Northwind Labs]' } });
  assert.deepEqual(settingsEntry(co).path, '/account/portfolio/nw1/settings');
  for (const url of ['/account/portfolio/nw1/settings', '/account/portfolio/nw1/settings/legal', '/account/portfolio/nw1/settings/projects/8', '/account/companies/nw1/settings/team']) {
    assert.equal(settingsActive(settingsEntry(co), url), true, url);
    assert.match(entryAt(co, url), /aria-current="page"/, url);
  }
  assert.equal(settingsActive(settingsEntry(co), '/studio'), false);
  const inCo = settingsEntry(scopeFor({ project: ATLAS }));
  assert.deepEqual([inCo.where, inCo.path], ['[Northwind Labs] › [Atlas Pilot]', '/account/portfolio/nw1/settings/projects/7']);
  const solo = settingsEntry(scopeFor({ project: { id: 9, name: '[Lantern]', company: null } }));
  assert.deepEqual([solo.where, solo.path], ['[Lantern]', '/projects/9/settings']);
  assert.equal(settingsActive(solo, '/projects/9/settings/team'), true);
});

test('the collapsed entry is the gear alone, named "Settings · <scope>" for a screen reader', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(SettingsScopeBlock, { scope: scopeFor({ company: { uid: 'nw1', name: '[Northwind Labs]' } }), collapsed: true })));
  assert.match(html, /aria-label="Settings · \[Northwind Labs\]"/);
  assert.match(html, /title="Settings · \[Northwind Labs\]"/);
  assert.doesNotMatch(renderedText(html), /Settings/, 'no text beside the icon when collapsed');
});

test('the project page publishes its own scope, so a standalone project reads "Project settings" there too', () => {
  const src = readFileSync('frontend/src/pages/ProjectDetail.jsx', 'utf8');
  assert.match(src, /usePublishScope\(project && project\.id != null \? scopeFor\(\{ project: \{ id: project\.id, name: project\.name, company: projectCompany\(project, \{ companies \}\) \} \}\) : null\)/);
  publishScope(scopeFor({ project: { id: 9, name: '[Lantern]', company: projectCompany({ company_id: null }, {}) } }));
  try {
    assert.match(sidebar(NORTHWIND), /data-testid="settings-entry" data-scope="project"/, 'not the active company\'s entry');
  } finally { publishScope(null); }
});
