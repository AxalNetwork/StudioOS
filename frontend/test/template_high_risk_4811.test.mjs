// D4811 (#4811) part 13 — publishing a template is a high-risk action (board
// CT-16 "Activate template"): the dialog says what changes, who is told and
// what is recorded, and sends only with a reason and the exact word PUBLISH;
// the client sends both with the version. Withdraw keeps one confirmation.
// Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { contractsApi } from '../src/lib/api.js';
import PublishDialog, { PUBLISH_WORD, publishReady, publishRows } from '../src/pages/admin/contracts/PublishDialog.jsx';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const originals = { ...contractsApi };
const restore = () => Object.assign(contractsApi, originals);

test('the rules: three rows in the canvas\'s order; ready only with a 10-character reason and the exact word', () => {
  const rows = publishRows('Initial LPA', 4, 3);
  assert.deepEqual(rows.map(([k]) => k), ['What changes', 'Who is told', 'What is recorded']);
  assert.match(rows[0][1], /^v4 of “Initial LPA” becomes Approved for use\. .*3 documents issued earlier keep the text they were issued with\.$/);
  assert.match(publishRows('Initial LPA', 4, 0)[0][1], /Documents already issued do not change\.$/, 'no count: no number is made up');
  assert.match(rows[1][1], /No one is notified/);
  assert.equal(PUBLISH_WORD, 'PUBLISH');
  assert.equal(publishReady('Counsel approved.', 'PUBLISH'), true);
  assert.equal(publishReady('Counsel approved.', 'publish'), false, 'the word is exact');
  assert.equal(publishReady('  short    ', 'PUBLISH'), false, 'blank padding is not a reason');
  assert.equal(publishReady('', 'PUBLISH'), false);
});

test('mounted: Publish waits for the reason and the word, then sends both; Withdraw still asks once', async () => {
  const calls = [];
  contractsApi.publishOne = async (...args) => { calls.push(['publishOne', args]); return { ok: true, publication: { version: 4 } }; };
  contractsApi.withdraw = async (...args) => { calls.push(['withdraw', args]); return { ok: true }; };
  const done = [];
  let view = await mountContracts(React.createElement(PublishDialog, { mode: 'publish', slug: 'initial_lpa', title: 'Initial LPA', version: 4, usageCount: 2, onDone: (x) => done.push(x), onClose() {} }));
  try {
    const confirm = () => view.nodes().find((n) => view.props(n)?.['data-testid'] === 'template-publish-confirm');
    assert.equal(view.props(confirm()).disabled, true);
    await act(async () => { view.props(confirm()).onClick(); });
    assert.equal(calls.length, 0, 'a press before the form is complete sends nothing');
    const area = view.nodes().find((n) => n.tagName === 'TEXTAREA');
    const word = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.autoComplete === 'off');
    await act(async () => { view.props(area).onChange({ target: { value: '  Counsel approved v4 on 2026-11-09.  ' } }); });
    await act(async () => { view.props(word).onChange({ target: { value: 'Publish' } }); });
    assert.equal(view.props(confirm()).disabled, true, 'the word is exact');
    await act(async () => { view.props(word).onChange({ target: { value: 'PUBLISH' } }); });
    assert.equal(view.props(confirm()).disabled, false);
    await act(async () => { view.props(confirm()).onClick(); });
    await view.flush();
    assert.deepEqual(calls, [['publishOne', ['initial_lpa', 4, { reason: 'Counsel approved v4 on 2026-11-09.', confirm: 'PUBLISH' }]]]);
    assert.deepEqual(done, [{ mode: 'publish', publication: { version: 4 } }]);
  } finally { await view.unmount(); }
  view = await mountContracts(React.createElement(PublishDialog, { mode: 'withdraw', slug: 'initial_lpa', title: 'Initial LPA', version: 3, onDone() {}, onClose() {} }));
  try {
    assert.equal(view.nodes().some((n) => n.tagName === 'TEXTAREA'), false, 'withdraw keeps its one confirmation');
    await view.click('Withdraw');
    await view.flush();
    assert.deepEqual(calls.at(-1), ['withdraw', ['initial_lpa']]);
  } finally { await view.unmount(); restore(); }
});

test('the client sends the version, the reason and the word', async () => {
  const undo = installDocument();
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push([String(url), JSON.parse(init.body)]); return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await originals.publishOne('initial_lpa', 4, { reason: 'Counsel approved.', confirm: 'PUBLISH' });
    assert.match(sent[0][0], /\/api\/admin\/contracts\/published-templates\/initial_lpa\/publish$/);
    assert.deepEqual(sent[0][1], { version: 4, reason: 'Counsel approved.', confirm: 'PUBLISH' });
  } finally { globalThis.fetch = realFetch; undo(); }
});
