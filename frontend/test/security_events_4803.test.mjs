/**
 * D4803 (#4803, Security v2 Events, canvas SE03a, SE03b, SE11b, SE10b to SE10d):
 * the Events workspace.
 *
 *   · every row leads with a human label and keeps the stored action beneath
 *     it; an action the page has no word for is drawn from its own id;
 *   · outcomes use the shared state vocabulary: a refusal is Action required,
 *     the four write-after stores read Recorded, a support session its state;
 *   · rows group by UTC day; the untouched filter bar sends nothing, so the
 *     first read is the ledger's old one;
 *   · a failed source is named and the list is never drawn as a real zero;
 *     an unreadable ledger is not empty; a measured empty is said to be one;
 *   · Load older sends the server's cursor and appends, once each by key;
 *   · the event drawer says what happened, keeps the raw row behind a
 *     disclosure, and its actor link narrows the filters to that account;
 *   · branch is shown, disabled, with why.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/security_events_4803.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import EventsWorkspace from '../src/pages/hq/security/EventsWorkspace.jsx';
import {
  actorOptions, byDay, eventLabel, feedQuery, humanize, mergePages, outcomeState, rangeDays,
} from '../src/pages/hq/security/eventsModel.js';
import { EMPTY_CONTROLS, UNAVAILABLE } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-11-07T14:30:00Z');
const SUPER = { kind: 'user', user_id: 1, label: 'Guillaume L.', on_behalf_of: null, network: null };
const NET = { kind: 'network', user_id: null, label: 'network 203.0.113.0/24', on_behalf_of: null, network: '203.0.113.0/24' };
const ROWS = [
  { key: 'security:88214', at: '2026-11-07 14:12:08', actor: SUPER.label, actor_identity: SUPER, action: 'gate.totp', tenant: 'HQ', target: 'detail=factor_required', source: 'security_events', tone: 'alert', outcome: 'refused' },
  { key: 'licence:4', at: '2026-11-07 11:05:00', actor: 'M. Okafor', actor_identity: { ...SUPER, user_id: 2, label: 'M. Okafor' }, action: 'licence suspended', tenant: 'Lisbon branch', target: 'AXL-004', source: 'licence_events', tone: 'alert', outcome: 'ok' },
  { key: 'security:88200', at: '2026-11-07 09:47:00', actor: NET.label, actor_identity: NET, action: 'signin.password', tenant: 'HQ', target: 'detail=unknown_account', source: 'security_events', tone: 'alert', outcome: 'refused' },
  { key: 'impersonation:7', at: '2026-11-06 18:40:00', actor: SUPER.label, actor_identity: SUPER, action: 'impersonate', tenant: null, target: 'Fran Target', source: 'impersonation_sessions', tone: 'alert', outcome: 'ended' },
];
const SOURCES = ['admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events', 'security_events']
  .map((table) => ({ table, available: true, rows: 3 }));
const FEED = (extra = {}) => ({
  filter: 'all', filters: null, rows: ROWS, limit: 60, more: true, cursor: { before: '2026-11-06 18:40:00' },
  applied: {}, page_split_second: false, sources: SOURCES, tenant_reason: 'Two stores can fill this column.', tenant_view_reason: 'A read, not a role.', ...extra,
});
const html = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(EventsWorkspace, {
  unavailable: UNAVAILABLE, filter: 'all', setFilter() {}, controls: EMPTY_CONTROLS, setControls() {}, onRetry() {}, loadOlder: async () => ({}), now: NOW, ...props,
})));

// ─────────────────────────────────────────────────────────── the model ──

test('labels lead and the stored action stays; an unknown action is its own id, never guessed', () => {
  assert.deepEqual(eventLabel(ROWS[0]), { label: 'Multi-factor authentication required', raw: 'gate.totp detail=factor_required' });
  assert.deepEqual(eventLabel(ROWS[2]), { label: 'Sign-in refused · password', raw: 'signin.password detail=unknown_account' });
  assert.equal(eventLabel(ROWS[1]).label, 'Licence suspended');
  assert.equal(eventLabel(ROWS[3]).label, 'Support session ended');
  assert.equal(eventLabel({ source: 'activity_logs', action: 'kyc_case_assigned' }).label, 'KYC case assigned');
  assert.equal(eventLabel({ source: 'admin_audit_log', action: 'members_csv_export' }).label, 'Export downloaded');
  assert.deepEqual(eventLabel({ source: 'admin_audit_log', action: 'mercury_accounts_read' }), { label: 'Mercury accounts read', raw: 'mercury_accounts_read' });
  assert.equal(humanize(''), 'Unnamed action');
});

test('outcomes use the shared vocabulary; a refusal is never drawn as healthy', () => {
  assert.deepEqual(outcomeState(ROWS[0]), { state: 'action_required', word: 'Refused' });
  assert.deepEqual(outcomeState({ source: 'security_events', outcome: 'ok' }), { state: 'healthy', word: 'Allowed' });
  assert.deepEqual(outcomeState(ROWS[1]), { state: 'healthy', word: 'Recorded' });
  assert.deepEqual(outcomeState({ source: 'impersonation_sessions', outcome: 'live' }), { state: 'pending', word: 'Live' });
  assert.deepEqual(outcomeState({ source: 'impersonation_sessions', outcome: 'not closed' }), { state: 'unknown', word: 'Not closed' });
  assert.equal(outcomeState({ outcome: null }).state, 'unknown');
});

test('days group in UTC; an untouched bar asks for nothing; ranges are whole UTC days', () => {
  assert.deepEqual(byDay(ROWS, NOW).map((g) => [g.day, g.rows.length]), [['Today · Sat 7 Nov', 3], ['Fri 6 Nov', 1]]);
  assert.deepEqual(feedQuery(EMPTY_CONTROLS, NOW), {});
  assert.deepEqual(rangeDays('7d', NOW), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(feedQuery({ ...EMPTY_CONTROLS, q: ' totp ', range: 'today', actor: '2', outcome: 'refused', source: 'security_events' }, NOW),
    { q: 'totp', from: '2026-11-07', to: '2026-11-07', actor: '2', outcome: 'refused', source: 'security_events' });
  assert.deepEqual(actorOptions(ROWS).map((a) => a.label), ['Guillaume L.', 'M. Okafor'], 'a network offered as an actor');
  assert.deepEqual(mergePages([{ key: 'a' }, { key: 'b' }], [{ key: 'b' }, { key: 'c' }]).map((r) => r.key), ['a', 'b', 'c']);
});

// ─────────────────────────────────────────────────────────── the render ──

test('SE03a: six columns, day groups, the label over the raw id, Load older with its line, branch disabled with why', () => {
  const page = html({ feed: FEED() });
  const t = renderedText(page);
  assert.match(page, /<th[^>]*scope="colgroup"[^>]*>Today · Sat 7 Nov<\/th>/);
  assert.match(page, /<th[^>]*scope="colgroup"[^>]*>Fri 6 Nov<\/th>/);
  assert.match(t, /Multi-factor authentication required\s*gate\.totp detail=factor_required/);
  assert.match(t, /Lisbon branch/);
  assert.match(t, /Not recorded/, 'a store with no branch drew one');
  assert.match(page, /data-testid="events-load-older"/);
  assert.match(t, /Older than 6 Nov 18:40 UTC · keeps your filters/);
  assert.match(page, /<select disabled=""[^>]*data-testid="events-branch"/);
  assert.match(t, /Only licence and security events record a branch\./);
  assert.match(t, /5 of 5 sources read/);
  assert.doesNotMatch(page, /data-testid="hq-gov-empty"/);
});

test('SE10c / SE10d / SE10b: partial names the source and is never a zero; unreadable is not empty; empty is measured', () => {
  const partial = html({ feed: FEED({ rows: [], cursor: null, sources: [...SOURCES.slice(0, 4), { table: 'security_events', available: false, reason: 'down' }] }) });
  assert.match(renderedText(partial), /Security ledger \(refusals and step-ups\) could not be read\./);
  assert.doesNotMatch(partial, /data-testid="hq-gov-empty"/, 'a failed source read as a real zero');
  assert.match(renderedText(partial), /4 of 5 sources read/);

  const unreadable = html({ feed: UNAVAILABLE });
  assert.doesNotMatch(unreadable, /data-testid="hq-gov-empty"/);
  assert.match(renderedText(unreadable), /This is not a claim that nobody did anything\./);

  const empty = renderedText(html({ feed: FEED({ rows: [], cursor: null }) }));
  assert.match(empty, /Every source was read; this is a real zero\./);
  assert.doesNotMatch(empty, /Load older/);
});

test('the last page says it is the last; a filtered read says so', () => {
  const t = renderedText(html({ feed: FEED({ cursor: null, more: false }), controls: { ...EMPTY_CONTROLS, outcome: 'refused' } }));
  assert.match(t, /That is every event the sources hold for these filters\./);
  assert.match(t, /Clear filters/);
});

// ─────────────────────────────────────────────────────────── mounted ──

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  const older = [];
  const set = [];
  await act(async () => {
    r.render(h(MemoryRouter, null, h(EventsWorkspace, {
      unavailable: UNAVAILABLE, filter: 'all', setFilter() {}, controls: EMPTY_CONTROLS, setControls: (c) => set.push(c), onRetry() {},
      loadOlder: async (before) => { older.push(before); return { rows: [{ ...ROWS[3], key: 'audit:1', source: 'admin_audit_log', action: 'members_export', at: '2026-11-05 10:00:00', outcome: 'ok' }, ROWS[3]], cursor: null }; },
      now: NOW, feed: FEED(), ...props,
    })));
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const text = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join(''));
  const byId = (id) => walk(container).find((n) => props_(n)?.['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => props_(n)?.['data-testid'] === id);
  const click = async (n) => { await act(async () => { await props_(n).onClick({ currentTarget: n, preventDefault() {} }); }); };
  return { container, text, byId, all, click, older, set, done: async () => { await act(async () => r.unmount()); } };
}

test('mounted: Load older sends the cursor, appends once by key, and ends the list when the server says so', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount();
  try {
    await m.click(m.byId('events-load-older'));
    assert.deepEqual(m.older, ['2026-11-06 18:40:00']);
    const keys = m.all('event-open').length;
    assert.equal(keys, 5, 'the repeated row was drawn twice, or the new one was dropped');
    assert.match(m.text(m.container), /Thu 5 Nov/);
    assert.equal(m.byId('events-load-older'), undefined);
    assert.match(m.text(m.byId('events-end')), /every event the sources hold/);
  } finally { await m.done(); restore(); }
});

test('mounted: the drawer says what happened, keeps the raw row behind a disclosure, and its actor link narrows the filters', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount();
  try {
    await m.click(m.all('event-open')[0]);
    const drawer = m.byId('event-drawer');
    assert.ok(drawer, 'the drawer did not open');
    assert.match(m.text(m.byId('event-what')), /Guillaume L\.: multi-factor authentication required\. detail=factor_required\. It was refused\. Nothing was changed\./);
    assert.equal(m.byId('event-raw'), undefined, 'the raw row is open before it was asked for');
    await m.click(m.byId('event-raw-toggle'));
    assert.match(m.text(m.byId('event-raw')), /"key": "security:88214"/);
    assert.match(m.text(drawer), /Read-only\. The ledger cannot be edited from here\./);
    await m.click(m.byId('event-actor-filter'));
    assert.deepEqual(m.set.at(-1), { ...EMPTY_CONTROLS, actor: '1' });
    assert.equal(m.byId('event-drawer'), undefined, 'the drawer stayed open over the narrowed list');
  } finally { await m.done(); restore(); }
});

test('mounted: a network actor offers no account filter', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount();
  try {
    await m.click(m.all('event-open')[2]);
    assert.ok(m.byId('event-drawer'));
    assert.equal(m.byId('event-actor-filter'), undefined, 'a network was offered as an account to filter on');
  } finally { await m.done(); restore(); }
});
