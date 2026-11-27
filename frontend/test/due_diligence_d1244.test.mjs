// D1244 (#2385) — Due diligence as a case desk (DDL1–DDL19): the list's tabs
// and the case's nine tabs as addresses under both bases (never `?tab=`), the
// bare case address opening Overview, "Not scored yet" for a case with no
// band, the decision's words, and "Not read here yet" on every block no read
// carries — never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/due_diligence_d1244.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DdCaseTabs, DdListTabBody, DdListTabs } from '../src/pages/duediligence/DdTabs.jsx';
import {
  ADMIN_BASE, CASE_TABS, LIST_TABS, MEMBER_BASE, PAGE_LINE, TITLE, WAITS,
  bandWord, baseOf, caseHref, decisionWord, listHref, viewOf,
} from '../src/pages/duediligence/ddModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (at, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [at] }, el));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('both bases; the list tabs; the bare case address is Overview; an unknown tab is Overview', () => {
  assert.equal(baseOf('/admin/due-diligence/7f3a'), ADMIN_BASE);
  assert.equal(baseOf('/due-diligence'), MEMBER_BASE);
  assert.deepEqual(viewOf('/admin/due-diligence'), { base: ADMIN_BASE, listTab: 'cases', uid: null, caseTab: null });
  assert.deepEqual(viewOf('/due-diligence/my-reviews'), { base: MEMBER_BASE, listTab: 'my-reviews', uid: null, caseTab: null });
  assert.equal(viewOf('/admin/due-diligence/templates').listTab, 'templates');
  assert.deepEqual(viewOf('/admin/due-diligence/7f3a21c9'), { base: ADMIN_BASE, listTab: null, uid: '7f3a21c9', caseTab: 'overview' });
  assert.equal(viewOf('/due-diligence/7f3a21c9/sign-off').caseTab, 'sign-off');
  assert.equal(viewOf('/due-diligence/7f3a21c9/bogus').caseTab, 'overview');
  assert.equal(viewOf('/due-diligence/..%2F/flags').uid, null, 'an odd uid is no case');
});

test('the addresses: the canvas’s nine case tabs in order; hrefs stay on the caller’s base', () => {
  assert.deepEqual(CASE_TABS.map((t) => t.key), ['overview', 'checklist', 'flags', 'requests', 'documents', 'cross-checks', 'team', 'sign-off', 'activity']);
  assert.deepEqual(LIST_TABS.map((t) => t.label), ['Cases', 'My reviews', 'Templates']);
  assert.equal(listHref(MEMBER_BASE, 'cases'), '/due-diligence');
  assert.equal(listHref(ADMIN_BASE, 'my-reviews'), '/admin/due-diligence/my-reviews');
  assert.equal(caseHref(ADMIN_BASE, 'abc123', 'flags'), '/admin/due-diligence/abc123/flags');
  assert.equal(caseHref(MEMBER_BASE, 'abc123'), '/due-diligence/abc123/overview');
  assert.equal(caseHref(MEMBER_BASE, 'abc123', 'odd'), '/due-diligence/abc123/overview');
  assert.equal(caseHref(MEMBER_BASE, '../x', 'flags'), MEMBER_BASE);
});

test('a case with no band is Not scored yet, never Green; decisions have their words; no wait says zero', () => {
  assert.deepEqual(['green', 'yellow', 'amber', 'red', null, undefined, 'odd'].map(bandWord), ['Green', 'Yellow', 'Amber', 'Red', 'Not scored yet', 'Not scored yet', 'Not scored yet']);
  assert.deepEqual(['proceed', 'proceed_with_conditions', 'do_not_proceed', 'withdrawn', null].map(decisionWord), ['Proceed', 'Proceed with conditions', 'Do not proceed', 'Withdrawn', 'Not recorded']);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
  // D1251 (#3266) draws every case tab: none says its blocks are elsewhere, none waits.
  for (const t of CASE_TABS) assert.equal(WAITS[t.key], undefined, `${t.key} is drawn`);
  assert.equal(TITLE, 'Due diligence');
  assert.match(PAGE_LINE, /what the team decided\.$/);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('the list tabs are links on the caller’s base, the open one marked', () => {
  const admin = html('/admin/due-diligence/my-reviews', h(DdListTabs, { active: 'my-reviews' }));
  assert.ok(admin.includes('href="/admin/due-diligence/templates"'));
  assert.match(admin, /aria-current="page"[^>]*data-testid="dd-tab-my-reviews"/);
  assert.ok(!/aria-current="page"[^>]*data-testid="dd-tab-cases"/.test(admin), 'only the open tab is current');
  const member = html('/due-diligence', h(DdListTabs, { active: 'cases' }));
  assert.ok(member.includes('href="/due-diligence/my-reviews"') && !member.includes('/admin/'), 'a member never gets an /admin link');
});

test('My reviews is drawn (D1252) and Templates is drawn (D1250); neither waits', () => {
  const mine = html('/due-diligence/my-reviews', h(DdListTabBody, { tab: 'my-reviews' }));
  assert.ok(mine.includes('data-testid="dd-list-my-reviews"') && !mine.includes('data-testid="dd-wait-my-reviews"'));
  assert.equal(WAITS['my-reviews'], undefined, 'D1252 reads the caller\'s reviews');
  assert.equal(WAITS.templates, undefined, 'D1250 reads the template store');
});

test('the case tabs: nine links on the caller’s base, the open one marked; a reviewer\'s read passes its four', () => {
  const tabs = html('/due-diligence/abc123/flags', h(DdCaseTabs, { uid: 'abc123', active: 'flags' }));
  for (const t of CASE_TABS) assert.ok(tabs.includes(`href="/due-diligence/abc123/${t.key}"`), t.key);
  assert.match(tabs, /aria-current="page"[^>]*data-testid="dd-case-tab-flags"/);
  const four = html('/admin/due-diligence/abc123', h(DdCaseTabs, { uid: 'abc123', active: 'overview', tabs: CASE_TABS.filter((t) => ['overview', 'activity'].includes(t.key)) }));
  assert.ok(four.includes('href="/admin/due-diligence/abc123/activity"') && !four.includes('/team"'), 'only the tabs passed');
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the routes under both bases, the pages mounting the tabs, the band, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  const G = "guard(['admin', 'partner', 'investor', 'advisor'], ";
  // D1250: a founder on the member base's list addresses is sent to their requests (DDL17).
  const F = "user?.role === 'founder' ? <Navigate to=\"/due-diligence/requests\" replace /> : guard(['admin', 'partner', 'investor', 'advisor'], ";
  for (const b of ['/admin/due-diligence', '/due-diligence']) {
    for (const [p, c] of [['my-reviews', 'AdminDueDiligencePage'], ['templates', 'AdminDueDiligencePage'], [':uid/:tab', 'AdminDueDiligenceCasePage']]) {
      const g = b === '/due-diligence' && c === 'AdminDueDiligencePage' ? F : G;
      assert.ok(app.includes(`<Route path="${b}/${p}" element={${g}<${c} />)} />`), `${b}/${p}`);
    }
    assert.ok(app.indexOf(`path="${b}/my-reviews"`) < app.indexOf(`path="${b}/:uid"`), `${b}/my-reviews is declared before the case`);
  }
  const list = read('frontend/src/pages/AdminDueDiligencePage.jsx');
  // D1250: each list tab draws its own body under the one header and tab row.
  assert.ok(list.includes('<DdListTabs active={tab} />'));
  assert.ok(list.includes(`{tab === 'my-reviews' ? <DdListTabBody tab="my-reviews" /> : null}`));
  assert.match(list, /<AdminBoardFrame [^>]*>\s*<DdListPage \/>\s*<\/AdminBoardFrame>/);
  assert.ok(!list.includes('>Due Diligence</h1>'), 'the title is the canvas’s');
  const cs = read('frontend/src/pages/AdminDueDiligenceCasePage.jsx');
  assert.ok(cs.includes('<DdCaseTabs uid={uid} active={caseTab} tabs={tabs} />'));
  // D1251 (#3266): each tab draws its own body; Activity is a tab, no longer a drawer.
  for (const t of CASE_TABS) assert.ok(cs.includes(`${/-/.test(t.key) ? `'${t.key}'` : t.key}: <`), `${t.key} has a body`);
  const work = read('frontend/src/pages/duediligence/DdCaseWork.jsx');
  assert.ok(!work.includes("cs.risk_band || 'Not recorded'") && work.includes('bandWord(cs.risk_band || null)'), 'no band says Not scored yet');
  for (const f of ['Due Diligence Desk Page.dc.html', 'Due diligence · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Due diligence · Boards.dc.html').includes('name="Due Diligence Desk Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1244.md'));
  assert.ok(existsSync('documentation/audits/DUE_DILIGENCE_MAP_2026-10-26.md'));
});
