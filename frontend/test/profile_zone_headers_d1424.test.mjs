/**
 * D1424 (#3700) — one header for the Investor, Advisor and Operating Partner
 * zones: one filled primary from a live action, in the licence's accent, and
 * a header Ask that stays gated until #3706's panel serves these licences.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/profile_zone_headers_d1424.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import WorkspaceShell from '../src/workspaces/WorkspaceShell.jsx';
import { PRIMARY_ACCENT, ZonePrimary } from '../src/workspaces/ZoneActions.jsx';
import ProfileHeaderAsk, { headerAskGate } from '../src/workspaces/ProfileHeaderAsk.jsx';
import { askAvailability, waitingCount } from '../src/workspaces/profileAskAdapter.js';
import { AskButtonView } from '../src/ui/AskButton.jsx';
import { THESIS_PRIMARY } from '../src/pages/investor/dealflow/DealFlow.jsx';
import { ShowProofLink } from '../src/pages/investor/deals/CommitZone.jsx';
import { SHARE_BUTTON } from '../src/pages/investor/proofOfFundsModel.js';
import { THESIS_HREF, ThesisBandView, thesisBandState } from '../src/pages/investor/InvestorThesisBand.jsx';
import { VisibilityView, statusLine } from '../src/pages/advisor/expertise/VisibilityZone.jsx';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const h = React.createElement;
const routed = (el, path = '/') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));

// ── The header ──────────────────────────────────────────────────────────────

test('WorkspaceShell draws a passed primary filled in the licence accent, beside the slot, with no Ask on main', () => {
  const html = routed(h(WorkspaceShell, {
    role: 'investor', title: 'Closing',
    primary: { label: 'Record wire', onClick: () => {}, accent: 'investor', testid: 'zone-primary' },
  }, h('p', null, 'body')), '/deals/closing');
  assert.match(html, /data-testid="zone-primary"[^>]*data-primary="true"/);
  assert.match(html, /class="[^"]*bg-indigo-600[^"]*dark:bg-indigo-400/, 'the investor primary is indigo, with its dark weight');
  assert.match(html, /data-testid="zone-primary-slot"/, 'the header keeps a slot for the body\'s primary');
  assert.doesNotMatch(html, /zone-header-ask/, 'the header Ask is gated off until #3706 serves these licences');
  // The order is the canvas's PH0 anatomy: primary, then Ask, then actions and scope.
  const shell = codeOnly(read('frontend/src/workspaces/WorkspaceShell.jsx'));
  const at = (re) => shell.search(re);
  assert.ok(at(/<ZonePrimary item=\{primary\}/) < at(/<ZonePrimaryTarget \/>/));
  assert.ok(at(/<ZonePrimaryTarget \/>/) < at(/<ProfileHeaderAsk role=\{role\} \/>/));
  assert.ok(at(/<ProfileHeaderAsk role=\{role\} \/>/) < at(/\{actions\}/));
  assert.match(shell, /<ZonePrimaryScope>\s*<RailFrame rail=\{rail\}>/, 'the shell is the scope its body portals into');
});

test('a primary is a link or a live handler; anything else draws nothing, and busy reads "Label…"', () => {
  assert.equal(routed(h(ZonePrimary, { item: { label: 'Draft all', primary: true, accent: 'partner' } })), '');
  assert.equal(routed(h(ZonePrimary, { item: null })), '');
  const busy = routed(h(ZonePrimary, { item: { label: 'New call', onClick: () => {}, busy: true, accent: 'investor' } }));
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, />New call…</);
  assert.match(busy, /disabled=""/);
  const off = routed(h(ZonePrimary, { item: { label: 'New report', onClick: () => {}, disabled: true, title: 'No engagement is live, so there is nothing to report on.', accent: 'partner' } }));
  assert.match(off, /disabled="" title="No engagement is live/, 'disabled carries its reason on hover');
});

test('each licence fills its own accent, with the dark weights the shell pairs (owner answer A)', () => {
  for (const [role, hue] of [['investor', 'indigo'], ['advisor', 'emerald'], ['partner', 'amber']]) {
    const cls = PRIMARY_ACCENT[role];
    const ink = role === 'investor' ? 600 : 700;
    assert.match(cls, new RegExp(`(^| )bg-${hue}-${ink}( |$)`), `${role} light ink`);
    assert.match(cls, new RegExp(`hover:bg-${hue}-${ink + 100}( |$)`), `${role} light hover is the deep weight`);
    assert.match(cls, new RegExp(`dark:bg-${hue}-400( |$)`), `${role} dark is the 400 weight`);
    assert.match(cls, /dark:text-\[#0b1220\]/, `${role} dark ink is the canvas's ONA`);
    assert.doesNotMatch(cls, /violet/, `${role} is not violet: violet stays the founder's`);
  }
});

// ── Ask ─────────────────────────────────────────────────────────────────────

test('the header Ask gate: a profile, a rail, no support session, and the panel — in that order', () => {
  const open = { available: true };
  assert.deepEqual(headerAskGate({ role: 'investor', pathname: '/deals/closing', panel: open }).show, true);
  assert.equal(headerAskGate({ role: 'founder', pathname: '/deals/closing', panel: open }).reason, 'not_a_profile');
  assert.equal(headerAskGate({ role: 'advisor', pathname: '/studio', panel: open }).reason, 'no_rail', 'Advisor Studio has no rail');
  assert.equal(headerAskGate({ role: 'investor', pathname: '/spinout-lab/investor-workspace', panel: open }).reason, 'no_rail', 'the LP workspace has no rail');
  assert.equal(headerAskGate({ role: 'investor', pathname: '/account', panel: open }).reason, 'no_rail', '/account has no rail');
  assert.equal(headerAskGate({ role: 'partner', pathname: '/offers/testing', panel: open }).reason, 'no_rail', 'Product testing is off-canvas');
  assert.equal(headerAskGate({ role: 'partner', pathname: '/delivery/status-reports', support: true, panel: open }).reason, 'support_session', 'PH19b: no Ask in a support session');
  // ON MAIN: the panel does not serve these licences, so nothing is drawn anywhere.
  assert.deepEqual(askAvailability(), { available: false, reason: 'ask_panel_unbuilt', waitsOn: '#3706 (D1443)' });
  const shut = headerAskGate({ role: 'advisor', pathname: '/practice/sessions' });
  assert.equal(shut.show, false);
  assert.equal(shut.reason, 'ask_panel_unbuilt');
  assert.equal(routed(h(ProfileHeaderAsk, { role: 'investor' }), '/deals/closing'), '');
});

test('the waiting count is unavailable until D1442, and an unread count is never "0 waiting"', () => {
  const w = waitingCount('Investor · Deals · Closing');
  assert.equal(w.available, false);
  assert.equal(w.count, null);
  assert.equal(w.waitsOn, '#3706 (D1442)');
  for (const waiting of [null, 0, undefined]) {
    const html = renderToStaticMarkup(h(AskButtonView, { waiting }));
    assert.doesNotMatch(html, /waiting/, `waiting=${waiting} draws a chip`);
    assert.match(html, /aria-label="Ask Eadwyn"/);
  }
  // D1442 (#3991) added `page` to the client with its route; this header's own
  // adapter still reaches no API until its flag flips (S1's viewer-gate note on #3706).
  assert.match(codeOnly(read('frontend/src/lib/api/railProposals.js')), /\{ page: String\(page\) \}/);
  assert.doesNotMatch(codeOnly(read('frontend/src/workspaces/profileAskAdapter.js')), /\bapi\b|request\(|fetch\(/);
});

test('the header Ask is "Ask", never "Fill", and the shared button is the one drawn', () => {
  const src = codeOnly(read('frontend/src/workspaces/ProfileHeaderAsk.jsx'));
  assert.match(src, /import \{ AskButtonView \} from '\.\.\/ui\/AskButton\.jsx'/);
  assert.doesNotMatch(src, /Fill/);
  assert.match(renderToStaticMarkup(h(AskButtonView, {})), />Ask</);
});

// ── Investor ────────────────────────────────────────────────────────────────

test('Deal flow: "Set your thesis" is the Deals root primary only while no deal is in the flow (owner C)', () => {
  assert.equal(THESIS_PRIMARY.label, 'Set your thesis');
  assert.equal(THESIS_PRIMARY.to, '/account/security-privacy', 'the My thesis card is on the security-privacy section');
  const html = routed(h(ZonePrimary, { item: THESIS_PRIMARY }));
  assert.match(html, /data-primary="true"/);
  assert.match(html, /href="\/account\/security-privacy"/);
  assert.match(html, /bg-indigo-600/);
  const flow = codeOnly(read('frontend/src/pages/investor/dealflow/DealFlow.jsx'));
  const empty = flow.slice(flow.indexOf('function EmptyFlow()'), flow.indexOf('export default function DealFlow'));
  assert.match(empty, /<ZonePrimary item=\{THESIS_PRIMARY\} \/>/);
  assert.equal((flow.match(/THESIS_PRIMARY/g) || []).length, 2, 'drawn once, in the empty state, and nowhere else');
  assert.match(flow, /\} else if \(scope === 'mine' && !rows\.length\) \{\s*body = <EmptyFlow \/>;/, 'only an empty Mine after a read draws it');
  assert.doesNotMatch(flow, /Add a deal/, 'owner answer C: no Add a deal');
});

test('Commit: "Show Axal you can fund this ›" links the deal room\'s Commitment tab, only with a deal_id', () => {
  assert.equal(routed(h(ShowProofLink, { dealId: null })), '');
  const html = routed(h(ShowProofLink, { dealId: 42 }));
  assert.match(html, /href="\/deals\/42\/commitment"/);
  assert.ok(html.includes(`${SHARE_BUTTON} ›`));
  const commit = codeOnly(read('frontend/src/pages/investor/deals/CommitZone.jsx'));
  assert.match(commit, /r\.deal_id \? \(/);
  assert.match(commit, /\{r\.decision !== 'pass' \? <ShowProofLink dealId=\{r\.deal_id\} \/> : null\}/);
});

test('Investor Home: the thesis band reads, links to Settings, and never guesses (owner E)', () => {
  assert.deepEqual(thesisBandState({ status: 'loading' }), { kind: 'reading' });
  assert.deepEqual(thesisBandState({ status: 'error' }), { kind: 'unreadable' });
  assert.deepEqual(thesisBandState({ status: 'ready', profile: { thesis_text: '  ' } }), { kind: 'empty' });
  assert.deepEqual(thesisBandState({ status: 'ready', profile: null }), { kind: 'empty' });
  assert.deepEqual(thesisBandState({ status: 'ready', profile: { thesis_text: 'Seed B2B infra' } }), { kind: 'set', text: 'Seed B2B infra' });
  const unreadable = routed(h(ThesisBandView, { state: { kind: 'unreadable' }, onRetry: () => {} }));
  assert.match(unreadable, /Your thesis could not be read ·/);
  assert.match(unreadable, />Try again</);
  const empty = routed(h(ThesisBandView, { state: { kind: 'empty' } }));
  assert.match(empty, /No thesis set/);
  assert.match(empty, new RegExp(`href="${THESIS_HREF}"`));
  const set = routed(h(ThesisBandView, { state: { kind: 'set', text: 'Seed B2B infra' } }));
  assert.match(set, /Seed B2B infra/);
  assert.match(set, /Edit in Settings ›/);
  const home = codeOnly(read('frontend/src/pages/investor/InvestorStudioHome.jsx'));
  assert.match(home, /\{!previewing && <InvestorThesisBand \/>\}/, 'an admin preview withholds investor records');
});

test('the seven bespoke investor zone pages draw ZoneHeader inside a ZonePrimaryScope; the two roots carry its tools', () => {
  for (const f of ['InvestorPortfolioPositions', 'InvestorPortfolioUpdates', 'InvestorPortfolioValueAdd', 'InvestorFundLPs', 'InvestorFundCalls', 'InvestorFundAccounting', 'InvestorFundReporting']) {
    const src = codeOnly(read(`frontend/src/pages/investor/${f}.jsx`));
    assert.match(src, /return <ZonePrimaryScope>/, `${f} is not a primary scope`);
    assert.match(src, /<\/ZonePrimaryScope>;/, `${f} does not close its scope`);
    assert.match(src, /<ZoneHeader /, `${f} lost its ZoneHeader`);
    assert.doesNotMatch(src, /<ZoneNav /, `${f} draws a second pill row`);
  }
  for (const f of ['InvestorPortfolioCanvas', 'InvestorFundLanding']) {
    assert.match(codeOnly(read(`frontend/src/pages/investor/${f}.jsx`)), /<ZoneHeaderTools role="investor"/, `${f} lost its header tools`);
  }
});

// ── Advisor ─────────────────────────────────────────────────────────────────

test('Services: "New service" focuses the Add form; Sessions: "Block a date range" opens the page\'s Block form', () => {
  const services = codeOnly(read('frontend/src/pages/advisor/expertise/ServicesZone.jsx'));
  assert.match(services, /advisorZoneActions\('expertise\/services', \{ handlers: \{ focusAddForm \}/);
  assert.match(services, /<input ref=\{titleRef\}/);
  const sessions = codeOnly(read('frontend/src/pages/advisor/practice/SessionsZone.jsx'));
  assert.doesNotMatch(sessions, /window\.prompt/, 'D1596: the page form replaces the three prompts');
  assert.match(sessions, /blockRange: \{ onClick: blockRange, busy: blocking \}/);
  assert.match(sessions, /data-testid="advisor-block-form"/);
  assert.match(sessions, /api\.blockMyAdvisorSlotRange\(/, 'nothing is blocked until Block is pressed');
});

test('Visibility: what is recorded, per block; a failed block says so and the other still shows; views are Not recorded', () => {
  const data = {
    window: { days: 30 },
    surfaces: [
      { key: 'link:a', kind: 'booking_link', name: '/b/maria', is_active: true, requests: 0, by_status: {} },
      { key: 'no_link', kind: 'no_link', name: 'Booked without a link', requests: 2, by_status: { pending: 1, confirmed: 1 }, note: 'These bookings name no link.' },
    ],
    writing: null,
    views: null, views_note: 'No profile view is recorded anywhere in the product.',
    engagements: null, engagements_note: 'No engagement records the link.',
    unreadable: true,
  };
  const html = routed(h(VisibilityView, { data, onRetry: () => {} }));
  assert.match(html, /\/b\/maria/);
  assert.match(html, />0 requests</, 'a link read that succeeded may be 0');
  assert.match(html, />2 requests</);
  assert.match(html, /1 pending · 1 confirmed/);
  assert.match(html, /Your writing could not be read ·/);
  assert.match(html, /No profile view is recorded anywhere in the product\./);
  const views = html.slice(html.indexOf('advisor-visibility-views'));
  assert.match(views, /Not recorded/);
  assert.doesNotMatch(views.slice(0, views.indexOf('</div></div>')), />0</, 'profile views are never 0');
  const failedLinks = routed(h(VisibilityView, { data: { ...data, surfaces: null, writing: { published: 3, opens: 41, opens_note: 'Opened here.', requests: null, requests_note: 'Not linked.' } }, onRetry: () => {} }));
  assert.match(failedLinks, /Your booking links could not be read ·/);
  assert.match(failedLinks, />41</);
  assert.equal(statusLine({ pending: 0 }), null);
});

// ── Operating Partner ───────────────────────────────────────────────────────

test('Status reports: "New report" opens and focuses the Composer, and is disabled with its reason when nothing is live', () => {
  const src = codeOnly(read('frontend/src/pages/partner/delivery/StatusReportsZone.jsx'));
  assert.match(src, /onClick: \(\) => \{ setComposing\(true\); setFocusTick\(\(n\) => n \+ 1\); \}/);
  assert.match(src, /disabled: engagements\.length === 0/);
  assert.match(src, /partnerZoneActions\('delivery\/status-reports', \{ handlers: \{ newReport \}/);
  assert.match(src, /<select ref=\{engagementRef\}/);
});

// ── No API change ──────────────────────────────────────────────────────────

test('no new client method: every read and write here is one main already serves', () => {
  for (const f of ['frontend/src/workspaces/ZoneHeader.jsx', 'frontend/src/workspaces/ProfileHeaderAsk.jsx', 'frontend/src/workspaces/profileAskAdapter.js']) {
    assert.doesNotMatch(codeOnly(read(f)), /request\(|fetch\(|from '\.\.\/lib\/api'/, `${f} reaches the network`);
  }
  assert.match(codeOnly(read('frontend/src/pages/investor/InvestorThesisBand.jsx')), /api\.getInvestorProfile\(\)/);
  assert.match(codeOnly(read('frontend/src/pages/advisor/expertise/VisibilityZone.jsx')), /api\.getMyAdvisorVisibility\(VISIBILITY_DAYS\)/);
});
