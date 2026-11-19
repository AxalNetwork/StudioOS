/**
 * D6052 (#6052) — Invite to Axal on the Call for Capital's audience step (CLS5), mounted on stubbed
 * `roundCallsApi` and `prospectInvitesApi`.
 *
 *  1. The owner invites a prospect with an address: the row says Invited and its date, and the
 *     investor stays unchoosable; the audience saved carries no invited prospect.
 *  2. A prospect with no address takes one typed in the form; a send that did not leave, or a refusal,
 *     keeps the form and says so.
 *  3. A viewer who cannot invite sees every Invite to Axal disabled with the Worker's reason.
 *  4. Joined and Invited read from the Worker; a failed read says Unreadable and retries.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/call_invite_6052.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import { prospectInvitesApi } from '../src/lib/api/prospectInvites.js';
import RoundCallSheet, { inviteRow, invitedLocally, INVITE_NOT_SENT, INVITE_NOTE } from '../src/pages/founder/RoundCallSheet.jsx';

const h = React.createElement;
const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const REASON = 'Only the venture’s founder can invite an investor to Axal.';
const CONTEXT = {
  project: { id: 7, name: 'Acme' }, round: { name: 'Seed', target_amount: 1500000, close_date: '2099-01-15' }, scenario: null, term_seeds: {},
  decks: [{ id: 4, version: 7, title: 'Acme deck', is_current: 1 }], chosen: [{ prospect_id: 1, name: 'Bluefern Capital', email: 'b@example.test' }], data_room: null,
};
const CALL = { uid: 'd1', project_id: 7, name: 'Seed', state: 'draft', instrument: 'safe', amount_cents: 150000000, minimum_cheque_cents: 2500000,
  terms: 'Plain words', target_close: '2099-01-15', deck_id: 4, deck_version: 7, data_room_project_uid: null, valuation_cap_cents: 1000000000,
  discount_bps: null, pre_money_cents: null, revision: 1, terms_hash: 'h' };
const PREVIEW = { matched: 0, reason: null, not_on_axal: [
  { prospect_id: 11, name: 'Nora Ventures', chosen: false }, { prospect_id: 12, name: 'Ola Partners', chosen: false },
  { prospect_id: 13, name: 'Pip Fund', chosen: false }, { prospect_id: 14, name: 'Quill Capital', chosen: false }] };
const STATES = { can_invite: true, reason: null, gap_hours: 24, items: [
  { prospect_id: 11, has_email: true, invited_at: null, joined_at: null }, { prospect_id: 12, has_email: false, invited_at: null, joined_at: null },
  { prospect_id: 13, has_email: true, invited_at: '2026-11-14T09:00:00.000Z', joined_at: null },
  { prospect_id: 14, has_email: true, invited_at: '2026-11-10T09:00:00.000Z', joined_at: '2026-11-12T10:00:00.000Z' }] };
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

function stub(api, answers, calls) {
  const saved = { ...api };
  for (const key of Object.keys(saved)) {
    const answer = Object.hasOwn(answers, key) ? answers[key] : {};
    const queue = Array.isArray(answer) ? [...answer] : null;
    api[key] = async (...args) => {
      calls.push([key, ...args]);
      const next = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : answer;
      const value = typeof next === 'function' ? next(...args) : next;
      if (value instanceof Error) throw value;
      return value;
    };
  }
  return () => Object.assign(api, saved);
}

/** The sheet opened on a draft, moved on to the audience step. */
async function audience(t, invites) {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  t.after(() => mock.timers.reset());
  const calls = [];
  const restoreCalls = stub(roundCallsApi, { availability: { enabled: true }, context: CONTEXT, page: { viewer: 'founder', call: CALL, recipients: [], readiness: [], counsel_approved: false },
    previewAudience: PREVIEW, audience: { ok: true } }, calls);
  const restoreInvites = stub(prospectInvitesApi, invites, calls);
  const view = await mountContracts(h(RoundCallSheet, { projectId: 7, onClose: () => {}, initialCall: { uid: 'd1' } }), '/raise/call');
  const settle = async () => { for (let i = 0; i < 6; i++) await view.flush(); };
  t.after(async () => { await view.unmount(); restoreCalls(); restoreInvites(); });
  await settle();
  await view.click('Next');
  await settle();
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const row = (name) => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'call-not-on-axal' && textOf(n).includes(name));
  const button = (name, label) => walk(row(name)).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    calls, view, settle,
    text: () => view.text(),
    rowText: (name) => textOf(row(name)),
    inviteDisabled: (name) => view.props(button(name, 'Invite to Axal'))?.disabled === true,
    async invite(name) { const b = button(name, 'Invite to Axal'); assert.ok(b, `no Invite to Axal on ${name}`); view.props(b).onClick(); await settle(); },
    async press(label) { await view.click(label); await settle(); },
    sendDisabled: () => view.props(view.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Send invitation'))?.disabled === true,
    async type(value) { const n = view.nodes().find((x) => view.props(x)?.id === 'call-invite-email'); assert.ok(n, 'no email field'); view.props(n).onChange({ target: { value } }); await settle(); },
    chooseDisabled: (name) => view.props(view.nodes().find((n) => view.props(n)?.['aria-label'] === name + ' is not on Axal'))?.disabled === true,
  };
}

test('1. the owner invites a prospect with an address: Invited and its date, still not choosable, and not in the audience saved', async (t) => {
  // Mutations checked: the button never enabled; the row not marked Invited after a send; the date not shown;
  // an invited prospect made choosable.
  const s = await audience(t, { states: STATES, send: { email_sent: true, invite: { uid: 'i1', prospect_id: 11, invited_at: '2026-11-16T15:00:00.000Z', email_sent: true } } });
  assert.match(s.text(), /From your pipeline/);
  assert.equal(s.inviteDisabled('Nora Ventures'), false, 'the owner can invite');
  assert.ok(s.text().includes(INVITE_NOTE), 'shows the INVITE_NOTE sentence');
  await s.invite('Nora Ventures');
  assert.match(s.text(), /Axal emails Nora Ventures at the address in your pipeline\./);
  await s.press('Send invitation');
  assert.deepEqual(s.calls.filter((c) => c[1] && c[0] === 'send').map((c) => c[1]), [{ projectId: 7, prospectId: 11, email: '' }]);
  assert.match(s.rowText('Nora Ventures'), /Invited · 16 Nov/);
  assert.doesNotMatch(s.rowText('Nora Ventures'), /Invite to Axal/, 'the button gives way to Invited');
  assert.equal(s.chooseDisabled('Nora Ventures'), true, 'an invited investor is not choosable until verified');
  const box = s.view.nodes().find((n) => s.view.props(n)?.['aria-label'] === 'Choose Bluefern Capital');
  s.view.props(box).onChange();
  await s.settle();
  await s.press('Next');
  assert.deepEqual(s.calls.filter((c) => c[0] === 'audience').map((c) => c[2].chosen_prospect_ids), [[1]], 'only the verified investor chosen is saved; the invited one is not');
});

test('2. an address typed for a prospect without one; a send that did not leave, or a refusal, keeps the form and says so', async (t) => {
  // Mutations checked: Send enabled with no address; the typed address not sent; a failed send read as sent;
  // the refusal's sentence dropped.
  const s = await audience(t, { states: STATES, send: [{ email_sent: false, email_error: 'provider', invite: { invited_at: null, email_sent: false } },
    refusal(409, 'prospect_email_differs', 'The pipeline holds another address for this investor. Change it there first.'),
    { email_sent: true, invite: { invited_at: '2026-11-16T15:00:00.000Z', email_sent: true } }] });
  await s.invite('Ola Partners');
  assert.match(s.text(), /Email for Ola Partners/);
  assert.equal(s.sendDisabled(), true, 'no address, no send');
  await s.type(' ola@example.test ');
  assert.equal(s.sendDisabled(), false);
  await s.press('Send invitation');
  assert.ok(s.text().includes(INVITE_NOT_SENT), 'shows the INVITE_NOT_SENT sentence');
  assert.doesNotMatch(s.rowText('Ola Partners'), /Invited/, 'a send that did not leave is not Invited');
  await s.press('Send invitation');
  assert.match(s.text(), /The pipeline holds another address for this investor\. Change it there first\./);
  await s.press('Send invitation');
  assert.match(s.rowText('Ola Partners'), /Invited · 16 Nov/);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'send').map((c) => c[1].email), ['ola@example.test', 'ola@example.test', 'ola@example.test']);
});

test('3. a viewer who cannot invite sees every Invite to Axal disabled, with the Worker’s reason', async (t) => {
  // Mutations checked: can_invite ignored; the reason not shown.
  const s = await audience(t, { states: { ...STATES, can_invite: false, reason: REASON } });
  for (const name of ['Nora Ventures', 'Ola Partners']) assert.equal(s.inviteDisabled(name), true, name);
  assert.match(s.text(), new RegExp('Invite to Axal: ' + REASON));
  assert.match(s.rowText('Pip Fund'), /Invited · 14 Nov/, 'a recorded invitation still shows');
});

test('4. Joined and Invited come from the Worker; a failed read says Unreadable and retries', async (t) => {
  // Mutations checked: joined read as Invited; a failed read leaving the button enabled; Try again not re-reading.
  const s = await audience(t, { states: [refusal(503, 'capital_unreadable', 'x'), STATES] });
  assert.match(s.text(), /Invitations are unreadable/);
  assert.equal(s.inviteDisabled('Nora Ventures'), true, 'no invite while the read failed');
  await s.press('Try again');
  assert.equal(s.calls.filter((c) => c[0] === 'states').length, 2);
  assert.match(s.rowText('Quill Capital'), /Joined · not verified yet/);
  assert.match(s.rowText('Pip Fund'), /Invited · 14 Nov/);
  assert.equal(s.inviteDisabled('Nora Ventures'), false);
});

test('inviteRow and invitedLocally', () => {
  assert.equal(inviteRow(null, 1).kind, 'loading');
  assert.equal(inviteRow({ error: new Error('x') }, 1).kind, 'unreadable');
  const data = { can_invite: true, items: [{ prospect_id: 1, has_email: false, invited_at: null, joined_at: null }] };
  assert.deepEqual(inviteRow({ data }, 1), { kind: 'open', reason: null, hasEmail: false });
  assert.deepEqual(inviteRow({ data: { ...data, can_invite: false, reason: REASON } }, 1), { kind: 'refused', reason: REASON, hasEmail: false });
  const after = invitedLocally(data, 1, '2026-11-16T15:00:00.000Z');
  assert.deepEqual(after.items, [{ prospect_id: 1, has_email: true, invited_at: '2026-11-16T15:00:00.000Z', joined_at: null }]);
  assert.equal(inviteRow({ data: after }, 1).kind, 'invited');
  assert.equal(invitedLocally(data, 2, 'x').items.length, 2, 'a prospect the read did not list is added');
});
