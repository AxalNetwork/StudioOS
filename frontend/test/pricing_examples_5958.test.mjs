/**
 * D5958 (#5958, canvas D5957 PR-E1 to PR-E8 and PR-C1 to PR-C6): /pricing's "What a paid plan produces" on the Founder
 * tab, and the worded phone comparison.
 *
 *   - every example is labelled (Demonstration), with source facts, Eadwyn's interpretation and limitations apart;
 *   - no price, plan or entitlement text, customer logo, testimonial, figure or compliance claim is added;
 *   - the Investor research example is not shown, and nothing stands in its place;
 *   - the section is Founder-only and renders while the plan read is loading or unreadable;
 *   - "See <plan>" scrolls to and focuses that plan's card, and never opens checkout;
 *   - a signed-in founder sees In your plan / Not in your plan; an unknown plan marks nothing;
 *   - the phone comparison says Included / Not included in words, and its chips wrap.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_examples_5958.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  AFTER_THE_RAISE, DEMONSTRATION, EXAMPLE_TABS, HOW_IT_CONNECTS, OUTCOME_EXAMPLES, examplesFor, inPlanLine,
} from '../src/lib/pricingExamples.js';
import { COMPARE, PLAN_CARDS } from '../src/lib/sitePricing.js';
import { OutcomeExamples, PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const allText = (ex) => [ex.title, ex.summary, ex.limitations, ...ex.facts, ...ex.generated].map((l) => (typeof l === 'string' ? l : Object.values(l).join(' '))).join(' ');

// ---------------------------------------------------------------- the copy

test('every example is labelled Demonstration and keeps facts, interpretation and limitations apart', () => {
  assert.ok(OUTCOME_EXAMPLES.length >= 2);
  for (const ex of OUTCOME_EXAMPLES) {
    assert.equal(ex.label, DEMONSTRATION, `${ex.id} has its label`);
    assert.ok(ex.facts.length > 0 && ex.generated.length > 0 && ex.limitations, `${ex.id} has all three parts`);
    assert.match(ex.limitations, /^Sample data\./, `${ex.id} says it is sample data`);
  }
  // A test fails if an example has no label (the acceptance criterion), whatever else it carries.
  const unlabelled = OUTCOME_EXAMPLES.filter((ex) => ![DEMONSTRATION, 'Real evidence, shared with permission'].includes(ex.label));
  assert.deepEqual(unlabelled, []);
});

test('the two founder examples, as drawn: evidence and planning on Validate + Build, the fundraising workflow on Raise + Grow', () => {
  assert.deepEqual(OUTCOME_EXAMPLES.map((ex) => [ex.id, ex.plan, ex.planName]), [
    ['evidence-planning', 'growth', 'Validate + Build'],
    ['fundraising-workflow', 'studio', 'Raise + Grow'],
  ]);
  // The plan named is the card's own name, so the button reads the card it scrolls to.
  for (const ex of OUTCOME_EXAMPLES) assert.equal(PLAN_CARDS.founder.find((c) => c.id === ex.plan).name, ex.planName);
  assert.deepEqual(HOW_IT_CONNECTS.map((s) => s.step), ['Customer evidence', 'Fundraising narrative', 'Controlled sharing', 'Follow-up']);
});

test('no price, figure, logo, testimonial or compliance claim; every value in an example is bracketed sample', () => {
  for (const ex of OUTCOME_EXAMPLES) {
    const t = allText(ex);
    assert.doesNotMatch(t, /\$|€|£|\d+\s*%|per month|\/ ?month|SOC ?2|ISO ?27001|GDPR|HIPAA|compliant|certified|testimonial|trusted by/i, ex.id);
    // Every digit sits inside brackets: no real count, date or figure is stated.
    const outside = t.replace(/\[[^\]]*\]/g, '').replace(/\[[^\]]*\]/g, '');
    assert.doesNotMatch(outside, /\d/, `${ex.id} states a figure outside sample brackets`);
  }
});

test('After the raise names only what the comparison already gives Raise + Grow alone', () => {
  const grow = COMPARE.founder.find(([t]) => t === 'Grow')[1];
  const studioOnly = grow.filter((r) => r[1] === 0 && r[2] === 0 && r[3] === 1).map((r) => r[0]);
  assert.deepEqual([...AFTER_THE_RAISE.items], studioOnly);
  assert.equal(AFTER_THE_RAISE.plan, 'studio');
});

test('Founder tab only; the Investor research example is not listed, and nothing stands in its place', () => {
  assert.deepEqual([...EXAMPLE_TABS], ['founder']);
  for (const tab of ['investor', 'advisor', 'partner', 'models']) assert.deepEqual(examplesFor(tab), [], tab);
  assert.equal(examplesFor('founder'), OUTCOME_EXAMPLES);
  assert.ok(!OUTCOME_EXAMPLES.some((ex) => /investor research|Investor Plus/i.test(`${ex.title} ${ex.planName}`)));
  assert.equal(renderToStaticMarkup(h(OutcomeExamples, { tab: 'investor' })), '', 'nothing is drawn on the Investor tab');
});

test('a signed-in founder sees In your plan or Not in your plan; a visitor or an unknown plan sees nothing', () => {
  const [ev, raise] = OUTCOME_EXAMPLES;
  assert.equal(inPlanLine(ev, null), null);
  assert.equal(inPlanLine(ev, 'enterprise'), null);
  assert.equal(inPlanLine(ev, 'constructor'), null);
  assert.deepEqual(inPlanLine(ev, 'free'), { yes: false, text: 'Not in your plan' });
  assert.deepEqual(inPlanLine(ev, 'growth'), { yes: true, text: 'In your plan' });
  assert.deepEqual(inPlanLine(raise, 'growth'), { yes: false, text: 'Not in your plan' });
  assert.deepEqual(inPlanLine(raise, 'studio'), { yes: true, text: 'In your plan' });
  const html = renderToStaticMarkup(h(OutcomeExamples, { tab: 'founder', held: 'growth' }));
  assert.match(html, /In your plan/);
  assert.match(html, /Not in your plan/);
  assert.doesNotMatch(renderToStaticMarkup(h(OutcomeExamples, { tab: 'founder' })), /in your plan/i);
});

test('the section draws every example with its label, its three headings and See <plan>, then How it connects and After the raise', () => {
  const html = renderToStaticMarkup(h(OutcomeExamples, { tab: 'founder' }));
  assert.match(html, /<h2[^>]*>What a paid plan produces<\/h2>/);
  assert.equal((html.match(/>Demonstration</g) || []).length, OUTCOME_EXAMPLES.length);
  assert.equal((html.match(/>Source facts</g) || []).length, OUTCOME_EXAMPLES.length);
  assert.equal((html.match(/>Limitations</g) || []).length, OUTCOME_EXAMPLES.length);
  assert.equal((html.match(/Generated/g) || []).length, OUTCOME_EXAMPLES.length);
  for (const ex of OUTCOME_EXAMPLES) assert.ok(html.includes(`See ${ex.planName}`), ex.id);
  assert.ok(html.indexOf('How it connects') > html.lastIndexOf('See '), 'the steps follow the examples');
  assert.ok(html.indexOf('After the raise') > html.indexOf('How it connects'));
  assert.match(html, /Examples written by Axal VC with sample data\. Not your data\./);
});

// ---------------------------------------------------------------- the page

function harness() {
  const restore = installDocument();
  // No geometry in this DOM: the audience tabs' scroll-into-view effect is browser-only (as pricing_tab_comparisons stubs it).
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  return { restore, container, root, walk, text, props, byId, settle };
}

test('the examples render while the plan read is still loading, and when it is unreadable', async () => {
  const original = { ...publicPricingApi };
  for (const [state, call] of [['loading', () => new Promise(() => {})], ['unreadable', async () => { throw Object.assign(new Error('boom'), { status: 500 }); }]]) {
    const t = harness();
    publicPricingApi.plansAndPacks = call;
    try {
      await act(async () => t.root.render(h(MemoryRouter, { initialEntries: ['/pricing'] }, h(PricingBody, { user: null }))));
      await t.settle();
      assert.ok(t.byId('pricing-examples'), `examples shown while ${state}`);
      assert.ok(t.byId('pricing-example-label-evidence-planning'));
    } finally {
      await act(async () => t.root.unmount());
      Object.assign(publicPricingApi, original);
      t.restore();
    }
  }
});

test('See <plan> scrolls to that plan card and focuses it; it never opens checkout', async () => {
  const t = harness();
  const original = { ...publicPricingApi };
  try {
    await act(async () => t.root.render(h(MemoryRouter, null, h(OutcomeExamples, { tab: 'founder' }))));
    const calls = [];
    const card = { scrollIntoView: (o) => calls.push(['scroll', o.block]), focus: (o) => calls.push(['focus', o.preventScroll]) };
    const was = document.getElementById;
    document.getElementById = (id) => (id === 'pricing-card-studio' ? card : null);
    try {
      await act(async () => { t.props(t.byId('pricing-example-see-fundraising-workflow')).onClick(); });
      // A missing card (plans unreadable) does nothing rather than throw.
      await act(async () => { t.props(t.byId('pricing-example-see-evidence-planning')).onClick(); });
    } finally { document.getElementById = was; }
    assert.deepEqual(calls, [['scroll', 'center'], ['focus', true]]);
    const src = read('../src/pages/PricingPage.jsx');
    const fn = src.slice(src.indexOf('function seePlan'), src.indexOf('export function OutcomeExamples'));
    assert.doesNotMatch(fn, /checkout|Checkout|navigate/, 'See <plan> never opens checkout');
  } finally {
    await act(async () => t.root.unmount());
    Object.assign(publicPricingApi, original);
    t.restore();
  }
});

test('wiring: Founder examples sit between the AI band and Compare plans; plan cards take focus', () => {
  const src = read('../src/pages/PricingPage.jsx');
  const body = src.slice(src.indexOf('export function PricingBody'));
  const band = body.indexOf('AI_BAND.kick');
  const ex = body.indexOf('<OutcomeExamples tab={tab} held={heldCard(user, role, tab, planRead)} />');
  const cmp = body.indexOf('<Compare key=');
  assert.ok(band > 0 && ex > band && cmp > ex, 'AI band, then examples, then Compare plans');
  assert.match(body, /\{roleTab && <OutcomeExamples/, 'not gated on the plan read being ready');
  assert.match(src, /id=\{`pricing-card-\$\{card\.id\}`\} tabIndex=\{-1\}/);
});

test('phone comparison: cells in words, chips wrap with no sideways scroll, every chip a 44px target', () => {
  const src = read('../src/pages/PricingPage.jsx');
  assert.match(src, /c\.tick && <><span className="axp-tick" aria-hidden="true">\{TICK\}<\/span>Included<\/>/);
  assert.match(src, /c\.dash && <><span className="axp-dash" aria-hidden="true">—<\/span>Not included<\/>/);
  assert.match(src, /\{phoneCell\(r\[1 \+ at\], 'v'/);
  // #4655's tab semantics on the chips are kept.
  assert.match(src, /role="tab" id=\{`pricing-plan-\$\{c\.id\}`\}/);
  const css = read('../src/pages/pricing.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.axp-chips \{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; \}/);
  assert.doesNotMatch(css, /\.axp-chips \{[^}]*overflow-x: auto/);
  assert.match(css, /\.axp-chip \{ display: inline-flex; align-items: center; gap: 5px; min-height: 44px; \}/);
  // The examples stack on a phone, inside the 640 container block.
  const at = css.indexOf('@container (max-width: 640px) {');
  assert.match(css.slice(at), /\.axp-ex-grid, \.axp-ex-flow ol \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
