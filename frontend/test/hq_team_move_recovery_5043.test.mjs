/**
 * D5043 (#5043) — HQ Team can finish a move whose destination invitation did not land.
 *
 *   - a partial move keeps its result on screen: source and destination, the records note and
 *     Retry invitation, and never the Move control again for that account;
 *   - Retry invitation sends the operation id and nothing else;
 *   - after a retry, "invitation created", "email sent" and "email not sent" are separate lines,
 *     with the manual next step (and the link) when the mail did not leave, and nothing claims the
 *     person was contacted;
 *   - a refresh finds the move again, from HQ's record (`GET /api/admin/account-moves`), and a
 *     failed read of that record says so.
 *
 * The components are mounted over stubbed clients; no network. Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_move_recovery_5043.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountForm } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import { hqAccountMovesApi } from '../src/lib/api/hqAccountMoves.js';
import OpenAccountMoves, { MoveOutcome } from '../src/pages/hq/AccountMoveRecovery.jsx';
import { MoveHit } from '../src/pages/hq/HqTeamTable.jsx';
import { applyRetryError, invitationLines, moveView } from '../src/pages/hq/accountMoveModel.js';

const h = React.createElement;
const UID = 'mvop_0123456789abcdef0123';

const item = (over = {}) => ({
  uid: UID, from: 'fr', to: 'dach', branch_user_id: 51,
  target: { name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder' },
  status: 'invite_failed', state: 'invitation_failed', moved_out: true, attempts: 1,
  last_error_code: 'destination_unreachable',
  last_error: 'The account was closed on fr and the invitation on dach did not land: the branch could not be reached.',
  invitation: null, updated_at: '2026-11-09 12:00:00',
  records_note: 'Projects, deals and documents stay with fr and are readable by HQ. This is a re-invite, not a record migration.',
  ...over,
});
const landed = (invited) => ({
  operation: item({ status: 'invited', state: invited.email_sent ? 'invitation_sent' : 'invitation_not_sent', last_error_code: null, last_error: null,
    invitation: { uid: 'inv_1', stored: true, email_sent: invited.email_sent, email_reason: invited.reason || null } }),
  retried: true,
  invited: { ok: true, stored: true, uid: 'inv_1', ...invited },
});
const buttons = (page) => page.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent?.trim() || '').concat(
  page.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => (n.childNodes || []).map((c) => c.textContent || '').join('').trim()),
);
// A claim that the person WAS reached. "nobody has been told" is the honest opposite, and allowed.
const NEVER_TOLD = /\b(?:was|were) (?:contacted|told|notified)\b|(?<!nobody )\bha(?:s|ve) been (?:contacted|told|notified)\b/i;

/* ------------------------------------------------------------------ *
 * The model                                                           *
 * ------------------------------------------------------------------ */

test('stored, sent and not sent are three lines, and none claims the person was contacted', () => {
  const view = moveView(item());
  assert.deepEqual(invitationLines(view).map((l) => l.state), ['not_created']);

  const sent = moveView(landed({ email_sent: true }).operation);
  assert.deepEqual(invitationLines(sent).map((l) => l.state), ['created', 'sent']);

  const notSent = { ...moveView(item()), invitation: { stored: true, email_sent: false, reason: 'This branch has no mail sender configured.', link: 'https://dach.axal.vc/join/invt_abc' } };
  const lines = invitationLines(notSent);
  assert.deepEqual(lines.map((l) => l.state), ['created', 'not_sent', 'manual']);
  assert.equal(lines[2].link, 'https://dach.axal.vc/join/invt_abc');
  assert.match(lines[2].text, /pass this invitation link to remy@fr\.example yourself/);

  const unreported = { ...moveView(item()), invitation: { stored: true, email_sent: null } };
  assert.deepEqual(invitationLines(unreported).map((l) => l.state), ['created', 'not_reported', 'manual']);

  for (const v of [sent, notSent, unreported]) {
    for (const l of invitationLines(v)) assert.doesNotMatch(l.text, NEVER_TOLD, l.text);
  }
});

test('a move answer and an open-moves item read the same; a retry that got no answer is unknown, not refused', () => {
  const fromMove = moveView({
    from: 'fr', to: 'dach', moved_out: true, target: item().target,
    invited: { ok: false, code: 'destination_unreachable', reason: 'did not land' },
    operation: { uid: UID, recoverable: true }, records_note: item().records_note,
  });
  const fromList = moveView(item());
  for (const k of ['uid', 'from', 'to', 'who', 'email', 'recoverable', 'invitation', 'recordsNote']) {
    assert.deepEqual(fromMove[k], fromList[k], k);
  }
  const unknown = applyRetryError(fromList, new TypeError('Failed to fetch'));
  assert.equal(unknown.unknown, true);
  assert.match(unknown.failure.message, /not known/);
});

/* ------------------------------------------------------------------ *
 * The list a refresh reads                                            *
 * ------------------------------------------------------------------ */

test('a refresh finds the partial move: both branches, the records note, Retry invitation, and no Move', async () => {
  hqAccountMovesApi.open = async () => ({ items: [item()] });
  const page = await mountForm(h(OpenAccountMoves, {}));
  await page.flush();
  const text = page.text();
  assert.match(text, /Moves to finish/);
  assert.match(text, /Remy Blanc: fr → dach/);
  assert.match(text, /Closed on fr/);
  assert.match(text, /stay with fr/);
  assert.match(text, /did not land/);
  assert.ok(page.by('hq-team-move-retry'), 'Retry invitation is not offered');
  assert.ok(!buttons(page).some((b) => /^Move/.test(b)), 'the normal Move control is drawn for a move that already closed the account');
  await page.unmount();
});

test('Retry invitation sends the operation id alone, then says created and not sent apart, with the link', async () => {
  hqAccountMovesApi.open = async () => ({ items: [item()] });
  const calls = [];
  hqAccountMovesApi.retryInvitation = async (...args) => {
    calls.push(args);
    return landed({ email_sent: false, reason: 'This branch has no mail sender configured, so the invitation exists and nobody has been told about it.', invite_link: 'https://dach.axal.vc/join/invt_abc' });
  };
  const page = await mountForm(h(OpenAccountMoves, {}));
  await page.flush();
  await page.click('Retry invitation');
  await page.flush();
  assert.deepEqual(calls, [[UID]], 'the retry sent more than the operation id');
  const text = page.text();
  assert.match(text, /Invitation created on dach/);
  assert.match(text, /Email not sent/);
  assert.match(text, /pass this invitation link/);
  assert.ok(page.by('hq-team-move-link'), 'the link the destination handed over is not shown');
  assert.match(text, /https:\/\/dach\.axal\.vc\/join\/invt_abc/);
  assert.doesNotMatch(text, NEVER_TOLD);
  assert.ok(!page.by('hq-team-move-retry'), 'Retry invitation is still offered after the invitation landed');
  await page.unmount();
});

test('a refused retry keeps the card, says the destination\'s reason and leaves Retry invitation', async () => {
  hqAccountMovesApi.open = async () => ({ items: [item()] });
  hqAccountMovesApi.retryInvitation = async () => {
    const e = new Error('dach already has an active account for this person, so no invitation was created.');
    e.status = 409;
    e.code = 'destination_active';
    e.data = { error: 'destination_active', message: e.message, operation: item({ last_error_code: 'destination_active', last_error: e.message }) };
    throw e;
  };
  const page = await mountForm(h(OpenAccountMoves, {}));
  await page.flush();
  await page.click('Retry invitation');
  await page.flush();
  assert.equal(page.props(page.by('hq-team-move-failure'))['data-code'], 'destination_active');
  assert.match(page.text(), /already has an active account/);
  assert.doesNotMatch(page.text(), /Invitation created/);
  assert.ok(page.by('hq-team-move-retry'));
  await page.unmount();
});

test('an unreadable moves record says so with a retry, never "nothing to finish"; an empty one draws nothing', async () => {
  hqAccountMovesApi.open = async () => { const e = new Error('Request failed'); e.status = 500; throw e; };
  const page = await mountForm(h(OpenAccountMoves, {}));
  await page.flush();
  assert.ok(page.by('hq-team-moves-unreadable'));
  assert.match(page.text(), /not a claim that there are none/);
  await page.unmount();

  hqAccountMovesApi.open = async () => ({ items: [] });
  const empty = await mountForm(h(OpenAccountMoves, {}));
  await empty.flush();
  assert.equal(empty.text().trim(), '');
  await empty.unmount();
});

/* ------------------------------------------------------------------ *
 * The branch hit, right after the move                                *
 * ------------------------------------------------------------------ */

test('after a partial move the hit keeps the result with Retry invitation, and Move is gone', async () => {
  api.hqMoveAccount = async () => ({
    from: 'fr', to: 'dach', moved_out: true,
    target: { id: 51, name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder' },
    invited: { ok: false, code: 'destination_unreachable', reason: 'The account was closed on fr and the invitation on dach did not land: the branch could not be reached. Retry the invitation alone — moving them out again would be refused, correctly.' },
    operation: { uid: UID, recoverable: true },
    records_note: item().records_note,
  });
  const hit = { id: 51, name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder', is_active: 1 };
  const page = await mountForm(h('ul', null, h(MoveHit, { hit, from: 'fr', destinations: ['dach'], onMoved: () => {} })));
  await page.click('Move');
  await act(async () => page.props(page.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'Founder relocated to DACH, ticket 902' } }));
  await act(async () => page.props(page.by('hq-team-move')).onSubmit({ preventDefault() {} }));
  await page.flush();
  assert.ok(page.by('hq-team-move-outcome'), 'the move result is not on screen');
  assert.match(page.text(), /fr → dach/);
  assert.match(page.text(), /stay with fr/);
  assert.ok(page.by('hq-team-move-retry'));
  assert.ok(!buttons(page).some((b) => b === 'Move'), 'Move is drawn again for an account the move already closed');
  await page.unmount();
});

test('a move whose invitation landed without its email says not sent, with the next step', async () => {
  const view = moveView({
    from: 'fr', to: 'dach', moved_out: true, target: item().target,
    invited: { ok: true, stored: true, uid: 'inv_1', email_sent: false, reason: 'no mail sender configured', invite_link: 'https://dach.axal.vc/join/invt_x' },
    operation: { uid: UID, recoverable: true }, records_note: item().records_note,
  });
  const page = await mountForm(h(MoveOutcome, { view }));
  const states = page.nodes().filter((n) => page.props(n)['data-state']).map((n) => page.props(n)['data-state']);
  assert.deepEqual(states, ['created', 'not_sent', 'manual']);
  assert.ok(!page.by('hq-team-move-retry'));
  assert.doesNotMatch(page.text(), NEVER_TOLD);
  await page.unmount();
});
