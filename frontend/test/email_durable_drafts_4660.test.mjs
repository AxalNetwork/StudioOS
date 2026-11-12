/**
 * #4660 (finding 5, part 3): the composer keeps the member's text where the Worker keeps it.
 * Every person and address is made up; the API is faked.
 *
 *   · a member's recipient, subject and body are saved to their own version (PATCH, naming the revision
 *     they read), never through a model run; the save state is drawn and claims "saved" only once the
 *     Worker has answered;
 *   · a failed or conflicting save keeps the text on the page and offers Save again;
 *   · each version keeps its own text through version navigation; Shorter revises the text on screen;
 *   · a stored draft reopens with the member's saved text and sends without another run;
 *   · a pending generation keeps the purpose it was submitted with, so the fund-GP question check reads
 *     the draft's own intent;
 *   · closing with unsaved text saves first, and if that fails stays open and says so.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ComposeSheet from '../src/pages/email/ComposeSheet.jsx';
import RecordCompose from '../src/pages/email/RecordCompose.jsx';
import EmailPage from '../src/pages/email/EmailPage.jsx';
import { draftChain, draftRowText } from '../src/pages/email/emailModel.js';
import { textOfDraft } from '../src/pages/email/useDraftEdits.js';

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FUTURE = '2099-01-01T00:00:00.000Z';
const est = (quote, hold = 20_000) => ({ hold_microusd: hold, model: 'm', quote, expires_at: FUTURE });

async function mounted(element, entry = null) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, entry ? { initialEntries: [entry] } : null, element)));
  await act(flush);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const byLabel = (label) => walk(document.body).find((n) => props(n)['aria-label'] === label);
  const byText = (t) => walk(document.body).find((n) => n.nodeName === 'BUTTON' && text(n).trim().startsWith(t));
  return {
    by, byLabel, byText, props,
    text: () => text(document.body),
    value: (n) => props(n).value,
    disabled: (n) => !!props(n).disabled,
    state: (id) => props(by(id))['data-state'],
    async press(node) { assert.ok(node, 'no such button'); await act(async () => { props(node).onClick?.({ preventDefault() {} }); }); await act(flush); },
    async type(node, value) { assert.ok(node, 'no such field'); await act(async () => { props(node).onChange?.({ target: { value } }); }); await act(flush); },
    async settle(ms = 0) { await act(async () => { await wait(ms); }); await act(flush); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const PACK = { person: { ref: 'interviewee:11', kind: 'interviewee', name: 'Ada Lovelace', relationship: 'customer' }, items: [] };
const FUND = { person: { ref: 'fund_gp:3', kind: 'fund_gp', name: 'Pat Partner', relationship: 'fund_gp' }, items: [] };
const ACCOUNT = { uid: 'acc-1', address: 'me@example.test' };
const GENERATED = { subject: 'Thank you', body: 'Dear Ada,\nThank you for the interview.' };
const version = (uid, over = {}) => ({ uid, parent_uid: null, person: 'interviewee:11', intent: 'thank_follow_up', tone: 'warm', length: 'short', ...GENERATED, sources: [], edit: null, created_at: '2026-11-08 10:00:00', ...over });

function fakeApi(over = {}) {
  const calls = [];
  const log = (name, fn) => (...args) => { calls.push([name, ...args]); return fn(...args); };
  let n = 0;
  const revisions = {};
  return {
    calls,
    estimate: log('estimate', over.estimate ?? (() => Promise.resolve({ estimate: est('q1.draft.sig') }))),
    draft: log('draft', over.draft ?? (() => Promise.resolve({ draft: version(`dr-${++n}`) }))),
    revise: log('revise', over.revise ?? ((uid, body) => Promise.resolve(body.estimate ? { estimate: est(`q1.revise.${uid}`, 30_000) } : { draft: version(`dr-${++n}`, { parent_uid: uid, instruction: 'shorter', body: 'Shorter.' }) }))),
    saveEdit: log('saveEdit', over.saveEdit ?? ((uid, b) => { revisions[uid] = (revisions[uid] ?? 0) + 1; return Promise.resolve({ draft: { uid, edit: { to: b.to, subject: b.subject, body: b.body, revision: revisions[uid], at: 'now' } } }); })),
    confirmSend: log('confirmSend', () => Promise.resolve({ nonce: 'n-1' })),
    send: log('send', () => Promise.resolve({ sent: { uid: 's-1' } })),
  };
}
const sheet = (api, over = {}) => h(ComposeSheet, { pack: PACK, refs: ['interview:11'], to: 'ada@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api, saveDelayMs: 5, ...over });
const drafted = async (page) => { await page.press(page.by('compose-draft')); assert.ok(page.by('compose-draft-view'), 'a draft is on screen'); };
const saves = (api) => api.calls.filter(([n]) => n === 'saveEdit');

test('the pure rules: a version shows the member\'s saved text over the generated one, and a stored draft finds its chain', () => {
  assert.deepEqual(textOfDraft(version('a'), 'x@example.test'), { to: 'x@example.test', ...GENERATED }, 'never edited: what Eadwyn wrote, to the fallback recipient');
  assert.deepEqual(textOfDraft(version('a', { edit: { to: 'me@example.test', subject: 'Mine', body: 'My words', revision: 2 } }), 'x@example.test'), { to: 'me@example.test', subject: 'Mine', body: 'My words' });
  assert.deepEqual(textOfDraft(version('a', { edit: { to: '', subject: 'Mine', body: 'B', revision: 1 } }), 'x@example.test').to, 'x@example.test', 'a blank saved recipient falls back, it never blanks the recipient');
  assert.deepEqual(draftRowText(version('a', { edit: { to: '', subject: 'Mine', body: 'B', revision: 1 } })), { subject: 'Mine', body: 'B', edited: true });
  assert.equal(draftRowText(version('a')).edited, false);
  const list = [version('c', { parent_uid: 'b', created_at: '2026-11-08 10:02:00' }), version('b', { parent_uid: 'a', created_at: '2026-11-08 10:01:00' }), version('a'), version('z')];
  assert.deepEqual(draftChain(list, 'b').versions.map((d) => d.uid), ['a', 'b', 'c']);
  assert.equal(draftChain(list, 'b').at, 1, 'it opens at the draft that was chosen');
  assert.deepEqual(draftChain(list, 'z').versions.map((d) => d.uid), ['z']);
  assert.equal(draftChain(list, 'nope'), null);
  assert.equal(draftChain(null, 'a'), null);
  const loop = [version('p', { parent_uid: 'q' }), version('q', { parent_uid: 'p' })];
  assert.equal(draftChain(loop, 'p').versions.length, 2, 'a parent loop ends, it never spins');
});

test('an edit is saved to its own version through PATCH, naming the revision it read, and runs no model', async () => {
  const api = fakeApi();
  const page = await mounted(sheet(api, { saveDelayMs: 250 }));
  try {
    await drafted(page);
    assert.equal(page.state('compose-save-state'), 'idle');
    await page.type(page.byLabel('Subject'), 'My subject');
    await page.type(page.byLabel('Body'), 'My own body.');
    assert.equal(page.state('compose-save-state'), 'dirty', 'typed, not stored yet: it does not say saved');
    assert.doesNotMatch(page.text(), /Your edits are saved/);
    await page.settle(400);
    assert.equal(saves(api).length, 1, 'two changes in a burst are one save, of the latest text');
    assert.deepEqual(saves(api)[0].slice(1), ['dr-1', { to: 'ada@example.test', subject: 'My subject', body: 'My own body.', expected_revision: 0 }]);
    assert.equal(page.state('compose-save-state'), 'saved');
    assert.match(page.text(), /Your edits are saved/);
    await page.type(page.byLabel('Body'), 'My own body, again.');
    await page.settle(400);
    assert.equal(saves(api)[1][2].expected_revision, 1, 'the next save names the revision the last answer returned');
    assert.equal(api.calls.filter(([n, , body]) => n === 'draft' || (n === 'revise' && !body?.estimate)).length, 1, 'saving is not a run: only the one draft was made');
  } finally { await page.close(); }
});

test('a pending save is drawn as pending, and the recipient is part of the saved text', async () => {
  let release;
  const api = fakeApi({ saveEdit: (uid, b) => new Promise((resolve) => { release = () => resolve({ draft: { uid, edit: { ...b, revision: 1 } } }); }) });
  const page = await mounted(sheet(api));
  try {
    await drafted(page);
    await page.type(page.by('compose-to'), 'ada.lovelace@example.test');
    await page.settle(40);
    assert.equal(page.state('compose-save-state'), 'saving');
    assert.match(page.text(), /Saving…/);
    assert.doesNotMatch(page.text(), /Your edits are saved/, 'nothing claims the text is stored while the Worker has not answered');
    assert.equal(saves(api)[0][2].to, 'ada.lovelace@example.test');
    await act(async () => { release(); });
    await act(flush);
    assert.equal(page.state('compose-save-state'), 'saved');
  } finally { await page.close(); }
});

test('a failed save keeps the text, says so, and Save again stores it; a conflict names the revision the Worker holds', async () => {
  let fail = true;
  const api = fakeApi({ saveEdit: (uid, b) => (fail ? Promise.reject(new Error('Network down')) : Promise.resolve({ draft: { uid, edit: { ...b, revision: 1 } } })) });
  const page = await mounted(sheet(api));
  try {
    await drafted(page);
    await page.type(page.byLabel('Body'), 'Words that must not be lost.');
    await page.settle(40);
    assert.equal(page.state('compose-save-state'), 'failed');
    assert.match(page.text(), /This could not be saved\. Your text is still here\./);
    assert.equal(page.value(page.byLabel('Body')), 'Words that must not be lost.', 'the member\'s text is still on the page');
    assert.doesNotMatch(page.text(), /Your edits are saved/);
    fail = false;
    await page.press(page.by('compose-save-state-retry'));
    assert.equal(page.state('compose-save-state'), 'saved');
    assert.deepEqual(saves(api).map((c) => c[2].expected_revision), [0, 0], 'the failed save stored nothing, so the retry names the same revision');
    assert.equal(saves(api)[1][2].body, 'Words that must not be lost.');
  } finally { await page.close(); }
  let conflict = true;
  const api2 = fakeApi({ saveEdit: (uid, b) => (conflict
    ? Promise.reject(Object.assign(new Error('stale'), { status: 409, code: 'stale_edit', data: { draft: { uid, edit: { to: '', subject: 'Other window', body: 'Other', revision: 3 } } } }))
    : Promise.resolve({ draft: { uid, edit: { ...b, revision: 4 } } })) });
  const page2 = await mounted(sheet(api2));
  try {
    await drafted(page2);
    await page2.type(page2.byLabel('Body'), 'My version.');
    await page2.settle(40);
    assert.equal(page2.state('compose-save-state'), 'conflict');
    assert.match(page2.text(), /saved from another window/);
    assert.equal(page2.value(page2.byLabel('Body')), 'My version.', 'a conflict never replaces the member\'s text');
    conflict = false;
    await page2.press(page2.by('compose-save-state-retry'));
    assert.equal(saves(api2).at(-1)[2].expected_revision, 3, 'Save again names the revision the Worker reported');
    assert.equal(page2.state('compose-save-state'), 'saved');
  } finally { await page2.close(); }
});

test('each version keeps its own text through version navigation, and Shorter revises the text on screen', async () => {
  const api = fakeApi();
  const page = await mounted(sheet(api));
  try {
    await drafted(page);
    await page.type(page.byLabel('Body'), 'Version one, as I edited it.');
    await page.settle(450); // Shorter's estimate of the edited text
    await page.press(page.by('compose-shorter'));
    const run = api.calls.filter(([n, , b]) => n === 'revise' && !b?.estimate).at(-1);
    assert.equal(run[2].base.body, 'Version one, as I edited it.', 'Shorter ran on the exact text on screen');
    assert.match(page.text(), /version 2 of 2/);
    assert.equal(page.value(page.byLabel('Body')), 'Shorter.', 'the new version starts from what the revision returned');
    await page.type(page.byLabel('Body'), 'Version two, as I edited it.');
    await page.press(page.byLabel('Previous version'));
    assert.equal(page.value(page.byLabel('Body')), 'Version one, as I edited it.', 'going back does not reset the editor to the generated text');
    await page.press(page.byLabel('Next version'));
    assert.equal(page.value(page.byLabel('Body')), 'Version two, as I edited it.');
    await page.settle(40);
    assert.deepEqual(saves(api).map((c) => [c[1], c[2].body]), [['dr-1', 'Version one, as I edited it.'], ['dr-2', 'Version two, as I edited it.']], 'each version saved under its own uid');
  } finally { await page.close(); }
});

test('a stored draft reopens with the member\'s saved text and recipient, and sends without another run', async () => {
  const api = fakeApi();
  const stored = version('dr-7', { edit: { to: 'ada.l@example.test', subject: 'Saved subject', body: 'Saved body, finished by me.', revision: 2, at: 'earlier' } });
  const page = await mounted(sheet(api, { resume: { versions: [stored], at: 0 } }));
  try {
    assert.ok(page.by('compose-draft-view'), 'it opens on the draft, not the form that makes one');
    assert.equal(page.value(page.byLabel('Subject')), 'Saved subject');
    assert.equal(page.value(page.byLabel('Body')), 'Saved body, finished by me.');
    assert.equal(page.value(page.by('compose-to')), 'ada.l@example.test');
    assert.equal(page.state('compose-save-state'), 'idle', 'nothing is claimed saved this session until it is');
    await page.press(page.by('compose-send'));
    await page.press(page.by('compose-confirm-send'));
    const sent = api.calls.find(([n]) => n === 'send')?.[1];
    assert.deepEqual({ ...sent, operation_key: undefined }, { person: 'interviewee:11', account_uid: 'acc-1', to: 'ada.l@example.test', subject: 'Saved subject', body: 'Saved body, finished by me.', draft_uid: 'dr-7', operation_key: undefined, nonce: 'n-1' });
    assert.equal(api.calls.some(([n, , body]) => n === 'draft' || (n === 'revise' && !body?.estimate)), false, 'sent with no AI run');
    // Shorter on the reopened draft revises the saved text, and the estimate names it.
    await page.settle(450);
    const asked = api.calls.find(([n, , b]) => n === 'revise' && b?.estimate === true);
    assert.equal(asked[2].base.body, 'Saved body, finished by me.');
  } finally { await page.close(); }
});

test('a pending generation keeps the purpose it was submitted with; the fund-GP question check reads the version\'s own intent', async () => {
  let release;
  const api = fakeApi({ draft: () => new Promise((resolve) => { release = () => resolve({ draft: { uid: 'dr-1', subject: 'Question', body: 'Hello,\nI have a question about the fund.', sources: [], edit: null } }); }) });
  const page = await mounted(h(ComposeSheet, { pack: FUND, refs: [], to: 'pat@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api, saveDelayMs: 5 }));
  try {
    assert.equal(page.props(page.by('compose-intents')).role, 'radiogroup');
    await page.press(page.byText('Start a fund question'));
    await page.press(page.by('compose-draft'));
    assert.equal(page.disabled(page.byText('Ask for an update')), true, 'the purpose cannot be changed while a draft is pending');
    // Even if it were changed, the answer keeps what it was submitted with.
    await page.press(page.byText('Ask for an update'));
    await act(async () => { release(); });
    await act(flush);
    assert.ok(page.by('compose-draft-view'));
    assert.equal(page.disabled(page.by('compose-send')), true, 'an unedited fund question opening is still blocked: the draft is an ask_question draft');
    assert.ok(page.by('compose-fund-question'));
    await page.type(page.byLabel('Body'), 'Hello,\nI have a question about the fund. What is the fee on your last vehicle?');
    assert.equal(page.disabled(page.by('compose-send')), false, 'adding the member\'s question permits the normal send flow');
  } finally { await page.close(); }
});

test('the fund-GP block holds after reopening: an unedited opening stays blocked, a saved question permits Send, from the draft\'s own intent', async () => {
  const opening = { subject: 'Question', body: 'Hello,\nI have a question about the fund.' };
  const open = (edit) => h(ComposeSheet, { pack: FUND, refs: [], to: 'pat@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api: fakeApi(), saveDelayMs: 5,
    resume: { versions: [version('dr-4', { person: 'fund_gp:3', intent: 'ask_question', ...opening, edit })], at: 0 } });
  let page = await mounted(open(null));
  try { assert.equal(page.disabled(page.by('compose-send')), true, 'reopened unedited: blocked'); } finally { await page.close(); }
  page = await mounted(open({ to: 'pat@example.test', subject: 'Question', body: `${opening.body} What is the fee?`, revision: 1 }));
  try { assert.equal(page.disabled(page.by('compose-send')), false, 'reopened with the member\'s question saved: allowed'); } finally { await page.close(); }
  // A draft for another purpose is not a question opening, whatever the form's intent chips say.
  page = await mounted(h(ComposeSheet, { pack: FUND, refs: [], to: 'pat@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api: fakeApi(), saveDelayMs: 5,
    resume: { versions: [version('dr-5', { person: 'fund_gp:3', intent: 'ask_update', ...opening })], at: 0 } }));
  try { assert.equal(page.disabled(page.by('compose-send')), false); assert.equal(page.by('compose-fund-question'), undefined); } finally { await page.close(); }
});

test('closing with unsaved text saves first; if that fails the sheet stays open, says so, and offers to close without saving', async () => {
  let closed = 0;
  const api = fakeApi();
  const page = await mounted(sheet(api, { onClose: () => { closed += 1; }, saveDelayMs: 5000 }));
  try {
    await drafted(page);
    await page.type(page.byLabel('Body'), 'Typed just before closing.');
    assert.equal(saves(api).length, 0, 'the pause has not run out');
    await page.press(page.by('compose-sheet-close'));
    await page.settle(20);
    assert.equal(saves(api).length, 1, 'closing saved the text first');
    assert.equal(saves(api)[0][2].body, 'Typed just before closing.');
    assert.equal(closed, 1);
  } finally { await page.close(); }
  closed = 0;
  const failing = fakeApi({ saveEdit: () => Promise.reject(new Error('Network down')) });
  const page2 = await mounted(sheet(failing, { onClose: () => { closed += 1; }, saveDelayMs: 5000 }));
  try {
    await drafted(page2);
    await page2.type(page2.byLabel('Body'), 'Do not lose me.');
    await page2.press(page2.by('compose-sheet-close'));
    await page2.settle(20);
    assert.equal(closed, 0, 'it did not close over unsaved text');
    assert.match(page2.text(), /Your latest changes are not saved, so this is still open\./);
    assert.equal(page2.value(page2.byLabel('Body')), 'Do not lose me.');
    await page2.press(page2.by('draft-close-notice-discard'));
    assert.equal(closed, 1, 'only an explicit choice closes it');
  } finally { await page2.close(); }
  closed = 0;
  const page3 = await mounted(sheet(fakeApi(), { onClose: () => { closed += 1; } }));
  try {
    await drafted(page3);
    await page3.press(page3.by('compose-sheet-close'));
    assert.equal(closed, 1, 'with nothing unsaved it closes at once');
  } finally { await page3.close(); }
});

test('the record Email sheet saves edits to the draft Accept placed, and its fund-GP check reads that draft\'s own intent', async () => {
  let release;
  const api = fakeApi({ draft: () => new Promise((resolve) => { release = () => resolve({ draft: version('dr-8', { person: 'fund_gp:3', intent: 'ask_question', subject: 'Question', body: 'Hello,\nI have a question about the fund.' }) }); }) });
  const page = await mounted(h(RecordCompose, { pack: FUND, refs: [], to: 'pat@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api, saveDelayMs: 5 }));
  try {
    await page.press(page.by('fill-trigger-field'));
    await page.press(page.byText('Start a fund question'));
    await page.press(page.by('email-intent-draft'));
    await page.press(page.byText('Ask for an update')); // the form changes while the draft is pending
    await act(async () => { release(); });
    await act(flush);
    await page.press(page.by('email-intent-accept'));
    assert.equal(page.value(page.by('record-compose-body-field')), 'Hello,\nI have a question about the fund.');
    assert.equal(page.disabled(page.by('record-compose-send')), true, 'the opening is still an ask_question draft, whatever the form said when it arrived');
    await page.type(page.by('record-compose-body-field'), 'Hello,\nI have a question about the fund. What is the fee?');
    assert.equal(page.disabled(page.by('record-compose-send')), false);
    await page.settle(40);
    assert.deepEqual(saves(api).map((c) => [c[1], c[2]]), [['dr-8', { to: 'pat@example.test', subject: 'Question', body: 'Hello,\nI have a question about the fund. What is the fee?', expected_revision: 0 }]]);
    assert.equal(page.state('record-compose-save-state'), 'saved');
  } finally { await page.close(); }
  // A failed save is visible there too, and the text stays.
  const failing = fakeApi({ saveEdit: () => Promise.reject(new Error('down')) });
  const page2 = await mounted(h(RecordCompose, { pack: { person: PACK.person }, refs: [], to: 'ada@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api: failing, saveDelayMs: 5 }));
  try {
    await page2.press(page2.by('fill-trigger-field'));
    await page2.press(page2.by('email-intent-draft'));
    await page2.press(page2.by('email-intent-accept'));
    await page2.type(page2.by('record-compose-body-field'), 'My words.');
    await page2.settle(40);
    assert.equal(page2.state('record-compose-save-state'), 'failed');
    assert.equal(page2.value(page2.by('record-compose-body-field')), 'My words.');
  } finally { await page2.close(); }
});

test('the conversation lists a stored draft with the member\'s saved text and opens it, versions and all; closing reads the list again', async () => {
  const v1 = version('dr-1', { created_at: '2026-11-08 09:00:00' });
  const v2 = version('dr-2', { parent_uid: 'dr-1', instruction: 'shorter', body: 'Shorter.', created_at: '2026-11-08 09:05:00', edit: { to: 'ada@example.test', subject: 'Saved subject', body: 'Saved shorter body, finished by me.', revision: 1, at: 'x' } });
  const api = fakeApi();
  let listed = 0;
  Object.assign(api, {
    accounts: () => Promise.resolve({ accounts: [{ uid: 'acc-1', address: 'me@example.test', provider: 'gmail', status: 'connected', can_send: true }], providers: {} }),
    drafts: () => { listed += 1; return Promise.resolve({ drafts: [v2, v1] }); },
    shares: () => Promise.resolve({ items: [] }),
    context: () => Promise.resolve({ person: PACK.person, items: [] }),
    sent: () => Promise.resolve({ page: 1, per_page: 20, total: 0, items: [] }),
  });
  const page = await mounted(h(EmailPage, { api, userId: 7 }), '/email?person=interviewee%3A11');
  try {
    const rows = [];
    const text = page.text();
    assert.match(text, /Saved shorter body, finished by me\./, 'the row shows what the member made of it, not the generated text');
    assert.match(text, /· edited/);
    assert.doesNotMatch(text, /Shorter\.\s*Open draft/, 'the generated text of an edited version is not what the row shows');
    void rows;
    const before = listed;
    await page.press(page.by('thread-draft-open'));
    assert.ok(page.by('compose-draft-view'), 'it opens in the composer, no new run needed');
    assert.match(page.text(), /version 2 of 2/, 'with its versions, at the one chosen');
    assert.equal(page.value(page.byLabel('Body')), 'Saved shorter body, finished by me.');
    assert.equal(page.value(page.byLabel('Subject')), 'Saved subject');
    await page.press(page.byLabel('Previous version'));
    assert.equal(page.value(page.byLabel('Body')), v1.body, 'the earlier version is there, as Eadwyn wrote it');
    assert.equal(api.calls.some(([n]) => n === 'draft'), false);
    await page.press(page.by('compose-sheet-close'));
    assert.equal(page.by('compose-draft-view'), undefined, 'it closed');
    assert.ok(listed > before, 'the list was read again so what was saved shows');
  } finally { await page.close(); }
});
