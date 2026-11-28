/**
 * D6257 (#6257) — Investor › Network v2, built to the D6256 canvas: the
 * Introductions zone's three sections (NW3), the Request introduction sheet
 * (NW3.1, NW3.1B, NW8.1) and the Organizations directory and detail (NW4,
 * NW4B, NW4.1). Every read is stubbed; nothing reaches a server.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_network_6257.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { relationshipsApi } from '../src/lib/api/relationships.js';
import {
  matchGroups, matchViewLabel, openRemindersFor, requestBranch, searchQuery, latestTouch, isCold, searchOrganizations, nameSource,
} from '../src/pages/investor/investorNetworkModel.js';

const restoreDoc = installDocument();
const { default: InvestorNetworkWorkspace } = await import('../src/pages/investor/InvestorNetworkWorkspace.jsx');
const { default: InvestorNetworkRequestSheet } = await import('../src/pages/investor/InvestorNetworkRequestSheet.jsx');
const { default: IntroductionsDesk } = await import('../src/pages/relationships/IntroductionsDesk.jsx');
restoreDoc();

const h = React.createElement;
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const propsOf = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
const flushOnce = () => act(async () => { await new Promise((r) => setImmediate(r)); });

async function render(element) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/network'] }, element)); });
  await flushOnce();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const byTestId = (id) => nodes().find((n) => n.nodeType === 1 && propsOf(n)['data-testid'] === id) || null;
  const byPrefix = (prefix) => nodes().filter((n) => n.nodeType === 1 && String(propsOf(n)['data-testid'] || '').startsWith(prefix));
  const button = (label) => nodes().find((n) => n.nodeName === 'BUTTON' && (propsOf(n)['aria-label'] === label || textOf(n).trim() === label)) || null;
  return {
    text: () => textOf(container), byTestId, byPrefix, button,
    click: async (node) => { assert.ok(node, 'nothing to click'); await act(async () => propsOf(node).onClick?.({ preventDefault() {} })); await flushOnce(); },
    type: async (node, value) => { assert.ok(node, 'nothing to type into'); await act(async () => propsOf(node).onChange?.({ target: { value } })); },
    async done() { await act(async () => root.unmount()); restore(); },
  };
}

function stub(target, impl) {
  const original = {};
  for (const [k, fn] of Object.entries(impl)) { original[k] = target[k]; target[k] = fn; }
  return () => Object.assign(target, original);
}

/* ------------------------------------------------------------------ the model */

// Mutation checked: expired counted as declined (fails); Stalled label without "expired" (fails).
test('NW3 model: four match views, expired is Stalled, and each count is its own', () => {
  const g = matchGroups([{ status: 'pending' }, { status: 'pending' }, { status: 'accepted' }, { status: 'expired' }, { status: 'declined' }]);
  assert.deepEqual(g.counts, { pending: 2, accepted: 1, declined: 1, stalled: 1 });
  assert.equal(g.rowsFor('stalled').length, 1);
  assert.equal(matchViewLabel('pending', 2), 'Awaiting your decision · 2');
  assert.equal(matchViewLabel('stalled', 1), 'Stalled · 1 expired');
  assert.deepEqual(matchGroups(null).counts, { pending: 0, accepted: 0, declined: 0, stalled: 0 });
});

// Mutation checked: unreadable reminders returned as [] (fails); done reminders counted open (fails);
// the ask branch offered with no target (fails); no touch drawn as cold (fails).
test('NW3.1 and NW4 model: the branch, the query, open reminders, latest touch, search', () => {
  assert.equal(requestBranch({ people: [{}], askTargets: [] }), 'pick');
  assert.equal(requestBranch({ people: [], askTargets: [{ key: 'founder_user_id:1' }] }), 'ask');
  assert.equal(requestBranch({ people: [], askTargets: [] }), 'no_ask');
  assert.deepEqual(searchQuery('person', ' a@example.test '), { person: 'a@example.test' });
  assert.equal(searchQuery('person', '  '), null);
  assert.equal(searchQuery('team', 'x'), null);
  assert.equal(openRemindersFor([1], 'unreadable'), 'unreadable');
  assert.equal(openRemindersFor([1], null), null);
  assert.deepEqual(openRemindersFor(new Set([1]), [{ uid: 'a', relationship_id: 1 }, { uid: 'b', relationship_id: 1, done: true }, { uid: 'c', relationship_id: 2 }]).map((r) => r.uid), ['a']);
  assert.equal(latestTouch([{ lastTouch: '2026-09-01T00:00:00Z' }, { lastTouch: null }, { lastTouch: '2026-10-01T00:00:00Z' }]), '2026-10-01T00:00:00Z');
  assert.equal(latestTouch([{ lastTouch: null }]), null);
  assert.equal(isCold(null), false, 'no touch is unknown, never cold');
  assert.equal(isCold('2026-01-01T00:00:00Z', Date.parse('2026-11-27T00:00:00Z')), true);
  assert.equal(isCold('2026-11-01T00:00:00Z', Date.parse('2026-11-27T00:00:00Z')), false);
  assert.deepEqual(searchOrganizations([{ name: 'Harbor Seed' }, { name: 'Acme' }], 'harb').map((o) => o.name), ['Harbor Seed']);
  assert.equal(nameSource({ profileId: 'p' }), 'their account');
  assert.match(nameSource({ profileId: null }), /profile not confirmed/);
});

/* ------------------------------------------------------------------ the request sheet */

const PEOPLE = [
  { ref: 11, teammate: { id: 7, name: 'Iris Example' }, team: { label: 'Harbor Example' }, person: { name: 'Theo Example', company: 'Kelp Example' }, how: { source: 'linkedin' } },
  { ref: 12, teammate: { id: 8, name: 'Tom Example' }, team: { label: 'Harbor Example' }, person: { name: 'Theo Example' }, how: null },
];

// Mutation checked: the second teammate not choosable (fails); the note not sent (fails); the sent panel not drawn (fails);
// the From your team re-read event not dispatched (fails); Continue enabled with nobody chosen (fails).
test('NW3.1: who, introducer, review and send, then the request record opens', async () => {
  const calls = [];
  const fake = {
    whoKnows: async (q) => { calls.push(['whoKnows', q]); return { people: PEOPLE }; },
    requestIntro: async (b) => { calls.push(['requestIntro', b]); return { request: { uid: 'req1', status: 'pending' } }; },
    draftAskReason: async () => ({ estimate: { tokens: 400 } }),
    introRequest: async () => new Promise(() => {}),
  };
  let events = 0;
  const page = await render(h(InvestorNetworkRequestSheet, { onClose: () => {}, api: fake }));
  // The test DOM's window has no event target: count what the sheet dispatches.
  globalThis.dispatchEvent = (e) => { if (e?.type === 'network:intro-requested') events += 1; return true; };
  try {
    assert.equal(propsOf(page.byTestId('request-intro-find')).disabled, true, 'Find runs with nothing to find');
    await page.type(page.byTestId('request-intro-value'), 'linkedin.com/in/theo-example');
    await page.click(page.byTestId('request-intro-find'));
    assert.deepEqual(calls[0], ['whoKnows', { person: 'linkedin.com/in/theo-example' }]);
    assert.match(page.text(), /Who can introduce you\?/);
    assert.equal(page.byPrefix('request-intro-pick-').length, 2);
    await page.click(page.byTestId('request-intro-pick-1'));
    assert.equal(propsOf(page.byTestId('request-intro-pick-1'))['aria-checked'], true);
    await page.type(page.byTestId('request-intro-note'), 'We are building a pilot shortlist.');
    await page.click(page.byTestId('request-intro-continue'));
    const review = textOf(page.byTestId('request-intro-review'));
    assert.match(review, /Tom Example/);
    assert.match(review, /No credit is used for a team request/);
    await page.click(page.byTestId('request-intro-send'));
    assert.deepEqual(calls[1], ['requestIntro', { teammate: 8, ref: 12, note: 'We are building a pilot shortlist.' }]);
    assert.match(textOf(page.byTestId('request-intro-sent')), /Sent to Tom Example\..*From your team · Sent/);
    assert.equal(events, 1, 'From your team was not told to read again');
    assert.ok(page.byTestId('request-intro-open-record'), 'the sent request has no way to its record');
  } finally { delete globalThis.dispatchEvent; await page.done(); }
});

// Mutation checked: a failed read drawn as "No teammate knows them" (fails); Try again not re-reading (fails);
// a 400 kept on step 2 (fails).
test('NW3.1: a failed who-knows read is Unavailable with Try again; a refused query returns to step 1 with its reason', async () => {
  let reads = 0;
  const fake = {
    whoKnows: async () => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error('x'), { status: 500 });
      if (reads === 2) throw Object.assign(new Error('x'), { status: 400, data: { message: 'Give a LinkedIn profile URL or an email address. A name alone never matches a person.' } });
      return { people: PEOPLE };
    },
  };
  const page = await render(h(InvestorNetworkRequestSheet, { onClose: () => {}, api: fake }));
  try {
    await page.type(page.byTestId('request-intro-value'), 'Theo Example');
    await page.click(page.byTestId('request-intro-find'));
    assert.ok(page.byTestId('request-intro-unreadable'), 'the failed read is not said');
    assert.doesNotMatch(page.text(), /No teammate knows them/);
    assert.equal(propsOf(page.byTestId('request-intro-continue')).disabled, true);
    await page.click(page.button('Retry'));
    assert.equal(reads, 2, 'Try again did not read again');
    assert.match(textOf(page.byTestId('request-intro-refused-query')), /A name alone never matches a person/);
    assert.ok(page.byTestId('request-intro-find'), 'a refused query left step 1');
  } finally { await page.done(); }
});

// Mutation checked: Use 1 ask enabled on an unreadable quota (fails); the ask sent without its target (fails);
// the ask branch offered with nothing nameable (fails).
test('NW3.1B: nobody who shares knows them — the ask on a founder on Axal, or plainly no ask', async () => {
  const target = { key: 'founder_user_id:41', label: 'Amara Example', body: { founder_user_id: 41 } };
  const sent = [];
  const fake = { whoKnows: async () => ({ people: [] }) };
  const page = await render(h(InvestorNetworkRequestSheet, {
    onClose: () => {}, api: fake, askTargets: [target], asksReady: true,
    quota: { status: 'unreadable', value: null }, requestAsk: (t, m) => sent.push([t.key, m]),
  }));
  try {
    await page.type(page.byTestId('request-intro-value'), 'a@example.test');
    await page.click(page.byTestId('request-intro-find'));
    assert.ok(page.byTestId('request-intro-ask'), 'the ask branch is not offered');
    assert.match(textOf(page.byTestId('request-intro-quota')), /could not be read/);
    assert.equal(propsOf(page.byTestId('request-intro-ask-send')).disabled, true, 'an ask can be sent against an unread quota');
    assert.match(page.text(), /An ask is not consent from the founder\./);
  } finally { await page.done(); }

  const ready = await render(h(InvestorNetworkRequestSheet, {
    onClose: () => {}, api: fake, askTargets: [target], asksReady: true,
    quota: { status: 'ready', value: { used: 1, cap: 3, remaining: 2, quarter: 'Q4 2026' } }, requestAsk: (t, m) => sent.push([t.key, m]),
  }));
  try {
    await ready.type(ready.byTestId('request-intro-value'), 'a@example.test');
    await ready.click(ready.byTestId('request-intro-find'));
    assert.match(textOf(ready.byTestId('request-intro-quota')), /2 of 3 asks left this quarter \(Q4 2026\)/);
    await ready.type(ready.byTestId('request-intro-ask-message'), 'We back textile tech.');
    await ready.click(ready.byTestId('request-intro-ask-send'));
    assert.deepEqual(sent, [['founder_user_id:41', 'We back textile tech.']]);
  } finally { await ready.done(); }

  const none = await render(h(InvestorNetworkRequestSheet, { onClose: () => {}, api: fake, askTargets: [] }));
  try {
    await none.type(none.byTestId('request-intro-value'), 'Corran Example');
    await none.click(none.byTestId('request-intro-kind-fund'));
    await none.type(none.byTestId('request-intro-value'), 'Corran Example');
    await none.click(none.byTestId('request-intro-find'));
    assert.match(textOf(none.byTestId('request-intro-no-ask')), /An ask cannot be used here\./);
    assert.equal(none.byTestId('request-intro-ask'), null);
  } finally { await none.done(); }
});

/* ------------------------------------------------------------------ From your team */

const reqRow = (uid, side, over = {}) => ({
  uid, status: 'pending', requester: { id: side === 'sent' ? 1 : 2, name: side === 'sent' ? 'You' : 'Dev Example' },
  teammate: { id: side === 'sent' ? 3 : 1, name: 'Iris Example' }, person: { name: 'Lena Example' }, created_at: `2026-11-1${uid.length} 10:00:00`, ...over,
});

// Mutation checked: the investor heading kept as "Introductions" (fails); Sent filtering received rows (fails);
// a failed log read drawn as empty (fails).
test('NW3 From your team: the investor desk counts received and sent, filters by direction, and opens each record', async () => {
  const restore = stub(relationshipsApi, {
    introRequests: async () => ({ sent: [reqRow('s1', 'sent'), reqRow('s22', 'sent', { status: 'made' })], received: [reqRow('r333', 'received')] }),
    sharing: async () => ({ teams: [] }),
    summary: async () => ({}),
  });
  const page = await render(h(IntroductionsDesk, { variant: 'investor' }));
  try {
    assert.match(textOf(page.byTestId('introductions-log-title')), /^From your team$/);
    assert.equal(textOf(page.byTestId('introductions-team-line')), '1 received · 2 sent · no credit is used');
    assert.equal(page.byPrefix('introductions-row-').filter((n) => /^introductions-row-[a-z0-9]+$/.test(propsOf(n)['data-testid'])).length, 3);
    await page.click(page.byTestId('introductions-direction-sent'));
    const shown = page.byPrefix('introductions-row-').map((n) => propsOf(n)['data-testid']).filter((id) => /^introductions-row-[a-z0-9]+$/.test(id));
    assert.deepEqual(shown.sort(), ['introductions-row-s1', 'introductions-row-s22']);
    assert.ok(page.byTestId('introductions-row-s1-open'), 'a row has no Open record');
  } finally { await page.done(); restore(); }

  const restoreFail = stub(relationshipsApi, {
    introRequests: async () => { throw new Error('down'); }, sharing: async () => ({ teams: [] }), summary: async () => ({}),
  });
  const failed = await render(h(IntroductionsDesk, { variant: 'investor' }));
  try {
    assert.ok(failed.byTestId('introductions-error'), 'a failed read is not said');
    assert.equal(failed.byTestId('introductions-empty'), null, 'a failed read drawn as no introductions');
    assert.equal(failed.byTestId('introductions-team-line'), null, 'counts drawn over a failed read');
  } finally { await failed.done(); restoreFail(); }
});

/* ------------------------------------------------------------------ the investor page */

const NETWORK = ['partnerRelationships', 'partnerSummary', 'introPropositions', 'listIntroductions', 'partnerReminders', 'introductionsQuota', 'introductionsRequest', 'partnerReminderDone'];
const prop = (uid, status) => ({ uid, status, source: 'curated', score: 80, target: { name: `Match ${uid}` }, counterpart_status: 'pending' });
const tie = (id, name, company, over = {}) => ({
  id, relationship_type: 'co_investor', last_interaction_at: null,
  other: { id: 100 + id, name, role: 'investor', company, company_profile_id: company ? `p-${company}` : null }, ...over,
});

async function mountPage(zone, overrides = {}) {
  const calls = [];
  const defaults = {
    partnerRelationships: async () => [],
    partnerSummary: async () => ({}),
    introPropositions: async () => ({ propositions: [], credits: { balance: 2 } }),
    listIntroductions: async () => ({ introductions: [] }),
    partnerReminders: async () => ({ items: [] }),
    introductionsQuota: async () => ({ used: 1, cap: 3, remaining: 2 }),
    introductionsRequest: async () => ({ ok: true }),
    partnerReminderDone: async () => ({}),
  };
  const restore = stub(api, Object.fromEntries(NETWORK.map((k) => [k, (...a) => { calls.push(k); return (overrides[k] || defaults[k])(...a); }])));
  const restoreRel = stub(relationshipsApi, { whoKnows: async () => ({ people: [] }) });
  const page = await render(h(InvestorNetworkWorkspace, { embedded: true, zone, role: 'investor', zoneFilters: () => [] }));
  return { ...page, calls, async done() { await page.done(); restore(); restoreRel(); } };
}

// Mutation checked: Your asks hidden on the default view (fails); Accepted matches shown under Awaiting (fails);
// the request sheet not opened by the zone's handler (fails).
test('NW3: Curated matches and Your asks are their own sections; Awaiting your decision first; Request an intro opens the sheet', async () => {
  const page = await mountPage('introductions', {
    introPropositions: async () => ({ propositions: [prop('a', 'pending'), prop('b', 'accepted'), prop('c', 'expired')], credits: { balance: 2 } }),
    listIntroductions: async () => ({ introductions: [{ uid: 'k1', status: 'pending', target: { kind: 'founder', available: true, name: 'Sofia Example' }, created_at: '2026-10-19 10:00:00' }] }),
  });
  try {
    assert.ok(page.byTestId('section-curated-matches'), 'Curated matches is not a section');
    assert.ok(page.byTestId('section-your-asks'), 'Your asks is not a section');
    assert.match(textOf(page.byTestId('text-your-asks-detail')), /^2 of 3 asks left this quarter/);
    assert.equal(textOf(page.byTestId('match-view-pending')), 'Awaiting your decision · 1');
    assert.equal(textOf(page.byTestId('match-view-stalled')), 'Stalled · 1 expired');
    assert.deepEqual(page.byPrefix('card-introduction-').map((n) => propsOf(n)['data-testid']), ['card-introduction-a']);
    await page.click(page.byTestId('match-view-accepted'));
    assert.deepEqual(page.byPrefix('card-introduction-').map((n) => propsOf(n)['data-testid']), ['card-introduction-b']);
    assert.match(page.text(), /Sofia Example/);
    await page.click(page.button('Request an intro'));
    assert.ok(page.byTestId('request-intro'), 'Request an intro did not open the sheet');
  } finally { await page.done(); }
});

// Mutation checked: a failed reminders read counted as None (fails); no touch drawn as a date (fails);
// the detail opened for the wrong organization (fails); the search narrowing on something but the name (fails).
test('NW4 and NW4.1: the directory table, its reminders column, the search, and the detail with Who knows them', async () => {
  const rows = [tie(1, 'Eva Example', 'Northstar Example', { last_interaction_at: '2026-09-08T10:00:00Z' }), tie(2, 'Hugo Example', 'Northstar Example'), tie(3, 'Ada Example', 'Harbor Example')];
  const page = await mountPage('organizations', {
    partnerRelationships: async () => rows,
    partnerReminders: async () => ({ items: [{ uid: 'm1', relationship_id: 1, remind_at: '2026-11-13', note: 'Share deal memo', done: false }] }),
  });
  try {
    const counts = page.byPrefix('organization-count').map(textOf);
    assert.deepEqual(counts, ['2', '1']);
    assert.deepEqual(page.byPrefix('organization-reminders').map(textOf), ['1 open', '○ None']);
    assert.equal(textOf(page.byPrefix('organization-latest')[1]), '— Not recorded');
    await page.type(page.byTestId('input-organizations-search'), 'harb');
    assert.deepEqual(page.byPrefix('organization-open').map(textOf), ['Harbor Example']);
    await page.type(page.byTestId('input-organizations-search'), '');
    await page.click(page.byPrefix('organization-open')[0]);
    const sheet = page.byTestId('organization-sheet');
    assert.ok(sheet, 'the detail did not open');
    assert.match(textOf(sheet), /Northstar Example/);
    assert.match(textOf(sheet), /2 people in your book/);
    assert.ok(page.byTestId('organization-sheet-person-101') && page.byTestId('organization-sheet-person-102'));
    assert.match(textOf(page.byTestId('organization-sheet-touch-102')), /Not recorded/);
    assert.match(textOf(page.byTestId('organization-sheet-reminder-m1')), /Share deal memo/);
    assert.ok(page.byTestId('organization-sheet-who-knows'), 'Who knows them is not mounted');
    assert.match(textOf(page.byTestId('organization-sheet-intros-none')), /Not recorded/);
  } finally { await page.done(); }

  const failed = await mountPage('organizations', {
    partnerRelationships: async () => rows,
    partnerReminders: async () => { throw new Error('down'); },
  });
  try {
    assert.deepEqual(failed.byPrefix('organization-reminders').map(textOf), ['? Could not be read', '? Could not be read']);
    await failed.click(failed.byPrefix('organization-open')[0]);
    assert.ok(failed.byTestId('organization-sheet-reminders-unreadable'), 'the detail draws a failed read as none');
    assert.equal(failed.byTestId('organization-sheet-reminders-none'), null);
  } finally { await failed.done(); }
});
