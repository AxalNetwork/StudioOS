/**
 * D4699 (#4699, HQ Security audit 5/6) — the page's reads under real timing,
 * on a mounted HqSecurityPage with the api's methods held and answered by the
 * test:
 *
 *   1. a ledger read that answers after a newer one (the filter changed) is
 *      dropped, never drawn over the newer list;
 *   2. a Load older page that answers after the list changed is dropped;
 *   3. sessions continue on the server's cursor: Load older sessions appends
 *      the next page once, keeps what this page changed marked, and says when
 *      the next page could not be read;
 *   4. after an act that leaves the operator signed in, the overview and the
 *      ledger are read again, softly (the dialog stays); after emergency
 *      re-authentication or signing out your own account, nothing is.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_ledger_races_4699.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import HqSecurityPage, { actLeavesOperatorSignedIn } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const sqlAgo = (mins) => new Date(Date.now() - mins * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const deferred = () => { let res; let rej; const promise = new Promise((a, b) => { res = a; rej = b; }); return { promise, res, rej }; };

const OVERVIEW = (active = 2) => ({
  audit: { total: 41, feed: '/api/admin/security/governance' },
  impersonations: { available: true, active: 0, recent: [] },
  sessions: { available: true, active, token_hours: 24 },
  mfa: { admins_total: 2, admins_with_mfa: 2 },
  kyc: { pending: 0, approved: 3, rejected: 0 },
  kyc_not_recorded: [],
  dsr: { clock_days: 30, kinds: [], rows: [], by_branch: [], branches: { bound: 0, reason: 'none' }, ledger_available: true },
  security_events: { available: true, today: 4, failed_signins_24h: 0, retention_days: 400, not_counted: [] },
});
const SOURCES = () => ['security_events', 'admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events']
  .map((table) => ({ table, available: true, rows: 1 }));
const FEED = (keys, extra = {}) => ({
  filter: 'all',
  filters: [{ key: 'all', label: 'All actions' }, { key: 'auth', label: 'Sign-ins and step-ups' }],
  rows: keys.map((key, i) => ({ key, at: sqlAgo(10 + i), actor: 'Sam Super', action: 'gate.totp', tenant: 'HQ', target: null, source: 'security_events', tone: 'alert', outcome: 'refused' })),
  limit: 60, more: false, cursor: null, sources: SOURCES(),
  data_access: { expiry_minutes: 30, impersonations: { available: true, items: [] }, exports: { available: true, items: [] } },
  ...extra,
});
const ROW = (id, over = {}) => ({
  id, user_id: 900 + id, email: `u${id}@example.com`, name: `User ${id}`, role: 'founder', user_agent: 'Firefox', network: '203.0.113.0/24',
  factor: 'password', created_at: sqlAgo(60 + id), last_seen_at: sqlAgo(5), is_current: false, ...over,
});
const SESSIONS = (rows, cursor = null, total = rows.length) => ({
  token_hours: 24, total, expiry_minutes: 30, rows, cursor, impersonations: { available: true, rows: [] },
});
const OWN = ROW(50, { user_id: 1, name: 'Sam Super', role: 'admin', factor: 'totp', is_current: true });

/** Mounts the page with the four reads and the acts answered by `server`. */
async function page(path, server) {
  const restore = installDocument('', { focus: true });
  const saved = { ...api };
  Object.assign(api, server);
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, h(HqSecurityPage))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const text = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join(''));
  const byId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const button = (re) => walk(container).find((n) => n.tagName === 'BUTTON' && re.test(text(n)));
  const settle = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  const click = async (n) => { assert.ok(n, 'control exists'); await act(async () => { props(n).onClick({ currentTarget: n, preventDefault() {} }); }); await settle(); };
  const type = async (n, value) => { await act(async () => { props(n).onChange({ target: { value } }); }); };
  return {
    byId, button, click, type, settle, props, text: () => text(container),
    async done() {
      await act(async () => root.unmount());
      Object.assign(api, saved);
      globalThis.fetch = prevFetch;
      restore();
    },
  };
}

// ── what an act leaves standing ──────────────────────────────────────────

test('actLeavesOperatorSignedIn: the acts that keep the operator in, and the two that do not', () => {
  assert.equal(actLeavesOperatorSignedIn('revoke', 12, 1), true);
  assert.equal(actLeavesOperatorSignedIn('revoke_selected', [12, 13], 1), true);
  assert.equal(actLeavesOperatorSignedIn('end', 7, 1), true);
  assert.equal(actLeavesOperatorSignedIn('sign_out', 903, 1), true, 'another account');
  assert.equal(actLeavesOperatorSignedIn('sign_out', 1, 1), false, 'your own account signs you out');
  assert.equal(actLeavesOperatorSignedIn('sign_out', '1', 1), false, 'the id as a string is still yours');
  assert.equal(actLeavesOperatorSignedIn('sign_out', 903, null), false, 'unknown own account: do not risk a 401 re-read');
  assert.equal(actLeavesOperatorSignedIn('emergency', undefined, 1), false);
  assert.equal(actLeavesOperatorSignedIn('unknown', 1, 1), false);
});

// ── 1. the ledger: the newest read wins ──────────────────────────────────

test('a ledger read that answers after a newer one is dropped: the newer filter\'s rows stay', async () => {
  const slow = deferred();
  const calls = [];
  const p = await page('/admin/security?tab=events', {
    hqSecurityOverview: async () => OVERVIEW(),
    hqSecuritySessions: async () => SESSIONS([OWN]),
    hqGovernance: (filter) => { calls.push(filter); return filter === 'all' ? slow.promise : Promise.resolve(FEED(['security:new'], { filter })); },
  });
  try {
    await p.click(p.button(/^Sign-ins and step-ups$/));
    assert.ok(p.byId('event-row-security:new'), 'the newer read drew');
    // The first read, for "all", answers last.
    await act(async () => { slow.res(FEED(['security:stale'])); });
    await p.settle();
    assert.equal(p.byId('event-row-security:stale'), undefined, 'the older answer was drawn over the newer one');
    assert.ok(p.byId('event-row-security:new'));
    assert.deepEqual(calls, ['all', 'auth']);
  } finally { await p.done(); }
  // Mutation checked: dropping `current()` from loadFeed's success → the stale rows replace the new ones.
});

test('a Load older page that answers after the list changed is not appended to the new list', async () => {
  const older = deferred();
  const p = await page('/admin/security?tab=events', {
    hqSecurityOverview: async () => OVERVIEW(),
    hqSecuritySessions: async () => SESSIONS([OWN]),
    hqGovernance: (filter, params = {}) => {
      if (params.before) return older.promise;
      return Promise.resolve(filter === 'all'
        ? FEED(['security:a1'], { more: true, cursor: { before: sqlAgo(10) } })
        : FEED(['security:b1'], { filter }));
    },
  });
  try {
    await p.click(p.byId('events-load-older'));
    await p.click(p.button(/^Sign-ins and step-ups$/));
    await act(async () => { older.res(FEED(['security:a-older'])); });
    await p.settle();
    assert.equal(p.byId('event-row-security:a-older'), undefined, 'the old list\'s page was appended to the new one');
    assert.ok(p.byId('event-row-security:b1'));
  } finally { await p.done(); }
  // Mutation checked: removing the `listOf.current !== list` check → security:a-older is drawn.
});

// ── 2. sessions: the cursor ─────────────────────────────────────────────

test('Load older sessions appends the next page once, then stops; a failed page says so and can be tried again', async () => {
  const asked = [];
  let fail = true;
  const p = await page('/admin/security?tab=access', {
    hqSecurityOverview: async () => OVERVIEW(4),
    hqGovernance: async () => FEED([]),
    hqSecuritySessions: async (before = null) => {
      asked.push(before);
      if (!before) return SESSIONS([OWN, ROW(40)], { before_id: 40 }, 4);
      if (fail) { fail = false; throw Object.assign(new Error('unreadable'), { status: 503 }); }
      // A row the first page already holds comes back too: it is drawn once.
      return SESSIONS([ROW(40), ROW(30), ROW(20)], null, 4);
    },
  });
  try {
    assert.ok(p.byId('hq-session-40'));
    assert.equal(p.byId('hq-session-30'), undefined);
    await p.click(p.byId('hq-sessions-load-more'));
    assert.ok(p.byId('hq-sessions-more-failed'), 'a failed page is said');
    assert.equal(p.byId('hq-session-30'), undefined);
    await p.click(p.byId('hq-sessions-load-more'));
    assert.equal(p.byId('hq-sessions-more-failed'), undefined);
    for (const id of [50, 40, 30, 20]) assert.ok(p.byId(`hq-session-${id}`), `session ${id}`);
    const rows = p.text().match(/User 40/g) || [];
    assert.ok(rows.length >= 1);
    assert.equal(p.byId('hq-sessions-more'), undefined, 'no cursor, no Load older');
    assert.deepEqual(asked, [null, 40, 40]);
  } finally { await p.done(); }
});

// ── 3. after an act ─────────────────────────────────────────────────────

async function revokeOne(p, id) {
  const opener = p.button(/^Revoke this session…/);
  assert.ok(opener, 'Revoke is offered');
  await p.click(opener);
  await p.type(p.byId('action-reason'), 'Unrecognised device reported');
  await p.click(p.byId('action-continue'));
  await p.click(p.byId('action-confirm'));
  return id;
}

test('after a revoke the overview and the ledger are read again, softly: the result stays, the row stays Revoked', async () => {
  const count = { overview: 0, feed: 0, sessions: 0 };
  const p = await page('/admin/security?tab=access', {
    hqSecurityOverview: async () => { count.overview += 1; return OVERVIEW(count.overview === 1 ? 2 : 1); },
    hqGovernance: async () => { count.feed += 1; return FEED([`security:${count.feed}`]); },
    hqSecuritySessions: async () => { count.sessions += 1; return SESSIONS([OWN, ROW(40)]); },
    hqRevokeSession: async (id) => ({ ok: true, session_id: id, revoked_at: sqlAgo(0) }),
  });
  try {
    assert.deepEqual(count, { overview: 1, feed: 1, sessions: 1 });
    await revokeOne(p, 40);
    assert.equal(p.props(p.byId('action-result'))['data-result'], 'done', 'the result is still drawn');
    assert.deepEqual(count, { overview: 2, feed: 2, sessions: 1 }, 'the overview and the ledger are re-read; the list is not');
    assert.equal(p.props(p.byId('hq-session-40'))['data-status'], 'revoked', 'the row this page changed is still marked');
  } finally { await p.done(); }
  // Mutation checked: `actLeavesOperatorSignedIn` returning false → overview and feed stay at 1.
});

test('after emergency re-authentication nothing is re-read: the next request would be a 401', async () => {
  const count = { overview: 0, feed: 0 };
  const p = await page('/admin/security?tab=access', {
    hqSecurityOverview: async () => { count.overview += 1; return OVERVIEW(); },
    hqGovernance: async () => { count.feed += 1; return FEED([]); },
    hqSecuritySessions: async () => SESSIONS([OWN, ROW(40)]),
    hqSecurityForceReauth: async () => ({ ok: true, revoked_sessions: 2 }),
  });
  try {
    const before = { ...count };
    let sent = 0;
    api.hqSecurityForceReauth = async () => { sent += 1; return { ok: true, revoked_sessions: 2 }; };
    await p.click(p.byId('access-emergency-open'));
    await p.type(p.byId('action-reason'), 'Credential leak suspected');
    await p.click(p.byId('action-continue'));
    await p.type(p.byId('action-phrase'), 'SIGN OUT HQ');
    await p.click(p.byId('action-confirm'));
    assert.equal(sent, 1, 'the emergency act was sent');
    assert.ok(p.byId('action-result'), 'its result is drawn');
    assert.deepEqual(count, before, 'emergency re-authentication re-read the page');
  } finally { await p.done(); }
});
