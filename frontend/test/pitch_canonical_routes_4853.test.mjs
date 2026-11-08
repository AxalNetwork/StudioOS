/**
 * #4853 — Raise's Pitch entries all open the one Pitch Studio.
 *
 * The live finding (7 Nov 2026, `/raise?project_id=12`): the Raise overview's
 * "Pitch" tab named `/raise/pitch-deck?project_id=12` and its "Share the deck
 * with an investor" action named `/raise/pitch-deck/new?project=12`, the module
 * cycle's older Add form, while the redesigned Studio is `/raise/pitch/*`.
 *
 * What this holds:
 *   - the pure rules: a legacy Pitch address maps to its canonical one, the
 *     venture rides as `project_id`, every other query key and the hash stay,
 *     and a record page or another module is left alone;
 *   - the Raise overview as drawn: its Pitch tab, its Pitch card link and the
 *     share CTA name `/raise/pitch…` and no `pitch-deck` address, whether the
 *     read sent the canonical href or an older legacy one;
 *   - the whole App, from those very links: each lands on the Studio with its
 *     page marker, the venture kept, and the two legacy addresses redirect (by
 *     replacement, so the Back button does not bounce) to the canonical ones;
 *   - the Worker's own read says the same (cloudflare-worker tests).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_canonical_routes_4853.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CycleOverview from '../src/pages/cycles/CycleOverview.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { cycleTabs, nextHref, safeHref } from '../src/pages/cycles/cycleModel.js';
import { LEGACY_PITCH_PATHS, PITCH_PATH, PITCH_SHARE_PATH, canonicalPitchHref, ventureSearch } from '../src/pages/raise/pitch/pitchRoutes.js';
import { newLinkHref } from '../src/pages/raise/pitch/pitchStudioModel.js';
import { card } from './_cycle_fixtures.mjs';

const h = React.createElement;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const APP = read('frontend/src/App.jsx');

test('1. the pure rules: the two legacy addresses map to the Studio, the venture rides as project_id, the rest is kept', () => {
  // Mutation checked: `project` left as written → the Studio, which reads project_id only, loses the venture.
  assert.deepEqual(LEGACY_PITCH_PATHS, { '/raise/pitch-deck': '/raise/pitch', '/raise/pitch-deck/new': '/raise/pitch/share' });
  assert.deepEqual([PITCH_PATH, PITCH_SHARE_PATH], ['/raise/pitch', '/raise/pitch/share']);
  for (const [from, to] of [
    ['/raise/pitch-deck', '/raise/pitch'],
    ['/raise/pitch-deck?project=12', '/raise/pitch?project_id=12'],
    ['/raise/pitch-deck?project_id=12', '/raise/pitch?project_id=12'],
    ['/raise/pitch-deck/new?project=12', '/raise/pitch/share?project_id=12'],
    ['/raise/pitch-deck/new', '/raise/pitch/share'],
    ['/raise/pitch-deck/new?project=12&utm=mail#top', '/raise/pitch/share?utm=mail&project_id=12#top'],
    ['/raise/pitch-deck?project=3&project_id=9', '/raise/pitch?project_id=9'],
  ]) assert.equal(canonicalPitchHref(from), to, from);
  // Left alone: a record page, other modules, the canonical addresses, anything not a path.
  for (const same of ['/raise/pitch-deck/41?project=3', '/raise/data-room?project=3', '/raise/pitch?project_id=3', '/raise/pitch/share', '/raise/pitch-decks', 'https://x.test/raise/pitch-deck', '//x.test/raise/pitch-deck'])
    assert.equal(canonicalPitchHref(same), same, same);
  assert.equal(canonicalPitchHref(null), null);
  assert.equal(ventureSearch('?project=7&x=1'), '?x=1&project_id=7');
  assert.equal(ventureSearch(''), '');
  assert.equal(ventureSearch('?'), '');
});

test('2. the read-side rules link the canonical address: a tab, a next step and a safe href, whatever the read sent', () => {
  const tabs = cycleTabs('raise', MODULES.raise.map((m) => ({ slug: m.slug, name: m.name })), null, '?project_id=12');
  const pitch = tabs.find((t) => t.key === 'pitch-deck');
  assert.equal(pitch.href, '/raise/pitch?project_id=12', 'the Pitch tab opens the Studio');
  assert.equal(tabs.find((t) => t.key === 'data-room').href, '/raise/data-room?project_id=12', 'the other modules keep their own pages');
  assert.deepEqual(tabs.filter((t) => /pitch-deck/.test(t.href)), [], 'no tab names a pitch-deck address');
  assert.equal(nextHref('/raise/pitch-deck/new?project=12', '?project_id=12'), '/raise/pitch/share?project_id=12', 'an older read still lands on the Share tab');
  assert.equal(nextHref('/raise/pitch/share?project_id=12', ''), '/raise/pitch/share?project_id=12');
  assert.equal(safeHref('/raise/pitch-deck?project=12'), '/raise/pitch?project_id=12');
  assert.equal(safeHref('//evil.test/x'), null);
  // The Studio's "New link" reads the canonical address, and the old one an older read may still carry.
  assert.equal(newLinkHref({ add: { href: '/raise/pitch/share?project_id=7' } }), '/raise/pitch/share?project_id=7');
  assert.equal(newLinkHref({ add: { href: '/raise/pitch-deck/new?project=7' } }), '/raise/pitch-deck/new?project=7');
  assert.equal(newLinkHref({ add: { href: '/raise/data-room/new?project=7' } }), null);
});

/** The Raise overview as drawn at `/raise?project_id=12`, with the Pitch card's next step as `href`. */
function overviewHrefs(href) {
  const cards = MODULES.raise.map((m, i) => card('raise', m.name, i, m.slug === 'pitch-deck'
    ? { slug: m.slug, next: { text: 'Share the deck with an investor', href } }
    : { slug: m.slug }));
  const data = { cycle: 'raise', question: 'Are you ready to raise?', figures: [], cards };
  const out = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/raise?project_id=12'] }, h(CycleOverview, { cycle: 'raise', data, search: '?project_id=12' })));
  return [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

test('3. the Raise overview: the Pitch tab, the Pitch card and the share CTA all name the Studio, never a pitch-deck address', () => {
  // Mutation checked: the tab or the card link built from the bare module slug → `/raise/pitch-deck?project_id=12` is drawn.
  for (const sent of ['/raise/pitch/share?project_id=12', '/raise/pitch-deck/new?project=12']) {
    const hrefs = overviewHrefs(sent);
    assert.deepEqual(hrefs.filter((x) => /pitch-deck/.test(x)), [], `${sent}: no link names a pitch-deck address`);
    assert.ok(hrefs.includes('/raise/pitch?project_id=12'), `${sent}: the Pitch tab and card open the Studio`);
    assert.ok(hrefs.includes('/raise/pitch/share?project_id=12'), `${sent}: the share CTA opens the Share tab`);
  }
});

const settled = { kyc_status: 'approved', access_level: 'full', onboarding_complete: 1, terms_acceptance_pending: false };
const FOUNDER = { id: 9601, role: 'founder', email: 'founder@p4853.test', name: 'Founder P4853', ...settled };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The whole App for a founder, at `route`: where it landed, what it drew and how it got there. */
async function appAt(route) {
  register(new URL('./_airailRender-hook.mjs', import.meta.url));
  const { installAppDom, select } = await import('./_appDom.mjs');
  const App = (await import('../src/App.jsx')).default;
  const fetch = async (input) => {
    const url = String(input?.url || input);
    if (/\/api\/auth\/me(\?|$)/.test(url)) return json(FOUNDER);
    if (/\/api\/onboarding\/progress/.test(url)) return json({ flow: null, completed_at: '2026-01-01T00:00:00Z' });
    // The studio's plan gate (D4359): this founder's plan covers it.
    if (/\/api\/decks\/access(\?|$)/.test(url)) return json({ open: true, required: 'studio', plan: { tier: 'studio', name: 'Raise + Grow', plan_key: 'studio' }, message: '' });
    return json({});
  };
  const dom = installAppDom({ fetch });
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('user', JSON.stringify(FOUNDER));
  const seen = [];
  function Landed() { const l = useLocation(); seen.push(`${l.pathname}${l.search}${l.hash}`); return null; }
  const host = dom.document.createElement('div'); dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console; console.error = () => {}; console.warn = () => {};
  try {
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: [route] }, h(App), h(Landed))); });
    for (let i = 0; i < 60; i += 1) await act(() => new Promise((r) => setImmediate(() => setTimeout(r, 5))));
    // The Studio's page marker: `pitch-studio-<tab>`, one per tab (the mini DOM takes exact attribute selectors only).
    const marks = ['overview', 'decks', 'script', 'analytics', 'gate-loading', 'unread', 'locked'].filter((t) => select(dom.document, `[data-testid="pitch-studio-${t}"]`).length)
      .map((t) => `pitch-studio-${t}`);
    return { landed: seen.at(-1), path: [...new Set(seen)], marks };
  } finally {
    await act(async () => root.unmount());
    host.remove(); dom.timers.clear(); dom.restore?.();
    console.error = error; console.warn = warn;
  }
}

test('4. from Raise: the Pitch tab and the share CTA each open the Studio, the venture kept, with the Studio\'s page marker', async () => {
  // Mutation checked: the Pitch tab left on /raise/pitch-deck → it lands on /raise/pitch only through the redirect, and this sees the extra hop.
  const hrefs = overviewHrefs('/raise/pitch/share?project_id=12');
  const pitchTab = hrefs.find((x) => /^\/raise\/pitch(\?|$)/.test(x));
  const shareCta = hrefs.find((x) => /^\/raise\/pitch\/share(\?|$)/.test(x));
  assert.deepEqual([pitchTab, shareCta], ['/raise/pitch?project_id=12', '/raise/pitch/share?project_id=12']);
  const tab = await appAt(pitchTab);
  assert.equal(tab.landed, '/raise/pitch?project_id=12');
  assert.deepEqual(tab.path, ['/raise/pitch?project_id=12'], 'no bounce between route families');
  assert.ok(tab.marks.includes('pitch-studio-overview'), `Overview drawn, got ${JSON.stringify(tab.marks)}`);
  const share = await appAt(shareCta);
  assert.equal(share.landed, '/raise/pitch/share?project_id=12');
  assert.deepEqual(share.path, ['/raise/pitch/share?project_id=12']);
  assert.ok(share.marks.includes('pitch-studio-analytics'), `Share & analytics drawn, got ${JSON.stringify(share.marks)}`);
});

test('5. the legacy addresses redirect to the canonical ones, the venture, the other parameters and the hash kept', async () => {
  // Mutation checked: the new-link route removed → /raise/pitch-deck/new opens the module's Add form again, and this fails.
  const root = await appAt('/raise/pitch-deck?project=12#top');
  assert.equal(root.landed, '/raise/pitch?project_id=12#top');
  assert.ok(root.marks.includes('pitch-studio-overview'));
  const add = await appAt('/raise/pitch-deck/new?project=12&utm=mail');
  assert.equal(add.landed, '/raise/pitch/share?utm=mail&project_id=12');
  assert.ok(add.marks.includes('pitch-studio-analytics'), `got ${JSON.stringify(add.marks)}`);
  assert.ok(!add.path.some((p) => /pitch-deck/.test(p) && p !== add.path[0]), 'it leaves the legacy address once');
});

test('6. the redirects replace, so the Back button does not bounce, and rank above the module cycle\'s own routes', () => {
  assert.match(APP, /function KeepQueryRedirect\(\{ to \}\)[\s\S]{0,500}<Navigate to=\{\{ pathname: to, search: ventureSearch\(loc\.search\), hash: loc\.hash \}\} replace \/>/);
  assert.match(APP, /path="\/raise\/pitch-deck" element=\{<KeepQueryRedirect to="\/raise\/pitch" \/>\}/);
  assert.match(APP, /path="\/raise\/pitch-deck\/new" element=\{<KeepQueryRedirect to="\/raise\/pitch\/share" \/>\}/);
  assert.ok(APP.indexOf('path="/raise/pitch-deck/new"') < APP.indexOf('path="/raise/:slug/new"'));
  assert.ok(APP.indexOf('path="/raise/pitch-deck"') < APP.indexOf('path="/raise/:slug"'));
});

test('7. no founder-facing source names a pitch-deck address: the Worker, the calls model and the integration labels use the Studio', () => {
  const raise = read('cloudflare-worker/src/services/raiseCycle.ts');
  assert.doesNotMatch(raise, /addHref\(ctx, 'pitch-deck'\)|href\(ctx, 'pitch-deck'\)/, 'the Worker links the Studio');
  assert.match(raise, /const pitchHref = \(ctx: Ctx\) => `\/raise\/pitch\?project_id=\$\{ctx\.projectId\}`;/);
  assert.match(raise, /const shareHref = \(ctx: Ctx\) => `\/raise\/pitch\/share\?project_id=\$\{ctx\.projectId\}`;/);
  assert.match(read('frontend/src/pages/raise/calls/callsModel.js'), /deck: \{ tool: 'Pitch deck', path: '\/raise\/pitch' \}/);
  assert.match(read('cloudflare-worker/src/integrations/moduleLabels.ts'), /pitch_deck: '\/raise\/pitch',/);
});
