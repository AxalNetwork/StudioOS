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
import { availability } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { MORE_MENU, MORE_NAME, SAVED, UNSAVED, moreName, moreState, saveChip } from '../src/pages/raise/pitch/deckV2Model.js';
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
  for (const id of ['theme', 'brand', 'sources', 'versions', 'save_named', 'structure', 'duplicate', 'appendix', 'background', 'check']) {
    assert.ok(all.find((i) => i.id === id && !i.adapter), `${id} is wired on main`);
  }
  for (const [id, adapter] of [['stage', 'stagePlan'], ['size', 'grid'], ['reorder', 'deckActions'], ['remix', 'remix'], ['hide', 'media'], ['section', 'media'], ['replace_images', 'deckActions'], ['critique', 'critique']]) {
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

/* ------------------------------------------------------------------ *
 * The toolbar alone: the tablet and the phone
 * ------------------------------------------------------------------ */

async function toolbar(props) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(DeckToolbar, props))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    by, pr,
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
