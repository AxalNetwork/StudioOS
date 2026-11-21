/**
 * #4831 (D4831 part 2) — the Practice Client Sheet (board PX-04).
 *
 *   · seven tabs in canvas order; one client is one ACCOUNT, and every source is joined by its id, never by name;
 *   · Overview: active engagement, next session, last delivery to THIS client, recorded outstanding, recent activity;
 *   · Access: the records this client opened to the advisor, and only the log rows on those records;
 *   · Notes: "Private to you", saved through the advisor's own note route;
 *   · each failed source says so in its own place, and the rest stand.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/client_sheet_4831.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import {
  CLIENT_TABS, activeEngagement, clientAccess, deliveryLine, grantScope, lastDelivery, mine, nextSession,
  outstanding, outstandingLine, recentActivity, relationshipLine,
} from '../src/pages/advisor/practice/clientSheetModel.js';
import { api } from '../src/lib/api.js';
import ClientSheet from '../src/pages/advisor/practice/ClientSheet.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CANVAS = read('design/incoming/Practice v2 Page.dc.html');
const money = (c) => `$${(c / 100).toLocaleString('en-US')}`;
const NOW = Date.parse('2026-11-14T12:00:00Z');
const ID = 41;

const ENGAGEMENTS = [
  { id: 1, founder_user_id: ID, client_name: 'Synthetic Co', lane: 'signed', shape: 'retainer', amount_cents: 300000, scope_label: 'Growth retainer', started_at: '2026-08-01', term_ends_at: '2026-12-01' },
  { id: 2, founder_user_id: ID, client_name: 'Synthetic Co', lane: 'renewal_due', shape: 'sprint', amount_cents: 600000, scope_label: 'Pricing sprint', started_at: '2026-09-01', term_ends_at: '2026-11-20' },
  { id: 3, founder_user_id: 99, client_name: 'Synthetic Co', lane: 'signed', shape: 'retainer', scope_label: 'Same name, other account' },
];
const BOOKINGS = [
  { id: 1, client_user_id: ID, status: 'completed', topic: 'Strategy review', slot_starts_at: '2026-11-03T14:00:00Z', billing_state: 'billed', amount_cents: 25000 },
  { id: 2, client_user_id: ID, status: 'confirmed', topic: 'Pricing', slot_starts_at: '2026-11-20T14:00:00Z', billing_state: 'billed', amount_cents: 50000 },
  { id: 3, client_user_id: ID, status: 'confirmed', topic: 'Earlier upcoming', slot_starts_at: '2026-11-18T09:00:00Z', billing_state: 'billed', amount_cents: null },
  { id: 4, client_user_id: ID, status: 'cancelled', topic: 'Cancelled', slot_starts_at: '2026-11-16T09:00:00Z', billing_state: 'collected', amount_cents: 9900 },
  { id: 5, client_user_id: ID, status: 'confirmed', topic: 'Past one', slot_starts_at: '2026-11-01T09:00:00Z', billing_state: 'collected', amount_cents: 1 },
  { id: 6, client_user_id: 99, status: 'confirmed', topic: 'Other account', slot_starts_at: '2026-11-15T09:00:00Z', billing_state: 'billed', amount_cents: 77700 },
];
const DELIVERABLES = [
  { id: 10, client_user_id: ID, title: 'Q4 memo', version_count: 3, versions: [
    { version: 3, sent_at: '2026-11-06T10:00:00Z', signed_off_at: '2026-11-07T10:00:00Z', recipient_user_id: ID },
    { version: 2, sent_at: '2026-10-20T10:00:00Z', recipient_user_id: ID },
  ] },
  { id: 11, client_user_id: ID, title: 'Relinked work', version_count: 1, versions: [
    { version: 1, sent_at: '2026-11-10T10:00:00Z', recipient_user_id: 52 },
  ] },
  { id: 12, client_user_id: 99, title: 'Other account work', version_count: 1, versions: [] },
];
const GRANTS = [
  { grant_uid: 'g1', project_uid: 'p1', project_name: 'Synthetic Co', granted_by_user_id: ID, scope_project: true, scope_data_room: true, scope_sessions: false, expires_at: null },
  { grant_uid: 'g2', project_uid: 'p2', project_name: 'Synthetic Co', granted_by_user_id: 99, scope_project: true, scope_data_room: false, scope_sessions: false, expires_at: null },
];
const LOG = [
  { action: 'open_brief', created_at: '2026-11-02T10:00:00Z', project_uid: 'p1', client: 'Synthetic Co', advisor_name: 'Me' },
  { action: 'open_brief', created_at: '2026-11-03T10:00:00Z', project_uid: 'p2', client: 'Synthetic Co', advisor_name: 'Me' },
];

// Mutation checked: joining by `client_name` (the other account's rows come in, fails); a failed read as [] (fails).
test('#4831 PX-04: seven tabs in canvas order, and one client is one account', () => {
  const tabs = /clientSheet = \(\) => sheet\([\s\S]*?\['Overview'[^\]]*\]/.exec(CANVAS);
  assert.ok(tabs, 'the PX-04 sheet is on the canvas');
  assert.deepEqual([...tabs[0].slice(tabs[0].lastIndexOf('[')).matchAll(/'([^']+)'/g)].map((m) => m[1]), CLIENT_TABS);
  assert.deepEqual(mine(ENGAGEMENTS, ID, 'founder_user_id').map((e) => e.id), [1, 2], 'the same name on another account is not this client');
  assert.equal(mine(null, ID, 'founder_user_id'), null, 'an unread source stays unread');
  assert.deepEqual(mine(BOOKINGS, null, 'client_user_id'), [], 'no account, no rows');
});

// Mutation checked: renewal-due not preferred (fails); a past or cancelled session as next (fails); a version sent to
// another account as this client's delivery (fails); an unpriced billed session added as $0 silently (fails).
test('#4831 PX-04 Overview: what is under contract, what is next, what was delivered, what is owed', () => {
  const engs = mine(ENGAGEMENTS, ID, 'founder_user_id');
  const books = mine(BOOKINGS, ID, 'client_user_id');
  const work = mine(DELIVERABLES, ID, 'client_user_id');
  assert.equal(activeEngagement(engs).id, 2, 'the term up for a decision leads');
  assert.equal(activeEngagement([]), null);
  assert.equal(relationshipLine(engs, books), 'Active client · since Aug 2026');
  assert.equal(relationshipLine([{ lane: 'ended', started_at: '2025-03-01' }], []), 'Former client · since Mar 2025');
  assert.equal(relationshipLine([], [books[0]]), 'Client · since Nov 2026');
  assert.equal(relationshipLine(null, null), 'Relationship could not be read');
  assert.equal(nextSession(books, NOW).id, 3, 'the earliest live session after now');
  assert.equal(nextSession([books[3], books[4]], NOW), null);
  const last = lastDelivery(work, ID);
  assert.equal(deliveryLine(last), 'Q4 memo v3 · accepted 7 Nov 2026');
  assert.equal(lastDelivery([DELIVERABLES[1]], ID), null, 'work sent to another account is not this client’s');
  assert.deepEqual(outstanding(books), { count: 3, cents: 75000, unpriced: 1 });
  assert.equal(outstandingLine(outstanding(books), money), '$750 · 3 sessions billed · 1 without an amount');
  assert.equal(outstandingLine(outstanding([]), money), 'Nothing billed and uncollected');
  assert.equal(outstanding(null), null);
  assert.deepEqual(recentActivity(books, work, ID).map((r) => r.text), ['Q4 memo v3 accepted', 'Q4 memo v3 sent', 'Session completed · Strategy review']);
});

// Mutation checked: grants joined by project name (the other account's log row comes in, fails); a failed log read
// as no opens (fails).
test('#4831 PX-04 Access: the records this client opened, and only the opens on them', () => {
  const a = clientAccess(GRANTS, LOG, ID);
  assert.deepEqual(a.grants.map((g) => g.grant_uid), ['g1']);
  assert.deepEqual(a.log.map((r) => r.project_uid), ['p1']);
  assert.equal(clientAccess(null, LOG, ID), null);
  assert.equal(clientAccess(GRANTS, null, ID).log, null);
  assert.equal(grantScope(GRANTS[0]), 'the company record, the data room');
  assert.equal(grantScope({}), 'Scope not recorded');
  const worker = read('cloudflare-worker/src/routes/advisor_grants.ts');
  assert.match(worker, /granted_by_user_id: r\.granted_by_user_id \?\? null,/);
});

const stub = (over = {}) => {
  const real = {};
  const set = {
    listMyAdvisorEngagements: async () => ({ items: ENGAGEMENTS, page: { next_offset: null } }),
    listMyAdvisorBookings: async () => ({ items: BOOKINGS, page: { next_offset: null } }),
    listMyAdvisorDeliverables: async () => ({ items: DELIVERABLES, page: { next_offset: null } }),
    advisorClientsSharedWithMe: async () => ({ items: GRANTS }),
    listMyAdvisorAccessLog: async () => ({ items: LOG }),
    advisorClientNote: async () => ({ note: { body: 'Send drafts by Tuesday.' } }),
    ...over,
  };
  for (const [k, fn] of Object.entries(set)) { real[k] = api[k]; api[k] = fn; }
  return () => { for (const [k, fn] of Object.entries(real)) api[k] = fn; };
};
const button = (s, label) => s.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);

test('#4831 PX-04 mounted: the overview, the tabs, and a private note saved through the advisor’s own route', async () => {
  const saved = [];
  const restore = stub({ saveAdvisorClientNote: async (id, body) => { saved.push([id, body]); return { note: { body: body.body } }; } });
  const s = await mountForm(h(ClientSheet, { clientUserId: ID, clientName: 'Synthetic Co', now: NOW, onClose() {} }), { modal: true });
  try {
    await s.flush();
    const t = s.text();
    assert.match(t, /Active client · since Aug 2026/);
    assert.match(t, /Active engagement\s*Pricing sprint · renewal due/);
    assert.match(t, /Next session\s*18 Nov 2026 · Earlier upcoming/);
    assert.match(t, /Last delivery\s*Q4 memo v3 · accepted 7 Nov 2026/);
    assert.match(t, /Recorded outstanding\s*\$750 · 3 sessions billed · 1 without an amount/);
    assert.equal(s.nodes().filter((n) => propsOf(n).role === 'tab').length, 7);

    await s.click('Engagements');
    assert.match(s.text(), /Pricing sprint/);
    assert.doesNotMatch(s.text(), /Same name, other account/);
    await s.click('Agreements');
    assert.match(s.text(), /No agreement is linked to this client/);
    await s.click('Access');
    assert.match(s.text(), /the company record, the data room · no end date/);
    await s.click('Notes');
    await s.flush();
    assert.match(s.text(), /Private to you/);
    assert.match(s.text(), /Synthetic Co never sees this note\./);
    const area = s.nodes().find((n) => n.tagName === 'TEXTAREA');
    assert.equal(propsOf(area).value, 'Send drafts by Tuesday.');
    assert.ok(propsOf(button(s, 'Save note')).disabled, 'nothing to save until the note changes');
    await s.flush();
    await (async () => { const { act } = await import('react'); await act(async () => propsOf(area).onChange({ target: { value: 'Send drafts by Monday.' } })); })();
    await s.click('Save note');
    assert.deepEqual(saved, [[ID, { body: 'Send drafts by Monday.' }]]);
    assert.match(s.text(), /Note saved\./);
  } finally {
    await s.unmount();
    restore();
  }
});

test('#4831 PX-04 mounted: each failed source says so in its own place, and the others stand', async () => {
  const fail = async () => { throw new Error('boom'); };
  const restore = stub({
    listMyAdvisorBookings: fail, advisorClientsSharedWithMe: fail,
    advisorClientNote: async () => { throw Object.assign(new Error('This client is not in your booking roster'), { status: 403 }); },
  });
  const s = await mountForm(h(ClientSheet, { clientUserId: ID, clientName: 'Synthetic Co', now: NOW, onClose() {} }), { modal: true });
  try {
    await s.flush();
    const t = s.text();
    assert.match(t, /Next session\s*Could not be read/);
    assert.match(t, /Recorded outstanding\s*Could not be read/);
    assert.match(t, /Active engagement\s*Pricing sprint · renewal due/, 'the engagements still stand');
    await s.click('Sessions');
    assert.match(s.text(), /Your sessions could not be read/);
    await s.click('Access');
    assert.match(s.text(), /What this client shared with you could not be read/);
    await s.click('Notes');
    await s.flush();
    assert.match(s.text(), /A note opens once this client has booked you\./);
  } finally {
    await s.unmount();
    restore();
  }
});

test('#4831 PX-04: Engagements opens the sheet only for a linked account', () => {
  const zone = read('frontend/src/pages/advisor/practice/EngagementsZone.jsx');
  assert.match(zone, /const openClient = \(e\) => \{ if \(e\?\.founder_user_id\) \{/);
  assert.match(zone, /<ClientSheet key=\{client\?\.id\} clientUserId=\{client\?\.id\} clientName=\{client\?\.name\}/);
  assert.match(zone, /\{e\.founder_user_id && onOpenClient\s*\n\s*\? <button/);
  const sheet = read('frontend/src/pages/advisor/practice/EngagementSheet.jsx');
  assert.match(sheet, /e\.founder_user_id && onOpenClient/);
});
