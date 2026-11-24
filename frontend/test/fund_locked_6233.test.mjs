/**
 * #6233 (D6233, FV2): one locked Fund surface for /funds and every Fund zone.
 *
 * Below the Institutional tier, /funds drew a blurred outline with no control
 * and /funds/lps|calls|ledger|reporting drew a different notice inside generic
 * "Fund operations" chrome whose only control revealed one more sentence. Now
 * every route draws `FundLocked`: the zone's name, what the add-on includes
 * (the Fund bucket's own zones, never a price or an invented figure) and Talk
 * to Axal. /funds/performance asks the Investor licence, not the tier (D6245),
 * so an LP below the tier still reads it, and the same surface is drawn only
 * for a member without the licence.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_locked_6233.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FundLocked from '../src/pages/investor/FundLocked.jsx';
import InvestorFundLanding from '../src/pages/investor/InvestorFundLanding.jsx';
import InvestorWorkspacePage from '../src/pages/investor/InvestorWorkspacePage.jsx';
import FundPerformanceShell from '../src/pages/investor/FundPerformanceShell.jsx';
import { FundPerformanceView } from '../src/pages/FundPerformancePage.jsx';
import { FUND_ZONE_LINES, CONTACT_HREF, includedCapabilities, lockedCopy, zoneForPath, zoneLabel } from '../src/pages/investor/fundLockedModel.js';
import { bucketForPath } from '../src/workspaces/shellConfig.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const ZONE_PAGE = h('div', { 'data-testid': 'zone-page-body' }, 'Zone page');
const workspace = (path, fundUnlocked) => at(path, h(InvestorWorkspacePage, { page: 'fund', fundUnlocked }, ZONE_PAGE));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;/g, '’').replace(/\s+/g, ' ');
const lockedOnly = (html) => html.slice(html.indexOf('<main class="fl-locked"'), html.indexOf('</main>', html.indexOf('<main class="fl-locked"')) + 7);

// The six routes the issue names, plus /funds/history, which wraps itself in the same frame (routes/fundHistory.jsx).
const ZONES = [
  ['/funds/lps', 'lps', 'LPs'],
  ['/funds/calls', 'calls', 'Calls'],
  ['/funds/ledger', 'ledger', 'Accounting'],
  ['/funds/reporting', 'reporting', 'Reporting'],
  ['/funds/history', 'history', 'History'],
];

function assertSurface(html, zone, label, need = 'institutional') {
  assert.match(html, new RegExp(`data-testid="investor-fund-locked" data-zone="${zone}" data-need="${need}"`), `${zone}: the shared surface`);
  const want = need === 'licence' ? `${label} is part of the Investor licence` : `${label} is part of the Institutional add-on`;
  assert.match(html, new RegExp(`<h1 id="fund-locked-title">${want}</h1>`), `${zone}: the zone is the heading's variable`);
  assert.match(html, /data-testid="button-talk-to-axal"[^>]*>Talk to Axal<\/a>/, `${zone}: Talk to Axal`);
}

test('/funds below the tier draws the shared surface named Overview, and no fund chrome', () => {
  const html = at('/funds', h(InvestorFundLanding, { fundUnlocked: false }));
  assertSurface(html, 'overview', 'Overview');
  assert.doesNotMatch(html, /i6-locked-preview|filter:blur|data-testid="investor-fund-landing"/);
  assert.doesNotMatch(html, /href="\/funds\/lps"/, 'FV2: the zone row is not drawn while locked');
});

for (const [path, zone, label] of ZONES) {
  test(`${path} below the tier draws the same surface, named ${label}, without the generic workspace chrome`, () => {
    const html = workspace(path, false);
    assertSurface(html, zone, label);
    assert.doesNotMatch(html, /Fund operations|investor-workspace-fund|See Institutional detail|button-expand-fund-institutional/);
    assert.doesNotMatch(html, /zone-page-body/, 'the GP page is not drawn behind the lock');
  });
  test(`${path} at the Institutional tier draws the zone page, not the lock`, () => {
    const html = workspace(path, true);
    assert.match(html, /zone-page-body/);
    assert.doesNotMatch(html, /investor-fund-locked/);
  });
}

test('/funds at the tier draws the landing, not the lock', () => {
  const html = at('/funds', h(InvestorFundLanding, { fundUnlocked: true }));
  assert.match(html, /data-testid="investor-fund-landing"/);
  assert.doesNotMatch(html, /investor-fund-locked/);
});

const perf = (props) => {
  const state = { items: [{ id: 1, name: 'Fixture Fund A', status: 'active', as_of: '2026-11-15', nav_basis: 'Investments only.', unavailable: {} }], loading: false, error: null };
  return at('/funds/performance', h(FundPerformanceShell, { state, ...props }, h(FundPerformanceView, state)));
};

test('/funds/performance below the tier is still the LP read (D6245): no lock, no zone row', () => {
  const html = perf({ fundUnlocked: false });
  assert.doesNotMatch(html, /investor-fund-locked/);
  assert.match(html, /Fixture Fund A/);
  assert.doesNotMatch(html, /href="\/funds\/lps"/);
});

test('/funds/performance without the Investor licence draws the same surface, asking the licence', () => {
  const html = perf({ locked: true });
  assertSurface(html, 'performance', 'Performance', 'licence');
  assert.match(html, /href="\/contact\?topic=licence"/);
  assert.doesNotMatch(html, /Fixture Fund A|Refresh fund performance|i6-rail/, 'no read, no list, no refresh, no rail');
});

test('/funds/performance at the tier keeps its zone row', () => {
  assert.match(perf({ fundUnlocked: true }), /href="\/funds\/lps"/);
});

test('what the add-on includes is the Fund bucket’s own zones, each with its line', () => {
  const bucket = bucketForPath('investor', '/funds');
  assert.equal(bucket.requiredInvestorTier, 'institutional');
  const slugs = includedCapabilities().map((z) => z.slug);
  assert.deepEqual(slugs, ['overview', ...bucket.zones.map((z) => z.slug)], 'every zone is listed, in the row’s order');
  assert.deepEqual(Object.keys(FUND_ZONE_LINES).sort(), [...slugs].sort(), 'no line names a zone the bucket does not have');
  const html = FundLockedHtml('calls');
  for (const z of includedCapabilities()) assert.match(html, new RegExp(`data-testid="fund-locked-included-${z.slug}"><b>${z.label}</b>`));
  assert.equal(zoneLabel('ledger'), 'Accounting', 'the heading uses the pill’s own label');
});

function FundLockedHtml(zone, need) {
  return lockedOnly(at(`/funds/${zone}`, h(FundLocked, { zone, need })));
}

test('no price, seat purchase, service or research promise, and no figure of any kind', () => {
  for (const [zone, need] of [['overview'], ['lps'], ['calls'], ['ledger'], ['reporting'], ['history'], ['performance', 'licence']]) {
    const words = text(FundLockedHtml(zone, need));
    assert.doesNotMatch(words, /\d/, `${zone}: a digit is a figure; the locked surface has none`);
    assert.doesNotMatch(words, /\$|per month|a month|\/mo|colleague seat|extra seat|additional seat|seats|unlimited|research|support|onboarding|SLA|distribution run|upgrade now/i, `${zone}: ${words}`);
  }
  assert.doesNotMatch(text(FundLockedHtml('calls')), /Distributions/, 'no GP page runs a distribution yet (DISTRIBUTIONS_TODAY)');
});

test('the one focusable control is Talk to Axal, a keyboard-reachable link to the Contact form', () => {
  for (const [zone, need, href] of [['overview', undefined, CONTACT_HREF.institutional], ['ledger', undefined, CONTACT_HREF.institutional], ['performance', 'licence', CONTACT_HREF.licence]]) {
    const html = FundLockedHtml(zone, need);
    const focusable = html.match(/<(a|button|input|select|textarea)\b|tabindex=/g) || [];
    assert.equal(focusable.length, 1, `${zone}: exactly one focusable control`);
    const link = html.match(/<a [^>]*>/)[0];
    assert.match(link, /data-testid="button-talk-to-axal"/);
    assert.ok(link.includes(`href="${href}"`), `${zone}: ${link}`);
    assert.match(link, /aria-describedby="fund-locked-caption"/);
    assert.match(html, /id="fund-locked-caption"/, 'the caption the link names exists');
    assert.doesNotMatch(html, /tabindex="-1"|aria-hidden="true"[^>]*><a/);
  }
  assert.equal(CONTACT_HREF.institutional, '/contact?topic=invest', 'the Institutional plan door’s own topic');
});

test('zoneForPath names the zone in the address', () => {
  assert.equal(zoneForPath('/funds'), 'overview');
  assert.equal(zoneForPath('/funds/'), 'overview');
  assert.equal(zoneForPath('/funds/calls'), 'calls');
  assert.equal(lockedCopy({ zone: 'calls' }).title, 'Calls is part of the Institutional add-on');
});

test('phone 390 and dark mode', () => {
  const css = read('frontend/src/pages/investor/fundLocked.css');
  assert.match(css, /\.dark \.fl-locked\{[^}]*--paper:#171622[^}]*--accent:#818cf8/);
  const phone = css.slice(css.indexOf('@media(max-width:640px)'));
  assert.match(phone, /\.fl-btn\{width:100%;min-height:44px\}/, 'a full-width 44px target');
  assert.match(phone, /\.fl-inc\{grid-template-columns:1fr\}/);
  assert.match(css, /\.fl-btn:focus-visible\{outline:2px solid var\(--focus\)/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.dark \.fl-locked\{[^}]*\}/, '').replace(/^\.fl-locked\{[^}]*\}/m, ''), /#[0-9a-f]{3,6}/i, 'colours are tokens, set once per theme');
});

test('the routes still reach the surface through the frames App.jsx already has (frozen hub, no new entry)', () => {
  const app = read('frontend/src/App.jsx');
  for (const z of ['lps', 'calls', 'ledger', 'reporting']) assert.match(app, new RegExp(`path="/funds/${z}" element=\\{guard\\(\\['admin', 'investor'\\], investorFundWorkspace\\(`));
  assert.match(app, /investorWorkspace\('fund', component, \{\n\s+fundUnlocked: hasInvestorTier\(user, 'institutional'\),/);
  assert.match(read('frontend/src/routes/fundHistory.jsx'), /<InvestorWorkspacePage page="fund" fundUnlocked=\{hasInvestorTier\(user, 'institutional'\)\}>/);
  for (const f of ['frontend/src/pages/investor/InvestorFundLanding.jsx', 'frontend/src/pages/investor/InvestorWorkspacePage.jsx', 'frontend/src/pages/investor/FundPerformanceShell.jsx']) {
    const src = read(f);
    assert.match(src, /import FundLocked from '\.\/FundLocked';/, `${f} draws the shared surface`);
    assert.doesNotMatch(src, /function LockedFund|LockedFundNotice|FundPerformanceLocked/, `${f} keeps no locked state of its own`);
  }
});
