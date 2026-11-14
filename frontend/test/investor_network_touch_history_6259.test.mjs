/**
 * #6259 (D6259) — the investor Network shows a tie's touch history and every
 * reminder, read back.
 *
 * Before: opening "Log a touch" fetched the log only to draw "Void this touch"
 * buttons; only reminders already due were shown; and the header's "Set
 * reminders" silently opened the FIRST ROW's reminder form. Now:
 *
 *  - the touch panel lists the recorded touches newest first — date, note,
 *    who recorded it, voided or not — with void on the reader's own only;
 *  - loading, empty ("No touch recorded") and "could not be read" are three
 *    different states (#5129 wording: a failed read is never an empty list);
 *  - a tie shows its open reminder date, and the Reminders view lists the
 *    upcoming and done reminders, where an open one can be marked done before
 *    it is due;
 *  - "Set reminders" opens that view, and opens no row's form.
 *
 * Fixtures are invented. The page is mounted with the api methods replaced,
 * as admin_spinout_lab_unreadable.test.mjs does.
 *
 * Mutation-checked (each made a test here fail, then was reverted):
 *  1. `touchHistory` sorting oldest first (`rank(a) - rank(b)`) → "newest first".
 *  2. dropping `&& mine` from the void button → "void stays the reader's own".
 *  3. `setTouchLogError('unreadable')` → `setTouchLog([])` in `readTouchLog`'s
 *     catch → "a failed read is never No touch recorded".
 *  4. `api.partnerReminders(true)` → `api.partnerReminders()` → "done reminders".
 *  5. `setRemindersOpen(true)` → `setReminderFor(visibleRelationships[0]?.id)`
 *     (the old behaviour) → "Set reminders opens the view".
 *  6. `!Number(r?.done)` → `Number(r?.done)` in `openReminderFor` → "open
 *     reminder date".
 *  7. the `max-width:640px` single-column rule removed from the CSS → "390px".
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_network_touch_history_6259.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { touchHistory, touchRecorder, openReminderFor, reminderLists } from '../src/lib/networkBook.js';

const h = React.createElement;
const ORIGINAL = { ...api };
const ME = { id: 7, role: 'investor', email: 'me@example.com', name: 'Casey Sample' };
const TIE = { id: 11, status: 'accepted', relationship_type: 'founder', strength_score: 60, last_interaction_at: '2026-11-01T12:00:00.000Z', other: { id: 22, name: 'Rowan Example', role: 'founder' } };
const TOUCHES = [
  // Deliberately out of order: the page sorts newest first itself.
  { uid: 't-old', relationship_id: 11, note: 'Coffee about the seed round', interacted_at: '2026-09-02T12:00:00.000Z', created_at: '2026-09-02 13:00:00', recorded_by: 7, recorded_by_name: 'Casey Sample', voided_at: null },
  { uid: 't-new', relationship_id: 11, note: 'Call on hiring', interacted_at: '2026-11-01T12:00:00.000Z', created_at: '2026-11-01 13:00:00', recorded_by: 22, recorded_by_name: 'Rowan Example', voided_at: null },
  { uid: 't-void', relationship_id: 11, note: 'Wrong tie', interacted_at: '2026-10-10T12:00:00.000Z', created_at: '2026-10-10 13:00:00', recorded_by: 7, recorded_by_name: 'Casey Sample', voided_at: '2026-10-11T09:00:00.000Z' },
];
const REMINDERS = [
  { uid: 'r-later', relationship_id: 11, remind_at: '2099-03-01', note: 'Ask about the next close', done: 0, done_at: null, a_name: 'Casey Sample', b_name: 'Rowan Example' },
  { uid: 'r-done', relationship_id: 11, remind_at: '2026-10-01', note: 'Send the deck notes', done: 1, done_at: '2026-10-02T08:00:00.000Z', a_name: 'Casey Sample', b_name: 'Rowan Example' },
];
const never = () => new Promise(() => {});
const fail = () => Promise.reject(new Error('read failed'));

async function mount({ log = async () => ({ items: TOUCHES }), reminders = async () => ({ items: REMINDERS }), relationships = [TIE] } = {}) {
  const calls = [];
  const restore = installDocument();
  // The fake document has no lookup; the page's scroll-to-view only needs it to answer.
  if (typeof document.getElementById !== 'function') document.getElementById = () => null;
  globalThis.localStorage?.setItem?.('user', JSON.stringify(ME));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(ME), { status: 200, headers: { 'Content-Type': 'application/json' } });
  api.partnerRelationships = async () => relationships;
  api.partnerSummary = async () => ({});
  api.introPropositions = async () => ({ propositions: [], credits: null });
  api.listIntroductions = async () => ({ introductions: [] });
  api.partnerReminders = (...a) => { calls.push(['reminders', ...a]); return reminders(...a); };
  api.partnerInteractionLog = (...a) => { calls.push(['log', ...a]); return log(...a); };
  api.partnerInteractionVoid = async (...a) => { calls.push(['void', ...a]); return {}; };
  api.partnerReminderDone = async (...a) => { calls.push(['done', ...a]); return {}; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/network/relationships'] },
      h(AuthProvider, null, h((await import('../src/pages/investor/InvestorNetworkWorkspace.jsx')).default, { embedded: true, zone: 'relationships' }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  // Not awaited: a click whose read never answers (the loading state) must
  // still return control to the test.
  const press = async (node) => { await act(async () => { pr(node).onClick?.({ preventDefault() {} }); }); await settle(); };
  return {
    calls, by, settle,
    text: (id) => textOf(id ? by(id) : container).replace(/\s+/g, ' ').trim(),
    order: (prefix) => walk(container).map((n) => pr(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    click: (id) => press(by(id)),
    clickText: (label) => press(walk(container).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label)),
    async unmount() { await act(async () => root.unmount()); restore(); globalThis.fetch = originalFetch; Object.assign(api, ORIGINAL); },
  };
}

test('opening Log a touch lists the recorded touches newest first, with date, note, recorder and voided', async () => {
  const m = await mount();
  try {
    await m.click('button-log-touch-11');
    assert.deepEqual(m.calls.filter((c) => c[0] === 'log'), [['log', 11]]);
    assert.ok(m.by('list-touch-log'), 'the touch history is not listed');
    assert.deepEqual(m.order('touch-t-'), ['touch-t-new', 'touch-t-void', 'touch-t-old'], 'not newest first');
    assert.match(m.text('touch-t-new'), /Nov 1, 2026/);
    assert.match(m.text('touch-t-new'), /Call on hiring/);
    // The route joins the recorder's name; the reader's own reads "You".
    assert.equal(m.text('text-touch-recorder-t-new'), 'Recorded by Rowan Example');
    assert.equal(m.text('text-touch-recorder-t-old'), 'Recorded by You');
    assert.ok(m.by('status-touch-voided-t-void'), 'a voided touch does not say so');
    assert.ok(!m.by('status-touch-voided-t-old'), 'a live touch reads as voided');
  } finally { await m.unmount(); }
});

test('void stays the reader\'s own, and not on a touch already voided', async () => {
  const m = await mount();
  try {
    await m.click('button-log-touch-11');
    assert.ok(m.by('button-void-touch-t-old'), 'the reader cannot void their own touch');
    assert.ok(!m.by('button-void-touch-t-new'), 'the reader can void the other person\'s touch');
    assert.ok(!m.by('button-void-touch-t-void'), 'a voided touch offers void again');
    await m.click('button-void-touch-t-old');
    assert.deepEqual(m.calls.find((c) => c[0] === 'void'), ['void', 11, 't-old']);
    assert.equal(m.calls.filter((c) => c[0] === 'log').length, 2, 'the history is not read again after a void');
  } finally { await m.unmount(); }
});

test('the touch history loads, then is empty: No touch recorded', async () => {
  let answer;
  const m = await mount({ log: () => new Promise((r) => { answer = r; }) });
  try {
    await m.click('button-log-touch-11');
    assert.ok(m.by('touch-log-loading'), 'no loading state while the log is read');
    assert.match(m.text('touch-log-loading'), /Loading recorded touches/);
    assert.ok(!m.by('touch-log-empty'), 'loading reads as empty');
    await act(async () => answer({ items: [] }));
    await m.settle();
    assert.equal(m.text('touch-log-empty'), 'No touch recorded');
    assert.ok(!m.by('touch-log-loading'));
  } finally { await m.unmount(); }
});

test('a failed read says the touch log could not be read — never No touch recorded — and retries', async () => {
  let ok = false;
  const m = await mount({ log: () => (ok ? Promise.resolve({ items: [] }) : fail()) });
  try {
    await m.click('button-log-touch-11');
    assert.ok(m.by('touch-log-unreadable'), 'no could-not-be-read state');
    assert.match(m.text('touch-log-unreadable'), /The touch log could not be read\. This is not a claim that none exist\./);
    assert.ok(!m.by('touch-log-empty'), 'a failed read is drawn as an empty history');
    ok = true;
    await m.clickText('Retry');
    assert.equal(m.text('touch-log-empty'), 'No touch recorded');
  } finally { await m.unmount(); }
});

test('a tie shows its open reminder date', async () => {
  const m = await mount();
  try {
    assert.equal(m.text('text-open-reminder-11'), 'Reminder Mar 1, 2099');
  } finally { await m.unmount(); }
});

test('Set reminders opens the Reminders view — upcoming and done — and no row\'s form', async () => {
  const m = await mount();
  try {
    assert.deepEqual(m.calls.find((c) => c[0] === 'reminders'), ['reminders', true], 'the done reminders are never read');
    assert.ok(!m.by('panel-reminders'));
    await m.clickText('Set reminders');
    assert.ok(m.by('panel-reminders'), 'Set reminders does not open the reminders view');
    assert.ok(!m.by('form-reminder-11'), 'Set reminders still opens the first row\'s form');
    assert.match(m.text('reminder-upcoming-r-later'), /Mar 1, 2099.*Rowan Example.*Ask about the next close.*Upcoming/);
    assert.match(m.text('reminder-done-r-done'), /Rowan Example.*Send the deck notes.*Done Oct 2, 2026/);
    assert.ok(!m.by('reminder-done-r-later') && !m.by('reminder-upcoming-r-done'), 'a reminder is in the wrong list');
  } finally { await m.unmount(); }
});

test('an open reminder can be marked done before it is due', async () => {
  const m = await mount();
  try {
    await m.clickText('Set reminders');
    await m.click('button-reminder-mark-done-r-later');
    assert.deepEqual(m.calls.find((c) => c[0] === 'done'), ['done', 'r-later', true]);
  } finally { await m.unmount(); }
});

test('the Reminders view: loading, empty and could-not-be-read', async () => {
  const loading = await mount({ reminders: never });
  try {
    await loading.clickText('Set reminders');
    assert.ok(loading.by('reminders-loading'));
    assert.ok(!loading.by('reminders-upcoming-empty'), 'loading reads as empty');
  } finally { await loading.unmount(); }
  const empty = await mount({ reminders: async () => ({ items: [] }) });
  try {
    await empty.clickText('Set reminders');
    assert.match(empty.text('reminders-upcoming-empty'), /No reminder set/);
    assert.match(empty.text('reminders-done-empty'), /No reminder marked done/);
    assert.ok(!empty.by('text-open-reminder-11'), 'a tie with no reminder shows one');
  } finally { await empty.unmount(); }
  const failed = await mount({ reminders: fail });
  try {
    await failed.clickText('Set reminders');
    assert.match(failed.text('reminders-unreadable'), /Your reminders could not be read\. This is not a claim that none exist\./);
    assert.ok(!failed.by('reminders-upcoming-empty'), 'a failed read is drawn as no reminders');
  } finally { await failed.unmount(); }
});

test('the helpers: order, recorder, open reminder, lists', () => {
  assert.deepEqual(touchHistory(TOUCHES).map((t) => t.uid), ['t-new', 't-void', 't-old']);
  assert.deepEqual(touchHistory(null), []);
  assert.equal(touchRecorder({ recorded_by: 7, recorded_by_name: 'Casey Sample' }, 7, 22), 'You');
  assert.equal(touchRecorder({ recorded_by: 22, recorded_by_name: '' }, 7, 22), 'The other person');
  assert.equal(touchRecorder({ recorded_by: 99, recorded_by_name: null }, 7, 22), 'Not recorded', 'an unknown recorder is guessed');
  assert.equal(openReminderFor(REMINDERS, 11)?.uid, 'r-later');
  assert.equal(openReminderFor(REMINDERS, 12), null);
  const lists = reminderLists(REMINDERS);
  assert.deepEqual(lists.upcoming.map((r) => r.uid), ['r-later']);
  assert.deepEqual(lists.done.map((r) => r.uid), ['r-done']);
});

test('390px: the history and the reminders wrap to one column and fix no width', () => {
  const css = readFileSync(resolve(process.cwd(), 'frontend/src/pages/investor/investorNetworkWorkspace.css'), 'utf8');
  const block = css.slice(css.indexOf('#6259'));
  assert.ok(block.length > 10, 'the #6259 rules are gone');
  assert.match(block, /@media\(max-width:640px\)\{\.inw-history li\{grid-template-columns:minmax\(0,1fr\)\}/,
    'the history rows do not stack to one column on a phone');
  assert.match(block, /\.inw-row-actions\{flex-wrap:wrap/, 'the row actions (now with the reminder date) do not wrap');
  assert.match(block, /\.inw-history-body\{min-width:0;overflow-wrap:anywhere/, 'a long note can push the row sideways');
  // No new rule fixes a width wider than a 390px phone.
  for (const [, px] of block.matchAll(/(?:^|[;{])(?:min-)?width:(\d+)px/g)) {
    assert.ok(Number(px) <= 358, `a ${px}px width in the #6259 rules overflows 390px`);
  }
});
