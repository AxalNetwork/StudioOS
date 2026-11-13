// D4474 (#4474, part 3 of #3704) — Studio and Spin-Out Lab show one block per held licence.
//
// Synthetic fixtures only: no person, email or figure from any account. The pages are rendered with the
// homes and Lab pages handed in as stubs (each records that it mounted), in the house's minimal document
// (`_contracts_dom.mjs`), so the order, the single-licence path, a block's failure and the Lab request are
// read from what React actually drew.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/multi_licence_pages_3704.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { multiLicenceSet, studioBlocks, spinoutBlocks, LICENCE_TITLE } from '../src/lib/multiLicencePages.js';
import { resolveActiveRole, resolveHeldLicences } from '../src/lib/activeRole.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const app = src('App.jsx');
const studioSrc = src('pages/studio/MultiLicenceStudio.jsx');
const labSrc = src('pages/spinout/MultiLicenceSpinoutLab.jsx');
const blocksSrc = src('pages/studio/LicenceBlocks.jsx');

const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
const propsOf = (node) => Object.entries(node).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};

// Every read the real page makes (the investor context, the tour, My tasks, Product testing) answers 404 here.
globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const quiet = console.error;

async function mount(element, { seed } = {}) {
  const restore = installDocument();
  seed?.();
  console.error = () => {};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: ['/studio'] }, element)); });
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => walk(container);
  return {
    text: () => textOf(container),
    titles: () => nodes().filter((n) => n.tagName === 'H2' && String(propsOf(n)['data-testid'] || '').startsWith('licence-block-title-')).map(textOf),
    testIds: () => nodes().map((n) => propsOf(n)['data-testid']).filter(Boolean),
    buttons: () => nodes().filter((n) => n.tagName === 'BUTTON').map((n) => textOf(n).trim()),
    // Every link to the signed-in application (the hero, the Apply section and the closing apply band).
    applyLinks: () => nodes().filter((n) => n.tagName === 'A' && propsOf(n).href === '/spinout-lab/apply').map((n) => textOf(n).trim()),
    async unmount() { await act(async () => root.unmount()); console.error = quiet; restore(); },
  };
}

// A stub page that records each render and the props it was given; `names()` is the order of first render.
function stubs() {
  const mounted = [];
  mounted.names = () => [...new Set(mounted.map((m) => m.name))];
  mounted.last = (name) => mounted.filter((m) => m.name === name).at(-1)?.props;
  const make = (name, { throws = false } = {}) => function Stub(props) {
    mounted.push({ name, props });
    if (throws) throw new Error(`secret-detail-${name}`);
    return React.createElement('div', { 'data-testid': `stub-${name}` }, `${name} home`);
  };
  return { mounted, make };
}

const { default: MultiLicenceStudio } = await import('../src/pages/studio/MultiLicenceStudio.jsx');
const { default: MultiLicenceSpinoutLab } = await import('../src/pages/spinout/MultiLicenceSpinoutLab.jsx');
const { BLOCK_FAILED } = await import('../src/pages/studio/LicenceBlocks.jsx');

const member = { id: 1, role: 'founder', name: 'Test Member' };

function studioWith(licences, { throws = [] } = {}) {
  const s = stubs();
  const homes = Object.fromEntries(['founder', 'investor', 'advisor', 'partner'].map((l) => [l, s.make(l, { throws: throws.includes(l) })]));
  const single = s.make('dashboard');
  const el = React.createElement(MultiLicenceStudio, { licences, activeRole: licences[0], authUser: { ...member, role: licences[0], licences }, homes, single });
  return { s, el };
}

function labWith(licences, { throws = [] } = {}) {
  const s = stubs();
  const labRequests = [];
  const Lab = function LabStub() {
    // Stands for SpinoutLabPage's mount-time founder-scoped read.
    labRequests.push('/api/spinout-lab/state');
    return s.make('lab', { throws: throws.includes('lab') })();
  };
  const pages = { lab: Lab, investor: s.make('investor', { throws: throws.includes('investor') }) };
  return { s, labRequests, el: React.createElement(MultiLicenceSpinoutLab, { licences, activeRole: licences[0], pages }) };
}

/* ------------------------------------------------------------------ Studio */

for (const licence of ['founder', 'investor', 'advisor', 'partner']) {
  test(`/studio for a single ${licence} licence is Dashboard with that role, and no block headers`, async () => {
    const { s, el } = studioWith([licence]);
    const page = await mount(el);
    try {
      assert.deepEqual(s.mounted.names(), ['dashboard']);
      assert.equal(s.mounted[0].props.activeRole, licence);
      assert.deepEqual(page.titles(), []);
      assert.ok(!page.testIds().includes('multi-licence-studio'));
    } finally { await page.unmount(); }
    // The route never sends a single-licence member to the block page.
    assert.equal(multiLicenceSet({ user: { role: licence, licences: [licence] }, effectiveRole: licence, heldLicences: [licence] }), null);
  });
}

test('Founder + Investor: two Studio blocks, Founder then Investor', async () => {
  const { s, el } = studioWith(['investor', 'founder']);
  const page = await mount(el);
  try {
    assert.deepEqual(page.titles(), ['Founder', 'Investor']);
    assert.deepEqual(s.mounted.names(), ['founder', 'investor']);
    assert.ok(s.mounted.every((m) => m.props.embedded === true), 'each home is embedded');
    assert.ok(!s.mounted.some((m) => m.name === 'dashboard'));
  } finally { await page.unmount(); }
});

test('Investor + Advisor: Investor then Advisor', async () => {
  const { el } = studioWith(['advisor', 'investor']);
  const page = await mount(el);
  try { assert.deepEqual(page.titles(), ['Investor', 'Advisor']); } finally { await page.unmount(); }
});

test('all four licences: four Studio blocks in licence order', async () => {
  const { s, el } = studioWith(['partner', 'advisor', 'investor', 'founder']);
  const page = await mount(el);
  try {
    assert.deepEqual(page.titles(), ['Founder', 'Investor', 'Advisor', 'Operating Partner']);
    assert.deepEqual(s.mounted.names(), ['founder', 'investor', 'advisor', 'partner']);
    assert.equal(page.testIds().filter((t) => t === 'text-multi-licence-studio-title').length, 1, 'one page title');
  } finally { await page.unmount(); }
  assert.deepEqual(studioBlocks(['partner', 'founder']).map((b) => b.title), ['Founder', 'Operating Partner']);
});

test('the Investor block is a member\'s own view, never a withheld preview', async () => {
  const { s, el } = studioWith(['founder', 'investor']);
  const page = await mount(el);
  try {
    const inv = s.mounted.last('investor');
    assert.equal(inv.previewing, false);
    // The summary read answered 404 here: the home is told in fixed words, never the error's message.
    assert.equal(inv.dashboard, null);
    assert.match(inv.dashboardUnavailable, /^The deal-flow summary could not be read\./);
    assert.ok(!/not found/i.test(inv.dashboardUnavailable));
  } finally { await page.unmount(); }
});

/* ------------------------------------------------------------ Spin-Out Lab */

test('Spin-Out Lab, Founder + Investor: Lab then Investor', async () => {
  const { s, el } = labWith(['investor', 'founder']);
  const page = await mount(el);
  try {
    assert.deepEqual(page.titles(), ['Founder', 'Investor']);
    assert.deepEqual(s.mounted.names(), ['lab', 'investor']);
  } finally { await page.unmount(); }
});

test('Spin-Out Lab, Investor + Advisor: Investor then Lab', async () => {
  const { s, el } = labWith(['advisor', 'investor']);
  const page = await mount(el);
  try {
    assert.deepEqual(page.titles(), ['Investor', 'Advisor']);
    assert.deepEqual(s.mounted.names(), ['investor', 'lab']);
  } finally { await page.unmount(); }
});

test('Spin-Out Lab, Advisor + Operating Partner: one Lab block', async () => {
  const { s, labRequests, el } = labWith(['partner', 'advisor']);
  const page = await mount(el);
  try {
    assert.deepEqual(page.titles(), ['Advisor · Operating Partner']);
    assert.deepEqual(s.mounted.names(), ['lab']);
    assert.equal(labRequests.length, 1, 'SpinoutLabPage mounts once');
  } finally { await page.unmount(); }
  assert.deepEqual(spinoutBlocks(['founder', 'investor', 'advisor', 'partner']).map((b) => b.title), ['Founder · Advisor · Operating Partner', 'Investor']);
});

test('an Investor-only member never mounts SpinoutLabPage, so the Lab request is absent', async () => {
  const { s, labRequests, el } = labWith(['investor']);
  const page = await mount(el);
  try {
    assert.deepEqual(s.mounted.names(), ['investor']);
    assert.deepEqual(labRequests, []);
    assert.deepEqual(page.titles(), [], 'today\'s page, with no block chrome');
  } finally { await page.unmount(); }
  // And on the route: one licence is not the block page, so the ternary serves the sales page alone.
  assert.equal(multiLicenceSet({ user: { role: 'investor', licences: ['investor'] }, effectiveRole: 'investor', heldLicences: ['investor'] }), null);
  assert.match(app, /: effectiveRole === 'investor'\s*\?\s*<SpinoutLabInvestorPage \/>\s*:\s*<SpinoutLabPage \/>\)/);
});

for (const licence of ['founder', 'advisor', 'partner']) {
  test(`Spin-Out Lab for a single ${licence} licence is today's Lab page, with no block chrome`, async () => {
    const { s, el } = labWith([licence]);
    const page = await mount(el);
    try {
      assert.deepEqual(s.mounted.names(), ['lab']);
      assert.deepEqual(page.titles(), []);
    } finally { await page.unmount(); }
  });
}

/* ------------------------------------------------------- failure and copy */

test('one Studio block\'s thrown error leaves the other blocks rendered, in fixed words', async () => {
  const { el } = studioWith(['founder', 'investor', 'advisor'], { throws: ['investor'] });
  const page = await mount(el);
  try {
    const text = page.text();
    assert.deepEqual(page.titles(), ['Founder', 'Investor', 'Advisor']);
    assert.ok(page.testIds().includes('stub-founder'));
    assert.ok(page.testIds().includes('stub-advisor'));
    assert.ok(page.testIds().includes('licence-block-failed-investor'));
    assert.ok(text.includes(BLOCK_FAILED));
    assert.ok(!text.includes('secret-detail'), 'never the error\'s message');
    assert.ok(page.buttons().includes('Try again'));
  } finally { await page.unmount(); }
});

test('one Spin-Out Lab block\'s thrown error leaves the other block rendered', async () => {
  const { el } = labWith(['founder', 'investor'], { throws: ['lab'] });
  const page = await mount(el);
  try {
    assert.ok(page.testIds().includes('licence-block-failed-lab'));
    assert.ok(page.testIds().includes('stub-investor'));
    assert.ok(!page.text().includes('secret-detail'));
  } finally { await page.unmount(); }
});

test('neither page has a switch control or an "active licence"', async () => {
  for (const { el } of [studioWith(['founder', 'investor', 'advisor', 'partner']), labWith(['founder', 'investor'])]) {
    const page = await mount(el);
    try {
      // The only buttons are the real pages' own (a read that failed here offers Try again).
      assert.ok(page.buttons().every((b) => !/switch|active|primary|licen[cs]e/i.test(b)), 'no control switches licence');
      // A block header is its title alone: an h2 whose only child is text.
      for (const t of page.titles()) assert.ok(Object.values(LICENCE_TITLE).some((name) => t.includes(name)));
      assert.ok(!/switch|active licen[cs]e|make active|set as primary/i.test(page.text()));
      assert.ok(!page.testIds().some((t) => /switch|toggle|select/i.test(t)));
    } finally { await page.unmount(); }
  }
  for (const s of [studioSrc, labSrc, blocksSrc]) {
    assert.ok(!/<select|role="tab"|role="switch"|aria-pressed|setActiveLicen/i.test(s));
    assert.ok(!/\bFill\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')), 'an Eadwyn action is Ask, never Fill');
  }
});

test('a failed block never shows e.message, and no number is drawn as 0', () => {
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const s of [studioSrc, labSrc, blocksSrc].map(code)) {
    assert.ok(!/\.message\b/.test(s), 'no error message reaches the page');
    assert.ok(!/\?\?\s*0\b|\|\|\s*0\b/.test(s), 'no unknown number falls back to 0');
  }
});

/* -------------------------------------------------- the route and the rail */

test('admin, a "View as" preview, an impersonation and exploring keep today\'s pages', () => {
  const both = ['founder', 'investor'];
  const at = (session) => multiLicenceSet({ ...session, effectiveRole: resolveActiveRole(session), heldLicences: resolveHeldLicences(session) });
  assert.deepEqual(at({ user: { role: 'founder', licences: both } }), both);
  assert.equal(at({ user: { role: 'admin', licences: both } }), null);
  assert.equal(at({ user: { role: 'admin' }, viewMode: 'investor' }), null);
  assert.equal(at({ user: { role: 'founder', licences: both }, realUser: { role: 'admin' }, isImpersonating: true }), null);
  assert.equal(at({ user: { role: 'exploring', licences: both } }), null);
  assert.equal(at({ user: null }), null);
  // Each rule holds on its own, whatever the other inputs say.
  assert.equal(multiLicenceSet({ user: { role: 'founder', licences: both }, isImpersonating: true, effectiveRole: 'founder', heldLicences: both }), null);
  assert.equal(multiLicenceSet({ user: { role: 'admin' }, effectiveRole: 'founder', heldLicences: both }), null);
  assert.equal(LICENCE_TITLE.partner, 'Operating Partner');
});

test('App routes /studio and /spinout-lab through the block pages only for multiLicence', () => {
  assert.match(app, /<Route path="\/studio" element=\{guard\(labRoles\(\[[^\]]*\]\), multiLicence \? <MultiLicenceStudio licences=\{multiLicence\} activeRole=\{effectiveRole\} authUser=\{user\} \/> : <Dashboard activeRole=\{effectiveRole\} authUser=\{user\} \/>\)\} \/>/);
  assert.match(app, /path="\/spinout-lab"\s*element=\{\s*user\s*\? authOnly\(multiLicence\s*\? <MultiLicenceSpinoutLab licences=\{multiLicence\} activeRole=\{effectiveRole\} \/>/);
  assert.match(app, /const multiLicence = multiLicenceSet\(\{ user, realUser, isImpersonating, effectiveRole, heldLicences \}\);/);
  assert.match(app, /const MultiLicenceStudio = lazy\(\(\) => import\('\.\/pages\/studio\/MultiLicenceStudio'\)\);/);
  assert.match(app, /const MultiLicenceSpinoutLab = lazy\(\(\) => import\('\.\/pages\/spinout\/MultiLicenceSpinoutLab'\)\);/);
  // The reason SpinoutLabPage mounts only in the Lab block stays above the route.
  assert.match(app, /SpinoutLabPage mounts only inside the Lab block/);
});

test('the page mounts one AIRail: no block and no embedded home adds a rail of its own', () => {
  const homes = ['pages/founder/FounderStudioHome.jsx', 'pages/investor/InvestorStudioHome.jsx', 'pages/advisor/AdvisorStudioHome.jsx', 'pages/partner/PartnerStudioHome.jsx'];
  for (const s of [studioSrc, labSrc, blocksSrc, ...homes.map(src)]) {
    assert.ok(!/<(WorkerRail|AssistRail|AssistLayout|RailFrame)\b/.test(s));
  }
});

test('embedded suppresses only the page-owning chrome of each home', () => {
  assert.match(src('pages/investor/InvestorStudioHome.jsx'), /\{!embedded && <h1 data-testid="text-investor-studio-title">Studio<\/h1>\}/);
  assert.match(src('pages/advisor/AdvisorStudioHome.jsx'), /\{!embedded && <h1>Studio<\/h1>\}/);
  const partner = src('pages/partner/PartnerStudioHome.jsx');
  assert.match(partner, /\{!embedded && <h1 data-testid="text-partner-studio-title">Studio<\/h1>\}/);
  assert.match(partner, /const Root = embedded \? 'section' : 'main';/);
  assert.match(src('pages/founder/FounderStudioHome.jsx'), /if \(phone && embedded\) \{/);
});

/* ------------------------------------- D4623 part 2: the Lab block is not the investor view */

// The real SpinoutLabPage, inside the real block page, for a member whose PRIMARY role is Investor. The overview's
// call to action is read from what React drew: Apply (`apply-cta-sub`) or the LP section (`link-lp-workspace`).
async function mountRealLab(licences, primary) {
  const { default: SpinoutLabPage } = await import('../src/pages/SpinoutLabPage.jsx');
  const { AuthProvider } = await import('../src/hooks/useAuthSync.jsx');
  const session = { id: 41, role: primary, name: 'Test Member', licences };
  const before = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    asked.push(path);
    // A member who has not applied: the overview, with its call to action.
    if (/\/spinout-lab\/state\b/.test(path)) return new Response(JSON.stringify({ active: false, admitted: false, is_incorporated: false, application: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  const s = stubs();
  const pages = { lab: SpinoutLabPage, investor: s.make('investor') };
  const page = await mount(
    React.createElement(AuthProvider, null, React.createElement(MultiLicenceSpinoutLab, { licences, activeRole: primary, pages })),
    { seed: () => localStorage.setItem('user', JSON.stringify(session)) },
  );
  return {
    page, s, asked,
    async unmount() { await page.unmount(); globalThis.fetch = before; },
  };
}

// D4623 part 3 (owner decision 2026-11-13): Apply shows only for a Founder holder or an exploring account, the two
// POST /api/spinout-lab/apply accepts. Advisor or Operating Partner without Founder: the Lab block, no Apply, no LP.
for (const [licence, title] of [['advisor', 'Advisor'], ['partner', 'Operating Partner']]) {
  test(`D4623 part 3: Investor-primary with ${title} (no Founder) gets the Lab block without Apply, and without the LP section`, async () => {
    const lab = await mountRealLab(['investor', licence], 'investor');
    try {
      assert.deepEqual(lab.page.titles(), ['Investor', title]);
      const ids = lab.page.testIds();
      assert.ok(lab.asked.some((u) => /\/spinout-lab\/state/.test(u)), 'the Lab page read its state');
      assert.ok(!ids.includes('apply-cta-sub'), 'no Apply section the server would refuse');
      assert.deepEqual(lab.page.applyLinks(), [], 'no Apply link anywhere in the Lab block: hero, section or band');
      assert.ok(!/How to apply/.test(lab.page.text()), 'the closing apply band is not drawn');
      assert.ok(!ids.includes('link-lp-workspace'), 'the Lab block does not repeat the LP section');
      assert.ok(!/Back the graduates\./.test(lab.page.text()));
      assert.ok(/Download the programme brief/.test(lab.page.text()), 'the rest of the Lab overview is still drawn');
      assert.ok(ids.includes('stub-investor'), 'the Investor block is drawn beside it');
    } finally { await lab.unmount(); }
  });
}

test('D4623 part 2/3: Investor-primary with Founder gets Apply in the Lab block', async () => {
  const lab = await mountRealLab(['investor', 'founder'], 'investor');
  try {
    assert.deepEqual(lab.page.titles(), ['Founder', 'Investor']);
    assert.ok(lab.page.testIds().includes('apply-cta-sub'));
    assert.equal(lab.page.applyLinks().length, 3, 'the hero, the Apply section and the apply band');
    assert.ok(!lab.page.testIds().includes('link-lp-workspace'));
  } finally { await lab.unmount(); }
});

test('D4623 part 2: only the Lab block is told it is not the investor view; one licence keeps the page\'s own rule', async () => {
  // Read what the block page hands each page.
  let page;
  const seen = [];
  const rec = (name) => function Rec(props) { seen.push({ name, props }); return React.createElement('div', null, name); };
  for (const licences of [['investor', 'advisor'], ['investor', 'partner'], ['founder', 'investor'], ['advisor', 'partner'], ['founder', 'advisor']]) {
    seen.length = 0;
    page = await mount(React.createElement(MultiLicenceSpinoutLab, { licences, activeRole: licences[0], pages: { lab: rec('lab'), investor: rec('investor') } }));
    try {
      const labProps = seen.find((m) => m.name === 'lab').props;
      assert.equal(labProps.investorView, false, `${licences}: the Lab block is not the investor view`);
      assert.equal(labProps.canApply, licences.includes('founder'), `${licences}: Apply only with Founder held`);
      const inv = seen.find((m) => m.name === 'investor');
      if (inv) assert.deepEqual(inv.props, {}, 'the Investor block is handed nothing new');
    } finally { await page.unmount(); }
  }
  // A single licence (and so an admin preview or an impersonation, which the route never sends here with two) passes
  // nothing: SpinoutLabPage keeps `user.role === 'investor'`.
  for (const licence of ['founder', 'advisor', 'partner', 'investor']) {
    seen.length = 0;
    page = await mount(React.createElement(MultiLicenceSpinoutLab, { licences: [licence], activeRole: licence, pages: { lab: rec('lab'), investor: rec('investor') } }));
    try {
      assert.equal(seen.length > 0, true);
      for (const m of seen) assert.deepEqual(m.props, {}, `${licence}: today's page, with no investorView and no canApply`);
    } finally { await page.unmount(); }
  }
  const labPage = src('pages/SpinoutLabPage.jsx');
  assert.match(labPage, /export default function SpinoutLabPage\(\{ investorView, canApply \} = \{\}\)/);
  assert.match(labPage, /investorView=\{investorView \?\? user\?\.role === 'investor'\}/, 'undefined keeps the primary-role rule');
  assert.match(labPage, /canApply=\{canApply \?\? canApplyToLab\(user\)\}/, 'undefined reads the apply rule from the session');
  // The route still renders SpinoutLabPage bare for every session that is not a multi-licence member's own.
  assert.match(app, /: effectiveRole === 'investor'\s*\?\s*<SpinoutLabInvestorPage \/>\s*:\s*<SpinoutLabPage \/>\)/);
});

test('D4623 part 2: an Investor-only member is unchanged: the sales page alone, no Lab page, no Apply', async () => {
  const { s, labRequests, el } = labWith(['investor']);
  const page = await mount(el);
  try {
    assert.deepEqual(s.mounted.names(), ['investor']);
    assert.deepEqual(labRequests, []);
    assert.ok(!page.testIds().includes('apply-cta-sub'));
    assert.deepEqual(page.applyLinks(), []);
  } finally { await page.unmount(); }
});

test('D4623 part 2/3: SpinoutLabPage on its own: investor gets the LP section, Founder and exploring get Apply, Advisor and Operating Partner neither', async () => {
  // The route's bare <SpinoutLabPage /> (an admin preview, an impersonation, a signed-in single licence) passes no investorView.
  const { default: SpinoutLabPage } = await import('../src/pages/SpinoutLabPage.jsx');
  const { AuthProvider } = await import('../src/hooks/useAuthSync.jsx');
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => (/\/spinout-lab\/state\b/.test(String(url))
    ? new Response(JSON.stringify({ active: false, admitted: false, is_incorporated: false, application: null }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ detail: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } }));
  try {
    // [role, licences, LP section, Apply]. Part 3: a single-licence Advisor or Operating Partner was offered an Apply
    // the server refuses; now neither is offered one. An exploring account holds no licence and may apply.
    for (const [role, licences, lp, apply] of [
      ['investor', ['investor'], true, false],
      ['founder', ['founder'], false, true],
      ['advisor', ['advisor'], false, false],
      ['partner', ['partner'], false, false],
      ['exploring', [], false, true],
    ]) {
      const session = { id: 51, role, name: 'Test Member', licences };
      const page = await mount(React.createElement(AuthProvider, null, React.createElement(SpinoutLabPage)), { seed: () => localStorage.setItem('user', JSON.stringify(session)) });
      try {
        assert.equal(page.testIds().includes('link-lp-workspace'), lp, `${role}: LP section`);
        assert.equal(page.testIds().includes('apply-cta-sub'), apply, `${role}: Apply section`);
        assert.equal(page.applyLinks().length, apply ? 3 : 0, `${role}: Apply links (hero, section, band)`);
      } finally { await page.unmount(); }
    }
  } finally { globalThis.fetch = before; }
});

/* ------------------------- D4623 part 2: the Investor block's own reads, and their failures */

async function studioWithNetwork(licences, answer) {
  const before = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    asked.push(path);
    const [status, body] = answer(path) || [404, { detail: 'Not found' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  const { s, el } = studioWith(licences);
  const page = await mount(el);
  return { s, page, asked, async unmount() { await page.unmount(); globalThis.fetch = before; } };
}

test('D4623 part 2: the Investor block asks for the investor figures of its own licence (?licence=investor)', async () => {
  const summary = { quick_stats: { ai_score_avg: 75 }, proprietary_deal_flow_summary: { total: 5 }, role_view: 'investor' };
  const run = await studioWithNetwork(['founder', 'investor'], (path) => (/\/dashboard\?licence=investor$/.test(path) ? [200, summary] : null));
  try {
    assert.ok(run.asked.some((u) => /\/dashboard\?licence=investor$/.test(u)), 'the summary is read with the investor lens');
    assert.ok(!run.asked.some((u) => /\/dashboard$/.test(u)), 'never the primary licence\'s summary');
    const inv = run.s.mounted.last('investor');
    assert.equal(inv.dashboard.quick_stats.ai_score_avg, 75);
    assert.equal(inv.dashboard.proprietary_deal_flow_summary.total, 5);
    assert.equal(inv.dashboardUnavailable, '');
  } finally { await run.unmount(); }
  // A single-licence Studio is Dashboard, which keeps asking for the primary licence's summary.
  assert.match(src('pages/Dashboard.jsx'), /api\.getDashboard\(fresh\)/);
});

test('D4623 part 2: the summary read failing leaves the lifecycle and every other block drawn', async () => {
  const lifecycle = { stages: [{ id: 'watching', label: 'Watching', count: 2 }], counts: { watching: 2 } };
  const run = await studioWithNetwork(['founder', 'investor', 'advisor'], (path) => (
    /\/dashboard\?licence=investor$/.test(path) ? [503, { error: 'unreadable', detail: 'secret-detail-summary' }]
      : /\/dashboard\/investor-lifecycle$/.test(path) ? [200, lifecycle] : null));
  try {
    assert.deepEqual(run.page.titles(), ['Founder', 'Investor', 'Advisor']);
    for (const id of ['stub-founder', 'stub-investor', 'stub-advisor']) assert.ok(run.page.testIds().includes(id), id);
    const inv = run.s.mounted.last('investor');
    assert.equal(inv.dashboard, null, 'the failed summary is null, not a payload of zeros');
    assert.match(inv.dashboardUnavailable, /^The deal-flow summary could not be read\./);
    assert.ok(!/secret-detail/.test(inv.dashboardUnavailable));
    assert.deepEqual(inv.lifecycle, lifecycle, 'the lifecycle read answered on its own');
    assert.ok(!run.page.testIds().some((t) => t.startsWith('licence-block-failed-')), 'a failed read is not a failed block');
  } finally { await run.unmount(); }
});
