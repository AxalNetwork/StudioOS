/**
 * The owner's phone pass (2026-10-21, a founder on an iPhone):
 *
 *   1. The band's illustration runs up behind the clock: the band takes the
 *      top safe-area inset when it is the shell's first element, instead of
 *      the shell painting that strip grey. A strip above the band (support,
 *      impersonation, the admin's switcher) still keeps the shell's inset
 *      (D504).
 *   2. The band stays put: the shell is the dynamic viewport's height, so iOS
 *      Safari's taller 100vh no longer scrolls the whole shell and the band
 *      with it.
 *   3. The band draws the Axal mark, not an inverted opaque image (a white block).
 *   4. The founder's "Set up the company" step can be skipped for now: the
 *      step's answers are dropped, so no company is made.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_band_onboarding_skip.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { PhoneHeader, BAND_TINT, tintStatusBar } from '../src/ui/phone/PhoneHeader.jsx';
import { AXAL_MARK } from '../src/components/AxalLogo.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import OnboardingWizard from '../src/components/OnboardingWizard.jsx';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const band = () => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/studio'] },
  h(ActiveCompanyContext.Provider, { value: { company: null } }, h(PhoneHeader, { user: { id: 1, name: 'Ada Stone' }, onLogout() {} }))));

test('the band takes the top inset only as the shell\'s first element; the shell keeps it otherwise', () => {
  // Mutations checked: the root's inset left on (a grey strip again); the band's inset without :first-child (two insets under a strip).
  const css = read('frontend/src/index.css');
  assert.match(css, /\.app-shell \{ padding-top: env\(safe-area-inset-top, 0px\); \}/);
  assert.match(css, /\.app-shell:has\(> \[data-phone-band\]:first-child\) \{ padding-top: 0; \}/);
  assert.match(css, /\.app-shell > \[data-phone-band\]:first-child \{ padding-top: env\(safe-area-inset-top, 0px\); \}/);
  const html = band();
  assert.match(html, /<header data-testid="phone-header" data-phone-band="" class="[^"]*\blg:hidden\b/);
  // The 52px row is inside the band, below the inset the band now pads by.
  assert.match(html, /data-phone-band=""[^>]*><div class="relative h-\[52px\]">/);
  assert.doesNotMatch(html, /<header[^>]*\bh-\[52px\]/, 'a fixed 52px band would squeeze its row by the inset');
});

test('the shell is the dynamic viewport\'s height and carries the inset by class, once', () => {
  // Mutation checked: the 100dvh height dropped.
  const app = codeOnly(read('frontend/src/App.jsx'));
  const at = app.indexOf('<div className="app-shell ');
  assert.ok(at > 0, 'the shell root lost its class');
  const root = app.slice(at, app.indexOf('>', at) + 1);
  assert.match(root, /\bh-screen\b/, 'the fallback for a browser without dvh');
  assert.match(root, /style=\{\{ height: '100dvh' \}\}/);
  assert.equal(app.split('safe-area-inset-top').length - 1, 0, 'the inset is the stylesheet\'s now, never inline as well');
});

test('the band draws the Axal mark on a white chip, and tints the status bar while it is drawn', () => {
  // Mutations checked: the inverted /axal-logo.png back; the theme colour left on after the band goes.
  const html = band();
  assert.ok(html.includes(`src="${AXAL_MARK}"`), 'the band does not draw the mark');
  assert.doesNotMatch(html, /axal-logo\.png|brightness-0 invert/);
  assert.match(html, />Axal VC</);

  const attrs = { content: '#7c3aed' };
  const meta = { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null) };
  const untint = tintStatusBar(doc);
  assert.equal(attrs.content, BAND_TINT);
  untint();
  assert.equal(attrs.content, '#7c3aed', 'the page\'s own theme colour comes back');
  assert.doesNotThrow(() => tintStatusBar({ querySelector: () => null })(), 'a page without the tag');
  assert.match(codeOnly(read('frontend/src/ui/phone/PhoneHeader.jsx')), /useEffect\(\(\) => tintStatusBar\(typeof document === 'undefined' \? null : document\), \[\]\);/);
});

/** The wizard mounted on its last step, with a progress row to resume from. */
async function mountWizard(steps, data, step) {
  const original = { get: api.onboardingGetProgress, save: api.onboardingSaveProgress, complete: api.onboardingComplete };
  const saved = [];
  const completed = [];
  const finished = [];
  api.onboardingGetProgress = async () => ({ flow: 'founder', step, data });
  api.onboardingSaveProgress = async (body) => { saved.push(body); return {}; };
  api.onboardingComplete = async (flow) => { completed.push(flow); return {}; };
  const m = await mountContracts(h(OnboardingWizard, { flow: 'founder', steps, onFinish: (v) => finished.push(v) }), '/onboarding/founder');
  // The wizard tells the shell it finished (ONBOARDING_COMPLETE_EVENT); the test window has no dispatcher of its own.
  const realDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = () => true;
  for (let i = 0; i < 4; i += 1) await m.flush();
  return {
    ...m, saved, completed, finished,
    async press(testid) {
      const node = m.nodes().find((n) => m.props(n)?.['data-testid'] === testid);
      assert.ok(node, `${testid} is not drawn`);
      await act(async () => { await m.props(node).onClick(); });
      for (let i = 0; i < 4; i += 1) await m.flush();
    },
    has: (testid) => m.nodes().some((n) => m.props(n)?.['data-testid'] === testid),
    async close() { await m.unmount(); globalThis.dispatchEvent = realDispatch; api.onboardingGetProgress = original.get; api.onboardingSaveProgress = original.save; api.onboardingComplete = original.complete; },
  };
}

const COMPANY_KEYS = ['company_name', 'jurisdiction', 'stage_detail', 'first_workspace', 'primary_need', 'problem', 'full_name'];

test('Skip for now on the last step finishes without the step\'s answers and without its validation', async () => {
  // Mutations checked: the answers saved as typed; the validation run on a skip; onboarding not completed.
  let validated = 0;
  const steps = [
    { key: 'origin', title: 'Origin', render: () => null },
    { key: 'company', title: 'Set up the company', render: () => null,
      validate: () => { validated += 1; return 'Add a working name for the venture'; },
      skip: { label: 'Skip for now', clears: COMPANY_KEYS } },
  ];
  const w = await mountWizard(steps, { company_name: 'Bot not', primary_need: 'Capital', stage: 'operating' }, 1);
  try {
    assert.ok(w.has('onboarding-skip-step'));
    await w.press('onboarding-skip-step');
    assert.equal(validated, 0, 'a skip ran the step\'s validation');
    assert.deepEqual(w.completed, ['founder']);
    assert.deepEqual(w.saved.at(-1).data, { stage: 'operating' }, 'the company answers were saved');
    assert.deepEqual(w.finished, [{ stage: 'operating' }]);
  } finally { await w.close(); }
});

test('a step without skip offers none, and a skip mid-flow moves to the next step', async () => {
  // Mutation checked: the skip drawn on every step.
  const steps = [
    { key: 'one', title: 'One', render: () => null, skip: { label: 'Skip for now', clears: ['x'] } },
    { key: 'two', title: 'Two', render: () => null },
  ];
  const w = await mountWizard(steps, { x: 'typed', y: 'kept' }, 0);
  try {
    await w.press('onboarding-skip-step');
    assert.deepEqual(w.completed, [], 'a mid-flow skip finished onboarding');
    assert.deepEqual(w.saved.at(-1), { flow: 'founder', step: 1, total_steps: 2, data: { y: 'kept' } });
    assert.equal(w.has('onboarding-skip-step'), false, 'step two has no skip');
  } finally { await w.close(); }
});

test('the founder\'s company step offers Skip for now and drops all seven of its answers', () => {
  const src = codeOnly(read('frontend/src/pages/OnboardingFounderPage.jsx'));
  const at = src.indexOf("key: 'company'");
  const step = src.slice(at, src.indexOf('render:', at));
  assert.match(step, /skip: \{\s*label: 'Skip for now',\s*clears: \['company_name', 'jurisdiction', 'stage_detail', 'first_workspace', 'primary_need', 'problem', 'full_name'\],\s*\}/);
  // The Worker makes a company only from a name: without one the projection is skipped.
  assert.match(read('cloudflare-worker/src/services/onboardingProjection.ts'), /const name = text\(d\.company_name\);\s*if \(!name\) return null;/);
});
