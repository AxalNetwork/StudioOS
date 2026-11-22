/** D6688: formation-state doors, subject selection and exactly-one-subject order bodies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import FormationEntry from '../src/pages/account/companies/FormationEntry.jsx';
import PortfolioOverview from '../src/pages/account/companies/PortfolioOverview.jsx';
import { formationEntry, incorporatePath } from '../src/pages/account/companies/companiesModel.js';
import { IncorporateStartView } from '../src/pages/incorporate/IncorporateStart.jsx';
import { orderSubject, startSubjects } from '../src/pages/incorporate/incorporateAdapter.js';
const company = { uid: 'fixture_co', company_name: 'Fixture company', my_role: 'Admin', formation_state: 'not_incorporated' };
const project = { id: 77, name: 'Fixture project', my_seat: 'owner', formation_state: 'not_incorporated', company_id: null };
const render = element => renderToStaticMarkup(React.createElement(MemoryRouter, {}, element));
const door = (row, kind = 'company') => render(React.createElement(FormationEntry, { entry: formationEntry(row, kind), name: 'Fixture', uid: row?.uid, project: kind === 'project' }));
test('known unincorporated subjects have literal scoped links for only the owner or company editor', () => {
  assert.equal(incorporatePath('fixture_co', 'company'), '/incorporate?company=fixture_co');
  assert.match(door(company), /href="\/incorporate\?company=fixture_co"/);
  assert.match(door(project, 'project'), /href="\/incorporate\?project=77"/);
  assert.match(door(project, 'project'), /Convert this project into a company/);
  for (const my_role of ['Member', 'Advisor', null]) assert.equal(door({ ...company, my_role }), '');
  assert.match(door({ ...company, my_role: 'Member', is_primary_admin: true }), /Incorporate Fixture/);
  assert.equal(door({ ...company, archived_at: '2026-01-01' }), '');
  assert.equal(door({ ...project, my_seat: 'cofounder' }, 'project'), '');
  assert.equal(door({ ...project, id: null }, 'project'), '');
  assert.equal(door({ ...company, uid: '../other' }), '');
});
test('incorporated subjects have no action; in-flight subjects link only to their recorded order', () => {
  assert.equal(render(React.createElement(FormationEntry, { entry: { state: 'incorporated', allowed: true, href: '/incorporate' }, name: 'Fixture' })), '');
  for (const [row, kind] of [[company, 'company'], [project, 'project']]) {
    assert.equal(door({ ...row, formation_state: 'incorporated' }, kind), '');
    const html = door({ ...row, formation_state: 'in_formation', formation_order_id: 81 }, kind);
    assert.match(html, /In formation/);
    assert.match(html, /href="\/incorporate\/success\?incorporation_id=81"/);
    assert.doesNotMatch(html, /Record its legal facts|Convert this project|Incorporate Fixture/);
    assert.doesNotMatch(door({ ...row, formation_state: 'in_formation', formation_order_id: null }, kind), /href=/);
  }
  assert.doesNotMatch(door({ ...company, my_role: 'Member', formation_state: 'in_formation', formation_order_id: 81 }), /href=/);
});
test('missing or failed formation reads never derive eligibility from legal facts', () => {
  for (const formation_state of [undefined, 'unreadable', 'active']) {
    const html = door({ ...company, formation_state, legal: { available: true, value: null } });
    assert.match(html, /Unavailable/);
    assert.doesNotMatch(html, /href=|Record its legal facts/);
  }
  const loading = render(React.createElement(FormationEntry, { entry: { state: 'loading' } }));
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /href=/);
});
test('start board offers only standalone owned projects and unincorporated administered companies', () => {
  const selected = startSubjects([company, { ...company, uid: 'member', my_role: 'Member' }, { ...company, uid: 'filed', formation_state: 'incorporated' }, { ...company, uid: 'failed', formation_state: 'unreadable' }], [project, { ...project, id: 78, company_id: 1 }, { ...project, id: 79, my_seat: 'member' }, { ...project, id: 80, formation_state: 'in_formation' }]);
  assert.deepEqual(selected.companies, [company]);
  assert.deepEqual(selected.projects, [project]);
  assert.equal(selected.excluded, 2);
  assert.equal(selected.unreadable, true);
  assert.deepEqual(startSubjects([], []), { companies: [], projects: [], excluded: 0, unreadable: false });
});
test('the start board keeps independently failed reads distinct and disables Continue until a valid pick', () => {
  const props = { companies: { items: [company] }, projects: { items: [project] }, pick: null };
  const html = render(React.createElement(IncorporateStartView, props));
  assert.match(html, /A new company/);
  assert.match(html, /We create a project for it first/);
  assert.match(html, /disabled=""[^>]*>Continue/);
  const partial = render(React.createElement(IncorporateStartView, { ...props, companies: { error: true, items: [] }, pick: 'project:77' }));
  assert.match(partial, /Unavailable/);
  assert.match(partial, /Fixture project/);
  assert.doesNotMatch(partial, /disabled=""[^>]*>Continue/);
  const stale = render(React.createElement(IncorporateStartView, { ...props, pick: 'company:absent' }));
  assert.match(stale, /disabled=""[^>]*>Continue/);
});
test('company and project payloads are exclusive and reject invalid subjects', () => {
  assert.deepEqual(orderSubject('fixture_co', 77), { company_uid: 'fixture_co' });
  assert.deepEqual(orderSubject(null, 77), { project_id: 77 });
  for (const bad of [null, 0, -1, NaN, 'abc']) assert.throws(() => orderSubject(null, bad));
  assert.throws(() => orderSubject('../company', null));
});
test('Portfolio consumes the server state for company and standalone-project actions', () => {
  const props = { companies: { status: 'ready', data: { companies: [company] } }, projects: { status: 'ready', data: { projects: [project] } }, switcher: { status: 'ready', data: { companies: [] } }, profile: 'founder' };
  const html = render(React.createElement(PortfolioOverview, props));
  assert.match(html, /href="\/incorporate\?company=fixture_co"/);
  assert.match(html, /href="\/incorporate\?project=77"/);
  const incorporated = render(React.createElement(PortfolioOverview, { ...props, companies: { status: 'ready', data: { companies: [{ ...company, formation_state: 'incorporated' }] } }, projects: { status: 'ready', data: { projects: [{ ...project, formation_state: 'incorporated' }] } } }));
  assert.doesNotMatch(incorporated, /href="\/incorporate/);
});
test('every requested surface uses the shared state gate and switcher adds the existing route', () => {
  for (const path of ['account/companies/CompanyPage.jsx', 'account/companies/CompanySettingsTabs.jsx', 'account/companies/ProjectPage.jsx', 'team/ProjectSettingsPage.jsx']) {
    const source = readFileSync(new URL(`../src/pages/${path}`, import.meta.url), 'utf8');
    assert.match(source, /<FormationEntry /, path);
  }
  const source = readFileSync(new URL('../src/ui/CompanySwitcher.jsx', import.meta.url), 'utf8');
  assert.match(source, /to="\/incorporate"[\s\S]*?Incorporate a company/);
  assert.match(source, /co\.formation_state/);
});
