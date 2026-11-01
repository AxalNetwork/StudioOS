/**
 * D1604 (#3716, pd0, pd3, pd13) — the editor's simplified chrome.
 *
 *   · the header holds the save state, ⋯, ▶ Present, Share ▾ and Ask, and
 *     nothing else; Save version renders only while there is something to
 *     save; a reader keeps Present and has no Share; the tablet keeps the same
 *     row and a phone moves Share's two items into ⋯;
 *   · ⋯ lists its three sections; an item whose route is not on main reads
 *     the adapter (greyed, "Coming later", titled with its reason, still
 *     focusable); items off for AI count into the name ", N off: <why>";
 *   · Share ▾ opens the existing ShareDialog and ExportDialog; ⋯ opens the
 *     sheets that keep v1's surfaces: Versions, Sources and coverage, Check
 *     claims, Theme and Brand kit, Structure and Background;
 *   · the old editor bar, its right panel and its tabs are gone.
 *
 * The owner's rule: Present, Share and Ask stay visible; everything else goes
 * in ⋯. Every venture, card and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import DeckToolbar from '../src/pages/raise/pitch/DeckToolbar.jsx';
import CardsStrip, { cardMenuItems } from '../src/pages/raise/pitch/CardsStrip.jsx';
import { availability } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { EDITOR_WAITING, MORE_MENU, MORE_NAME, SAVED, UNSAVED, moreName, moreState, saveChip } from '../src/pages/raise/pitch/deckV2Model.js';
import { presentHref } from '../src/pages/raise/pitch/presentExportModel.js';
import { ADMIN, mountEditor } from './_pitch_editor_mount.mjs';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

test('the save state: ✓ Saved with its time, ● Unsaved changes with Save version, and a reader\'s line', () => {
  assert.deepEqual(saveChip({ dirty: false, when: 'Saved · 2 min ago' }), { text: SAVED, title: 'All changes saved · 2 min ago', save: false });
  assert.equal(saveChip({ dirty: false, when: 'Saved · v3' }).title, 'All changes saved', 'no time recorded: no time drawn');
  assert.deepEqual(saveChip({ dirty: true, when: 'Unsaved changes' }).save, true);
  assert.equal(saveChip({ dirty: true }).text, UNSAVED);
  assert.deepEqual([saveChip({ readOnly: true, dirty: true, version: 3 }).text, saveChip({ readOnly: true, version: 3 }).save], ['Read only · v3', false]);
});

test('⋯: three sections; adapter items are Coming later with the adapter\'s reason; AI-off items count into the name', () => {
  assert.deepEqual(MORE_MENU.map((s) => s.label), ['This deck', 'This card', 'Whole deck · uses AI']);
  const all = MORE_MENU.flatMap((s) => s.items);
  // D1499 (#3749): Slide size is wired on main, a theme write held until a version is saved.
  for (const id of ['theme', 'size', 'brand', 'sources', 'versions', 'save_named', 'structure', 'duplicate', 'appendix', 'background', 'check']) {
    assert.ok(all.find((i) => i.id === id && !i.adapter), `${id} is wired on main`);
  }
  for (const [id, adapter] of [['stage', 'stagePlan'], ['reorder', 'deckActions'], ['remix', 'remix'], ['hide', 'media'], ['section', 'media'], ['replace_images', 'deckActions'], ['critique', 'critique']]) {
    assert.equal(all.find((i) => i.id === id).adapter, adapter, id);
  }
  assert.equal(MORE_MENU[0].items.findIndex((i) => i.id === 'reorder') >= 0, true, 'Reorder for stage sits under This deck');
  const on = moreState(MORE_MENU, { availability });
  const stage = on.sections[0].items.find((i) => i.id === 'stage');
  assert.deepEqual([stage.disabled, stage.later, stage.why], [true, true, 'Not switched on yet.']);
  assert.equal(on.off, 0, 'nothing wired runs a model today, so nothing is off');
  assert.equal(moreName(on.off, on.why), MORE_NAME);
  const read = moreState(MORE_MENU, { readOnly: true, availability });
  assert.equal(read.sections[0].items.find((i) => i.id === 'theme').why, 'Read only');
  assert.equal(read.sections[0].items.find((i) => i.id === 'versions').disabled, false, 'a reader still reads Versions');
  // An item that runs a model, wired: off with AI paused, counted, and named.
  const synthetic = [{ id: 'x', label: 'X', items: [{ id: 'ai1', label: 'Synthetic AI item', ai: true }, { id: 'plain', label: 'Plain' }] }];
  const off = moreState(synthetic, { aiOn: false });
  assert.equal(off.off, 1);
  assert.equal(moreName(off.off, off.why), 'More deck actions, 1 off: AI is paused');
  assert.equal(moreState(synthetic, { outOfTokens: true }).why, 'out of AI tokens');
  assert.equal(off.sections[0].items[1].disabled, false);
});

test('the seam: an item is Coming later only while its adapter surface answers unavailable', () => {
  const on = () => ({ available: true, value: null });
  const st = moreState(MORE_MENU, { availability: on });
  const stage = st.sections[0].items.find((i) => i.id === 'stage');
  assert.deepEqual([stage.disabled, Boolean(stage.later), stage.why], [false, false, null], 'merged: wired like any other item');
  const crit = st.sections[2].items.find((i) => i.id === 'critique');
  assert.deepEqual([crit.disabled, Boolean(crit.later)], [false, false]);
  const paused = moreState(MORE_MENU, { availability: on, aiOn: false });
  assert.equal(paused.sections[2].items.find((i) => i.id === 'critique').why, 'AI is paused for your studio.', 'once wired, AI paused greys it like any AI item');
  assert.equal(paused.off, 2, 'and it counts into the name');
  assert.equal(moreState(MORE_MENU, { availability: () => ({ available: false, reason: 'Synthetic reason.' }) }).sections[0].items[0].why, 'Synthetic reason.');
  // The card ⋯ reads the same seam.
  const later = cardMenuItems(1, 3, {}, availability).find((i) => i.id === 'hide');
  assert.deepEqual([later.later, later.why], [true, 'Not switched on yet.']);
  const merged = cardMenuItems(1, 3, {}, on).find((i) => i.id === 'hide');
  assert.deepEqual([merged.later, merged.why], [false, null]);
  assert.equal(cardMenuItems(0, 3, {}, on).find((i) => i.id === 'up').why, 'It is the first card.');
});

test('while the editor is not on screen, the ⋯ items it carries out wait; Share\'s stay live', () => {
  const st = moreState([{ id: 'share', label: 'Share', items: [{ id: 'share', label: 'Share link…' }, { id: 'export', label: 'Export…' }] }, ...MORE_MENU], { availability, waiting: EDITOR_WAITING });
  assert.deepEqual(st.sections[0].items.map((i) => i.disabled), [false, false]);
  assert.equal(st.sections[1].items.find((i) => i.id === 'versions').why, EDITOR_WAITING);
  assert.equal(st.sections[1].items.find((i) => i.id === 'stage').why, 'Not switched on yet.', 'an adapter item keeps its own reason');
});

/* ------------------------------------------------------------------ *
 * The header, mounted
 * ------------------------------------------------------------------ */

const controls = (m, root) => m.walk(root)
  .filter((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && !m.walk(root).some((p) => p !== n && m.pr(p)['data-testid'] === 'deck-more-menu' && m.walk(p).includes(n)))
  .map((n) => String(m.pr(n)['aria-label'] || m.text(n)).replace(/ \d+ waiting$/, ''));

test('the header holds the save state, ⋯, Present, Share and Ask, and nothing else; Save version only while dirty', async () => {
  const m = await mountEditor();
  try {
    const tools = m.by('pitch-header-tools');
    assert.deepEqual(controls(m, tools), [MORE_NAME, 'Present', 'Share', 'Ask Eadwyn']);
    assert.match(m.text(m.by('pitch-editor-save-state')), /^✓ Saved$/);
    assert.match(m.pr(m.by('pitch-editor-save-state')).title, /^All changes saved · \d+ d ago$/, 'the version\'s own time, in the title');
    assert.equal(m.pr(m.by('deck-more-open'))['aria-haspopup'], 'menu');
    assert.equal(m.pr(m.by('deck-toolbar-present')).href, presentHref(7, 31));
    assert.ok(!m.by('pitch-editor-save'), 'nothing to save: no Save version');
    await m.press(m.by('pitch-editor-block-b2'));
    await m.type(m.by('pitch-editor-notes'), 'Synthetic changed note');
    assert.match(m.text(m.by('pitch-editor-save-state')), /^● Unsaved changes$/);
    assert.deepEqual(controls(m, m.by('pitch-header-tools')), ['Save version', MORE_NAME, 'Present', 'Share', 'Ask Eadwyn']);
    await m.press(m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-changes')), /the speaker notes change/);
  } finally { await m.close(); }
});

test('⋯ draws its three sections; an adapter item is greyed, reachable, titled, and does nothing', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-more-open'));
    const menu = m.by('deck-more-menu');
    assert.equal(m.pr(menu).role, 'menu');
    assert.deepEqual(['deck', 'card', 'ai'].map((s) => m.pr(m.by(`deck-more-section-${s}`))['aria-label']), ['This deck', 'This card', 'Whole deck · uses AI']);
    const stage = m.by('deck-more-stage');
    assert.equal(m.pr(stage)['aria-disabled'], true);
    assert.equal(m.pr(stage).disabled, undefined, 'still focusable, so the reason is read out');
    assert.equal(m.pr(stage).title, 'Not switched on yet.');
    assert.match(m.text(stage), /Coming later/);
    assert.doesNotMatch(m.text(menu), /#\d{4}/, 'no issue number in the UI');
    await m.press(stage);
    assert.ok(m.by('deck-more-menu'), 'an adapter item does nothing');
    assert.match(m.text(m.by('deck-more-check')), /Check claims · Free checks/);
  } finally { await m.close(); }
});

test('Share ▾ opens the existing Share and Export dialogs', async () => {
  const m = await mountEditor();
  try {
    await m.press(m.by('deck-toolbar-share'));
    assert.equal(m.pr(m.by('deck-toolbar-share'))['aria-expanded'], true);
    assert.deepEqual(['share', 'export'].map((id) => m.text(m.by(`deck-toolbar-item-${id}`))), ['Share link…', 'Export…']);
    await m.press(m.by('deck-toolbar-item-export'));
    assert.ok(!m.by('deck-toolbar-share-menu'), 'the menu closes');
    assert.ok(m.by('pitch-export-dialog'), 'ExportDialog');
    assert.ok(m.calls.some((c) => c[0] === 'deckExportList' && c[1] === 31), 'it reads the export ledger of the version on screen');
    await m.fire(m.by('pitch-export-dialog'), 'onClose');
    await m.press(m.by('deck-toolbar-share'));
    await m.press(m.by('deck-toolbar-item-share'));
    assert.ok(m.by('pitch-share-dialog'), 'ShareDialog, for the current version');
  } finally { await m.close(); }
});

test('⋯ opens the sheets that keep v1\'s surfaces: Versions, Sources, Check claims, Theme, Brand kit, Structure, Background', async () => {
  const m = await mountEditor();
  try {
    const open = async (id) => { await m.press(m.by('deck-more-open')); await m.press(m.by(`deck-more-${id}`)); };
    await open('versions');
    assert.ok(m.by('pitch-sheet-versions'));
    assert.ok(m.by('pitch-studio-versions'), 'the studio\'s Versions table');
    assert.ok(m.by('pitch-studio-compare-30'), 'Compare an older version');
    await m.press(m.by('pitch-studio-compare-30'));
    assert.ok(m.walk(m.by('pitch-sheet-versions')).some((x) => /pitch-compare/.test(String(m.pr(x)['data-testid'] || ''))), 'VersionCompare in the sheet');
    await m.fire(m.by('pitch-sheet-versions'), 'onClose');
    for (const [id, sheet] of [['sources', 'pitch-sheet-sources'], ['check', 'pitch-sheet-check'], ['brand', 'pitch-sheet-brand'], ['structure', 'pitch-sheet-structure'], ['background', 'pitch-sheet-background']]) {
      await open(id);
      assert.ok(m.by(sheet), id);
    }
    assert.ok(m.calls.some((c) => c[0] === 'check.read' && c[1] === 31), 'the Check panel reads the version on screen');
    await open('theme');
    assert.ok(m.by('pitch-sheet-theme'));
    await m.type(m.by('pitch-theme-neutral_dark'), true);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/, 'a theme is one edit, held until Save');
    await m.press(m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-changes')), /The theme becomes Neutral dark\./);
  } finally { await m.close(); }
});

test('This card from ⋯: Duplicate and Mark as appendix are local edits; Save as a named version names it', async () => {
  let saved = null;
  const m = await mountEditor({ answers: { deckUpdate: async (id, body) => { saved = body; return { id: 32, project_id: 7, version: 4, title: body.title, slides: body.slides }; } } });
  try {
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-duplicate'));
    assert.match(m.text(m.by('pitch-editor-cards')), /01 Synthetic traction.*02 Synthetic traction.*03 Synthetic second/);
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-more-appendix'));
    assert.match(m.text(m.by('pitch-editor-rail-1')), /Appendix/);
    await m.press(m.by('deck-more-open'));
    assert.match(m.text(m.by('deck-more-appendix')), /Not an appendix/);
    await m.press(m.by('deck-more-save_named'));
    await m.type(m.by('pitch-editor-save-name'), 'Synthetic seed deck');
    await m.press(m.by('pitch-editor-save-run'));
    assert.equal(saved.title, 'Synthetic seed deck');
    assert.equal(saved.slides.length, 3);
    assert.equal(saved.slides[1].appendix, true);
  } finally { await m.close(); }
});

test('a reader keeps Present and has no Share and no Save version', async () => {
  const m = await mountEditor({ user: ADMIN });
  try {
    assert.ok(m.by('deck-toolbar-present'));
    assert.ok(!m.by('deck-toolbar-share'));
    assert.ok(!m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-state')), /^Read only · v3$/);
    assert.deepEqual(controls(m, m.by('pitch-header-tools')), [MORE_NAME, 'Present'], 'a reader gets no Ask either');
  } finally { await m.close(); }
});

test('the model read fails: Present and Share stay in the header, and Export still opens', async () => {
  const m = await mountEditor({ answers: { 'editor.model': async () => { throw new Error('Synthetic model failure'); } } });
  try {
    assert.ok(m.by('pitch-editor-model-error'), 'the editor says it could not open');
    assert.deepEqual(controls(m, m.by('pitch-header-tools')), [MORE_NAME, 'Present', 'Share', 'Ask Eadwyn']);
    assert.equal(m.pr(m.by('deck-toolbar-present')).href, presentHref(7, 31));
    assert.ok(!m.by('pitch-editor-save-state'), 'no save state until the editor reports one');
    await m.press(m.by('deck-more-open'));
    assert.equal(m.pr(m.by('deck-more-versions'))['aria-disabled'], true);
    assert.equal(m.pr(m.by('deck-more-versions')).title, EDITOR_WAITING);
    await m.press(m.by('deck-more-open'));
    await m.press(m.by('deck-toolbar-share'));
    await m.press(m.by('deck-toolbar-item-export'));
    assert.ok(m.by('pitch-export-dialog'), 'ExportDialog, from the page');
    await m.fire(m.by('pitch-export-dialog'), 'onClose');
    await m.press(m.by('deck-toolbar-share'));
    await m.press(m.by('deck-toolbar-item-share'));
    assert.ok(m.by('pitch-share-dialog'), 'ShareDialog, from the page');
  } finally { await m.close(); }
});

test('the deck still reading: Present and Share are already there', async () => {
  let release;
  const m = await mountEditor({ answers: { deckGet: () => new Promise((r) => { release = r; }) } });
  try {
    assert.ok(m.by('pitch-editor-loading'));
    assert.ok(m.by('deck-toolbar-present') && m.by('deck-toolbar-share'));
  } finally { release?.(null); await m.close(); }
});

/* ------------------------------------------------------------------ *
 * The toolbar alone: the tablet and the phone
 * ------------------------------------------------------------------ */

async function toolbar(props, { focus = false } = {}) {
  const restore = installDocument('', { focus });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(DeckToolbar, props))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    by, pr,
    async key(node, key) { await act(async () => { pr(node).onKeyDown?.({ key, preventDefault() {} }); }); },
    async blur(node, relatedTarget) { await act(async () => { pr(node).onBlur?.({ relatedTarget }); }); },
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the tablet keeps all four; a phone moves Share\'s two items into ⋯', async () => {
  const picked = [];
  const chip = saveChip({ dirty: false, when: 'Saved · just now' });
  const t = await toolbar({ chip, presentTo: '/raise/pitch/present', onAction: (id) => picked.push(id) });
  try {
    assert.ok(t.by('deck-more-open') && t.by('deck-toolbar-present') && t.by('deck-toolbar-share'));
  } finally { await t.close(); }
  const p = await toolbar({ chip, presentTo: '/raise/pitch/present', phone: true, onAction: (id) => picked.push(id) });
  try {
    assert.ok(!p.by('deck-toolbar-share'), 'no Share ▾ on a phone');
    assert.ok(p.by('deck-toolbar-present'), 'Present stays');
    await p.press('deck-more-open');
    assert.equal(p.pr(p.by('deck-more-section-share'))['aria-label'], 'Share');
    await p.press('deck-more-export');
    assert.deepEqual(picked, ['export']);
  } finally { await p.close(); }
});

test('Share ▾ keeps a menu\'s keyboard: focus moves in, arrows move, Escape returns to Share, Tab out closes', async () => {
  const t = await toolbar({ chip: null, presentTo: '/raise/pitch/present', onAction: () => {} }, { focus: true });
  try {
    await t.press('deck-toolbar-share');
    const holder = t.by('deck-toolbar-share').parentNode;
    assert.equal(document.activeElement, t.by('deck-toolbar-item-share'), 'focus on the first item');
    await t.key(holder, 'ArrowDown');
    assert.equal(document.activeElement, t.by('deck-toolbar-item-export'));
    await t.key(holder, 'ArrowDown');
    assert.equal(document.activeElement, t.by('deck-toolbar-item-share'), 'it wraps');
    await t.key(holder, 'ArrowUp');
    assert.equal(document.activeElement, t.by('deck-toolbar-item-export'));
    await t.key(holder, 'Escape');
    assert.ok(!t.by('deck-toolbar-share-menu'), 'Escape closes');
    assert.equal(document.activeElement, t.by('deck-toolbar-share'), 'and returns to Share');
    await t.press('deck-toolbar-share');
    await t.blur(holder, t.by('deck-toolbar-present'));
    assert.ok(!t.by('deck-toolbar-share-menu'), 'Tab out to Present closes it');
    await t.press('deck-toolbar-share');
    await t.blur(holder, t.by('deck-toolbar-item-export'));
    assert.ok(t.by('deck-toolbar-share-menu'), 'a move inside keeps it open');
    await t.blur(holder, null);
    assert.ok(t.by('deck-toolbar-share-menu'), 'a blur to nothing (a press) is the press handler\'s');
    // ⋯ moves focus in on open too.
    await t.press('deck-more-open');
    assert.equal(document.activeElement, t.by('deck-more-stage'), 'the ⋯ menu\'s first item');
  } finally { await t.close(); }
});

async function strip(props) {
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const cards = [{ title: 'Synthetic one', blocks: [] }, { title: 'Synthetic two', blocks: [] }, { title: 'Synthetic three', blocks: [] }];
  const picked = [];
  await act(async () => { root.render(h(CardsStrip, { cards, sel: 0, stale: new Set(), readOnly: false, onSelect() {}, move() {}, onAdd() {}, onCardAction: (id, i) => picked.push([id, i]), ...props })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    by, pr, walk, picked,
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); },
    async key(node, key) { await act(async () => { pr(node).onKeyDown?.({ key, preventDefault() {} }); }); },
    async blur(node, relatedTarget) { await act(async () => { pr(node).onBlur?.({ relatedTarget }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('a card\'s ⋯ keeps a menu\'s keyboard, and its button closes it', async () => {
  const t = await strip({});
  try {
    await t.press('pitch-editor-card-menu-open-1');
    const menu = t.by('pitch-editor-card-menu-1');
    assert.equal(document.activeElement, t.by('pitch-editor-card-duplicate-1'), 'focus on the first item');
    await t.key(menu, 'ArrowDown');
    assert.equal(document.activeElement, t.by('pitch-editor-card-up-1'));
    await t.key(menu, 'End');
    assert.equal(document.activeElement, t.by('pitch-editor-card-section-1'), 'a Coming later item is still reached');
    await t.key(menu, 'Escape');
    assert.ok(!t.by('pitch-editor-card-menu-1'));
    assert.equal(document.activeElement, t.by('pitch-editor-card-menu-open-1'), 'Escape returns to the card\'s ⋯');
    await t.press('pitch-editor-card-menu-open-1');
    await t.blur(t.by('pitch-editor-card-menu-1'), t.by('pitch-editor-card-menu-open-1'));
    assert.ok(t.by('pitch-editor-card-menu-1'), 'focus on its own button is not leaving');
    await t.press('pitch-editor-card-menu-open-1');
    assert.ok(!t.by('pitch-editor-card-menu-1'), 'its button closes it');
    await t.press('pitch-editor-card-menu-open-1');
    await t.blur(t.by('pitch-editor-card-menu-1'), t.by('pitch-editor-rail-2'));
    assert.ok(!t.by('pitch-editor-card-menu-1'), 'Tab out closes it');
  } finally { await t.close(); }
});

test('a tablet (768–1023 px) keeps the Grid with the strip as one scrolling row above it, and a card\'s ⋯ opens under it', async () => {
  const row = await strip({ orientation: 'row' });
  try {
    const list = row.by('pitch-editor-cards-list');
    assert.equal(row.pr(row.by('pitch-editor-cards'))['data-orientation'], 'row');
    assert.match(row.pr(list).className, /\bflex-row\b.*\boverflow-x-auto\b/);
    const li = row.by('pitch-editor-rail-0').parentNode;
    assert.match(row.pr(li).className, /\bw-\[120px\] shrink-0\b/, 'fixed-width thumbnails');
    await row.press('pitch-editor-card-menu-open-1');
    const menu = row.by('pitch-editor-card-menu-1');
    assert.ok(!row.walk(list).includes(menu), 'outside the scrolling row, so it is not clipped');
    assert.match(row.pr(menu).className, /\btop-full\b/);
    assert.doesNotMatch(row.pr(menu).className, /\bleft-full\b/);
    assert.equal(document.activeElement, row.by('pitch-editor-card-duplicate-1'));
  } finally { await row.close(); }
  const col = await strip({});
  try {
    assert.match(col.pr(col.by('pitch-editor-cards-list')).className, /\bflex-col\b/);
    await col.press('pitch-editor-card-menu-open-1');
    assert.match(col.pr(col.by('pitch-editor-card-menu-1')).className, /\bleft-full\b/, 'beside the 150 px strip');
  } finally { await col.close(); }
  // A 768 tablet: the Grid editor, the row strip and the desktop header (pd9l, plan §8).
  const before = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: q === '(max-width: 1023px)', addEventListener() {}, removeEventListener() {} });
  const m = await mountEditor();
  try {
    assert.ok(!m.by('pitch-editor-phone'), 'not the phone editor');
    assert.ok(m.by('pitch-editor-stage'), 'The Grid is the centre');
    assert.equal(m.pr(m.by('pitch-editor-cards'))['data-orientation'], 'row');
    assert.doesNotMatch(m.pr(m.by('pitch-editor-body')).className, /grid-cols/, 'the strip sits above the stage, the stage full width');
    assert.deepEqual(controls(m, m.by('pitch-header-tools')), [MORE_NAME, 'Present', 'Share', 'Ask Eadwyn'], 'the desktop header');
  } finally { await m.close(); globalThis.matchMedia = before; }
  // A phone (below 768 px) keeps the phone editor.
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const p = await mountEditor();
  try {
    assert.ok(p.by('pitch-editor-phone'));
    assert.ok(!p.by('deck-toolbar-share'), 'Share\'s items live in ⋯ on a phone');
  } finally { await p.close(); globalThis.matchMedia = before; }
  const wide = await mountEditor();
  try {
    assert.equal(wide.pr(wide.by('pitch-editor-cards'))['data-orientation'], 'column');
  } finally { await wide.close(); }
});

test('the source: the old editor bar, right panel and tabs are gone, and the header is the only chrome', () => {
  const editor = codeOnly(read('PitchEditor.jsx'));
  for (const gone of ['pitch-editor-bar', 'RightPanel', 'role="tablist"', 'pitch-editor-tab-', 'CALLOUTS', 'markFirstRunSeen']) assert.ok(!editor.includes(gone), gone);
  assert.match(editor, /<DeckToolbar chip=\{chrome\?\.chip \?\? null\} presentTo=\{presentHref\(projectId, current\.id\)\}/);
  assert.match(read('PitchPage.jsx'), /\{tools\}\n\s+\{ask && !ask\.readOnly && ask\.projectId != null \? <div className="shrink-0" data-testid="pitch-header-ask"><DeckAsk \{\.\.\.ask\} \/><\/div> : null\}/);
  for (const f of ['DeckToolbar.jsx', 'DeckMoreMenu.jsx', 'DeckSheets.jsx', 'CardsStrip.jsx', 'GridStage.jsx', 'BlockTools.jsx']) {
    const src = read(f);
    assert.doesNotMatch(codeOnly(src), /\bFill\b/, `${f}: Ask, never Fill`);
    assert.doesNotMatch(src, /fetch\(|request\(/, `${f}: no network of its own`);
  }
});
