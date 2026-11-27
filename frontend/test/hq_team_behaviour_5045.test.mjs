/**
 * D5045 (#5045, HQ Team audit 6/6) — HQ Team's governed actions, rendered and driven.
 *
 * Every test here mounts the real component, answers its request (or refuses it, or never answers) and
 * reads what the page then draws and where keyboard focus is. None reads source text. Search races, branch
 * states, holder transfer and move recovery have their own rendered suites (D5040–D5044); this file covers
 * what those leave: sign-out review/cancel/confirm/refusal, unbind, the support session and its notice line,
 * the roster's unreadable → Retry → loaded path, a partial move retried to success, and keyboard focus
 * (open, Escape, completion) for every action form.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_behaviour_5045.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountForm } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import { hqAccountMovesApi } from '../src/lib/api/hqAccountMoves.js';
import HqAdminRoster from '../src/pages/hq/team/HqAdminRoster.jsx';
import HqTeamTable, { MoveHit } from '../src/pages/hq/HqTeamTable.jsx';

const h = React.createElement;
const ROW = { user_id: 7, name: 'Ada Admin', email: 'ada@hq.example', is_active: 1, rung: 'clear', super_admin: 0, licence: null };
const HIT_ADMIN = { id: 41, name: 'Bea Branch', email: 'bea@fr.example', role: 'admin', is_active: 1 };
const HIT_FOUNDER = { id: 51, name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder', is_active: 1 };
const REASON = 'Lost laptop reported on ticket 4471';

/** Stub one api method for a test, restored afterwards. */
function stub(obj, name, fn) {
  const was = obj[name];
  obj[name] = fn;
  return () => { obj[name] = was; };
}
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code, data: { error: code, message } });
const testid = (page, id) => page.by(id);
const focused = (page) => page.doc.activeElement;
const fieldOf = (page, form, tag) => page.nodes().find((n) => n.tagName === tag && isInside(n, form));
const isInside = (node, ancestor) => { for (let p = node; p; p = p.parentNode) if (p === ancestor) return true; return false; };
async function type(page, node, value) { await act(async () => page.props(node).onChange({ target: { value, checked: value } })); }
async function submit(page, form) { await act(async () => page.props(form).onSubmit({ preventDefault() {} })); await page.flush(); }
async function escape(page, form) {
  const e = { key: 'Escape', prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  await act(async () => page.props(form).onKeyDown(e));
  return e;
}
const roster = (onSignedOut = () => {}) => h(HqAdminRoster, { rows: [ROW], ladderReadable: true, licencesReadable: true, onSignedOut });
async function openSignOut(page) {
  await act(async () => page.props(testid(page, 'hq-team-revoke')).onClick());
  return testid(page, 'hq-team-revoke-form');
}

/* ── Sign out ─────────────────────────────────────────────────────────────── */

test('sign-out: opening the form focuses the reason; Cancel closes it and focus returns to Sign out', async () => {
  const restore = stub(api, 'hqForceReauthUser', async () => { throw new Error('must not be called'); });
  const page = await mountForm(roster(), { modal: true });
  try {
    const form = await openSignOut(page);
    assert.ok(form, 'the review form did not open');
    assert.equal(focused(page), fieldOf(page, form, 'INPUT'), 'focus is not on the reason field');
    await page.click('Cancel');
    assert.equal(testid(page, 'hq-team-revoke-form'), undefined, 'the form is still open');
    assert.equal(focused(page), testid(page, 'hq-team-revoke'), 'focus did not return to Sign out');
  } finally { await page.unmount(); restore(); }
});

test('sign-out: Escape closes the form and returns focus, but not while the request is in flight', async () => {
  let release;
  const calls = [];
  const restore = stub(api, 'hqForceReauthUser', (id, reason) => { calls.push([id, reason]); return new Promise((r) => { release = r; }); });
  const page = await mountForm(roster(), { modal: true });
  try {
    let form = await openSignOut(page);
    const e = await escape(page, form);
    assert.ok(e.prevented);
    assert.equal(testid(page, 'hq-team-revoke-form'), undefined);
    assert.equal(focused(page), testid(page, 'hq-team-revoke'));

    form = await openSignOut(page);
    await type(page, fieldOf(page, form, 'INPUT'), REASON);
    const box = page.nodes().filter((n) => n.tagName === 'INPUT' && isInside(n, form))[1];
    await act(async () => page.props(box).onChange({ target: { checked: true } }));
    act(() => { page.props(form).onSubmit({ preventDefault() {} }); });
    await page.flush();
    const busy = await escape(page, testid(page, 'hq-team-revoke-form'));
    assert.equal(busy.prevented, false, 'Escape abandoned a request in flight');
    assert.ok(testid(page, 'hq-team-revoke-form'), 'the form closed while its request was in flight');
    await act(async () => { release({ ok: true }); });
    await page.flush();
    assert.deepEqual(calls, [[7, REASON]]);
  } finally { await page.unmount(); restore(); }
});

test('sign-out: a confirmed sign-out says so in the row, and focus moves to that line', async () => {
  const done = [];
  const restore = stub(api, 'hqForceReauthUser', async () => ({ ok: true, revoked_at: 1762700000 }));
  const page = await mountForm(roster((row, res) => done.push([row.user_id, res.ok])), { modal: true });
  try {
    const form = await openSignOut(page);
    await type(page, fieldOf(page, form, 'INPUT'), REASON);
    const submitButton = () => page.nodes().find((n) => n.tagName === 'BUTTON' && page.props(n).type === 'submit');
    assert.equal(page.props(submitButton()).disabled, true, 'submit is allowed before the acknowledgement');
    const box = page.nodes().filter((n) => n.tagName === 'INPUT' && isInside(n, form))[1];
    await act(async () => page.props(box).onChange({ target: { checked: true } }));
    assert.equal(page.props(submitButton()).disabled, false);
    await submit(page, form);
    assert.equal(testid(page, 'hq-team-revoke-form'), undefined);
    assert.match(page.text(), /Signed out/);
    assert.equal(focused(page), testid(page, 'hq-team-signed-out'), 'focus did not move to the outcome');
    assert.deepEqual(done, [[7, true]]);
  } finally { await page.unmount(); restore(); }
});

test('sign-out: a refusal keeps the form and what was typed, and says the server\'s reason', async () => {
  const restore = stub(api, 'hqForceReauthUser', async () => { throw refusal(403, 'step_up_required', 'Confirm with your authenticator, then try again.'); });
  const page = await mountForm(roster(), { modal: true });
  try {
    const form = await openSignOut(page);
    await type(page, fieldOf(page, form, 'INPUT'), REASON);
    const box = page.nodes().filter((n) => n.tagName === 'INPUT' && isInside(n, form))[1];
    await act(async () => page.props(box).onChange({ target: { checked: true } }));
    await submit(page, form);
    const after = testid(page, 'hq-team-revoke-form');
    assert.ok(after, 'the form closed on a refusal');
    assert.equal(page.props(after)['data-state'], 'refused');
    assert.equal(page.props(fieldOf(page, after, 'INPUT')).value, REASON, 'the reason was lost');
    assert.match(page.text(), /Confirm with your authenticator/);
    assert.doesNotMatch(page.text(), /Signed out/);
  } finally { await page.unmount(); restore(); }
});

/* ── Unbind ───────────────────────────────────────────────────────────────── */

const branchHit = (hit, extra = {}) => h('ul', null, h(MoveHit, { hit, from: 'fr', destinations: ['dach'], onMoved() {}, onUnbound() {}, ...extra }));

test('unbind: the form takes focus, Escape returns it to Unbind, a refusal keeps the reason, a success replaces the hit', async () => {
  let answer = () => { throw refusal(409, 'last_admin', 'fr needs at least one other active administrator before this one is unbound.'); };
  const calls = [];
  const restore = stub(api, 'hqUnbindAdmin', async (...a) => { calls.push(a); return answer(); });
  const page = await mountForm(branchHit(HIT_ADMIN), { modal: true });
  try {
    await page.click('Unbind');
    let form = testid(page, 'hq-team-unbind');
    assert.equal(focused(page), fieldOf(page, form, 'TEXTAREA'));
    await escape(page, form);
    assert.equal(testid(page, 'hq-team-unbind'), undefined);
    assert.equal(focused(page), testid(page, 'hq-team-unbind-toggle'));

    await page.click('Unbind');
    form = testid(page, 'hq-team-unbind');
    await type(page, fieldOf(page, form, 'TEXTAREA'), 'Left the company on 1 November');
    await submit(page, form);
    form = testid(page, 'hq-team-unbind');
    assert.equal(page.props(form)['data-state'], 'refused');
    assert.match(page.text(), /needs at least one other active administrator/);
    assert.equal(page.props(fieldOf(page, form, 'TEXTAREA')).value, 'Left the company on 1 November');

    answer = () => ({ ok: true });
    await submit(page, form);
    assert.ok(testid(page, 'hq-team-unbound'), 'the hit did not say it was unbound');
    assert.match(page.text(), /no longer an administrator of fr/);
    assert.equal(focused(page), testid(page, 'hq-team-unbound'));
    assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['fr', 41], ['fr', 41]]);
  } finally { await page.unmount(); restore(); }
});

/* ── Support session ─────────────────────────────────────────────────────── */

async function supportOutcome(told) {
  const opened = [];
  const restoreOpen = (() => { const was = globalThis.open; globalThis.open = (...a) => { opened.push(a); return null; }; return () => { globalThis.open = was; }; })();
  const restore = stub(api, 'hqSupportSession', async () => ({ open_url: 'https://fr.axal.vc/support/open/tok_1', ...(told === undefined ? {} : { target_notified: told }) }));
  const page = await mountForm(branchHit(HIT_FOUNDER), { modal: true });
  try {
    await page.click('Support');
    const form = testid(page, 'hq-team-support');
    assert.equal(focused(page), fieldOf(page, form, 'TEXTAREA'));
    await type(page, fieldOf(page, form, 'TEXTAREA'), 'Founder asked for help with their deck');
    await submit(page, form);
    assert.deepEqual(opened.map((a) => a[0]), ['https://fr.axal.vc/support/open/tok_1'], 'the route\'s URL was not opened as given');
    assert.ok(testid(page, 'hq-team-support-opened'));
    return { text: page.text(), state: page.props(testid(page, 'hq-team-support-told'))['data-state'] };
  } finally { await page.unmount(); restore(); restoreOpen(); }
}

test('support session: a stored notice reads Told, a refused one Not told, an unreported one Not recorded', async () => {
  const told = await supportOutcome(true);
  assert.equal(told.state, 'told');
  assert.match(told.text, /Told: the branch reports/);
  const not = await supportOutcome(false);
  assert.equal(not.state, 'not_told');
  assert.match(not.text, /Not told/);
  const none = await supportOutcome(undefined);
  assert.equal(none.state, 'not_recorded');
  assert.doesNotMatch(none.text, /Told:/);
});

test('support session: a refusal keeps the reason, opens nothing and says why; Escape returns focus to Support', async () => {
  const opened = [];
  const was = globalThis.open; globalThis.open = (...a) => { opened.push(a); return null; };
  const restore = stub(api, 'hqSupportSession', async () => { throw refusal(403, 'totp_required', 'This needs a session signed in with your authenticator app.'); });
  const page = await mountForm(branchHit(HIT_FOUNDER), { modal: true });
  try {
    await page.click('Support');
    let form = testid(page, 'hq-team-support');
    await type(page, fieldOf(page, form, 'TEXTAREA'), 'Founder asked for help with their deck');
    await submit(page, form);
    form = testid(page, 'hq-team-support');
    assert.equal(page.props(form)['data-state'], 'refused');
    assert.match(page.text(), /signed in with your authenticator/);
    assert.equal(page.props(fieldOf(page, form, 'TEXTAREA')).value, 'Founder asked for help with their deck');
    assert.equal(opened.length, 0);
    assert.equal(testid(page, 'hq-team-support-opened'), undefined);
    await escape(page, form);
    assert.equal(focused(page), testid(page, 'hq-team-support-toggle'));
  } finally { await page.unmount(); restore(); globalThis.open = was; }
});

/* ── Move: partial, retried to success ───────────────────────────────────── */

test('move: the form takes focus; a partial move becomes the outcome card, and Retry invitation finishes it', async () => {
  const UID = 'mvop_0123456789abcdef0123';
  const note = 'Projects, deals and documents stay with fr and are readable by HQ. This is a re-invite, not a record migration.';
  const restoreMove = stub(api, 'hqMoveAccount', async () => ({
    from: 'fr', to: 'dach', moved_out: true, target: { id: 51, name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder' },
    invited: { ok: false, code: 'destination_unreachable', reason: 'The invitation on dach did not land: the branch could not be reached.' },
    operation: { uid: UID, recoverable: true }, records_note: note,
  }));
  const retried = [];
  const restoreRetry = stub(hqAccountMovesApi, 'retryInvitation', async (uid) => {
    retried.push(uid);
    return {
      operation: { uid: UID, from: 'fr', to: 'dach', target: { name: 'Remy Blanc', email: 'remy@fr.example', role: 'founder' }, status: 'invited', state: 'invitation_sent',
        moved_out: true, attempts: 2, last_error_code: null, last_error: null, records_note: note,
        invitation: { uid: 'inv_1', stored: true, email_sent: true, email_reason: null }, updated_at: '2026-11-09 12:05:00' },
      retried: true, invited: { ok: true, stored: true, uid: 'inv_1', email_sent: true },
    };
  });
  const page = await mountForm(branchHit(HIT_FOUNDER), { modal: true });
  try {
    await page.click('Move');
    const form = testid(page, 'hq-team-move');
    assert.equal(focused(page), fieldOf(page, form, 'SELECT'), 'focus is not on the destination');
    await type(page, fieldOf(page, form, 'TEXTAREA'), 'Founder relocated to DACH, ticket 902');
    await submit(page, form);
    assert.ok(testid(page, 'hq-team-moved'));
    assert.equal(focused(page), testid(page, 'hq-team-moved'), 'focus did not move to the outcome');
    assert.match(page.text(), /did not land/);
    await page.click('Retry invitation');
    await page.flush();
    assert.deepEqual(retried, [UID]);
    assert.match(page.text(), /Invitation created on dach/);
    assert.equal(testid(page, 'hq-team-move-retry'), undefined, 'Retry invitation is still offered after it landed');
  } finally { await page.unmount(); restoreMove(); restoreRetry(); }
});

/* ── The roster read ─────────────────────────────────────────────────────── */

test('the roster: a failed read is Unreadable with Retry, and Retry draws the team', async () => {
  let fail = true;
  const calls = [];
  const restore = stub(api, 'hqAdmins', async (...a) => {
    calls.push(a);
    if (fail) throw refusal(503, 'unavailable', 'unavailable');
    return { items: [ROW], total: 1, active: 1, ladder_readable: true, licences_available: true, registry_available: true, no_branches: true, searched: false, branches: [] };
  });
  // The Moves to finish panel beside the roster makes its own read; it answers empty here.
  const restoreMoves = stub(hqAccountMovesApi, 'open', async () => ({ items: [] }));
  const page = await mountForm(h(HqTeamTable, {}), { modal: true });
  try {
    await page.flush();
    assert.match(page.text(), /could not be read|Unreadable/i);
    assert.match(page.text(), /not a claim that there are none/);
    assert.equal(testid(page, 'hq-team-row'), undefined);
    fail = false;
    await page.click('Retry');
    await page.flush();
    assert.ok(testid(page, 'hq-team-row'), 'Retry did not draw the roster');
    assert.match(page.text(), /Ada Admin/);
    assert.doesNotMatch(page.text(), /not a claim that there are none/);
    assert.equal(calls.length, 2);
  } finally { await page.unmount(); restore(); restoreMoves(); }
});

/* ── Reason floors, rendered (these replace D259's and D262's source regexes) ── */

const submitOf = (page, form) => page.nodes().find((n) => n.tagName === 'BUTTON' && page.props(n).type === 'submit' && isInside(n, form));

for (const [label, panel, method, floor] of [['Unbind', 'hq-team-unbind', 'hqUnbindAdmin', 10], ['Support', 'hq-team-support', 'hqSupportSession', 10]]) {
  test(`${label}: the submit waits for ${floor} characters after trimming, and the reason sent is the trimmed one`, async () => {
    const sent = [];
    const restore = stub(api, method, async (code, id, reason) => { sent.push(reason); return method === 'hqSupportSession' ? { open_url: 'https://fr.axal.vc/x', target_notified: true } : { ok: true }; });
    const was = globalThis.open; globalThis.open = () => null;
    const page = await mountForm(branchHit(label === 'Unbind' ? HIT_ADMIN : HIT_FOUNDER), { modal: true });
    try {
      await page.click(label);
      const form = testid(page, panel);
      const field = fieldOf(page, form, 'TEXTAREA');
      await type(page, field, `   ${'x'.repeat(floor - 1)}   `);
      assert.equal(page.props(submitOf(page, testid(page, panel))).disabled, true, `${label} is allowed below ${floor} trimmed characters`);
      await type(page, field, `  ${'y'.repeat(floor)}  `);
      assert.equal(page.props(submitOf(page, testid(page, panel))).disabled, false);
      await submit(page, testid(page, panel));
      assert.deepEqual(sent, ['y'.repeat(floor)], 'the reason sent is not the trimmed reason typed');
    } finally { await page.unmount(); restore(); globalThis.open = was; }
  });
}

test('Move: drawn on an active non-admin hit only when another branch exists; never on an administrator', async () => {
  const labels = (page) => page.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => page.props(n)['data-testid']);
  let page = await mountForm(branchHit(HIT_FOUNDER, { destinations: [] }));
  assert.ok(!labels(page).includes('hq-team-move-toggle'), 'Move is drawn with no other branch to move to');
  await page.unmount();
  page = await mountForm(branchHit(HIT_FOUNDER));
  assert.ok(labels(page).includes('hq-team-move-toggle'));
  await page.unmount();
  page = await mountForm(branchHit(HIT_ADMIN));
  assert.ok(!labels(page).includes('hq-team-move-toggle'), 'Move is drawn on an administrator');
  assert.ok(labels(page).includes('hq-team-unbind-toggle'));
  await page.unmount();
});
