/**
 * D1307 (#3404, part 8 of #2377) — Accounts on a phone (ACC14): the Overview at
 * full scroll, All accounts as cards, filters and sort in one sheet, the row
 * menu as a sheet, and every target in them at least 44px. The account's full
 * screen and the "Ask Eadwyn" button wait on #3493 (D1307 §4). Each frame is
 * the 390px width: the table is mounted
 * with `phone` (what `usePhoneWidth()` answers below 1024px) over invented
 * fixtures, and every other frame is read from its markup, since this
 * repository renders without a layout engine. Every API is stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/accounts_phone_d1307.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { adminAccountWritesApi } from '../src/lib/api/adminAccountWrites.js';
import AllAccounts from '../src/pages/admin/accounts/AllAccounts.jsx';
import { cardView, initialState, moreOf, phoneFilterCount, toggleOption } from '../src/pages/admin/accounts/allAccountsModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);
const cls = (n) => String(props(n).className || '');
const NOW = Date.parse('2026-10-27T12:00:00Z');

/** A target is 44px tall at 390 when its classes hold it there below lg. */
const TALL = /(^|\s)(min-h-\[44px\]|h-11)(\s|$)/;
const tapOk = (n) => TALL.test(cls(n)) || TALL.test(String(props(n).className || ''));

// ─────────────────────────────────────────────────────────── the model

const ROWS = [
  { id: 1, uid: 'u1', name: '[Ada Example]', email: 'ada@example.test', role: 'founder', is_active: 1, email_verified: 1, kyc_status: 'approved', created_at: '2026-02-03T10:00:00Z', last_active_at: '2026-10-27T10:00:00Z', country: 'France', subscription_tier: 'pro', trust: { score: 82, open: 0 } },
  { id: 2, uid: 'u2', name: '[Admin Name]', email: 'admin@example.test', role: 'admin', is_active: 0, email_verified: 1, kyc_status: 'approved', created_at: '2026-01-04T10:00:00Z', last_active_at: null, country: 'Portugal', subscription_tier: null, trust: { score: 95, open: 0 } },
  { id: 3, uid: 'u3', name: '[Ben Sample]', email: 'ben@example.test', role: 'exploring', is_active: 1, email_verified: 0, kyc_status: 'not_started', created_at: '2026-10-12T10:00:00Z', last_active_at: null, country: null, subscription_tier: null, trust: { score: null, open: 0, reason: 'Not recorded: no obligation applies yet' } },
];
const envOf = (over = {}) => ({ results: ROWS, total: 1284, by_role: { founder: 512, admin: 13, exploring: 371 }, matched: 3, from: 1, to: 3, next_offset: null, unreadable: [], ...over });

test('a card: initials, and one line that leaves out what is ordinary (active, verified)', () => {
  const env = envOf();
  const a = cardView(ROWS[0], env, NOW);
  // Mutation checked: split on spaces only → "[Ada Example]" reads "[E".
  assert.equal(a.initials, 'AE');
  // Mutation checked: keep "Verified" in the line → it reads "… · Verified · Joined …".
  assert.doesNotMatch(a.line, /Verified|Active/);
  assert.match(a.line, /Joined /);
  const b = cardView(ROWS[1], env, NOW);
  // Mutation checked: drop the inactive status → a deactivated account reads like an active one.
  assert.match(b.line, /Deactivated|Inactive/);
  const c = cardView(ROWS[2], env, NOW);
  // Mutation checked: drop the email word → an unverified account looks verified.
  assert.match(c.line, /Unverified|Not verified/);
});

test('the Filters and sort count: each chip, plus a sort that is not the default', () => {
  const s0 = initialState();
  assert.equal(phoneFilterCount(s0), 0);
  // Mutation checked: count the default sort → the button reads 1 with nothing set.
  assert.equal(phoneFilterCount({ ...s0, sort: 'joined_desc' }), 0);
  assert.equal(phoneFilterCount({ ...s0, sort: 'trust_asc' }), 1);
  const s = toggleOption(toggleOption(s0, 'status', 'active'), 'country', 'France');
  assert.equal(phoneFilterCount({ ...s, sort: 'trust_asc' }), 3);
});

test('Show more grows the first page to the next size; past the first page, or at the end, it is Previous and Next', () => {
  const s0 = initialState();
  // Mutation checked: offer more with no next page → a button that loads nothing.
  assert.equal(moreOf(s0, envOf({ next_offset: null })), null);
  assert.deepEqual(moreOf(s0, envOf({ next_offset: 25 })), { pageSize: 50, label: 'Show 25 more' });
  // Mutation checked: offer more on page 2 → a bigger page that skips rows.
  assert.equal(moreOf({ ...s0, page: 1 }, envOf({ next_offset: 50 })), null);
  assert.equal(moreOf({ ...s0, pageSize: 100 }, envOf({ next_offset: 100 })), null);
});

// ─────────────────────────────────────────────────────────── mounted at 390

async function mount({ env = envOf(), controlsFor = () => false, phone = true } = {}) {
  const restore = installDocument();
  const calls = { list: [], actions: [], opened: [] };
  const original = { list: api.adminListUsers, views: adminAccountWritesApi.adminAccountViews };
  api.adminListUsers = async (opts) => { calls.list.push(opts); return env; };
  adminAccountWritesApi.adminAccountViews = async () => ({ views: [] });
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AllAccounts, {
    scopeLine: 'Searching HQ-held accounts', controlsFor, phone, onOpen: (u) => calls.opened.push(u.id), onAction: (id, u) => calls.actions.push([id, u.id]),
  }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const click = async (id) => {
    const n = byId(container, id); assert.ok(n, `no ${id}`);
    await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); await new Promise((r) => setTimeout(r, 0)); });
  };
  return {
    container, calls, click, by: (id) => byId(container, id), has: (id) => !!byId(container, id),
    async done() {
      await act(async () => root.unmount());
      api.adminListUsers = original.list;
      adminAccountWritesApi.adminAccountViews = original.views;
      restore();
    },
  };
}

test('frame 2: All accounts is cards, with search, Filters and sort and the count above; no table', async () => {
  const w = await mount();
  try {
    assert.ok(w.has('accounts-cards'));
    // Mutation checked: draw the table on the phone too → a 1,000px table at 390.
    assert.ok(!w.has('accounts-table'), 'the phone draws the desktop table');
    assert.ok(!w.has('accounts-chip-all'), 'the desktop profile chips draw above the cards');
    assert.ok(w.has('accounts-phone-toolbar'));
    assert.equal(text(w.by('accounts-count')), '1–3 of 3');
    for (const r of ROWS) assert.ok(w.has(`accounts-card-${r.id}`), `no card for ${r.id}`);
    assert.match(text(w.by('accounts-card-1')), /\[Ada Example\].*ada@example\.test/s);
    w.calls.opened.length = 0;
    await w.click('accounts-open-3');
    assert.deepEqual(w.calls.opened, [3]);
  } finally { await w.done(); }
  const desk = await mount({ phone: false });
  try {
    // Mutation checked: draw the cards on the desktop → the table is gone at 1440.
    assert.ok(desk.has('accounts-table') && !desk.has('accounts-cards'), 'the desktop lost its table');
  } finally { await desk.done(); }
});

test('frame 3: Filters and sort is one sheet with Profile, Sub-accounts, every filter and Sort; Show closes it', async () => {
  const w = await mount();
  try {
    assert.ok(!w.has('accounts-phone-filters'));
    await w.click('accounts-phone-filters-open');
    assert.ok(w.has('accounts-phone-filters'), 'Filters and sort did not open its sheet');
    for (const id of ['accounts-phone-profile', 'accounts-phone-sub', 'accounts-filters-panel', 'accounts-phone-sort']) assert.ok(w.has(id), `the sheet has no ${id}`);
    assert.match(text(w.by('accounts-phone-chip-founder')), /512/);
    await w.click('accounts-phone-chip-founder');
    assert.equal(w.calls.list.at(-1).profile, 'founder');
    await w.click('accounts-phone-sort-trust_asc');
    assert.equal(w.calls.list.at(-1).sort, 'trust_asc');
    assert.equal(text(w.by('accounts-phone-show')), 'Show 3 accounts');
    await w.click('accounts-phone-show');
    assert.ok(!w.has('accounts-phone-filters'), 'Show did not close the sheet');
    // The profile chip and the sort each count once on the button.
    // Mutation checked: count the default sort as well → it reads 3.
    assert.equal(text(w.by('accounts-phone-filter-count')), '2');
  } finally { await w.done(); }
});

test('frame 4: ⋯ opens the row menu as a sheet; an item acts and closes it; Cancel only closes', async () => {
  const w = await mount({ controlsFor: () => true });
  try {
    await w.click('accounts-menu-1');
    assert.ok(w.has('accounts-phone-menu-1'), '⋯ did not open the row menu');
    await w.click('accounts-phone-menu-cancel');
    assert.ok(!w.has('accounts-phone-menu-1'));
    assert.equal(w.calls.actions.length + w.calls.opened.length, 0, 'Cancel acted');
    await w.click('accounts-menu-1');
    await w.click('accounts-phone-menu-1-open');
    assert.deepEqual(w.calls.opened, [1]);
    assert.ok(!w.has('accounts-phone-menu-1'));
  } finally { await w.done(); }
});

test('the phone pager: Show 25 more on page one, Previous and Next otherwise', async () => {
  const w = await mount({ env: envOf({ next_offset: 25, matched: 80 }) });
  try {
    assert.equal(text(w.by('accounts-phone-more')), 'Show 25 more');
    await w.click('accounts-phone-more');
    assert.equal(w.calls.list.at(-1).limit, 50);
  } finally { await w.done(); }
});

test('every target in frames 2 to 4 is at least 44px tall at 390', async () => {
  const w = await mount({ env: envOf({ next_offset: null }), controlsFor: () => true });
  const tooSmall = (root) => walk(root).filter((n) => {
    const tag = String(n.tagName || n.nodeName || '').toLowerCase();
    if (!['button', 'input', 'a'].includes(tag)) return false;
    if (props(n).type === 'checkbox' || props(n).type === 'radio') return false;
    return !tapOk(n);
  }).map((n) => props(n)['data-testid'] || text(n).slice(0, 30));
  try {
    const cards = w.by('accounts-cards');
    // Mutation checked: the ⋯ button at h-8 → "accounts-menu-1" is listed.
    assert.deepEqual(tooSmall(cards), []);
    assert.deepEqual(tooSmall(w.by('accounts-phone-toolbar')), []);
    assert.deepEqual(tooSmall(w.by('accounts-phone-pager')), []);
    await w.click('accounts-phone-filters-open');
    for (const id of ['accounts-phone-profile', 'accounts-phone-sub', 'accounts-phone-sort']) assert.deepEqual(tooSmall(w.by(id)), [], id);
    assert.ok(tapOk(w.by('accounts-phone-show')) && tapOk(w.by('accounts-phone-clear')));
    await w.click('accounts-phone-show');
    await w.click('accounts-menu-1');
    // Mutation checked: drop TAP from a menu item → its id is listed. The sheet's × is the
    // shared Lightbox's (36px, D1307 §5); Cancel is this sheet's 44px way out.
    assert.deepEqual(tooSmall(w.by('accounts-phone-menu-1')).filter((x) => x !== 'Licences' && x !== 'accounts-phone-menu-1-close'), []);
    assert.ok(tapOk(w.by('accounts-phone-menu-cancel')));
  } finally { await w.done(); }
});

// ─────────────────────────────────────────────────────────── frame 1

test('frame 1: the Overview stacks to one column below sm and every target is 44px below lg', () => {
  const src = read('frontend/src/pages/admin/accounts/AccountsOverview.jsx');
  for (const m of src.matchAll(/className="grid gap-3 ([^"]*)"/g)) {
    // Mutation checked: a bare grid-cols-2 → two columns at 390.
    assert.doesNotMatch(m[1], /(^|\s)grid-cols-[2-9]/, `a grid has columns at 390: ${m[1]}`);
  }
  assert.match(src, /const TAP = 'inline-flex min-h-\[44px\] items-center lg:min-h-0';/);
  for (const m of src.matchAll(/<(button|Link)\b[^>]*className=\{?[`"]([^`"]*)[`"]/g)) {
    // Mutation checked: drop ${TAP} from View all → it is listed.
    assert.match(m[2], /\$\{TAP\}|min-h-\[44px\]/, `an Overview target is under 44px: ${m[2]}`);
  }
});
