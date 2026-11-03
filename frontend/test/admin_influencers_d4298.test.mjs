/**
 * D4298 (#4298, D4289 P9) — Admin › Programs › Influencers (IN11): the
 * Applications queue and its answers drawer, the Influencers table with its
 * row actions and flagged sign-ups, Offers, Payouts and Settings.
 *
 * What this file holds the page to (#4298's "Done when"):
 *   · every tab draws at its static address, and the bare address opens Applications;
 *   · money is the Super Admin's: an admin reads "HQ reads", never a zero; the
 *     Super Admin reads each currency on its own line;
 *   · every action asks for a reason before it writes (row change, flag, offer);
 *     admit names a tier instead;
 *   · only the Super Admin edits the tier defaults or links an offer;
 *   · Payouts are Commissions' queue, opened on its source.
 * Every person here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_influencers_d4298.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import { routeFor } from '../src/pages/admin/programs/programsModel.js';
import {
  HQ_READS, NOT_RECORDED, REASON_MIN, TABS, changeBody, decisionBody, defaultCells, defaultsBody, moneyLines, rowActions,
} from '../src/pages/admin/programs/influencersModel.js';
import { sourceFromAddress } from '../src/pages/admin/AdminCommissions.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };
const ADMIN = { id: 902, role: 'admin', is_super_admin: 0, name: 'Pat', email: 'pat@example.com' };
const HQ = { available: false, reason: 'hq_reads' };
const NR = (source) => ({ available: false, reason: 'not_recorded', ...(source ? { source } : {}) });
const REASON = 'Audience checked against the rules.';

const member = (uid, o = {}) => ({
  uid, user_uid: `u-${uid}`, handle: uid, tier: 'verified_influencer', tier_label: 'Verified Influencer', status: 'active',
  person: { name: `Person ${uid}`, role: 'investor' }, signups: 2, visits: NR('handle_visits'), paid_members: NR(), revenue: HQ, commission: HQ, ...o,
});
const application = (uid, o = {}) => ({
  uid, status: 'applied', consent_version: '2026-10', reason: null, created_at: '2026-10-20 10:00:00',
  applicant: { name: `Applicant ${uid}` },
  answers: { channels: [{ kind: 'YouTube', url: 'https://youtube.example/a', audience: 12000 }, { kind: 'Newsletter', url: 'https://news.example/a', audience: null }], regions: ['EU'], topics: ['Venture'], why: 'I teach founders.' },
  ...o,
});
const TIERS = [
  { tier: 'affiliate_creator', label: 'Affiliate Creator', percentage_bps: 1000, duration_invoices: 12, offer_budget_cents: null, currency: 'USD' },
  { tier: 'strategic_partner', label: 'Strategic Partner', percentage_bps: null, duration_invoices: null, offer_budget_cents: 50000, currency: 'USD' },
];
const OFFER = (uid, o = {}) => ({ uid, status: 'active', code: 'JANE20', discount: '20% off', plans: ['investor_pro'], budget: { cents: 100000, currency: 'USD' }, uses: 3, discount_given: [{ cents: 6000, currency: 'USD' }], ...o });

function worker(o = {}) {
  const {
    user = null, list = { influencers: [member('jane', { handle: 'jane' }), member('lee', { status: 'paused', handle: null })], counts: { active: 1, paused: 1, ended: 0 } },
    apps = { applications: [application('a1')], counts: { applied: 1, more_requested: 0 } }, flags = { flags: [{ uid: 'f1', handle: 'jane', reason: 'self_email_domain', created_at: '2026-10-21 10:00:00' }] },
    tiers = { tiers: TIERS }, offers = { offers: [OFFER('o1')] },
  } = o;
  const call = (v, ...a) => { const out = typeof v === 'function' ? v(...a) : v; return out && typeof out.json === 'function' ? out : response(out); };
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (method !== 'GET') return response({ ok: true }, method === 'POST' && /\/offers$/.test(path) ? 201 : 200);
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path === '/api/admin/influencers') return call(list);
    if (path === '/api/admin/influencers/applications') return call(apps);
    if (path === '/api/admin/influencers/flags') return call(flags);
    if (path === '/api/admin/influencers/tier-defaults') return call(tiers);
    if (/^\/api\/admin\/influencers\/[^/]+\/offers$/.test(path)) return call(offers);
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return call({ rows: [], next_before: null, not_audited: null });
    const key = /^\/api\/admin\/programs\/([^/]+)$/.exec(path)?.[1];
    if (key) return call({ program: { key, status: 'partly_built' }, playbook: { published: true, version: 1, published_at: null, sections: [] } });
    return never();
  };
}

async function mounted(url, handle, { user = null } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const tree = user ? h(AuthProvider, null, h(ProgramPage)) : h(ProgramPage);
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, text: () => text(document.body),
    textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, target) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem('user'); restore(); },
  };
}
const writes = (view, method, re) => view.requests.filter((r) => r.method === method && re.test(r.url));
const bodyOf = (r) => JSON.parse(r.body);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses: seven static tabs, and the bare address is the overview, which opens Applications', () => {
  for (const t of TABS) assert.deepEqual(routeFor(t.path), { program: 'influencer', tab: t.key }, t.path);
  assert.deepEqual(routeFor('/admin/programs/influencer'), { program: 'influencer', tab: 'overview' });
});

test('money lines: "HQ reads" for an admin, a line per currency for the Super Admin, "None yet" for a recorded none, never a zero', () => {
  assert.deepEqual(moneyLines(HQ), [HQ_READS]);
  assert.deepEqual(moneyLines({ by_currency: [{ currency: 'EUR', earned_cents: 1600 }, { currency: 'USD', earned_cents: 4000 }] }), ['€16.00', '$40.00']);
  assert.deepEqual(moneyLines({ by_currency: [] }), ['None yet']);
  assert.deepEqual(moneyLines(NR()), [NOT_RECORDED]);
  assert.deepEqual(moneyLines(undefined), [NOT_RECORDED]);
});

test('every row action needs a reason of REASON_MIN characters; admit needs a tier and no reason', () => {
  const short = 'x'.repeat(REASON_MIN - 1);
  for (const a of ['tier', 'pause', 'resume', 'end', 'takedown']) assert.ok(changeBody(a, { tier: 'strategic_creator', reason: short }).error, `${a} without a reason`);
  assert.deepEqual(changeBody('pause', { reason: REASON }).body, { status: 'paused', reason: REASON });
  assert.deepEqual(changeBody('resume', { reason: REASON }).body, { status: 'active', reason: REASON });
  assert.deepEqual(changeBody('end', { reason: REASON }).body, { status: 'ended', reason: REASON });
  assert.deepEqual(changeBody('takedown', { reason: REASON }).body, { handle_takedown: true, reason: REASON });
  assert.deepEqual(changeBody('tier', { tier: 'strategic_creator', reason: REASON }).body, { tier: 'strategic_creator', reason: REASON });
  assert.ok(changeBody('tier', { tier: 'nope', reason: REASON }).error);
  assert.deepEqual(decisionBody('admit', { tier: 'affiliate_creator' }).body, { admit: 'affiliate_creator' });
  assert.ok(decisionBody('admit', { tier: 'strategic_partner' }).error, 'Strategic Partner is agreed per contract, not admitted at');
  assert.ok(decisionBody('decline', { text: short }).error);
  assert.deepEqual(decisionBody('more', { text: REASON }).body, { more: REASON });
  assert.deepEqual(rowActions(member('a')).map((x) => x.key), ['tier', 'pause', 'end', 'takedown']);
  assert.deepEqual(rowActions(member('a', { status: 'paused', handle: null })).map((x) => x.key), ['tier', 'resume', 'end'], 'no handle, nothing to take down');
  assert.deepEqual(rowActions(member('a', { status: 'ended' })), []);
});

test('tier defaults: "Set per agreement" where terms decide, percent to basis points, and refusals in words', () => {
  assert.deepEqual(defaultCells(TIERS[0]), { rate: '10%', duration: '12 invoices', budget: 'Not set' });
  assert.deepEqual(defaultCells(TIERS[1]), { rate: 'Set per agreement', duration: 'Set per agreement', budget: '$500.00' });
  assert.deepEqual(defaultsBody({ rate: '12.5', invoices: '6', budget: '250', currency: 'usd' }).body, { percentage_bps: 1250, duration_invoices: 6, offer_budget_cents: 25000, currency: 'USD' });
  assert.deepEqual(defaultsBody({ rate: '', invoices: '', budget: '' }).body, { percentage_bps: null, duration_invoices: null, offer_budget_cents: null, currency: 'USD' });
  assert.ok(defaultsBody({ rate: '0' }).error);
  assert.ok(defaultsBody({ invoices: '1.5' }).error);
  assert.ok(defaultsBody({ currency: 'dollars' }).error);
});

test('Commissions opens on the source in its address, and nothing else', () => {
  assert.equal(sourceFromAddress('?source=subscription_invoice'), 'subscription_invoice');
  assert.equal(sourceFromAddress('?source=influencer_bonus&x=1'), 'influencer_bonus');
  assert.equal(sourceFromAddress('?source=DROP%20TABLE'), 'all', 'a source outside the pattern falls back to All');
  assert.equal(sourceFromAddress(''), 'all');
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

test('the bare address opens Applications with the waiting count on its tab; the drawer admits at a tier', async () => {
  const view = await mounted('/admin/programs/influencer', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.ok(view.has('influencers-applications'), 'Applications is the landing tab');
    assert.match(view.textOf('programs-tab-applications'), /Applications.*1/);
    assert.ok(view.has('influencers-app-a1'));
    assert.match(view.textOf('influencers-app-a1'), /Applicant a1.*YouTube.*Newsletter.*12,000/);
    await view.click('influencers-app-a1-open');
    assert.match(view.textOf('influencers-drawer-why'), /I teach founders\./);
    assert.match(view.textOf('influencers-drawer-consent'), /terms 2026-10/);
    await view.change('influencers-drawer-tier-verified_influencer', { checked: true });
    await view.click('influencers-drawer-admit');
    const [w] = writes(view, 'POST', /\/api\/admin\/influencers\/applications\/a1\/decision$/);
    assert.ok(w, 'admit wrote');
    assert.deepEqual(bodyOf(w), { admit: 'verified_influencer' });
  } finally { await view.close(); }
});

test('decline and ask for more each need the words the applicant reads before they write', async () => {
  const view = await mounted('/admin/programs/influencer/applications', worker({ user: ADMIN }), { user: ADMIN });
  try {
    await view.click('influencers-app-a1-open');
    await view.click('influencers-drawer-decline');
    await view.click('influencers-drawer-decline');
    assert.match(view.textOf('influencers-drawer-refusal'), /at least 10 characters/);
    assert.equal(writes(view, 'POST', /decision$/).length, 0, 'nothing is sent without a reason');
    await view.change('influencers-drawer-text', { value: 'Your audience is outside the regions we serve.' });
    await view.click('influencers-drawer-decline');
    assert.deepEqual(bodyOf(writes(view, 'POST', /decision$/)[0]), { decline: 'Your audience is outside the regions we serve.' });
  } finally { await view.close(); }
  const more = await mounted('/admin/programs/influencer/applications', worker({ user: ADMIN }), { user: ADMIN });
  try {
    await more.click('influencers-app-a1-open');
    await more.click('influencers-drawer-more');
    await more.change('influencers-drawer-text', { value: 'Send a link to your last three videos.' });
    await more.click('influencers-drawer-more');
    assert.deepEqual(bodyOf(writes(more, 'POST', /decision$/)[0]), { more: 'Send a link to your last three videos.' });
  } finally { await more.close(); }
});

test('Influencers for an admin: "HQ reads" in every money cell, counts drawn, "Not recorded" where nothing stores it', async () => {
  const view = await mounted('/admin/programs/influencer/influencers', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.equal(view.textOf('influencers-row-jane-commission'), HQ_READS);
    assert.equal(view.textOf('influencers-row-jane-revenue'), HQ_READS);
    assert.equal(view.textOf('influencers-row-jane-signups'), '2');
    assert.match(view.textOf('influencers-row-jane'), /@jane.*Person jane.*Verified Influencer.*Active.*Not recorded/);
    assert.match(view.textOf('influencers-row-lee'), /No handle yet.*Paused/);
    assert.ok(!/\$0|0\.00/.test(view.textOf('influencers-table')), 'never a zero for an admin');
    assert.ok(view.has('influencers-row-lee-resume') && !view.has('influencers-row-lee-takedown'));
  } finally { await view.close(); }
});

test('Influencers for the Super Admin: each currency on its own line', async () => {
  const list = { influencers: [member('jane', { commission: { by_currency: [{ currency: 'EUR', earned_cents: 1600 }, { currency: 'USD', earned_cents: 4000 }] }, revenue: NR('subscription_commissions') })], counts: { active: 1, paused: 0, ended: 0 } };
  const view = await mounted('/admin/programs/influencer/influencers', worker({ user: SUPER, list }), { user: SUPER });
  try {
    assert.equal(view.textOf('influencers-row-jane-commission'), '€16.00$40.00');
    assert.equal(view.textOf('influencers-row-jane-revenue'), NOT_RECORDED);
  } finally { await view.close(); }
});

test('a row action asks for a reason before it writes, then sends its body to the membership uid', async () => {
  const view = await mounted('/admin/programs/influencer/influencers', worker({ user: ADMIN }), { user: ADMIN });
  try {
    await view.click('influencers-row-jane-pause');
    await view.click('influencers-change-submit');
    assert.match(view.textOf('influencers-change-submit-refusal'), /at least 10 characters/);
    assert.equal(writes(view, 'PATCH', /\/api\/admin\/influencers\//).length, 0);
    await view.change('influencers-change-reason', { value: REASON });
    await view.click('influencers-change-submit');
    const [w] = writes(view, 'PATCH', /\/api\/admin\/influencers\/jane$/);
    assert.ok(w, 'the membership uid, not the account uid');
    assert.deepEqual(bodyOf(w), { status: 'paused', reason: REASON });
    assert.match(view.textOf('influencers-change-submit-done'), /The member is told/);
  } finally { await view.close(); }
});

test('a flagged sign-up is kept or reversed only with a reason', async () => {
  const view = await mounted('/admin/programs/influencer/influencers', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.match(view.textOf('influencers-flag-f1'), /@jane.*Same email domain as the influencer/);
    await view.click('influencers-flag-f1-reverse');
    await view.click('influencers-flag-decide-submit');
    assert.equal(writes(view, 'POST', /\/flags\//).length, 0, 'no reason, no write');
    await view.change('influencers-flag-decide-reason', { value: REASON });
    await view.click('influencers-flag-decide-submit');
    const [w] = writes(view, 'POST', /\/api\/admin\/influencers\/flags\/f1\/decision$/);
    assert.deepEqual(bodyOf(w), { decision: 'uphold', reason: REASON });
  } finally { await view.close(); }
});

test('Offers: an admin reads them; the Super Admin links one and pauses one, each with a reason, on the account uid', async () => {
  const plain = await mounted('/admin/programs/influencer/offers', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.match(plain.textOf('influencers-offer-o1'), /@jane.*20% off.*JANE20.*\$1,000\.00.*3.*\$60\.00.*Active/);
    assert.ok(!plain.has('influencers-offers-new') && !plain.has('influencers-offer-o1-toggle'), 'linking and changing are the Super Admin’s');
    assert.ok(plain.requests.some((r) => r.url === '/api/admin/influencers/u-jane/offers'), 'offers read on the account uid');
  } finally { await plain.close(); }
  const view = await mounted('/admin/programs/influencer/offers', worker({ user: SUPER }), { user: SUPER });
  try {
    await view.click('influencers-offer-o1-toggle');
    await view.click('influencers-offer-change-submit');
    assert.equal(writes(view, 'PATCH', /\/offers\//).length, 0);
    await view.change('influencers-offer-change-reason', { value: REASON });
    await view.click('influencers-offer-change-submit');
    assert.deepEqual(bodyOf(writes(view, 'PATCH', /\/api\/admin\/influencers\/u-jane\/offers\/o1$/)[0]), { status: 'paused', reason: REASON });
  } finally { await view.close(); }
  const link = await mounted('/admin/programs/influencer/offers', worker({ user: SUPER }), { user: SUPER });
  try {
    await link.click('influencers-offers-new');
    await link.change('influencers-link-promo', { value: 'promo_abc' });
    await link.change('influencers-link-reason', { value: REASON });
    await link.click('influencers-link-submit');
    assert.match(link.textOf('influencers-link-submit-refusal'), /budget as an amount above 0/);
    assert.equal(writes(link, 'POST', /\/offers$/).length, 0, 'no budget, no write');
    await link.change('influencers-link-budget', { value: '250' });
    await link.click('influencers-link-submit');
    assert.deepEqual(bodyOf(writes(link, 'POST', /\/api\/admin\/influencers\/u-jane\/offers$/)[0]),
      { promo_id: 'promo_abc', budget_cents: 25000, currency: 'USD', featured: false, reason: REASON });
  } finally { await link.close(); }
});

test('Payouts open Commissions on its source; nothing is paid from here', async () => {
  const view = await mounted('/admin/programs/influencer/payouts', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.ok(view.has('influencers-payouts-commissions') && view.has('influencers-payouts-bonuses'));
    assert.ok(!/\$\d/.test(view.textOf('influencers-payouts')), 'no amount typed');
  } finally { await view.close(); }
});

test('Settings: an admin reads the defaults; only the Super Admin edits them', async () => {
  const plain = await mounted('/admin/programs/influencer/settings', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.match(plain.textOf('influencers-tier-affiliate_creator'), /Affiliate Creator.*10%.*12 invoices.*Not set/);
    assert.match(plain.textOf('influencers-tier-strategic_partner'), /Set per agreement.*Set per agreement.*\$500\.00/);
    assert.ok(!plain.has('influencers-tier-affiliate_creator-edit'));
    assert.ok(plain.has('influencers-settings-readonly'));
  } finally { await plain.close(); }
  const view = await mounted('/admin/programs/influencer/settings', worker({ user: SUPER }), { user: SUPER });
  try {
    await view.click('influencers-tier-affiliate_creator-edit');
    await view.change('influencers-defaults-rate', { value: '12.5' });
    await view.click('influencers-defaults-save');
    const [w] = writes(view, 'PUT', /\/api\/admin\/influencers\/tier-defaults\/affiliate_creator$/);
    assert.deepEqual(bodyOf(w), { percentage_bps: 1250, duration_invoices: 12, offer_budget_cents: null, currency: 'USD' });
  } finally { await view.close(); }
});

test('How it runs and Activity are part 1\'s reads under the key "influencer"', async () => {
  const view = await mounted('/admin/programs/influencer/activity', worker({ user: ADMIN }), { user: ADMIN });
  try {
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/admin/programs/influencer/activity')));
  } finally { await view.close(); }
});
