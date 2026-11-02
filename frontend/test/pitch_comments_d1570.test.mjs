/**
 * D1570 (#3817, deck builder v2 D9) — PD-3 · pd33 "Comments on a card".
 *
 * What this file holds the frontend to:
 *   · the sheet "Comments · card [n]" with its open count, the card's threads
 *     numbered from 1, an @-mention people listbox, "Assign to" ▾ and Resolve;
 *   · it opens from the card's ⋯ or from ⋯ › This card, never a header button;
 *   · a mention is a person picked from the listbox whose "@Name" is still in
 *     the text, and the post carries exactly those ids;
 *   · nothing is posted until Post; no model and no Eadwyn in a thread;
 *   · the pre-share gate's amber line (pd33 inset) holds Share while an
 *     approver has not approved.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_comments_d1570.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';
import CommentsSheet from '../src/pages/raise/pitch/CommentsSheet.jsx';
import { cardMenuItems } from '../src/pages/raise/pitch/CardsStrip.jsx';
import { MORE_MENU, moreState } from '../src/pages/raise/pitch/deckV2Model.js';
import { availability } from '../src/pages/raise/pitch/deckV2Adapter.js';
import {
  ADMIN_LINE, Q_NOTE, approvalLine, commentsTitle, insertMention, mayAct, mentionMatches, mentionQuery, mentionsIn, openCount, preShareGate, threadsOn,
} from '../src/pages/raise/pitch/commentsModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const PEOPLE = [
  { id: 3, name: 'Fay Founder', kind: 'founder' },
  { id: 5, name: 'Sam Advisor', kind: 'advisor' },
  { id: 6, name: 'Sasha Partner', kind: 'operating_partner' },
];
const c = (o) => ({ deck_id: 40, deck_version: 2, card_uid: null, area: null, parent_uid: null, mentions: [], assignee: null, resolved_at: null, resolved_by: null, created_at: '2026-11-01 10:00:00', ...o });
const COMMENTS = [
  c({ uid: 'a'.repeat(32), card_index: 3, author: { id: 3, name: 'Fay Founder' }, body: '@Sam Advisor is this right?', mentions: [{ id: 5, name: 'Sam Advisor' }] }),
  c({ uid: 'b'.repeat(32), card_index: 3, author: { id: 5, name: 'Sam Advisor' }, body: 'Synthetic reply', parent_uid: 'a'.repeat(32) }),
  c({ uid: 'c'.repeat(32), card_index: 3, area: 'a2', author: { id: 5, name: 'Sam Advisor' }, body: 'Synthetic second', assignee: { id: 3, name: 'Fay Founder' } }),
  c({ uid: 'd'.repeat(32), card_index: 3, author: { id: 3, name: 'Fay Founder' }, body: 'Synthetic done', resolved_at: '2026-11-01 11:00:00' }),
  c({ uid: 'e'.repeat(32), card_index: 1, author: { id: 3, name: 'Fay Founder' }, body: 'Synthetic elsewhere' }),
];

test('the model: a card\'s threads numbered from 1 with their replies, and its open count', () => {
  assert.equal(commentsTitle(3), 'Comments · card 4');
  const t = threadsOn(COMMENTS, { title: 'x' }, 3);
  assert.deepEqual(t.map((x) => [x.n, x.root.uid[0], x.replies.length, x.open]), [[1, 'a', 1, true], [2, 'c', 0, true], [3, 'd', 0, false]]);
  assert.equal(openCount(COMMENTS, {}, 3), 2, '"2 open", as pd33 draws');
  // A card with a uid follows its comments by uid, wherever it moved.
  const moved = [c({ uid: 'f'.repeat(32), card_index: 0, card_uid: 'card-x', author: { id: 3, name: 'F' }, body: 'x' })];
  assert.equal(threadsOn(moved, { uid: 'card-x' }, 5).length, 1);
  assert.equal(threadsOn(moved, { uid: 'card-y' }, 0).length, 0);
});

test('the model: @ opens the people listbox; a pick inserts "@Name "; a mention is one still in the text', () => {
  assert.deepEqual(mentionQuery('Check this @Sa', 14), { query: 'Sa', start: 11 });
  assert.deepEqual(mentionQuery('@', 1), { query: '', start: 0 });
  assert.equal(mentionQuery('mail fay@example.test', 21), null, 'an @ inside a word is not a mention');
  assert.equal(mentionQuery('done @Sam ', 10), null, 'a space ends it');
  assert.deepEqual(mentionMatches(PEOPLE, 'Sa', 3).map((p) => p.id), [5, 6]);
  assert.deepEqual(mentionMatches(PEOPLE, 'Fay', 3), [], 'the writer is never offered');
  assert.deepEqual(mentionMatches(PEOPLE, 'Fay', 5).map((p) => p.id), [3]);
  assert.deepEqual(mentionMatches(PEOPLE, 'adv', 3).map((p) => p.id), [5], 'any word of the name');
  const ins = insertMention('Check @Sa now', 6, 9, PEOPLE[1]);
  assert.deepEqual(ins, { text: 'Check @Sam Advisor  now', caret: 19 });
  assert.deepEqual(mentionsIn('Hi @Sam Advisor and @Sam Advisor', [PEOPLE[1], PEOPLE[1]]), [5], 'once');
  assert.deepEqual(mentionsIn('Hi there', [PEOPLE[1]]), [], 'deleting the words drops the mention');
});

test('the model: who may assign and resolve', () => {
  const thread = { author: { id: 5 }, assignee: { id: 6 } };
  assert.equal(mayAct({ user_id: 3, can_manage: true }, thread, 'assign'), true);
  assert.equal(mayAct({ user_id: 5, can_manage: false }, thread, 'assign'), true, 'its author');
  assert.equal(mayAct({ user_id: 6, can_manage: false }, thread, 'assign'), false);
  assert.equal(mayAct({ user_id: 6, can_manage: false }, thread, 'resolve'), true, 'its assignee resolves');
  assert.equal(mayAct({ user_id: 7, can_manage: false }, thread, 'resolve'), false);
});

test('the pre-share gate: an approver who has not approved holds Share with the amber line; nobody waited on, no confirm', () => {
  const held = preShareGate({ pending: [{ user_id: 5, name: 'Sam Advisor' }], message: 'Approval needed before sharing · Sam Advisor has not approved yet.' });
  assert.deepEqual(held, { show: true, held: true, lines: [{ tone: 'amber', key: 'approval', text: 'Approval needed before sharing · Sam Advisor has not approved yet.' }] });
  assert.deepEqual(preShareGate({ pending: [] }), { show: false, held: false, lines: [] });
  assert.deepEqual(preShareGate({ status: 'error', pending: [] }), { show: false, held: false, lines: [] }, 'unread: the Worker still refuses a held link');
  assert.equal(approvalLine([{ name: 'Sam' }, { name: 'Ali' }, { name: null }]), 'Approval needed before sharing · Sam, Ali and An approver have not approved yet.');
});

test('it opens from the card\'s ⋯ and from ⋯ › This card; there is no header button', () => {
  const item = cardMenuItems(1, 3, {}, availability).find((i) => i.id === 'comments');
  assert.deepEqual([item.label, item.later, item.why], ['Comments', false, null]);
  const more = MORE_MENU.find((s) => s.id === 'card').items.find((i) => i.id === 'comments');
  assert.equal(more.adapter, 'comments');
  const st = moreState(MORE_MENU, { availability }).sections.find((s) => s.id === 'card').items.find((i) => i.id === 'comments');
  assert.deepEqual([st.disabled, Boolean(st.later)], [false, false], 'swapped: live');
  assert.doesNotMatch(read('frontend/src/pages/raise/pitch/DeckToolbar.jsx'), /comments/i, 'no header button');
  const editor = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  assert.match(editor, /id === 'comments' && cards\[i\]\) \{ choose\(i\); setSheet\('comments'\); \}/);
  assert.match(editor, /'remix', 'comments'\]\.includes\(id\)\) setSheet\(id\)/);
});

test('no model and no Eadwyn anywhere in a thread', () => {
  for (const f of ['CommentsSheet.jsx', 'commentsModel.js']) {
    const src = read(`frontend/src/pages/raise/pitch/${f}`);
    assert.doesNotMatch(src, /from '[^']*(assist|eadwyn|aiRail|AIRail|railModel|useAssistMode)[^']*'/i, f);
    assert.doesNotMatch(src, /Ask Eadwyn|Draft a reply|Suggest a reply/i, f);
  }
});

/* ------------------------------------------------------------------ *
 * The sheet, mounted
 * ------------------------------------------------------------------ */

async function mountSheet({ list, approval, admin = false }) {
  const names = ['list', 'post', 'assign', 'resolve', 'approval', 'setApprovers', 'approve'];
  const saved = Object.fromEntries(names.map((n) => [n, deckCommentsApi[n]]));
  const calls = [];
  for (const n of names) deckCommentsApi[n] = async (...a) => { calls.push([n, ...a]); return n === 'list' ? list() : n === 'approval' ? approval() : n === 'post' ? { comment: {} } : n === 'setApprovers' || n === 'approve' ? approval() : { comment: {} }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(CommentsSheet, { deckId: 40, card: { title: 'x' }, index: 3, area: 'a2', admin, onClose() {} })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, settle,
    text: () => text(document.body).replace(/\s+/g, ' '),
    async type(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value, selectionStart: value.length } }); }); await settle(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async down(id) { await act(async () => { pr(by(id)).onMouseDown?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => rootEl.unmount()); restore(); for (const n of names) deckCommentsApi[n] = saved[n]; },
  };
}

const VIEWER = { user_id: 3, kind: 'founder', can_manage: true };
const reply = () => ({ deck_id: 40, version: 2, viewer: VIEWER, people: PEOPLE, comments: COMMENTS, open: 3 });

test('the sheet: "Comments · card 4", "2 open", the threads, Assign to ▾ and Resolve', async () => {
  const m = await mountSheet({ list: async () => reply(), approval: async () => ({ deck_id: 40, version: 2, approvers: [{ user_id: 5, name: 'Sam Advisor', approved: false, approved_version: null, approved_at: null }], pending: [{ user_id: 5, name: 'Sam Advisor' }], message: 'x' }) });
  try {
    const t = m.text();
    assert.match(t, /Comments · card 4/);
    assert.equal(m.text().includes('2 open'), true);
    assert.ok(m.by('pitch-comment-thread-1') && m.by('pitch-comment-thread-2') && m.by('pitch-comment-thread-3'));
    assert.equal(m.by('pitch-comment-thread-4'), undefined, 'only this card\'s threads');
    assert.match(t, /Synthetic reply/);
    assert.match(t, /Resolved/);
    assert.ok(t.includes(Q_NOTE), 'the Q note pd33 carries');
    assert.match(t, /Not approved yet/);
    await m.change('pitch-comment-assign-1', '5');
    assert.deepEqual(m.calls.find((x) => x[0] === 'assign'), ['assign', 40, 'a'.repeat(32), 5]);
    await m.press('pitch-comment-resolve-1');
    assert.deepEqual(m.calls.find((x) => x[0] === 'resolve'), ['resolve', 40, 'a'.repeat(32), true]);
    await m.press('pitch-comment-resolve-3');
    assert.deepEqual(m.calls.filter((x) => x[0] === 'resolve')[1], ['resolve', 40, 'd'.repeat(32), false], 'Open again');
    await m.change('pitch-comments-add-approver', '6');
    assert.deepEqual(m.calls.find((x) => x[0] === 'setApprovers'), ['setApprovers', 40, [5, 6]]);
  } finally { await m.unmount(); }
});

test('the sheet: "@Sa" opens the people listbox; the pick is the mention; nothing is posted until Post', async () => {
  const m = await mountSheet({ list: async () => reply(), approval: async () => ({ approvers: [], pending: [], version: 2 }) });
  try {
    await m.type('pitch-comment-new-text', 'Check this @Sa');
    assert.ok(m.by('pitch-comment-new-listbox'), 'the people listbox');
    assert.ok(m.by('pitch-comment-new-person-5') && m.by('pitch-comment-new-person-6'));
    assert.equal(m.by('pitch-comment-new-person-3'), undefined, 'not the writer');
    await m.down('pitch-comment-new-person-5');
    assert.equal(m.pr(m.by('pitch-comment-new-text')).value, 'Check this @Sam Advisor ');
    assert.equal(m.calls.filter((x) => x[0] === 'post').length, 0, 'nothing posted yet');
    await m.press('pitch-comment-new-post');
    const post = m.calls.find((x) => x[0] === 'post');
    assert.deepEqual(post, ['post', 40, { body: 'Check this @Sam Advisor', card_index: 3, card_uid: undefined, area: 'a2', mentions: [5] }]);
    assert.equal(m.pr(m.by('pitch-comment-new-text')).value, '', 'cleared once posted');
  } finally { await m.unmount(); }
});

test('the sheet: an Admin reads why, and an unreadable read says so with Try again, never an empty thread', async () => {
  const admin = await mountSheet({ list: async () => { throw Object.assign(new Error('nope'), { status: 404 }); }, approval: async () => ({}), admin: true });
  try { assert.ok(admin.text().includes(ADMIN_LINE)); } finally { await admin.unmount(); }
  const bad = await mountSheet({ list: async () => { throw Object.assign(new Error('down'), { status: 500 }); }, approval: async () => ({}) });
  try {
    assert.ok(bad.by('pitch-comments-unreadable'));
    assert.match(bad.text(), /could not be read\. Try again/);
    assert.equal(bad.by('pitch-comments-none'), undefined);
  } finally { await bad.unmount(); }
});
