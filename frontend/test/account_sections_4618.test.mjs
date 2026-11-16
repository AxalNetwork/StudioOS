/**
 * D4618 part 2 (#4618) — the extracted Account sections, driven as a member drives them.
 *
 * Profile, the entity records, Privacy, Notifications and Billing moved out of SettingsPage.jsx (see
 * documentation/architecture/decisions/D4618-p2.md); Privacy, Notifications and Billing now load with their section
 * through `account/lazySection.jsx`. These mount the real boundary, or the real page with `fetch` stubbed, answer
 * each request or module load when the test chooses, and read what the member sees and what was sent:
 *
 *   · a deferred section module: its place holds a loading line while the rest of the pane draws;
 *   · a module that fails to load, or a card that throws: only that card says Unreadable, and Try again loads it;
 *   · a hash naming a card inside a deferred module is scrolled to once the module draws;
 *   · Notifications (matrix): a deferred read draws no switch; a save in flight holds every other switch and preset
 *     (no overlapping whole-map PUT); a refused save puts its switch back and says so; a failed Slack read hides only
 *     the Slack column (partial success);
 *   · shared invalidation between an extracted card and the page: a deletion request re-reads the account, and the
 *     card draws what the page re-read.
 *
 * The overlapping-save, partial-read and shared-overview paths of Visibility, Digest & categories, the public
 * profile and Billing stay in account_regressions_4618.test.mjs, which mounts the same page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_sections_4618.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { register } from 'node:module';
import { installDocument } from './_contracts_dom.mjs';

register(new URL('./_airailRender-hook.mjs', import.meta.url));
const { default: SettingsPage } = await import('../src/pages/SettingsPage.jsx');
// Loaded first, as the page's own sections would be by the time a member acts, so a mount draws them within the
// settle rounds below (and Stripe's loader, evaluated here, finds no document).
await Promise.all(['PrivacySections', 'NotificationSections', 'BillingSection'].map((f) => import(`../src/pages/account/${f}.jsx`)));
const { lazySection } = await import('../src/pages/account/lazySection.jsx');
const { NOTIFICATION_EVENTS } = await import('../src/lib/notificationTypes.js');

const h = React.createElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(route) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const full = String(url).replace(/^.*?\/api(?=\/)/, '');
    const [path, query = ''] = full.split('?');
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    calls.push({ method, path, query, body });
    const out = await route(method, path, body, query);
    if (out instanceof Response) return out;
    return json(out ?? {});
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

async function mount(element, { url = '/account', route = () => ({}) } = {}) {
  const restoreDoc = installDocument();
  const prevMatch = globalThis.matchMedia;
  const prevConfirm = globalThis.confirm;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.confirm = () => true;
  const net = stubFetch(route);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  // The fake document keeps ids in React's props only; a scroll is recorded by the id it reached.
  const scrolled = [];
  document.getElementById = (id) => {
    const n = nodes().find((x) => props(x).id === id);
    return n ? { scrollIntoView: () => scrolled.push(id) } : null;
  };
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  const settle = async (rounds = 4) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await tick(); }); };
  const byTestId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    nodes, props, settle, byTestId, scrolled, calls: net.calls,
    text: () => squash(textOf(container)),
    button(label) { return nodes().filter((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label); },
    async click(node, what) {
      assert.ok(node, `the control for ${what} is drawn`);
      assert.ok(!props(node).disabled, `${what} can be used`);
      await act(async () => { props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle(2);
    },
    async unmount() {
      await act(async () => root.unmount());
      net.restore();
      globalThis.matchMedia = prevMatch;
      globalThis.confirm = prevConfirm;
      restoreDoc();
    },
  };
}

// ─────────────────────────────────────────────────────────── the section boundary

function Card({ label = 'Section card', id }) {
  return h('div', { 'data-testid': 'section-card', id }, label);
}
const Beside = () => h('div', { 'data-testid': 'beside' }, 'Sign-in cards');

test('a deferred section holds its place with a loading line while the rest of the pane draws, then draws itself', async () => {
  const load = deferred();
  let loads = 0;
  const Section = lazySection(() => { loads += 1; return load.promise; }, 'Notifications', 'Card');
  const m = await mount(h('div', null, h(Beside), h(Section, { label: 'Matrix' })));
  try {
    await m.settle();
    assert.equal(m.byTestId('beside').length, 1, 'the cards beside it are drawn while it loads');
    assert.equal(m.byTestId('account-section-loading').length, 1, 'its place says it is loading');
    assert.equal(m.byTestId('section-card').length, 0);
    load.resolve({ Card });
    await m.settle();
    assert.equal(m.byTestId('account-section-loading').length, 0);
    assert.equal(squash(textOf(m.byTestId('section-card')[0])), 'Matrix', 'drawn with the props the page passed');
    assert.equal(loads, 1, 'the module was asked for once');
  } finally { await m.unmount(); }
});

test('a section whose module cannot load says so alone, and Try again asks for the module afresh', async () => {
  // Guards the retry in lazySection: React.lazy keeps a failed load for good, so Try again must make a new one.
  const attempts = [];
  const Section = lazySection(() => { const d = deferred(); attempts.push(d); return d.promise; }, 'Billing and orders', 'Card');
  const m = await mount(h('div', null, h(Beside), h(Section)));
  try {
    await m.settle();
    attempts[0].reject(new Error('Failed to fetch dynamically imported module'));
    await m.settle();
    assert.equal(m.byTestId('account-section-unreadable').length, 1, 'the section says it could not load');
    assert.match(m.text(), /Billing and orders/);
    assert.equal(m.byTestId('beside').length, 1, 'the rest of the pane stays');
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && /try again|retry/i.test(squash(textOf(n))));
    await m.click(retry, 'Try again');
    assert.equal(attempts.length, 2, 'Try again asked for the module again');
    attempts[1].resolve({ Card });
    await m.settle();
    assert.equal(m.byTestId('account-section-unreadable').length, 0);
    assert.equal(m.byTestId('section-card').length, 1, 'the second load drew the section');
  } finally { await m.unmount(); }
});

test('a card that throws while drawing, or a module without the named card, fails alone and never blanks the page', async () => {
  const Broken = () => { throw new Error('a card broke'); };
  const Throws = lazySection(() => Promise.resolve({ Card: Broken }), 'Public profile', 'Card');
  const Missing = lazySection(() => Promise.resolve({}), 'Profile visibility', 'Card');
  const Fine = lazySection(() => Promise.resolve({ Card }), 'Cohort advisor access', 'Card');
  const prevError = console.error;
  console.error = () => {}; // React reports the caught error; the test reads the page instead.
  const m = await mount(h('div', null, h(Beside), h(Throws), h(Missing), h(Fine)));
  try {
    await m.settle();
    assert.equal(m.byTestId('account-section-unreadable').length, 2, 'each failed card says so on its own');
    assert.match(m.text(), /Public profile/);
    assert.match(m.text(), /Profile visibility/);
    assert.equal(m.byTestId('section-card').length, 1, 'the card that loaded is drawn');
    assert.equal(m.byTestId('beside').length, 1);
  } finally { console.error = prevError; await m.unmount(); }
});

test('a hash naming a card inside a deferred module is scrolled to once the module draws', async () => {
  const load = deferred();
  const Section = lazySection(() => load.promise, 'Billing and orders', 'Card');
  const m = await mount(h(Section, { id: 'persona-price-growth' }), { url: '/account/billing#persona-price-growth' });
  try {
    await m.settle();
    assert.deepEqual(m.scrolled, [], 'nothing to scroll to while the module loads');
    load.resolve({ Card });
    await m.settle();
    assert.deepEqual(m.scrolled, ['persona-price-growth'], 'the card the address names was scrolled to');
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────── the real page

const ACCOUNT = {
  id: 7, uid: 'u-synthetic', role: 'founder', name: 'Mel Member', display_name: null, public_name: 'Mel Member',
  email: 'mel@example.test', profile: {}, privacy_prefs: {},
  public_profile_effective: { name: true, bio: true, headshot: true, socials: false, background: true, projects: true, traction: true },
  public_profile_revision: 5,
};
const mountPage = (url, route, account = ACCOUNT) => mount(h(SettingsPage), {
  url,
  route: (method, path, body, query) => (method === 'GET' && path === '/settings' ? (typeof account === 'function' ? account() : account) : route(method, path, body, query)),
});
const sent = (m, method, path) => m.calls.filter((c) => c.method === method && c.path === path);
const OPEN = NOTIFICATION_EVENTS.filter((e) => !(e.lockedChannels || []).length).slice(0, 2).map((e) => e.key);
const sw = (m, key, channel) => m.byTestId(`switch-${key}-${channel}`)[0];
const on = (m, node) => m.props(node)['aria-checked'] === 'true';

test('Notifications: a deferred read draws no switch; a save in flight holds every other switch and preset; a refused save puts its switch back', async () => {
  // Guards the matrix's one-writer rule (D568): the whole map is PUT, so a second save while one is out would race it.
  const read = deferred();
  const puts = [];
  const m = await mountPage('/account/notifications', (method, path) => {
    if (path === '/notifications/prefs' && method === 'GET') return read.promise;
    if (path === '/notifications/prefs' && method === 'PUT') { const d = deferred(); puts.push(d); return d.promise; }
    if (path === '/integrations') return { items: [] };
    return {};
  });
  try {
    await m.settle();
    assert.equal(m.byTestId(`switch-${OPEN[0]}-email`).length, 0, 'no switch is drawn before the read lands');
    read.resolve(json({ prefs: { [OPEN[0]]: { email: false } } }));
    await m.settle();
    assert.equal(on(m, sw(m, OPEN[0], 'email')), false, 'drawn from what the route served');
    assert.equal(on(m, sw(m, OPEN[1], 'email')), true, 'an unset switch is drawn as delivery reads it: on');

    await m.click(sw(m, OPEN[0], 'email'), 'the first email switch');
    assert.equal(sent(m, 'PUT', '/notifications/prefs').length, 1);
    assert.equal(sent(m, 'PUT', '/notifications/prefs')[0].body.prefs[OPEN[0]].email, true, 'the whole map, with the switch turned on');
    assert.equal(on(m, sw(m, OPEN[0], 'email')), true, 'the choice shows at once');
    assert.ok(m.props(sw(m, OPEN[1], 'email')).disabled, 'another switch waits while the save is out');
    const preset = m.nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)).startsWith('Everything'));
    assert.ok(preset, 'a preset is drawn');
    assert.ok(m.props(preset).disabled, 'a preset waits too');

    puts[0].resolve(json({ error: 'Your notification settings could not be saved. Nothing changed.' }, 400));
    await m.settle();
    assert.equal(on(m, sw(m, OPEN[0], 'email')), false, 'the refused choice is put back');
    assert.ok(m.nodes().some((n) => m.props(n).role === 'alert'), 'and the card says so');
    assert.equal(m.props(sw(m, OPEN[1], 'email')).disabled, false, 'the other switches are usable again');
    assert.equal(sent(m, 'PUT', '/notifications/prefs').length, 1, 'nothing was sent behind the refused save');
  } finally { await m.unmount(); }
});

test('Notifications: a failed Slack read hides only the Slack column; the matrix still draws (partial success)', async () => {
  const m = await mountPage('/account/notifications', (method, path) => {
    if (path === '/notifications/prefs' && method === 'GET') return { prefs: {} };
    if (path === '/integrations') return json({ error: 'Unavailable' }, 503);
    return {};
  });
  try {
    await m.settle(6);
    assert.ok(sw(m, OPEN[0], 'email'), 'the matrix is drawn from the read that worked');
    assert.equal(m.byTestId(`switch-${OPEN[0]}-slack`).length, 0, 'no Slack switch on a read that failed (fail closed)');
    assert.match(m.text(), /Slack joins this table once it is connected in/);
    assert.doesNotMatch(m.text(), /Your notification settings could not be read|Unreadable/i, 'the matrix is not said to be unreadable');
  } finally { await m.unmount(); }
});

test('Profile: a deletion request from the extracted card re-reads the account, and the card draws what the page re-read', async () => {
  // Guards the shared invalidation between AccountDeletionCard (SettingsPage.jsx, kept with #4614's set) and the page's one
  // account read: the card hands its change back through `reload`, never a copy of its own.
  let requested = null;
  const m = await mountPage('/account', (method, path) => {
    if (path === '/settings/account/delete-request' && method === 'POST') { requested = '2026-11-16T09:00:00Z'; return { message: 'Deletion request submitted' }; }
    return {};
  }, () => ({ ...ACCOUNT, deletion_requested_at: requested }));
  try {
    await m.settle(6);
    assert.equal(sent(m, 'GET', '/settings').length, 1);
    await m.click(m.button('Request account deletion')[0], 'Request account deletion');
    await m.settle(4);
    assert.equal(sent(m, 'POST', '/settings/account/delete-request').length, 1);
    assert.equal(sent(m, 'GET', '/settings').length, 2, 'the page re-read the account once');
    assert.match(m.text(), /Deletion requested/, 'the card draws the request from the re-read account');
    assert.equal(m.button('Cancel request').length, 1);
    assert.equal(m.button('Request account deletion').length, 0);
  } finally { await m.unmount(); }
});
