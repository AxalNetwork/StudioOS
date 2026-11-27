/**
 * D4664 (#4664, Email audit 5/6, findings 8–10): People and sharing on `/email`.
 * Every person, address and record is made up; the mail API is faked.
 *
 *   · finding 8: the People pane draws each profile's own groups from
 *     `mailApi.people()` (investor, advisor, partner, admin, explorer, founder),
 *     with the returned source, last contact and marker; each group keeps its
 *     own empty or unreadable state, one failed group leaves the others, and
 *     "No people yet" is each profile's own, never Customer research for all;
 *   · finding 9: Stop sharing is offered while waiting and once both shared,
 *     behind a confirmation; cancel writes nothing, confirm revokes once, a
 *     failed revoke never says sharing stopped;
 *   · finding 10: a failed shares read is "could not be read" with Try again,
 *     never "not shared" and never an address; Try again keeps the person.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/email_people_sharing_4664.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import EmailPage from '../src/pages/email/EmailPage.jsx';
import RecordEmailSheet, { UNREADABLE } from '../src/pages/email/RecordEmailSheet.jsx';
import { noPeopleState, peoplePane, shareStatus } from '../src/pages/email/emailModel.js';

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function mounted(element, entry = '/email') {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [entry] }, element)));
  await act(flush);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)['data-testid'] === id);
  return {
    by, all, props,
    text: () => text(document.body),
    textOf: (n) => text(n),
    state: (id) => props(by(id))['data-state'],
    disabled: (n) => !!props(n).disabled,
    async press(node) { assert.ok(node, 'no such button'); await act(async () => { props(node).onClick?.({ preventDefault() {} }); }); await act(flush); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const ACCOUNT = { uid: 'acc-1', provider: 'gmail', address: 'me@example.test', status: 'active', can_read: false };
const row = (ref, name, over = {}) => ({ ref, name, role: null, source: 'From a record', last_contact: null, marker: null, marker_label: null, ...over });
const group = (key, label, people, over = {}) => ({ key, label, people, empty: people.length ? null : `No one in ${label} yet.`, error: null, ...over });
const NETWORK = (people = [row('member:u1', 'Sam Match', { source: 'Network · accepted 2026-10-20', last_contact: '2026-10-20' })]) => group('network', 'Network matches', people);

/** The groups `services/mail/people.ts` returns for each profile (GROUPS), with one synthetic person in each. */
const PROFILES = {
  investor: [
    group('deal_flow', 'Founders · deal flow', [row('deal:4', 'Ada Founder · Acme', { role: 'Founder', source: 'From Pipeline · deal flow', last_contact: '2026-10-30 12:00:00', marker: 'follow_up_due', marker_label: 'Follow-up due' })]),
    group('portfolio', 'Founders · portfolio', [row('holding:9', 'Bea Founder · Beta', { role: 'Founder', source: 'From Portfolio · holding', last_contact: '2026-10-01' })]),
    group('coinvestors', 'Co-investors', [row('coinvestor:2', 'Cy Investor', { source: 'From Syndicate · co-investor' })]),
    NETWORK(),
  ],
  advisor: [
    group('clients_sessions', 'Clients · sessions', [row('client:7', 'Dee Client', { source: 'From Practice · sessions', last_contact: '2026-11-02' })]),
    group('cohort_founders', 'Cohort founders', [row('cohort:3', 'Eve Founder', { source: 'From Cohort · founders' })]),
    NETWORK(),
  ],
  partner: [
    group('clients_engagements', 'Clients · engagements', [row('engagement:5', 'Fay Client', { source: 'From Practice · engagements', last_contact: '2026-10-11' })]),
    group('leads', 'Leads', [row('lead:8', 'Gus Founder · Gamma', { role: 'Founder', source: 'From Pipeline · proposal sent' })]),
    NETWORK(),
  ],
  admin: [
    group('applicants', 'Spin-Out Lab applicants', [row('application:12', 'Hal Applicant · Hexa', { role: 'Founder', source: 'From Programs · application', marker: 'follow_up_due', marker_label: 'Follow-up due' })]),
    group('tickets', 'Open support tickets', [row('ticket:31', 'Ivy Member', { source: 'From Support · ticket #31', last_contact: '2026-11-03' })]),
    group('partner_firms', 'Partner firms', [], { empty: 'No partner firm records an Axal holder yet, so none is listed.' }),
  ],
  explorer: [NETWORK()],
  founder: [NETWORK()],
};

function fakeApi({ people, shares, drafts = [], context, unshare, share } = {}) {
  const calls = [];
  const log = (name, fn) => (...args) => { calls.push([name, ...args]); return fn(...args); };
  return {
    calls,
    count: (name) => calls.filter(([n]) => n === name).length,
    accounts: log('accounts', () => Promise.resolve({ accounts: [ACCOUNT], providers: {} })),
    drafts: log('drafts', (person) => Promise.resolve({ drafts: person ? [] : drafts })),
    people: log('people', people ?? (() => Promise.resolve({ profile: 'founder', groups: PROFILES.founder, note: null, empty: null }))),
    shares: log('shares', shares ?? (() => Promise.resolve({ items: [] }))),
    context: log('context', context ?? ((ref) => Promise.resolve({ person: { ref, kind: 'member', name: 'Sam Match' }, items: [] }))),
    sent: log('sent', () => Promise.resolve({ page: 1, per_page: 20, total: 0, items: [] })),
    share: log('share', share ?? ((uid, yes) => Promise.resolve({ share: { uid, person: `member:${uid}`, name: 'Sam Match', mine: yes ? 'shared' : 'declined', theirs: 'pending', ready: false, address: null, line: '' } }))),
    unshare: log('unshare', unshare ?? ((uid) => Promise.resolve({ share: { uid, person: `member:${uid}`, name: 'Sam Match', mine: 'revoked', theirs: 'shared', ready: false, address: null, line: 'You’re matched. Email needs both of you to share an address.' } }))),
  };
}

const READY = { uid: 'u1', person: 'member:u1', name: 'Sam Match', mine: 'shared', theirs: 'shared', ready: true, address: 'sam@example.test', line: 'You can email Sam Match.', matched_at: '2026-10-20 09:00:00' };
const WAITING = { ...READY, theirs: 'pending', ready: false, address: null, line: 'Waiting for Sam Match to share their address.' };

// ── Finding 8: each profile's own People groups ─────────────────────────────

for (const [profile, groups] of Object.entries(PROFILES)) {
  test(`People: the ${profile} profile draws the groups its People read returns, with source, last contact and marker`, async () => {
    const api = fakeApi({ people: () => Promise.resolve({ profile, groups, note: profile === 'admin' ? 'Admins email members only about a case they hold.' : null, empty: null }) });
    const page = await mounted(h(EmailPage, { api, userId: 7 }));
    try {
      assert.equal(api.count('people'), 1, 'the profile-aware People read is the one the page asks');
      for (const g of groups) {
        const node = page.by(`people-group-${g.key}`);
        assert.ok(node, `${profile}: group ${g.key} is drawn`);
        assert.match(page.textOf(node), new RegExp(g.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(page.props(node)['data-state'], g.people.length ? 'ready' : 'empty');
        for (const p of g.people) {
          assert.match(page.textOf(node), new RegExp(p.name), `${profile}: ${p.name} in ${g.key}`);
          assert.match(page.textOf(node), new RegExp(p.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the returned source label');
          if (p.last_contact) assert.match(page.textOf(node), new RegExp(`last contact ${p.last_contact.slice(0, 10)}`), 'the returned last contact day');
          if (p.marker_label) assert.match(page.textOf(node), new RegExp(p.marker_label), 'the derived marker, as returned');
        }
        if (!g.people.length) assert.match(page.textOf(node), new RegExp(g.empty), 'an empty group says its own empty line');
      }
      assert.equal(page.by('email-no-people'), undefined, 'a profile with People data never gets "No people yet"');
      assert.doesNotMatch(page.text(), /Open Customer research/, 'no founder Customer research door when there are people');
      if (profile === 'admin') assert.match(page.textOf(page.by('people-note')), /case they hold/, 'the profile note, as returned');
    } finally { await page.close(); }
  });
}

test('People: one failed group says so in its own words and leaves the healthy groups usable', async () => {
  const groups = PROFILES.investor.map((g) => (g.key === 'portfolio' ? { ...g, people: [], empty: null, error: 'Founders · portfolio could not be read. Try again.' } : g));
  const api = fakeApi({ people: () => Promise.resolve({ profile: 'investor', groups, note: null, empty: null }) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }));
  try {
    assert.equal(page.state('people-group-portfolio'), 'unreadable');
    assert.match(page.textOf(page.by('people-group-portfolio')), /could not be read/);
    assert.doesNotMatch(page.textOf(page.by('people-group-portfolio')), /No one/, 'a failed group is never drawn as empty');
    assert.equal(page.state('people-group-deal_flow'), 'ready');
    assert.equal(page.state('people-group-network'), 'ready');
    assert.match(page.text(), /Ada Founder · Acme/);
    assert.equal(page.by('email-no-people'), undefined, 'a failed group is not "No people yet"');
  } finally { await page.close(); }
});

test('People: a profile with every group empty gets its own "No people yet", never Customer research unless a founder', async () => {
  const cases = [
    ['advisor', 'Open your clients', '/advisor/advisory/clients'],
    ['admin', 'Open Spin-Out Lab applications', '/admin/programs/spinout-lab/applications'],
    ['investor', 'Open Network', '/network'],
    ['partner', 'Open Network', '/network'],
    ['explorer', null, null],
    ['founder', 'Open Customer research', '/validate/customer-research'],
  ];
  for (const [profile, action, href] of cases) {
    const groups = PROFILES[profile].map((g) => ({ ...g, people: [], empty: `No one in ${g.label} yet.`, error: null }));
    const api = fakeApi({ people: () => Promise.resolve({ profile, groups, note: null, empty: null }) });
    const page = await mounted(h(EmailPage, { api, userId: 7 }));
    try {
      const card = page.by('email-no-people');
      assert.ok(card, `${profile}: an answered, empty read is "No people yet"`);
      assert.equal(noPeopleState(profile).href, href);
      if (action) assert.match(page.textOf(card), new RegExp(action), `${profile}: its own door`);
      if (profile !== 'founder') assert.doesNotMatch(page.text(), /Customer research/, `${profile} is not sent to Customer research`);
      if (!action) assert.doesNotMatch(page.textOf(card), /Open /, 'an explorer gets no door it cannot open');
      for (const g of groups) assert.equal(page.state(`people-group-${g.key}`), 'empty');
    } finally { await page.close(); }
  }
});

test('People: a failed People read is Unreadable, keeps the recent drafts, and Try again recovers', async () => {
  let fail = true;
  const drafts = [{ uid: 'd1', person: 'prospect:21', created_at: '2026-10-20 10:00:00', sources: [{ ref: 'prospect:21', label: 'Capital relationships · Ben Investor' }] }];
  const api = fakeApi({ drafts, people: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ profile: 'partner', groups: PROFILES.partner, note: null, empty: null })) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }));
  try {
    assert.ok(page.by('people-unreadable'), 'the read failed and says so');
    assert.equal(page.by('email-no-people'), undefined, 'a failed read is never "No people yet"');
    assert.equal(page.state('people-group-recent'), 'ready', 'the recent drafts stay');
    assert.match(page.text(), /Ben Investor/);
    fail = false;
    const find = (n) => (n.nodeName === 'BUTTON' ? n : (n.childNodes || []).map(find).find(Boolean) ?? null);
    await page.press(find(page.by('people-unreadable')));
    assert.equal(page.by('people-unreadable'), undefined);
    assert.equal(page.state('people-group-leads'), 'ready', 'recovered');
    assert.equal(page.state('people-group-recent'), 'ready');
    assert.equal(api.count('people'), 2);
  } finally { await page.close(); }
});

// ── Finding 10: a failed shares read is unknown, never "not shared" ────────

test('Sharing: a failed shares read says it could not be read, shows no address, and Try again recovers on the same person', async () => {
  let fail = true;
  const api = fakeApi({ shares: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ items: [READY] })) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=member%3Au1');
  try {
    assert.ok(page.by('sharing-unreadable'), 'the sharing state is unknown and says so');
    assert.match(page.textOf(page.by('thread-address')), /not verified/);
    assert.doesNotMatch(page.text(), /Address not shared yet|hasn’t shared|has not shared/, 'never says they have not shared');
    assert.doesNotMatch(page.text(), /sam@example\.test/);
    assert.equal(page.by('write-with-eadwyn'), undefined, 'no composer on an unverified share');
    assert.equal(page.by('sharing-stop'), undefined, 'no stop on an unknown state');
    assert.equal(page.state('people-group-network'), 'ready', 'the known match stays in People');
    fail = false;
    await page.press(page.by('sharing-retry'));
    assert.equal(page.by('sharing-unreadable'), undefined);
    assert.equal(page.textOf(page.by('thread-address')), 'sam@example.test', 'the address, now read');
    assert.ok(page.by('write-with-eadwyn'));
    assert.equal(api.calls.filter(([n]) => n === 'context').every(([, r]) => r === 'member:u1'), true, 'the same person throughout');
    assert.equal(api.count('context'), 1, 'Try again re-reads the shares, not the person');
  } finally { await page.close(); }
});

test('Sharing: a real empty shares read is "Address not shared yet", not unreadable', async () => {
  const api = fakeApi({ shares: () => Promise.resolve({ items: [] }) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=member%3Au1');
  try {
    assert.equal(page.by('sharing-unreadable'), undefined);
    assert.equal(page.textOf(page.by('thread-address')), 'Address not shared yet');
    assert.equal(page.by('write-with-eadwyn'), undefined);
  } finally { await page.close(); }
});

test('Record Sheet: a failed read offers Try again, which reads the same person again', async () => {
  let fail = true;
  const asked = [];
  const api = {
    accounts: async () => ({ accounts: [ACCOUNT] }),
    shares: async () => { if (fail) throw new Error('down'); return { items: [READY] }; },
    context: async (r) => { asked.push(r); return { person: { ref: 'member:u1', kind: 'member', name: 'Sam Match' }, items: [] }; },
  };
  const page = await mounted(h(RecordEmailSheet, { person: 'member:u1', label: 'Sam', onClose() {}, api }), '/network/relationships');
  try {
    assert.match(page.text(), new RegExp(UNREADABLE.slice(0, 40)));
    fail = false;
    await page.press(page.by('record-email-retry'));
    assert.equal(page.by('record-email-retry'), undefined);
    assert.deepEqual([...new Set(asked)], ['member:u1']);
  } finally { await page.close(); }
});

// ── Finding 9: Stop sharing, waiting and ready ──────────────────────────────

test('Stop sharing while waiting: cancel writes nothing; confirm revokes once and the card says so', async () => {
  const api = fakeApi({ shares: () => Promise.resolve({ items: [api.count('unshare') ? { ...WAITING, mine: 'revoked' } : WAITING] }) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=member%3Au1');
  try {
    assert.equal(page.state('network-card'), 'waiting');
    await page.press(page.by('sharing-stop'));
    assert.ok(page.by('unshare-confirm'), 'a confirmation first');
    assert.equal(api.count('unshare'), 0);
    await page.press(page.by('unshare-cancel'));
    assert.equal(page.by('unshare-confirm'), undefined);
    assert.equal(api.count('unshare'), 0, 'cancel makes no write');
    await page.press(page.by('sharing-stop'));
    await page.press(page.by('unshare-stop'));
    assert.deepEqual(api.calls.filter(([n]) => n === 'unshare'), [['unshare', 'u1']], 'the existing revoke, once');
    assert.equal(page.by('unshare-confirm'), undefined);
    assert.match(page.textOf(page.by('sharing-result')), /You stopped sharing your address with Sam Match/);
    assert.equal(page.state('network-card'), 'matched', 'the card shows the pair as it now is');
    assert.equal(page.by('sharing-stop'), undefined);
  } finally { await page.close(); }
});

test('Stop sharing once both shared: a failed revoke claims nothing; a retried confirm stops it and closes Email', async () => {
  let fail = true;
  let listed = 0;
  const api = fakeApi({
    shares: () => { listed += 1; return Promise.resolve({ items: listed === 1 || fail ? [READY] : [{ ...READY, mine: 'revoked', ready: false, address: null }] }); },
    unshare: (uid) => (fail ? Promise.reject(new Error('the server is down')) : Promise.resolve({ share: { ...READY, uid, mine: 'revoked', ready: false, address: null, line: 'You’re matched.' } })),
  });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=member%3Au1');
  try {
    assert.equal(page.state('network-card'), 'ready');
    assert.equal(page.textOf(page.by('thread-address')), 'sam@example.test');
    assert.ok(page.by('write-with-eadwyn'));
    await page.press(page.by('sharing-stop'));
    await page.press(page.by('unshare-stop'));
    assert.equal(api.count('unshare'), 1);
    assert.match(page.textOf(page.by('unshare-error')), /Sharing did not stop: the server is down\. Nothing changed\./);
    assert.equal(page.by('sharing-result'), undefined, 'a failed revoke never says sharing stopped');
    assert.ok(page.by('unshare-confirm'), 'the confirmation stays open to try again');
    assert.equal(page.state('network-card'), 'ready');
    assert.equal(page.textOf(page.by('thread-address')), 'sam@example.test');
    fail = false;
    await page.press(page.by('unshare-stop'));
    assert.equal(api.count('unshare'), 2, 'one call per confirm');
    assert.ok(page.by('sharing-result'));
    assert.equal(page.state('network-card'), 'matched');
    assert.equal(page.textOf(page.by('thread-address')), 'Address not shared yet', 'the address is gone');
    assert.equal(page.by('write-with-eadwyn'), undefined, 'Email closes with it');
  } finally { await page.close(); }
});

test('Stop sharing: a second press while the revoke is pending does not revoke twice', async () => {
  let release;
  const api = fakeApi({ shares: () => Promise.resolve({ items: [READY] }), unshare: (uid) => new Promise((r) => { release = () => r({ share: { ...READY, uid, mine: 'revoked', ready: false, address: null } }); }) });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=member%3Au1');
  try {
    await page.press(page.by('sharing-stop'));
    const stop = page.by('unshare-stop');
    await act(async () => { page.props(stop).onClick(); page.props(stop).onClick(); });
    assert.equal(api.count('unshare'), 1);
    assert.equal(page.disabled(page.by('unshare-stop')), true, 'pressed once, it waits');
    await act(async () => { release(); });
    await act(flush);
    assert.ok(page.by('sharing-result'));
  } finally { await page.close(); }
});

// ── The pure rules ──────────────────────────────────────────────────────────

test('peoplePane and shareStatus: only an answered read decides anything', () => {
  assert.equal(peoplePane({ people: { status: 'reading', data: null } }).none, false, 'reading is not empty');
  assert.equal(peoplePane({ people: { status: 'unreadable', data: null } }).none, false, 'unreadable is not empty');
  assert.equal(peoplePane({ people: { status: 'ready', data: { groups: [group('network', 'Network matches', [])] } } }).none, true);
  assert.equal(peoplePane({ people: { status: 'ready', data: { groups: [group('network', 'Network matches', [], { error: 'x' })] } } }).none, false, 'a failed group is not empty');
  assert.equal(peoplePane({ drafts: [{ person: 'prospect:1', sources: [] }], people: { status: 'ready', data: { groups: [] } } }).none, false, 'drafts are people');
  assert.deepEqual(shareStatus({ status: 'unreadable', items: [READY] }, 'member:u1'), { known: false, state: 'unreadable', share: null }, 'a failed read hides even known items');
  assert.equal(shareStatus({ status: 'reading', items: [] }, 'member:u1').state, 'reading');
  assert.equal(shareStatus({ status: 'ready', items: [] }, 'member:u1').state, 'none');
  assert.equal(shareStatus({ status: 'ready', items: [READY] }, 'member:u1').state, 'ready');
  assert.equal(shareStatus({ status: 'ready', items: [WAITING] }, 'member:u1').state, 'waiting');
  assert.equal(shareStatus({ status: 'ready', items: [{ ...WAITING, mine: 'pending' }] }, 'member:u1').state, 'matched');
});
