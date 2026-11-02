/**
 * D1577 (#3824, deck v2 E4) — co-editing on the frontend.
 *
 *   1. presenceModel: avatars, "[N] editing", the outlined areas with "Wait or ask [Name]",
 *      cursors; nothing (never "0 editing") while presence is off or you are alone.
 *   2. The seam: presence answers through `deckCoeditApi.presence`; 503 `presence_off` is
 *      "Coming later" with the Worker's sentence, any other 503 stays "could not be read".
 *   3. The toolbar draws the editors only when there are others; the Studio home card and
 *      the stage read the same model.
 *   4. Restore one card: `compareCards` carries each card's uid, the dialog says only that
 *      card changes, and VersionCompare calls `POST /api/decks/:id/restore-card`.
 *   5. The client module is re-exported by one line in api.js's alphabetical block (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DeckToolbar from '../src/pages/raise/pitch/DeckToolbar.jsx';
import { AVATARS_MAX, avatarsOf, cursorsOn, editingLine, heldAreas, initialsOf, othersOf } from '../src/pages/raise/pitch/presenceModel.js';
import { SWAPPED, through } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { LATER } from '../src/pages/raise/pitch/deckV2Model.js';
import { compareCards, restoreCardDialog } from '../src/pages/raise/pitch/compareModel.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const ed = (id, over = {}) => ({ user_id: id, name: `Member ${id}`, colour: `#00000${id}`, card: null, area: null, cursor: null, ...over });

test('presenceModel: avatars and "[N] editing" for the others only; nothing while off or alone', () => {
  // Mutations checked: counting yourself twice, or answering "1 editing" alone, fails here.
  assert.equal(editingLine(null, 1), null, 'presence off: no line, never "0 editing"');
  assert.equal(editingLine([ed(1)], 1), null, 'alone');
  assert.equal(editingLine([ed(1), ed(2), ed(3)], 1), '3 editing');
  assert.equal(editingLine([ed(1), ed(2), { ...ed(2), card: 'c9' }], 1), '2 editing', 'one member\'s two tabs are one editor');
  assert.equal(othersOf(null, 1), null);
  assert.deepEqual([initialsOf('Ada Lovelace'), initialsOf('cher'), initialsOf(''), initialsOf(null), initialsOf('Jean Paul Sartre')], ['AL', 'CH', '?', '?', 'JS']);
  const many = avatarsOf([1, 2, 3, 4, 5, 6, 7].map((i) => ed(i)), 1);
  assert.deepEqual([many.shown.length, many.more], [AVATARS_MAX, 2]);
  assert.deepEqual(many.shown[0], { id: 2, initials: 'M2', colour: '#000002', name: 'Member 2' });
  assert.equal(avatarsOf([ed(1)], 1), null);
  assert.equal(avatarsOf([{ ...ed(2), name: null }], 1).shown[0].name, 'A member', 'never an address in place of a name');
});

test('presenceModel: an area another member is in is outlined with their name and "Wait or ask"; cursors on this card only', () => {
  const editors = [ed(1, { card: 'c1', area: 'b1' }), ed(2, { card: 'c1', area: 'b2', cursor: { x: 0.25, y: 0.5 } }), ed(3, { card: 'c2', area: 'b1', cursor: { x: 0.1, y: 0.1 } })];
  const held = heldAreas(editors, 1, 'c1');
  assert.deepEqual([...held.keys()], ['b2'], 'your own area is not outlined; another card\'s is not either');
  assert.deepEqual(held.get('b2'), { name: 'Member 2', colour: '#000002', label: 'Member 2 is editing this area', tooltip: 'Wait or ask Member 2' });
  assert.equal(heldAreas(editors, 1, null).size, 0);
  assert.deepEqual(cursorsOn(editors, 1, 'c1'), [{ id: 2, colour: '#000002', name: 'Member 2', left: '25%', top: '50%' }]);
  assert.deepEqual(cursorsOn(null, 1, 'c1'), []);
});

test('the seam: presence reads through deckCoeditApi; 503 presence_off is Coming later, with the Worker\'s sentence', async () => {
  assert.ok(SWAPPED.includes('presence'));
  const src = read('pages/raise/pitch/deckV2Adapter.js');
  assert.ok(src.includes('export const presence = (deckId) => through(() => deckCoeditApi.presence(deckId), SURFACES.presence.issue);'));
  const off = Object.assign(new Error('Seeing who else is editing is not switched on yet.'), { status: 503, code: 'presence_off' });
  const r = await through(() => Promise.reject(off), 3824);
  assert.deepEqual({ ...r }, { available: false, reason: 'Seeing who else is editing is not switched on yet.', issue: 3824 });
  assert.notEqual(r.reason, LATER.toLowerCase());
  const down = Object.assign(new Error('Service down'), { status: 503, code: 'upstream' });
  assert.equal((await through(() => Promise.reject(down), 3824)).unreadable, true, 'a 503 that is not a switch is unreadable, never empty');
  const ok = await through(() => Promise.resolve({ editors: [] }), 3824);
  assert.deepEqual(ok, { available: true, value: { editors: [] } });
});

async function toolbar(props) {
  const restore = installDocument('');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(DeckToolbar, { chip: null, onAction() {}, ...props }))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(text).join(''));
  return { by, text, async close() { await act(async () => root.unmount()); restore(); } };
}

test('the toolbar draws the other editors and "[N] editing" only when there are others', async () => {
  let m = await toolbar({ editors: null, youId: 1 });
  try { assert.equal(m.by('deck-toolbar-editors'), undefined, 'presence off: nothing drawn'); } finally { await m.close(); }
  m = await toolbar({ editors: [ed(1)], youId: 1 });
  try { assert.equal(m.by('deck-toolbar-editors'), undefined, 'alone: nothing drawn'); } finally { await m.close(); }
  m = await toolbar({ editors: [ed(1), ed(2), ed(3)], youId: 1 });
  try {
    assert.ok(m.by('deck-toolbar-editors'));
    assert.ok(m.by('deck-toolbar-editor-2') && m.by('deck-toolbar-editor-3') && !m.by('deck-toolbar-editor-1'));
    assert.equal(m.text(m.by('deck-toolbar-editing')), '3 editing: Member 2, Member 3');
  } finally { await m.close(); }
});

test('the stage, the editor and Studio home read the same model; the area claim is the selected one', () => {
  const stage = read('pages/raise/pitch/GridStage.jsx');
  for (const s of ['heldAreas(editors, youId, card?.uid ?? null)', 'cursorsOn(editors, youId, card?.uid ?? null)', 'title={ok.ok ? held.get(a.id)?.tooltip : ok.why}', 'data-testid="pitch-editor-lock-line"', 'now - lastPointer.current < 200']) {
    assert.ok(stage.includes(s), s);
  }
  // CodeQL (#4111): a second onPointerMove on the stage overrode the first, so cursors were never sent.
  assert.ok(stage.includes('onPointerMove={(e) => { over(e); pointerMoved(e); }}'), 'one handler: the drag and the cursor');
  const face = stage.slice(stage.indexOf('<div ref={faceRef}'), stage.indexOf('data-testid="pitch-editor-card"'));
  assert.equal(face.split('onPointerMove=').length - 1, 1, 'the stage has exactly one onPointerMove');
  const editor = read('pages/raise/pitch/PitchEditor.jsx');
  assert.ok(editor.includes("useDeckPresence(current?.id ?? null, { live: !readOnly && !phone })"));
  assert.ok(editor.includes('const claimArea = selection.length === 1 ? selection[0] : null;'));
  assert.ok(editor.includes('presence?.edit?.();'), 'each change keeps the soft lock');
  assert.ok(read('pages/raise/pitch/StudioHome.jsx').includes('avatarsOf(useDeckPresence(current?.id ?? null).editors, null)'));
  const hook = read('pages/raise/pitch/useDeckPresence.js');
  assert.ok(hook.includes("if (!alive || r?.available !== true) return;"), 'no socket while presence is off');
  assert.ok(hook.includes('`bearer.${token}`'), 'the token rides the subprotocol, never the URL');
  assert.ok(!hook.includes('?token='));
});

test('restore one card: the uid rides the compare, the dialog says only that card changes, and the route is restore-card', () => {
  const older = { id: 7, version: 2, slides: [{ uid: 'a', title: 'Problem' }, { uid: 'b', title: 'Old traction' }] };
  const newer = { id: 9, version: 4, slides: [{ uid: 'a', title: 'Problem' }, { uid: 'b', title: 'New traction' }] };
  const cmp = compareCards(older, newer);
  assert.deepEqual(cmp.left.map((c) => [c.n, c.uid, c.changed]), [['01', 'a', false], ['02', 'b', true]]);
  const d = restoreCardDialog(older, newer, [older, newer], cmp.left[1]);
  assert.equal(d.title, 'Restore card 02, “Old traction” from v2?');
  assert.deepEqual(d.lines, [
    'v5 is saved with card 02, “Old traction” as it was in v2, and becomes the working deck.',
    'Every other card stays as it is in v4, in the same order.',
    'Nothing is deleted.',
  ]);
  assert.equal(d.confirm, 'Restore this card');
  const vc = read('pages/raise/pitch/VersionCompare.jsx');
  assert.ok(vc.includes('deckCoeditApi.restoreCard(older.id, dialog.uid)'));
  assert.ok(vc.includes("onRestoreCard && c.changed && c.uid"), 'only a changed card with a uid offers it');
  assert.ok(vc.includes("id === 'pitch-compare-left' && !readOnly"), 'a reader, or a deck with unsaved changes, gets none');
  const client = read('lib/api/deckCoedit.js');
  for (const s of ['/restore-card', '/presence', '/areas/', "method: 'PATCH'"]) assert.ok(client.includes(s), s);
  const api = read('lib/api.js');
  assert.ok(api.includes("export * from './api/deckCheck.js';\nexport * from './api/deckCoedit.js';\nexport * from './api/deckComments.js';"), 'one line, in alphabetical order');
});
