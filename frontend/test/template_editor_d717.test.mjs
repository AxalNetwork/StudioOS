/**
 * D717 (#1852) — the template editor on Contracts › Templates: highlighted
 * fields, who fills each, scroll-synced panes, Kind and Axal VC party,
 * Publish v[N] and Withdraw. Every title, slug, name and id is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/template_editor_d717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import PaperPreview, { PaperFrame } from '../src/components/PaperPreview.jsx';
import { headingKey, mapOffset, pairAnchors, sourceAnchors } from '../src/lib/paneSync.js';
import { mountContracts } from './_contracts_dom.mjs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Test Admin', is_super_admin: 1 };

const OPTIONS = (derived, entity) => ({
  kinds: ['agreement', 'corporate', 'resolution', 'unilateral', 'policy'],
  parties: ['management', 'holdings', 'gp', 'fund', 'none'],
  partyless_kinds: ['unilateral', 'corporate', 'policy'],
  derived, entity,
});
const base = { category: 'gp', doc_kind: null, axal_party: null, format_fixed: false, usage_count: 0, published_version: null, is_stub: 0 };
const ROWS = {
  agree: { ...base, slug: 'd717_test_agreement', title: 'Test Agreement', version: 3, body_md: '# Test Agreement\n## One {{a.b}}\nText', kind: 'agreement', party: 'gp', usage_count: 3, format_options: OPTIONS({ kind: 'agreement', party: 'gp' }, 'gp') },
  policy: { ...base, slug: 'd717_test_policy', title: 'Test Policy', version: 1, body_md: 'Policy text', kind: 'policy', party: 'none', format_options: OPTIONS({ kind: 'policy', party: 'none' }, 'management') },
  notice: { ...base, slug: 'd717_test_notice', title: 'Test Notice', version: 1, body_md: 'Notice text', kind: 'notice', party: 'gp', format_fixed: true, format_options: OPTIONS({ kind: 'notice', party: 'gp' }, 'gp') },
  stub: { ...base, slug: 'd717_test_stub', title: 'Test Stub', version: 2, body_md: '', is_stub: 1, published_version: 2, kind: 'agreement', party: 'gp', format_options: OPTIONS({ kind: 'agreement', party: 'gp' }, 'gp') },
  live: { ...base, slug: 'd717_test_live', title: 'Test Live', version: 3, body_md: 'Live body', published_version: 2, kind: 'agreement', party: 'gp', format_options: OPTIONS({ kind: 'agreement', party: 'gp' }, 'gp') },
  bare: { ...base, slug: 'd717_test_bare', title: 'Test Bare', version: 1, body_md: 'Bare body' },
};
const FIELDS = [{ key: 'counterparty.legal_name', filled_by: 'send' }, { key: 'agreement.effective_date', filled_by: 'sender' }];

function setup({ fields = FIELDS, contract = {}, legacy = {} } = {}) {
  const calls = [];
  const answers = {
    adminTemplateStoreGet: async (slug) => ({ template: { ...Object.values(ROWS).find(r => r.slug === slug) } }),
    adminTemplateStoreVersions: async () => ({ versions: [] }),
    adminTemplateStoreUpdate: async (slug, payload) => {
      const row = Object.values(ROWS).find(r => r.slug === slug);
      return { template: { ...row, ...payload, version: row.version + 1 } };
    },
    getMe: never,
    ...legacy,
  };
  const contractAnswers = {
    templates: async () => ({ items: Object.values(ROWS) }),
    stats: never,
    renderPaper: async () => ({ html: '<p>paper</p>', paper_sha256: 'sha-fixture', fields }),
    paperFonts: async () => ({ paper_sha256: 'sha-fixture', css: '' }),
    ...contract,
  };
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (answers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const of = (calls, key) => calls.filter(([k]) => k === key);
// The paper redraws 500 ms after the last edit.
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 560)); });

async function open(rowKey, { who = user, ...opts } = {}) {
  const calls = setup(opts);
  const view = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)), '/admin/contracts?tab=templates', who);
  await view.flush();
  await view.click(ROWS[rowKey].title);
  await view.flush();
  await settle();
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const byTestId = (id) => view.nodes().find(n => view.props(n)?.['data-testid'] === id);
  const group = (label) => view.nodes().find(n => view.props(n)?.role === 'group' && view.props(n)['aria-label'] === label);
  const groupButtons = (label) => (group(label)?.childNodes || []).map(n => ({ text: textOf(n), pressed: view.props(n)['aria-pressed'] }));
  const press = async (label, text) => {
    const b = (group(label)?.childNodes || []).find(n => textOf(n) === text);
    if (!b) throw new Error(`Missing ${label} option: ${text}`);
    await act(async () => { view.props(b).onClick(); });
  };
  const clickId = async (id) => { const n = byTestId(id); if (!n) throw new Error('Missing ' + id); await act(async () => { view.props(n).onClick({ stopPropagation() {} }); }); };
  const type = async (value) => { await act(async () => { view.props(byTestId('template-body')).onChange({ target: { value } }); }); };
  const lastPut = () => of(calls, 'adminTemplateStoreUpdate').at(-1)?.[1][1];
  const buttons = () => view.nodes().filter(n => n.tagName === 'BUTTON').map(n => textOf(n).trim());
  // The stub DOM's text nodes take React's updates on `nodeValue`, which the
  // harness's text() does not read, so these assertions read it here.
  const text = () => textOf(view.nodes()[0]);
  const click = async (label) => {
    const n = view.nodes().find(b => b.tagName === 'BUTTON' && textOf(b).trim() === label);
    if (!n) throw new Error('Missing button: ' + label);
    if (view.props(n).disabled) throw new Error('Disabled button: ' + label);
    await act(async () => { view.props(n).onClick({ stopPropagation() {} }); });
  };
  return { calls, view, text, click, byTestId, group, groupButtons, press, clickId, type, lastPut, buttons, textOf };
}

test('Kind: From the slug and the five storable kinds; a choice and its reset both save, the reset as null', async () => {
  const e = await open('agree');
  try {
    assert.deepEqual(e.groupButtons('Kind').map(b => b.text), ['From the slug (agreement)', 'agreement', 'corporate', 'resolution', 'unilateral', 'policy']);
    assert.ok(!e.groupButtons('Kind').some(b => /notice|booklet/.test(b.text)));
    assert.equal(e.groupButtons('Kind')[0].pressed, true);
    await e.press('Kind', 'resolution');
    assert.equal(e.groupButtons('Kind').find(b => b.text === 'resolution').pressed, true);
    await e.click('Save draft'); await e.view.flush();
    assert.equal(e.lastPut().doc_kind, 'resolution');
    await e.press('Kind', 'From the slug (agreement)');
    await e.click('Save draft'); await e.view.flush();
    assert.ok('doc_kind' in e.lastPut());
    assert.equal(e.lastPut().doc_kind, null);
  } finally { await e.view.unmount(); restore(); }
});

test('Party: four entities for a party kind, None only for a partyless one, a kind change resets it, From the slug names the entity', async () => {
  let e = await open('agree');
  try {
    const parties = e.groupButtons('Axal VC party').map(b => b.text);
    assert.equal(parties[0], 'From the slug (GP)');
    assert.deepEqual(parties.slice(1).sort(), ['GP', 'GP for the Fund', 'Holdings', 'Management']);
    assert.ok(!parties.includes('None'));
    await e.press('Axal VC party', 'GP');
    await e.press('Kind', 'policy');
    assert.deepEqual(e.groupButtons('Axal VC party').map(b => b.text), ['From the slug (None)', 'None']);
    assert.equal(e.groupButtons('Axal VC party')[0].pressed, true, 'the GP choice no longer fits, so it returns to the slug');
    await e.click('Save draft'); await e.view.flush();
    assert.deepEqual([e.lastPut().doc_kind, e.lastPut().axal_party], ['policy', null]);
  } finally { await e.view.unmount(); restore(); }
  e = await open('policy');
  try {
    assert.deepEqual(e.groupButtons('Axal VC party').map(b => b.text), ['From the slug (None)', 'None']);
    await e.press('Kind', 'agreement');
    assert.equal(e.groupButtons('Axal VC party')[0].text, 'From the slug (Management)', 'from format_options.entity, not derived.party');
  } finally { await e.view.unmount(); restore(); }
});

test('A notice reads "Set by the notice type" and saves neither key; a row with no format_options offers no control and still saves', async () => {
  let e = await open('notice');
  try {
    assert.match(e.text(), /Kind · notice · Axal VC party · GP · Set by the notice type/);
    assert.equal(e.group('Kind'), undefined); assert.equal(e.group('Axal VC party'), undefined);
    await e.type('Notice text, edited'); await e.click('Save draft'); await e.view.flush();
    assert.ok(!('doc_kind' in e.lastPut()) && !('axal_party' in e.lastPut()), JSON.stringify(e.lastPut()));
  } finally { await e.view.unmount(); restore(); }
  e = await open('bare');
  try {
    assert.equal(e.group('Kind'), undefined);
    await e.type('Bare body, edited'); await e.click('Save draft'); await e.view.flush();
    assert.equal(of(e.calls, 'adminTemplateStoreUpdate').length, 1);
    assert.equal(e.lastPut().body_md, 'Bare body, edited');
  } finally { await e.view.unmount(); restore(); }
});

test('The live paper is asked with the chosen pair; a bare PaperPreview sends neither key', async () => {
  const e = await open('agree');
  try {
    await e.press('Kind', 'resolution'); await settle();
    const body = of(e.calls, 'renderPaper').at(-1)[1][0];
    assert.equal(body.doc_kind, 'resolution');
    assert.ok('axal_party' in body);
  } finally { await e.view.unmount(); restore(); }
  const calls = setup();
  const view = await mountContracts(React.createElement(PaperPreview, { title: 'Bare', body: 'Body' }));
  try {
    await settle();
    const body = of(calls, 'renderPaper').at(-1)[1][0];
    assert.ok(!('doc_kind' in body) && !('axal_party' in body), JSON.stringify(body));
  } finally { await view.unmount(); restore(); }
});

test('Merge fields are the render answer\'s, in the canvas\'s words; an empty answer reads the old sentence', async () => {
  let e = await open('agree');
  try {
    const card = e.textOf(e.byTestId('template-merge-fields'));
    assert.match(card, /^Merge fields · 2/);
    assert.match(card, /\{\{counterparty\.legal_name\}\}Filled from the envelope/);
    assert.match(card, /\{\{agreement\.effective_date\}\}Unfilled/);
    assert.doesNotMatch(card, /a\.b/, 'the list is the answer\'s, not the body\'s');
  } finally { await e.view.unmount(); restore(); }
  e = await open('agree', { fields: [] });
  try {
    assert.match(e.textOf(e.byTestId('template-merge-fields')), /Merge fields · 0None — add \{\{field_name\}\} tokens to the body\./);
  } finally { await e.view.unmount(); restore(); }
});

test('The mirror numbers each line, draws a token as its own chip, and adds a row for a trailing newline; no innerHTML, no chip padding', async () => {
  const e = await open('agree');
  try {
    const mirror = () => e.byTestId('template-mirror');
    const numbers = () => e.view.nodes().filter(n => view_has(e, n, 'data-line-number')).map(n => e.textOf(n));
    assert.deepEqual(numbers(), ['1', '2', '3']);
    const chips = e.view.nodes().filter(n => view_has(e, n, 'data-merge-chip')).map(n => e.textOf(n));
    assert.deepEqual(chips, ['{{a.b}}']);
    await e.type('# Test Agreement\n## One {{a.b}}\nText\n');
    assert.deepEqual(numbers(), ['1', '2', '3', '4']);
    assert.ok(mirror());
  } finally { await e.view.unmount(); restore(); }
  const editor = src('../src/pages/admin/contracts/TemplateEditor.jsx');
  assert.ok(!editor.includes('dangerouslySetInnerHTML'));
  const chip = editor.match(/const chip = '([^']*)'/)[1];
  assert.doesNotMatch(chip, /(^|\s)(p[xytblr]?-|border)/, chip);
});
function view_has(e, n, attr) { const p = e.view.props(n); return !!p && attr in p; }

test('Save then Publish: disabled while unsaved, asks first, publishes once at the saved version, then reads Published v[N]', async () => {
  const publication = { slug: 'd717_test_agreement', version: 4, published_at: '2026-10-18 12:00:00', published_by: 2 };
  const e = await open('agree', { contract: { publishOne: async () => ({ ok: true, publication }) } });
  try {
    await e.type('# Test Agreement\n## One {{a.b}}\nText, edited');
    const button = e.byTestId('template-publish-one');
    assert.equal(e.textOf(button), 'Publish v4'); assert.equal(e.view.props(button).disabled, true);
    assert.match(e.text(), /Save first: Publish records the saved version\./);
    assert.match(e.text(), /Templates › Test Agreement · v4 draft/);
    assert.equal(of(e.calls, 'publishOne').length, 0);
    await e.click('Save draft'); await e.view.flush();
    assert.ok(e.byTestId('template-editor'), 'the editor stays open');
    assert.match(e.text(), /Templates › Test Agreement · v4(?! draft)/);
    await e.click('Publish v4');
    assert.match(e.text(), /Publish v4 of Test Agreement/);
    assert.match(e.text(), /Documents issued from now use this text\. Documents already issued do not change\./);
    assert.equal(of(e.calls, 'publishOne').length, 0);
    await e.clickId('template-publish-confirm'); await e.view.flush();
    assert.deepEqual(of(e.calls, 'publishOne').map(([, a]) => a), [['d717_test_agreement', 4]]);
    const done = e.textOf(e.byTestId('template-publish-done'));
    assert.match(done, /^Published v4/);
    assert.match(done, /Oct 18, 2026 · Test Admin\. The card now reads Published v4\./);
    assert.match(done, /3 documents issued earlier keep the text they were issued with\./);
    assert.equal(e.byTestId('template-publish-one'), undefined);
    assert.equal(e.textOf(e.byTestId('template-published-pill')).trim(), 'Published v4');
  } finally { await e.view.unmount(); restore(); }
});

test('Publish names the recorded admin id when someone else published', async () => {
  const e = await open('agree', { contract: { publishOne: async () => ({ ok: true, publication: { version: 3, published_at: '2026-10-18 12:00:00', published_by: 77 } }) } });
  try {
    await e.click('Publish v3'); await e.clickId('template-publish-confirm'); await e.view.flush();
    assert.match(e.textOf(e.byTestId('template-publish-done')), / · Admin #77\./);
  } finally { await e.view.unmount(); restore(); }
});

test('A refusal prints the Worker\'s sentence and no result', async () => {
  for (const [code, message] of [['published_version_changed', 'This template changed since it was opened. Open it again to publish the saved version.'], ['template_has_no_body', 'A stub has no body to publish.']]) {
    const e = await open('agree', { contract: { publishOne: async () => { throw Object.assign(new Error(message), { code, status: 409 }); } } });
    try {
      await e.click('Publish v3'); await e.clickId('template-publish-confirm'); await e.view.flush();
      assert.equal(e.textOf(e.byTestId('template-publish-refusal')), message);
      assert.equal(e.byTestId('template-publish-done'), undefined);
      assert.doesNotMatch(e.text(), /The card now reads/);
    } finally { await e.view.unmount(); restore(); }
  }
  assert.ok(!src('../src/pages/admin/contracts/PublishDialog.jsx').includes('This template changed since it was opened'));
});

test('Withdraw is offered on a published stub only, asks first and withdraws once', async () => {
  let e = await open('stub', { contract: { withdraw: async () => ({ ok: true }) } });
  try {
    assert.equal(e.byTestId('template-publish-one'), undefined);
    await e.click('Withdraw published v2');
    assert.match(e.text(), /Withdraw published v2 of Test Stub/);
    assert.match(e.text(), /New envelope stops offering this template\. Documents already issued do not change\./);
    assert.equal(of(e.calls, 'withdraw').length, 0);
    await e.clickId('template-publish-confirm'); await e.view.flush();
    assert.deepEqual(of(e.calls, 'withdraw').map(([, a]) => a), [['d717_test_stub']]);
    assert.match(e.text(), /Publication withdrawn\./);
  } finally { await e.view.unmount(); restore(); }
  e = await open('live');
  try {
    assert.ok(!e.buttons().some(b => /^Withdraw/.test(b)));
    assert.equal(e.textOf(e.byTestId('template-publish-one')), 'Publish v3');
  } finally { await e.view.unmount(); restore(); }
});

test('On a branch Worker the editor is read-only: no authoring control, reads stay', async () => {
  const e = await open('agree', { who: { ...user, branch: { code: 'fr' } }, legacy: { adminTemplateStoreVersions: async () => ({ versions: [{ version: 2, title: 'Old', body_md: 'Old body', category: 'gp' }] }) } });
  try {
    for (const label of ['Save draft', 'Delete', 'Restore']) assert.ok(!e.buttons().includes(label), label);
    assert.ok(!e.buttons().some(b => /^(Publish v|Withdraw)/.test(b)));
    assert.equal(e.view.props(e.byTestId('template-body')).readOnly, true);
    assert.equal(e.group('Kind'), undefined);
    assert.match(e.text(), /Kind · agreement · Axal VC party · GP/);
    assert.ok(e.buttons().includes('Download PDF'));
    await e.click('History (1)');
    assert.ok(e.buttons().includes('View') && !e.buttons().includes('Restore'));
  } finally { await e.view.unmount(); restore(); }
});

test('Leaving with unsaved changes asks first; with none it closes at once', async () => {
  let e = await open('agree');
  try {
    await e.type('changed');
    await e.clickId('template-editor-back');
    assert.match(e.text(), /Leave without saving\? The changes are not saved\./);
    await e.click('Stay');
    assert.ok(e.byTestId('template-editor'));
    await e.clickId('template-editor-back'); await e.click('Leave');
    assert.equal(e.byTestId('template-editor'), undefined);
  } finally { await e.view.unmount(); restore(); }
  e = await open('agree');
  try {
    await e.clickId('template-editor-back');
    assert.equal(e.byTestId('template-editor'), undefined);
    assert.doesNotMatch(e.text(), /Leave without saving/);
  } finally { await e.view.unmount(); restore(); }
});

test('The frame keeps its sandbox exactly; the downloads keep their calls', () => {
  const html = renderToStaticMarkup(React.createElement(PaperFrame, { html: '<p>x</p>', title: 'Fixture', onFrameLoad() {} }));
  assert.match(html, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(html, /allow-scripts/);
  const editor = src('../src/pages/admin/contracts/TemplateEditor.jsx');
  for (const file of [editor, src('../src/components/PaperPreview.jsx')]) assert.ok(!file.includes('allow-scripts'));
  assert.ok(editor.includes('data-testid="template-download-docx"'));
  assert.ok(editor.includes('api.adminTemplateStoreDocxBlob(slug'));
  assert.match(editor, /adminTemplateStorePreviewPdfBlob\(slug, \{[^}]*page: pageSize, cover,/);
});

test('paneSync pairs headings by text, skips the unmatched, interpolates between pairs, clamps and stays monotonic', () => {
  const lines = ['# Title', '## A', 'text', '### Run-in', '## B {{deal.amount}}', 'text', '## C'];
  const offsets = [0, 40, 60, 80, 100, 120, 200];
  const source = sourceAnchors(lines, offsets);
  assert.deepEqual(source.map(a => a.text), ['title', 'a', 'run-in', 'b', 'c']);
  const paper = [{ text: 'A', y: 300 }, { text: 'B [Deal Amount]', y: 500 }, { text: 'C', y: 900 }];
  assert.equal(headingKey('B [Deal Amount]'), headingKey('## B {{deal.amount}}'));
  const pairs = pairAnchors(source, paper, { sourceEnd: 400, paperEnd: 1600 });
  assert.deepEqual(pairs, [{ s: 0, p: 0 }, { s: 40, p: 300 }, { s: 100, p: 500 }, { s: 200, p: 900 }, { s: 400, p: 1600 }]);
  assert.equal(mapOffset(40, pairs, 's', 'p'), 300);
  assert.equal(mapOffset(70, pairs, 's', 'p'), 400, 'halfway between A and B maps halfway');
  assert.equal(mapOffset(400, pairs, 'p', 's'), 70);
  assert.equal(mapOffset(9999, pairs, 's', 'p'), 1600);
  assert.equal(mapOffset(-5, pairs, 's', 'p'), 0);
  let last = -1;
  for (let y = 0; y <= 400; y += 5) { const p = mapOffset(y, pairs, 's', 'p'); assert.ok(p >= last); last = p; }
  last = -1;
  for (let y = 0; y <= 1600; y += 20) { const s = mapOffset(y, pairs, 'p', 's'); assert.ok(s >= last); last = s; }
  // Pairing is by text, not by index: a paper with an extra heading first still pairs A with A.
  const shifted = pairAnchors(source, [{ text: 'Preamble', y: 100 }, ...paper], { sourceEnd: 400, paperEnd: 1600 });
  assert.deepEqual(shifted[1], { s: 40, p: 300 });
});
