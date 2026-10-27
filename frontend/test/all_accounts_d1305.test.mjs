/**
 * D1305 (#3402, part 6 of #2377) — All accounts (ACC2, ACC3, ACC12): the
 * table over D1300's list read, its filters, sort, saved views, columns,
 * bulk bar and row menu. Every API is stubbed; every name is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/all_accounts_d1305.test.mjs
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
import {
  ADMIN_ROW_NOTE, DEFAULT_COLUMNS, NOT_RECORDED, changeProfileView, chipsOf, clearFilters, countLine, exportProblem,
  fromViewQuery, initialState, listParams, removeChip, resendView, rowMenu, rowView, toViewQuery, toggleOption, viewProblem,
} from '../src/pages/admin/accounts/allAccountsModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);
const NOW = Date.parse('2026-10-27T12:00:00Z');

// ─────────────────────────────────────────────────────────── the query

test('the table asks D1300 for every filter, the sort and the page; a search under two characters is not sent', () => {
  const s0 = initialState();
  assert.deepEqual(listParams(s0), { envelope: 1, limit: 25, offset: 0, sort: 'joined_desc' });
  let s = { ...s0, profile: 'founder', sub: 'tester', q: ' a ', page: 2 };
  // Mutation checked: keep the page on a multi-value filter → page 2 of a narrower set.
  assert.equal(toggleOption(s, 'status', 'active').page, 0);
  s = toggleOption(s, 'status', 'active');
  s = toggleOption(s, 'country', 'France');
  s = toggleOption(s, 'trust', 'under_50');
  s = toggleOption(s, 'active', 'over_30d');
  // Mutation checked: keep the page on a new filter → offset 50 survives toggleOption.
  assert.equal(s.page, 0);
  assert.deepEqual(listParams({ ...s, page: 1 }), {
    envelope: 1, limit: 25, offset: 25, sort: 'joined_desc', profile: 'founder', sub: 'tester',
    status: ['active'], country: ['France'], trust: ['under_50'], active: 'over_30d',
  });
  // Mutation checked: send q from one character → a 400 mid-typing.
  assert.equal(listParams({ ...s0, q: 'ab' }).q, 'ab');
  // A custom range sends its two days, never `joined` with them (D1300 refuses both together).
  const r = { ...toggleOption(s0, 'joined', 'custom'), joined_from: '2026-01-01', joined_to: '2026-02-01' };
  assert.deepEqual([listParams(r).joined, listParams(r).joined_from, listParams(r).joined_to], [undefined, '2026-01-01', '2026-02-01']);
  assert.equal(listParams(toggleOption(s0, 'joined', '7d')).joined, '7d');
  // A second toggle takes a value back off; country stops at twenty.
  assert.deepEqual(toggleOption(toggleOption(s0, 'email', 'verified'), 'email', 'verified').filters.email, []);
  let c = s0; for (let i = 0; i < 21; i++) c = toggleOption(c, 'country', `C${i}`);
  assert.equal(c.filters.country.length, 20);
});

test('the chips name what narrows the table, each removes itself, and Clear all keeps the search and sort', () => {
  let s = { ...initialState(), profile: 'founder', q: 'abc', sort: 'name_asc' };
  s = toggleOption(toggleOption(toggleOption(s, 'country', 'France'), 'active', 'over_30d'), 'identity', 'needs_info');
  assert.deepEqual(chipsOf(s).map((c) => c.label), ['Founders', 'Identity check: Needs information', 'Country: France', 'Last active: over 30 days ago']);
  const without = removeChip(s, 'country:France');
  assert.deepEqual(without.filters.country, []);
  assert.equal(removeChip(s, 'active').active, '');
  assert.equal(removeChip(s, 'profile').profile, null);
  const cleared = clearFilters(s);
  assert.deepEqual([cleared.q, cleared.sort, cleared.profile, chipsOf(cleared).length], ['abc', 'name_asc', null, 0]);
});

// ─────────────────────────────────────────────────────────── saved views

test('a view keeps the profile, filters, sort and columns under D1303\'s keys, and reapplies to the same query', () => {
  const keys = new Set([...read('cloudflare-worker/src/routes/admin_accounts.ts').match(/export const VIEW_KEYS = \[([\s\S]*?)\] as const;/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  let s = { ...initialState(), profile: 'investor', sub: 'lp', sort: 'trust_asc', pageSize: 50, columns: ['profile', 'trust', 'persona'] };
  for (const [k, v] of [['status', 'active'], ['limited', 'on'], ['program', 'mentor'], ['identity', 'pending'], ['joined', '30d'], ['active', 'never'], ['country', 'Kenya']]) s = toggleOption(s, k, v);
  const q = toViewQuery(s);
  // Mutation checked: save `limited` under its list name → D1303 refuses the key.
  for (const k of Object.keys(q)) assert.ok(keys.has(k), `${k} is not one of D1303's view keys`);
  assert.deepEqual(q, {
    profile: 'investor', sub_account: 'lp', status: ['active'], identity: ['pending'], access: ['on'], country: ['Kenya'], programme: ['mentor'],
    joined: '30d', last_active: 'never', sort: 'trust_asc', columns: ['profile', 'trust', 'persona'], page_size: '50',
  });
  const back = fromViewQuery(q, { q: 'kept' });
  assert.deepEqual(listParams(back), listParams({ ...s, q: 'kept' }));
  assert.deepEqual(back.columns, ['profile', 'trust', 'persona']);
  // A key or value the table does not know is left out, never guessed.
  const odd = fromViewQuery({ status: ['dormant', 'active'], sort: 'random', columns: ['secret'], profile: 'owner', page_size: '7' });
  assert.deepEqual([odd.filters.status, odd.sort, odd.columns, odd.profile, odd.pageSize], [['active'], 'joined_desc', DEFAULT_COLUMNS, null, 25]);
  assert.deepEqual(toViewQuery(initialState()), {});
  assert.equal(viewProblem('', 'admin'), 'Name the view.');
  assert.equal(viewProblem('x'.repeat(81), 'admin'), 'A view’s name is at most 80 characters.');
  assert.equal(viewProblem('Mine', 'everyone'), 'Choose who sees it.');
  assert.equal(viewProblem('Mine', 'studio'), null);
});

// ─────────────────────────────────────────────────────────── rows and words

test('a row says Not recorded for what nothing records, never a zero, and the count is over the filtered set', () => {
  const env = { unreadable: [] };
  const r = rowView({ id: 4, name: '[Ben Sample]', email: 'ben@example.test', role: 'exploring', is_active: 1, email_verified: 0,
    kyc_status: null, created_at: '2026-10-12 09:00:00', last_active_at: null, country: null, subscription_tier: null,
    trust: { score: null, open: 0, reason: 'Not recorded: no obligation applies yet' }, profile_completion_pct: null }, env, NOW);
  assert.deepEqual([r.profile, r.email_word, r.identity, r.plan, r.country, r.last_active, r.joined, r.trust, r.trust_reason, r.completeness],
    ['Explorer', 'Not verified', 'Not started', 'Free', NOT_RECORDED, 'Never', '12 Oct 2026', null, 'Not recorded: no obligation applies yet', NOT_RECORDED]);
  // A column this database lacks is Not recorded, not "Never" or "Free".
  // Mutation checked: ignore `unreadable` → a missing column reads as a fact.
  const missing = rowView({ id: 5, last_active_at: null, subscription_tier: null }, { unreadable: ['last_active_at', 'subscription_tier', 'trust'] }, NOW);
  assert.deepEqual([missing.last_active, missing.plan, missing.trust], [NOT_RECORDED, NOT_RECORDED, null]);
  const d = rowView({ id: 6, last_active_at: '2026-10-26T18:40:00Z', created_at: '2026-10-27T08:00:00Z', kyc_status: 'pending', sub_accounts: { lp: true, tester: true }, trust: { score: 64, open: 2 } }, env, NOW);
  assert.deepEqual([d.last_active, d.joined, d.identity, d.subs, d.trust, d.trust_reason], ['Yesterday', 'Today', 'Waiting', ['LP', 'Tester'], 64, '2 obligations open']);
  assert.equal(countLine({ matched: 61, from: 1, to: 25, total: 1284 }), '1–25 of 61');
  assert.equal(countLine({ matched: 0, from: 0, to: 0, total: 1284 }), '0 of 1,284');
});

test('a row menu offers the canvas\'s items; an administrator\'s offers the session and Deactivate only with the controls, and says where they are removed', () => {
  const founder = rowMenu({ role: 'founder', kyc_status: 'pending', access_level: null, is_active: 1 }, { controls: true });
  assert.deepEqual(founder.items.map((m) => m.label), ['Open account', 'Change profile…', 'Grant full access without an identity check…', 'Grant limited access…', 'Admit to Spin-Out Lab…', 'Start a support session…', 'Deactivate account…']);
  assert.equal(founder.note, '');
  assert.deepEqual(rowMenu({ role: 'founder', kyc_status: 'approved', is_active: 0 }, { controls: true }).items.map((m) => m.id), ['open', 'profile', 'lab', 'support', 'toggle']);
  assert.equal(rowMenu({ role: 'investor', kyc_status: 'pending', access_level: 'limited' }, { controls: false }).items.find((m) => m.id === 'unlimit').label, 'Revoke limited access…');
  // ACC12: a Super Admin sees an administrator's session and Deactivate; a plain Admin does not.
  // Mutation checked: draw them without `controls` → the server can only refuse.
  const adminForSuper = rowMenu({ role: 'admin', is_active: 1 }, { controls: true });
  assert.deepEqual(adminForSuper.items.map((m) => m.label), ['Open account', 'Start a support session…', 'Deactivate account…']);
  assert.equal(adminForSuper.note, ADMIN_ROW_NOTE);
  assert.deepEqual(rowMenu({ role: 'admin', is_active: 1 }, { controls: false }).items.map((m) => m.id), ['open']);
  // Change profile: an Explorer goes to the Exploring board for a plain Admin, through the override for a Super Admin.
  assert.equal(changeProfileView({ role: 'exploring', name: '[Ben Sample]' }, false).kind, 'explorer');
  assert.equal(changeProfileView({ role: 'exploring', name: '[Ben Sample]' }, true).kind, 'override');
  assert.deepEqual(changeProfileView({ role: 'partner', name: '[Dev]' }, false).options.map(([k]) => k), ['founder', 'investor', 'advisor', 'exploring']);
});

test('the bulk resend says who is skipped and why, from the dry run; the export needs its reason', () => {
  const v = resendView({ asked: 3, to_send: 2, skipped: { verified: 1, deactivated: 0, administrator: 0, not_found: 0 } });
  assert.deepEqual([v.title, v.skipped, v.send], ['Send the verification email again to 3 accounts?', '1 is already verified: it is skipped.', 'Send 2 emails']);
  const none = resendView({ asked: 2, to_send: 0, skipped: { verified: 1, deactivated: 1 } });
  assert.equal(none.send, null); assert.match(none.none, /Nothing is left to send/);
  assert.equal(exportProblem('short', ['name']), 'Give a reason of at least 10 characters.');
  assert.equal(exportProblem('A real reason here', []), 'Choose at least one column.');
  assert.equal(exportProblem('A real reason here', ['name']), null);
});

// ─────────────────────────────────────────────────────────── mounted

const ROWS = [
  { id: 1, uid: 'u1', name: '[Ada Example]', email: 'ada@example.test', role: 'founder', is_active: 1, email_verified: 1, kyc_status: 'approved', created_at: '2026-02-03T10:00:00Z', last_active_at: '2026-10-27T10:00:00Z', country: 'France', subscription_tier: 'pro', trust: { score: 82, open: 0 } },
  { id: 2, uid: 'u2', name: '[Admin Name]', email: 'admin@example.test', role: 'admin', is_active: 1, email_verified: 1, kyc_status: 'approved', created_at: '2026-01-04T10:00:00Z', last_active_at: null, country: 'Portugal', subscription_tier: null, trust: { score: 95, open: 0 } },
  { id: 3, uid: 'u3', name: '[Ben Sample]', email: 'ben@example.test', role: 'exploring', is_active: 1, email_verified: 0, kyc_status: 'not_started', created_at: '2026-10-12T10:00:00Z', last_active_at: null, country: null, subscription_tier: null, trust: { score: null, open: 0, reason: 'Not recorded: no obligation applies yet' } },
];
const envOf = (over = {}) => ({ results: ROWS, total: 1284, by_role: { founder: 512, admin: 13, exploring: 371 }, matched: 3, from: 1, to: 3, next_offset: null, unreadable: [], ...over });

async function mount({ list, views = async () => ({ views: [] }), controlsFor = () => false, writes = {} } = {}) {
  const restore = installDocument();
  const calls = { list: [], actions: [], opened: [], writes: [] };
  const original = { list: api.adminListUsers, ...Object.fromEntries(Object.keys(adminAccountWritesApi).map((k) => [k, adminAccountWritesApi[k]])) };
  api.adminListUsers = async (opts) => { calls.list.push(opts); return (list || (async () => envOf()))(opts); };
  adminAccountWritesApi.adminAccountViews = views;
  for (const [k, fn] of Object.entries(writes)) adminAccountWritesApi[k] = async (...a) => { calls.writes.push([k, ...a]); return fn(...a); };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AllAccounts, {
    scopeLine: 'Searching HQ-held accounts', controlsFor, onOpen: (u) => calls.opened.push(u.id), onAction: (id, u) => calls.actions.push([id, u.id]),
  }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const click = async (id) => {
    const n = byId(container, id); assert.ok(n, `no ${id}`);
    await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); await new Promise((r) => setTimeout(r, 0)); });
  };
  const type = async (id, value) => {
    const n = byId(container, id); assert.ok(n, `no ${id}`);
    await act(async () => { props(n).onChange({ target: { value } }); });
  };
  return {
    container, calls, click, type, text: () => text(container), has: (id) => !!byId(container, id),
    async done() {
      await act(async () => root.unmount());
      api.adminListUsers = original.list;
      for (const k of Object.keys(adminAccountWritesApi)) adminAccountWritesApi[k] = original[k];
      restore();
    },
  };
}

test('mounted: the profile chips count the whole table, and a chip, a sort and a filter each send their query', async () => {
  const w = await mount();
  try {
    assert.deepEqual(w.calls.list[0], { envelope: 1, limit: 25, offset: 0, sort: 'joined_desc' });
    assert.match(text(byId(w.container, 'accounts-chip-all')), /1,284/);
    assert.match(text(byId(w.container, 'accounts-chip-founder')), /512/);
    // Mutation checked: count the rows on screen → Founders reads 1.
    assert.match(text(byId(w.container, 'accounts-count')), /^1–3 of 3$/);
    await w.click('accounts-chip-founder');
    assert.equal(w.calls.list.at(-1).profile, 'founder');
    await w.click('accounts-sort-open');
    await w.click('accounts-sort-trust_asc');
    assert.equal(w.calls.list.at(-1).sort, 'trust_asc');
    await w.click('accounts-filters-open');
    await w.click('accounts-filter-status-deactivated');
    assert.deepEqual(w.calls.list.at(-1).status, ['deactivated']);
    assert.match(text(byId(w.container, 'accounts-chips')), /Founders.*Status: Deactivated/);
    assert.match(w.text(), /Searching HQ-held accounts\. Type at least two characters\./);
    // A row opens its record; its menu item goes to the console.
    await w.click('accounts-open-1');
    assert.deepEqual(w.calls.opened, [1]);
    await w.click('accounts-menu-3');
    await w.click('accounts-menu-3-profile');
    assert.deepEqual(w.calls.actions, [['profile', 3]]);
  } finally { await w.done(); }
});

test('mounted: Columns hides a column and Reset brings it back', async () => {
  const w = await mount();
  try {
    assert.ok(w.has('accounts-th-trust') && !w.has('accounts-th-persona'));
    await w.click('accounts-columns-open');
    await w.click('accounts-column-trust');
    await w.click('accounts-column-persona');
    assert.ok(!w.has('accounts-th-trust') && w.has('accounts-th-persona'));
    await w.click('accounts-columns-reset');
    assert.ok(w.has('accounts-th-trust') && !w.has('accounts-th-persona'));
  } finally { await w.done(); }
});

test('mounted: Save this view posts the table\'s query; applying a saved view sends its filters', async () => {
  const saved = { uid: 'v1', name: 'Testers available', scope: 'studio', can_change: true, query: { sub_account: 'tester', status: ['active'], sort: 'active_desc' } };
  let list = [saved];
  const w = await mount({ views: async () => ({ views: list }), writes: { adminSaveAccountView: async () => ({ ok: true }), adminDeleteAccountView: async () => ({ ok: true }) } });
  try {
    await w.click('accounts-chip-investor');
    await w.click('accounts-views-open');
    await w.click('accounts-save-view-open');
    assert.ok(w.has('accounts-save-view'), 'Save this view did not open its dialog');
    assert.equal(props(byId(w.container, 'accounts-save-view-save')).disabled, true, 'a view with no name can be saved');
    await w.type('accounts-save-view-name', 'Investors');
    await w.click('accounts-save-view-studio');
    await w.click('accounts-save-view-save');
    assert.deepEqual(w.calls.writes.find(([k]) => k === 'adminSaveAccountView')[1], { name: 'Investors', scope: 'studio', query: { profile: 'investor' } });
    assert.match(text(byId(w.container, 'accounts-note')), /Saved the view “Investors”\./);
    await w.click('accounts-views-open');
    await w.click('accounts-view-v1');
    const sent = w.calls.list.at(-1);
    // Mutation checked: keep the old profile on apply → profile=investor leaks into the view.
    assert.deepEqual([sent.sub, sent.status, sent.sort, sent.profile], ['tester', ['active'], 'active_desc', undefined]);
    assert.match(text(byId(w.container, 'accounts-views-open')), /Views: Testers available/);
    // Delete opens a dialog first; nothing is deleted before it.
    await w.click('accounts-views-open');
    await w.click('accounts-view-delete-v1');
    assert.ok(!w.calls.writes.some(([k]) => k === 'adminDeleteAccountView'));
    list = [];
    await w.click('accounts-delete-view-go');
    assert.deepEqual(w.calls.writes.find(([k]) => k === 'adminDeleteAccountView').slice(1), ['v1']);
  } finally { await w.done(); }
});

test('mounted: checking rows swaps the toolbar for the bulk bar; resend runs its dry run, then sends; export needs a reason', async () => {
  const w = await mount({ writes: {
    adminBulkResendVerification: async (ids, o) => (o?.dryRun ? { asked: ids.length, to_send: 1, skipped: { verified: 1 } } : { sent: 1 }),
    adminExportAccounts: async () => ({ filename: 'accounts.csv', rows: 2, csv: 'Name\r\n' }),
  } });
  try {
    assert.ok(w.has('accounts-toolbar') && !w.has('accounts-bulk-bar'));
    await w.click('accounts-check-1');
    await w.click('accounts-check-3');
    // Mutation checked: draw the toolbar beside the bar → both present.
    assert.ok(w.has('accounts-bulk-bar') && !w.has('accounts-toolbar'));
    assert.equal(text(byId(w.container, 'accounts-bulk-count')), '2 selected');
    await w.click('accounts-bulk-resend');
    assert.deepEqual(w.calls.writes[0], ['adminBulkResendVerification', [1, 3], { dryRun: true }]);
    assert.match(text(byId(w.container, 'accounts-resend-skipped')), /1 is already verified: it is skipped\./);
    await w.click('accounts-resend-send');
    assert.deepEqual(w.calls.writes[1], ['adminBulkResendVerification', [1, 3]]);
    assert.match(text(byId(w.container, 'accounts-note')), /Sent 1 verification email\./);
    assert.ok(w.has('accounts-toolbar'), 'the selection is not cleared after the send');
    await w.click('accounts-check-all');
    await w.click('accounts-bulk-export');
    assert.equal(props(byId(w.container, 'accounts-export-go')).disabled, true, 'an export without a reason can be sent');
    await w.type('accounts-export-reason', 'Quarterly investor reporting');
    await w.click('accounts-export-go');
    const [, body] = w.calls.writes.find(([k]) => k === 'adminExportAccounts');
    assert.deepEqual([body.reason, body.user_ids], ['Quarterly investor reporting', [1, 2, 3]]);
  } finally { await w.done(); }
});

test('mounted: a failed read is never an empty table; no match keeps the chips; unread trust says so', async () => {
  const failing = await mount({ list: async () => { throw new Error('read failed'); } });
  try {
    // Mutation checked: draw the empty state on a failure → "No accounts yet."
    assert.match(text(byId(failing.container, 'accounts-failed')), /We could not load the accounts\.The rest of Accounts still works\./);
    assert.ok(!failing.has('accounts-none') && !failing.has('accounts-table'));
  } finally { await failing.done(); }
  const none = await mount({ list: async (o) => (o.profile ? envOf({ results: [], matched: 0, from: 0, to: 0 }) : envOf()) });
  try {
    await none.click('accounts-chip-investor');
    assert.match(text(byId(none.container, 'accounts-none')), /No accounts match these filters\./);
    assert.ok(none.has('accounts-chips') && none.has('accounts-none-every'));
    assert.match(text(byId(none.container, 'accounts-count')), /0 of 1,284/);
  } finally { await none.done(); }
  const trust = await mount({ list: async () => envOf({ unreadable: ['trust'] }) });
  try {
    assert.match(text(byId(trust.container, 'accounts-trust-unreadable')), /Trust scores could not be read\. The accounts are shown without them\./);
    assert.ok(trust.has('accounts-table'));
  } finally { await trust.done(); }
});

test('mounted ACC12: with the controls (a Super Admin), an administrator\'s row offers the session and Deactivate; without, only Open and the note', async () => {
  const sup = await mount({ controlsFor: () => true });
  try {
    await sup.click('accounts-menu-2');
    assert.ok(sup.has('accounts-menu-2-support') && sup.has('accounts-menu-2-toggle') && sup.has('accounts-menu-2-note'));
    await sup.click('accounts-menu-2-toggle');
    assert.deepEqual(sup.calls.actions, [['toggle', 2]]);
  } finally { await sup.done(); }
  const plain = await mount({ controlsFor: (u) => u.role !== 'admin' });
  try {
    await plain.click('accounts-menu-2');
    assert.ok(!plain.has('accounts-menu-2-support') && !plain.has('accounts-menu-2-toggle'));
    assert.match(text(byId(plain.container, 'accounts-menu-2-note')), /Administrators are removed on their licence/);
  } finally { await plain.done(); }
});

test('the source keeps the house rules: no browser pop-up in the table, the record address untouched, and the console wiring', () => {
  const table = read('frontend/src/pages/admin/accounts/AllAccounts.jsx');
  assert.doesNotMatch(table, /window\.(confirm|alert|prompt)\(/);
  const consoleSrc = read('frontend/src/pages/admin/consoles/UsersConsole.jsx');
  assert.match(consoleSrc, /<AllAccounts\s+scopeLine=\{accountScope\}\s+controlsFor=\{\(u\) => drawsAccountControls\(u, viewer\)\}\s+onOpen=\{openRecord\}\s+onAction=\{runAction\}\s+onRows=\{setUsers\}\s+reloadKey=\{reloadKey\}\s+\/>/);
  assert.match(read('frontend/src/pages/hq/AccountsPage.jsx'), /<UsersConsole onImpersonate=\{onImpersonate\} \/>/);
});
