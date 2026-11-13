/** D1102 (#2982, part 2) — Project detail's NDA choice: unset is said, and only a choice the founder makes is sent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck, textOf } from './_form_d695.mjs';

const pagePath = 'pages/ProjectDetail.jsx';
// Isolated export of the existing section; the production module is unchanged.
const page = readFileSync('frontend/src/' + pagePath, 'utf8') + '\nexport { DataRoomSection };';
const libPath = 'lib/dataRoomNdaChoice.js';
const lib = readFileSync('frontend/src/' + libPath, 'utf8');

test('the save body: the URL always, and the NDA choice only when the founder picked one that differs', async () => {
  await mutationCheck(lib, libPath, async ({ dataRoomSaveBody, ndaChoiceOf }) => {
    assert.deepEqual([1, 0, null, undefined, true, false, 2].map(ndaChoiceOf), [true, false, null, null, true, false, null]);
    assert.deepEqual(dataRoomSaveBody(' https://example.com/room ', null, null), { data_room_url: 'https://example.com/room' }, 'unset and untouched sends no choice');
    assert.deepEqual(dataRoomSaveBody('', false, null), { data_room_url: null, data_room_nda_choice: false }, 'a first No is sent');
    assert.deepEqual(dataRoomSaveBody('', true, 0), { data_room_url: null, data_room_nda_choice: true }, 'a changed choice is sent');
    assert.deepEqual(dataRoomSaveBody('', false, 0), { data_room_url: null }, 'an unchanged choice is not re-sent');
  }, [
    ['if (choice !== null && choice !== ndaChoiceOf(stored))', 'if (choice !== undefined)'],
    ['if (choice !== null && choice !== ndaChoiceOf(stored))', 'if (choice !== null)'],
    ["if (stored === 0 || stored === false) return false;", ''],
  ]);
});

test('Project detail says an unset choice, sends none until the founder picks, then sends that pick', async () => {
  await mutationCheck(page, pagePath, async ({ DataRoomSection }) => {
    const previousFetch = globalThis.fetch;
    const bodies = [];
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(new URL(url, 'https://fixture.example.com').pathname, '/api/projects/7');
      assert.equal(init.method, 'PUT');
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 7 }), { headers: { 'Content-Type': 'application/json' } });
    };
    let view;
    try {
      view = await mountForm(h(DataRoomSection, { project: { id: 7, data_room_url: null, data_room_nda_choice: null }, onSaved() {}, onError() {} }));
      const radio = (label) => view.nodes().find((n) => n.tagName === 'LABEL' && textOf(n).trim() === label)?.childNodes.find((n) => n.tagName === 'INPUT');
      assert.equal(view.props(radio('Yes')).checked, false); assert.equal(view.props(radio('No')).checked, false);
      assert.match(view.text(), /Not chosen yet/);
      const url = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n).type === 'url');
      await act(async () => view.props(url).onChange({ target: { value: 'https://example.com/room' } }));
      await view.click('Save'); await view.flush();
      assert.deepEqual(bodies[0], { data_room_url: 'https://example.com/room' }, 'a URL save is not a No');
      await act(async () => view.props(radio('No')).onChange({ target: { checked: true } }));
      assert.equal(view.props(radio('No')).checked, true); assert.doesNotMatch(view.text(), /Not chosen yet/);
      await view.click('Save'); await view.flush();
      assert.deepEqual(bodies[1], { data_room_url: 'https://example.com/room', data_room_nda_choice: false });
    } finally { if (view) await view.unmount(); globalThis.fetch = previousFetch; }
    const chosen = await mountForm(h(DataRoomSection, { project: { id: 7, data_room_url: null, data_room_nda_choice: 0 }, onSaved() {}, onError() {} }));
    try {
      const radio = (label) => chosen.nodes().find((n) => n.tagName === 'LABEL' && textOf(n).trim() === label)?.childNodes.find((n) => n.tagName === 'INPUT');
      assert.equal(chosen.props(radio('No')).checked, true, 'a stored No reads as No');
      assert.doesNotMatch(chosen.text(), /Not chosen yet/);
    } finally { await chosen.unmount(); }
  }, [
    // The mount effect sets the choice from the project, so that is the line that matters.
    ['setNdaChoice(ndaChoiceOf(project.data_room_nda_choice));', 'setNdaChoice(false);'],
    ['{ndaChoice === null && (', '{false && ('],
    ['api.updateProject(project.id, dataRoomSaveBody(url, ndaChoice, project.data_room_nda_choice))',
      "api.updateProject(project.id, { data_room_url: url.trim() || null, data_room_nda_choice: ndaChoice })"],
    ['onChange={() => { setNdaChoice(option.value); setDirty(true); }}', 'onChange={() => { setDirty(true); }}'],
  ]);
});

test('Project detail no longer reads or sends the old NDA column', () => {
  const source = readFileSync('frontend/src/' + pagePath, 'utf8');
  assert.doesNotMatch(source, /data_room_nda_required/);
});
