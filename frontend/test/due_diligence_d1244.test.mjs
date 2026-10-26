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
import { DdCaseTabBody, DdCaseTabs, DdListTabBody, DdListTabs } from '../src/pages/duediligence/DdTabs.jsx';
import {
  ADMIN_BASE, CASE_TABS, LIST_TABS, MEMBER_BASE, NOT_YET, ON_OVERVIEW, PAGE_LINE, TITLE, WAITS,
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
  for (const t of CASE_TABS.filter((x) => x.key !== 'overview')) assert.ok(ON_OVERVIEW[t.key], `${t.key} says where its blocks are today`);
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

test('My reviews waits, with its reason; Templates is drawn (D1250)', () => {
  const mine = html('/due-diligence/my-reviews', h(DdListTabBody, { tab: 'my-reviews' }));
  assert.ok(mine.includes('data-testid="dd-wait-my-reviews"') && mine.includes(NOT_YET));
  assert.equal(WAITS.templates, undefined, 'D1250 reads the template store');
});

test('the case tabs: nine links on the caller’s base; a tab says where its blocks are today and what waits', () => {
  const tabs = html('/due-diligence/abc123/flags', h(DdCaseTabs, { uid: 'abc123', active: 'flags' }));
  for (const t of CASE_TABS) assert.ok(tabs.includes(`href="/due-diligence/abc123/${t.key}"`), t.key);
  assert.match(tabs, /aria-current="page"[^>]*data-testid="dd-case-tab-flags"/);
  const flags = html('/admin/due-diligence/abc123/flags', h(DdCaseTabBody, { uid: 'abc123', tab: 'flags' }));
  assert.ok(flags.includes('href="/admin/due-diligence/abc123"'), 'back to Overview on the same base');
  assert.ok(flags.includes(ON_OVERVIEW.flags));
  assert.ok(flags.includes('data-testid="dd-wait-flags"'));
  const sign = html('/due-diligence/abc123/sign-off', h(DdCaseTabBody, { uid: 'abc123', tab: 'sign-off' }));
  assert.ok(sign.includes('href="/due-diligence/abc123"') && !sign.includes('/admin/'), 'a member’s way back stays on /due-diligence');
  assert.ok(sign.includes('data-testid="dd-wait-decision"'), 'Sign-off says the decision waits');
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the routes under both bases, the pages mounting the tabs, the band, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  const G = "guard(['admin', 'partner', 'investor', 'advisor'], ";
  // D1250: a founder reaches the member base's list addresses, to be sent to their requests (DDL17).
  const F = "guard(['admin', 'partner', 'investor', 'advisor', 'founder'], ";
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
  assert.match(list, /<AdminBoardFrame [^>]*>\s*<DdListPage me=\{me\} \/>\s*<\/AdminBoardFrame>/);
  assert.ok(!list.includes('>Due Diligence</h1>'), 'the title is the canvas’s');
  const cs = read('frontend/src/pages/AdminDueDiligenceCasePage.jsx');
  assert.ok(cs.includes('<DdCaseTabs uid={uid} active={caseTab} />'));
  assert.ok(cs.includes("{caseTab !== 'overview' ? <DdCaseTabBody uid={uid} tab={caseTab} /> : (<>"));
  assert.ok(cs.indexOf('{auditOpen && <AuditDrawer') > cs.indexOf('</>)}'), 'the audit drawer opens on every tab');
  assert.ok(!cs.includes("cs.risk_band || 'Not recorded'") && cs.includes('bandWord(band)'), 'no band says Not scored yet');
  for (const f of ['Due Diligence Desk Page.dc.html', 'Due diligence · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Due diligence · Boards.dc.html').includes('name="Due Diligence Desk Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1244.md'));
  assert.ok(existsSync('documentation/audits/DUE_DILIGENCE_MAP_2026-10-26.md'));
});
