/**
 * D4618 (#4618, part) — interaction regressions for the Account behaviour
 * #4615, #4616 and #4617 repaired. The Worker's half is
 * cloudflare-worker/test/account_concurrency_4618.test.ts.
 *
 * The earlier tests pin these repairs on the pure helpers (SerialSaver, the
 * savers, sessionRowState, buildCatalogue) and, for the page wiring, on the
 * source text of SettingsPage.jsx. These mount the real page (or the real
 * card or hook) with `fetch` stubbed, answer each request when the test
 * chooses, and read what the member would see and what was sent:
 *
 *   · overlapping saves on Visibility, Digest & categories and the public
 *     profile switches (one request in flight, the revision read, a delayed
 *     response that cannot pull the view back, another tab's 409 adopted);
 *   · the sessions card drawn from each row's status;
 *   · the Display name field writing the identity display_name;
 *   · one billing overview shared by Payment details and the dashboard, and
 *     invalidated by a card mutation, with a partial (degraded) read said;
 *   · auto-reload's reads arriving in either order, and the packs' Retry;
 *   · the connector catalogue read succeeding while the connection list fails.
 *
 * Each test names the fix it guards; documentation/architecture/decisions/D4618.md records the mutation that
 * was made to check it fails without that fix.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_regressions_4618.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { register } from 'node:module';
import { installDocument } from './_contracts_dom.mjs';

// SettingsPage reaches modules that read `import.meta.env` at load; this hook gives them one (as owner_plan_prices_3702).
register(new URL('./_airailRender-hook.mjs', import.meta.url));
const { default: SettingsPage } = await import('../src/pages/SettingsPage.jsx');
const { default: AutoReloadCard, AutoReloadForm } = await import('../src/pages/account/AutoReloadCard.jsx');
const { useConnectors } = await import('../src/pages/account/ConnectorSheet.jsx');
const { cardAction } = await import('../src/pages/account/connectorsModel.js');
const { NO_CARD } = await import('../src/pages/account/billingModel.js');

const h = React.createElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * `fetch` answered by `route(method, path, body, query)`: a value is sent as
 * JSON (200), a Response as is, and a promise when the test settles it. Every
 * call is recorded, in order.
 */
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

async function mountElement(element, { url = '/account', route }) {
  const restoreDoc = installDocument();
  const prevMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const net = stubFetch(route);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const settle = async (rounds = 4) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await tick(); }); };
  /** A browser does not fire a disabled control; neither do these. */
  const fire = async (node, what, event) => {
    assert.ok(node, `the control for ${what} is drawn`);
    assert.ok(!props(node).disabled, `${what} can be used`);
    // Not awaited, as a browser does not wait for a handler: a save left pending must not hold the test.
    await act(async () => { props(node)[event.type === 'blur' ? 'onBlur' : event.type === 'click' ? 'onClick' : 'onChange']?.(event); });
    await settle(2);
  };
  return {
    nodes, props, settle, calls: net.calls,
    text: () => squash(textOf(container)),
    /** The checkbox inside the <label> whose words start with `label`. */
    checkbox(label) {
      return nodes().find((n) => n.tagName === 'INPUT' && props(n).type === 'checkbox'
        && (props(n)['aria-label'] === label || (n.parentNode?.tagName === 'LABEL' && squash(textOf(n.parentNode)).startsWith(label))));
    },
    button(label) { return nodes().filter((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label); },
    async toggle(label, checked) { await fire(this.checkbox(label), label, { type: 'change', target: { checked } }); },
    async choose(node, value, what) { await fire(node, what, { type: 'change', target: { value } }); },
    async click(node, what) { await fire(node, what, { type: 'click', preventDefault() {}, stopPropagation() {} }); },
    async blur(node, what) { await fire(node, what, { type: 'blur', target: { value: props(node).value } }); },
    async unmount() {
      await act(async () => root.unmount());
      net.restore();
      globalThis.matchMedia = prevMatch;
      restoreDoc();
    },
  };
}

const ACCOUNT = {
  id: 7, uid: 'u-synthetic', role: 'founder', name: 'Mel Member', display_name: null, public_name: 'Mel Member',
  email: 'mel@example.test', profile: {}, privacy_prefs: {},
  public_profile_effective: { name: true, bio: true, headshot: true, socials: false, background: true, projects: true, traction: true },
  public_profile_revision: 5,
};
const mountPage = (url, route, account = ACCOUNT) => mountElement(h(SettingsPage), {
  url,
  route: (method, path, body, query) => (method === 'GET' && path === '/settings' ? account : route(method, path, body, query)),
});
const sent = (m, method, path) => m.calls.filter((c) => c.method === method && c.path === path);

// ─────────────────────────────────────────────────────────────── D4615

test('Visibility: an edit made while a save is out is queued, sent with the returned revision, and never pulled back', async () => {
  // Guards D4615 §5 on the real card (PrivacyCoreCard → privacySaver → SerialSaver).
  const puts = [];
  const m = await mountPage('/account/security-privacy', (method, path) => {
    if (path === '/settings/privacy' && method === 'GET') {
      return { visibility: 'public', show_in_directory: true, discoverable: true, matching_opt_in: false, matching_eligible: true, revision: 3 };
    }
    if (path === '/settings/privacy' && method === 'PUT') { const d = deferred(); puts.push(d); return d.promise; }
    return {};
  });
  try {
    await m.settle();
    const select = () => m.nodes().find((n) => n.tagName === 'SELECT' && (n.childNodes || []).some((o) => squash(textOf(o)) === 'Hidden — only you'));
    assert.equal(m.props(select()).value, 'public');

    await m.choose(select(), 'private', 'Profile visibility');
    assert.deepEqual(sent(m, 'PUT', '/settings/privacy').map((c) => c.body), [{ visibility: 'private', expected_revision: 3 }], 'one field, with the revision read');
    assert.equal(m.props(select()).value, 'private', 'the choice shows at once');

    // A second edit while the first is out: drawn at once, held back, the control still usable.
    await m.toggle('Show me in the Public Directory', false);
    assert.equal(sent(m, 'PUT', '/settings/privacy').length, 1, 'one request in flight');
    assert.equal(m.props(m.checkbox('Show me in the Public Directory')).checked, false);

    // The first answer arrives late and still says the directory listing is on: it must not pull the view back.
    puts[0].resolve(json({ visibility: 'private', show_in_directory: true, discoverable: true, matching_opt_in: false, revision: 4 }));
    await m.settle();
    assert.deepEqual(sent(m, 'PUT', '/settings/privacy').map((c) => c.body)[1], { show_in_directory: false, expected_revision: 4 },
      'the queued edit went next, with the revision the first save returned');
    assert.equal(m.props(m.checkbox('Show me in the Public Directory')).checked, false, 'the delayed answer did not undo the newer choice');
    assert.equal(m.props(select()).value, 'private');

    puts[1].resolve(json({ visibility: 'private', show_in_directory: false, discoverable: true, matching_opt_in: false, revision: 5 }));
    await m.settle();
    assert.equal(sent(m, 'PUT', '/settings/privacy').length, 2, 'nothing else to send');
    assert.equal(m.props(select()).value, 'private');
    assert.equal(m.props(m.checkbox('Show me in the Public Directory')).checked, false);
  } finally { await m.unmount(); }
});

test('Visibility: a 409 from another tab adopts its values and says so; a failed save drops only its own edit', async () => {
  const puts = [];
  const m = await mountPage('/account/security-privacy', (method, path) => {
    if (path === '/settings/privacy' && method === 'GET') {
      return { visibility: 'public', show_in_directory: true, discoverable: true, matching_opt_in: false, matching_eligible: true, revision: 3 };
    }
    if (path === '/settings/privacy' && method === 'PUT') { const d = deferred(); puts.push(d); return d.promise; }
    return {};
  });
  try {
    await m.settle();
    await m.toggle('Show me in the Public Directory', false);
    await m.toggle('Allow advisors and founders to discover me for matching', false);
    assert.equal(sent(m, 'PUT', '/settings/privacy').length, 1);
    puts[0].resolve(json({
      error: 'These settings changed in another tab or save since you opened them, so nothing was saved.',
      code: 'privacy_conflict',
      current: { visibility: 'network', show_in_directory: true, discoverable: true, matching_opt_in: false, matching_eligible: true, revision: 6 },
    }, 409));
    await m.settle();
    assert.equal(sent(m, 'PUT', '/settings/privacy').length, 1, 'this tab\'s stale queued edit was not sent over the other tab\'s save');
    assert.equal(m.props(m.checkbox('Show me in the Public Directory')).checked, true, 'the other tab\'s values are shown');
    assert.equal(m.props(m.checkbox('Allow advisors and founders to discover me for matching')).checked, true);
    assert.match(m.text(), /Changed in another tab or device since you opened it/);

    // A fresh edit names the adopted revision; when it fails, only it goes back.
    await m.toggle('Allow advisors and founders to discover me for matching', false);
    assert.deepEqual(sent(m, 'PUT', '/settings/privacy')[1].body, { discoverable: false, expected_revision: 6 });
    puts[1].resolve(json({ error: 'The store is down.' }, 503));
    await m.settle();
    assert.equal(m.props(m.checkbox('Allow advisors and founders to discover me for matching')).checked, true, 'the failed edit shows what is stored');
    assert.match(m.text(), /The store is down\./);
  } finally { await m.unmount(); }
});

test('Digest & categories: switches drawn as delivery reads them; one category per save, queued behind the one in flight', async () => {
  // Guards D4615 §4–5 on the real card (DigestQuietHoursCard → notificationSaver, categorySwitches).
  const puts = [];
  const m = await mountPage('/account/notifications', (method, path) => {
    if (path === '/settings/notifications' && method === 'GET') {
      return {
        digest_frequency: 'weekly', notif_categories_email: { deals: false }, notif_categories_inapp: {},
        effective_categories: {
          email: { mentions: true, deals: false, calendar: true, scoring: true, billing: true, proactive_nudges: true },
          inapp: { mentions: true, deals: true, calendar: true, scoring: true, billing: true, proactive_nudges: true },
          locked: ['billing'],
        },
        quiet_hours_start: null, quiet_hours_end: null, quiet_hours_tz: 'UTC', revision: 2,
      };
    }
    if (path === '/settings/notifications' && method === 'PUT') { const d = deferred(); puts.push(d); return d.promise; }
    return {};
  });
  try {
    await m.settle();
    const box = (label) => m.checkbox(label);
    assert.equal(m.props(box('Mentions & comments by email')).checked, true, 'nothing stored reads on, as delivery sends it');
    assert.equal(m.props(box('Deal flow & pipeline by email')).checked, false);
    assert.equal(m.props(box('Billing & invoices by email')).checked, true);
    assert.equal(m.props(box('Billing & invoices by email')).disabled, true, 'a mandatory category is locked on');

    await m.toggle('Mentions & comments by email', false);
    await m.toggle('Deal flow & pipeline in-app', false);
    const bodies = () => sent(m, 'PUT', '/settings/notifications').map((c) => c.body);
    assert.deepEqual(bodies(), [{ notif_categories_email: { mentions: false }, expected_revision: 2 }], 'one category, not the whole map; the second waits');
    assert.equal(m.props(box('Deal flow & pipeline in-app')).checked, false, 'the queued choice shows at once');

    puts[0].resolve(json({
      digest_frequency: 'weekly', notif_categories_email: { deals: false, mentions: false }, notif_categories_inapp: {},
      effective_categories: { email: { mentions: false, deals: false, billing: true }, inapp: { deals: true, billing: true }, locked: ['billing'] },
      revision: 3,
    }));
    await m.settle();
    assert.deepEqual(bodies()[1], { notif_categories_inapp: { deals: false }, expected_revision: 3 });
    assert.equal(m.props(box('Deal flow & pipeline in-app')).checked, false, 'the first answer did not pull the queued choice back');
    assert.equal(m.props(box('Mentions & comments by email')).checked, false);
    puts[1].resolve(json({ notif_categories_email: { deals: false, mentions: false }, notif_categories_inapp: { deals: false }, revision: 4 }));
    await m.settle();
  } finally { await m.unmount(); }
});

test('Public profile: a switch saves only itself with the revision read, drawn from what the profile shows', async () => {
  // Guards D4615 §2–3 on the real card (PrivacySection → publicProfileSaver).
  const puts = [];
  const m = await mountPage('/account/security-privacy', (method, path) => {
    if (path === '/settings/privacy/public-profile' && method === 'PUT') { const d = deferred(); puts.push(d); return d.promise; }
    if (path === '/settings/privacy') return { visibility: 'public', show_in_directory: true, discoverable: true, revision: 0 };
    return {};
  });
  try {
    await m.settle();
    assert.equal(m.props(m.checkbox('Social links')).checked, false, 'the role default the profile is served with');
    assert.equal(m.props(m.checkbox('Background')).checked, true);
    await m.toggle('Social links', true);
    await m.toggle('Bio', false);
    assert.deepEqual(sent(m, 'PUT', '/settings/privacy/public-profile').map((c) => c.body), [{ fields: { socials: true }, expected_revision: 5 }]);
    assert.equal(sent(m, 'PATCH', '/settings').length, 0, 'no whole-map privacy_prefs save');
    puts[0].resolve(json({ public_profile_effective: { ...ACCOUNT.public_profile_effective, socials: true }, public_profile_revision: 6 }));
    await m.settle();
    assert.deepEqual(sent(m, 'PUT', '/settings/privacy/public-profile')[1].body, { fields: { bio: false }, expected_revision: 6 });
    assert.equal(m.props(m.checkbox('Bio')).checked, false, 'the queued switch was not pulled back by the first answer');
    assert.equal(m.props(m.checkbox('Social links')).checked, true);
    puts[1].resolve(json({ public_profile_effective: { ...ACCOUNT.public_profile_effective, socials: true, bio: false }, public_profile_revision: 7 }));
    await m.settle();
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────────── D4616

test('Sessions: each row drawn from its status; only an active one offers Revoke, and revoking reloads the list', async () => {
  // Guards D4616 §1–2 on the real card (AuthSection → sessionRowState).
  let revoked = false;
  const rows = () => [
    { id: 11, user_agent: 'Synthetic browser A', is_current: true, status: 'active', revoked_at: null },
    { id: 12, user_agent: 'Synthetic browser B', is_current: false, status: revoked ? 'revoked' : 'active', revoked_at: revoked ? '2026-11-10 10:00:00' : null },
    { id: 13, user_agent: 'Synthetic browser C', is_current: false, status: 'expired', revoked_at: null },
    { id: 14, user_agent: 'Synthetic browser D', is_current: false, status: 'signed_out', revoked_at: null },
  ];
  const m = await mountPage('/account/security-privacy', (method, path) => {
    if (path === '/settings/sessions') return { sessions: rows(), active_count: revoked ? 1 : 2 };
    if (path === '/settings/sessions/12/revoke') { revoked = true; return { ok: true }; }
    return {};
  });
  const prevConfirm = globalThis.confirm;
  let asked = 0;
  globalThis.confirm = () => { asked += 1; return true; };
  try {
    await m.settle();
    const row = (agent) => m.nodes().find((n) => n.tagName === 'TR' && squash(textOf(n)).startsWith(agent));
    const words = (agent) => squash(textOf(row(agent)));
    assert.match(words('Synthetic browser A'), /This device/);
    assert.doesNotMatch(words('Synthetic browser B'), /This device/);
    assert.match(words('Synthetic browser C'), /Expired$/);
    assert.match(words('Synthetic browser D'), /Signed out$/);
    assert.equal(m.button('Revoke').length, 2, 'an expired or signed-out session is history, not a device to revoke');

    const revokeB = m.nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === 'Revoke' && row('Synthetic browser B').childNodes.flatMap(function w(c) { return [c, ...(c.childNodes || []).flatMap(w)]; }).includes(n));
    await m.click(revokeB, 'Revoke (browser B)');
    await m.settle();
    assert.equal(asked, 0, 'another device is revoked without the this-device warning');
    assert.equal(sent(m, 'POST', '/settings/sessions/12/revoke').length, 1);
    assert.equal(sent(m, 'GET', '/settings/sessions').length, 2, 'the list is read again');
    assert.match(words('Synthetic browser B'), /Revoked$/);
    assert.equal(m.button('Revoke').length, 1);
  } finally { globalThis.confirm = prevConfirm; await m.unmount(); }
});

test('Display name edits the identity display_name, never the account name, and the preview follows it', async () => {
  // Guards D4616 §3 on the real card (ProfileSection → updateIdentitySettings, effectiveDisplayName).
  const m = await mountPage('/account', (method, path, body) => {
    if (path === '/settings/profile/identity' && method === 'PUT') return { display_name: body?.display_name ?? null };
    return {};
  }, { ...ACCOUNT, display_name: 'Mel M.', public_name: 'Mel M.' });
  try {
    await m.settle();
    const input = () => m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).maxLength === 100 && m.props(n).placeholder === 'Mel Member');
    assert.equal(m.props(input()).value, 'Mel M.', 'the field shows the stored display name, not the account name');
    assert.match(m.text(), /Mel M\./, 'the preview shows the name other members see');

    await m.choose(input(), 'Mel Q.', 'Display name');
    await m.blur(input(), 'Display name');
    assert.deepEqual(sent(m, 'PUT', '/settings/profile/identity').map((c) => c.body), [{ display_name: 'Mel Q.' }]);
    assert.equal(sent(m, 'PATCH', '/settings').filter((c) => c.body && 'name' in c.body).length, 0, 'the account name is not written');
    assert.match(m.text(), /Mel Q\./);

    await m.choose(input(), '', 'Display name');
    await m.blur(input(), 'Display name');
    assert.deepEqual(sent(m, 'PUT', '/settings/profile/identity')[1].body, { display_name: null }, 'a blank value clears it');
    assert.doesNotMatch(m.text(), /Mel Q\./, 'cleared, the preview falls back to the account name');
  } finally { await m.unmount(); }
});

// ─────────────────────────────────────────────────────────────── D4617

const card = (id, brand, last4, is_default) => ({ id, brand, last4, exp_month: 4, exp_year: 2031, is_default });
const overview = (defaultId, extra = {}) => ({
  has_customer: true, stripe_configured: true, subscriptions: [], invoices: [], payments: [], degraded: [],
  payment_methods: [card('pm_a', 'visa', '4242', defaultId === 'pm_a'), card('pm_b', 'mastercard', '5555', defaultId === 'pm_b')],
  ...extra,
});
const PARTNER = { ...ACCOUNT, role: 'partner' };

test('Billing: Payment details and the dashboard share one overview read, and a card mutation refreshes both', async () => {
  // Guards D4617 (shared invalidation): BillingTab's one read handed to both; refreshAll reloads that read.
  let defaultId = 'pm_a';
  const m = await mountPage('/account/billing', (method, path, body) => {
    if (path === '/billing/overview') return overview(defaultId);
    if (path === '/billing/plan/status') return { plan_group: null, status: 'free', has_customer: true };
    if (path === '/billing/payment-method/default' && method === 'POST') { defaultId = body.payment_method_id; return { ok: true }; }
    return {};
  }, PARTNER);
  try {
    await m.settle(6);
    const paymentCard = () => squash(textOf(m.nodes().find((n) => m.props(n)['data-testid'] === 'value-payment-card')));
    assert.equal(sent(m, 'GET', '/billing/overview').length, 1, 'one overview read on the page, not one per view');
    assert.match(paymentCard(), /^Visa •••• 4242\b/);
    const makeDefault = m.button('Make default');
    assert.equal(makeDefault.length, 1, 'the dashboard lists the non-default card');
    await m.click(makeDefault[0], 'Make default');
    await m.settle(6);
    assert.deepEqual(sent(m, 'POST', '/billing/payment-method/default').map((c) => c.body.payment_method_id), ['pm_b']);
    assert.equal(sent(m, 'GET', '/billing/overview').length, 2, 'the shared read was invalidated once');
    assert.match(paymentCard(), /^Mastercard •••• 5555\b/, 'Payment details shows the new default without reopening the page');
    assert.equal(m.button('Make default').length, 1, 'and the dashboard lists the other card as the one to promote');
  } finally { await m.unmount(); }
});

test('Billing: a degraded payment-methods read is said as unreadable in both views, and Retry re-reads the shared overview', async () => {
  // Guards D4617 (partial success): `degraded: ['payment_methods']` is never drawn as "no card".
  let attempt = 0;
  const m = await mountPage('/account/billing', (method, path) => {
    if (path === '/billing/overview') {
      attempt += 1;
      return attempt === 1 ? overview('pm_a', { payment_methods: [], degraded: ['payment_methods'] }) : overview('pm_a');
    }
    if (path === '/billing/plan/status') return { plan_group: null, status: 'free', has_customer: true };
    return {};
  }, PARTNER);
  try {
    await m.settle(6);
    const text = m.text();
    assert.match(text, /Your saved cards could not be read\. This is not a claim that no card is saved\./, 'the dashboard says it');
    assert.doesNotMatch(text, /No card on file/);
    assert.ok(!text.includes(NO_CARD), 'Payment details does not say no card is saved');
    assert.ok(m.nodes().some((n) => m.props(n)['data-testid'] === 'billing-payment-methods-unreadable'));
    assert.equal(m.nodes().find((n) => m.props(n)['data-testid'] === 'value-payment-card'), undefined, 'Payment details claims no card either way');
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === 'Retry'
      && squash(textOf(n.parentNode)).startsWith('Your saved cards could not be read'));
    await m.click(retry, 'Retry (saved cards)');
    await m.settle(6);
    assert.equal(sent(m, 'GET', '/billing/overview').length, 2);
    assert.match(squash(textOf(m.nodes().find((n) => m.props(n)['data-testid'] === 'value-payment-card'))), /^Visa •••• 4242\b/, 'the retried read reached Payment details too');
  } finally { await m.unmount(); }
});

const PACK_LIST = { packs: [{ uid: 'pack25', label: '$25 of tokens' }, { uid: 'pack50', label: '$50 of tokens' }] };
const NEVER_SAVED = { enabled: false, pack_uid: null, threshold_usd: null, card: null, card_unreadable: false, last_attempt_at: null, last_outcome: null, disabled_reason: null };

function budgetApi() {
  const pending = { autoReload: [], topUp: [], spendLimit: [] };
  const take = (k) => () => { const d = deferred(); pending[k].push(d); return d.promise; };
  return { pending, api: { autoReload: take('autoReload'), topUp: take('topUp'), spendLimit: take('spendLimit') } };
}

for (const order of ['settings first', 'packs first']) {
  test(`Auto-reload: a member who never saved a pack gets the first one on sale, whichever read lands first (${order})`, async () => {
    // Guards D4617 (either response order): the pack is chosen once the packs are known, not only at mount.
    const b = budgetApi();
    const m = await mountElement(h(AutoReloadCard, { api: b.api }), { url: '/account/billing', route: () => ({}) });
    try {
      b.pending.spendLimit[0].resolve(null);
      const steps = [() => b.pending.autoReload[0].resolve(NEVER_SAVED), () => b.pending.topUp[0].resolve(PACK_LIST)];
      if (order === 'packs first') steps.reverse();
      for (const step of steps) { step(); await m.settle(); }
      const select = m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-pack');
      assert.ok(select, 'the pack choice is drawn');
      assert.equal(m.props(select).value, 'pack25');
      await m.choose(m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-threshold'), '10', 'threshold');
      assert.equal(m.props(m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-save')).disabled, false, 'it can be saved');
    } finally { await m.unmount(); }
  });
}

test('Auto-reload: a failed packs read offers Retry, which reads them again and then offers them', async () => {
  // Guards D4617 (pack retry): the unreadable packs state is recoverable in place.
  const b = budgetApi();
  const m = await mountElement(h(AutoReloadCard, { api: b.api }), { url: '/account/billing', route: () => ({}) });
  try {
    b.pending.spendLimit[0].resolve(null);
    b.pending.autoReload[0].resolve(NEVER_SAVED);
    b.pending.topUp[0].reject(Object.assign(new Error('The store is down.'), { status: 503 }));
    await m.settle();
    const unreadable = m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-packs-unreadable');
    assert.match(squash(textOf(unreadable)), /not a claim that none is available/i);
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && unreadable && [unreadable].flatMap(function w(c) { return [c, ...(c.childNodes || []).flatMap(w)]; }).includes(n));
    await m.click(retry, 'Retry (token packs)');
    assert.equal(b.pending.topUp.length, 2, 'the packs were read again');
    b.pending.topUp[1].resolve(PACK_LIST);
    await m.settle();
    assert.equal(m.props(m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-pack')).value, 'pack25');
  } finally { await m.unmount(); }
});

test('Auto-reload: a refreshed pack list keeps the member\'s unsaved pick', async () => {
  // Guards D4617 (preserve unsaved edits): a new list of packs never replaces a pick already made.
  const PACKS = PACK_LIST.packs;
  let rerender;
  function Host() {
    const [packs, setPacks] = React.useState(PACKS);
    rerender = setPacks;
    return h(AutoReloadForm, { settings: NEVER_SAVED, packs, packsRead: { status: 'ready', data: {}, reload() {} }, api: {} });
  }
  const m = await mountElement(h(Host), { url: '/account/billing', route: () => ({}) });
  try {
    const select = () => m.nodes().find((n) => m.props(n)['data-testid'] === 'auto-reload-pack');
    assert.equal(m.props(select()).value, 'pack25');
    await m.choose(select(), 'pack50', 'pack');
    await act(async () => { rerender([...PACKS, { uid: 'pack100', label: '$100 of tokens' }]); });
    await m.settle();
    assert.equal(m.props(select()).value, 'pack50', 'a list with a new pack in it does not reset the pick');
  } finally { await m.unmount(); }
});

const PROVIDERS = [
  { key: 'stripe', display_name: 'Stripe', integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'oauth2', description: 'Stripe description.', capabilities: [], has_implementation: true, locked_for_user: false },
  { key: 'calendly', display_name: 'Calendly', integration_type: 'scheduling', status: 'live', tier: 'free', auth_type: 'oauth2', supports_pat: true, description: 'Calendly description.', capabilities: [], has_implementation: true, locked_for_user: false },
];

test('Connectors: the catalogue read succeeds while the connection list fails; descriptions stay, no row claims to be unconnected', async () => {
  // Guards D4617 (connection read status): useConnectors hands `connectionsReadable` to the catalogue.
  let failList = true;
  let seen = null;
  function Probe() { seen = useConnectors(); return null; }
  const m = await mountElement(h(Probe), {
    url: '/account/connectors',
    route: (method, path) => {
      if (path === '/connectors/available') return { providers: PROVIDERS };
      if (path === '/connectors') return failList ? json({ error: 'The store is down.' }, 503) : { items: [{ uid: 'u-s', provider_key: 'stripe', status: 'active', config: {} }] };
      return {};
    },
  });
  try {
    await m.settle(6);
    assert.equal(seen.status, 'ready', 'the catalogue is still readable');
    const stripe = seen.catalogue.find((p) => p.key === 'stripe');
    assert.equal(stripe.description, 'Stripe description.');
    assert.equal(stripe.connectionUnreadable, true);
    for (const key of ['stripe', 'calendly']) assert.equal(cardAction(seen.catalogue.find((p) => p.key === key)), 'unavailable', `${key}: unknown is not drawn as addable`);

    failList = false;
    await act(async () => { seen.reload(); });
    await m.settle(6);
    assert.equal(cardAction(seen.catalogue.find((p) => p.key === 'stripe')), 'connected', 'a successful read restores the real state');
    assert.notEqual(cardAction(seen.catalogue.find((p) => p.key === 'calendly')), 'unavailable');
  } finally { await m.unmount(); }
});
