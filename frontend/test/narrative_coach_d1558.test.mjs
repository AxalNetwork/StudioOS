/**
 * D1558 (#3805, deck v2 C10): "Deck ready to send" and the narrative coach on
 * Story, the client, and the editor's card-and-area deep link: a readiness
 * row opens the right card with the right Grid area selected. Synthetic data.
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_coach_d1558.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { narrativeCoachApi } from '../src/lib/api/narrativeCoach.js';
import NarrativeCoach from '../src/pages/raise/narrative/NarrativeCoach.jsx';
import { COACH_EMPTY, COACH_OPTION, droppedLine, findingLink, readyHead } from '../src/pages/raise/narrative/coachModel.js';
import { areaFromLink, cardFromLink, rangeOf } from '../src/pages/raise/pitch/deckLinkModel.js';
import { areasOf } from '../src/pages/raise/pitch/gridSelection.js';
import { CARD, DECK, mountEditor } from './_pitch_editor_mount.mjs';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/** The Worker's rows, as `services/narrative/coach.ts` writes them (its test pins the same hrefs). */
const ROWS = [
  { key: 'empty_area:c-solution:s1', kind: 'empty_area', label: 'Card 2 · Solution: an area is empty.', card_uid: 'c-solution', card_index: 1, area: { id: 's1', c1: 1, c2: 6, r1: 2, r2: 4 }, href: '/raise/pitch/edit?project_id=7&card=c-solution&area=c1-6r2-4' },
  { key: 'untitled:3:x1', kind: 'untitled', label: 'Card 4 has no title.', card_uid: null, card_index: 3, area: { id: 'x1', c1: 1, c2: 12, r1: 1, r2: 1 }, href: '/raise/pitch/edit?project_id=7&card=4&area=c1-12r1-1' },
];
const READY = { state: 'not_ready', deck_id: 31, version: 5, label: 'Deck ready to send · 2 to fix', rows: ROWS };
const FINDING = { key: 'traction:unclear:c-traction:t3', section: 'traction', section_label: 'Traction', kind: 'unclear', message: 'The traction card does not say who pays.', proposal: 'Name the kind of team that pays.', card_uid: 'c-traction', card_index: 2, card_title: 'Traction', area: { id: 't3', c1: 8, c2: 12, r1: 4, r2: 6 }, href: '/raise/pitch/edit?project_id=7&card=c-traction&area=c8-12r4-6' };

// ─────────────────────────────────────────────────────────── the link

test('the link: a card by uid or by place, and an area by its range, its id, or the area holding its corner', () => {
  const cards = [{ uid: 'a' }, { uid: 'b' }, { title: 'no uid' }];
  assert.equal(cardFromLink('b', cards), 1);
  assert.equal(cardFromLink('3', cards), 2, 'a place from 1');
  assert.equal(cardFromLink('gone', cards), 0, 'an unknown uid opens the first card');
  assert.equal(cardFromLink(null, cards), 0);
  assert.deepEqual(rangeOf('c1-6r2-4'), { c1: 1, c2: 6, r1: 2, r2: 4 });
  assert.equal(rangeOf('c6-1r2-4'), null, 'a backwards range is no range');
  assert.equal(rangeOf('1-6,2-4'), null);
  const areas = areasOf(CARD);
  assert.equal(areaFromLink('c1-7r2-6', areas), 'b2', 'the exact range');
  assert.equal(areaFromLink('b3', areas), 'b3', 'an area id');
  assert.equal(areaFromLink('c2-3r3-3', areas), 'b2', 'the area that holds the range\'s corner');
  assert.equal(areaFromLink('junk', areas), null);
  assert.equal(areaFromLink(null, areas), null);
  const overlapping = [{ id: 'big', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }, { id: 'small', grid: { c1: 2, c2: 3, r1: 2, r2: 3 } }];
  assert.equal(areaFromLink('c2-3r2-3', overlapping), 'small', 'the exact range wins over an area that only holds its corner');
});

test('a readiness row opens the editor on its card with its Grid area selected', async () => {
  const m = await mountEditor({ entry: '/raise/pitch/edit?project_id=7&card=1&area=c1-7r2-6' });
  try {
    const area = (id) => m.walk(m.container).find((n) => typeof m.pr(n).id === 'string' && m.pr(n).id.endsWith(`-area-${id}`) && m.pr(n)['aria-pressed'] !== undefined);
    assert.equal(m.pr(area('b2'))['aria-pressed'], true, 'the linked area is selected');
    assert.equal(m.pr(area('b1'))['aria-pressed'], false);
    assert.equal(m.pr(area('b3'))['aria-pressed'], false);
  } finally { await m.close(); }
  const second = await mountEditor({ entry: '/raise/pitch/edit?project_id=7&card=2&area=c1-7r2-6' });
  try {
    const pressed = second.walk(second.container).filter((n) => second.pr(n)['aria-pressed'] === true && String(second.pr(n).id || '').includes('-area-'));
    assert.equal(pressed.length, 1, 'card 2 opens with one area selected');
    assert.match(second.pr(pressed[0]).id, /-area-free:1-1$/, 'card 2 has no blocks, so its free area that holds the range is selected, never card 1\'s block');
    assert.equal(DECK.slides[1].title, 'Synthetic second');
  } finally { await second.close(); }
  const plain = await mountEditor();
  try {
    const pressed = plain.walk(plain.container).filter((n) => plain.pr(n)['aria-pressed'] === true && String(plain.pr(n).id || '').includes('-area-'));
    assert.equal(pressed.length, 0, 'no link, no selection');
  } finally { await plain.close(); }
});

// ─────────────────────────────────────────────────────────── the words and the client

test('the words and the client', async () => {
  assert.equal(readyHead('ok', READY), 'Deck ready to send · 2 to fix');
  assert.equal(readyHead('ok', { state: 'ready', rows: [] }), 'Deck ready to send ✓');
  assert.equal(findingLink(FINDING), 'Open card 3 · Traction');
  assert.equal(droppedLine([]), null);
  assert.match(droppedLine([{ reason: 'figure' }]), /^1 finding was left out/);
  const previous = globalThis.fetch;
  const store = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { const u = new URL(String(url), 'http://x'); calls.push([u.pathname.replace(/^\/api/, ''), u.search, init.method || 'GET']); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try { await narrativeCoachApi.deckReady(7); await narrativeCoachApi.coach(7, 2, { 'X-Rail-Option': COACH_OPTION }); }
  finally { globalThis.fetch = previous; globalThis.localStorage = store; }
  assert.deepEqual(calls, [['/cycles/raise/deck-ready', '?project=7', 'GET'], ['/cycles/raise/narrative/2/coach', '?project=7', 'POST']]);
  assert.match(src('lib/railOptions/founder.js'), /key: 'review:narrative-coach'[^\n]*kind: 'reason'/);
  assert.match(src('lib/apiModules.generated.js'), /export \* from '\.\/api\/narrativeCoach\.js';/);
  assert.match(src('pages/raise/narrative/StoryTab.jsx'), /<NarrativeCoach projectId=\{projectId\} version=\{version\} canRun=\{!readOnly && !phone\}/);
  assert.doesNotMatch(src('pages/raise/narrative/NarrativeCoach.jsx'), /<textarea|<input/, 'no composer: the coach is never a conversation');
});

// ─────────────────────────────────────────────────────────── the panel

async function mount({ props = {}, answers = {} } = {}) {
  const before = { ...narrativeCoachApi };
  const calls = [];
  const stubs = { deckReady: async () => READY, coach: async () => ({ findings: [FINDING], dropped: [{ reason: 'figure' }], ready: READY }), ...answers };
  for (const [k, fn] of Object.entries(stubs)) narrativeCoachApi[k] = (...a) => { calls.push([k, ...a]); return fn(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(NarrativeCoach, { projectId: 7, version: 2, canRun: true, aiOn: true, ...props }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr,
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(node) { if (!node) throw new Error('no such node'); await act(async () => { await pr(node).onClick?.({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); Object.assign(narrativeCoachApi, before); },
  };
}

test('Deck ready to send: each row links its card and area; the coach press runs once and shows findings with their links', async () => {
  const m = await mount();
  try {
    assert.equal(m.text(m.by('deck-ready-head')), 'Deck ready to send · 2 to fix');
    assert.equal(m.pr(m.by(`deck-ready-row-${ROWS[0].key}`)).href, ROWS[0].href);
    assert.equal(m.pr(m.by(`deck-ready-row-${ROWS[1].key}`)).href, ROWS[1].href);
    assert.equal(m.calls.filter((c) => c[0] === 'coach').length, 0, 'nothing runs until pressed');
    await m.press(m.by('narrative-coach-run'));
    const run = m.calls.find((c) => c[0] === 'coach');
    assert.deepEqual(run.slice(1, 3), [7, 2]);
    assert.ok(run[3], 'the press carries its rail headers');
    assert.match(m.text(m.by(`narrative-coach-finding-${FINDING.key}`)), /The traction card does not say who pays\. Name the kind of team that pays\./);
    assert.equal(m.pr(m.by(`narrative-coach-open-${FINDING.key}`)).href, FINDING.href);
    assert.equal(m.text(m.by(`narrative-coach-open-${FINDING.key}`)), 'Open card 3 · Traction ›');
    assert.match(m.text(m.by('narrative-coach-dropped')), /^1 finding was left out/);
  } finally { await m.close(); }
});

test('a reader and AI off run nothing; ready says so; no deck holds the press; a failed read is not "ready"', async () => {
  const reader = await mount({ props: { canRun: false } });
  try { assert.equal(reader.by('narrative-coach-run'), undefined); } finally { await reader.close(); }
  const off = await mount({ props: { aiOn: false, offLine: 'AI assistance is off on this page.' } });
  try {
    assert.equal(off.by('narrative-coach-run'), undefined);
    assert.equal(off.text(off.by('narrative-coach-off')), 'AI assistance is off on this page.');
  } finally { await off.close(); }
  const ready = await mount({ answers: { deckReady: async () => ({ state: 'ready', deck_id: 31, version: 5, rows: [], label: 'Deck ready to send' }), coach: async () => ({ findings: [], dropped: [] }) } });
  try {
    assert.equal(ready.text(ready.by('deck-ready-head')), 'Deck ready to send ✓');
    await ready.press(ready.by('narrative-coach-run'));
    assert.equal(ready.text(ready.by('narrative-coach-empty')), COACH_EMPTY);
  } finally { await ready.close(); }
  const none = await mount({ answers: { deckReady: async () => ({ state: 'no_deck', deck_id: null, version: null, rows: [], label: 'There is no deck yet. Build one first.' }) } });
  try { assert.equal(none.pr(none.by('narrative-coach-run')).disabled, true); } finally { await none.close(); }
  const failed = await mount({ answers: { deckReady: async () => { throw new Error('down'); } } });
  try {
    assert.match(failed.text(failed.by('deck-ready-error')), /could not be read/);
    assert.equal(failed.text(failed.by('deck-ready-head')), 'Deck ready to send', 'never a tick for an unread deck');
  } finally { await failed.close(); }
});
