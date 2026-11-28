/**
 * #9020 (D8546 part 2, boards V17 and V29): Problem discovery's "Proposed grouping" cards on D8546's mounted routes.
 * Each card's Edit, Discard and Accept, and their failure states; the list's none, unavailable and reader states.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/proposed_groupings_9020.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ProposedGroupings, { editBody, groupingHeadline, groupingRefusal } from '../src/pages/cycles/ProposedGroupings.jsx';
import { painGroupingProposalsApi } from '../src/lib/api/painGroupingProposals.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Synthetic fixtures only.
const NEW_THEME = {
  id: 7, status: 'pending', target_group_id: null, target_title: 'Re-keying invoices into the ERP', edited: false,
  members: [
    { phrase: 'we re-key every PDF', sources: [{ interview_id: 31, interviewee: 'Interviewee A', quote_consent: true }, { interview_id: 32, interviewee: 'Interviewee B', quote_consent: false }] },
    { phrase: 'two afternoons a month', sources: [{ interview_id: 31, interviewee: 'Interviewee A', quote_consent: true }] },
  ],
};
const EXISTING = {
  id: 8, status: 'pending', target_group_id: 12, target_title: 'Disputes over surcharges', edited: true,
  members: [{ phrase: 'carriers add fees', sources: [{ interview_id: 33, interviewee: null, quote_consent: true }] }],
};
const refused = (code, status = 409) => Object.assign(new Error('raw worker text'), { code, status });

/** A fake client: `answers.list` is a queue (the last answer repeats); each call is recorded. */
function fakeApi(answers = {}) {
  const calls = [];
  const lists = Array.isArray(answers.list) ? [...answers.list] : [answers.list ?? { proposals: [NEW_THEME, EXISTING] }];
  const run = (name, args, a) => { calls.push([name, ...args]); const v = typeof a === 'function' ? a(...args) : a; return v instanceof Error ? Promise.reject(v) : Promise.resolve(v); };
  return {
    calls,
    count: (name) => calls.filter((c) => c[0] === name).length,
    list: (...args) => run('list', args, lists.length > 1 ? lists.shift() : lists[0]),
    edit: (...args) => run('edit', args, answers.edit ?? { proposal: NEW_THEME }),
    discard: (...args) => run('discard', args, answers.discard ?? { proposal: { ...NEW_THEME, status: 'discarded' } }),
    accept: (...args) => run('accept', args, answers.accept ?? { proposal: { ...NEW_THEME, status: 'accepted' }, group_id: 40, assigned: 2 }),
  };
}

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
  await act(async () => { root.render(h(ProposedGroupings, props)); });
  await flush();
  const reactProps = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const nodes = () => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (node) => (node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '');
  const all = (id) => nodes().filter((n) => reactProps(n)?.['data-testid'] === id);
  const card = (pid) => nodes().find((n) => reactProps(n)?.['data-testid'] === 'grouping-card' && String(reactProps(n)?.['data-id']) === String(pid)) || null;
  const within = (root2, id) => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(root2).find((n) => reactProps(n)?.['data-testid'] === id) || null; };
  const fire = async (el, key, event = {}) => { assert.ok(el, `found a node for ${key}`); await act(async () => { await reactProps(el)[key](event); }); await flush(); };
  return {
    by: (id) => all(id)[0] || null, all, card, within, fire, flush, props: reactProps,
    text: (el) => text(el ?? container),
    close: () => { act(() => root.unmount()); restore(); },
  };
}

// ---------------------------------------------------------------- pure

test('the client calls the four mounted D8546 routes, keyed by the venture and the proposal', () => {
  const src = read('frontend/src/lib/api/painGroupingProposals.js');
  assert.match(src, /list: \(projectId\) => request\(`\/progress\/pain-grouping-proposals\/\$\{projectId\}`\)/);
  assert.match(src, /edit: \(projectId, id, body\) => request\(`\/progress\/pain-grouping-proposals\/\$\{projectId\}\/\$\{id\}`, \{ method: 'PATCH'/);
  assert.match(src, /discard: \(projectId, id\) => request\(`\/progress\/pain-grouping-proposals\/\$\{projectId\}\/\$\{id\}\/discard`, \{ method: 'POST' \}\)/);
  assert.match(src, /accept: \(projectId, id\) => request\(`\/progress\/pain-grouping-proposals\/\$\{projectId\}\/\$\{id\}\/accept`, \{ method: 'POST' \}\)/);
  const route = read('cloudflare-worker/src/routes/pain_grouping_proposals.ts');
  for (const r of ["grouping.get('/:projectId'", "grouping.patch('/:projectId/:id'", "grouping.post('/:projectId/:id/discard'", "grouping.post('/:projectId/:id/accept'"]) assert.ok(route.includes(r), r);
  assert.match(route, /path: '\/api\/progress\/pain-grouping-proposals'/);
  assert.equal(typeof painGroupingProposalsApi.accept, 'function');
});

test('the headline names the count and the target: a new theme by title, an existing one by name', () => {
  assert.equal(groupingHeadline(NEW_THEME), '2 quotes → new theme “Re-keying invoices into the ERP”');
  assert.equal(groupingHeadline(EXISTING), '1 quote → add to “Disputes over surcharges”');
  assert.equal(groupingHeadline({ ...EXISTING, target_title: null }), '1 quote → add to a theme that is no longer there');
});

test('each refusal has its own sentence; the four 409s read the list again; the raw message is never used', () => {
  const seen = new Set();
  for (const code of ['stale_source', 'stale_target', 'stale_grouping', 'already_decided']) {
    const r = groupingRefusal(refused(code));
    assert.equal(r.code, code);
    assert.equal(r.refresh, true, `${code} reads the list again`);
    assert.doesNotMatch(r.text, /raw worker text/);
    seen.add(r.text);
  }
  assert.equal(seen.size, 4, 'four different sentences');
  assert.match(groupingRefusal(refused('stale_source')).text, /no longer in the interview/);
  assert.match(groupingRefusal(refused('stale_target')).text, /theme this grouping goes to is gone/);
  assert.match(groupingRefusal(refused('stale_grouping')).text, /changed while this grouping was being accepted/);
  assert.match(groupingRefusal(refused('already_decided')).text, /already decided/);
  assert.equal(groupingRefusal(refused('accept_failed', 503)).refresh, false);
  assert.deepEqual(groupingRefusal(new Error('boom')), { code: null, refresh: false, text: 'That could not be done just now. Nothing was changed; try again.' });
});

test('editBody sends every interview of each kept quote, and the title only when a new theme\'s title changed', () => {
  assert.deepEqual(editBody(NEW_THEME, new Set(['we re-key every PDF']), NEW_THEME.target_title),
    { members: [{ phrase: 'we re-key every PDF', interview_id: 31 }, { phrase: 'we re-key every PDF', interview_id: 32 }] });
  assert.deepEqual(editBody(NEW_THEME, new Set(['we re-key every PDF', 'two afternoons a month']), '  Re-keying PDFs  '), { title: 'Re-keying PDFs' });
  assert.deepEqual(editBody(EXISTING, new Set(['carriers add fees']), 'ignored'), {}, 'an existing theme\'s title is its own');
});

test('Validate mounts the cards on Problem discovery for writers, and an accept reads the module again', () => {
  const def = read('frontend/src/pages/cycles/defs/validate.jsx');
  assert.match(def, /<ProposedGroupings key=\{ctx\.projectId\} projectId=\{ctx\.projectId\} canWrite=\{data\?\.parts\?\.can_write === true\} onAccepted=\{ctx\.reload\} \/>/);
});

// ---------------------------------------------------------------- the list's states

test('a reader who cannot write gets no section and no read', async () => {
  const api = fakeApi();
  const m = await mount({ projectId: 5, canWrite: false, api });
  try {
    assert.ok(!m.by('validate-proposed-groupings'));
    assert.equal(api.calls.length, 0, 'nothing is read');
  } finally { m.close(); }
});

test('a writer sees one card per pending proposal: quotes, interviews, the no-consent mark, the target and three controls', async () => {
  const api = fakeApi();
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    assert.deepEqual(api.calls, [['list', 5]]);
    assert.equal(m.props(m.by('validate-proposed-groupings'))['data-state'], 'some');
    assert.equal(m.text(m.by('grouping-waiting')), '2 waiting');
    assert.equal(m.all('grouping-card').length, 2);
    const first = m.card(7);
    assert.equal(m.text(m.within(first, 'grouping-headline')), '2 quotes → new theme “Re-keying invoices into the ERP”');
    assert.match(m.text(first), /“we re-key every PDF”Interviewee A·Interviewee BNo consent to quote/);
    assert.equal(m.all('grouping-no-consent').length, 1, 'only the interview that did not consent is marked');
    assert.match(m.text(m.card(8)), /Interviewee not recorded/);
    assert.ok(m.within(m.card(8), 'grouping-edited'), 'an edited proposal says so');
    assert.ok(!m.within(first, 'grouping-edited'));
    for (const id of ['grouping-discard', 'grouping-edit', 'grouping-accept']) assert.ok(m.within(first, id), id);
  } finally { m.close(); }
});

test('none waiting says so; a failed read says Unavailable, never 0, and Try again reads again', async () => {
  const none = await mount({ projectId: 5, canWrite: true, api: fakeApi({ list: { proposals: [] } }) });
  try {
    assert.equal(none.props(none.by('validate-proposed-groupings'))['data-state'], 'none');
    assert.equal(none.text(none.by('grouping-none')), 'No proposed groupings are waiting for your review.');
    assert.ok(!none.by('grouping-waiting'), 'no "0 waiting"');
  } finally { none.close(); }
  const api = fakeApi({ list: [new Error('offline'), { proposals: [NEW_THEME] }] });
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    assert.equal(m.props(m.by('validate-proposed-groupings'))['data-state'], 'error');
    assert.match(m.text(m.by('grouping-unavailable')), /^Unavailable\. Proposed groupings could not be read\. That is not the same as none waiting\./);
    assert.doesNotMatch(m.text(), /\b0\b/, 'never a zero');
    assert.ok(!m.by('grouping-none'));
    await m.fire(m.by('grouping-retry'), 'onClick');
    assert.equal(api.count('list'), 2);
    assert.equal(m.all('grouping-card').length, 1);
  } finally { m.close(); }
});

// ---------------------------------------------------------------- Accept

test('Accept writes the set once, reads the list and the module again, and says where the quotes went', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const reloads = [];
  const api = fakeApi({ list: [{ proposals: [NEW_THEME, EXISTING] }, { proposals: [EXISTING] }], accept: () => gate.then(() => ({ group_id: 40, assigned: 2 })) });
  const m = await mount({ projectId: 5, canWrite: true, api, onAccepted: () => { reloads.push(1); } });
  try {
    const press = m.props(m.within(m.card(7), 'grouping-accept')).onClick;
    let first; let second;
    await act(async () => { first = press(); second = press(); });
    assert.equal(api.count('accept'), 1, 'a second press while the first is in flight sends nothing');
    assert.equal(m.text(m.within(m.card(7), 'grouping-accept')), 'Saving…');
    assert.equal(m.props(m.within(m.card(8), 'grouping-accept')).disabled, true, 'every card waits');
    await act(async () => { release(); await first; await second; });
    await m.flush();
    assert.deepEqual(api.calls.filter((c) => c[0] === 'accept'), [['accept', 5, 7]]);
    assert.equal(reloads.length, 1, 'the module (and its themes) is read again once');
    assert.equal(api.count('list'), 2, 'the list is read again');
    assert.ok(!m.card(7), 'the accepted card is gone');
    assert.equal(m.text(m.by('grouping-done')), 'Accepted. 2 quotes are in “Re-keying invoices into the ERP”.');
  } finally { m.close(); }
});

for (const [code, words] of [
  ['stale_source', /no longer in the interview it came from/],
  ['stale_target', /theme this grouping goes to is gone/],
  ['stale_grouping', /changed while this grouping was being accepted/],
  ['already_decided', /already decided, perhaps in another tab/],
]) {
  test(`Accept refused with 409 ${code}: its own sentence, the list read again, the themes untouched`, async () => {
    const reloads = [];
    const api = fakeApi({ accept: refused(code) });
    const m = await mount({ projectId: 5, canWrite: true, api, onAccepted: () => { reloads.push(1); } });
    try {
      await m.fire(m.within(m.card(7), 'grouping-accept'), 'onClick');
      const alert = m.by('grouping-refusal');
      assert.equal(m.props(alert)['data-code'], code);
      assert.match(m.text(alert), words);
      assert.doesNotMatch(m.text(), /raw worker text/);
      assert.equal(api.count('list'), 2, 'the list is read again');
      assert.equal(reloads.length, 0, 'the module is not read as if something were saved');
      assert.ok(!m.by('grouping-done'));
    } finally { m.close(); }
  });
}

test('Accept that fails part way (503) says nothing was saved and keeps the card, with no re-read', async () => {
  const api = fakeApi({ accept: refused('accept_failed', 503) });
  const m = await mount({ projectId: 5, canWrite: true, api, onAccepted: () => assert.fail('no reload') });
  try {
    await m.fire(m.within(m.card(7), 'grouping-accept'), 'onClick');
    assert.equal(m.text(m.by('grouping-refusal')), 'The grouping could not be accepted. Nothing was saved; try again.');
    assert.equal(api.count('list'), 1);
    assert.ok(m.card(7));
    assert.equal(m.props(m.within(m.card(7), 'grouping-accept')).disabled, false, 'Accept can be pressed again');
  } finally { m.close(); }
});

// ---------------------------------------------------------------- Discard

test('Discard sends the proposal\'s discard, reads the list again and says no theme changed', async () => {
  const reloads = [];
  const api = fakeApi({ list: [{ proposals: [NEW_THEME, EXISTING] }, { proposals: [NEW_THEME] }] });
  const m = await mount({ projectId: 5, canWrite: true, api, onAccepted: () => { reloads.push(1); } });
  try {
    await m.fire(m.within(m.card(8), 'grouping-discard'), 'onClick');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'discard'), [['discard', 5, 8]]);
    assert.equal(api.count('accept'), 0);
    assert.equal(api.count('list'), 2);
    assert.ok(!m.card(8));
    assert.equal(m.text(m.by('grouping-done')), 'Discarded. No theme was changed.');
    assert.equal(reloads.length, 0, 'a discard changes no theme, so the module is not read again');
  } finally { m.close(); }
});

test('Discard refused: already_decided reads the list again; an unknown failure says try again without a re-read', async () => {
  const api = fakeApi({ discard: refused('already_decided') });
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    await m.fire(m.within(m.card(7), 'grouping-discard'), 'onClick');
    assert.equal(m.props(m.by('grouping-refusal'))['data-code'], 'already_decided');
    assert.equal(api.count('list'), 2);
  } finally { m.close(); }
  const api2 = fakeApi({ discard: new Error('network down') });
  const m2 = await mount({ projectId: 5, canWrite: true, api: api2 });
  try {
    await m2.fire(m2.within(m2.card(7), 'grouping-discard'), 'onClick');
    assert.equal(m2.text(m2.by('grouping-refusal')), 'That could not be done just now. Nothing was changed; try again.');
    assert.doesNotMatch(m2.text(), /network down/);
    assert.equal(api2.count('list'), 1);
    assert.ok(m2.card(7), 'the card stays');
  } finally { m2.close(); }
});

// ---------------------------------------------------------------- Edit

test('Edit drops a quote and renames a new theme in one PATCH, and the card waits for review again', async () => {
  const api = fakeApi({ list: [{ proposals: [NEW_THEME] }, { proposals: [{ ...NEW_THEME, edited: true, target_title: 'Re-keying PDFs', members: [NEW_THEME.members[0]] }] }] });
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    await m.fire(m.within(m.card(7), 'grouping-edit'), 'onClick');
    assert.ok(m.by('grouping-edit-form'));
    const keeps = m.all('grouping-edit-keep');
    assert.equal(keeps.length, 2);
    await m.fire(keeps[1], 'onChange');
    await m.fire(m.by('grouping-edit-title'), 'onChange', { target: { value: 'Re-keying PDFs' } });
    await m.fire(m.by('grouping-edit-save'), 'onClick');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'edit'), [['edit', 5, 7, {
      members: [{ phrase: 'we re-key every PDF', interview_id: 31 }, { phrase: 'we re-key every PDF', interview_id: 32 }], title: 'Re-keying PDFs',
    }]]);
    assert.equal(api.count('accept'), 0, 'an edit accepts nothing');
    assert.ok(!m.by('grouping-edit-form'), 'the form closes');
    assert.equal(m.text(m.within(m.card(7), 'grouping-headline')), '1 quote → new theme “Re-keying PDFs”');
    assert.ok(m.within(m.card(7), 'grouping-edited'));
    assert.equal(m.text(m.by('grouping-done')), 'Your version is saved. It is still waiting for your review.');
  } finally { m.close(); }
});

test('Edit on an existing theme offers no title; dropping every quote or emptying a title sends nothing', async () => {
  const api = fakeApi();
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    await m.fire(m.within(m.card(8), 'grouping-edit'), 'onClick');
    assert.ok(!m.within(m.card(8), 'grouping-edit-title'), 'an existing theme keeps its own title');
    await m.fire(m.within(m.card(8), 'grouping-edit-keep'), 'onChange');
    await m.fire(m.within(m.card(8), 'grouping-edit-save'), 'onClick');
    assert.equal(m.text(m.within(m.card(8), 'grouping-edit-invalid')), 'Keep at least one quote. To drop them all, discard the grouping.');
    await m.fire(m.within(m.card(7), 'grouping-edit'), 'onClick');
    await m.fire(m.within(m.card(7), 'grouping-edit-title'), 'onChange', { target: { value: '   ' } });
    await m.fire(m.within(m.card(7), 'grouping-edit-save'), 'onClick');
    assert.equal(m.text(m.within(m.card(7), 'grouping-edit-invalid')), 'A new theme needs a title.');
    assert.equal(api.count('edit'), 0, 'nothing was sent');
  } finally { m.close(); }
});

test('Edit refused with stale_source keeps the form open, says why and reads the list again', async () => {
  const api = fakeApi({ edit: refused('stale_source') });
  const m = await mount({ projectId: 5, canWrite: true, api });
  try {
    await m.fire(m.within(m.card(7), 'grouping-edit'), 'onClick');
    await m.fire(m.all('grouping-edit-keep')[1], 'onChange');
    await m.fire(m.by('grouping-edit-save'), 'onClick');
    assert.equal(api.count('edit'), 1);
    assert.equal(m.props(m.by('grouping-refusal'))['data-code'], 'stale_source');
    assert.match(m.text(m.by('grouping-refusal')), /edit its quotes or discard it/);
    assert.equal(api.count('list'), 2);
    assert.ok(m.by('grouping-edit-form'), 'the form stays open');
    assert.deepEqual(m.all('grouping-edit-keep').map((n) => m.props(n).checked), [true, false], 'with the founder\'s choices kept');
    assert.ok(!m.by('grouping-done'));
  } finally { m.close(); }
});
