/**
 * D1579 (#3826, deck builder v2 E6, pd34, pd1, the STRIP) — a card's status
 * and assignee on the screens S1 built.
 *
 *   · the model: the filter shows exactly the matching cards (the Worker's
 *     rule, on the cards on screen); a deck never tracked has no pill and no
 *     card "not Done"; the words "[3] of [12] cards", "[n] cards not Done" and
 *     "[n] cards are not Done. Share anyway?"; a status or assignee is an
 *     edit, said on its own line in the save summary;
 *   · the pre-share gate: the not-Done line joins D1570's one confirm and
 *     never holds Share; an approver still does;
 *   · the Cards strip: the pills (Done positive, In progress violet outline,
 *     To do neutral), the assignee avatar, the filter card, and the card
 *     menu's Set status › and Assign ›;
 *   · the home deck card's amber "[n] cards not Done", and a failed read that
 *     says so, never a 0.
 *
 * Every venture, card and person is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_card_status_d1579.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import CardsStrip, { cardMenuItems, subMenuItems } from '../src/pages/raise/pitch/CardsStrip.jsx';
import { DeckNotDone } from '../src/pages/raise/pitch/StudioHome.jsx';
import { availability } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { deckCardStatusApi } from '../src/lib/api/deckCardStatus.js';
import { preShareGate } from '../src/pages/raise/pitch/commentsModel.js';
import { changesOf } from '../src/pages/raise/pitch/editorModel.js';
import {
  ALL_CARDS, NOT_DONE_UNREAD, PILL_TONE, countLine, filterCards, initials, isTracked, notDoneLine, notDonePill, statusOf, withAssignee, withStatus,
} from '../src/pages/raise/pitch/cardStatusModel.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');

const FAY = 3, CY = 4, SAM = 5;
const PEOPLE = [{ id: FAY, name: 'Fay Founder', kind: 'founder' }, { id: CY, name: 'Cy Cofounder', kind: 'founder' }, { id: SAM, name: 'Sam Advisor', kind: 'advisor' }];
// The Worker test's six cards: two To do (one by default), two In progress, two Done.
const CARDS = [
  { uid: 'u1', title: 'Synthetic cover', status: 'done', assignee: FAY, blocks: [] },
  { uid: 'u2', title: 'Synthetic problem', status: 'in_progress', assignee: CY, blocks: [] },
  { uid: 'u3', title: 'Synthetic market', status: 'todo', blocks: [] },
  { uid: 'u4', title: 'Synthetic traction', status: 'in_progress', assignee: FAY, blocks: [] },
  { uid: 'u5', title: 'Synthetic team', assignee: CY, blocks: [] },
  { uid: 'u6', title: 'Synthetic ask', status: 'done', blocks: [] },
];
const uids = (list) => list.map((x) => x.card.uid);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the filter shows exactly the matching cards, by status, by assignee and by both, each at its place', () => {
  const cases = [
    [{ status: 'todo', assignee: 'anyone' }, ['u3', 'u5']],
    [{ status: 'in_progress', assignee: 'anyone' }, ['u2', 'u4']],
    [{ status: 'done', assignee: 'anyone' }, ['u1', 'u6']],
    [{ status: 'all', assignee: FAY }, ['u1', 'u4']],
    [{ status: 'all', assignee: 'none' }, ['u3', 'u6']],
    [{ status: 'in_progress', assignee: FAY }, ['u4']],
    [{ status: 'todo', assignee: CY }, ['u5']],
    [{ status: 'todo', assignee: FAY }, []],
    [{ status: 'all', assignee: SAM }, []],
    [ALL_CARDS, ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']],
  ];
  for (const [f, want] of cases) assert.deepEqual(uids(filterCards(CARDS, f)), want, JSON.stringify(f));
  assert.deepEqual(filterCards(CARDS, { status: 'in_progress', assignee: FAY }).map((x) => x.index), [3], 'a card keeps its place on the deck');
  assert.deepEqual(filterCards(CARDS, { status: 'all', assignee: String(CY) }).map((x) => x.index), [1, 4], 'the select\'s string id reads as the person');
});

test('a deck never tracked has no status; once any card has one, a card without one reads To do', () => {
  const plain = [{ title: 'a' }, { title: 'b' }];
  assert.equal(isTracked(plain), false);
  assert.equal(statusOf(plain[0], false), null);
  assert.deepEqual(uids(filterCards(plain, { status: 'todo', assignee: 'anyone' })), [], 'nothing is To do on an untracked deck');
  assert.equal(isTracked(CARDS), true);
  assert.equal(statusOf(CARDS[4], true), 'todo');
  assert.equal(statusOf({ status: 'blocked' }, true), 'todo', 'an unknown status is none');
});

test('the words: "[3] of [12] cards", "[n] cards not Done" and "[n] cards are not Done. Share anyway?"', () => {
  assert.equal(countLine(3, 12), '3 of 12 cards');
  assert.equal(countLine(1, 1), '1 of 1 card');
  assert.equal(notDonePill(3), '3 cards not Done');
  assert.equal(notDonePill(1), '1 card not Done');
  assert.equal(notDonePill(0), null, 'nothing at 0');
  assert.equal(notDonePill(undefined), null, 'an unread count is never drawn as 0');
  assert.equal(notDoneLine(3), '3 cards are not Done. Share anyway?');
  assert.equal(notDoneLine(1), '1 card is not Done. Share anyway?');
  assert.equal(initials('Sam Advisor'), 'SA');
  assert.equal(initials('Cher'), 'C');
  assert.equal(initials(null), '?');
});

test('Set status and Assign are edits held until Save, each said on its own line', () => {
  assert.deepEqual(withStatus({ title: 'x' }, 'done'), { title: 'x', status: 'done' });
  assert.deepEqual(withStatus({ title: 'x' }, 'blocked'), { title: 'x' }, 'only the three');
  assert.deepEqual(withAssignee({ title: 'x' }, SAM), { title: 'x', assignee: SAM });
  assert.deepEqual(withAssignee({ title: 'x', assignee: SAM }, null), { title: 'x' }, 'Unassigned drops it');
  const base = { cards: [{ uid: 'u1', title: 'Synthetic one' }], theme: null };
  const next = { cards: [{ uid: 'u1', title: 'Synthetic one', status: 'in_progress', assignee: SAM }], theme: null };
  assert.deepEqual(changesOf(base, next), ['Card 1, Synthetic one: the status becomes In progress.', 'Card 1, Synthetic one: assigned to someone new, who is told when you save.']);
  assert.deepEqual(changesOf(next, { cards: [{ uid: 'u1', title: 'Synthetic one', status: 'in_progress' }], theme: null }), ['Card 1, Synthetic one: no longer assigned.']);
});

/* ------------------------------------------------------------------ *
 * The pre-share gate (D1570's one confirm)
 * ------------------------------------------------------------------ */

test('the gate: cards not Done add pd34\'s line, listing them, and never hold; an approver still does', () => {
  const cards = { status: 'ok', not_done: { count: 2, cards: [{ index: 1, uid: 'u2', title: 'Synthetic problem', status: 'in_progress' }, { index: 2, uid: 'u3', title: 'Synthetic market', status: 'todo' }] } };
  const warned = preShareGate({ pending: [] }, cards);
  assert.deepEqual(warned, { show: true, held: false, lines: [{ tone: 'amber', key: 'not_done', text: '2 cards are not Done. Share anyway?', cards: cards.not_done.cards }] });
  const both = preShareGate({ pending: [{ user_id: SAM, name: 'Sam Advisor' }], message: 'Approval needed before sharing · Sam Advisor has not approved yet.' }, cards);
  assert.equal(both.held, true, 'an approver who has not signed off still holds Share');
  assert.deepEqual(both.lines.map((l) => l.key), ['approval', 'not_done'], 'one confirm, both lines');
  assert.deepEqual(preShareGate({ pending: [] }, { status: 'ok', not_done: { count: 0, cards: [] } }), { show: false, held: false, lines: [] }, 'all Done: no confirm');
  assert.deepEqual(preShareGate({ pending: [] }, null), { show: false, held: false, lines: [] }, 'a route that is off: no confirm');
  assert.deepEqual(preShareGate({ pending: [] }, { status: 'error' }), { show: true, held: false, lines: [{ tone: 'muted', key: 'not_done_unread', text: NOT_DONE_UNREAD }] }, 'unread: it says so and still shares');
});

/* ------------------------------------------------------------------ *
 * The Cards strip
 * ------------------------------------------------------------------ */

async function strip(props) {
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const picked = [];
  await act(async () => { root.render(h(CardsStrip, { cards: CARDS, sel: 0, stale: new Set(), readOnly: false, onSelect() {}, move() {}, onAdd() {}, onCardAction: (...a) => picked.push(a), people: PEOPLE, ...props })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const shown = () => walk(container).map((n) => pr(n)['data-testid']).filter((id) => /^pitch-editor-rail-\d+$/.test(id || '')).map((id) => Number(id.split('-').pop()));
  return {
    by, pr, picked, shown,
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); },
    async pick(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('every card carries its pill and its assignee\'s avatar: Done positive, In progress violet outline, To do neutral', async () => {
  const t = await strip({});
  try {
    assert.deepEqual([0, 1, 2, 4].map((i) => t.pr(t.by(`pitch-editor-card-pill-${i}`))['data-status']), ['done', 'in_progress', 'todo', 'todo']);
    assert.equal(t.text(t.by('pitch-editor-card-pill-1')), 'In progress');
    assert.match(t.pr(t.by('pitch-editor-card-pill-0')).className, /emerald/, 'Done is positive');
    assert.match(t.pr(t.by('pitch-editor-card-pill-1')).className, /border-axal-violet/, 'In progress is a violet outline');
    assert.match(t.pr(t.by('pitch-editor-card-pill-2')).className, /bg-axal-ground/, 'To do is neutral');
    assert.equal(PILL_TONE.in_progress.includes('bg-white'), true);
    assert.equal(t.text(t.by('pitch-editor-card-avatar-1')), 'CC');
    assert.equal(t.pr(t.by('pitch-editor-card-avatar-1')).title, 'Assigned to Cy Cofounder');
    assert.equal(t.by('pitch-editor-card-avatar-2'), undefined, 'an unassigned card has no avatar');
  } finally { await t.close(); }
  const plain = await strip({ cards: [{ uid: 'p1', title: 'Synthetic plain', blocks: [] }] });
  try {
    assert.equal(plain.by('pitch-editor-card-pill-0'), undefined, 'a deck never tracked draws no pill');
    assert.equal(plain.by('pitch-editor-cards-filter'), undefined, 'and no filter card');
  } finally { await plain.close(); }
});

test('the filter card: All · To do · In progress · Done, "Assignee: anyone ▾" and "[n] of [12] cards", showing exactly the matching cards', async () => {
  const t = await strip({});
  try {
    assert.match(t.text(t.by('pitch-editor-cards-filter')), /^All To do In progress Done Assignee: anyone unassigned Fay Founder Cy Cofounder Sam Advisor 6 of 6 cards$/);
    await t.press('pitch-editor-cards-filter-in_progress');
    assert.deepEqual(t.shown(), [1, 3]);
    assert.equal(t.text(t.by('pitch-editor-cards-filter-count')), '2 of 6 cards');
    assert.equal(t.pr(t.by('pitch-editor-cards-filter-in_progress'))['aria-checked'], true);
    await t.pick('pitch-editor-cards-filter-assignee', String(FAY));
    assert.deepEqual(t.shown(), [3], 'both at once');
    await t.press('pitch-editor-cards-filter-all');
    assert.deepEqual(t.shown(), [0, 3]);
    await t.pick('pitch-editor-cards-filter-assignee', 'none');
    assert.deepEqual(t.shown(), [2, 5]);
    await t.press('pitch-editor-cards-filter-done');
    assert.deepEqual(t.shown(), [5]);
    assert.equal(t.text(t.by('pitch-editor-cards-filter-count')), '1 of 6 cards');
    await t.pick('pitch-editor-cards-filter-assignee', 'anyone');
    await t.press('pitch-editor-cards-filter-all');
    assert.deepEqual(t.shown(), [0, 1, 2, 3, 4, 5]);
  } finally { await t.close(); }
});

test('the card menu leads with Set status › and Assign ›; each opens its list in place, and a pick is the card\'s edit', async () => {
  const items = cardMenuItems(1, 6, CARDS[1], availability, PEOPLE);
  assert.deepEqual(items.slice(0, 4).map((i) => i.label), ['Set status ›', 'Assign ›', 'Duplicate', 'Move up']);
  assert.equal(items[1].why, null);
  assert.equal(cardMenuItems(1, 6, CARDS[1], availability, null)[1].why, 'Who can work on this deck could not be read.', 'Assign waits for the people');
  assert.equal(cardMenuItems(1, 6, CARDS[1], availability, [])[1].why, 'Nobody can be assigned on this deck yet.');
  assert.deepEqual(subMenuItems('status', CARDS[4], PEOPLE, true).map((i) => [i.label, i.on]), [['To do', true], ['In progress', false], ['Done', false]]);
  assert.deepEqual(subMenuItems('assign', CARDS[1], PEOPLE, true).map((i) => [i.label, i.on]), [['Unassigned', false], ['Fay Founder', false], ['Cy Cofounder', true], ['Sam Advisor', false]]);
  const t = await strip({});
  try {
    await t.press('pitch-editor-card-menu-open-2');
    await t.press('pitch-editor-card-status-2');
    assert.equal(t.pr(t.by('pitch-editor-card-menu-2'))['aria-label'], 'Card 3 status');
    assert.equal(t.pr(t.by('pitch-editor-card-status-todo-2'))['aria-checked'], true);
    await t.press('pitch-editor-card-back-2');
    assert.ok(t.by('pitch-editor-card-duplicate-2'), 'Back returns to the menu');
    await t.press('pitch-editor-card-status-2');
    await t.press('pitch-editor-card-status-done-2');
    assert.deepEqual(t.picked, [['status', 2, 'done']]);
    assert.equal(t.by('pitch-editor-card-menu-2'), undefined, 'a pick closes the menu');
    await t.press('pitch-editor-card-menu-open-2');
    await t.press('pitch-editor-card-assign-2');
    await t.press(`pitch-editor-card-assign-${SAM}-2`);
    await t.press('pitch-editor-card-menu-open-1');
    await t.press('pitch-editor-card-assign-1');
    await t.press('pitch-editor-card-assign-none-1');
    assert.deepEqual(t.picked.slice(1), [['assign', 2, SAM], ['assign', 1, null]]);
  } finally { await t.close(); }
  const unread = await strip({ people: null });
  try {
    await unread.press('pitch-editor-card-menu-open-1');
    await unread.press('pitch-editor-card-assign-1');
    assert.ok(unread.by('pitch-editor-card-duplicate-1'), 'Assign does not open while the people are unread');
    assert.deepEqual(unread.picked, []);
  } finally { await unread.close(); }
});

test('the editor holds Set status and Assign as card edits, and Review cards selects the first card not Done', () => {
  const src = codeOnly(read('PitchEditor.jsx'));
  assert.match(src, /id === 'status' && cards\[i\]\) \{ setCard\(i, withStatus\(cards\[i\], value\)\)/);
  assert.match(src, /id === 'assign' && cards\[i\]\) \{ setCard\(i, withAssignee\(cards\[i\], value\)\)/);
  assert.match(src, /people=\{people\}/);
  assert.match(src, /onReviewCards=\{\(uid\) => \{ setShareDialog\(null\); actionRef\.current\?\.\('review_cards', uid\)/);
  assert.match(src, /id === 'review_cards'\) \{ const at = cards\.findIndex\(\(c\) => c\?\.uid === arg\)/);
  // Nothing is written from the menu: the card-status client only reads.
  assert.doesNotMatch(codeOnly(readFileSync(new URL('../src/lib/api/deckCardStatus.js', import.meta.url), 'utf8')), /method:/);
});

/* ------------------------------------------------------------------ *
 * The home deck card (pd1)
 * ------------------------------------------------------------------ */

async function home(answer) {
  const real = deckCardStatusApi.read;
  const asked = [];
  deckCardStatusApi.read = async (...a) => { asked.push(a); return answer(); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(DeckNotDone, { deckId: 31 })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    asked, by, pr, settle, text: () => text(container).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); restore(); deckCardStatusApi.read = real; },
  };
}

test('the home deck card\'s amber "[n] cards not Done", nothing when all are Done, and a failed read that says so', async () => {
  const some = await home(async () => ({ tracked: true, not_done: { count: 3, cards: [] } }));
  try {
    assert.deepEqual(some.asked, [[31, undefined]]);
    assert.equal(some.text(), '3 cards not Done');
    assert.match(String(some.pr(some.by('pitch-studio-not-done')).className), /amber/);
  } finally { await some.close(); }
  const none = await home(async () => ({ tracked: false, not_done: { count: 0, cards: [] } }));
  try { assert.equal(none.text(), '', 'nothing at 0, never "0 cards"'); } finally { await none.close(); }
  let fail = true;
  const err = await home(async () => { if (fail) throw Object.assign(new Error('Synthetic failure'), { status: 500 }); return { not_done: { count: 1, cards: [] } }; });
  try {
    assert.match(err.text(), /^Card status could not be read\. Try again$/);
    fail = false;
    const retry = err.by('pitch-studio-not-done-error').childNodes.find((n) => n.tagName === 'BUTTON' || n.nodeName === 'BUTTON');
    const props = Object.entries(retry).find(([k]) => k.startsWith('__reactProps$'))[1];
    await act(async () => { props.onClick(); });
    await err.settle();
    assert.equal(err.text(), '1 card not Done');
  } finally { await err.close(); }
});

test('the client reads `/api/decks/:id/card-status`, with the filter in the query only when it narrows', async () => {
  const before = globalThis.fetch;
  const restore = installDocument();
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return Response.json({ not_done: { count: 0, cards: [] } }); };
  try {
    await deckCardStatusApi.read(7);
    await deckCardStatusApi.read(7, { status: 'all', assignee: 'anyone' });
    await deckCardStatusApi.read(7, { status: 'in_progress', assignee: 'none' });
    await deckCardStatusApi.read(7, { assignee: SAM });
  } finally { globalThis.fetch = before; restore(); }
  assert.deepEqual(seen.map((u) => u.replace(/^.*\/api/, '/api')), [
    '/api/decks/7/card-status', '/api/decks/7/card-status', '/api/decks/7/card-status?status=in_progress&assignee=none', `/api/decks/7/card-status?assignee=${SAM}`,
  ]);
});
