// D1604 (#3716, pd40) — the Pitch deck studio's header Ask. "Ask", named "Ask
// Eadwyn", never "Fill"; ", N waiting" only for a count that was read; the
// sheet "Waiting for you" has no input and decides each proposal with Accept or
// Discard on the routes that exist; the editor places an accepted edit and
// holds it until Save; a reader has no Ask. Team's button is the same one.
// Every venture, card and proposal is synthetic.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_v2_ask_d1604.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { railProposalsApi } from '../src/lib/api/railProposals.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import { AskButtonView, askButtonName } from '../src/ui/AskButton.jsx';
import { AskButtonView as TeamAskButtonView } from '../src/pages/team/AskButton.jsx';
import DeckAsk from '../src/pages/raise/pitch/DeckAsk.jsx';
import PitchEditor from '../src/pages/raise/pitch/PitchEditor.jsx';
import { FIRST_RUN_KEY } from '../src/pages/raise/pitch/editorModel.js';
import {
  ASK_UNREADABLE, DECK_ASK_OPTIONS, WAITING_TITLE, askAreaName, askName, cardEdit, placeTextEdit, waitingCount,
} from '../src/pages/raise/pitch/deckV2Model.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const PITCH = 'frontend/src/pages/raise/pitch';
const render = (el) => renderToStaticMarkup(el);

// ---------------------------------------------------------------- the button

test('the button reads "Ask", its accessible name "Ask Eadwyn", with ", N waiting" only for a counted N', () => {
  const rest = render(h(AskButtonView, {}));
  assert.match(rest, /aria-label="Ask Eadwyn"/);
  assert.equal(renderedText(rest).trim(), 'Ask');
  assert.match(rest, /max-sm:min-h-\[44px\]/, 'the word on a phone, at 44px');
  const two = render(h(AskButtonView, { waiting: 2 }));
  assert.match(two, /aria-label="Ask Eadwyn, 2 waiting"/);
  assert.match(renderedText(two), /Ask\s*2 waiting/);
  for (const waiting of [0, null, undefined, -1, 1.5, '3']) {
    const html = render(h(AskButtonView, { waiting }));
    assert.match(html, /aria-label="Ask Eadwyn"/, String(waiting));
    assert.doesNotMatch(renderedText(html), /waiting/, `${waiting}: an unread or zero count draws nothing, never "0 waiting"`);
  }
  assert.equal(askButtonName(3), 'Ask Eadwyn, 3 waiting');
  for (const n of [0, 1, 4, null]) assert.equal(askName(n), askButtonName(n), 'the model and the button agree');
  assert.equal(askAreaName(1), 'Ask Eadwyn about this area');
  assert.equal(askAreaName(3), 'Ask Eadwyn about these 3 areas');
});

test('pd40 states: running, AI off, unreadable and out of tokens keep the name "Ask Eadwyn"', () => {
  const running = render(h(AskButtonView, { state: 'running', waiting: 1 }));
  assert.match(running, /Asking…/);
  assert.match(running, /animate-spin/);
  const off = render(h(AskButtonView, { state: 'off' }));
  assert.match(off, /aria-label="Ask Eadwyn"/, 'owner question H: the name stays');
  assert.match(off, /grayscale/);
  assert.doesNotMatch(off, /from your sources/);
  const out = render(h(AskButtonView, { state: 'out', sub: 'The included AI allowance and top-up balance cannot cover this run.' }));
  assert.match(out, /data-testid="ask-eadwyn-out"/);
  const describedBy = /aria-describedby="([^"]+)"/.exec(out)?.[1];
  assert.ok(describedBy, 'the sub-line describes the button');
  assert.match(out, new RegExp(`id="${describedBy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>The included AI allowance`));
  assert.doesNotMatch(render(h(AskButtonView, {})), /aria-describedby/);
});

test('a muted Ask (AI off, unreadable) carries the muted text colour only, never the violet one under it', () => {
  const cls = (state) => /<button[^>]*class="([^"]+)"/.exec(render(h(AskButtonView, { state })))[1].split(/\s+/);
  for (const state of ['off', 'unreadable']) {
    const c = cls(state);
    assert.ok(c.includes('text-axal-muted') && c.includes('dark:text-gray-400'), `${state}: muted`);
    assert.ok(!c.includes('text-axal-violet-deep') && !c.includes('dark:text-violet-300'), `${state}: two text colours stacked; the CSS order, not the state, would pick one`);
  }
  for (const state of ['rest', 'running', 'out']) {
    const c = cls(state);
    assert.ok(c.includes('text-axal-violet-deep') && c.includes('dark:text-violet-300'), `${state}: violet`);
    assert.ok(!c.includes('text-axal-muted'), state);
  }
});

test('Team re-imports the shared button: one component, one name', () => {
  assert.equal(TeamAskButtonView, AskButtonView);
  assert.match(read('frontend/src/pages/team/AskButton.jsx'), /from '\.\.\/\.\.\/ui\/AskButton\.jsx'/);
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/team/AskButton.jsx')), /<button/);
  assert.match(read('frontend/src/ui/README.md'), /AskButton\.jsx/);
});

// ---------------------------------------------------------------- the model

const row = (uid, payload, extra = {}) => ({ uid, rail_option: 'deck:rewrite', status: 'proposed', created_at: '2026-10-31 10:00:00', payload, ...extra });

test('a waiting card edit is this deck\'s open proposal, read from its rail row', () => {
  const text = cardEdit(row('u1', { deck_id: 31, card: 2, action: 'shorten', before: 'Old', after: 'New' }), 31);
  assert.deepEqual({ ...text, at: undefined }, { uid: 'u1', option: 'deck:rewrite', card: 2, action: 'shorten', what: 'Shorter', at: undefined, kind: 'text', before: 'Old', after: 'New' });
  const block = cardEdit(row('u2', { deck_id: 31, card: 0, action: 'timeline', block: { kind: 'chart' }, title: 'Synthetic milestones' }), 31);
  assert.equal(block.kind, 'block');
  assert.deepEqual(block.size, { cols: 12, rows: 2 });
  assert.equal(cardEdit(row('u3', { deck_id: 30, card: 0, action: 'rewrite', after: 'x' }), 31), null, 'another version\'s');
  assert.equal(cardEdit(row('u4', { deck_id: 31, card: 0, action: 'rewrite', after: 'x' }, { status: 'accepted' }), 31), null, 'decided');
  assert.equal(cardEdit(row('u5', { deck_id: 31, card: -1, action: 'rewrite', after: 'x' }), 31), null);
  assert.equal(cardEdit(row('u6', { deck_id: 31, card: 0, action: 'rewrite', after: '  ' }), 31), null);
  assert.equal(cardEdit(row('u7', { deck_id: 31, card: 0, action: 'chart' }), 31), null, 'a chart with no block');
  assert.deepEqual(DECK_ASK_OPTIONS.slice(0, 3), ['deck:rewrite', 'deck:shorten', 'deck:expand']);
});

test('the count is null when any read failed, never 0', () => {
  assert.equal(waitingCount({ deck: { status: 'ready', proposal: { id: 1 } }, edits: { status: 'ready', items: [{}, {}] } }), 3);
  assert.equal(waitingCount({ deck: { status: 'ready', proposal: null }, edits: { status: 'ready', items: [] } }), 0);
  assert.equal(waitingCount({ deck: { status: 'unreadable' }, edits: { status: 'ready', items: [{}] } }), null);
  assert.equal(waitingCount({ deck: { status: 'ready', proposal: { id: 1 } }, edits: { status: 'unreadable', items: [] } }), null);
  assert.equal(waitingCount({ deck: { status: 'loading' }, edits: { status: 'loading', items: [] } }), null);
});

test('a text edit lands only on the block whose text is still its "before"', () => {
  const cards = [{ blocks: [{ id: 'b1', kind: 'text', text: 'Old words' }, { id: 'b2', kind: 'text', text: 'Other' }] }];
  const ok = placeTextEdit(cards, { card: 0, before: 'Old words', after: 'New words' });
  assert.equal(ok.blockId, 'b1');
  assert.deepEqual(ok.card.blocks.map((b) => b.text), ['New words', 'Other']);
  assert.equal(cards[0].blocks[0].text, 'Old words', 'nothing mutated');
  assert.match(placeTextEdit(cards, { card: 0, before: 'Changed', after: 'x' }).error, /changed since Eadwyn proposed this/);
  assert.match(placeTextEdit(cards, { card: 4, before: 'x', after: 'y' }).error, /no longer in this deck/);
});

// ---------------------------------------------------------------- DeckAsk, mounted

function fakeSource({ versions, lists = {}, failList = false, failDecide = false } = {}) {
  const calls = [];
  return {
    calls,
    versions: async (pid) => { calls.push(['versions', pid]); if (versions instanceof Error) throw versions; return versions; },
    discardDeck: async (id) => { calls.push(['discardDeck', id]); return {}; },
    proposals: {
      list: async (q) => { calls.push(['list', q]); if (failList) throw Object.assign(new Error('boom'), { status: 500 }); return { proposals: lists[q.option] || [] }; },
      decide: async (uid, decision) => { calls.push(['decide', uid, decision]); if (failDecide) throw Object.assign(new Error('gone'), { status: 409 }); return { proposal: { uid } }; },
    },
  };
}

async function mount(element) {
  const restore = installDocument();
  __resetAssistModeForTest();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  return {
    container,
    async render(el) { await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/pitch?project_id=7'] }, el)); }); await settle(); },
    walk(n = container) { const w = (x) => [x, ...(x.childNodes || []).flatMap(w)]; return w(n); },
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await this.pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    pr: (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {},
    by(id) { return this.walk().find((n) => this.pr(n)['data-testid'] === id); },
    all(id) { return this.walk().filter((n) => this.pr(n)['data-testid'] === id); },
    text(n = container) { const t = (x) => (!x ? '' : x.nodeType === 3 ? x.textContent || '' : x.childNodes?.length ? x.childNodes.map(t).join(' ') : x.textContent || ''); return t(n).replace(/\s+/g, ' ').trim(); },
    tags() { return this.walk().map((n) => String(n.tagName || '').toLowerCase()); },
    async close() { await act(async () => root.unmount()); restore(); __resetAssistModeForTest(); },
    element,
  };
}

const VERSIONS = { versions: [{ id: 30, version: 2, is_current: false }, { id: 31, version: 3, is_current: true }], proposal: { id: 77, slides: [{}, {}, {}] } };
const EDITS = {
  'deck:shorten': [row('e1', { deck_id: 31, card: 1, action: 'shorten', before: 'Synthetic long line', after: 'Synthetic line' }, { rail_option: 'deck:shorten' })],
  'deck:chart': [row('e2', { deck_id: 31, card: 0, action: 'chart', block: { kind: 'chart', series: [] }, title: 'Synthetic revenue' }, { rail_option: 'deck:chart' }),
    row('e3', { deck_id: 30, card: 0, action: 'chart', block: { kind: 'chart' } }, { rail_option: 'deck:chart' })],
};

test('the count is the deck proposal plus this version\'s card edits, read per deck option for this deck', async () => {
  const source = fakeSource({ versions: VERSIONS, lists: EDITS });
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source }));
    const button = m.by('pitch-ask');
    assert.equal(m.pr(button)['aria-label'], 'Ask Eadwyn, 3 waiting');
    assert.equal(m.text(m.by('pitch-ask-waiting')), '3 waiting');
    const lists = source.calls.filter((c) => c[0] === 'list').map((c) => c[1]);
    assert.deepEqual(lists.map((q) => q.option), DECK_ASK_OPTIONS);
    assert.ok(lists.every((q) => q.record === 'deck:31' && q.status === 'proposed'), 'the current version only, open proposals only');
  } finally { await m.close(); }
});

test('with the page\'s own versions read, Ask never reads it again; a deck decision asks the page to', async () => {
  const source = fakeSource({ versions: new Error('Ask must not read the versions itself'), lists: EDITS });
  let changed = 0;
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, versions: { status: 'ok', data: VERSIONS }, onChanged: () => { changed += 1; }, source }));
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn, 3 waiting');
    assert.deepEqual(source.calls.filter((c) => c[0] === 'versions'), []);
    await m.press(m.by('pitch-ask'));
    await m.press(m.all('pitch-ask-edit-discard')[0]);
    assert.equal(changed, 0, 'a card edit leaves the page\'s reads alone');
    await m.press(m.by('pitch-ask-deck-discard'));
    assert.equal(changed, 1);
    await m.render(h(DeckAsk, { projectId: 7, versions: { status: 'error', data: null }, source }));
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn', 'the page\'s failed read draws no count');
  } finally { await m.close(); }
});

test('a failed read draws no count and says Eadwyn could not be reached; never "0 waiting"', async () => {
  for (const source of [fakeSource({ versions: new Error('down') }), fakeSource({ versions: VERSIONS, failList: true })]) {
    const m = await mount();
    try {
      await m.render(h(DeckAsk, { projectId: 7, source }));
      assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn');
      assert.ok(!m.by('pitch-ask-waiting'));
      assert.equal(m.text(m.by('pitch-ask-sub')), ASK_UNREADABLE);
      assert.doesNotMatch(m.text(), /0 waiting/);
    } finally { await m.close(); }
  }
  // Nothing waiting, read: the plain name, no pill, no sub-line.
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source: fakeSource({ versions: { versions: [{ id: 31, is_current: true }] } }) }));
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn');
    assert.ok(!m.by('pitch-ask-waiting') && !m.by('pitch-ask-sub'));
    await m.press(m.by('pitch-ask'));
    assert.ok(m.by('pitch-ask-none'));
  } finally { await m.close(); }
});

test('"Waiting for you": no input, no thread; Review and Discard for the deck, on the routes that exist', async () => {
  const source = fakeSource({ versions: VERSIONS, lists: EDITS });
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source }));
    await m.press(m.by('pitch-ask'));
    const sheet = m.by('pitch-ask-sheet');
    assert.ok(sheet);
    assert.match(m.text(sheet), new RegExp(WAITING_TITLE));
    const tags = m.tags();
    for (const t of ['input', 'textarea', 'select']) assert.ok(!tags.includes(t), `the sheet has a ${t}`);
    assert.ok(!m.walk().some((n) => m.pr(n).contentEditable || m.pr(n).role === 'textbox'), 'no composer');
    assert.equal(m.pr(m.by('pitch-ask-review')).to ?? m.pr(m.by('pitch-ask-review')).href, '/raise/pitch/new?project_id=7&proposal=77');
    assert.equal(m.all('pitch-ask-edit').length, 2, 'the other version\'s edit is not listed');
    assert.match(m.text(m.all('pitch-ask-edit')[0]), /Card 1 · Chart from records/);
    assert.match(m.text(m.all('pitch-ask-edit')[1]), /Card 2 · Shorter/);
    // Away from the editor a card edit opens the editor; it is not accepted here.
    assert.ok(!m.by('pitch-ask-edit-accept'));
    assert.equal(m.all('pitch-ask-edit-open').length, 2);
    await m.press(m.all('pitch-ask-edit-discard')[1]);
    assert.deepEqual(source.calls.filter((c) => c[0] === 'decide'), [['decide', 'e1', 'discard']]);
    // No whole-deck Accept all: it would keep placeholder cards and skip the
    // theme, which the review's missing-data cut decides (plan §3.4).
    assert.ok(!m.by('pitch-ask-deck-accept'), 'the deck is accepted in Review only');
    assert.doesNotMatch(m.text(m.by('pitch-ask-deck')), /Accept/);
    await m.press(m.by('pitch-ask-deck-discard'));
    assert.deepEqual(source.calls.filter((c) => c[0] === 'discardDeck'), [['discardDeck', 77]]);
    // The verbs are the one set.
    assert.doesNotMatch(m.text(sheet), /\bInsert\b|Use this layout|Save as a version|\bFill\b/);
  } finally { await m.close(); }
});

test('the sheet never keeps a whole deck unreviewed: no keep-slides, no "all"', () => {
  const code = codeOnly(read(`${PITCH}/DeckAsk.jsx`));
  assert.doesNotMatch(code, /keepSlides|keep-slides'|all:\s*true/);
});

test('with a placer, Accept checks the edit fits, places it, then records the decision; a misfit records nothing', async () => {
  const source = fakeSource({ versions: VERSIONS, lists: EDITS });
  const placed = [];
  const order = [];
  const decide = source.proposals.decide;
  source.proposals.decide = async (...a) => { order.push('decide'); return decide(...a); };
  const onPlace = (edit) => (edit.uid === 'e2' ? { error: 'No free 6 × 3 range on card 1. Remove a block, then accept.' } : { commit: () => { order.push('place'); placed.push(edit.uid); return { undo() {} }; } });
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source, onPlace }));
    await m.press(m.by('pitch-ask'));
    const [chart, text] = m.all('pitch-ask-edit-accept');
    await m.press(chart);
    assert.deepEqual(source.calls.filter((c) => c[0] === 'decide'), [], 'a refused placement is not accepted');
    assert.match(m.text(m.all('pitch-ask-edit')[0]), /No free 6 × 3 range/);
    await m.press(text);
    assert.deepEqual(source.calls.filter((c) => c[0] === 'decide'), [['decide', 'e1', 'accept']]);
    assert.deepEqual(placed, ['e1']);
    assert.deepEqual(order, ['place', 'decide'], 'placed first, so a decision is never recorded for an edit that did not land');
    assert.ok(m.by('pitch-ask-accept-all'), 'Accept all with more than one edit');
  } finally { await m.close(); }
});

test('an edit that no longer fits when it is placed says so and records nothing; a refused decision takes the placement back', async () => {
  // The cards changed between the check and the placement.
  const late = fakeSource({ versions: VERSIONS, lists: { 'deck:shorten': EDITS['deck:shorten'] } });
  let m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source: late, onPlace: () => ({ commit: () => ({ error: 'Card 2 changed since Eadwyn proposed this. Select the area and ask again.' }) }) }));
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.deepEqual(late.calls.filter((c) => c[0] === 'decide'), [], 'not accepted on the server');
    assert.match(m.text(m.by('pitch-ask-edit')), /Card 2 changed since Eadwyn proposed this/, 'an error line, not a silent no-op');
  } finally { await m.close(); }
  // The server refuses the decision: the placed edit is taken back.
  const refused = fakeSource({ versions: VERSIONS, lists: { 'deck:shorten': EDITS['deck:shorten'] }, failDecide: true });
  const undone = [];
  m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source: refused, onPlace: (edit) => ({ commit: () => ({ undo: () => undone.push(edit.uid) }) }) }));
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.deepEqual(undone, ['e1']);
    assert.match(m.text(m.by('pitch-ask-edit')), /Accept Discard gone$/, 'the refusal is said on the edit');
  } finally { await m.close(); }
});

test('the edits are read again when the sheet opens and when the page says they changed', async () => {
  const source = fakeSource({ versions: VERSIONS, lists: {} });
  const reads = () => source.calls.filter((c) => c[0] === 'list').length;
  const EDITS_LATER = {};
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source, editsKey: 0 }));
    const first = reads();
    assert.equal(first, DECK_ASK_OPTIONS.length);
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn, 1 waiting');
    // A card run in the editor's own bar left a proposal: the next open lists it.
    source.calls.length = 0;
    Object.assign(EDITS_LATER, { 'deck:shorten': EDITS['deck:shorten'] });
    const lists = source.proposals.list;
    source.proposals.list = async (q) => { source.calls.push(['list', q]); return { proposals: EDITS_LATER[q.option] || [] }; };
    await m.press(m.by('pitch-ask'));
    assert.equal(reads(), DECK_ASK_OPTIONS.length, 'opening reads again');
    assert.equal(m.all('pitch-ask-edit').length, 1);
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn, 2 waiting');
    source.calls.length = 0;
    await m.render(h(DeckAsk, { projectId: 7, source, editsKey: 1 }));
    assert.equal(reads(), DECK_ASK_OPTIONS.length, 'the page\'s signal reads again');
    source.proposals.list = lists;
  } finally { await m.close(); }
});

test('AI paused: the name stays "Ask Eadwyn", the mark greys, and the sheet says what still works', async () => {
  const m = await mount();
  seedAssistModes({ raise: false });
  try {
    await m.render(h(DeckAsk, { projectId: 7, source: fakeSource({ versions: VERSIONS }) }));
    const button = m.by('pitch-ask');
    assert.equal(m.pr(button)['aria-label'], 'Ask Eadwyn, 1 waiting');
    assert.equal(m.pr(button)['data-state'], 'off');
    await m.press(button);
    assert.match(m.text(m.by('pitch-ask-off')), /Still works/);
    assert.ok(m.by('pitch-ask-deck-discard'), 'deciding what waits runs no model');
  } finally { await m.close(); }
});

test('a reader (read-only HQ) and a page with no venture get no Ask', async () => {
  assert.equal(render(h(MemoryRouter, null, h(DeckAsk, { projectId: 7, readOnly: true, source: fakeSource({ versions: VERSIONS }) }))), '');
  assert.equal(render(h(MemoryRouter, null, h(DeckAsk, { projectId: null, source: fakeSource({ versions: VERSIONS }) }))), '');
});

// ---------------------------------------------------------------- in the editor

const MODEL = { grid: { cols: 12, rows: 6 }, max_blocks: 24, notes_max: 4000, layouts: [{ id: 'statement', label: 'Statement', blocks: [] }], block_kinds: ['text', 'chart', 'metric'], chart_types: ['columns'], chart_ranges: ['all'], text_styles: ['heading', 'paragraph'], image_tags: [], video_ratios: [], audiences: ['seed_fund'], themes: ['brand'] };
const CARD = { title: 'Synthetic traction', layout: 'title', blocks: [{ id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Synthetic customers love it' }] };
const DECK = { id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: null, slides: [CARD] };
const FOUNDER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };
const ORIGINAL = { api: { ...api }, editor: { ...deckEditorApi }, sources: { ...deckSourcesApi }, images: { ...deckImagesApi }, proposals: { ...railProposalsApi } };

async function mountEditor({ before = 'Synthetic customers love it', user = FOUNDER, proposal = null, failDecide = false } = {}) {
  const decided = [];
  const discarded = [];
  let deckReads = 0;
  Object.assign(api, {
    getMe: async () => user, listProjects: async () => [{ id: 7, name: 'Synthetic Labs' }],
    deckListVersions: async () => ({ versions: [{ id: 31, version: 3, is_current: true }], ...(proposal && !discarded.length ? { proposal } : {}) }),
    deckGet: async () => { deckReads += 1; return DECK; },
    deckDiscardProposal: async (id) => { discarded.push(id); return {}; },
  });
  Object.assign(deckEditorApi, { model: async () => MODEL, brandKit: async () => ({ kit: null }), chartSeries: async () => ({ series: [] }) });
  Object.assign(deckSourcesApi, { list: async () => ({ project_id: 7, items: [], coverage: { slots: 0, filled: 0, by_grade: {}, not_recorded: 0, unreadable: 0 } }), refresh: async () => ({ rows: [] }) });
  deckImagesApi.list = async () => ({ images: [] });
  Object.assign(railProposalsApi, {
    list: async ({ option, record }) => ({ proposals: option === 'deck:shorten' && record === 'deck:31' && !decided.length ? [row('s1', { deck_id: 31, card: 0, action: 'shorten', before, after: 'Synthetic customers stay' }, { rail_option: 'deck:shorten' })] : [] }),
    decide: async (uid, decision) => { if (failDecide) throw Object.assign(new Error('not open'), { status: 409 }); decided.push([uid, decision]); return { proposal: { uid } }; },
  });
  const fetchBefore = globalThis.fetch;
  const m = await mount();
  globalThis.fetch = async () => Response.json({});
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem(FIRST_RUN_KEY, '1');
  await m.render(h(AuthProvider, null, h(PitchEditor)));
  const close = m.close.bind(m);
  m.close = async () => {
    await close(); globalThis.fetch = fetchBefore;
    Object.assign(api, ORIGINAL.api); Object.assign(deckEditorApi, ORIGINAL.editor); Object.assign(deckSourcesApi, ORIGINAL.sources);
    Object.assign(deckImagesApi, ORIGINAL.images); Object.assign(railProposalsApi, ORIGINAL.proposals);
  };
  m.decided = decided;
  m.discarded = discarded;
  m.deckReads = () => deckReads;
  return m;
}

test('in the editor, Accept places the waiting edit on its card and holds it until Save', async () => {
  const m = await mountEditor();
  try {
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn, 1 waiting');
    assert.ok(!m.by('pitch-editor-save'), 'nothing to save yet'); // D1604: Save version shows only while there is something to save
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.deepEqual(m.decided, [['s1', 'accept']]);
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers stay/);
    assert.ok(m.by('pitch-editor-save'), 'held until Save, like every edit');
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn', 'decided, so no longer waiting');
  } finally { await m.close(); }
});

test('in the editor, an edit whose card changed is refused before anything is recorded', async () => {
  const m = await mountEditor({ before: 'Words the card no longer has' });
  try {
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.deepEqual(m.decided, []);
    assert.match(m.text(m.by('pitch-ask-edit')), /changed since Eadwyn proposed this/);
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers love it/);
  } finally { await m.close(); }
});

test('in the editor, discarding the deck proposal from Ask keeps the unsaved card changes on screen', async () => {
  const m = await mountEditor({ proposal: { id: 77, slides: [{}, {}] } });
  try {
    const notes = () => m.by('pitch-editor-notes');
    await m.press(m.by('pitch-editor-block-b1'));
    await act(async () => { m.pr(notes()).onChange({ target: { value: 'Synthetic unsaved note' } }); });
    assert.ok(m.by('pitch-editor-save'), 'dirty');
    // An accepted card edit, held until Save, is unsaved work too.
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers stay/);
    const reads = m.deckReads();
    await m.press(m.by('pitch-ask-deck-discard'));
    assert.deepEqual(m.discarded, [77]);
    assert.ok(!m.by('pitch-editor-loading'), 'the editor never drops to its skeleton');
    assert.equal(m.deckReads(), reads, 'the open version is not read again, so the Editor is not remounted');
    await m.press(m.by('pitch-editor-block-b1'));
    assert.equal(m.pr(notes()).value, 'Synthetic unsaved note', 'the unsaved note survives');
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers stay/, 'the accepted edit survives');
    assert.ok(m.by('pitch-editor-save'));
    assert.ok(!m.by('pitch-ask-deck'), 'the discarded proposal is gone from the sheet');
  } finally { await m.close(); }
});

test('in the editor, a refused decision takes the placed edit back and says so', async () => {
  const m = await mountEditor({ failDecide: true });
  try {
    await m.press(m.by('pitch-ask'));
    await m.press(m.by('pitch-ask-edit-accept'));
    assert.match(m.text(m.by('pitch-editor-block-b1')), /Synthetic customers love it/, 'back as it was');
    assert.ok(!m.by('pitch-editor-save'), 'nothing left to save'); // D1604: Save version shows only while there is something to save
    assert.match(m.text(m.by('pitch-ask-edit')), /Accept Discard not open$/, 'the refusal is said on the edit');
  } finally { await m.close(); }
});

// ---------------------------------------------------------------- never Fill, one Ask

test('no new "Fill" on a pitch page, and exactly one control is named "Ask Eadwyn"', () => {
  const fill = /\bFill\b|Fill with Eadwyn|Fill from project/;
  for (const f of ['DeckAsk.jsx', 'PitchPage.jsx', 'deckV2Model.js', 'deckV2Adapter.js']) assert.doesNotMatch(codeOnly(read(`${PITCH}/${f}`)), fill, f);
  assert.doesNotMatch(codeOnly(read('frontend/src/ui/AskButton.jsx')), fill);
  // The v1 labels that remain go with the studio-home and New-deck steps (plan §11, 12 and 14); none may be added.
  const remaining = readdirSync(PITCH).filter((f) => f.endsWith('.jsx') && fill.test(codeOnly(read(`${PITCH}/${f}`)).replace(/import[^;]+;/g, '')));
  assert.deepEqual(remaining.sort(), ['NewDeck.jsx', 'StudioActions.jsx']);
  const named = readdirSync(PITCH).filter((f) => /\.jsx$/.test(f) && /aria-label="Ask Eadwyn"|aria-label=\{?['"`]Ask Eadwyn['"`]/.test(read(`${PITCH}/${f}`)));
  assert.deepEqual(named, [], 'the name comes from ui/AskButton.jsx only');
  assert.doesNotMatch(codeOnly(read(`${PITCH}/PitchPage.jsx`)), /EadwynButton/);
});
